// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ITetherV2} from "./interfaces/ITetherV2.sol";

/// @title QuietPay
/// @notice Gasless USDT checkout, refunds and subscriptions for merchants on Whitechain.
/// @dev Holds no USDT between transactions: funds move payer -> QuietPay -> merchant payout (or
///      merchant payout -> QuietPay -> payer for refunds) inside one call. Operators (the API relayers)
///      can register merchants and plans but can never move a customer's money without the customer's
///      signature, nor refund from a merchant without the merchant payout wallet's signature.
contract QuietPay is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for ITetherV2;
    using SafeCast for uint256;

    // ------------------------------------------------------------------ types

    struct Merchant {
        address payout;
        address signer;
        bool active;
    }

    /// @dev kind 0 = checkout, 1 = subscription charge
    struct Payment {
        uint256 merchantId;
        bytes32 ref;
        address payer;
        uint128 amount;
        uint128 refunded;
        uint64 paidAt;
        uint8 kind;
    }

    struct Plan {
        uint256 merchantId;
        uint128 amount;
        uint32 period;
        uint32 grace;
        bool active;
    }

    enum Status {
        None,
        Active,
        PastDue,
        Canceled
    }

    struct Sub {
        uint256 planId;
        address subscriber;
        uint64 nextChargeAt;
        uint64 pastDueSince;
        uint32 cycle;
        Status status;
    }

    // ------------------------------------------------------------------ constants

    bytes32 public constant INVOICE_TYPEHASH =
        keccak256("Invoice(uint256 merchantId,bytes32 orderId,uint256 amount,uint256 expiresAt)");
    bytes32 public constant SUBSCRIBE_TYPEHASH =
        keccak256("Subscribe(uint256 planId,address subscriber,uint256 maxAmount,uint256 nonce,uint256 deadline)");
    bytes32 public constant CANCEL_SUBSCRIPTION_TYPEHASH =
        keccak256("CancelSubscription(uint256 subId,uint256 nonce,uint256 deadline)");

    uint16 public constant MAX_FEE_BPS = 100;
    uint8 internal constant KIND_CHECKOUT = 0;
    uint8 internal constant KIND_SUBSCRIPTION = 1;
    uint8 internal constant CANCEL_BY_CUSTOMER = 0;
    uint8 internal constant CANCEL_NONPAYMENT = 1;
    uint8 internal constant CANCEL_BY_MERCHANT = 2;

    // ------------------------------------------------------------------ storage

    ITetherV2 public immutable usdt;

    mapping(uint256 => Merchant) public merchants;
    uint256 public nextMerchantId = 1;
    mapping(bytes32 => Payment) public payments;
    mapping(uint256 => mapping(bytes32 => bool)) public orderPaid;
    mapping(bytes32 => uint32) public refundCount;
    mapping(uint256 => Plan) public plans;
    uint256 public nextPlanId = 1;
    mapping(uint256 => Sub) public subs;
    uint256 public nextSubId = 1;
    /// @notice Nonces for Subscribe / CancelSubscription signatures.
    mapping(address => uint256) public sigNonces;
    uint16 public feeBps;
    address public feeRecipient;
    mapping(address => bool) public operators;

    // ------------------------------------------------------------------ events

    event OperatorSet(address indexed operator, bool allowed);
    event FeeSet(uint16 bps, address recipient);
    event MerchantRegistered(uint256 indexed merchantId, address payout, address signer);
    event MerchantUpdated(uint256 indexed merchantId, address payout, address signer, bool active);
    event PaymentReceived(
        bytes32 indexed paymentId,
        uint256 indexed merchantId,
        bytes32 indexed ref,
        address payer,
        uint256 amount,
        uint256 fee,
        uint8 kind,
        uint256 subId
    );
    event Refunded(
        bytes32 indexed paymentId,
        uint256 indexed merchantId,
        uint32 seq,
        address payer,
        uint256 amount,
        uint256 totalRefunded
    );
    event PlanCreated(uint256 indexed planId, uint256 indexed merchantId, uint256 amount, uint32 period, uint32 grace);
    event PlanUpdated(uint256 indexed planId, bool active);
    event Subscribed(uint256 indexed subId, uint256 indexed planId, address indexed subscriber);
    event Renewed(uint256 indexed subId, uint32 cycle, bytes32 paymentId, uint256 amount);
    event RenewalFailed(uint256 indexed subId, uint32 attemptedCycle);
    /// @param reason 0 customer, 1 nonpayment, 2 merchant
    event SubscriptionCanceled(uint256 indexed subId, uint8 reason);

    // ------------------------------------------------------------------ errors

    error MerchantInactive();
    error InvoiceExpired();
    error OrderAlreadyPaid();
    error InvalidMerchantSignature();
    error UnknownPayment();
    error RefundExceedsPayment();
    error PlanInactive();
    error PlanAboveMax();
    error SignatureExpired();
    error InvalidSubscriberSignature();
    error InsufficientAllowance();
    error NotChargeable();
    error NotDue();
    error NotOperator();
    error FeeTooHigh();
    error InvalidAmount();
    error ZeroAddress();

    // ------------------------------------------------------------------ setup

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert NotOperator();
        _;
    }

    /// @param usdt_ The USDT (TetherTokenV2) token.
    /// @param owner_ Admin that manages operators, fees and pause.
    constructor(address usdt_, address owner_) Ownable(owner_) EIP712("QuietPay", "1") {
        if (usdt_ == address(0)) revert ZeroAddress();
        usdt = ITetherV2(usdt_);
    }

    // ------------------------------------------------------------------ admin (owner)

    /// @notice Allow or revoke an operator (an API relayer wallet).
    /// @param op Operator address.
    /// @param allowed True to allow, false to revoke.
    function setOperator(address op, bool allowed) external onlyOwner {
        if (op == address(0)) revert ZeroAddress();
        operators[op] = allowed;
        emit OperatorSet(op, allowed);
    }

    /// @notice Set the protocol fee taken from every payment.
    /// @param bps Fee in basis points, at most 100 (1%).
    /// @param recipient Receives the fee; required when `bps > 0`.
    function setFee(uint16 bps, address recipient) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        if (bps > 0 && recipient == address(0)) revert ZeroAddress();
        feeBps = bps;
        feeRecipient = recipient;
        emit FeeSet(bps, recipient);
    }

    /// @notice Pause pay, subscribe and charge. Refunds and cancellations keep working.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume pay, subscribe and charge.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------ merchants (operator)

    /// @notice Register a merchant.
    /// @param payout Wallet that receives payments and authorizes refunds.
    /// @param signer Key that signs invoices (held encrypted by the API).
    /// @return merchantId The new merchant id.
    function registerMerchant(address payout, address signer) external onlyOperator returns (uint256 merchantId) {
        if (payout == address(0) || signer == address(0)) revert ZeroAddress();
        merchantId = nextMerchantId++;
        merchants[merchantId] = Merchant({payout: payout, signer: signer, active: true});
        emit MerchantRegistered(merchantId, payout, signer);
    }

    /// @notice Update a merchant's payout wallet, invoice signer or active flag.
    /// @param id Merchant id.
    /// @param payout New payout wallet.
    /// @param signer New invoice signer.
    /// @param active False blocks new payments and subscriptions for this merchant.
    function updateMerchant(uint256 id, address payout, address signer, bool active) external onlyOperator {
        if (merchants[id].payout == address(0)) revert MerchantInactive();
        if (payout == address(0) || signer == address(0)) revert ZeroAddress();
        merchants[id] = Merchant({payout: payout, signer: signer, active: active});
        emit MerchantUpdated(id, payout, signer, active);
    }

    // ------------------------------------------------------------------ one-time payment

    /// @notice Pay a merchant-signed invoice with the payer's EIP-3009 authorization. Anyone may submit.
    /// @param merchantId Merchant id.
    /// @param orderId Order id (the API uses keccak256(sessionId)).
    /// @param amount Amount in USDT base units.
    /// @param expiresAt Invoice expiry (unix seconds).
    /// @param merchantSig Merchant signer's EIP-712 `Invoice` signature.
    /// @param payer Customer wallet.
    /// @param validAfter EIP-3009 validAfter.
    /// @param validBefore EIP-3009 validBefore.
    /// @param payerSig Payer's `ReceiveWithAuthorization` signature (to = this, nonce = paymentNonce).
    /// @return paymentId keccak256(abi.encode(merchantId, orderId)).
    function pay(
        uint256 merchantId,
        bytes32 orderId,
        uint256 amount,
        uint256 expiresAt,
        bytes calldata merchantSig,
        address payer,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata payerSig
    ) external nonReentrant whenNotPaused returns (bytes32 paymentId) {
        _checkInvoice(merchantId, orderId, amount, expiresAt, merchantSig);

        // effects
        paymentId = _recordCheckoutPayment(merchantId, orderId, amount, payer);
        bytes32 nonce = paymentNonce(merchantId, orderId);

        // interactions: pull from payer (reverts if the payer signed anything else), then pay out
        _receive(payer, amount, validAfter, validBefore, nonce, payerSig);
        _payoutAndEmitCheckout(paymentId, merchantId, orderId, payer, amount);
    }

    // ------------------------------------------------------------------ refunds

    /// @notice Refund part or all of a payment to the original payer. Anyone may submit; the merchant's
    ///         payout wallet authorizes it with EIP-3009. Works while paused.
    /// @param paymentId Payment to refund.
    /// @param amount Amount in USDT base units.
    /// @param validAfter EIP-3009 validAfter.
    /// @param validBefore EIP-3009 validBefore.
    /// @param payoutSig Payout wallet's `ReceiveWithAuthorization` signature (nonce = refundNonce(paymentId, refundCount)).
    function refund(
        bytes32 paymentId,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata payoutSig
    ) external nonReentrant {
        // checks + effects
        (uint32 seq, address payout) = _recordRefund(paymentId, amount);
        bytes32 nonce = refundNonce(paymentId, seq);

        // interactions: pull from the merchant payout wallet, then send to the original payer
        _receive(payout, amount, validAfter, validBefore, nonce, payoutSig);
        _sendRefund(paymentId, seq, amount);
    }

    // ------------------------------------------------------------------ plans (operator)

    /// @notice Create a subscription plan for a merchant.
    /// @param merchantId Merchant id (must be active).
    /// @param amount Charge per period in USDT base units.
    /// @param period Seconds between charges.
    /// @param grace Seconds a past-due subscription is retried before it is canceled.
    /// @return planId The new plan id.
    function createPlan(uint256 merchantId, uint128 amount, uint32 period, uint32 grace)
        external
        onlyOperator
        returns (uint256 planId)
    {
        if (!merchants[merchantId].active) revert MerchantInactive();
        if (amount == 0 || period == 0) revert InvalidAmount();
        planId = nextPlanId++;
        plans[planId] = Plan({merchantId: merchantId, amount: amount, period: period, grace: grace, active: true});
        emit PlanCreated(planId, merchantId, amount, period, grace);
    }

    /// @notice Enable or disable new subscriptions to a plan. Existing subscriptions keep renewing.
    /// @param planId Plan id.
    /// @param active New state.
    function setPlanActive(uint256 planId, bool active) external onlyOperator {
        if (plans[planId].merchantId == 0) revert PlanInactive();
        plans[planId].active = active;
        emit PlanUpdated(planId, active);
    }

    // ------------------------------------------------------------------ subscriptions

    /// @notice Start a subscription and charge the first period immediately. Anyone may submit.
    /// @param planId Plan id.
    /// @param subscriber Customer wallet.
    /// @param maxAmount Highest per-period amount the subscriber accepts.
    /// @param deadline Expiry of the Subscribe signature.
    /// @param subscribeSig Subscriber's EIP-712 `Subscribe` signature (nonce = sigNonces[subscriber]).
    /// @param permitValue USDT allowance to grant QuietPay.
    /// @param permitDeadline Permit deadline.
    /// @param permitSig Subscriber's EIP-2612 `Permit` signature. A failing permit is tolerated if the allowance is already enough.
    /// @return subId The new subscription id.
    function subscribe(
        uint256 planId,
        address subscriber,
        uint256 maxAmount,
        uint256 deadline,
        bytes calldata subscribeSig,
        uint256 permitValue,
        uint256 permitDeadline,
        bytes calldata permitSig
    ) external nonReentrant whenNotPaused returns (uint256 subId) {
        _checkSubscribe(planId, subscriber, maxAmount, deadline, subscribeSig);
        _permitAndCheckAllowance(planId, subscriber, permitValue, permitDeadline, permitSig);
        subId = _startSubscription(planId, subscriber);
    }

    /// @notice Charge a due subscription. Anyone may call (the keeper does). Never reverts because the
    ///         subscriber can't pay: a failed charge marks the subscription past due, and after the grace
    ///         period cancels it for nonpayment.
    /// @param subId Subscription id.
    function charge(uint256 subId) external nonReentrant whenNotPaused {
        Sub storage s = subs[subId];
        Status status = s.status;
        if (status != Status.Active && status != Status.PastDue) revert NotChargeable();
        if (block.timestamp < s.nextChargeAt) revert NotDue();

        Plan memory plan = plans[s.planId];
        address subscriber = s.subscriber;

        // low-level call so a failed transfer (low balance / allowance) doesn't revert this tx
        (bool ok, bytes memory data) =
            address(usdt).call(abi.encodeCall(IERC20.transferFrom, (subscriber, address(this), uint256(plan.amount))));
        bool success = ok && (data.length == 0 || (data.length >= 32 && abi.decode(data, (bool))));

        if (success) {
            uint32 cycle = s.cycle + 1;
            s.cycle = cycle;
            uint256 next = uint256(s.nextChargeAt) + plan.period;
            s.nextChargeAt = (next > block.timestamp ? next : block.timestamp + 1).toUint64();
            s.status = Status.Active;
            s.pastDueSince = 0;
            bytes32 paymentId = _recordSubscriptionPayment(subId, cycle, plan, subscriber);
            emit Renewed(subId, cycle, paymentId, plan.amount);
            _payoutSubscription(paymentId, subId, subscriber, plan);
        } else if (status == Status.Active) {
            s.status = Status.PastDue;
            s.pastDueSince = block.timestamp.toUint64();
            emit RenewalFailed(subId, s.cycle + 1);
        } else if (block.timestamp >= uint256(s.pastDueSince) + plan.grace) {
            s.status = Status.Canceled;
            emit SubscriptionCanceled(subId, CANCEL_NONPAYMENT);
        } else {
            emit RenewalFailed(subId, s.cycle + 1);
        }
    }

    /// @notice Cancel a subscription with the subscriber's signature. Anyone may submit. Works while paused.
    /// @param subId Subscription id.
    /// @param deadline Expiry of the CancelSubscription signature.
    /// @param subscriberSig Subscriber's EIP-712 `CancelSubscription` signature (nonce = sigNonces[subscriber]).
    function cancel(uint256 subId, uint256 deadline, bytes calldata subscriberSig) external nonReentrant {
        Sub storage s = subs[subId];
        if (s.status != Status.Active && s.status != Status.PastDue) revert NotChargeable();
        if (block.timestamp > deadline) revert SignatureExpired();

        address subscriber = s.subscriber;
        uint256 nonce = sigNonces[subscriber]++;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_SUBSCRIPTION_TYPEHASH, subId, nonce, deadline)));
        if (!SignatureChecker.isValidSignatureNow(subscriber, digest, subscriberSig)) {
            revert InvalidSubscriberSignature();
        }

        s.status = Status.Canceled;
        emit SubscriptionCanceled(subId, CANCEL_BY_CUSTOMER);
    }

    /// @notice Cancel a subscription on the merchant's behalf.
    /// @param subId Subscription id.
    function cancelByMerchant(uint256 subId) external onlyOperator {
        Sub storage s = subs[subId];
        if (s.status != Status.Active && s.status != Status.PastDue) revert NotChargeable();
        s.status = Status.Canceled;
        emit SubscriptionCanceled(subId, CANCEL_BY_MERCHANT);
    }

    // ------------------------------------------------------------------ views (derived ids, digests)

    /// @notice EIP-712 domain separator of this contract.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice EIP-712 digest of an Invoice, as signed by the merchant signer.
    function invoiceDigest(uint256 merchantId, bytes32 orderId, uint256 amount, uint256 expiresAt)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(INVOICE_TYPEHASH, merchantId, orderId, amount, expiresAt)));
    }

    /// @notice EIP-3009 nonce the payer signs for a checkout payment.
    function paymentNonce(uint256 merchantId, bytes32 orderId) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), merchantId, orderId));
    }

    /// @notice paymentId of a checkout payment.
    function checkoutPaymentId(uint256 merchantId, bytes32 orderId) public pure returns (bytes32) {
        return keccak256(abi.encode(merchantId, orderId));
    }

    /// @notice paymentId of a subscription charge.
    function subscriptionPaymentId(uint256 subId, uint32 cycle) public pure returns (bytes32) {
        return keccak256(abi.encode("sub", subId, cycle));
    }

    /// @notice EIP-3009 nonce the payout wallet signs for refund number `seq` of a payment.
    function refundNonce(bytes32 paymentId, uint32 seq) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), "refund", paymentId, seq));
    }

    // ------------------------------------------------------------------ internal

    /// @dev pay() checks 1–5 from the spec.
    function _checkInvoice(
        uint256 merchantId,
        bytes32 orderId,
        uint256 amount,
        uint256 expiresAt,
        bytes calldata merchantSig
    ) internal view {
        Merchant memory m = merchants[merchantId];
        if (!m.active) revert MerchantInactive();
        if (block.timestamp > expiresAt) revert InvoiceExpired();
        if (orderPaid[merchantId][orderId]) revert OrderAlreadyPaid();
        if (amount == 0 || amount > type(uint128).max) revert InvalidAmount();
        bytes32 digest = invoiceDigest(merchantId, orderId, amount, expiresAt);
        if (!SignatureChecker.isValidSignatureNow(m.signer, digest, merchantSig)) revert InvalidMerchantSignature();
    }

    function _recordCheckoutPayment(uint256 merchantId, bytes32 orderId, uint256 amount, address payer)
        internal
        returns (bytes32 paymentId)
    {
        paymentId = checkoutPaymentId(merchantId, orderId);
        orderPaid[merchantId][orderId] = true;
        payments[paymentId] = Payment({
            merchantId: merchantId,
            ref: orderId,
            payer: payer,
            amount: amount.toUint128(),
            refunded: 0,
            paidAt: block.timestamp.toUint64(),
            kind: KIND_CHECKOUT
        });
    }

    function _recordSubscriptionPayment(uint256 subId, uint32 cycle, Plan memory plan, address subscriber)
        internal
        returns (bytes32 paymentId)
    {
        paymentId = subscriptionPaymentId(subId, cycle);
        payments[paymentId] = Payment({
            merchantId: plan.merchantId,
            ref: bytes32(subId),
            payer: subscriber,
            amount: plan.amount,
            refunded: 0,
            paidAt: block.timestamp.toUint64(),
            kind: KIND_SUBSCRIPTION
        });
    }

    /// @dev subscribe() checks 1–2: plan and merchant active, deadline, max amount, Subscribe signature.
    function _checkSubscribe(
        uint256 planId,
        address subscriber,
        uint256 maxAmount,
        uint256 deadline,
        bytes calldata subscribeSig
    ) internal {
        Plan memory plan = plans[planId];
        if (!plan.active) revert PlanInactive();
        if (!merchants[plan.merchantId].active) revert MerchantInactive();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (plan.amount > maxAmount) revert PlanAboveMax();

        uint256 nonce = sigNonces[subscriber]++;
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(SUBSCRIBE_TYPEHASH, planId, subscriber, maxAmount, nonce, deadline)));
        if (!SignatureChecker.isValidSignatureNow(subscriber, digest, subscribeSig)) {
            revert InvalidSubscriberSignature();
        }
    }

    /// @dev subscribe() check 3. Tolerates a front-run permit: only the resulting allowance matters.
    function _permitAndCheckAllowance(
        uint256 planId,
        address subscriber,
        uint256 permitValue,
        uint256 permitDeadline,
        bytes calldata permitSig
    ) internal {
        try usdt.permit(subscriber, address(this), permitValue, permitDeadline, permitSig) {} catch {}
        if (usdt.allowance(subscriber, address(this)) < plans[planId].amount) revert InsufficientAllowance();
    }

    /// @dev subscribe() steps 4–5: create the subscription and charge the first period (must succeed).
    function _startSubscription(uint256 planId, address subscriber) internal returns (uint256 subId) {
        Plan memory plan = plans[planId];

        // effects
        subId = nextSubId++;
        subs[subId] = Sub({
            planId: planId,
            subscriber: subscriber,
            nextChargeAt: (block.timestamp + plan.period).toUint64(),
            pastDueSince: 0,
            cycle: 0,
            status: Status.Active
        });
        bytes32 paymentId = _recordSubscriptionPayment(subId, 0, plan, subscriber);

        // interactions
        // `subscriber` authorized this with the Subscribe signature verified in _checkSubscribe and the permit.
        // forge-lint: disable-next-line(arbitrary-send-erc20)
        usdt.safeTransferFrom(subscriber, address(this), plan.amount);
        emit Subscribed(subId, planId, subscriber);
        _payoutSubscription(paymentId, subId, subscriber, plan);
    }

    /// @dev Pays out a subscription charge already pulled into this contract and emits PaymentReceived.
    function _payoutSubscription(bytes32 paymentId, uint256 subId, address subscriber, Plan memory plan) internal {
        uint256 fee = _payout(merchants[plan.merchantId].payout, plan.amount);
        emit PaymentReceived(
            paymentId, plan.merchantId, bytes32(subId), subscriber, plan.amount, fee, KIND_SUBSCRIPTION, subId
        );
    }

    /// @dev refund() checks 1–3 and effects. Returns the refund sequence number and the payout wallet to pull from.
    function _recordRefund(bytes32 paymentId, uint256 amount) internal returns (uint32 seq, address payout) {
        Payment storage p = payments[paymentId];
        if (p.payer == address(0)) revert UnknownPayment();
        if (amount == 0) revert InvalidAmount();
        if (uint256(p.refunded) + amount > p.amount) revert RefundExceedsPayment();
        seq = refundCount[paymentId]++;
        p.refunded += amount.toUint128();
        payout = merchants[p.merchantId].payout;
    }

    function _sendRefund(bytes32 paymentId, uint32 seq, uint256 amount) internal {
        Payment storage p = payments[paymentId];
        usdt.safeTransfer(p.payer, amount);
        emit Refunded(paymentId, p.merchantId, seq, p.payer, amount, p.refunded);
    }

    /// @dev Pulls `amount` from `from` into this contract with an EIP-3009 authorization addressed to this contract.
    function _receive(
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) internal {
        usdt.receiveWithAuthorization(from, address(this), amount, validAfter, validBefore, nonce, signature);
    }

    function _payoutAndEmitCheckout(
        bytes32 paymentId,
        uint256 merchantId,
        bytes32 orderId,
        address payer,
        uint256 amount
    ) internal {
        uint256 fee = _payout(merchants[merchantId].payout, amount);
        emit PaymentReceived(paymentId, merchantId, orderId, payer, amount, fee, KIND_CHECKOUT, 0);
    }

    /// @dev Sends `amount` (already held by this contract) to the merchant, minus the protocol fee.
    function _payout(address payout, uint256 amount) internal returns (uint256 fee) {
        fee = amount * feeBps / 10_000;
        if (fee > 0) usdt.safeTransfer(feeRecipient, fee);
        usdt.safeTransfer(payout, amount - fee);
    }
}

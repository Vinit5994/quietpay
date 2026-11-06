// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {QuietPay} from "../src/QuietPay.sol";
import {ITetherV2} from "../src/interfaces/ITetherV2.sol";
import {MockTetherV2} from "./mocks/MockTetherV2.sol";
import {SigHelpers} from "./Base.t.sol";

/// @notice The 23 cases from SPEC_CONTRACTS "Tests", plus operators, permit front-running and
///         parity with the values pinned in packages/shared/test/eip712.test.ts.
contract QuietPayTest is SigHelpers {
    MockTetherV2 usdt;
    QuietPay qp;

    address owner = makeAddr("owner");
    address operator = makeAddr("operator");
    address operator2 = makeAddr("operator2");
    address feeRecipient = makeAddr("feeRecipient");
    address relayer = makeAddr("relayer"); // submits txs; never holds funds
    address sink = makeAddr("sink");

    uint256 payoutPk = 0xA11CE;
    uint256 signerPk = 0xB0B;
    uint256 payerPk = 0xC0FFEE;
    uint256 subscriberPk = 0xD00D;
    address payout;
    address signer;
    address payer;
    address subscriber;

    uint256 merchantId;
    uint256 planId;

    uint256 constant T0 = 1_800_000_000;
    uint256 constant AMOUNT = 25e6; // 25.00 USDT
    uint128 constant PLAN_AMOUNT = 15e6;
    uint32 constant PERIOD = 120;
    uint32 constant GRACE = 60;

    function setUp() public {
        vm.warp(T0);
        payout = vm.addr(payoutPk);
        signer = vm.addr(signerPk);
        payer = vm.addr(payerPk);
        subscriber = vm.addr(subscriberPk);

        usdt = new MockTetherV2();
        qp = new QuietPay(address(usdt), owner);
        vm.prank(owner);
        qp.setOperator(operator, true);

        vm.startPrank(operator);
        merchantId = qp.registerMerchant(payout, signer);
        planId = qp.createPlan(merchantId, PLAN_AMOUNT, PERIOD, GRACE);
        vm.stopPrank();

        usdt.mint(payer, 100e6);
        usdt.mint(subscriber, 100e6);
        usdt.mint(payout, 100e6); // the merchant needs funds to refund
    }

    // ------------------------------------------------------------------ helpers

    function _orderId(string memory sessionId) internal pure returns (bytes32) {
        return keccak256(bytes(sessionId));
    }

    function _pay(bytes32 orderId, uint256 amount) internal returns (bytes32) {
        uint256 exp = block.timestamp + 1800;
        bytes memory mSig = _signInvoice(qp, signerPk, merchantId, orderId, amount, exp);
        bytes memory pSig = _signReceive(
            ITetherV2(address(usdt)), payerPk, address(qp), amount, 0, exp, qp.paymentNonce(merchantId, orderId)
        );
        vm.prank(relayer);
        return qp.pay(merchantId, orderId, amount, exp, mSig, payer, 0, exp, pSig);
    }

    function _refund(bytes32 paymentId, uint256 amount) internal {
        (uint256 validBefore, bytes memory sig) = _refundSig(paymentId, amount);
        vm.prank(relayer);
        qp.refund(paymentId, amount, 0, validBefore, sig);
    }

    function _refundSig(bytes32 paymentId, uint256 amount)
        internal
        view
        returns (uint256 validBefore, bytes memory sig)
    {
        validBefore = block.timestamp + 600;
        bytes32 nonce = qp.refundNonce(paymentId, qp.refundCount(paymentId));
        sig = _signReceive(ITetherV2(address(usdt)), payoutPk, address(qp), amount, 0, validBefore, nonce);
    }

    function _subscribe() internal returns (uint256) {
        return _subscribeWith(subscriberPk, PLAN_AMOUNT);
    }

    function _subscribeWith(uint256 pk, uint256 maxAmount) internal returns (uint256) {
        uint256 deadline = block.timestamp + 600;
        uint256 permitValue = uint256(PLAN_AMOUNT) * 12;
        bytes memory sSig = _signSubscribe(qp, pk, planId, maxAmount, deadline);
        bytes memory pSig = _signPermit(ITetherV2(address(usdt)), pk, address(qp), permitValue, deadline);
        vm.prank(relayer);
        return qp.subscribe(planId, vm.addr(pk), maxAmount, deadline, sSig, permitValue, deadline, pSig);
    }

    function _status(uint256 subId) internal view returns (QuietPay.Status status) {
        (,,,,, status) = qp.subs(subId);
    }

    function _drain(address who) internal {
        uint256 bal = usdt.balanceOf(who);
        vm.prank(who);
        usdt.transfer(sink, bal);
    }

    // ------------------------------------------------------------------ 1–7 pay

    function test_01_pay_happyPath() public {
        bytes32 orderId = _orderId("sess_1");
        bytes32 expectedId = qp.checkoutPaymentId(merchantId, orderId);

        vm.expectEmit(address(qp));
        emit QuietPay.PaymentReceived(expectedId, merchantId, orderId, payer, AMOUNT, 0, 0, 0);
        bytes32 paymentId = _pay(orderId, AMOUNT);

        assertEq(paymentId, expectedId);
        assertEq(usdt.balanceOf(payout), 100e6 + AMOUNT);
        assertEq(usdt.balanceOf(payer), 100e6 - AMOUNT);
        assertEq(usdt.balanceOf(address(qp)), 0, "contract keeps nothing");
        assertEq(usdt.balanceOf(relayer), 0);
        assertTrue(qp.orderPaid(merchantId, orderId));

        (uint256 mId, bytes32 ref, address p, uint128 amount, uint128 refunded, uint64 paidAt, uint8 kind) =
            qp.payments(paymentId);
        assertEq(mId, merchantId);
        assertEq(ref, orderId);
        assertEq(p, payer);
        assertEq(amount, AMOUNT);
        assertEq(refunded, 0);
        assertEq(paidAt, T0);
        assertEq(kind, 0);
    }

    function test_02_pay_withFee() public {
        vm.prank(owner);
        qp.setFee(50, feeRecipient); // 0.5%
        _pay(_orderId("sess_fee"), AMOUNT);
        uint256 fee = AMOUNT * 50 / 10_000; // 0.125 USDT
        assertEq(usdt.balanceOf(feeRecipient), fee);
        assertEq(usdt.balanceOf(payout), 100e6 + AMOUNT - fee);
        assertEq(usdt.balanceOf(address(qp)), 0);
    }

    function test_03_pay_sameOrderTwice_reverts() public {
        bytes32 orderId = _orderId("sess_twice");
        _pay(orderId, AMOUNT);
        uint256 exp = block.timestamp + 1800;
        bytes memory mSig = _signInvoice(qp, signerPk, merchantId, orderId, AMOUNT, exp);
        vm.expectRevert(QuietPay.OrderAlreadyPaid.selector);
        qp.pay(merchantId, orderId, AMOUNT, exp, mSig, payer, 0, exp, "");
    }

    function test_04_pay_invoiceFromNonSigner_reverts() public {
        bytes32 orderId = _orderId("sess_forged");
        uint256 exp = block.timestamp + 1800;
        bytes memory mSig = _signInvoice(qp, payerPk, merchantId, orderId, AMOUNT, exp); // wrong key
        bytes memory pSig = _signReceive(
            ITetherV2(address(usdt)), payerPk, address(qp), AMOUNT, 0, exp, qp.paymentNonce(merchantId, orderId)
        );
        vm.expectRevert(QuietPay.InvalidMerchantSignature.selector);
        qp.pay(merchantId, orderId, AMOUNT, exp, mSig, payer, 0, exp, pSig);
    }

    function test_05_pay_expiredInvoice_reverts() public {
        bytes32 orderId = _orderId("sess_old");
        uint256 exp = T0 + 1800;
        bytes memory mSig = _signInvoice(qp, signerPk, merchantId, orderId, AMOUNT, exp);
        bytes memory pSig = _signReceive(
            ITetherV2(address(usdt)), payerPk, address(qp), AMOUNT, 0, exp + 10, qp.paymentNonce(merchantId, orderId)
        );
        vm.warp(exp + 1);
        vm.expectRevert(QuietPay.InvoiceExpired.selector);
        qp.pay(merchantId, orderId, AMOUNT, exp, mSig, payer, 0, exp + 10, pSig);
    }

    function test_06_pay_payerSignedDifferentAmount_revertsInToken() public {
        bytes32 orderId = _orderId("sess_amount");
        uint256 exp = block.timestamp + 1800;
        bytes memory mSig = _signInvoice(qp, signerPk, merchantId, orderId, AMOUNT, exp);
        bytes memory pSig = _signReceive(
            ITetherV2(address(usdt)), payerPk, address(qp), 1e6, 0, exp, qp.paymentNonce(merchantId, orderId)
        ); // payer agreed to 1.00 only
        vm.expectRevert(MockTetherV2.InvalidAuthorizationSignature.selector);
        qp.pay(merchantId, orderId, AMOUNT, exp, mSig, payer, 0, exp, pSig);
    }

    function test_07_pay_payerSigReplayedForOtherOrder_revertsInToken() public {
        bytes32 orderA = _orderId("sess_A");
        bytes32 orderB = _orderId("sess_B");
        uint256 exp = block.timestamp + 1800;
        bytes memory pSigA = _signReceive(
            ITetherV2(address(usdt)), payerPk, address(qp), AMOUNT, 0, exp, qp.paymentNonce(merchantId, orderA)
        );
        bytes memory mSigB = _signInvoice(qp, signerPk, merchantId, orderB, AMOUNT, exp);
        vm.expectRevert(MockTetherV2.InvalidAuthorizationSignature.selector);
        qp.pay(merchantId, orderB, AMOUNT, exp, mSigB, payer, 0, exp, pSigA);
    }

    // ------------------------------------------------------------------ 8–10 refunds

    function test_08_partialRefunds_capped() public {
        bytes32 paymentId = _pay(_orderId("sess_refund"), AMOUNT);
        _refund(paymentId, 8e6);
        _refund(paymentId, 17e6);
        assertEq(qp.refundCount(paymentId), 2);

        (uint256 validBefore, bytes memory sig) = _refundSig(paymentId, 1e6);
        vm.expectRevert(QuietPay.RefundExceedsPayment.selector);
        qp.refund(paymentId, 1e6, 0, validBefore, sig);
    }

    function test_09_refund_goesToOriginalPayer() public {
        bytes32 paymentId = _pay(_orderId("sess_back"), AMOUNT);
        vm.expectEmit(address(qp));
        emit QuietPay.Refunded(paymentId, merchantId, 0, payer, AMOUNT, AMOUNT);
        _refund(paymentId, AMOUNT);
        assertEq(usdt.balanceOf(payer), 100e6, "payer fully restored");
        assertEq(usdt.balanceOf(payout), 100e6);
        assertEq(usdt.balanceOf(relayer), 0);
        assertEq(usdt.balanceOf(address(qp)), 0);
    }

    function test_10_refund_worksWhilePaused() public {
        bytes32 paymentId = _pay(_orderId("sess_paused"), AMOUNT);
        vm.prank(owner);
        qp.pause();
        _refund(paymentId, 5e6);
        (,,,, uint128 refunded,,) = qp.payments(paymentId);
        assertEq(refunded, 5e6);
    }

    // ------------------------------------------------------------------ 11–13 subscribe

    function test_11_subscribe_happyPath() public {
        vm.expectEmit(address(qp));
        emit QuietPay.Subscribed(1, planId, subscriber);
        uint256 subId = _subscribe();

        (uint256 pId, address s, uint64 nextChargeAt, uint64 pastDueSince, uint32 cycle, QuietPay.Status status) =
            qp.subs(subId);
        assertEq(pId, planId);
        assertEq(s, subscriber);
        assertEq(nextChargeAt, T0 + PERIOD);
        assertEq(pastDueSince, 0);
        assertEq(cycle, 0);
        assertEq(uint8(status), uint8(QuietPay.Status.Active));

        assertEq(usdt.balanceOf(subscriber), 100e6 - PLAN_AMOUNT, "first period charged now");
        assertEq(usdt.balanceOf(payout), 100e6 + PLAN_AMOUNT);
        assertEq(usdt.allowance(subscriber, address(qp)), uint256(PLAN_AMOUNT) * 11);

        (,,, uint128 amount,,, uint8 kind) = qp.payments(qp.subscriptionPaymentId(subId, 0));
        assertEq(amount, PLAN_AMOUNT);
        assertEq(kind, 1);
    }

    function test_12_subscribe_wrongSubscriberSig_reverts() public {
        uint256 deadline = block.timestamp + 600;
        uint256 permitValue = uint256(PLAN_AMOUNT) * 12;
        bytes memory sSig = _signSubscribe(qp, payerPk, planId, PLAN_AMOUNT, deadline); // payer signs for subscriber
        bytes memory pSig = _signPermit(ITetherV2(address(usdt)), subscriberPk, address(qp), permitValue, deadline);
        vm.expectRevert(QuietPay.InvalidSubscriberSignature.selector);
        qp.subscribe(planId, subscriber, PLAN_AMOUNT, deadline, sSig, permitValue, deadline, pSig);
    }

    function test_13_subscribe_planAboveMax_reverts() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory sSig = _signSubscribe(qp, subscriberPk, planId, PLAN_AMOUNT - 1, deadline);
        vm.expectRevert(QuietPay.PlanAboveMax.selector);
        qp.subscribe(planId, subscriber, PLAN_AMOUNT - 1, deadline, sSig, 0, deadline, "");
    }

    // ------------------------------------------------------------------ 14–20 charge / cancel

    function test_14_charge_beforeDue_reverts() public {
        uint256 subId = _subscribe();
        vm.warp(T0 + PERIOD - 1);
        vm.expectRevert(QuietPay.NotDue.selector);
        qp.charge(subId);
    }

    function test_15_charge_whenFunded_renews() public {
        uint256 subId = _subscribe();
        vm.warp(T0 + PERIOD);
        vm.expectEmit(address(qp));
        emit QuietPay.Renewed(subId, 1, qp.subscriptionPaymentId(subId, 1), PLAN_AMOUNT);
        vm.prank(relayer);
        qp.charge(subId);

        (,, uint64 nextChargeAt,, uint32 cycle, QuietPay.Status status) = qp.subs(subId);
        assertEq(cycle, 1);
        assertEq(nextChargeAt, T0 + 2 * PERIOD);
        assertEq(uint8(status), uint8(QuietPay.Status.Active));
        assertEq(usdt.balanceOf(subscriber), 100e6 - 2 * uint256(PLAN_AMOUNT));
        assertEq(usdt.balanceOf(payout), 100e6 + 2 * uint256(PLAN_AMOUNT));
    }

    function test_16_charge_lowBalance_pastDue_noRevert() public {
        uint256 subId = _subscribe();
        _drain(subscriber);
        vm.warp(T0 + PERIOD);
        vm.expectEmit(address(qp));
        emit QuietPay.RenewalFailed(subId, 1);
        qp.charge(subId); // does not revert

        (,,, uint64 pastDueSince, uint32 cycle, QuietPay.Status status) = qp.subs(subId);
        assertEq(uint8(status), uint8(QuietPay.Status.PastDue));
        assertEq(pastDueSince, T0 + PERIOD);
        assertEq(cycle, 0);
    }

    function test_17_charge_againInGrace_stillPastDue() public {
        uint256 subId = _subscribe();
        _drain(subscriber);
        vm.warp(T0 + PERIOD);
        qp.charge(subId);
        vm.warp(T0 + PERIOD + GRACE - 1);
        vm.expectEmit(address(qp));
        emit QuietPay.RenewalFailed(subId, 1);
        qp.charge(subId);

        (,,, uint64 pastDueSince,, QuietPay.Status status) = qp.subs(subId);
        assertEq(uint8(status), uint8(QuietPay.Status.PastDue));
        assertEq(pastDueSince, T0 + PERIOD, "pastDueSince keeps the first failure");
    }

    function test_18_topUpDuringGrace_backToActive() public {
        uint256 subId = _subscribe();
        _drain(subscriber);
        vm.warp(T0 + PERIOD);
        qp.charge(subId);

        usdt.mint(subscriber, PLAN_AMOUNT);
        vm.warp(T0 + PERIOD + 30);
        qp.charge(subId);

        (,, uint64 nextChargeAt, uint64 pastDueSince, uint32 cycle, QuietPay.Status status) = qp.subs(subId);
        assertEq(uint8(status), uint8(QuietPay.Status.Active));
        assertEq(pastDueSince, 0);
        assertEq(cycle, 1);
        assertEq(nextChargeAt, T0 + 2 * PERIOD, "schedule keeps its cadence");
    }

    function test_19_lowBalanceAfterGrace_canceled() public {
        uint256 subId = _subscribe();
        _drain(subscriber);
        vm.warp(T0 + PERIOD);
        qp.charge(subId);
        vm.warp(T0 + PERIOD + GRACE);
        vm.expectEmit(address(qp));
        emit QuietPay.SubscriptionCanceled(subId, 1);
        qp.charge(subId);
        assertEq(uint8(_status(subId)), uint8(QuietPay.Status.Canceled));

        vm.expectRevert(QuietPay.NotChargeable.selector);
        qp.charge(subId);
    }

    function test_20_customerCancel_thenCharge_reverts() public {
        uint256 subId = _subscribe();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _signCancel(qp, subscriberPk, subId, deadline);
        vm.expectEmit(address(qp));
        emit QuietPay.SubscriptionCanceled(subId, 0);
        vm.prank(relayer);
        qp.cancel(subId, deadline, sig);
        assertEq(uint8(_status(subId)), uint8(QuietPay.Status.Canceled));

        vm.warp(T0 + PERIOD);
        vm.expectRevert(QuietPay.NotChargeable.selector);
        qp.charge(subId);
    }

    // ------------------------------------------------------------------ 21–23

    function test_21_refundSubscriptionCharge_capped() public {
        uint256 subId = _subscribe();
        bytes32 paymentId = qp.subscriptionPaymentId(subId, 0);
        _refund(paymentId, 10e6);
        _refund(paymentId, 5e6);
        assertEq(usdt.balanceOf(subscriber), 100e6, "subscriber restored");

        (uint256 validBefore, bytes memory sig) = _refundSig(paymentId, 1);
        vm.expectRevert(QuietPay.RefundExceedsPayment.selector);
        qp.refund(paymentId, 1, 0, validBefore, sig);
    }

    function test_22_nonOperatorRegisters_reverts() public {
        vm.expectRevert(QuietPay.NotOperator.selector);
        vm.prank(relayer);
        qp.registerMerchant(payout, signer);
    }

    function test_23_pauseBlocksPaySubscribeCharge() public {
        uint256 subId = _subscribe();
        vm.prank(owner);
        qp.pause();

        bytes32 orderId = _orderId("sess_p");
        uint256 exp = block.timestamp + 1800;
        bytes memory mSig = _signInvoice(qp, signerPk, merchantId, orderId, AMOUNT, exp);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        qp.pay(merchantId, orderId, AMOUNT, exp, mSig, payer, 0, exp, "");

        vm.expectRevert(Pausable.EnforcedPause.selector);
        qp.subscribe(planId, payer, PLAN_AMOUNT, exp, "", 0, exp, "");

        vm.warp(T0 + PERIOD);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        qp.charge(subId);
    }

    // ------------------------------------------------------------------ extras

    function test_twoOperatorsCanBothRegisterMerchants() public {
        vm.prank(owner);
        qp.setOperator(operator2, true);

        vm.prank(operator);
        uint256 a = qp.registerMerchant(makeAddr("payoutA"), makeAddr("signerA"));
        vm.prank(operator2);
        uint256 b = qp.registerMerchant(makeAddr("payoutB"), makeAddr("signerB"));
        assertEq(b, a + 1);

        vm.prank(owner);
        qp.setOperator(operator2, false);
        vm.prank(operator2);
        vm.expectRevert(QuietPay.NotOperator.selector);
        qp.registerMerchant(payout, signer);
    }

    function test_subscribe_toleratesFrontRunPermit() public {
        uint256 deadline = block.timestamp + 600;
        uint256 permitValue = uint256(PLAN_AMOUNT) * 12;
        bytes memory sSig = _signSubscribe(qp, subscriberPk, planId, PLAN_AMOUNT, deadline);
        bytes memory pSig = _signPermit(ITetherV2(address(usdt)), subscriberPk, address(qp), permitValue, deadline);

        // someone submits the permit first; its nonce is now used
        usdt.permit(subscriber, address(qp), permitValue, deadline, pSig);

        uint256 subId = qp.subscribe(planId, subscriber, PLAN_AMOUNT, deadline, sSig, permitValue, deadline, pSig);
        assertEq(uint8(_status(subId)), uint8(QuietPay.Status.Active));
    }

    function test_subscribe_noAllowance_reverts() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory sSig = _signSubscribe(qp, subscriberPk, planId, PLAN_AMOUNT, deadline);
        vm.expectRevert(QuietPay.InsufficientAllowance.selector);
        qp.subscribe(planId, subscriber, PLAN_AMOUNT, deadline, sSig, 0, deadline, "");
    }

    function test_subscribeSignature_cannotBeReplayed() public {
        uint256 deadline = block.timestamp + 600;
        uint256 permitValue = uint256(PLAN_AMOUNT) * 12;
        bytes memory sSig = _signSubscribe(qp, subscriberPk, planId, PLAN_AMOUNT, deadline);
        bytes memory pSig = _signPermit(ITetherV2(address(usdt)), subscriberPk, address(qp), permitValue, deadline);
        qp.subscribe(planId, subscriber, PLAN_AMOUNT, deadline, sSig, permitValue, deadline, pSig);

        vm.expectRevert(QuietPay.InvalidSubscriberSignature.selector);
        qp.subscribe(planId, subscriber, PLAN_AMOUNT, deadline, sSig, permitValue, deadline, pSig);
    }

    function test_merchantCancel_operatorOnly() public {
        uint256 subId = _subscribe();
        vm.expectRevert(QuietPay.NotOperator.selector);
        qp.cancelByMerchant(subId);

        vm.expectEmit(address(qp));
        emit QuietPay.SubscriptionCanceled(subId, 2);
        vm.prank(operator);
        qp.cancelByMerchant(subId);
    }

    function test_refund_payoutSigForWrongSeq_reverts() public {
        bytes32 paymentId = _pay(_orderId("sess_seq"), AMOUNT);
        (uint256 validBefore, bytes memory sig0) = _refundSig(paymentId, 5e6);
        _refund(paymentId, 5e6); // uses seq 0

        // replaying the seq-0 signature for the next refund fails: the contract now expects seq 1
        vm.expectRevert(MockTetherV2.InvalidAuthorizationSignature.selector);
        qp.refund(paymentId, 5e6, 0, validBefore, sig0);
    }

    function test_setFee_cappedAt1Percent() public {
        vm.startPrank(owner);
        vm.expectRevert(QuietPay.FeeTooHigh.selector);
        qp.setFee(101, feeRecipient);
        vm.expectRevert(QuietPay.ZeroAddress.selector);
        qp.setFee(50, address(0));
        qp.setFee(100, feeRecipient);
        vm.stopPrank();
    }

    function test_inactiveMerchant_cannotBePaid() public {
        vm.prank(operator);
        qp.updateMerchant(merchantId, payout, signer, false);
        bytes32 orderId = _orderId("sess_off");
        uint256 exp = block.timestamp + 1800;
        bytes memory mSig = _signInvoice(qp, signerPk, merchantId, orderId, AMOUNT, exp);
        vm.expectRevert(QuietPay.MerchantInactive.selector);
        qp.pay(merchantId, orderId, AMOUNT, exp, mSig, payer, 0, exp, "");
    }

    /// @dev Same inputs and expected values as packages/shared/test/eip712.test.ts ("pinned values").
    function test_derivedIds_matchSharedPackage() public {
        address at = 0x1111111111111111111111111111111111111111;
        deployCodeTo("QuietPay.sol:QuietPay", abi.encode(address(usdt), owner), at);
        QuietPay pinned = QuietPay(at);

        bytes32 orderId = keccak256(bytes("sess_test123"));
        assertEq(orderId, 0x04f695227a6e0702ebb5e23afb6d6f73af4dd0fd6b988bf07caacfeab8b05e11);
        assertEq(pinned.paymentNonce(7, orderId), 0x41e548384ace9b0b32ee3c4e5bf6cd90f16a58174afdc5f60eddcdcaa9d6003d);
        bytes32 paymentId = pinned.checkoutPaymentId(7, orderId);
        assertEq(paymentId, 0xea535357cccc1394d00c99250163a0124d42b8d9362eaa5fca6ae21a9cc3d398);
        assertEq(pinned.subscriptionPaymentId(3, 2), 0xfb9717a01f491dc09018707005e5d9d6aa6c952fefc8a0754629f41a02f407bf);
        assertEq(pinned.refundNonce(paymentId, 1), 0x06f04f30beaa5a8b4cfaf8fb3ffdbdf3f0c09d37eb5245e7741d980561b7b218);
    }
}

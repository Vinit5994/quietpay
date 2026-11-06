import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex, type TypedDataDomain } from "viem";
import { USDT_ADDRESS, WHITECHAIN_SEPOLIA_CHAIN_ID } from "./chain";

// ---------------------------------------------------------------- domains

export type Eip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

/** QuietPay contract domain (Invoice, Subscribe, CancelSubscription). */
export function quietPayDomain(quietPay: Address, chainId = WHITECHAIN_SEPOLIA_CHAIN_ID): Eip712Domain {
  return { name: "QuietPay", version: "1", chainId, verifyingContract: quietPay };
}

/** USDT (TetherTokenV2) domain (ReceiveWithAuthorization, Permit). */
export function usdtDomain(usdt: Address = USDT_ADDRESS, chainId = WHITECHAIN_SEPOLIA_CHAIN_ID): Eip712Domain {
  return { name: "Tether USD", version: "1", chainId, verifyingContract: usdt };
}

/** EIP-712 domain separator, as returned by a contract's `DOMAIN_SEPARATOR()`. */
export function domainSeparator(domain: Eip712Domain | TypedDataDomain): Hex {
  const typeHash = keccak256(
    toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [
        typeHash,
        keccak256(toBytes(domain.name!)),
        keccak256(toBytes(domain.version!)),
        BigInt(domain.chainId!),
        domain.verifyingContract!,
      ],
    ),
  );
}

// ---------------------------------------------------------------- types (must match SPEC_CONTRACTS exactly)

export const invoiceTypes = {
  Invoice: [
    { name: "merchantId", type: "uint256" },
    { name: "orderId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export const subscribeTypes = {
  Subscribe: [
    { name: "planId", type: "uint256" },
    { name: "subscriber", type: "address" },
    { name: "maxAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const cancelSubscriptionTypes = {
  CancelSubscription: [
    { name: "subId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// ---------------------------------------------------------------- messages

export type InvoiceMessage = { merchantId: bigint; orderId: Hex; amount: bigint; expiresAt: bigint };
export type SubscribeMessage = {
  planId: bigint;
  subscriber: Address;
  maxAmount: bigint;
  nonce: bigint;
  deadline: bigint;
};
export type CancelSubscriptionMessage = { subId: bigint; nonce: bigint; deadline: bigint };
export type ReceiveWithAuthorizationMessage = {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};
export type PermitMessage = { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint };

// ---------------------------------------------------------------- typed-data builders (viem-ready, bigint values)

export function invoiceTypedData(quietPay: Address, message: InvoiceMessage) {
  return { domain: quietPayDomain(quietPay), types: invoiceTypes, primaryType: "Invoice", message } as const;
}

export function subscribeTypedData(quietPay: Address, message: SubscribeMessage) {
  return { domain: quietPayDomain(quietPay), types: subscribeTypes, primaryType: "Subscribe", message } as const;
}

export function cancelSubscriptionTypedData(quietPay: Address, message: CancelSubscriptionMessage) {
  return {
    domain: quietPayDomain(quietPay),
    types: cancelSubscriptionTypes,
    primaryType: "CancelSubscription",
    message,
  } as const;
}

export function receiveWithAuthorizationTypedData(message: ReceiveWithAuthorizationMessage, usdt: Address = USDT_ADDRESS) {
  return {
    domain: usdtDomain(usdt),
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization",
    message,
  } as const;
}

export function permitTypedData(message: PermitMessage, usdt: Address = USDT_ADDRESS) {
  return { domain: usdtDomain(usdt), types: permitTypes, primaryType: "Permit", message } as const;
}

/**
 * Typed data as sent over HTTP: every bigint becomes a decimal string.
 * viem / Privy `signTypedData` accept these strings for uint fields.
 */
export function toJsonTypedData<T extends { message: Record<string, unknown> }>(
  typedData: T,
): Omit<T, "message"> & { message: { [K in keyof T["message"]]: T["message"][K] extends bigint ? string : T["message"][K] } } {
  const message = Object.fromEntries(
    Object.entries(typedData.message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
  );
  return { ...typedData, message } as never;
}

// ---------------------------------------------------------------- derived IDs and nonces (SPEC_CONTRACTS)

/** `orderId` for a checkout session: keccak256(utf8(sessionId)). */
export function orderIdFromSessionId(sessionId: string): Hex {
  return keccak256(toBytes(sessionId));
}

/** EIP-3009 nonce for a checkout payment: keccak256(abi.encode(quietPay, merchantId, orderId)). */
export function paymentNonce(quietPay: Address, merchantId: bigint, orderId: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes32" }], [quietPay, merchantId, orderId]),
  );
}

/** Checkout paymentId: keccak256(abi.encode(merchantId, orderId)). */
export function checkoutPaymentId(merchantId: bigint, orderId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [merchantId, orderId]));
}

/** Subscription charge paymentId: keccak256(abi.encode("sub", subId, cycle)). */
export function subscriptionPaymentId(subId: bigint, cycle: number | bigint): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "uint32" }], ["sub", subId, Number(cycle)]),
  );
}

/** EIP-3009 nonce for a refund: keccak256(abi.encode(quietPay, "refund", paymentId, seq)). */
export function refundNonce(quietPay: Address, paymentId: Hex, seq: number | bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "string" }, { type: "bytes32" }, { type: "uint32" }],
      [quietPay, "refund", paymentId, Number(seq)],
    ),
  );
}

/** `ref` for a subscription charge in `PaymentReceived`: bytes32(subId). */
export function subscriptionRef(subId: bigint): Hex {
  return `0x${subId.toString(16).padStart(64, "0")}`;
}

/** API payment id: "pay_" + paymentId hex (without 0x). */
export function apiPaymentId(paymentId: Hex): string {
  return `pay_${paymentId.slice(2)}`;
}

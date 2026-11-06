import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import { USDT_ADDRESS, WHITECHAIN_SEPOLIA_ID } from "./chain";
import type { TypedDataPayload } from "./api-types";

// ── Domains ────────────────────────────────────────────────────────────────

export const QUIETPAY_EIP712 = { name: "QuietPay", version: "1" } as const;
export const USDT_EIP712 = { name: "Tether USD", version: "1" } as const;

/** On-chain USDT DOMAIN_SEPARATOR() on Whitechain Sepolia, for sanity checks. */
export const USDT_DOMAIN_SEPARATOR =
  "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25" as const;

export function quietPayDomain(verifyingContract: Address) {
  return { ...QUIETPAY_EIP712, chainId: WHITECHAIN_SEPOLIA_ID, verifyingContract } as const;
}

export function usdtDomain() {
  return { ...USDT_EIP712, chainId: WHITECHAIN_SEPOLIA_ID, verifyingContract: USDT_ADDRESS } as const;
}

// ── Types ──────────────────────────────────────────────────────────────────

export const quietPayTypes = {
  Invoice: [
    { name: "merchantId", type: "uint256" },
    { name: "orderId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
  Subscribe: [
    { name: "planId", type: "uint256" },
    { name: "subscriber", type: "address" },
    { name: "maxAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  CancelSubscription: [
    { name: "subId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const usdtTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// ── Derived IDs and nonces (must match docs/SPEC_CONTRACTS.md) ─────────────

/** On-chain orderId for a checkout session. */
export function orderIdFromSessionId(sessionId: string): Hex {
  return keccak256(toBytes(sessionId));
}

/** EIP-3009 nonce for a checkout payment: keccak256(abi.encode(quietPay, merchantId, orderId)). */
export function paymentNonce(quietPay: Address, merchantId: bigint, orderId: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [quietPay, merchantId, orderId],
    ),
  );
}

/** keccak256(abi.encode(merchantId, orderId)) */
export function checkoutPaymentId(merchantId: bigint, orderId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [merchantId, orderId]));
}

/** keccak256(abi.encode("sub", subId, cycle)) */
export function subscriptionPaymentId(subId: bigint, cycle: number): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "uint32" }], ["sub", subId, cycle]),
  );
}

/** keccak256(abi.encode(quietPay, "refund", paymentId, seq)) */
export function refundNonce(quietPay: Address, paymentId: Hex, seq: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "string" }, { type: "bytes32" }, { type: "uint32" }],
      [quietPay, "refund", paymentId, seq],
    ),
  );
}

// ── Wire format helpers ────────────────────────────────────────────────────

/**
 * Typed data travels over JSON with uint values as decimal strings.
 * Convert it back into the shape viem's signTypedData / verifyTypedData expect.
 */
export function toSignableTypedData(payload: TypedDataPayload) {
  const fields = payload.types[payload.primaryType] ?? [];
  const message: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload.message)) {
    const field = fields.find((f) => f.name === key);
    const isInt = field && /^u?int\d*$/.test(field.type);
    message[key] = isInt ? BigInt(value as string | number) : value;
  }
  return {
    domain: {
      ...payload.domain,
      verifyingContract: payload.domain.verifyingContract as Address,
    },
    types: payload.types as Record<string, { name: string; type: string }[]>,
    primaryType: payload.primaryType,
    message,
  };
}

/** Opposite of toSignableTypedData: bigint → decimal string, for sending typed data as JSON. */
export function toTypedDataPayload(input: {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}): TypedDataPayload {
  const message: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.message)) message[k] = typeof v === "bigint" ? v.toString() : String(v);
  const types: Record<string, { name: string; type: string }[]> = {};
  for (const [k, v] of Object.entries(input.types)) types[k] = v.map((f) => ({ name: f.name, type: f.type }));
  return { domain: { ...input.domain }, types, primaryType: input.primaryType, message };
}

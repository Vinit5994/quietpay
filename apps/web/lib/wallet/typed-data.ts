import type {
  CancelSubscriptionTypedData,
  PermitTypedData,
  ReceiveWithAuthorizationTypedData,
  SubscribeTypedData,
} from "@quietpay/shared";

/** Any EIP-712 payload the API asks the customer or merchant to sign (uint values as decimal strings). */
export type TypedDataJson = ReceiveWithAuthorizationTypedData | PermitTypedData | SubscribeTypedData | CancelSubscriptionTypedData;

/** Convert decimal-string uints to bigint, the shape viem's signTypedData expects. */
export function toSignable(payload: TypedDataJson) {
  const fields = payload.types[payload.primaryType] ?? [];
  const message: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload.message)) {
    const field = fields.find((f) => f.name === key);
    message[key] = field && /^u?int\d*$/.test(field.type) ? BigInt(value as string) : value;
  }
  return { domain: payload.domain, types: payload.types, primaryType: payload.primaryType, message };
}

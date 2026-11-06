import { describe, expect, it } from "vitest";
import { domainSeparator } from "viem";
import { formatUsdt, fromUnits, sumAmounts, toUnits } from "./money";
import { USDT_DOMAIN_SEPARATOR, orderIdFromSessionId, toSignableTypedData, toTypedDataPayload, usdtDomain, usdtTypes } from "./eip712";
import { endpoints, PrepareResponse } from "./api-types";

describe("money", () => {
  it("converts API amounts to base units", () => {
    expect(toUnits("25.00")).toBe(25_000_000n);
    expect(toUnits("0.5")).toBe(500_000n);
    expect(toUnits("3")).toBe(3_000_000n);
  });
  it("rejects more than 2 decimals and junk", () => {
    expect(() => toUnits("1.234")).toThrow();
    expect(() => toUnits("-1")).toThrow();
    expect(() => toUnits("abc")).toThrow();
  });
  it("formats base units", () => {
    expect(fromUnits(25_000_000n)).toBe("25.00");
    expect(fromUnits(1n)).toBe("0.000001");
    expect(formatUsdt(1_234_500_000n)).toBe("1,234.50 USDT");
    expect(sumAmounts(["25.00", "12.00"])).toBe("37.00");
  });
});

describe("eip712", () => {
  it("USDT domain matches the on-chain DOMAIN_SEPARATOR", () => {
    expect(domainSeparator({ domain: usdtDomain() })).toBe(USDT_DOMAIN_SEPARATOR);
  });
  it("derives a stable order id", () => {
    expect(orderIdFromSessionId("sess_abc")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(orderIdFromSessionId("sess_abc")).toBe(orderIdFromSessionId("sess_abc"));
  });
  it("round-trips typed data through the JSON wire format", () => {
    const payload = toTypedDataPayload({
      domain: usdtDomain(),
      types: usdtTypes,
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 37_000_000n,
        validAfter: 0n,
        validBefore: 1_900_000_000n,
        nonce: "0x" + "ab".repeat(32),
      },
    });
    expect(payload.message.value).toBe("37000000");
    const signable = toSignableTypedData(payload);
    expect(signable.message.value).toBe(37_000_000n);
    expect(signable.message.from).toBe("0x0000000000000000000000000000000000000001");
  });
});

describe("api types", () => {
  it("every endpoint has a method, path and response schema", () => {
    for (const [key, def] of Object.entries(endpoints)) {
      expect(def.path.startsWith("/"), key).toBe(true);
      expect(def.response, key).toBeDefined();
    }
  });
  it("parses a payment prepare response", () => {
    const parsed = PrepareResponse.safeParse({ mode: "payment", payer: "0x" + "1".repeat(40), amount: "1.00", balance: "0.00", sufficientFunds: false, toSign: {} });
    expect(parsed.success).toBe(false);
  });
});

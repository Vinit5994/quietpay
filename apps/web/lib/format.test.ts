import { describe, expect, it } from "vitest";
import { intervalLabel, shortAddress, timeAgo, usdt } from "./format";

describe("format", () => {
  it("usdt groups thousands and keeps sub-cent precision", () => {
    expect(usdt("1234.5")).toBe("1,234.50 USDT");
    expect(usdt("25.00")).toBe("25.00 USDT");
    expect(usdt("0.005")).toBe("0.005 USDT");
    expect(usdt("324000.00", { symbol: false })).toBe("324,000.00");
  });
  it("timeAgo", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(timeAgo("2026-11-06T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-11-06T11:57:00Z", now)).toBe("3 min ago");
    expect(timeAgo("2026-11-06T09:00:00Z", now)).toBe("3 h ago");
  });
  it("intervalLabel and shortAddress", () => {
    expect(intervalLabel(120)).toBe("every 2 minutes (demo)");
    expect(intervalLabel(2_592_000)).toBe("every month");
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});

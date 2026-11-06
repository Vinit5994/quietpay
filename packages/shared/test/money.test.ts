import { describe, expect, it } from "vitest";
import { formatUsdt, fromUnits, toUnits, toUnitsLoose } from "../src/money";

describe("toUnits", () => {
  it("parses decimal strings into 6-decimal base units", () => {
    expect(toUnits("25.00")).toBe(25_000_000n);
    expect(toUnits("25")).toBe(25_000_000n);
    expect(toUnits("0.5")).toBe(500_000n);
    expect(toUnits("0.01")).toBe(10_000n);
    expect(toUnits("1234567.89")).toBe(1_234_567_890_000n);
  });

  it("rejects more than 2 decimals and junk", () => {
    for (const bad of ["1.001", "-1.00", "1e6", "", ".5", "1.", "abc", "1,00", "0x10"]) {
      expect(() => toUnits(bad), bad).toThrow();
    }
  });
});

describe("fromUnits", () => {
  it("formats with at least 2 decimals", () => {
    expect(fromUnits(25_000_000n)).toBe("25.00");
    expect(fromUnits(500_000n)).toBe("0.50");
    expect(fromUnits(0n)).toBe("0.00");
    expect(fromUnits(1_234_567_890_000n)).toBe("1234567.89");
  });

  it("keeps sub-cent precision", () => {
    expect(fromUnits(5_000n)).toBe("0.005");
    expect(fromUnits(1n)).toBe("0.000001");
    expect(fromUnits(-125_000n)).toBe("-0.125");
  });

  it("round-trips", () => {
    for (const s of ["0.00", "0.01", "3.00", "37.50", "180.00"]) expect(fromUnits(toUnits(s))).toBe(s);
  });
});

describe("formatUsdt", () => {
  it("formats units and strings", () => {
    expect(formatUsdt(37_000_000n)).toBe("37.00 USDT");
    expect(formatUsdt("15")).toBe("15.00 USDT");
    expect(formatUsdt("0.005")).toBe("0.005 USDT");
  });

  it("toUnitsLoose accepts 6 decimals", () => {
    expect(toUnitsLoose("0.000001")).toBe(1n);
    expect(() => toUnitsLoose("0.0000001")).toThrow();
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createOrder, getOrder, setOrder } from "./orders";
import { formatUsdt, lineTotal, sumAmounts } from "./money";

beforeEach(() => {
  process.env.STORE_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), "store-")), "store.json");
});

describe("money", () => {
  it("adds and multiplies in cents", () => {
    expect(lineTotal("12.00", 3)).toBe("36.00");
    expect(sumAmounts(["25.00", "12.00", "0.10", "0.20"])).toBe("37.30");
    expect(formatUsdt("1234.5")).toBe("1,234.50 USDT");
  });
});

describe("orders", () => {
  it("prices the cart from the catalogue, not the client", () => {
    const order = createOrder([
      { productId: "builder-hoodie", size: "L", qty: 1 },
      { productId: "ship-it-tee", size: "M", qty: 2 },
    ]);
    expect(order.total).toBe("49.00");
    expect(order.lines[0]!.name).toBe("Builder Hoodie (L)");
    expect(getOrder(order.id)?.status).toBe("pending");
  });

  it("rejects a missing size, unknown products and the subscription product", () => {
    expect(() => createOrder([{ productId: "builder-hoodie", size: null, qty: 1 }])).toThrow(/size/);
    expect(() => createOrder([{ productId: "nope", size: null, qty: 1 }])).toThrow();
    expect(() => createOrder([{ productId: "builder-box", size: null, qty: 1 }])).toThrow();
    expect(() => createOrder([])).toThrow(/empty/);
  });

  it("updates an order", () => {
    const order = createOrder([{ productId: "sticker-pack", size: null, qty: 1 }]);
    setOrder(order.id, { status: "paid" });
    expect(getOrder(order.id)?.status).toBe("paid");
  });
});

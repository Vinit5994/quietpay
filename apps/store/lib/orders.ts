import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findProduct } from "./products";
import { lineTotal, sumAmounts } from "./money";

/**
 * The store's own tiny database (a JSON file). A real merchant keeps orders in its own system;
 * QuietPay only tells it what happened via webhooks.
 */

export type OrderStatus = "pending" | "paid" | "partially_refunded" | "refunded" | "expired";
export type BoxStatus = "pending" | "active" | "past_due" | "canceled";

export interface OrderLine {
  productId: string;
  name: string;
  size: string | null;
  unitPrice: string;
  qty: number;
  total: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  lines: OrderLine[];
  total: string;
  refunded: string;
  checkoutUrl: string | null;
  paymentId: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Box {
  id: string;
  status: BoxStatus;
  subscriptionId: string | null;
  checkoutUrl: string | null;
  nextChargeAt: string | null;
  cycle: number;
  createdAt: string;
  updatedAt: string;
}

interface Data {
  orders: Order[];
  boxes: Box[];
  /** webhook event ids already handled (idempotency) */
  handledEvents: string[];
}

export interface CartItemInput {
  productId: string;
  size: string | null;
  qty: number;
}

const file = () => process.env.STORE_DATA_FILE ?? path.join(process.cwd(), "data", "store.json");
const empty = (): Data => ({ orders: [], boxes: [], handledEvents: [] });

export function readData(): Data {
  try {
    return { ...empty(), ...(JSON.parse(readFileSync(file(), "utf8")) as Data) };
  } catch {
    return empty();
  }
}

function writeData(data: Data) {
  const f = file();
  mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, f); // atomic replace
}

/** Read, change, write. Fine for a single demo server process. */
export function update<T>(fn: (d: Data) => T): T {
  const data = readData();
  const result = fn(data);
  writeData(data);
  return result;
}

const newId = (prefix: string) => `${prefix}_${randomBytes(5).toString("hex")}`;
const now = () => new Date().toISOString();

/** Validate the cart against the catalogue (never trust client prices) and create a pending order. */
export function createOrder(items: CartItemInput[]): Order {
  if (items.length === 0) throw new Error("Your cart is empty.");
  const lines: OrderLine[] = items.map((item) => {
    const product = findProduct(item.productId);
    if (!product || product.subscription) throw new Error(`Unknown product ${item.productId}`);
    if (product.sizes && (!item.size || !product.sizes.includes(item.size))) throw new Error(`Pick a size for ${product.name}`);
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20) throw new Error("Quantity must be between 1 and 20");
    return {
      productId: product.id,
      name: product.sizes ? `${product.name} (${item.size})` : product.name,
      size: product.sizes ? item.size : null,
      unitPrice: product.price,
      qty: item.qty,
      total: lineTotal(product.price, item.qty),
    };
  });
  const order: Order = {
    id: newId("order"),
    status: "pending",
    lines,
    total: sumAmounts(lines.map((l) => l.total)),
    refunded: "0.00",
    checkoutUrl: null,
    paymentId: null,
    txHash: null,
    explorerUrl: null,
    createdAt: now(),
    updatedAt: now(),
  };
  update((d) => d.orders.unshift(order));
  return order;
}

export function getOrder(id: string): Order | undefined {
  return readData().orders.find((o) => o.id === id);
}

export function setOrder(id: string, patch: Partial<Omit<Order, "id">>): Order | undefined {
  return update((d) => {
    const o = d.orders.find((x) => x.id === id);
    if (o) Object.assign(o, patch, { updatedAt: now() });
    return o;
  });
}

export function listOrders(): Order[] {
  return readData().orders;
}

export function listBoxes(): Box[] {
  return readData().boxes;
}

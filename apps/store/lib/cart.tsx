"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { findProduct } from "./products";
import { lineTotal, sumAmounts } from "./money";

export interface CartItem {
  productId: string;
  size: string | null;
  qty: number;
}

const KEY = "swag-counter.cart.v1";

interface CartApi {
  items: CartItem[];
  ready: boolean;
  count: number;
  total: string;
  add(item: CartItem): void;
  setQty(productId: string, size: string | null, qty: number): void;
  remove(productId: string, size: string | null): void;
  clear(): void;
}

const CartContext = createContext<CartApi | null>(null);
const same = (a: CartItem, productId: string, size: string | null) => a.productId === productId && a.size === size;

/** Cart lives in this browser (localStorage). Prices are re-checked on the server at checkout. */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setItems((JSON.parse(raw) as CartItem[]).filter((i) => findProduct(i.productId)));
    } catch {
      /* storage blocked or corrupted: start empty */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, [items, ready]);

  const add = useCallback((item: CartItem) => {
    setItems((prev) => {
      const existing = prev.find((p) => same(p, item.productId, item.size));
      if (existing) return prev.map((p) => (p === existing ? { ...p, qty: Math.min(20, p.qty + item.qty) } : p));
      return [...prev, item];
    });
  }, []);
  const setQty = useCallback((productId: string, size: string | null, qty: number) => {
    setItems((prev) => prev.map((p) => (same(p, productId, size) ? { ...p, qty: Math.max(1, Math.min(20, qty)) } : p)));
  }, []);
  const remove = useCallback((productId: string, size: string | null) => {
    setItems((prev) => prev.filter((p) => !same(p, productId, size)));
  }, []);
  const clear = useCallback(() => setItems([]), []);

  const api = useMemo<CartApi>(() => {
    const totals = items.map((i) => lineTotal(findProduct(i.productId)!.price, i.qty));
    return {
      items,
      ready,
      count: items.reduce((n, i) => n + i.qty, 0),
      total: sumAmounts(totals),
      add,
      setQty,
      remove,
      clear,
    };
  }, [items, ready, add, setQty, remove, clear]);

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const c = useContext(CartContext);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}

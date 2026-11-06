"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart";

/** Empties the cart once an order exists for it. */
export function ClearCart() {
  const { clear, ready } = useCart();
  useEffect(() => {
    if (ready) clear();
  }, [ready, clear]);
  return null;
}

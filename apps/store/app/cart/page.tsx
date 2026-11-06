import type { Metadata } from "next";
import { CartView } from "./CartView";

export const metadata: Metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6">
      <h1 className="mb-10 text-4xl font-bold tracking-tight text-[var(--color-heading)]">Your cart</h1>
      <CartView />
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { CheckoutOverlay, useQuietPayCheckout } from "@/lib/quietpay-checkout";
import { subscribeToBox } from "./actions";

export function SubscribeButton({ label }: { label: string }) {
  const router = useRouter();
  // The box is created before checkout, so refresh the page if the shopper closes the window.
  const qp = useQuietPayCheckout({ onClosed: () => router.refresh() });
  const pending = qp.phase !== "idle";
  const error = qp.error;
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => qp.start(() => subscribeToBox())}
        className="h-14 w-full rounded-lg bg-[var(--color-primary)] px-8 text-lg font-semibold text-white transition hover:bg-[var(--color-primary-hover)] disabled:opacity-70 sm:w-auto"
      >
        {qp.phase === "preparing" ? "Starting checkout…" : qp.phase === "open" ? "Waiting for payment…" : label}
      </button>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
      <CheckoutOverlay phase={qp.phase} onFocus={qp.focus} onCancel={qp.cancel} />
    </div>
  );
}

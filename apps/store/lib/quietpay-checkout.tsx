"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Opens QuietPay's hosted checkout in a pop-up window over the store (Razorpay-style), and falls
 * back to a normal redirect on phones or when the browser blocks pop-ups.
 *
 * The checkout page tells us how it went with postMessage:
 *   { type: "quietpay:checkout", status: "completed" | "canceled", sessionId, redirectUrl }
 * We only accept messages from the checkout's own origin, and only navigate within this store.
 */

type CreateSession = () => Promise<{ url: string } | { error: string }>;
export type CheckoutPhase = "idle" | "preparing" | "open";

const POPUP_NAME = "quietpay-checkout";

function popupFeatures() {
  const w = 460;
  const h = 760;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  return `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
}

function sameStoreUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin ? u.href : null;
  } catch {
    return null;
  }
}

export function useQuietPayCheckout({ onClosed }: { onClosed?: () => void } = {}) {
  const [phase, setPhase] = useState<CheckoutPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  const checkoutOrigin = useRef<string | null>(null);
  const done = useRef(false);

  const reset = useCallback(() => {
    popup.current = null;
    checkoutOrigin.current = null;
    setPhase("idle");
  }, []);

  const start = useCallback((create: CreateSession) => {
    setError(null);
    done.current = false;
    setPhase("preparing");
    // Open the window inside the click handler, before any await, or browsers block it.
    const wantPopup = window.matchMedia("(min-width: 640px)").matches;
    const w = wantPopup ? window.open("", POPUP_NAME, popupFeatures()) : null;
    if (w) {
      w.document.title = "QuietPay checkout";
      w.document.body.style.cssText = "margin:0;display:grid;place-items:center;height:100vh;font:15px system-ui;color:#5e6b66;background:#f5f8f6";
      w.document.body.textContent = "Opening secure checkout…";
    }
    create()
      .then((res) => {
        if ("error" in res) {
          w?.close();
          setError(res.error);
          setPhase("idle");
          return;
        }
        if (!w || w.closed) {
          window.location.assign(res.url); // phones, or pop-up blocked
          return;
        }
        const target = new URL(res.url);
        target.searchParams.set("popup", "1"); // the checkout reports back and closes instead of redirecting
        checkoutOrigin.current = target.origin;
        popup.current = w;
        w.location.href = target.href;
        setPhase("open");
      })
      .catch(() => {
        w?.close();
        setError("We couldn't start the payment. Please try again in a moment.");
        setPhase("idle");
      });
  }, []);

  // Messages from the checkout window.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!checkoutOrigin.current || e.origin !== checkoutOrigin.current) return;
      const d = e.data as { type?: string; status?: string; redirectUrl?: unknown };
      if (d?.type !== "quietpay:checkout") return;
      if (d.status === "completed") {
        done.current = true;
        const next = sameStoreUrl(d.redirectUrl);
        if (next) window.location.assign(next);
        else window.location.reload();
      } else if (d.status === "canceled") {
        popup.current?.close();
        reset();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [reset]);

  // Notice when the shopper closes the window themselves.
  useEffect(() => {
    if (phase !== "open") return;
    const t = setInterval(() => {
      if (popup.current?.closed && !done.current) {
        reset();
        onClosed?.();
      }
    }, 600);
    return () => clearInterval(t);
  }, [phase, reset, onClosed]);

  const focus = useCallback(() => popup.current?.focus(), []);
  const cancel = useCallback(() => {
    popup.current?.close();
    reset();
  }, [reset]);

  return { phase, error, start, focus, cancel };
}

/** Dims the store while the QuietPay window is open. */
export function CheckoutOverlay({ phase, onFocus, onCancel }: { phase: CheckoutPhase; onFocus: () => void; onCancel: () => void }) {
  if (phase !== "open") return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/55 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="qp-overlay-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--color-primary)] border-r-transparent motion-reduce:animate-none" aria-hidden />
        <h2 id="qp-overlay-title" className="mt-4 text-lg font-bold text-[var(--color-heading)]">
          Finish paying in the QuietPay window
        </h2>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">Sign in with email, confirm the amount, and we&apos;ll bring you back here.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={onFocus} className="h-11 rounded-lg bg-[var(--color-primary)] font-semibold text-white hover:bg-[var(--color-primary-hover)]">
            Show the payment window
          </button>
          <button type="button" onClick={onCancel} className="h-10 rounded-lg text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-heading)]">
            Cancel payment
          </button>
        </div>
      </div>
    </div>
  );
}

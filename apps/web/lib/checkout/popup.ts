/**
 * Hosted checkout opened in a pop-up by a merchant's site (`?popup=1`). Instead of redirecting,
 * the checkout tells the opener how it went and closes itself:
 *   { type: "quietpay:checkout", status: "completed" | "canceled", sessionId, redirectUrl }
 * Messages only go to the merchant's own origin (from the session's success URL).
 */

export type PopupStatus = "completed" | "canceled";

export function inCheckoutPopup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("popup") === "1" && Boolean(window.opener) && !window.opener.closed;
  } catch {
    return false;
  }
}

export function notifyOpener(status: PopupStatus, session: { id: string; successUrl: string }, redirectUrl?: string | null): boolean {
  if (!inCheckoutPopup()) return false;
  try {
    const target = new URL(session.successUrl).origin;
    window.opener.postMessage({ type: "quietpay:checkout", status, sessionId: session.id, redirectUrl: redirectUrl ?? session.successUrl }, target);
    return true;
  } catch {
    return false;
  }
}

/** Tell the store, then close this window (or fall back to navigating if closing is blocked). */
export function finishInPopup(status: PopupStatus, session: { id: string; successUrl: string }, redirectUrl: string | null | undefined, fallbackUrl: string) {
  if (!notifyOpener(status, session, redirectUrl)) {
    window.location.assign(fallbackUrl);
    return;
  }
  window.close();
  // Some browsers refuse to close; leave the person somewhere useful.
  setTimeout(() => window.location.assign(fallbackUrl), 400);
}

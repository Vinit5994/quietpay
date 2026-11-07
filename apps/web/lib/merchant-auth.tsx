"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Merchant } from "@quietpay/shared";
import { ApiError, api } from "./api";
import { SignatureRejectedError, useWallet } from "./wallet";

/**
 * Merchant dashboard session: sign in with the payout wallet (personal_sign of the API's nonce
 * message) → JWT → the merchant record, or onboarding if this wallet has no business yet.
 */
export type MerchantSession =
  | { state: "loading" }
  | { state: "no_wallet" }
  | { state: "signed_out"; error?: string }
  | { state: "signing_in" }
  | { state: "onboarding"; token: string }
  | { state: "ready"; token: string; merchant: Merchant };

interface Ctx {
  session: MerchantSession;
  signIn(): Promise<void>;
  signOut(): void;
  /** After onboarding: switch to the new token and merchant. */
  setReady(token: string, merchant: Merchant): void;
  refreshMerchant(): Promise<void>;
}

const MerchantAuthContext = createContext<Ctx | null>(null);
const key = (address: string) => `quietpay.dashboard.token.${address.toLowerCase()}`;
const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v) window.localStorage.setItem(k, v);
    else window.localStorage.removeItem(k);
  } catch {
    /* storage blocked: session lasts for this tab */
  }
};

export function MerchantAuthProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [session, setSession] = useState<MerchantSession>({ state: "loading" });

  const loadMerchant = useCallback(async (token: string) => {
    try {
      const merchant = await api("dashGetMerchant", { token });
      setSession({ state: "ready", token, merchant });
    } catch (err) {
      // The real API rejects wallets without a merchant with 403; the mock uses 404.
      if (err instanceof ApiError && (err.code === "not_found" || (err.status === 403 && err.code === "forbidden"))) {
        setSession({ state: "onboarding", token });
      }
      else if (err instanceof ApiError && err.status === 401) {
        if (wallet.address) write(key(wallet.address), null);
        setSession({ state: "signed_out", error: "Your session expired. Sign in again." });
      } else setSession({ state: "signed_out", error: err instanceof Error ? err.message : "Couldn't load your business." });
    }
  }, [wallet.address]);

  useEffect(() => {
    if (wallet.status === "loading") return;
    if (wallet.status === "signed_out" || !wallet.address) {
      setSession({ state: "no_wallet" });
      return;
    }
    const saved = read(key(wallet.address));
    if (saved) void loadMerchant(saved);
    else setSession({ state: "signed_out" });
  }, [wallet.status, wallet.address, loadMerchant]);

  const signIn = useCallback(async () => {
    if (!wallet.address) return;
    const address = wallet.address;
    setSession({ state: "signing_in" });
    try {
      const { message } = await api("authNonce", { query: { address } });
      const signature = await wallet.signMessage(message, "Sign in to your QuietPay dashboard");
      const { token } = await api("authVerify", { body: { address, signature, role: "merchant" } });
      write(key(address), token);
      await loadMerchant(token);
    } catch (err) {
      setSession({
        state: "signed_out",
        error: err instanceof SignatureRejectedError ? "Sign-in was canceled." : err instanceof Error ? err.message : "Sign-in failed.",
      });
    }
  }, [wallet, loadMerchant]);

  const signOut = useCallback(() => {
    if (wallet.address) write(key(wallet.address), null);
    setSession({ state: "signed_out" });
  }, [wallet.address]);

  const setReady = useCallback(
    (token: string, merchant: Merchant) => {
      if (wallet.address) write(key(wallet.address), token);
      setSession({ state: "ready", token, merchant });
    },
    [wallet.address],
  );

  const refreshMerchant = useCallback(async () => {
    if (session.state === "ready") await loadMerchant(session.token);
  }, [session, loadMerchant]);

  return (
    <MerchantAuthContext.Provider value={{ session, signIn, signOut, setReady, refreshMerchant }}>{children}</MerchantAuthContext.Provider>
  );
}

export function useMerchantAuth(): Ctx {
  const c = useContext(MerchantAuthContext);
  if (!c) throw new Error("useMerchantAuth must be used inside MerchantAuthProvider");
  return c;
}

/** The signed-in merchant's token (only call inside a ready dashboard). */
export function useMerchantToken(): string {
  const { session } = useMerchantAuth();
  if (session.state !== "ready") throw new Error("Merchant session not ready");
  return session.token;
}

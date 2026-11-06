"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { SignatureRejectedError, useWallet } from "./wallet";

const key = (address: string) => `quietpay.portal.token.${address.toLowerCase()}`;
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
    /* storage blocked */
  }
};

/** Customer portal session: the wallet signs the API's nonce message → customer JWT. */
export function useCustomerSession() {
  const wallet = useWallet();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "no_wallet" | "signed_out" | "signing_in" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.status === "loading") return;
    if (!wallet.address) {
      setToken(null);
      setState("no_wallet");
      return;
    }
    const saved = read(key(wallet.address));
    setToken(saved);
    setState(saved ? "ready" : "signed_out");
  }, [wallet.status, wallet.address]);

  const signIn = useCallback(async () => {
    if (!wallet.address) return;
    const address = wallet.address;
    setError(null);
    setState("signing_in");
    try {
      const { message } = await api("authNonce", { query: { address } });
      const signature = await wallet.signMessage(message, "Sign in to see your payments");
      const res = await api("authVerify", { body: { address, signature, role: "customer" } });
      write(key(address), res.token);
      setToken(res.token);
      setState("ready");
    } catch (err) {
      setError(err instanceof SignatureRejectedError ? "Sign-in was canceled." : err instanceof Error ? err.message : "Sign-in failed.");
      setState("signed_out");
    }
  }, [wallet]);

  /** Called when the API says the token is no longer valid. */
  const expire = useCallback(() => {
    if (wallet.address) write(key(wallet.address), null);
    setToken(null);
    setError("Your session expired. Sign in again.");
    setState("signed_out");
  }, [wallet.address]);

  return { wallet, token, state, error, signIn, expire };
}

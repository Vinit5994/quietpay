"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SignatureRejectedError, type Wallet } from "./types";
import { toSignable, type TypedDataJson } from "./typed-data";

const STORAGE_KEY = "quietpay.demoWallet.v1";

function readKey(): Hex | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}
function writeKey(key: Hex | null) {
  try {
    if (key) window.localStorage.setItem(STORAGE_KEY, key);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the wallet lives for this tab only */
  }
}

type Pending = { purpose: string; resolve: (ok: boolean) => void };

const DevWalletContext = createContext<Wallet | null>(null);

/**
 * Browser demo wallet: a key generated and kept in this browser. Used until Privy (B4), and as the
 * fallback if Privy can't run on Whitechain. It shows its own confirm step so the "person closes the
 * signature request" path can be exercised.
 */
export function DevWalletProvider({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState<Hex | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const keyRef = useRef<Hex | null>(null);

  useEffect(() => {
    const k = readKey();
    keyRef.current = k;
    setKey(k);
    setReady(true);
  }, []);

  const account = useMemo(() => (key ? privateKeyToAccount(key) : null), [key]);

  const login = useCallback(async () => {
    const k = keyRef.current ?? generatePrivateKey();
    keyRef.current = k;
    writeKey(k);
    setKey(k);
  }, []);

  const logout = useCallback(async () => {
    keyRef.current = null;
    writeKey(null);
    setKey(null);
  }, []);

  const signTypedData = useCallback(async (payload: TypedDataJson, purpose: string) => {
    const k = keyRef.current;
    if (!k) throw new Error("Sign in first");
    const approved = await new Promise<boolean>((resolve) => setPending({ purpose, resolve }));
    setPending(null);
    if (!approved) throw new SignatureRejectedError();
    const acct = privateKeyToAccount(k);
    return acct.signTypedData(toSignable(payload) as Parameters<typeof acct.signTypedData>[0]);
  }, []);

  const wallet: Wallet = {
    status: !ready ? "loading" : account ? "signed_in" : "signed_out",
    address: account?.address ?? null,
    label: account ? "Demo wallet" : null,
    loginOptions: [{ id: "demo", label: "Continue with demo wallet" }],
    login,
    logout,
    signTypedData,
  };

  return (
    <DevWalletContext.Provider value={wallet}>
      {children}
      {pending ? <SignPrompt purpose={pending.purpose} onAnswer={pending.resolve} /> : null}
    </DevWalletContext.Provider>
  );
}

export function useDevWallet(): Wallet {
  const w = useContext(DevWalletContext);
  if (!w) throw new Error("useDevWallet must be used inside DevWalletProvider");
  return w;
}

function SignPrompt({ purpose, onAnswer }: { purpose: string; onAnswer: (ok: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onAnswer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sign-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--color-surface)] p-5 shadow-xl">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Demo wallet</p>
        <h2 id="sign-title" className="mt-1 text-lg font-semibold">{purpose}</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">Signing is free. Nothing moves until QuietPay submits it.</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => onAnswer(false)} className="flex-1 rounded-lg border border-[var(--color-line)] px-4 py-2.5 font-medium">
            Cancel
          </button>
          <button type="button" autoFocus onClick={() => onAnswer(true)} className="flex-1 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 font-medium text-[var(--color-accent-ink)]">
            Sign
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { createContext, useContext } from "react";
import type { Wallet } from "./types";

/** Filled by whichever wallet provider is active (demo or Privy). */
export const WalletContext = createContext<Wallet | null>(null);

export function useWallet(): Wallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet must be used inside WalletProvider");
  return w;
}

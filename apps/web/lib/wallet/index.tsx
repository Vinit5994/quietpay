"use client";

import { DevWalletProvider, useDevWallet } from "./dev-wallet";
import type { Wallet } from "./types";

export { SignatureRejectedError, type Wallet, type WalletStatus } from "./types";

/** Picks the wallet implementation. Privy (NEXT_PUBLIC_WALLET_MODE=privy) is added in task B4. */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  return <DevWalletProvider>{children}</DevWalletProvider>;
}

export function useWallet(): Wallet {
  return useDevWallet();
}

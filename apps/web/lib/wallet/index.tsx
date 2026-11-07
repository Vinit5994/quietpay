"use client";

import { env } from "@/lib/env";
import { DevWalletProvider } from "./dev-wallet";
import { PrivyWalletProvider } from "./privy-wallet";

export { SignatureRejectedError, type Wallet, type WalletStatus } from "./types";
export type { TypedDataJson } from "./typed-data";
export { useWallet } from "./context";

/**
 * NEXT_PUBLIC_WALLET_MODE=privy (with NEXT_PUBLIC_PRIVY_APP_ID): email/Google or MetaMask.
 * Otherwise the browser demo wallet (also the fallback if Privy is unavailable).
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (env.walletMode === "privy" && env.privyAppId) {
    return <PrivyWalletProvider appId={env.privyAppId}>{children}</PrivyWalletProvider>;
  }
  return <DevWalletProvider>{children}</DevWalletProvider>;
}

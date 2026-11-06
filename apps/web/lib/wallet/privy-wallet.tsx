"use client";

import { PrivyProvider, useLogout, usePrivy, useSignMessage, useSignTypedData, useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";
import type { Address, Hex } from "viem";
import { whitechainSepolia } from "@quietpay/shared";
import { WalletContext } from "./context";
import type { TypedDataJson } from "./typed-data";
import { SignatureRejectedError, type Wallet } from "./types";

/**
 * Privy: email / Google login with an embedded wallet on Whitechain Sepolia (chain 1874).
 * Customers never see seed phrases, gas or network pickers.
 */
export function PrivyWalletProvider({ appId, children }: { appId: string; children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: whitechainSepolia,
        supportedChains: [whitechainSepolia],
        appearance: { landingHeader: "Pay with QuietPay", showWalletLoginFirst: false },
      }}
    >
      <PrivyAdapter>{children}</PrivyAdapter>
    </PrivyProvider>
  );
}

/** Privy reports a closed/declined prompt as an error; treat those as "the person said no". */
function isRejection(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  const text = `${e?.code ?? ""} ${e?.message ?? String(err)}`;
  return /exit|reject|denied|cancel|closed|declin/i.test(text);
}

function PrivyAdapter({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login } = usePrivy();
  const { logout } = useLogout();
  const { wallets, ready: walletsReady } = useWallets();
  const { signTypedData: privySignTypedData } = useSignTypedData();
  const { signMessage: privySignMessage } = useSignMessage();

  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const address = (embedded?.address ?? null) as Address | null;
  const label = user?.email?.address ?? user?.google?.email ?? "Your QuietPay wallet";

  const signTypedData = useCallback(
    async (payload: TypedDataJson, purpose: string): Promise<Hex> => {
      if (!address) throw new Error("Sign in first");
      try {
        // Passed as JSON-friendly typed data (uints as decimal strings); Privy serializes it to its secure iframe.
        const { signature } = await privySignTypedData(payload as unknown as Parameters<typeof privySignTypedData>[0], {
          address,
          uiOptions: { title: purpose, description: "Signing is free. Nothing moves until QuietPay submits it.", buttonText: "Sign" },
        });
        return signature as Hex;
      } catch (err) {
        if (isRejection(err)) throw new SignatureRejectedError();
        throw err;
      }
    },
    [address, privySignTypedData],
  );

  const signMessage = useCallback(
    async (message: string, purpose: string): Promise<Hex> => {
      if (!address) throw new Error("Sign in first");
      try {
        const { signature } = await privySignMessage({ message }, { address, uiOptions: { title: purpose, buttonText: "Sign" } });
        return signature as Hex;
      } catch (err) {
        if (isRejection(err)) throw new SignatureRejectedError();
        throw err;
      }
    },
    [address, privySignMessage],
  );

  const wallet = useMemo<Wallet>(
    () => ({
      // Signed in but the embedded wallet is still being created → keep "loading" so pages don't flash.
      status: !ready || (authenticated && (!walletsReady || !address)) ? "loading" : authenticated ? "signed_in" : "signed_out",
      address,
      label: authenticated ? label : null,
      loginOptions: [{ id: "privy", label: "Continue with email or Google" }],
      login: async () => login(),
      logout: async () => logout(),
      signTypedData,
      signMessage,
    }),
    [ready, authenticated, walletsReady, address, label, login, logout, signTypedData, signMessage],
  );

  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

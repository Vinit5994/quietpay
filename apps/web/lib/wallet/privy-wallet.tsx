"use client";

import { PrivyProvider, useLogout, usePrivy, useSignMessage, useSignTypedData, useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";
import type { Address, Hex } from "viem";
import { createWalletClient, custom } from "viem";
import { whitechainSepolia } from "@quietpay/shared";
import { WalletContext } from "./context";
import type { TypedDataJson } from "./typed-data";
import { toSignable } from "./typed-data";
import { SignatureRejectedError, type Wallet } from "./types";

/**
 * Privy: email / Google with an embedded wallet, or an existing MetaMask wallet.
 * Customers never see seed phrases, gas or network pickers.
 */
export function PrivyWalletProvider({ appId, children }: { appId: string; children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google", "wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: whitechainSepolia,
        supportedChains: [whitechainSepolia],
        appearance: {
          landingHeader: "Sign in to QuietPay",
          showWalletLoginFirst: false,
          walletList: ["metamask"],
          walletChainType: "ethereum-only",
        },
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

  // Only select wallets belonging to this authenticated user, including after reconnecting.
  const activeWallet = authenticated
    ? wallets.find((w) => w.address.toLowerCase() === user?.wallet?.address.toLowerCase())
      ?? wallets.find((w) => w.walletClientType === "privy")
      ?? wallets.find((w) => user?.linkedAccounts.some(
        (account) => account.type === "wallet" && account.address.toLowerCase() === w.address.toLowerCase(),
      ))
    : undefined;
  const address = (activeWallet?.address ?? null) as Address | null;
  const label = user?.email?.address ?? user?.google?.email
    ?? (activeWallet?.walletClientType === "metamask" ? "MetaMask" : "Your QuietPay wallet");

  const signTypedData = useCallback(
    async (payload: TypedDataJson, purpose: string): Promise<Hex> => {
      if (!address || !activeWallet) throw new Error("Sign in first");
      try {
        if (activeWallet.walletClientType !== "privy") {
          await activeWallet.switchChain(whitechainSepolia.id);
          const provider = await activeWallet.getEthereumProvider();
          const client = createWalletClient({ account: address, chain: whitechainSepolia, transport: custom(provider) });
          return await client.signTypedData({
            ...toSignable(payload),
            domain: { ...payload.domain, verifyingContract: payload.domain.verifyingContract as Address },
          });
        }
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
    [address, activeWallet, privySignTypedData],
  );

  const signMessage = useCallback(
    async (message: string, purpose: string): Promise<Hex> => {
      if (!address || !activeWallet) throw new Error("Sign in first");
      try {
        if (activeWallet.walletClientType !== "privy") {
          const provider = await activeWallet.getEthereumProvider();
          const client = createWalletClient({ account: address, transport: custom(provider) });
          return await client.signMessage({ message });
        }
        const { signature } = await privySignMessage({ message }, { address, uiOptions: { title: purpose, buttonText: "Sign" } });
        return signature as Hex;
      } catch (err) {
        if (isRejection(err)) throw new SignatureRejectedError();
        throw err;
      }
    },
    [address, activeWallet, privySignMessage],
  );

  const sendNative = useCallback(async (to: Address, valueWei: bigint): Promise<Hex> => {
    if (!address || !activeWallet) throw new Error("Sign in first");
    if (valueWei <= 0n) throw new Error("Enter an amount greater than zero");
    try {
      await activeWallet.switchChain(whitechainSepolia.id);
      const provider = await activeWallet.getEthereumProvider();
      const client = createWalletClient({ account: address, chain: whitechainSepolia, transport: custom(provider) });
      return await client.sendTransaction({ to, value: valueWei });
    } catch (err) {
      if (isRejection(err)) throw new SignatureRejectedError();
      throw err;
    }
  }, [address, activeWallet]);

  const wallet = useMemo<Wallet>(
    () => ({
      // Wait for wallet creation or reconnection before showing the signed-in pages.
      status: !ready || (authenticated && (!walletsReady || !address)) ? "loading" : authenticated ? "signed_in" : "signed_out",
      address,
      label: authenticated ? label : null,
      loginOptions: [{ id: "privy", label: "Continue with email, Google or MetaMask" }],
      login: async () => login(),
      logout: async () => logout(),
      signTypedData,
      signMessage,
      sendNative,
    }),
    [ready, authenticated, walletsReady, address, label, login, logout, signTypedData, signMessage, sendNative],
  );

  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

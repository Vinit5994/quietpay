"use client";

import { useState } from "react";
import { Button, CopyField, Notice, TxLink } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { env } from "@/lib/env";
import { useWallet } from "@/lib/wallet";

/** Only same-site paths, so the "back" link can't be used to send people elsewhere. */
function safeReturn(path: string | undefined): string | null {
  return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
}

export function FundDemo({ returnTo }: { returnTo?: string }) {
  const wallet = useWallet();
  const back = safeReturn(returnTo);
  const [state, setState] = useState<{ busy: boolean; txHash?: string; amount?: string; error?: string }>({ busy: false });

  if (!env.demoMode) {
    return <Notice tone="info">Test funds are only available in testnet demo mode.</Notice>;
  }

  const fund = async () => {
    if (!wallet.address) return;
    setState({ busy: true });
    try {
      const res = await api("demoFund", { body: { address: wallet.address } });
      setState({ busy: false, txHash: res.txHash, amount: res.amount });
    } catch (err) {
      setState({ busy: false, error: err instanceof ApiError ? err.message : "Couldn't send test USDT. Try again." });
    }
  };

  return (
    <div className="space-y-4">
      <Notice tone="warn">Testnet demo only. Test USDT has no value.</Notice>
      {wallet.status !== "signed_in" || !wallet.address ? (
        <>
          <p className="text-sm">Sign in first so we know which wallet to fund.</p>
          {wallet.loginOptions.map((o) => (
            <Button key={o.id} onClick={() => void wallet.login(o.id)}>
              {o.label}
            </Button>
          ))}
        </>
      ) : state.txHash ? (
        <>
          <Notice tone="good">
            Sent {state.amount} test USDT to your wallet. <TxLink hash={state.txHash} />
          </Notice>
          {back ? (
            <a href={back} className="nb-press inline-flex items-center justify-center rounded-[var(--radius-base)] border-2 border-[var(--color-ink)] bg-[var(--color-accent)] font-bold text-[var(--color-ink)] w-full px-4 py-3">
              Back to checkout
            </a>
          ) : null}
        </>
      ) : (
        <>
          <CopyField label="Your wallet" value={wallet.address} />
          {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
          <Button className="w-full" disabled={state.busy} onClick={() => void fund()}>
            {state.busy ? "Sending…" : "Send me 50 test USDT"}
          </Button>
          {back ? (
            <a href={back} className="block text-center text-sm text-[var(--color-muted)] hover:underline">
              Back to checkout
            </a>
          ) : null}
        </>
      )}
    </div>
  );
}

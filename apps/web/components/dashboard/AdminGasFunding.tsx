"use client";

import { useState } from "react";
import type { Address } from "viem";
import { Button, Field, Notice, Panel, inputCls } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useWallet } from "@/lib/wallet";
import { GasTransferForm } from "./GasFunding";

export function AdminGasFunding() {
  const wallet = useWallet();
  const [token, setToken] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const funding = useApi((signal) => token ? api("adminGas", { token, signal }) : Promise.resolve(null), [token], { pollMs: token ? 5000 : undefined });
  const signIn = async () => {
    if (!wallet.address) return;
    setSigning(true);
    setError(null);
    try {
      const { message } = await api("authNonce", { query: { address: wallet.address } });
      const signature = await wallet.signMessage(message, "Manage QuietPay relayer funding");
      const auth = await api("authVerify", { body: { address: wallet.address, signature, role: "merchant" } });
      setToken(auth.token);
    } catch (err) { setError(err instanceof Error ? err.message : "Sign-in failed."); }
    finally { setSigning(false); }
  };
  const selected = funding.data?.merchants.find((row) => row.merchant.id === merchantId);
  return (
    <Panel title="Relayer funding" className="mb-6">
      <div className="space-y-4 p-5">
        <p className="text-sm text-[var(--color-muted)]">The contract owner can refuel the relayer or sponsor one business. Sponsoring credits only the selected business’s gas balance.</p>
        {error || funding.error ? <Notice tone="bad">{error ?? funding.error}</Notice> : null}
        {!token ? <Button disabled={signing} onClick={() => void signIn()}>{signing ? "Waiting for signature…" : "Sign in to manage funding"}</Button> : null}
        {funding.data ? <>
          <p className="text-sm">Relayer balance: <strong>{funding.data.balance} WBT</strong></p>
          <Field label="Use deposit for">
            <select className={inputCls} value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
              <option value="">Relayer reserve only</option>
              {funding.data.merchants.map(({ merchant }) => <option key={merchant.id} value={merchant.id}>{merchant.name} · {merchant.payoutAddress}</option>)}
            </select>
          </Field>
          {selected ? <p className="text-sm">{selected.merchant.name}: <strong>{selected.gas.remaining} WBT</strong> available. Other businesses cannot spend this deposit.</p> : <p className="text-sm text-[var(--color-muted)]">Adds WBT to the relayer without granting any business spending credit.</p>}
          <GasTransferForm key={`${wallet.address}:${merchantId}`} creditId={merchantId || "relayer-reserve"} relayerAddress={funding.data.relayerAddress as Address} onCredit={merchantId ? (txHash) => api("adminGasTopup", { token: token!, body: { merchantId, txHash } }) : undefined} onComplete={funding.reload} />
        </> : null}
      </div>
    </Panel>
  );
}

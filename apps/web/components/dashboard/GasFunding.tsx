"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, parseEther, type Address, type Hex } from "viem";
import { whitechainSepolia } from "@quietpay/shared";
import { Button, CopyField, Field, Notice, Panel, TxLink, inputCls } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { useMerchantToken } from "@/lib/merchant-auth";
import { useApi } from "@/lib/use-api";
import { useWallet } from "@/lib/wallet";

const client = createPublicClient({ chain: whitechainSepolia, transport: http() });

/** Keeps a broadcast transfer recoverable so a failed confirmation never prompts another payment. */
export function GasTransferForm({ relayerAddress, creditId, onCredit, onComplete }: {
  relayerAddress: Address;
  creditId: string;
  onCredit?: (hash: Hex) => Promise<unknown>;
  onComplete: () => void;
}) {
  const wallet = useWallet();
  const storageKey = `quietpay.gas-funding.${wallet.address?.toLowerCase()}.${creditId}`;
  const [amount, setAmount] = useState("0.05");
  const [hash, setHash] = useState<Hex | null>(null);
  const [existingHash, setExistingHash] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && /^0x[0-9a-fA-F]{64}$/.test(saved)) setHash(saved as Hex);
    } catch { /* Confirmation still works without persistent browser storage. */ }
    setReady(true);
  }, [storageKey]);

  const fund = async () => {
    setBusy(true);
    setMessage(null);
    try {
      let txHash = hash;
      if (!txHash) {
        if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseEther(amount) <= 0n) throw new Error("Enter a positive WBT amount with at most 18 decimals.");
        if (wallet.address?.toLowerCase() === relayerAddress.toLowerCase()) throw new Error("Use a funding wallet different from the relayer. A self-transfer cannot add funds.");
        txHash = await wallet.sendNative(relayerAddress, parseEther(amount));
        setHash(txHash);
        try { localStorage.setItem(storageKey, txHash); } catch { /* Keep the hash in this tab. */ }
      }
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        setHash(null);
        try { localStorage.removeItem(storageKey); } catch { /* Storage may be blocked. */ }
        throw new Error("The transfer reverted. No gas balance was credited.");
      }
      await onCredit?.(txHash);
      try { localStorage.removeItem(storageKey); } catch { /* Storage may be blocked. */ }
      setHash(null);
      setMessage({ tone: "good", text: onCredit ? "Deposit confirmed. This business’s gas balance has been credited." : "Relayer refuelled. Business gas balances are unchanged." });
      onComplete();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "Couldn’t confirm the deposit. Try again." });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <CopyField label="Relayer wallet · Whitechain Sepolia" value={relayerAddress} />
      <Field label="Amount (WBT)" hint="Your wallet will ask you to approve this transfer and its network fee.">
        <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy || Boolean(hash)} />
      </Field>
      {hash ? <p className="text-sm">Transfer sent. Confirm this deposit before sending another. <TxLink hash={hash} /></p> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button disabled={!ready || busy} onClick={() => void fund()}>
        {busy ? "Confirming deposit…" : hash ? "Confirm existing deposit" : onCredit ? "Fund business gas balance" : "Refuel relayer"}
      </Button>
      {hash && message?.tone === "bad" ? <Button variant="ghost" disabled={busy} onClick={() => {
        setHash(null);
        setMessage(null);
        try { localStorage.removeItem(storageKey); } catch { /* Storage may be blocked. */ }
      }}>Use a different deposit</Button> : null}
      {!hash ? <details className="text-sm">
        <summary className="cursor-pointer text-[var(--color-link)]">Already sent WBT? Confirm an existing deposit</summary>
        <div className="mt-3 space-y-3">
          <Field label="Transaction hash" hint="Use a successful transfer from your funding wallet to this relayer.">
            <input className={`${inputCls} font-mono`} value={existingHash} onChange={(e) => setExistingHash(e.target.value.trim())} placeholder="0x…" disabled={busy} />
          </Field>
          <Button variant="secondary" disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(existingHash)} onClick={() => {
            setHash(existingHash as Hex);
            try { localStorage.setItem(storageKey, existingHash); } catch { /* Keep it in this tab. */ }
          }}>Use this transfer</Button>
        </div>
      </details> : null}
    </div>
  );
}

export function MerchantGasFunding() {
  const token = useMerchantToken();
  const wallet = useWallet();
  const funding = useApi((signal) => api("dashGas", { token, signal }), [token], { pollMs: 5000 });
  return (
    <Panel title="Gas balance" className="mb-6">
      <div className="space-y-4 p-5">
        <p className="text-sm text-[var(--color-muted)]">Deposit WBT to cover your business’s gasless transactions. Only your business can use this balance, including requests made with your secret key. Available funds exclude gas reserved for pending transactions.</p>
        {funding.error ? <Notice tone="bad">{funding.error}</Notice> : null}
        {funding.data ? <>
          <div className="flex flex-wrap gap-6 text-sm">
            <p>Available: <strong>{funding.data.gas.remaining} WBT</strong></p>
            <p>Gas spent: <strong>{funding.data.gas.spent} WBT</strong></p>
          </div>
          <GasTransferForm key={`${wallet.address}:${token}`} relayerAddress={funding.data.relayerAddress as Address} creditId="merchant" onCredit={(txHash) => api("dashGasTopup", { token, body: { txHash } })} onComplete={funding.reload} />
        </> : null}
      </div>
    </Panel>
  );
}

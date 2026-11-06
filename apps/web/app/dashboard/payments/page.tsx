"use client";

import { useState } from "react";
import type { Payment } from "@quietpay/shared";
import { Button, Field, Modal, Notice, PageHeader, Panel, Skeleton, StatusChip, Table, TxLink, inputCls } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { shortAddress, timeAgo, usdt } from "@/lib/format";
import { useMerchantToken } from "@/lib/merchant-auth";
import { useApi } from "@/lib/use-api";
import { SignatureRejectedError, useWallet } from "@/lib/wallet";

export default function PaymentsPage() {
  const token = useMerchantToken();
  const payments = useApi((signal) => api("dashPayments", { token, signal, query: { limit: 100 } }), [token], { pollMs: 4000 });
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await api("exportPaymentsCsv", { token });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `quietpay-payments-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment and subscription charge. Refunds go back to the customer's wallet, capped at what they paid."
        action={
          <Button variant="secondary" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />
      {notice ? (
        <div className="mb-4">
          <Notice tone="good">{notice}</Notice>
        </div>
      ) : null}
      {payments.error ? <Notice tone="bad">{payments.error}</Notice> : null}
      <Panel>
        {payments.loading && !payments.data ? (
          <Skeleton rows={5} />
        ) : (
          <Table head={["When", "Description", "Customer", ">Amount", ">Refunded", "Status", "", ""]} empty={payments.data?.data.length ? false : "No payments yet. They appear here as soon as a customer pays."}>
            {payments.data?.data.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap px-5 py-3 text-[var(--color-muted)]">{timeAgo(p.paidAt)}</td>
                <td className="max-w-[220px] px-5 py-3">
                  <p className="truncate font-mono text-xs">{p.reference ?? "—"}</p>
                  <p className="text-xs text-[var(--color-muted)]">{p.kind === "subscription" ? "Subscription charge" : "Checkout"}</p>
                </td>
                <td className="px-5 py-3 font-mono text-xs">{shortAddress(p.payerAddress)}</td>
                <td className="tabular whitespace-nowrap px-5 py-3 text-right font-medium">{usdt(p.amount)}</td>
                <td className="tabular whitespace-nowrap px-5 py-3 text-right text-[var(--color-muted)]">{p.refunded === "0.00" ? "—" : usdt(p.refunded)}</td>
                <td className="px-5 py-3">
                  <StatusChip status={p.status} />
                </td>
                <td className="px-5 py-3">
                  <TxLink hash={p.txHash} />
                </td>
                <td className="px-5 py-3 text-right">
                  <Button size="sm" variant="secondary" disabled={p.refundable === "0.00"} onClick={() => setRefunding(p)}>
                    Refund
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      {refunding ? (
        <RefundModal
          payment={refunding}
          token={token}
          onClose={() => setRefunding(null)}
          onDone={(amount) => {
            setRefunding(null);
            setNotice(`Refund of ${usdt(amount)} submitted. It shows here once it settles, usually in a few seconds.`);
            void payments.reload();
          }}
        />
      ) : null}
    </>
  );
}

function RefundModal({ payment, token, onClose, onDone }: { payment: Payment; token: string; onClose: () => void; onDone: (amount: string) => void }) {
  const wallet = useWallet();
  const [amount, setAmount] = useState(payment.refundable);
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setStep("Creating refund…");
      const refund = await api("createRefund", { token, body: { paymentId: payment.id, amount, reason: reason.trim() || undefined } });
      const { typedData, signer } = await api("dashRefundTypedData", { token, params: { id: refund.id } });
      if (wallet.address && signer.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error("Refunds must be signed by the payout wallet. Sign in with that wallet.");
      }
      setStep("Confirm in your wallet…");
      const signature = await wallet.signTypedData(typedData, `Refund ${usdt(amount)} to the customer`);
      setStep("Submitting…");
      await api("dashRefundSubmit", { token, params: { id: refund.id }, body: { signature } });
      onDone(amount);
    } catch (err) {
      setStep(null);
      setError(
        err instanceof SignatureRejectedError
          ? "You closed the signature request. Nothing was refunded. The pending refund will expire."
          : err instanceof ApiError || err instanceof Error
            ? err.message
            : "Refund failed.",
      );
    }
  };

  return (
    <Modal title="Refund payment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-sm">
          <p className="font-mono text-xs text-[var(--color-muted)]">{payment.reference}</p>
          <p className="mt-1">
            Paid <span className="tabular font-medium">{usdt(payment.amount)}</span>
            {payment.refunded !== "0.00" ? (
              <>
                {" "}
                · already refunded <span className="tabular">{usdt(payment.refunded)}</span>
              </>
            ) : null}
          </p>
        </div>
        <Field label="Amount (USDT)" hint={`Up to ${usdt(payment.refundable)}. The contract won't allow more than was paid.`}>
          <input
            id="refund-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className={`${inputCls} tabular`}
            required
          />
        </Field>
        <Field label="Reason (optional)">
          <input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={inputCls} placeholder="Wrong size" />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={step !== null}>
            {step ?? `Refund ${amount ? usdt(amount) : ""}`}
          </Button>
        </div>
        <p className="text-xs text-[var(--color-muted)]">You sign the refund with your payout wallet. QuietPay pays the gas.</p>
      </form>
    </Modal>
  );
}

"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { PaymentLink } from "@quietpay/shared";
import { Button, CopyField, Field, Modal, Notice, PageHeader, Panel, Skeleton, StatusChip, inputCls, Pager } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { timeAgo, usdt } from "@/lib/format";
import { useMerchantToken } from "@/lib/merchant-auth";
import { PAGE_SIZE, useApi, usePager } from "@/lib/use-api";

function Qr({ url, size = 128 }: { url: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg);
  }, [url]);
  return (
    <div
      className="shrink-0 rounded-[var(--radius-base)] border border-[var(--color-line)] bg-white p-1.5"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`QR code for ${url}`}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

export default function LinksPage() {
  const token = useMerchantToken();
  const pager = usePager();
  const links = useApi((signal) => api("listPaymentLinks", { token, signal, query: { limit: PAGE_SIZE, cursor: pager.cursor } }), [token, pager.cursor]);
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<PaymentLink | null>(null);

  return (
    <>
      <PageHeader
        title="Payment links"
        description="Sell without code: share a link or print its QR at a counter. Each visit opens a fresh checkout."
        action={<Button onClick={() => setCreating(true)}>New link</Button>}
      />
      {links.error ? <Notice tone="bad">{links.error}</Notice> : null}
      {links.loading && !links.data ? (
        <Panel>
          <Skeleton />
        </Panel>
      ) : links.data?.data.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {links.data.data.map((l) => (
            <Panel key={l.id}>
              <div className="flex gap-4 p-4">
                <button type="button" onClick={() => setShowing(l)} aria-label={`Show QR for ${l.title}`} className="rounded-[var(--radius-base)] focus-visible:outline-2 focus-visible:outline-[var(--color-link)]">
                  <Qr url={l.url} size={96} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-semibold">{l.title}</p>
                    <StatusChip status={l.active ? "active" : "inactive"} label={l.active ? "Live" : "Off"} />
                  </div>
                  <p className="tabular text-lg font-semibold">{usdt(l.amount)}</p>
                  <p className="text-xs text-[var(--color-muted)]">created {timeAgo(l.createdAt)}</p>
                  <div className="mt-2">
                    <CopyField value={l.url} />
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      ) : pager.page > 1 ? null : (
        <Panel>
          <p className="p-10 text-center text-[var(--color-muted)]">No payment links yet.</p>
        </Panel>
      )}
      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-line)] bg-white empty:hidden">
        <Pager page={pager.page} hasNext={Boolean(links.data?.nextCursor)} loading={links.loading} onPrev={pager.prev} onNext={() => links.data?.nextCursor && pager.next(links.data.nextCursor)} />
      </div>
      {showing ? (
        <Modal title={showing.title} onClose={() => setShowing(null)}>
          <div className="flex flex-col items-center gap-3">
            <Qr url={showing.url} size={260} />
            <p className="tabular text-xl font-semibold">{usdt(showing.amount)}</p>
            <a href={showing.url} target="_blank" rel="noreferrer" className="break-all text-sm font-semibold text-[var(--color-link)] underline decoration-1 underline-offset-2 hover:decoration-[var(--color-link)]">
              {showing.url}
            </a>
          </div>
        </Modal>
      ) : null}
      {creating ? (
        <NewLink
          token={token}
          onClose={() => setCreating(false)}
          onCreated={(l) => {
            setCreating(false);
            setShowing(l);
            void links.reload();
          }}
        />
      ) : null}
    </>
  );
}

function NewLink({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: (l: PaymentLink) => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const link = await api("createPaymentLink", { token, body: { title: title.trim(), amount, description: description.trim() || undefined } });
      onCreated(link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the link.");
      setBusy(false);
    }
  };
  return (
    <Modal title="New payment link" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="What are you selling?">
          <input id="link-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Sticker Pack" />
        </Field>
        <Field label="Price (USDT)">
          <input id="link-amount" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} tabular`} placeholder="3.00" />
        </Field>
        <Field label="Description (optional)">
          <input id="link-description" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create link"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

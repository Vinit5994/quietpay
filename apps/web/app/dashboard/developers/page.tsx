"use client";

import Link from "next/link";
import { useState } from "react";
import type { WebhookDelivery } from "@quietpay/shared";
import { Button, CopyField, Field, Modal, Notice, PageHeader, Panel, Skeleton, StatusChip, Table, inputCls, Pager } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useMerchantAuth, useMerchantToken } from "@/lib/merchant-auth";
import { PAGE_SIZE, useApi, usePager } from "@/lib/use-api";


export default function DevelopersPage() {
  const token = useMerchantToken();
  const { session, refreshMerchant } = useMerchantAuth();
  const merchant = session.state === "ready" ? session.merchant : null;
  const pager = usePager();
  const deliveries = useApi((signal) => api("dashWebhookDeliveries", { token, signal, query: { limit: PAGE_SIZE, cursor: pager.cursor } }), [token, pager.cursor], { pollMs: pager.page === 1 ? 4000 : undefined });

  const [newKey, setNewKey] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [url, setUrl] = useState(merchant?.webhookUrl ?? "");
  const [busy, setBusy] = useState<null | "rotate" | "url" | "test">(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [viewing, setViewing] = useState<WebhookDelivery | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const run = async (kind: "rotate" | "url" | "test", fn: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Developers" description="API keys, webhooks and the integration code your server needs." />
      {message ? (
        <div className="mb-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="API keys">
          <div className="space-y-4 p-5">
            {newKey ? (
              <>
                <Notice tone="warn">Copy your new secret key now. It won&apos;t be shown again, and the old key no longer works.</Notice>
                <CopyField label="New secret key" value={newKey} secret />
              </>
            ) : (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Secret key</p>
                <p className="font-mono text-sm">{merchant?.secretKeyPrefix}••••••••••••</p>
              </div>
            )}
            <p className="text-sm text-[var(--color-muted)]">Use the secret key only on your server. Anyone with it can create checkouts and refunds for your business.</p>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirmRotate(true)}>
              Rotate secret key
            </Button>
          </div>
        </Panel>

        <Panel title="Webhook endpoint">
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run("url", async () => {
                const res = await api("updateWebhookEndpoint", { token, body: { url: url.trim() } });
                setNewSecret(res.secret);
                await refreshMerchant();
                setMessage({ tone: "good", text: "Webhook URL saved." });
              });
            }}
          >
            <Field label="URL" hint="We POST signed events here: payments, refunds and subscription changes.">
              <input id="webhook-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} className={`${inputCls} font-mono text-sm`} placeholder="https://your-store.com/api/webhooks/quietpay" />
            </Field>
            {newSecret ? <CopyField label="Signing secret (copy now; it changes on every save)" value={newSecret} secret /> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy !== null}>
                {busy === "url" ? "Saving…" : "Save URL"}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null || !merchant?.webhookUrl}
                onClick={() =>
                  void run("test", async () => {
                    const d = await api("testWebhookEndpoint", { token });
                    setMessage(d.status === "succeeded" ? { tone: "good", text: `Test event delivered (HTTP ${d.lastStatusCode}).` } : { tone: "bad", text: `Test event failed: ${d.lastError ?? "no response"}.` });
                    void deliveries.reload();
                  })
                }
              >
                {busy === "test" ? "Sending…" : "Send test event"}
              </Button>
            </div>
          </form>
        </Panel>
      </div>

      <Panel title="Webhook deliveries" className="mt-6">
        {deliveries.loading && !deliveries.data ? (
          <Skeleton />
        ) : (
          <Table head={["When", "Event", "Status", "Attempts", "Response", ""]} empty={deliveries.data?.data.length ? false : "No webhooks sent yet."}>
            {deliveries.data?.data.map((d) => (
              <tr key={d.id}>
                <td className="whitespace-nowrap px-5 py-3 text-[var(--color-muted)]">{timeAgo(d.createdAt)}</td>
                <td className="px-5 py-3 font-mono text-xs">{d.type}</td>
                <td className="px-5 py-3">
                  <StatusChip status={d.status} />
                </td>
                <td className="tabular px-5 py-3">{d.attempts}</td>
                <td className="px-5 py-3 text-xs text-[var(--color-muted)]">{d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : (d.lastError ?? "—")}</td>
                <td className="px-5 py-3 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setViewing(d)}>
                    Payload
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={pager.page} hasNext={Boolean(deliveries.data?.nextCursor)} loading={deliveries.loading} onPrev={pager.prev} onNext={() => deliveries.data?.nextCursor && pager.next(deliveries.data.nextCursor)} />
      </Panel>

      <p className="mt-6 text-sm text-[var(--color-muted)]">
        Looking for the integration code?{" "}
        <Link href="/dashboard/integrate" className="text-[var(--color-link)] hover:underline">
          Open the Integrate guide
        </Link>
        .
      </p>

      {viewing ? (
        <Modal title={viewing.type} onClose={() => setViewing(null)}>
          <p className="mb-2 text-xs text-[var(--color-muted)]">
            {viewing.eventId} → {viewing.url}
          </p>
          <pre className="max-h-[60vh] overflow-auto rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3 font-mono text-xs">{JSON.stringify(viewing.payload, null, 2)}</pre>
        </Modal>
      ) : null}

      {confirmRotate ? (
        <Modal title="Rotate secret key?" onClose={() => setConfirmRotate(false)}>
          <p className="text-sm">Your current key stops working immediately. Update your server with the new key right after.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmRotate(false)}>
              Keep current key
            </Button>
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() =>
                void run("rotate", async () => {
                  const res = await api("dashRotateKey", { token });
                  setNewKey(res.secretKey);
                  setConfirmRotate(false);
                  await refreshMerchant();
                })
              }
            >
              {busy === "rotate" ? "Rotating…" : "Rotate key"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

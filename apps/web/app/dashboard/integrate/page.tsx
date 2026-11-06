"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Code2, KeyRound, PlayCircle, Webhook } from "lucide-react";
import { CodeTabs } from "@/components/landing/CodeTabs";
import { integrationSnippets } from "@/components/landing/snippets";
import { Button, CopyField, Notice, PageHeader, Panel, StatusChip, buttonCls } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { useMerchantAuth, useMerchantToken } from "@/lib/merchant-auth";
import { useApi } from "@/lib/use-api";

const snippet = (id: string) => integrationSnippets.filter((t) => t.id === id);

export default function IntegratePage() {
  const token = useMerchantToken();
  const { session } = useMerchantAuth();
  const merchant = session.state === "ready" ? session.merchant : null;
  const overview = useApi((signal) => api("dashOverview", { token, signal }), [token], { pollMs: 8000 });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const hasWebhook = Boolean(merchant?.webhookUrl);
  const hasPayment = Boolean(overview.data && overview.data.paymentsCount > 0);

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const d = await api("testWebhookEndpoint", { token });
      setTestResult(
        d.status === "succeeded"
          ? { ok: true, text: `Your server answered ${d.lastStatusCode ?? 200}. Webhooks are working.` }
          : { ok: false, text: `Your server didn't answer 2xx (${d.lastError ?? d.lastStatusCode ?? "no response"}). We'll retry it automatically.` },
      );
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof ApiError ? err.message : "Couldn't send the test event. Try again." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <PageHeader title="Integrate" description="Add USDT checkout to your app. It's about 20 lines on your server, and your customers never touch a wallet app." />

      <ol className="space-y-6">
        <Step n={1} icon={KeyRound} title="Install the SDK and add your keys" done>
          <p className="text-sm text-[var(--color-muted)]">Install the Node SDK on your server, then put your keys in its environment. Never ship them to the browser.</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <CopyField label="Install" value="pnpm add @quietpay/node" />
            <CopyField label="Environment" value={`QUIETPAY_SECRET_KEY=${merchant?.secretKeyPrefix ?? "sk_test_"}…`} />
          </div>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Your secret key starts with <code className="font-mono text-[var(--color-ink)]">{merchant?.secretKeyPrefix ?? "sk_test_"}</code>. Lost it? Make a new one in{" "}
            <Link href="/dashboard/developers" className="text-[var(--color-link)] hover:underline">
              Developers
            </Link>
            .
          </p>
        </Step>

        <Step n={2} icon={Code2} title="Create a checkout on your server" done={hasPayment}>
          <p className="text-sm text-[var(--color-muted)]">
            Pass the order&apos;s items and your own order id as <code className="font-mono">reference</code>, then redirect the customer to <code className="font-mono">session.url</code>.
            QuietPay sends them back to <code className="font-mono">successUrl</code> once they&apos;ve paid.
          </p>
          <div className="mt-4">
            <CodeTabs tabs={[...snippet("checkout"), ...snippet("subscription")]} />
          </div>
        </Step>

        <Step n={3} icon={Webhook} title="Mark orders paid from the webhook" done={hasWebhook}>
          <p className="text-sm text-[var(--color-muted)]">
            QuietPay signs every event. Verify it with one call, then update the order whose id is in <code className="font-mono">merchantReference</code>. Events are retried until your server answers 200.
          </p>
          <div className="mt-4">
            <CodeTabs tabs={snippet("webhook")} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-sm">
            <span className="text-[var(--color-muted)]">Webhook URL</span>
            {merchant?.webhookUrl ? (
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{merchant.webhookUrl}</code>
            ) : (
              <span className="flex-1">Not set yet</span>
            )}
            {hasWebhook ? (
              <Button size="sm" variant="secondary" onClick={() => void sendTest()} disabled={testing}>
                {testing ? "Sending…" : "Send a test event"}
              </Button>
            ) : (
              <Link href="/dashboard/developers" className={buttonCls("primary", "sm")}>
                Set webhook URL
              </Link>
            )}
          </div>
          {testResult ? (
            <div className="mt-3">
              <Notice tone={testResult.ok ? "good" : "bad"}>{testResult.text}</Notice>
            </div>
          ) : null}
        </Step>

        <Step n={4} icon={PlayCircle} title="Take a test payment" done={hasPayment}>
          <p className="text-sm text-[var(--color-muted)]">
            You&apos;re in test mode on Whitechain Sepolia with the official test USDT. Make a payment link and pay it yourself to see the whole flow, webhook included.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/dashboard/links" className={buttonCls("primary", "sm")}>
              Make a payment link
            </Link>
            <Link href="/dashboard/payments" className={buttonCls("secondary", "sm")}>
              See payments
            </Link>
          </div>
        </Step>
      </ol>
    </>
  );
}

function Step({
  n,
  icon: Icon,
  title,
  done,
  children,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Panel>
        <div className="flex gap-4 p-5 sm:p-6">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${done ? "bg-[var(--color-brand)] text-white" : "bg-[var(--color-brand-soft)] text-[var(--color-pine)]"}`}
            aria-hidden
          >
            {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--color-muted)]">Step {n}</span>
              {done ? <StatusChip status="succeeded" label="Done" /> : null}
            </div>
            <h2 className="mt-0.5 text-lg font-semibold">{title}</h2>
            <div className="mt-2">{children}</div>
          </div>
        </div>
      </Panel>
    </li>
  );
}

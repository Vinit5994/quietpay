import Link from "next/link";
import { QUIETPAY_ADDRESS, explorerAddress } from "@quietpay/shared";
import { CodeTabs, type CodeTab } from "@/components/landing/CodeTabs";

const demoStoreUrl = process.env.NEXT_PUBLIC_DEMO_STORE_URL ?? "http://localhost:3002";

const tabs: CodeTab[] = [
  {
    id: "checkout",
    file: "checkout.ts",
    code: `import { QuietPay } from "@quietpay/node";

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!);

// On your server: create a checkout and send the customer to it
export async function checkout(order: Order) {
  const session = await qp.checkout.sessions.create({
    mode: "payment",
    reference: order.id,
    lineItems: order.lineItems, // [{ name: "Hoodie", unitAmount: "25.00", quantity: 1 }]
    successUrl: \`https://yourstore.com/orders/\${order.id}\`,
    cancelUrl: "https://yourstore.com/cart",
  });
  redirect(session.url);
}`,
  },
  {
    id: "webhook",
    file: "webhook.ts",
    code: `// app/api/webhooks/quietpay/route.ts
export async function POST(req: Request) {
  const event = qp.webhooks.verify(
    await req.text(),
    req.headers.get("quietpay-signature"),
    process.env.QUIETPAY_WEBHOOK_SECRET!,
  );

  if (event.type === "payment.succeeded") {
    await markPaid(event.data.merchantReference, event.data.txHash);
  }
  return Response.json({ received: true });
}`,
  },
  {
    id: "subscription",
    file: "subscription.ts",
    code: `// Same call, subscription mode: renewals, grace period and cancels are handled for you
const session = await qp.checkout.sessions.create({
  mode: "subscription",
  planId: process.env.QUIETPAY_PLAN_ID!,
  reference: customer.id,
  successUrl: "https://yourstore.com/account",
  cancelUrl: "https://yourstore.com/pricing",
});
redirect(session.url);

// Then listen for subscription.renewed, subscription.payment_failed and subscription.canceled`,
  },
];

const steps = [
  {
    title: "Install the SDK and add your keys",
    body: "Create your business in the dashboard. Copy the secret key and webhook secret from Developers into your server's environment.",
    code: "pnpm add @quietpay/node",
  },
  {
    title: "Create a checkout on your server",
    body: "Pass the order's items and your own reference. Redirect the customer to the hosted checkout URL you get back.",
  },
  {
    title: "Mark the order paid from the webhook",
    body: "QuietPay signs every event. Verify it with one call and update your order. Events are retried until you answer 200.",
  },
];

const features = [
  { title: "Hosted checkout", body: "Customers sign in with email or Google. No wallet app, no seed phrase, no gas." },
  { title: "Payment links & QR", body: "Share a link or print a QR code at the counter. No code needed." },
  { title: "Subscriptions", body: "Automatic renewals with a spending cap, a grace period and past-due handling." },
  { title: "Refunds", body: "Full or partial, signed by your payout wallet and capped on-chain at what was paid." },
  { title: "Signed webhooks", body: "payment, refund and subscription events with retries and a delivery log." },
  { title: "Gas covered", body: "QuietPay's relayer pays every network fee. Settlement goes straight to your wallet." },
];

const flow = [
  { n: "1", title: "Your store", body: "Creates a checkout session with the SDK" },
  { n: "2", title: "QuietPay checkout", body: "Customer signs in with email and approves" },
  { n: "3", title: "Whitechain", body: "USDT moves to your wallet; we pay the gas" },
  { n: "4", title: "Your webhook", body: "Gets payment.succeeded and ships the order" },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-[var(--color-surface)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-brand)] text-sm text-white" aria-hidden>
              Q
            </span>
            QuietPay
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#integrate" className="hidden rounded-lg px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-ink)] sm:block">
              Integrate
            </a>
            <Link href="/portal" className="hidden rounded-lg px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-ink)] sm:block">
              Customer portal
            </Link>
            <Link href="/dashboard" className="inline-flex h-9 items-center rounded-lg bg-[var(--color-accent)] px-3.5 font-medium text-white hover:bg-[#2a2a2e]">
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-1 text-xs font-medium text-[var(--color-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]" aria-hidden />
              USDT payments on Whitechain
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] sm:text-5xl">Accept USDT in your app with about 20 lines of code.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--color-muted)]">
              Hosted checkout, payment links, subscriptions and refunds. Your customers sign in with email, and nobody pays gas or touches a seed phrase.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/dashboard" className="inline-flex h-11 items-center rounded-lg bg-[var(--color-accent)] px-5 font-medium text-white shadow-[var(--shadow-card)] hover:bg-[#2a2a2e]">
                Start accepting USDT
              </Link>
              <a
                href={demoStoreUrl}
                className="inline-flex h-11 items-center rounded-lg border border-[var(--color-line)] bg-white px-5 font-medium shadow-[var(--shadow-card)] hover:bg-[var(--color-bg)]"
              >
                Try the demo store →
              </a>
            </div>
            <p className="mt-6 text-sm text-[var(--color-muted)]">Test mode on Whitechain Sepolia with the official test USDT.</p>
          </div>
          <CodeTabs tabs={tabs} />
        </section>

        <section className="border-y border-[var(--color-line)] bg-[var(--color-bg)]">
          <ol className="mx-auto grid max-w-6xl gap-px px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {flow.map((f) => (
              <li key={f.n} className="flex gap-3 p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-white text-xs font-semibold">{f.n}</span>
                <div>
                  <p className="font-medium">{f.title}</p>
                  <p className="mt-0.5 text-sm text-[var(--color-muted)]">{f.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="integrate" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <p className="text-sm font-medium text-[var(--color-brand)]">Integrate</p>
          <h2 className="mt-2 text-3xl font-semibold">Three steps from cart to paid</h2>
          <p className="mt-3 max-w-2xl text-[var(--color-muted)]">
            The demo store, Swag Counter, uses exactly this code. It never touches wallets or the blockchain; it only talks to QuietPay through the SDK.
          </p>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-card)]">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-sm font-semibold text-[var(--color-brand)]">{i + 1}</span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{s.body}</p>
                {s.code ? <code className="mt-4 block rounded-lg bg-[#111113] px-3 py-2 font-mono text-xs text-[#e4e4e7]">{s.code}</code> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-[var(--color-line)] bg-[var(--color-bg)]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="text-3xl font-semibold">Everything after the first checkout</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-xl border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-card)]">
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-line)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-[var(--color-muted)] sm:px-6">
          <p>QuietPay · built for ETHGlobal Mumbai on Whitechain</p>
          {QUIETPAY_ADDRESS ? (
            <a href={explorerAddress(QUIETPAY_ADDRESS)} target="_blank" rel="noreferrer" className="font-mono text-xs hover:text-[var(--color-ink)]">
              Contract {QUIETPAY_ADDRESS.slice(0, 6)}…{QUIETPAY_ADDRESS.slice(-4)} ↗
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

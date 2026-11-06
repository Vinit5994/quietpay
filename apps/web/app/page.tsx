import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Code2,
  FileSpreadsheet,
  Fuel,
  KeyRound,
  Lock,
  Mail,
  QrCode,
  Repeat,
  Store,
  Undo2,
  Webhook,
  Wallet,
} from "lucide-react";
import { QUIETPAY_ADDRESS, explorerAddress } from "@quietpay/shared";
import { BuiltWith } from "@/components/brand/BuiltWith";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { CodeTabs } from "@/components/landing/CodeTabs";
import { CopyCode } from "@/components/landing/CopyCode";
import { integrationSnippets } from "@/components/landing/snippets";

const demoStoreUrl = process.env.NEXT_PUBLIC_DEMO_STORE_URL ?? "http://localhost:3002";

const tabs = integrationSnippets;

const flow = [
  { icon: Store, title: "Your store creates a checkout", body: "One SDK call with the order's items and your reference." },
  { icon: Mail, title: "The customer signs in with email", body: "A wallet is created for them. No app, no seed phrase." },
  { icon: Wallet, title: "USDT lands in your wallet", body: "Settled on Whitechain. QuietPay pays the network fee." },
  { icon: Webhook, title: "Your server gets a webhook", body: "payment.succeeded arrives signed, and you ship the order." },
];

const more = [
  { icon: QrCode, title: "Payment links and QR codes", body: "Share a link or print a QR at the counter. No code needed." },
  { icon: Repeat, title: "Subscriptions", body: "Automatic renewals with a spending cap, a grace period and past-due handling." },
  { icon: Undo2, title: "Refunds", body: "Full or partial, signed by your payout wallet and capped on-chain at what was paid." },
  { icon: Webhook, title: "Signed webhooks", body: "Payment, refund and subscription events, retried until you answer 200." },
  { icon: Fuel, title: "Gas covered", body: "QuietPay's relayer pays every network fee, for you and your customers." },
  { icon: FileSpreadsheet, title: "Exports for your books", body: "Download payments as CSV with transaction links for every line." },
];

const steps = [
  { icon: KeyRound, title: "Create your business", body: "Sign in with email, name your business and copy your secret key and webhook secret.", code: "pnpm add @quietpay/node" },
  { icon: Code2, title: "Create a checkout on your server", body: "Pass the items and your own order id, then redirect the customer to the URL you get back." },
  { icon: Webhook, title: "Mark the order paid from the webhook", body: "Verify the signature with one call and update your order. That's the whole integration." },
];

/** "Quiet" motif: sound waves that settle into a flat line, drawn behind the hero. */
function SettlingWaves() {
  const lines = Array.from({ length: 7 }, (_, i) => i);
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full" viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden>
      {lines.map((i) => {
        const y = 70 + i * 20;
        const a = 46 - i * 6;
        return (
          <path
            key={i}
            d={`M0 ${y} C 120 ${y - a}, 220 ${y + a}, 340 ${y} S 560 ${y - a / 2}, 680 ${y} S 900 ${y}, 1200 ${y}`}
            fill="none"
            stroke={i === 3 ? "#26a17b" : "#ffffff"}
            strokeOpacity={i === 3 ? 0.55 : 0.07}
            strokeWidth={i === 3 ? 1.6 : 1}
          />
        );
      })}
    </svg>
  );
}

function MiniCheckout() {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-xl border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-pop)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-neutral-soft)] text-sm font-semibold">S</span>
          <div>
            <p className="text-xs text-[var(--color-muted)]">Pay</p>
            <p className="text-sm font-semibold">Swag Counter</p>
          </div>
        </div>
        <LogoMark size={22} />
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between"><span>Builder Hoodie</span><span className="tabular">25.00 USDT</span></div>
        <div className="flex justify-between"><span>Ship-It Tee</span><span className="tabular">12.00 USDT</span></div>
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-[var(--color-line)] pt-3">
        <span className="text-sm font-medium">Total</span>
        <span className="tabular font-[family-name:var(--font-display)] text-xl font-semibold">37.00 USDT</span>
      </div>
      <div className="mt-4 flex h-10 items-center justify-center rounded-lg bg-[var(--color-pine)] text-sm font-medium text-white">Pay 37.00 USDT</div>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[var(--color-muted)]">
        <Check className="h-3.5 w-3.5 text-[var(--color-brand)]" aria-hidden /> No network fee for you
      </p>
      <p className="mt-3 flex items-center justify-center gap-1.5 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-muted)]">
        <Lock className="h-3 w-3" aria-hidden /> Secure checkout by <LogoMark size={14} /> <span className="font-semibold text-[var(--color-ink)]">QuietPay</span>
      </p>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-dvh bg-[var(--color-surface)]">
      <a href="#main" className="skip-link">Skip to content</a>
      <section className="relative overflow-hidden bg-[var(--color-pine)] text-white">
        <SettlingWaves />
        <header className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="QuietPay home">
            <Logo tone="dark" size={30} />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-white/70 hover:text-white md:block">How it works</a>
            <a href="#integrate" className="hidden rounded-lg px-3 py-2 text-white/70 hover:text-white md:block">Integrate</a>
            <Link href="/dashboard" className="rounded-lg px-3 py-2 text-white/80 hover:text-white">Sign in</Link>
            <Link href="/dashboard" className="ml-1 inline-flex h-9 items-center rounded-lg bg-white px-3.5 font-medium text-[var(--color-pine)] hover:bg-[var(--color-brand-soft)]">
              Get started
            </Link>
          </nav>
        </header>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-32 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <h1 className="text-[2.6rem] font-semibold leading-[1.05] sm:text-6xl">Get paid in USDT without the crypto noise.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              Checkout, payment links, subscriptions and refunds for any business, in about 20 lines of code. Customers sign in with email. Nobody pays gas.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/dashboard" className="inline-flex h-11 items-center rounded-lg bg-[var(--color-brand)] px-5 font-medium text-white shadow-[var(--shadow-card)] hover:bg-[#2bb389]">
                Start accepting USDT
              </Link>
              <a href={demoStoreUrl} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-white/25 px-5 font-medium text-white hover:bg-white/10">
                Try the demo store <ArrowUpRight className="h-4 w-4" aria-hidden />
              </a>
            </div>
            <div className="mt-10">
              <BuiltWith tone="dark" />
            </div>
          </div>
          <CodeTabs tabs={tabs} />
        </div>
      </section>

      <main id="main">
        <section id="how" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-20 sm:px-6">
          <h2 className="max-w-2xl text-3xl font-semibold sm:text-4xl">What happens when a customer pays</h2>
          <ol className="relative mt-12 grid gap-8 md:grid-cols-4 md:gap-6">
            <span className="absolute left-5 right-5 top-5 hidden h-px bg-[var(--color-line)] md:block" aria-hidden />
            {flow.map((f, i) => (
              <li key={f.title} className="relative">
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-line)] bg-white text-[var(--color-pine)] shadow-[var(--shadow-card)]">
                  <f.icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <p className="mt-4 text-xs font-medium text-[var(--color-brand)]">Step {i + 1}</p>
                <h3 className="mt-1 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{f.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-[var(--color-bg)]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="flex flex-col justify-between rounded-2xl bg-[var(--color-brand-soft)] p-8">
              <div>
                <h2 className="text-3xl font-semibold">A checkout your customers already understand</h2>
                <p className="mt-3 text-[var(--color-muted)]">
                  Hosted by QuietPay, so it works with any stack. Customers see items, a total in USDT and one button. The wallet stays out of sight.
                </p>
              </div>
              <div className="mt-10">
                <MiniCheckout />
              </div>
            </div>
            <div>
              <h2 className="text-3xl font-semibold">And everything after it</h2>
              <ul className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2">
                {more.map((m) => (
                  <li key={m.title} className="flex gap-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--color-pine)] shadow-[var(--shadow-card)]">
                      <m.icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div>
                      <h3 className="font-semibold">{m.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--color-muted)]">{m.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="integrate" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-20 sm:px-6">
          <h2 className="max-w-2xl text-3xl font-semibold sm:text-4xl">Live in an afternoon</h2>
          <p className="mt-3 max-w-2xl text-[var(--color-muted)]">
            Swag Counter, our demo store, runs exactly the code above. It never touches a wallet or the blockchain. It only talks to QuietPay.
          </p>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-[var(--color-line)] bg-white p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-pine)] text-white">
                    <s.icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="text-sm text-[var(--color-muted)]">Step {i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{s.body}</p>
                {s.code ? (
                  <div className="mt-4">
                    <CopyCode code={s.code} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="px-4 pb-20 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[var(--color-pine)] px-8 py-14 text-white sm:px-14">
            <div className="relative flex flex-wrap items-end justify-between gap-8">
              <div className="max-w-xl">
                <h2 className="text-3xl font-semibold sm:text-4xl">Take your first USDT payment today</h2>
                <p className="mt-3 text-white/75">Test mode runs on Whitechain Sepolia with the official test USDT, so you can try every flow for free.</p>
              </div>
              <Link href="/dashboard" className="inline-flex h-11 items-center rounded-lg bg-white px-5 font-medium text-[var(--color-pine)] hover:bg-[var(--color-brand-soft)]">
                Create your business
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-line)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto]">
          <div>
            <Logo size={26} />
            <p className="mt-3 max-w-sm text-sm text-[var(--color-muted)]">Stablecoin payments for businesses, on Whitechain.</p>
            <div className="mt-5">
              <BuiltWith compact />
            </div>
          </div>
          <div className="flex flex-col gap-2 text-sm md:items-end">
            <Link href="/dashboard" className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">Merchant dashboard</Link>
            <Link href="/portal" className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">Manage your subscriptions</Link>
            {QUIETPAY_ADDRESS ? (
              <a href={explorerAddress(QUIETPAY_ADDRESS)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                QuietPay contract on the explorer <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}

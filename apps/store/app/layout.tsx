import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Header, MobileNav } from "@/components/Header";
import { CartProvider } from "@/lib/cart";
import "./globals.css";

// Free lookalike for the reference site's (commercial) Roobert.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Swag Counter", template: "%s · Swag Counter" },
  description: "Hackathon swag, paid in USDT.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="relative isolate min-h-dvh font-sans antialiased">
        <CartProvider>
          {/* Pastel wash behind the header and the top of every page, fading to white. */}
          <div
            aria-hidden
            className="pastel-wash pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
          />
          <Header />
          <MobileNav />
          {children}
          <footer className="mx-auto mt-24 w-full max-w-6xl border-t border-[var(--color-line)] px-4 py-8 text-sm text-[var(--color-muted)] sm:px-6">
            Swag Counter is a demo merchant built at ETHGlobal Mumbai, not an official ETHGlobal store. Payments run on QuietPay in test USDT on Whitechain Sepolia.
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}

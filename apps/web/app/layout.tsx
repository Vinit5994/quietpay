import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const body = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const heading = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-heading", display: "swap" });
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "QuietPay",
  description: "Get paid in USDT on Whitechain: checkout, links, subscriptions and refunds.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

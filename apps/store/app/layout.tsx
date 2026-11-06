import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swag Counter",
  description: "Hackathon swag, paid in USDT.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <header className="flex items-center justify-between px-4 py-4">
          <Link href="/" className="font-bold">Swag Counter</Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/box">Builder Box</Link>
            <Link href="/cart">Cart</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}

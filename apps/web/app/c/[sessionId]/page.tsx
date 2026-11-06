import type { Metadata } from "next";
import { Checkout } from "@/components/checkout/Checkout";

export const metadata: Metadata = { title: "Checkout · QuietPay" };

export default async function CheckoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <Checkout sessionId={sessionId} />;
}

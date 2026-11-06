import type { Metadata } from "next";
import { Receipt } from "./Receipt";

export const metadata: Metadata = { title: "Receipt · QuietPay" };

export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return <Receipt paymentId={paymentId} />;
}

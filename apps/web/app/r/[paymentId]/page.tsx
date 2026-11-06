import { Planned } from "@/components/Planned";

export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return <Planned title={`Receipt ${paymentId}`} task="B9" />;
}

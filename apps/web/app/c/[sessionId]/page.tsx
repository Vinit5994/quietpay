import { Planned } from "@/components/Planned";

export default async function CheckoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <Planned title={`Checkout ${sessionId}`} task="B3" />;
}

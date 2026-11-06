import { Planned } from "@/components/Planned";

export default async function PaymentLinkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Planned title={`Payment link ${slug}`} task="B9" />;
}

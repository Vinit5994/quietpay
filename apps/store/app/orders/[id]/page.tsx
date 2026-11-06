import { Planned } from "@/components/Planned";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Planned title={`Order ${id}`} task="B5 / B6" />;
}

import { Planned } from "@/components/Planned";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Planned title={`Product ${id}`} task="B5" />;
}

import type { Metadata } from "next";
import { PaymentLink } from "./PaymentLink";

export const metadata: Metadata = { title: "Pay · QuietPay" };

export default async function PaymentLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ slug }, { status }] = await Promise.all([params, searchParams]);
  return <PaymentLink slug={slug} paid={status === "paid"} />;
}

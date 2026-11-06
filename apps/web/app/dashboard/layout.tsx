import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/Shell";

export const metadata: Metadata = { title: "Dashboard · QuietPay" };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}

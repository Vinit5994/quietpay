const styles = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  paid: "bg-green-50 text-green-800 ring-green-200",
  active: "bg-green-50 text-green-800 ring-green-200",
  partially_refunded: "bg-amber-50 text-amber-800 ring-amber-200",
  past_due: "bg-amber-50 text-amber-800 ring-amber-200",
  refunded: "bg-gray-100 text-gray-700 ring-gray-200",
  canceled: "bg-gray-100 text-gray-700 ring-gray-200",
  expired: "bg-gray-100 text-gray-700 ring-gray-200",
} as const;

const labels: Record<keyof typeof styles, string> = {
  pending: "Waiting for payment",
  paid: "Paid",
  active: "Active",
  partially_refunded: "Partially refunded",
  past_due: "Past due",
  refunded: "Refunded",
  canceled: "Canceled",
  expired: "Expired",
};

export function StatusChip({ status }: { status: keyof typeof styles }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${styles[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {labels[status]}
    </span>
  );
}

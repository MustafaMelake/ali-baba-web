import type { OrderStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

// Soft, accessible status palette (mirrors the /admin order pills).
const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  PREPARING: "bg-blue-50 text-blue-700 ring-blue-600/20",
  SHIPPED: "bg-violet-50 text-violet-700 ring-violet-600/20",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-red-50 text-red-700 ring-red-600/20",
};

export function statusLabel(status: OrderStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export default function StatusPill({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        STATUS_STYLES[status],
        className,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

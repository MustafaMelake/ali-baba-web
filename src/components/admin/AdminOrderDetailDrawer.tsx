"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  User,
  Phone,
  Mail,
  StickyNote,
  MapPin,
  Truck,
  Store,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { OrderStatus, FulfillmentMethod } from "@/generated/prisma/enums";
import { updateOrderStatus } from "@/lib/actions/orders";
import { formatEGP, prettyLabel } from "@/lib/utils";
import StatusPill from "@/components/orders/StatusPill";
import type { AdminOrderView } from "./order-types";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const STATUSES = Object.values(OrderStatus);

// Filled chip styling for the currently-selected status in the control.
const ACTIVE_CHIP: Record<OrderStatus, string> = {
  PENDING: "border-amber-300 bg-amber-50 text-amber-700",
  PREPARING: "border-blue-300 bg-blue-50 text-blue-700",
  SHIPPED: "border-violet-300 bg-violet-50 text-violet-700",
  DELIVERED: "border-emerald-300 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-red-300 bg-red-50 text-red-700",
};

function statusLabel(status: OrderStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

// ─── Interactive status control ──────────────────────────────────
// Keyed by order id in the parent so `optimistic` resets per order.
function StatusControl({
  orderId,
  current,
}: {
  orderId: string;
  current: OrderStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<OrderStatus | null>(null);

  const active = optimistic ?? current;

  function change(next: OrderStatus) {
    if (next === active || isPending) return;
    setOptimistic(next); // instant feedback

    startTransition(async () => {
      const res = await updateOrderStatus(orderId, next);
      if (!res.success) {
        setOptimistic(null); // roll back
        toast.error(res.error ?? "Could not update the order status.");
        return;
      }
      toast.success(`Order marked ${statusLabel(next)}`);
      // Re-sync the board + dashboard widgets (server already revalidated).
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">
          Status
        </h3>
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-400" />}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((status) => {
          const isActive = status === active;
          const loading = isPending && optimistic === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => change(status)}
              disabled={isPending}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-sans text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
                isActive
                  ? ACTIVE_CHIP[status]
                  : "border-stone-200 text-stone-500 hover:border-stone-300 hover:text-stone-800"
              }`}
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              {statusLabel(status)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminOrderDetailDrawer({
  order,
  open,
  onClose,
}: {
  order: AdminOrderView | null;
  open: boolean;
  onClose: () => void;
}) {
  // Escape to close + lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Portal renders client-side only; the drawer is closed on first paint.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && order && (
        <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-stone-950/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Slide-over panel */}
          <motion.aside
            className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col bg-[#FAFAFA] shadow-[-12px_0_48px_rgba(0,0,0,0.18)]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            {/* ── Header ─────────────────────────────────────── */}
            <header className="relative shrink-0 border-b border-stone-200/70 bg-white px-6 py-6 md:px-8">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              >
                <X className="h-5 w-5" />
              </button>

              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
                Manage Order
              </p>
              <div className="mt-2 flex items-center gap-3">
                <h2 className="font-serif text-3xl font-medium tracking-tight text-stone-900">
                  #{order.orderNumber}
                </h2>
                <StatusPill status={order.status} />
              </div>
              <p className="mt-1.5 font-sans text-sm text-stone-400">
                {order.dateTimeLabel}
              </p>
            </header>

            {/* ── Scrollable body ────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-6 py-7 md:px-8">
              {/* Status control — keyed so optimistic state resets per order */}
              <div className="mb-8 rounded-2xl border border-stone-200/70 bg-white p-5">
                <StatusControl
                  key={order.id}
                  orderId={order.id}
                  current={order.status}
                />
              </div>

              {/* Customer profile */}
              <Section title="Customer">
                <InfoRow icon={<User className="h-4 w-4" />} label="Name">
                  {order.customerName}
                </InfoRow>
                <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone">
                  <a
                    href={`tel:${order.customerPhone}`}
                    className="transition-colors hover:text-primary"
                  >
                    {order.customerPhone}
                  </a>
                </InfoRow>
                {order.userEmail && (
                  <InfoRow icon={<Mail className="h-4 w-4" />} label="Account">
                    <a
                      href={`mailto:${order.userEmail}`}
                      className="transition-colors hover:text-primary"
                    >
                      {order.userEmail}
                    </a>
                  </InfoRow>
                )}
                {order.orderNotes && (
                  <InfoRow icon={<StickyNote className="h-4 w-4" />} label="Notes">
                    {order.orderNotes}
                  </InfoRow>
                )}
              </Section>

              {/* Fulfillment logistics */}
              <Section title="Fulfillment">
                <InfoRow
                  icon={
                    order.fulfillment === FulfillmentMethod.DELIVERY ? (
                      <Truck className="h-4 w-4" />
                    ) : (
                      <Store className="h-4 w-4" />
                    )
                  }
                  label="Method"
                >
                  {order.fulfillment === FulfillmentMethod.DELIVERY
                    ? "Delivery"
                    : "Pickup"}
                </InfoRow>

                {order.fulfillment === FulfillmentMethod.DELIVERY ? (
                  <>
                    {order.deliveryCity && (
                      <InfoRow icon={<MapPin className="h-4 w-4" />} label="City">
                        {prettyLabel(order.deliveryCity)}
                      </InfoRow>
                    )}
                    {order.addressLine && (
                      <InfoRow icon={<MapPin className="h-4 w-4" />} label="Address">
                        {order.addressLine}
                      </InfoRow>
                    )}
                  </>
                ) : (
                  order.pickupBranch && (
                    <InfoRow icon={<Store className="h-4 w-4" />} label="Branch">
                      {order.pickupBranch}
                    </InfoRow>
                  )
                )}
              </Section>

              {/* Itemized receipt */}
              <Section title={`Items · ${order.itemCount}`}>
                <div className="rounded-2xl border border-stone-200/70 bg-white p-4 md:p-5">
                  <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_3.5rem_4rem] gap-x-3 pb-2 font-sans text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                    <span>Item</span>
                    <span className="text-center">Qty</span>
                    <span className="text-right">Unit</span>
                    <span className="text-right">Total</span>
                  </div>

                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[minmax(0,1fr)_2.25rem_3.5rem_4rem] items-center gap-x-3 border-t border-stone-100 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-sans text-sm font-medium text-stone-900">
                          {item.productName}
                        </p>
                        <p className="truncate font-sans text-xs text-stone-400">
                          {item.variantName}
                        </p>
                      </div>
                      <span className="text-center font-sans text-sm tabular-nums text-stone-600">
                        {item.quantity}
                      </span>
                      <span className="text-right font-sans text-sm tabular-nums text-stone-600">
                        {item.unitPrice.toLocaleString("en-EG")}
                      </span>
                      <span className="text-right font-sans text-sm font-semibold tabular-nums text-stone-900">
                        {item.lineTotal.toLocaleString("en-EG")}
                      </span>
                    </div>
                  ))}

                  <div className="mt-2 space-y-2 border-t border-stone-200 pt-4">
                    <SummaryRow label="Subtotal" value={formatEGP(order.subtotal)} />
                    <SummaryRow label="VAT (14%)" value={formatEGP(order.vat)} />
                    <SummaryRow
                      label="Delivery Fee"
                      value={order.deliveryFee > 0 ? formatEGP(order.deliveryFee) : "Free"}
                      accent={order.deliveryFee === 0}
                    />
                    <div className="flex items-baseline justify-between border-t border-stone-200 pt-3">
                      <span className="font-serif text-lg font-medium text-stone-900">
                        Total
                      </span>
                      <span className="font-serif text-xl font-medium text-stone-900 tabular-nums">
                        {formatEGP(order.totalAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              </Section>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ─── Sub-components ──────────────────────────────────────────────
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8 last:mb-0">
      <h3 className="mb-3 font-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-stone-400">
          {label}
        </p>
        <p className="font-sans text-sm leading-relaxed text-stone-800">{children}</p>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between font-sans text-sm">
      <span className="text-stone-500">{label}</span>
      <span
        className={
          accent
            ? "font-semibold text-primary tabular-nums"
            : "text-stone-700 tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

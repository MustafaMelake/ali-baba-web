"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Loader2,
  ArrowLeft,
  Check,
  Truck,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { useCartStore, type CartItem } from "@/lib/cart-store";
import { useSession } from "@/lib/auth-client";
import { placeOrder } from "@/lib/actions/orders";
import { getActiveBranches } from "@/lib/actions/branches";
import { clearDbCartAction } from "@/lib/actions/cart";
import { DeliveryLocation, FulfillmentMethod } from "@/generated/prisma/enums";
import { prettyLabel } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const DELIVERY_FEE = 35;
const TAX_RATE = 0.14; // 14% VAT

// Arabic sublabels are presentational only (not stored on the Branch model),
// keyed by branch slug. Seeded branches keep their bilingual label; any other
// branch simply shows its name.
const BRANCH_SUBLABELS: Record<string, string> = {
  menouf: "فرع منوف",
  beba: "بيبا كافيه",
};

type BranchOption = {
  id: string;
  slug: string;
  name: string;
  sublabel?: string;
};

// Cities we deliver to — values mirror the Prisma `DeliveryLocation` enum exactly,
// so the selected value drops straight into placeOrder()'s `deliveryCity` field.
const DELIVERY_CITIES = Object.values(DeliveryLocation);

// A cart line, normalized for display — `category` is always a string so the
// summary never has to guard against `undefined`.
type CheckoutItem = Omit<CartItem, "category"> & { category: string };

// ─── Sub-components ───────────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block font-sans text-[10px] font-bold uppercase tracking-[0.25em] text-stone-400 mb-2.5"
    >
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full bg-transparent border-b border-stone-300 pb-3 font-sans text-sm text-stone-900 placeholder:text-stone-300 outline-none transition-colors duration-250 focus:border-primary caret-primary"
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className="w-full bg-transparent border-b border-stone-300 pb-3 font-sans text-sm text-stone-900 placeholder:text-stone-300 outline-none transition-colors duration-250 focus:border-primary caret-primary resize-none"
    />
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-2xl md:text-[1.75rem] font-medium tracking-tight text-stone-900 mb-7">
      {children}
    </h2>
  );
}

function Divider() {
  return <div className="h-px bg-stone-100 my-9" />;
}

// ─── Fulfillment toggle ───────────────────────────────────────────
type Mode = "delivery" | "pickup";

function FulfillmentToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="relative flex rounded-full border border-stone-200 bg-stone-50 p-1 w-full max-w-xs">
      {/* Sliding background */}
      <motion.span
        layout
        layoutId="checkout-fulfillment-pill"
        className="absolute top-1 bottom-1 rounded-full bg-stone-900 shadow-sm"
        style={{
          width: "calc(50% - 4px)",
          left: mode === "delivery" ? 4 : "calc(50%)",
        }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
      />

      {(["delivery", "pickup"] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full font-sans text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors duration-300 ${
            mode === m ? "text-white" : "text-stone-500 hover:text-stone-700"
          }`}
        >
          {m === "delivery" ? (
            <Truck className="w-3.5 h-3.5" />
          ) : (
            <Store className="w-3.5 h-3.5" />
          )}
          {m === "delivery" ? "Delivery" : "Pickup"}
        </button>
      ))}
    </div>
  );
}

// ─── Branch dropdown ──────────────────────────────────────────────
// Driven by the live Branch table (ids resolved server-side), so the value it
// emits is a real `branchId` ready to stamp onto the order.
function BranchSelect({
  branches,
  value,
  onChange,
}: {
  branches: BranchOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (branches.length === 0) {
    return (
      <p className="border-b border-stone-200 pb-3 font-sans text-sm text-stone-400">
        No branches are available for pickup right now.
      </p>
    );
  }

  const selected = branches.find((b) => b.id === value) ?? branches[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between border-b border-stone-300 pb-3 text-left focus:outline-none focus:border-primary transition-colors group"
      >
        <span className="flex flex-col">
          <span className="font-sans text-sm font-medium text-stone-900">
            {selected.name}
          </span>
          {selected.sublabel && (
            <span className="font-sans text-xs text-stone-400 mt-0.5" dir="rtl">
              {selected.sublabel}
            </span>
          )}
        </span>
        <ChevronDown
          className="w-4 h-4 text-stone-400 group-hover:text-stone-700 transition-all duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            className="absolute top-full left-0 right-0 z-20 mt-1.5 bg-white rounded-xl border border-stone-200 shadow-[0_8px_32px_rgba(0,0,0,0.1)] overflow-hidden"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {branches.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={b.id === value}
                  onClick={() => {
                    onChange(b.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-stone-50 transition-colors text-left"
                >
                  <span className="flex flex-col">
                    <span className="font-sans text-sm font-medium text-stone-900">
                      {b.name}
                    </span>
                    {b.sublabel && (
                      <span
                        className="font-sans text-xs text-stone-400"
                        dir="rtl"
                      >
                        {b.sublabel}
                      </span>
                    )}
                  </span>
                  {b.id === value && (
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── City dropdown (strictly bound to the DeliveryLocation enum) ──
function CitySelect({
  value,
  onChange,
}: {
  value: DeliveryLocation;
  onChange: (v: DeliveryLocation) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between border-b border-stone-300 pb-3 text-left focus:outline-none focus:border-primary transition-colors group"
      >
        <span className="font-sans text-sm font-medium text-stone-900">
          {prettyLabel(value)}
        </span>
        <ChevronDown
          className="w-4 h-4 text-stone-400 group-hover:text-stone-700 transition-all duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            className="absolute top-full left-0 right-0 z-20 mt-1.5 bg-white rounded-xl border border-stone-200 shadow-[0_8px_32px_rgba(0,0,0,0.1)] overflow-hidden"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {DELIVERY_CITIES.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c === value}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-stone-50 transition-colors text-left"
                >
                  {/* Friendly text shown; the bound value stays the UPPERCASE enum. */}
                  <span className="font-sans text-sm font-medium text-stone-900">
                    {prettyLabel(c)}
                  </span>
                  {c === value && (
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Order Summary ────────────────────────────────────────────────
function OrderSummary({
  items,
  mode,
  loading,
  onSubmit,
}: {
  items: CheckoutItem[];
  mode: Mode;
  loading: boolean;
  onSubmit: () => void;
}) {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const delivery = mode === "pickup" ? 0 : DELIVERY_FEE;
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + delivery + tax;

  return (
    <div className="bg-stone-50 rounded-2xl p-6 md:p-8 border border-stone-100">
      <h2 className="font-serif text-2xl font-medium tracking-tight text-stone-900 mb-7">
        Order Summary
      </h2>

      {/* Item list */}
      <ul className="space-y-5 mb-7">
        {items.map((item) => (
          <li key={item.variantId} className="flex items-center gap-4">
            <div className="relative w-14 h-14 shrink-0 rounded-xl overflow-hidden bg-stone-200">
              <Image
                src={item.image}
                alt={item.name}
                fill
                className="object-cover"
                sizes="56px"
              />
              {item.quantity > 1 && (
                <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-stone-900 text-[9px] font-bold text-white">
                  {item.quantity}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm font-medium text-stone-900 truncate">
                {item.name}
              </p>
              <p className="font-sans text-xs text-stone-400">
                {item.category}
              </p>
            </div>
            <span className="shrink-0 font-sans text-sm font-semibold text-stone-900 tabular-nums">
              {(item.price * item.quantity).toLocaleString("en-EG")}
              <span className="font-normal text-stone-400 text-xs ml-0.5">
                ج.م
              </span>
            </span>
          </li>
        ))}
      </ul>

      {/* Totals */}
      <div className="border-t border-stone-200 pt-5 space-y-3">
        {[
          { label: "Subtotal", value: subtotal },
          {
            label: mode === "pickup" ? "Pickup" : "Delivery",
            value: delivery,
            free: mode === "pickup",
          },
          { label: "VAT (14%)", value: tax },
        ].map(({ label, value, free }) => (
          <div key={label} className="flex justify-between items-center">
            <span className="font-sans text-sm text-stone-500">{label}</span>
            {free ? (
              <span className="font-sans text-sm font-semibold text-primary">
                Free
              </span>
            ) : (
              <span className="font-sans text-sm text-stone-700 tabular-nums">
                {value.toLocaleString("en-EG")}
                <span className="text-stone-400 text-xs ml-0.5">ج.م</span>
              </span>
            )}
          </div>
        ))}

        <div className="border-t border-stone-200 pt-4 flex justify-between items-baseline">
          <span className="font-serif text-xl font-medium text-stone-900">
            Total
          </span>
          <span className="font-serif text-2xl font-medium text-stone-900 tabular-nums">
            {total.toLocaleString("en-EG")}
            <span className="font-sans font-normal text-sm text-stone-500 ml-1">
              ج.م
            </span>
          </span>
        </div>
      </div>

      {/* Place Order CTA */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={loading || items.length === 0}
        className="mt-7 relative w-full overflow-hidden rounded-full bg-stone-900 py-4 font-sans text-sm font-semibold uppercase tracking-widest text-white shadow-[0_4px_24px_rgba(0,0,0,0.22)] hover:bg-stone-700 active:scale-[0.99] transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
      >
        <AnimatePresence mode="wait" initial={false}>
          {loading ? (
            <motion.span
              key="loading"
              className="flex items-center justify-center gap-2.5"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing Transaction…
            </motion.span>
          ) : (
            <motion.span
              key="place"
              className="flex items-center justify-center gap-2.5"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              Place Order
              <span className="opacity-60">·</span>
              {total.toLocaleString("en-EG")} ج.م
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <p className="mt-4 text-center font-sans text-[11px] text-stone-400 leading-relaxed">
        Secure checkout · Your details are never stored without consent
      </p>
    </div>
  );
}

// ─── Empty cart state ─────────────────────────────────────────────
function EmptyCart() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] pt-16 md:pt-20 flex items-center justify-center px-6">
      <motion.div
        className="text-center max-w-md"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-8">
          <Store className="w-8 h-8 text-primary" strokeWidth={1.75} />
        </div>
        <h1 className="font-serif text-4xl md:text-5xl font-medium tracking-tight text-stone-900 mb-4">
          Your Cart is Empty
        </h1>
        <p className="font-sans text-base text-stone-500 leading-relaxed mb-8">
          Looks like you haven&apos;t added anything yet. Explore our collection
          and find something you&apos;ll love.
        </p>
        <Link
          href="/shop"
          className="inline-flex items-center gap-2.5 rounded-full bg-stone-900 px-8 py-3.5 font-sans text-sm font-semibold uppercase tracking-widest text-white hover:bg-stone-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Return to Shop
        </Link>
      </motion.div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────
export default function CheckoutPage() {
  const cartItems = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const isLoggedIn = !!useSession().data?.user;

  // The cart is persisted to localStorage and only rehydrates after mount, so the
  // first client render always sees an empty `items`. Track Zustand's hydration so
  // we don't flash "Your Cart is Empty" to a customer who actually has one. The
  // server snapshot is `false`, keeping SSR and the first client render identical.
  const hydrated = useSyncExternalStore(
    useCartStore.persist.onFinishHydration,
    () => useCartStore.persist.hasHydrated(),
    () => false,
  );

  // The Zustand cart is the single source of truth — no mock fallback. Normalize
  // each line so `category` is always a string for the summary.
  const items: CheckoutItem[] = cartItems.map((i) => ({
    ...i,
    category: i.category ?? "",
  }));

  // Form state
  const [mode, setMode] = useState<Mode>("delivery");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [apartment, setApartment] = useState("");
  const [city, setCity] = useState<DeliveryLocation>(DeliveryLocation.MENOUF);
  const [notes, setNotes] = useState("");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [placed, setPlaced] = useState(false);
  const [orderNumber, setOrderNumber] = useState<number | null>(null);

  // Load active branches for the pickup selector and resolve real ids — the
  // order stores branchId (for Branch-Manager RBAC), not just a free-text label.
  useEffect(() => {
    let alive = true;
    getActiveBranches()
      .then((rows) => {
        if (!alive) return;
        const opts: BranchOption[] = rows.map((b) => ({
          ...b,
          sublabel: BRANCH_SUBLABELS[b.slug],
        }));
        setBranches(opts);
        setBranchId((cur) => cur || opts[0]?.id || "");
      })
      .catch(() => {
        /* leave the selector empty; pickup still works without a stored branch */
      });
    return () => {
      alive = false;
    };
  }, []);

  function handleSubmit() {
    if (isPending || placed) return;

    // The Zustand cart is the source of truth for what's ordered — guard against a
    // race where the cart emptied between render and submit.
    if (cartItems.length === 0) {
      toast.error("Your cart is empty.");
      return;
    }
    if (!firstName.trim() || !phone.trim()) {
      toast.error("Please add your name and phone number.");
      return;
    }

    const addressLine = [address.trim(), apartment.trim()]
      .filter(Boolean)
      .join(", ");

    // Resolve the chosen pickup branch once — used for both the RBAC branchId
    // and the human-readable label persisted on the order.
    const selectedBranch =
      mode === "pickup" ? branches.find((b) => b.id === branchId) : undefined;

    startTransition(async () => {
      // Send only variantId + quantity — every price is re-resolved server-side.
      const res = await placeOrder({
        items: cartItems.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
        })),
        fulfillment:
          mode === "delivery"
            ? FulfillmentMethod.DELIVERY
            : FulfillmentMethod.PICKUP,
        deliveryCity: mode === "delivery" ? city : undefined,
        addressLine: mode === "delivery" ? addressLine : undefined,
        // Stamp the real branch id (RBAC) + keep the readable name as the label.
        branchId: selectedBranch?.id,
        pickupBranch: selectedBranch?.name,
        customerName: `${firstName} ${lastName}`.trim(),
        customerPhone: phone,
        orderNotes: notes.trim() || undefined,
      });

      if (!res.success) {
        toast.error(res.error);
        return;
      }

      // The order now owns these items — empty the cart everywhere. Locally
      // first (instant UI), then the DB when logged in so it doesn't re-hydrate.
      clearCart();
      if (isLoggedIn) void clearDbCartAction();
      setOrderNumber(res.orderNumber);
      setPlaced(true);
      toast.success(`Order #${res.orderNumber} placed — thank you!`);
    });
  }

  // Hold the background until the cart has rehydrated — prevents an empty-cart
  // flash for customers who already have items, and keeps SSR/CSR markup in sync.
  if (!hydrated) {
    return <div className="min-h-screen bg-[#FAFAFA]" />;
  }

  // Empty cart (and no order in flight) → premium empty state, never the form.
  if (!placed && items.length === 0) {
    return <EmptyCart />;
  }

  if (placed) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] pt-16 md:pt-20 flex items-center justify-center px-6">
        <motion.div
          className="text-center max-w-md"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-7">
            <Check className="w-7 h-7 text-primary" strokeWidth={2.5} />
          </div>
          <h1 className="font-serif text-4xl md:text-5xl font-medium tracking-tight text-stone-900 mb-4">
            Order Placed.
          </h1>
          {orderNumber != null && (
            <p className="font-sans text-sm font-semibold uppercase tracking-[0.2em] text-primary mb-3">
              Order #{orderNumber}
            </p>
          )}
          <p className="font-sans text-base text-stone-500 leading-relaxed mb-8">
            Thank you for choosing Ali Baba. Your order is being prepared with
            care — we&apos;ll be in touch shortly.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/my-orders"
              className="inline-flex items-center gap-2.5 rounded-full bg-stone-900 px-8 py-3.5 font-sans text-sm font-semibold uppercase tracking-widest text-white hover:bg-stone-700 transition-colors"
            >
              View My Orders
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 rounded-full border border-stone-200 px-8 py-3.5 font-sans text-sm font-semibold uppercase tracking-widest text-stone-600 hover:border-stone-400 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] pt-16 md:pt-20">
      <div className="max-w-7xl mx-auto px-6 md:px-10 lg:px-14 py-10 md:py-14">
        {/* Breadcrumb */}
        <div className="mb-10 flex items-center gap-2">
          <Link
            href="/shop"
            className="group flex items-center gap-1.5 font-sans text-xs uppercase tracking-[0.2em] text-stone-400 hover:text-stone-700 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            Back to Shop
          </Link>
        </div>

        <div className="lg:grid lg:grid-cols-12 lg:gap-12 xl:gap-16">
          {/* ── Left: Form ──────────────────────────────── */}
          <div className="lg:col-span-7 space-y-0">
            {/* 01 — Contact */}
            <section>
              <SectionHeading>Contact Information</SectionHeading>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div>
                  <FieldLabel htmlFor="firstName">First Name</FieldLabel>
                  <Input
                    id="firstName"
                    type="text"
                    autoComplete="given-name"
                    placeholder="Ahmed"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="lastName">Last Name</FieldLabel>
                  <Input
                    id="lastName"
                    type="text"
                    autoComplete="family-name"
                    placeholder="Hassan"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div>
                  <FieldLabel htmlFor="phone">Phone Number</FieldLabel>
                  <Input
                    id="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+20 100 000 0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="email">Email Address</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="ahmed@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <Divider />

            {/* 02 — Fulfillment */}
            <section>
              <SectionHeading>Fulfillment Method</SectionHeading>

              <FulfillmentToggle mode={mode} onChange={setMode} />

              <AnimatePresence mode="wait">
                {mode === "delivery" ? (
                  <motion.div
                    key="delivery-fields"
                    className="mt-9 space-y-8"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    <div>
                      <FieldLabel htmlFor="address">Street Address</FieldLabel>
                      <Input
                        id="address"
                        type="text"
                        autoComplete="street-address"
                        placeholder="12 El Corniche St."
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                      <div>
                        <FieldLabel htmlFor="apartment">
                          Apartment / Floor
                        </FieldLabel>
                        <Input
                          id="apartment"
                          type="text"
                          placeholder="Apt 4B (optional)"
                          value={apartment}
                          onChange={(e) => setApartment(e.target.value)}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="city">Delivery City</FieldLabel>
                        <CitySelect value={city} onChange={setCity} />
                      </div>
                    </div>

                    <div>
                      <FieldLabel htmlFor="notes">Delivery Notes</FieldLabel>
                      <Textarea
                        id="notes"
                        placeholder="Ring the bell twice, leave with the doorman…"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="pickup-fields"
                    className="mt-9"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    <FieldLabel htmlFor="branch">Choose Your Branch</FieldLabel>
                    <BranchSelect
                      branches={branches}
                      value={branchId}
                      onChange={setBranchId}
                    />

                    <p className="mt-4 font-sans text-[13px] text-stone-400 leading-relaxed">
                      Your order will be ready within{" "}
                      <span className="font-medium text-stone-600">
                        30 – 45 minutes
                      </span>
                      . You&apos;ll receive an SMS notification when it&apos;s
                      ready for collection.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <Divider />

            {/* 03 — Review note */}
            <section className="pb-12 lg:pb-0">
              <SectionHeading>Review Order</SectionHeading>
              <p className="font-sans text-sm text-stone-500 leading-relaxed max-w-md">
                Please review your selection in the summary panel. All items are
                made fresh to order — cancellations must be made within{" "}
                <span className="font-medium text-stone-700">15 minutes</span>{" "}
                of placing your order.
              </p>

              {/* Mobile-only CTA (above the sticky summary on small screens) */}
              <div className="mt-8 lg:hidden">
                <OrderSummary
                  items={items}
                  mode={mode}
                  loading={isPending}
                  onSubmit={handleSubmit}
                />
              </div>
            </section>
          </div>

          {/* ── Right: Order Summary (sticky on desktop) ─── */}
          <div className="hidden lg:block lg:col-span-5">
            <div className="sticky top-28">
              <OrderSummary
                items={items}
                mode={mode}
                loading={isPending}
                onSubmit={handleSubmit}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

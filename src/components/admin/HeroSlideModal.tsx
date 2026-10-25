"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  GalleryHorizontal,
  ImagePlus,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  createHeroSlide,
  updateHeroSlide,
  type HeroProductOption,
} from "@/lib/actions/hero-slides";
import { HERO_COPY, HERO_IMAGE_SIZE, type HeroSlideView } from "@/lib/hero-slides";
import { fieldErrors, heroSlideSchema, type HeroSlideInput } from "@/lib/validators";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { UploadDropzone } from "@/lib/uploadthing";
import { cn } from "@/lib/utils";
import { HERO_FRAME_ASPECT, HeroSlideFrame } from "@/components/HeroCarousel";
import type { HeroSlideAdminView } from "./HeroSlidesManager";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

const DEFAULT_CTA = "Order now";
const PICKER_LIMIT = 6;

/**
 * The width the desktop preview lays out at before it's scaled down to fit:
 * the modal is narrower than the frame's `@2xl` breakpoint, so an unscaled
 * frame would render the PHONE layout.
 */
const DESKTOP_PREVIEW_WIDTH = 1200;

type Destination = "product" | "link";

/** The collapsible groups of optional fields — all closed when the modal opens. */
type SectionKey = "text" | "price" | "schedule" | "advanced";

/** Which section holds each field, so a failed submit opens the one with the error. */
const SECTION_OF: Partial<Record<string, SectionKey>> = {
  eyebrow: "text",
  title: "text",
  subtitle: "text",
  ctaLabel: "text",
  startsOn: "schedule",
  endsOn: "schedule",
  imageAlt: "advanced",
};

// ── Small building blocks ────────────────────────────────────────────────────

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600">{message}</p>;
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-stone-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/**
 * A collapsible group of optional fields (native <details>, so the summary is
 * a real button for keyboards and screen readers). Controlled, so a failed
 * submit can open the group holding the error. `status` is a short note shown
 * while closed ("Added", "On"…), so nothing set inside is hidden from view.
 */
function Disclosure({
  title,
  status,
  open,
  onToggle,
  children,
}: {
  title: string;
  status?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
      className="group rounded-xl border border-stone-200"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {status && <span className="ms-2 text-xs font-normal text-primary">{status}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-stone-100 px-4 py-4">{children}</div>
    </details>
  );
}

/**
 * Lays its child out at a fixed `width` and scales it down to the space it
 * has, keeping the hero frame's aspect — how the desktop rendering fits in a
 * narrow modal. Hidden until measured, so it never flashes at full size.
 */
function ScaledToFit({ width, children }: { width: number; children: React.ReactNode }) {
  const [scale, setScale] = useState(0);
  const measure = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
      observer.observe(el);
      return () => observer.disconnect();
    },
    [width],
  );

  return (
    <div ref={measure} className={cn("relative w-full overflow-hidden rounded-xl", HERO_FRAME_ASPECT)}>
      <div
        className="absolute start-0 top-0 origin-top-left rtl:origin-top-right"
        style={{ width, transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </div>
  );
}

/** One image crop: a preview + Replace once set, the `heroImage` dropzone when empty. */
function ImageField({
  label,
  value,
  onChange,
  hint,
  aspect,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint: string;
  aspect: string;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      {value ? (
        <div className={cn("relative overflow-hidden rounded-xl border border-stone-200", aspect)}>
          {/* Plain <img> — UploadThing / /public URLs only. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute end-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-stone-900/70 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-900"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Replace
          </button>
        </div>
      ) : (
        <UploadDropzone
          endpoint="heroImage"
          // Styled via `appearance` (we don't import UploadThing's global
          // stylesheet — it ships a Tailwind v3 reset that breaks layout).
          appearance={{
            container:
              "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/60 px-6 py-6",
            uploadIcon: "text-stone-400",
            label: "text-sm font-medium text-stone-600 hover:text-primary",
            allowedContent: "text-xs text-stone-400",
            button:
              "rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 after:bg-primary/40",
          }}
          content={{ uploadIcon: <ImagePlus className="h-7 w-7 text-stone-400" /> }}
          onClientUploadComplete={(res) => {
            const uploaded = res[0]?.ufsUrl;
            if (uploaded) {
              onChange(uploaded);
              toast.success("Image uploaded");
            }
          }}
          onUploadError={(err) => {
            toast.error(err.message || "Image upload failed.");
          }}
        />
      )}
      <p className="text-xs text-stone-400">{hint}</p>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

/**
 * One controlled modal for BOTH create and edit (pass `slide` to edit). Built
 * for a non-technical admin: the image, where the banner leads and the Active
 * switch are always visible; everything optional (banner text, price,
 * schedule, screen-reader text) sits in collapsed sections. The form re-parses
 * the shared `heroSlideSchema` for instant feedback — the server re-parses it
 * regardless — and a live preview renders the slide with the storefront's own
 * frame, desktop (scaled to fit) and phone. On success it closes and
 * `router.refresh()`es the list.
 */
export default function HeroSlideModal({
  slide,
  products,
  isOpen,
  onClose,
}: {
  slide?: HeroSlideAdminView;
  products: HeroProductOption[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Focus moves in on open, Tab stays inside, and returns to the opener on close.
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen);
  const isEdit = Boolean(slide);

  const [destination, setDestination] = useState<Destination>("product");
  const [productId, setProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [showPrice, setShowPrice] = useState(true);
  // No longer in the form (the column stays): an existing eyebrow is sent back
  // unchanged, like the retired phone crop below.
  const [eyebrow, setEyebrow] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [ctaLabel, setCtaLabel] = useState(DEFAULT_CTA);
  const [imageDesktop, setImageDesktop] = useState("");
  // The retired 4:5 phone crop: no longer uploaded or shown, but an existing
  // value is sent back unchanged so saving neither clears it nor purges it.
  const [imageMobile, setImageMobile] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [openSections, setOpenSections] = useState<ReadonlySet<SectionKey>>(() => new Set());

  const toggleSection = (key: SectionKey) => (open: boolean) =>
    setOpenSections((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  // Sync the form to the row each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: prime the form on open */
    setDestination(slide?.linkUrl ? "link" : "product");
    setProductId(slide?.productId ?? "");
    setProductQuery("");
    setLinkUrl(slide?.linkUrl ?? "");
    setShowPrice(slide?.showPrice ?? true);
    setEyebrow(slide?.eyebrow ?? "");
    setTitle(slide?.title ?? "");
    setSubtitle(slide?.subtitle ?? "");
    setCtaLabel(slide?.ctaLabel ?? DEFAULT_CTA);
    setImageDesktop(slide?.imageDesktop ?? "");
    setImageMobile(slide?.imageMobile ?? "");
    setImageAlt(slide?.imageAlt ?? "");
    setStartsOn(slide?.startsOn ?? "");
    setEndsOn(slide?.endsOn ?? "");
    // A new slide is created inactive — published deliberately.
    setIsActive(slide?.isActive ?? false);
    setSubmitted(false);
    setOpenSections(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, slide]);

  // Esc to close + lock background scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, isPending, onClose]);

  const payload: HeroSlideInput = {
    eyebrow,
    title,
    subtitle,
    ctaLabel,
    showPrice,
    imageDesktop,
    imageMobile,
    imageAlt,
    productId: destination === "product" ? productId : null,
    linkUrl: destination === "link" ? linkUrl : null,
    isActive,
    startsOn,
    endsOn,
  };
  const parsed = heroSlideSchema.safeParse(payload);
  // Errors surface after the first submit attempt, not while typing.
  const errors = !parsed.success && submitted ? fieldErrors(parsed.error) : {};

  const selectedProduct = products.find((p) => p.id === productId) ?? null;
  const query = productQuery.trim().toLowerCase();
  const matches = query
    ? products.filter((p) => p.name.toLowerCase().includes(query)).slice(0, PICKER_LIMIT)
    : [];

  // The preview reuses the storefront frame; the live price can't be resolved
  // here, so a placeholder pill marks where it will sit.
  const preview: HeroSlideView = {
    id: "preview",
    eyebrow: eyebrow.trim() || null,
    title: title.trim() || null,
    subtitle: subtitle.trim() || null,
    ctaLabel: ctaLabel.trim() || DEFAULT_CTA,
    href: "#",
    imageDesktop,
    imageAlt,
    price: null,
  };
  // "Show price" means something only once a product is picked.
  const productPicked = destination === "product" && Boolean(productId);
  const pricePlaceholder =
    productPicked && showPrice ? `${HERO_COPY.priceFrom} ··· ${HERO_COPY.currency}` : undefined;
  const previewMedia = imageDesktop && (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageDesktop} alt="" className="absolute inset-0 h-full w-full object-cover" />
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!parsed.success) {
      // Open every collapsed section that holds an error, so it can be seen.
      const withErrors = Object.keys(fieldErrors(parsed.error))
        .map((field) => SECTION_OF[field])
        .filter((key): key is SectionKey => Boolean(key));
      if (withErrors.length) setOpenSections((prev) => new Set([...prev, ...withErrors]));
      return;
    }

    startTransition(async () => {
      const result =
        isEdit && slide
          ? await updateHeroSlide(slide.id, payload)
          : await createHeroSlide(payload);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(isEdit ? "Slide updated" : "Slide added");
      onClose();
      router.refresh();
    });
  }


  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => !isPending && onClose()}
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "Edit hero slide" : "Add hero slide"}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <GalleryHorizontal className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                      {isEdit ? "Edit Slide" : "New Slide"}
                    </p>
                    <h3 className="font-serif text-xl font-medium text-stone-900">
                      {isEdit ? "Edit this banner" : "Add a homepage banner"}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !isPending && onClose()}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                {/* ── Always visible: image, destination, Active ── */}
                <div className="space-y-1">
                  <ImageField
                    label="Image"
                    value={imageDesktop}
                    onChange={setImageDesktop}
                    aspect={HERO_FRAME_ASPECT}
                    hint={`${HERO_IMAGE_SIZE.width} × ${HERO_IMAGE_SIZE.height} px — the same image is used on phones, so keep text large and away from the edges.`}
                  />
                  <FieldError message={errors.imageDesktop} />
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium text-stone-700">Where does it lead?</legend>
                  <div className="inline-flex rounded-full bg-stone-100 p-1">
                    {(
                      [
                        { value: "product", label: "A product", icon: Package },
                        { value: "link", label: "A link", icon: Link2 },
                      ] as const
                    ).map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={destination === value}
                        onClick={() => setDestination(value)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                          destination === value ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>

                  {destination === "product" ? (
                    <div className="space-y-2">
                      {selectedProduct ? (
                        <div className="flex items-center gap-3 rounded-xl border border-stone-200 px-3 py-2.5">
                          {selectedProduct.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={selectedProduct.image} alt="" className="h-10 w-10 rounded-lg object-cover" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-stone-900">{selectedProduct.name}</p>
                            {!selectedProduct.isListable && (
                              <p className="text-xs text-amber-700">
                                Not available right now — the slide stays hidden until it is.
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setProductId("")}
                            className="rounded-full border border-stone-200 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <>
                          <label htmlFor="hero-product-search" className="sr-only">
                            Search products
                          </label>
                          <div className="relative">
                            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                            <input
                              id="hero-product-search"
                              value={productQuery}
                              onChange={(e) => setProductQuery(e.target.value)}
                              placeholder="Search products by name…"
                              className={cn(inputClasses, "ps-10")}
                              autoComplete="off"
                            />
                          </div>
                          {query && (
                            <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
                              {matches.length === 0 ? (
                                <li className="px-3.5 py-3 text-sm text-stone-400">No products match.</li>
                              ) : (
                                matches.map((p) => (
                                  <li key={p.id}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setProductId(p.id);
                                        setProductQuery("");
                                      }}
                                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start transition-colors hover:bg-stone-50"
                                    >
                                      {p.image ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={p.image} alt="" className="h-8 w-8 rounded-md object-cover" />
                                      ) : (
                                        <span className="h-8 w-8 rounded-md bg-stone-100" />
                                      )}
                                      <span className="min-w-0 flex-1 truncate text-sm text-stone-800">{p.name}</span>
                                      {!p.isListable && (
                                        <span className="shrink-0 text-xs text-amber-700">Unavailable</span>
                                      )}
                                    </button>
                                  </li>
                                ))
                              )}
                            </ul>
                          )}
                        </>
                      )}
                      <FieldError message={errors.productId} />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label htmlFor="hero-link" className="sr-only">
                        Link
                      </label>
                      <input
                        id="hero-link"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="/new-arrivals or https://…"
                        className={inputClasses}
                        dir="ltr"
                      />
                      <FieldError message={errors.linkUrl ?? errors.productId} />
                      <p className="text-xs text-stone-400">
                        A page on this site (&ldquo;/…&rdquo;), a section (&ldquo;#…&rdquo;), or a full https:// address.
                      </p>
                    </div>
                  )}
                </fieldset>

                <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-700">Active</p>
                    <p className="text-xs text-stone-400">
                      Inactive slides never show on the storefront.
                    </p>
                  </div>
                  <Switch checked={isActive} onChange={setIsActive} label="Toggle active" />
                </div>

                {/* ── Live preview — the storefront frame, desktop and phone ── */}
                <div className="space-y-3 rounded-2xl bg-stone-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400">
                    Live preview
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-stone-500">Desktop</p>
                    <ScaledToFit width={DESKTOP_PREVIEW_WIDTH}>
                      <HeroSlideFrame
                        slide={preview}
                        linked={false}
                        pricePlaceholder={pricePlaceholder}
                        className={HERO_FRAME_ASPECT}
                        media={previewMedia}
                      />
                    </ScaledToFit>
                  </div>
                  <div className="flex items-end gap-4">
                    <div className="w-[min(100%,21.5rem)] shrink-0 space-y-1.5">
                      <p className="text-xs font-medium text-stone-500">Phone</p>
                      <HeroSlideFrame
                        slide={preview}
                        linked={false}
                        pricePlaceholder={pricePlaceholder}
                        className={cn(HERO_FRAME_ASPECT, "rounded-xl")}
                        media={previewMedia}
                      />
                    </div>
                    <p className="hidden pb-1 text-xs leading-relaxed text-stone-400 sm:block">
                      On phones only the button sits on the image.
                      {pricePlaceholder && " The price pill shows the product's live starting price on the storefront."}
                    </p>
                  </div>
                </div>

                {/* ── Optional — collapsed until opened ── */}
                <div className="space-y-3">
                  <Disclosure
                    title="Text on the banner (optional)"
                    status={title.trim() || subtitle.trim() || ctaLabel.trim() !== DEFAULT_CTA ? "Added" : undefined}
                    open={openSections.has("text")}
                    onToggle={toggleSection("text")}
                  >
                    <p className="text-xs text-stone-400">
                      Leave empty if the image already has its own text. On phones only the button is shown.
                    </p>
                    <div className="space-y-1.5">
                      <label htmlFor="hero-title" className="text-sm font-medium text-stone-700">
                        Headline
                      </label>
                      <input
                        id="hero-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Pistachio Kunafa is here"
                        className={inputClasses}
                        maxLength={90}
                      />
                      <FieldError message={errors.title} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="hero-subtitle" className="text-sm font-medium text-stone-700">
                        Subtitle
                      </label>
                      <input
                        id="hero-subtitle"
                        value={subtitle}
                        onChange={(e) => setSubtitle(e.target.value)}
                        className={inputClasses}
                        maxLength={200}
                      />
                      <FieldError message={errors.subtitle} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="hero-cta" className="text-sm font-medium text-stone-700">
                        Button label
                      </label>
                      <input
                        id="hero-cta"
                        value={ctaLabel}
                        onChange={(e) => setCtaLabel(e.target.value)}
                        className={inputClasses}
                        maxLength={30}
                      />
                      <FieldError message={errors.ctaLabel} />
                    </div>
                  </Disclosure>

                  {productPicked && (
                    <Disclosure
                      title="Show price"
                      status={showPrice ? "On" : "Off"}
                      open={openSections.has("price")}
                      onToggle={toggleSection("price")}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-xs text-stone-400">
                          The product&apos;s live starting price, discounts included — on the desktop banner.
                        </p>
                        <Switch checked={showPrice} onChange={setShowPrice} label="Toggle price" />
                      </div>
                    </Disclosure>
                  )}

                  <Disclosure
                    title="Schedule (optional)"
                    status={startsOn || endsOn ? "Scheduled" : undefined}
                    open={openSections.has("schedule")}
                    onToggle={toggleSection("schedule")}
                  >
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label htmlFor="hero-starts" className="text-sm font-medium text-stone-700">
                          Starts
                        </label>
                        <input
                          id="hero-starts"
                          type="date"
                          value={startsOn}
                          onChange={(e) => setStartsOn(e.target.value)}
                          className={inputClasses}
                        />
                        <FieldError message={errors.startsOn} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="hero-ends" className="text-sm font-medium text-stone-700">
                          Ends
                        </label>
                        <input
                          id="hero-ends"
                          type="date"
                          value={endsOn}
                          onChange={(e) => setEndsOn(e.target.value)}
                          className={inputClasses}
                        />
                        <FieldError message={errors.endsOn} />
                      </div>
                    </div>
                    <p className="text-xs text-stone-400">
                      Cairo calendar days — a slide runs from the start of its first day to the end
                      of its last. Leave both empty to run until you switch it off.
                    </p>
                  </Disclosure>

                  <Disclosure
                    title="Advanced"
                    status={imageAlt.trim() ? "Added" : undefined}
                    open={openSections.has("advanced")}
                    onToggle={toggleSection("advanced")}
                  >
                    <div className="space-y-1.5">
                      <label htmlFor="hero-alt" className="text-sm font-medium text-stone-700">
                        Screen-reader text (not shown on the banner)
                      </label>
                      <textarea
                        id="hero-alt"
                        value={imageAlt}
                        onChange={(e) => setImageAlt(e.target.value)}
                        rows={2}
                        maxLength={300}
                        placeholder="A tray of pistachio kunafa with the words “New: Pistachio Kunafa”"
                        className={cn(inputClasses, "resize-y leading-relaxed")}
                      />
                      <FieldError message={errors.imageAlt} />
                      <p className="text-xs text-stone-400">
                        Read aloud to visitors who can&apos;t see the image — include any words written on it.
                        Leave empty to use the headline, or else the product&apos;s name.
                      </p>
                    </div>
                  </Disclosure>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 border-t border-stone-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => onClose()}
                  disabled={isPending}
                  className="rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isEdit ? "Saving…" : "Adding…"}
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {isEdit ? "Save Changes" : "Add Slide"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

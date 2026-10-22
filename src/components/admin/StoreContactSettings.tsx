"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { updateStoreWhatsapp } from "@/lib/actions/store-settings";
import { formatPhoneLocal } from "@/lib/utils";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * Admin → Settings: the store's WhatsApp number. Customers who forgot their
 * password are handed off to it from /forgot-password. The server normalizes
 * whatever is typed (010…, +20…, Arabic digits) to canonical E.164; a blank
 * save clears it.
 */
export default function StoreContactSettings({
  whatsappNumber,
}: {
  whatsappNumber: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(whatsappNumber ? formatPhoneLocal(whatsappNumber) : "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateStoreWhatsapp({ whatsappNumber: value });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(value.trim() ? "WhatsApp number saved" : "WhatsApp number cleared");
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3 border-b border-stone-100 pb-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessageCircle className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-serif text-xl font-medium text-stone-900">Store WhatsApp</h2>
          <p className="text-xs text-stone-400">
            Customers who forget their password message this number from the sign-in page.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor="store-whatsapp" className="text-sm font-medium text-stone-700">
            WhatsApp number
          </label>
          <input
            id="store-whatsapp"
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="010 1234 5678"
            className={`${inputClasses} text-start tabular-nums`}
            maxLength={30}
          />
          <p className="text-xs text-stone-400">An Egyptian mobile. Leave empty to turn the hand-off off.</p>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:mb-6"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save
        </button>
      </form>
    </section>
  );
}

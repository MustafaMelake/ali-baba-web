"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { whatsappHref } from "@/lib/utils";

/** Page strings, kept out of the markup (the Arabic locale swaps this table). */
const COPY = {
  back: "Back to sign in",
  eyebrow: "Account help",
  title: "Forgot your password?",
  intro:
    "Message us on WhatsApp with the email or phone number on your account. We'll reset it and send you a temporary password to sign in with.",
  fieldLabel: "Email or phone on your account",
  fieldPlaceholder: "you@example.com or 010 1234 5678",
  cta: "Message us on WhatsApp",
  message: (account: string) => `I forgot my password — account: ${account}`,
  unavailableTitle: "Contact the store",
  unavailable:
    "Please contact the store directly and we'll help you get back into your account.",
} as const;

const ACCOUNT_MAX = 120;

/**
 * The forgot-password hand-off: builds a wa.me link to the store's number with
 * a prefilled message naming the account. Nothing is sent to our server and
 * nothing is looked up — an admin verifies the customer on WhatsApp before
 * resetting (no user enumeration from this page).
 */
export default function ForgotPasswordClient({
  storeWhatsapp,
}: {
  storeWhatsapp: string | null;
}) {
  const [account, setAccount] = useState("");
  const trimmed = account.trim().slice(0, ACCOUNT_MAX);
  const href = storeWhatsapp && trimmed ? whatsappHref(storeWhatsapp, COPY.message(trimmed)) : null;

  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center bg-[#FAFAFA] px-6 py-16">
      <div className="w-full max-w-md">
        <Link
          href="/login"
          className="group inline-flex items-center gap-2 font-sans text-xs font-medium uppercase tracking-[0.2em] text-stone-400 transition-colors hover:text-stone-700"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5 rtl:-scale-x-100" />
          {COPY.back}
        </Link>

        <p className="mt-10 font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
          {COPY.eyebrow}
        </p>
        <h1 className="mt-4 font-serif text-4xl font-medium tracking-tight text-stone-900 md:text-5xl">
          {storeWhatsapp ? COPY.title : COPY.unavailableTitle}
        </h1>

        {storeWhatsapp ? (
          <>
            <p className="mt-5 font-sans text-sm leading-relaxed text-stone-500">{COPY.intro}</p>

            <div className="mt-9">
              <label
                htmlFor="account"
                className="mb-3 block font-sans text-[10px] font-semibold uppercase tracking-[0.25em] text-stone-400"
              >
                {COPY.fieldLabel}
              </label>
              <input
                id="account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                maxLength={ACCOUNT_MAX}
                autoComplete="username"
                placeholder={COPY.fieldPlaceholder}
                className="w-full border-b border-stone-300 bg-transparent pb-3 text-start font-sans text-base text-stone-900 caret-primary outline-none transition-colors duration-300 placeholder:text-stone-300 focus:border-primary"
              />
            </div>

            <a
              href={href ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!href}
              onClick={(e) => {
                if (!href) e.preventDefault();
              }}
              className={`mt-9 flex w-full items-center justify-center gap-3 rounded-full px-8 py-4 font-sans text-sm font-semibold uppercase tracking-widest text-white transition-colors duration-300 ${
                href ? "bg-emerald-700 hover:bg-emerald-800" : "cursor-not-allowed bg-stone-300"
              }`}
            >
              <MessageCircle className="h-4 w-4" />
              {COPY.cta}
            </a>
          </>
        ) : (
          <p className="mt-5 font-sans text-sm leading-relaxed text-stone-500">{COPY.unavailable}</p>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

/**
 * Newsletter signup — the footer's only interactive element, isolated as a
 * client island so the surrounding Footer stays a zero-JS Server Component.
 * Owns the email input and the inline post-submit confirmation.
 */
export default function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
    setEmail("");
    // TODO: wire to newsletter provider (ESP API / DB).
    setTimeout(() => setSubmitted(false), 4000);
  }

  if (submitted) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="pb-3 border-b border-white/20"
      >
        <span dir="rtl" lang="ar" className="block font-sans text-sm text-primary/80 tracking-wide">
          تم الاشتراك بنجاح
        </span>
        <span className="mt-1 block font-sans text-xs text-white/40">
          Thank you — we&apos;ll be in touch.
        </span>
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-3 border-b border-white/20 pb-3 focus-within:border-white/45 transition-colors duration-300"
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email address"
        aria-label="Your email address"
        className="bg-transparent flex-1 text-sm font-sans text-white/80 placeholder:text-white/20 outline-none caret-primary"
      />
      <button
        type="submit"
        aria-label="Subscribe to newsletter"
        className="shrink-0 text-white/35 hover:text-white transition-colors duration-200"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  );
}

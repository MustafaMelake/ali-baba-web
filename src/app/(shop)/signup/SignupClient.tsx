"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { signUp } from "@/lib/auth-client";
import { sanitizeRedirect } from "@/lib/utils";

// Cinematic cubic-bezier — fast start, silky deceleration
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, ease: EASE, delay },
  };
}

export default function SignupClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Carried over from /login (whose own ?redirect= was set by src/proxy.ts
  // bouncing an unauthenticated visit to a protected route). Honoring it here
  // means "bounced → chose Sign Up instead → registered" still lands the user
  // on the page they originally wanted, exactly like the login flow.
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"));

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await signUp.email({
        name,
        email,
        password,
        // Forwarded for completeness (only redirect-based flows act on it) —
        // the router.push below is what actually navigates.
        callbackURL: redirectTo,
      });

      if (error) {
        setError(
          error.message ?? "Unable to create your account. Please try again."
        );
        setLoading(false);
        return;
      }

      // router.refresh() lets CartSyncProvider observe the new session and
      // fold a guest cart into the fresh account, same as the login flow.
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    // <div>, not <main> — the (shop) layout already provides the one <main> landmark.
    <div className="min-h-screen w-full bg-[#FAFAFA] lg:grid lg:grid-cols-2">
      {/* ─── Form panel (left on desktop) ───────────────────── */}
      <section className="order-2 lg:order-1 flex items-center justify-center px-6 py-16 sm:px-10 md:py-20">
        <div className="w-full max-w-md">
          {/* Back to home */}
          <motion.div {...fadeUp(0)}>
            <Link
              href="/"
              className="group inline-flex items-center gap-2 text-xs font-sans font-medium uppercase tracking-[0.2em] text-stone-400 hover:text-stone-700 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
              Back to Home
            </Link>
          </motion.div>

          {/* Heading */}
          <motion.div className="mt-10" {...fadeUp(0.08)}>
            <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.3em] text-primary">
              Membership
            </span>
            <h1 className="mt-4 font-serif text-5xl md:text-6xl font-medium tracking-tight leading-[1.02] text-stone-900">
              Join the <br />
              <em className="not-italic text-primary">Inner Circle.</em>
            </h1>
            <p className="mt-5 font-sans text-sm text-stone-500 leading-relaxed">
              Create your account for early access to seasonal drops, private
              tastings, and bespoke orders.
            </p>
          </motion.div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-sans text-red-600"
              role="alert"
            >
              {error}
            </motion.div>
          )}

          {/* Form */}
          <motion.form
            onSubmit={handleSubmit}
            className="mt-9 space-y-8"
            {...fadeUp(0.16)}
          >
            {/* Name */}
            <div className="group">
              <label
                htmlFor="name"
                className="block text-[10px] font-sans font-semibold uppercase tracking-[0.25em] text-stone-400 mb-3"
              >
                Full Name
              </label>
              <input
                id="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full bg-transparent border-b border-stone-300 pb-3 text-base font-sans text-stone-900 placeholder:text-stone-300 outline-none transition-colors duration-300 focus:border-primary caret-primary"
              />
            </div>

            {/* Email */}
            <div className="group">
              <label
                htmlFor="email"
                className="block text-[10px] font-sans font-semibold uppercase tracking-[0.25em] text-stone-400 mb-3"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-transparent border-b border-stone-300 pb-3 text-base font-sans text-stone-900 placeholder:text-stone-300 outline-none transition-colors duration-300 focus:border-primary caret-primary"
              />
            </div>

            {/* Password */}
            <div className="group">
              <label
                htmlFor="password"
                className="block text-[10px] font-sans font-semibold uppercase tracking-[0.25em] text-stone-400 mb-3"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full bg-transparent border-b border-stone-300 pb-3 text-base font-sans text-stone-900 placeholder:text-stone-300 outline-none transition-colors duration-300 focus:border-primary caret-primary"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="group relative flex w-full items-center justify-center gap-3 rounded-full bg-stone-900 px-8 py-4 text-sm font-sans font-semibold uppercase tracking-widest text-white transition-all duration-300 hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAFAFA] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating account…
                </>
              ) : (
                <>
                  Create Account
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                </>
              )}
            </button>
          </motion.form>

          {/* Toggle to login — keeps the redirect intent through the round-trip */}
          <motion.p
            className="mt-10 text-center font-sans text-sm text-stone-500"
            {...fadeUp(0.24)}
          >
            Already a member?{" "}
            <Link
              href={
                redirectTo === "/"
                  ? "/login"
                  : `/login?redirect=${encodeURIComponent(redirectTo)}`
              }
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </motion.p>
        </div>
      </section>

      {/* ─── Visual panel (right on desktop) ────────────────── */}
      <aside className="relative order-1 lg:order-2 hidden lg:block overflow-hidden">
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.8, ease: EASE }}
        >
          <Image
            src="/cake4.jpg"
            alt="Ali Baba — signature confections"
            fill
            priority
            className="object-cover object-center"
            sizes="50vw"
          />
        </motion.div>

        {/* Veil */}
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-stone-950/20 to-stone-950/30" />

        {/* Brand mark */}
        <motion.div
          className="absolute top-10 right-10"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
        >
          <Link
            href="/"
            className="font-serif text-2xl font-medium tracking-tight text-white/90"
          >
            Ali Baba
          </Link>
        </motion.div>

        {/* Editorial caption */}
        <motion.div
          className="absolute bottom-12 left-10 right-10 text-right"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.5 }}
        >
          <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.35em] text-white/50">
            The Inner Circle
          </span>
          <p className="mt-4 font-serif italic text-3xl leading-snug text-white/90 ml-auto max-w-md">
            A seat at the table, reserved for you.
          </p>
        </motion.div>
      </aside>
    </div>
  );
}

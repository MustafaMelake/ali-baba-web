"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { signIn } from "@/lib/auth-client";
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

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Set by src/proxy.ts when it redirects an unauthenticated visit to a
  // protected route (e.g. /my-orders) — sends the user back there post-login.
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error } = await signIn.email({
        email,
        password,
        // Better Auth's vanilla email sign-in doesn't auto-navigate on success
        // (callbackURL is only acted on by redirect-based flows like OAuth or
        // email verification) — forwarded for completeness, but the
        // router.push below is what actually sends the user back.
        callbackURL: redirectTo,
      });

      if (error) {
        setError(
          error.message ?? "Unable to sign in. Please check your details."
        );
        setLoading(false);
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen w-full bg-[#FAFAFA] lg:grid lg:grid-cols-2">
      {/* ─── Visual panel ───────────────────────────────────── */}
      <aside className="relative hidden lg:block overflow-hidden">
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.8, ease: EASE }}
        >
          <Image
            src="/our-story2.png"
            alt="Ali Baba — hand-crafted oriental pastry"
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
          className="absolute top-10 left-10"
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
          className="absolute bottom-12 left-10 right-10"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.5 }}
        >
          <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.35em] text-white/50">
            Est. 1998
          </span>
          <p className="mt-4 font-serif italic text-3xl leading-snug text-white/90 max-w-md">
            Where every visit feels like coming home.
          </p>
        </motion.div>
      </aside>

      {/* ─── Form panel ─────────────────────────────────────── */}
      <section className="flex items-center justify-center px-6 py-16 sm:px-10 md:py-20">
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
              Welcome
            </span>
            <h1 className="mt-4 font-serif text-5xl md:text-6xl font-medium tracking-tight leading-[1.02] text-stone-900">
              Welcome <br />
              <em className="not-italic text-primary">Back.</em>
            </h1>
            <p className="mt-5 font-sans text-sm text-stone-500 leading-relaxed">
              Sign in to access your account, saved favourites, and bespoke
              orders.
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
              <div className="flex items-center justify-between mb-3">
                <label
                  htmlFor="password"
                  className="block text-[10px] font-sans font-semibold uppercase tracking-[0.25em] text-stone-400"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-[11px] font-sans text-stone-400 hover:text-primary transition-colors"
                >
                  Forgot?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
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
                  Authenticating…
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                </>
              )}
            </button>
          </motion.form>

          {/* Toggle to signup */}
          <motion.p
            className="mt-10 text-center font-sans text-sm text-stone-500"
            {...fadeUp(0.24)}
          >
            New to Ali Baba?{" "}
            <Link
              href="/signup"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </motion.p>
        </div>
      </section>
    </main>
  );
}

import { Suspense } from "react";
import LoginClient from "./LoginClient";

/**
 * Static shell shown only while LoginClient suspends on `useSearchParams()`
 * (Next.js requires a Suspense boundary around any reader of search params,
 * to avoid the route bailing out to fully client-side rendering at build time).
 * In practice this resolves on the server during normal SSR — visible mainly
 * on fast client-side navigations — so it's sized to match the real layout
 * and reuses the `animate-pulse` convention already used for the navbar's
 * auth skeleton, rather than a blank flash.
 */
function LoginFallback() {
  return (
    <main className="min-h-screen w-full bg-[#FAFAFA] lg:grid lg:grid-cols-2" aria-hidden="true">
      <aside className="hidden lg:block bg-stone-100" />
      <section className="flex items-center justify-center px-6 py-16 sm:px-10 md:py-20">
        <div className="w-full max-w-md animate-pulse space-y-8">
          <div className="h-3 w-28 rounded-full bg-stone-200" />
          <div className="space-y-3">
            <div className="h-12 w-2/3 rounded-lg bg-stone-200" />
            <div className="h-12 w-1/2 rounded-lg bg-stone-200" />
          </div>
          <div className="space-y-6 pt-2">
            <div className="h-11 rounded-lg bg-stone-200" />
            <div className="h-11 rounded-lg bg-stone-200" />
            <div className="h-12 rounded-full bg-stone-200" />
          </div>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}

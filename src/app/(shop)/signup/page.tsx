import { Suspense } from "react";
import SignupClient from "./SignupClient";

/**
 * Static shell shown only while SignupClient suspends on `useSearchParams()`
 * (Next.js requires a Suspense boundary around any reader of search params,
 * to avoid the route bailing out to fully client-side rendering at build
 * time). Same convention as /login: an `animate-pulse` skeleton sized to the
 * real two-column layout, so there's no blank flash on client navigations.
 */
function SignupFallback() {
  return (
    <div
      className="min-h-screen w-full bg-[#FAFAFA] lg:grid lg:grid-cols-2"
      aria-hidden="true"
    >
      <section className="order-2 lg:order-1 flex items-center justify-center px-6 py-16 sm:px-10 md:py-20">
        <div className="w-full max-w-md animate-pulse space-y-8">
          <div className="h-3 w-28 rounded-full bg-stone-200" />
          <div className="space-y-3">
            <div className="h-12 w-2/3 rounded-lg bg-stone-200" />
            <div className="h-12 w-1/2 rounded-lg bg-stone-200" />
          </div>
          <div className="space-y-6 pt-2">
            <div className="h-11 rounded-lg bg-stone-200" />
            <div className="h-11 rounded-lg bg-stone-200" />
            <div className="h-11 rounded-lg bg-stone-200" />
            <div className="h-12 rounded-full bg-stone-200" />
          </div>
        </div>
      </section>
      <aside className="order-1 lg:order-2 hidden lg:block bg-stone-100" />
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<SignupFallback />}>
      <SignupClient />
    </Suspense>
  );
}

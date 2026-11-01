"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackVisit } from "@/lib/visit-tracker";

/**
 * Reports a page view on every storefront navigation (mounted once in the (shop)
 * layout). Client-side on purpose: the catalog pages are served from the ISR
 * cache, where no server code runs per visit. Reads only the pathname — never
 * `useSearchParams()`, which would need a Suspense boundary and would put query
 * strings in the log. Renders nothing.
 */
export default function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    trackVisit("view", { path: pathname });
  }, [pathname]);

  return null;
}

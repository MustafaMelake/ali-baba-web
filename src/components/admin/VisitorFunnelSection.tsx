import { getVisitorFunnel } from "@/lib/actions/dashboard";
import VisitorFunnelCard from "@/components/admin/VisitorFunnelCard";

/**
 * The dashboard's visitor card as its own async Server Component (audit H-2).
 *
 * The page renders it under <Suspense fallback={<VisitorFunnelFallback />}>,
 * OUTSIDE the stats Promise.all, so revenue, counters and recent orders never
 * wait on visitor analytics — and a failed analytics query only swaps this
 * card for a small notice instead of blanking the whole dashboard. Analytics
 * are decoration next to the money: they must fail quietly.
 */
export default async function VisitorFunnelSection() {
  let visitors: Awaited<ReturnType<typeof getVisitorFunnel>>;
  try {
    visitors = await getVisitorFunnel();
  } catch (err) {
    console.error("Visitor funnel unavailable — the dashboard renders without it:", err);
    return <VisitorFunnelFallback state="error" />;
  }
  return (
    <VisitorFunnelCard week={visitors.week} month={visitors.month} branchScoped={visitors.branchScoped} />
  );
}

/** The card's footprint while loading (Suspense), or a quiet notice when the query failed. */
export function VisitorFunnelFallback({ state = "loading" }: { state?: "loading" | "error" }) {
  return (
    <section
      aria-label="Visitors"
      aria-busy={state === "loading"}
      className="mt-6 rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm"
    >
      <h2 className="font-serif text-lg font-medium text-stone-900">Visitors</h2>
      {state === "loading" ? (
        <div className="mt-4 h-40 animate-pulse rounded-xl bg-stone-100" />
      ) : (
        <p className="mt-2 text-sm text-stone-500">
          Visitor stats are unavailable right now. Revenue and orders above are unaffected — try
          refreshing in a minute.
        </p>
      )}
    </section>
  );
}

import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import Sidebar from "@/components/admin/Sidebar";
import TopHeader from "@/components/admin/TopHeader";

export const metadata = {
  title: "Admin | Ali Baba",
};

/**
 * Authoritative authorization gate for the ENTIRE /admin/* surface.
 * Enforced on the server — never trust the client.
 *
 *   - not signed in        -> /login
 *   - signed in, not ADMIN -> /
 *
 * Layout shell:
 *   A single flex ROW locked to the viewport height. The Sidebar is a real
 *   in-flow column (w-64, shrink-0) and the content column is `flex-1 min-w-0`
 *   — so there is NO `fixed` + padding-offset coupling that could leave phantom
 *   whitespace if the rail ever fails to render. `min-w-0` lets wide tables
 *   scroll inside the main pane instead of stretching the layout.
 *
 * NB: we deliberately do NOT import "@uploadthing/react/styles.css" here — that
 * file bundles a Tailwind v3 reset + plain `.hidden`/`.flex` rules that override
 * our v4 responsive variants and collapse the sidebar. UploadThing widgets are
 * styled locally via their `appearance` prop instead.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/");

  return (
    <div className="flex h-screen overflow-hidden bg-[#FAFAFA]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader user={session.user} />

        {/* The only scroll container, so the rail and header stay put. */}
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

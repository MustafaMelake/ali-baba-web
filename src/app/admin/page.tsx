import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "@/lib/session";

export const metadata = {
  title: "Admin Dashboard | Ali Baba",
};

/**
 * Server Component route guard.
 *
 * Authorization is enforced HERE on the server — never trust the client.
 * The Navbar only *hides* the admin link for non-admins (UX); this page is
 * what actually *blocks* access. A user typing /admin manually is redirected.
 */
export default async function AdminDashboardPage() {
  const session = await getServerSession();

  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/");

  return (
    <main className="min-h-screen bg-[#FAFAFA] px-6 py-24 md:px-12">
      <div className="mx-auto max-w-5xl">
        <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.3em] text-primary">
          Control Room
        </span>
        <h1 className="mt-3 font-serif text-5xl font-medium tracking-tight text-stone-900">
          Admin Dashboard
        </h1>
        <p className="mt-4 max-w-xl font-sans text-stone-500">
          Welcome back,{" "}
          <span className="font-medium text-stone-800">
            {session.user.name}
          </span>
          . You have full administrative access.
        </p>

        <div className="mt-12">
          <Link
            href="/"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            ← Back to store
          </Link>
        </div>
      </div>
    </main>
  );
}

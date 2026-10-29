import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminFromCookies } from "@/lib/server/moderation";
import { AdminPanel } from "@/components/admin/AdminPanel";

export const metadata: Metadata = { title: "Moderation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Moderators only (POKEIQ_ADMINS); anyone else sees "not found". Every action is checked again by /api/admin. */
export default async function AdminPage() {
  const admin = await adminFromCookies();
  if (!admin) notFound();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <p className="hud-label">Signed in as {admin.username}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">
          Moderation <span className="text-primary">desk</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Link href="/admin/geo-flags" className="underline-offset-2 hover:underline" data-testid="admin-geo-flags-link">
            PokéGuessr flags
          </Link>
        </p>
      </div>
      <AdminPanel />
    </div>
  );
}

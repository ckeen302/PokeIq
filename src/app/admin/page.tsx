import type { Metadata } from "next";
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
      </div>
      <AdminPanel />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminFromCookies } from "@/lib/server/moderation";
import { GEO_FLAG_MS, GEO_FLAG_PX, flaggedPlayers } from "@/lib/server/geo-round-scores";

export const metadata: Metadata = { title: "PokéGuessr flags", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const when = (at: number) => (at ? new Date(at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "—");

/**
 * Moderators only (POKEIQ_ADMINS; anyone else sees "not found"): the trainers
 * whose PokéGuessr rounds the server flagged, with counts. Flags are hints
 * for a human, never a sanction: nothing here bans or changes a score.
 */
export default async function GeoFlagsPage() {
  const admin = await adminFromCookies();
  if (!admin) notFound();
  const players = await flaggedPlayers();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <p className="hud-label">
          <Link href="/admin" className="hover:text-foreground">
            Moderation desk
          </Link>{" "}
          · Signed in as {admin.username}
        </p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">
          PokéGuessr <span className="text-primary">flags</span>
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Rounds the server found impossible-looking: <strong>flagged</strong> is a pin within {GEO_FLAG_PX} px of the place under {GEO_FLAG_MS / 1000} s of the round being
          dealt; <strong>fast perfects</strong> counts every perfect score that quick (once can be luck; a pattern across games is not). Hints for a look, not verdicts: nothing is
          automatic.
        </p>
      </div>
      {players === null ? (
        <p className="text-sm text-muted-foreground" data-testid="geo-flags-off">
          Flags aren&apos;t stored on this server (no database, or migration 0045_geo_flags.sql isn&apos;t applied yet).
        </p>
      ) : players.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="geo-flags-empty">
          Nothing flagged. Every round so far looks like a human played it.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full rounded-lg border bg-card text-sm" data-testid="geo-flags">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Trainer</th>
                <th className="px-3 py-2 text-right">Flagged</th>
                <th className="px-3 py-2 text-right">Fast perfects</th>
                <th className="px-3 py-2 text-right">Games</th>
                <th className="px-3 py-2 text-right">Rounds</th>
                <th className="px-3 py-2">Last flag</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.key} className="border-t" data-testid="geo-flag-row">
                  <td className="px-3 py-1.5">
                    {p.name ? (
                      <Link href={`/u/${encodeURIComponent(p.name)}`} className="font-semibold hover:text-screen">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground" title={p.key}>
                        guest · {p.key.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{p.flagged}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.fast}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.games}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.rounds}</td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{when(p.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

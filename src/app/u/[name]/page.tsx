import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, CalendarDays, Clapperboard, Search, Swords } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { USERNAME_RE } from "@/lib/server/auth";
import { findUserByName, progressDigests } from "@/lib/server/accounts";
import { connDigest } from "@/lib/server/friends";
import { battleKey } from "@/lib/server/battle-engine/identity";
import { battleProfile } from "@/lib/server/battle-engine/records";
import { replayStore } from "@/lib/server/battle-engine/replays";
import { insightsAvailable } from "@/lib/server/battle-engine/insights";
import { rankedKey, rankedStore } from "@/lib/server/ranked";
import { geoRankedKey, geoRankedStandingOf } from "@/lib/server/geo-ranked";
import { geoStatsKey, playerGeoStats } from "@/lib/server/geo-round-scores";
import { bestStreakOf } from "@/lib/server/geo-streak";
import { GeoProfileStats } from "@/components/geo/GeoProfileStats";
import { utcDay, type GeoRankedStanding } from "@/lib/geo-ranked";
import { GeoDivisionBadge } from "@/components/geo/GeoRanked";
import { avatarsByIds } from "@/lib/server/avatars";
import { aboutFor } from "@/lib/server/about";
import { pokemonName } from "@/lib/about-validate";
import { AboutMe } from "@/components/community/AboutMe";
import { Avatar } from "@/components/avatar/Avatar";
import { Avatar3D } from "@/components/trainer3d/Avatar3D";
import { BattleProfileView } from "@/components/battle/BattleProfileView";
import { GlickoBadge } from "@/components/battle/GlickoBadge";
import { ReplayRow } from "@/components/battle/ReplayLists";
import { TierBadge } from "@/components/pokedle/Ranked";
import { ProfileActions } from "@/components/community/ProfileActions";
import { Card, CardContent } from "@/components/ui/card";
import type { RankedStanding } from "@/lib/ranked";
import type { ReplaySummary } from "@/lib/battle/replay";

interface PageProps {
  params: Promise<{ name: string }>;
}

export const dynamic = "force-dynamic";


const quietly = <T,>(label: string, p: Promise<T> | undefined | null, fallback: T): Promise<T> =>
  (p ?? Promise.resolve(fallback)).catch((err) => {
    console.error(`[profile] ${label}:`, err);
    return fallback;
  });

/**
 * A trainer's public profile: everything here is public (ratings,
 * records, public replays). Online status and what they're playing are not:
 * those show to their friends only, through the friends panel.
 */
const findProfile = cache(async (raw: string) => {
  const name = decodeURIComponent(raw);
  if (!USERNAME_RE.test(name)) return null;
  const user = await findUserByName(name).catch(() => null);
  if (!user) return null;
  const key = battleKey(`u:${user.id}`);
  const replays = replayStore();
  const ranked = rankedStore();
  const [digest, battles, pokedle, guessr, mine, avatars, about, insights, geoStats, geoStreak] = await Promise.all([
    quietly("progress", progressDigests([user.id]).then((m) => m.get(user.id) ?? null), null),
    quietly("battles", battleProfile(key), null),
    quietly<RankedStanding | null>("pokedle", ranked?.standing(rankedKey(`u:${user.id}`)), null),
    quietly<GeoRankedStanding | null>("guessr", geoRankedStandingOf(geoRankedKey(`u:${user.id}`), utcDay(Date.now())), null),
    quietly<ReplaySummary[]>("replays", replays?.mine(key, [], 30), []),
    avatarsByIds([user.id]),
    aboutFor(user.id),
    quietly("insights", insightsAvailable(), false),
    quietly("geo-stats", playerGeoStats(geoStatsKey(`u:${user.id}`)), null),
    quietly("geo-streak", bestStreakOf(geoStatsKey(`u:${user.id}`)), null),
  ]);
  return {
    username: user.username,
    joined: user.createdAt,
    avatar: avatars.get(user.id) ?? null,
    battles,
    pokedle,
    guessr,
    geoStats,
    geoStreak,
    connections: connDigest(digest),
    about,
    aboutNames: Object.fromEntries(Object.entries(about.pokemon).map(([slot, p]) => [slot, pokemonName(p.id) ?? ""])),
    replays: mine.filter((r) => r.public).slice(0, 6),
    // Team insights: linked once they're available here (migration 0041) and there are battles to read.
    insights: insights && !!battles?.recent.length,
  };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await findProfile((await params).name);
  if (!found) return pageMetadata({ title: "Trainer not found", description: "No such trainer on PokéIQ.", noindex: true });
  return pageMetadata({
    title: `${found.username} · Trainer profile`,
    description: `${found.username} on PokéIQ: Pokédle, PokéGuessr and battle ratings, battle records and recent replays.`,
    path: `/u/${encodeURIComponent(found.username)}`,
  });
}

export default async function UserProfilePage({ params }: PageProps) {
  const found = await findProfile((await params).name);
  if (!found) notFound();
  const now = Date.now();
  const rated = found.battles?.formats.filter((f) => f.rating !== undefined) ?? [];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackButton href="/users" label="Back to trainers" />
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/users" className="flex items-center gap-1 text-screen hover:text-foreground">
          <Search className="h-3 w-3" aria-hidden /> Find a trainer
        </Link>
      </nav>

      <section className="hud relative overflow-hidden rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar avatar={found.avatar} size={80} />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h1 className="truncate font-display text-4xl font-bold tracking-tight" data-testid="profile-name">
                {found.username}
              </h1>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Trainer since {new Date(found.joined).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </p>
            </div>
            <ProfileActions username={found.username} />
          </div>
          {found.avatar?.trainer && (
            // Their 3D trainer (three.js loads only on profiles that have one).
            <div className="-mb-6 h-56 w-full sm:-my-6 sm:h-72 sm:w-96" data-testid="profile-trainer">
              <Avatar3D config={found.avatar.trainer} pose="wave" label={`${found.username}'s trainer`} />
            </div>
          )}
        </div>
      </section>

      <AboutMe username={found.username} initial={found.about} names={found.aboutNames} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="hud-label text-screen">Ranked Pokédle</p>
            {found.pokedle && found.pokedle.games > 0 ? (
              <div className="space-y-2">
                <TierBadge rating={found.pokedle.rating} games={found.pokedle.games} />
                <p className="text-sm text-muted-foreground">
                  {found.pokedle.wins}–{found.pokedle.losses}
                  {found.pokedle.draws ? `–${found.pokedle.draws}` : ""} in {found.pokedle.games} ranked duels
                  {found.pokedle.position ? ` · #${found.pokedle.position} of ${found.pokedle.players}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No ranked Pokédle duels yet.</p>
            )}
          </CardContent>
        </Card>
        <Card data-testid="profile-guessr">
          <CardContent className="space-y-3 p-5">
            <p className="hud-label text-screen">Ranked PokéGuessr</p>
            {found.guessr && found.guessr.games > 0 ? (
              <div className="space-y-2">
                <GeoDivisionBadge elo={found.guessr.elo} />
                <p className="text-sm text-muted-foreground">
                  {found.guessr.wins}–{found.guessr.losses}
                  {found.guessr.draws ? `–${found.guessr.draws}` : ""} in {found.guessr.games} ranked duels
                  {found.guessr.position ? ` · #${found.guessr.position} of ${found.guessr.players}` : ""}
                  {found.guessr.bestScore > 0 ? ` · best ${found.guessr.bestScore.toLocaleString("en-US")} pts` : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No ranked PokéGuessr duels yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="hud-label text-screen">Battle ladder</p>
            {rated.length ? (
              <ul className="space-y-2">
                {rated.slice(0, 4).map((f) => (
                  <li key={f.format} className="flex items-center justify-between gap-3" data-testid="profile-ladder-format">
                    <span className="truncate text-sm font-semibold">{f.formatName}</span>
                    <span className="flex flex-col items-end gap-0.5">
                      {/* Elo leads (the ladder's rating, on the same scale as ranked Pokédle's tiers); GXE and Glicko-2 follow. */}
                      <TierBadge rating={f.elo ?? f.rating!} games={f.elo === undefined ? f.ratedGames : undefined} size="sm" />
                      <GlickoBadge rating={f.rating!} rd={f.rd} gxe={f.gxe} elo={f.elo} headline={false} size="sm" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No ranked battles yet.</p>
            )}
          </CardContent>
        </Card>
        <Card className="md:col-span-2" data-testid="profile-connections">
          <CardContent className="space-y-3 p-5">
            <p className="hud-label text-screen">PokéConnections</p>
            {found.connections ? (
              <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
                {[
                  ["Streak", `🔥${found.connections.streak}`],
                  ["Best streak", found.connections.best],
                  ["Games won", found.connections.wins],
                  ["Perfect solves", found.connections.perfect],
                  ["Duel record", `${found.connections.duelWins}–${found.connections.duelLosses}${found.connections.duelDraws ? `–${found.connections.duelDraws}` : ""}`],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col-reverse rounded-md border bg-shade/20 p-2">
                    <dt className="text-[11px] text-muted-foreground">{label}</dt>
                    <dd className="font-display text-xl font-bold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No PokéConnections played yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <GeoProfileStats stats={found.geoStats} streak={found.geoStreak} />

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="hud-label flex items-center gap-1.5 text-screen">
              <Swords className="h-3.5 w-3.5" aria-hidden /> Battle record
            </p>
            {found.insights && (
              <Link href={`/battle/insights/${encodeURIComponent(found.username)}`} className="hud-label flex items-center gap-1 hover:text-foreground" data-testid="profile-insights">
                <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Team insights →
              </Link>
            )}
          </div>
          {found.battles ? (
            <BattleProfileView profile={{ ...found.battles, name: found.username }} now={now} empty={`${found.username} hasn't played a live battle yet.`} />
          ) : (
            <p className="text-sm text-muted-foreground">Battle records open soon.</p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <p className="hud-label flex items-center gap-1.5">
          <Clapperboard className="h-3.5 w-3.5" aria-hidden /> Recent public replays
        </p>
        {found.replays.length ? (
          <div className="space-y-2" data-testid="profile-replays">
            {found.replays.map((r) => (
              <ReplayRow key={r.id} r={r} now={now} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No public replays yet.</p>
        )}
      </section>
    </div>
  );
}

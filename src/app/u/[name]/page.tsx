import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clapperboard, Search, Swords } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { USERNAME_RE } from "@/lib/server/auth";
import { findUserByName, progressDigests } from "@/lib/server/accounts";
import { connDigest } from "@/lib/server/friends";
import { battleKey } from "@/lib/server/battle-engine/identity";
import { battleProfile } from "@/lib/server/battle-engine/records";
import { replayStore } from "@/lib/server/battle-engine/replays";
import { rankedKey, rankedStore } from "@/lib/server/ranked";
import { avatarsByIds } from "@/lib/server/avatars";
import { aboutFor } from "@/lib/server/about";
import { pokemonName } from "@/lib/about-validate";
import { AboutMe } from "@/components/community/AboutMe";
import { Avatar } from "@/components/avatar/Avatar";
import { BattleProfileView } from "@/components/battle/BattleProfileView";
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

/** Trainer level from XP (the same curve as levelInfo in lib/progress). */
const levelOf = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;

const quietly = <T,>(label: string, p: Promise<T> | undefined | null, fallback: T): Promise<T> =>
  (p ?? Promise.resolve(fallback)).catch((err) => {
    console.error(`[profile] ${label}:`, err);
    return fallback;
  });

/**
 * A trainer's public profile: everything here is public (level, ratings,
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
  const [digest, battles, pokedle, mine, avatars, about] = await Promise.all([
    quietly("progress", progressDigests([user.id]).then((m) => m.get(user.id) ?? null), null),
    quietly("battles", battleProfile(key), null),
    quietly<RankedStanding | null>("pokedle", ranked?.standing(rankedKey(`u:${user.id}`)), null),
    quietly<ReplaySummary[]>("replays", replays?.mine(key, [], 30), []),
    avatarsByIds([user.id]),
    aboutFor(user.id),
  ]);
  return {
    username: user.username,
    joined: user.createdAt,
    avatar: avatars.get(user.id) ?? null,
    level: levelOf(digest?.xp ?? 0),
    xp: digest?.xp ?? 0,
    battles,
    pokedle,
    connections: connDigest(digest),
    about,
    aboutNames: Object.fromEntries(Object.entries(about.pokemon).map(([slot, p]) => [slot, pokemonName(p.id) ?? ""])),
    replays: mine.filter((r) => r.public).slice(0, 6),
  };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await findProfile((await params).name);
  if (!found) return pageMetadata({ title: "Trainer not found", description: "No such trainer on PokéIQ.", noindex: true });
  return pageMetadata({
    title: `${found.username} · Trainer profile`,
    description: `${found.username} on PokéIQ: trainer level, Pokédle and battle ratings, battle records and recent replays.`,
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
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/users" className="flex items-center gap-1 text-screen hover:text-foreground">
          <Search className="h-3 w-3" aria-hidden /> Find a trainer
        </Link>
      </nav>

      <section className="hud relative overflow-hidden rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar avatar={found.avatar} size={80} />
          <span className="screen flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-lg text-screen">
            <span className="relative z-[3] font-pixel text-[10px]">LV</span>
            <span className="relative z-[3] font-display text-3xl font-bold">{found.level}</span>
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h1 className="truncate font-display text-4xl font-bold tracking-tight" data-testid="profile-name">
                {found.username}
              </h1>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Trainer since {new Date(found.joined).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                <span aria-hidden>·</span> {found.xp.toLocaleString("en-US")} XP
              </p>
            </div>
            <ProfileActions username={found.username} />
          </div>
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
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="hud-label text-screen">Battle ladder</p>
            {rated.length ? (
              <ul className="space-y-2">
                {rated.slice(0, 4).map((f) => (
                  <li key={f.format} className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold">{f.formatName}</span>
                    <TierBadge rating={f.rating!} games={f.ratedGames} size="sm" />
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

      <Card>
        <CardContent className="space-y-4 p-5">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            <Swords className="h-3.5 w-3.5" aria-hidden /> Battle record
          </p>
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

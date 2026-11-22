import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { cache } from "react";
import Link from "@/components/ui/Link";
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
import { geoRankedKey, geoRankedStandingOf, geoSeasonHistoryOf } from "@/lib/server/geo-ranked";
import { GeoSeasonHistory } from "@/components/geo/GeoSeason";
import { geoStatsKey, playerGeoStats } from "@/lib/server/geo-round-scores";
import { geoProgressFor } from "@/lib/server/geo-progress";
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
import { TierBadge } from "@/components/duel/TierBadge";
import { ProfileActions } from "@/components/community/ProfileActions";
import { Card, CardContent } from "@/components/ui/card";
import { QuizBests } from "@/components/community/QuizBests";
import { neaBests, quizBests } from "@/lib/quiz-bests";
import { neaPlayerKey, neaStore } from "@/lib/server/name-em-all-board";
import type { ReplaySummary } from "@/lib/battle/replay";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import { INTL_LOCALE, formatNumber } from "@/i18n/catalog";
import { speciesName } from "@/lib/names/species";
import { aboutLocal } from "@/lib/about-local";
import tier from "@/messages/tier";
import profile from "@/messages/profile";
import friends from "@/messages/friends";
import addFriend from "@/messages/add-friend";
import aboutMe from "@/messages/about-me";
import geoRecord from "@/messages/geo-record";
import geoNames from "@/messages/geo-names";
import guessrRanked from "@/messages/guessr-ranked";
import quizModes from "@/messages/quiz-modes";

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
  // The database being down isn't "no such trainer": the page says profiles are unavailable instead.
  const user = await findUserByName(name).catch((err) => {
    console.error("[profile] account lookup failed:", err instanceof Error ? err.message : err);
    return "unavailable" as const;
  });
  if (user === "unavailable") return user;
  if (!user) return null;
  const key = battleKey(`u:${user.id}`);
  const replays = replayStore();
  const [digest, battles, guessr, mine, avatars, about, insights, geoStats, geoStreak, geoSeasons, geoProgress, nea] = await Promise.all([
    quietly("progress", progressDigests([user.id], { bests: true }).then((m) => m.get(user.id) ?? null), null),
    quietly("battles", battleProfile(key), null),
    quietly<GeoRankedStanding | null>("guessr", geoRankedStandingOf(geoRankedKey(`u:${user.id}`), utcDay(Date.now())), null),
    quietly<ReplaySummary[]>("replays", replays?.mine(key, [], 30), []),
    avatarsByIds([user.id]),
    aboutFor(user.id),
    quietly("insights", insightsAvailable(), false),
    quietly("geo-stats", playerGeoStats(geoStatsKey(`u:${user.id}`)), null),
    quietly("geo-streak", bestStreakOf(geoStatsKey(`u:${user.id}`)), null),
    quietly("geo-seasons", geoSeasonHistoryOf(geoRankedKey(`u:${user.id}`)), []),
    quietly("geo-progress", geoProgressFor({ key: geoStatsKey(`u:${user.id}`), userId: user.id, username: user.username }), null),
    // Name 'em All's checked runs under their account (one indexed lookup).
    quietly("name-em-all", neaStore()?.mine(neaPlayerKey(`u:${user.id}`)), null),
  ]);
  return {
    username: user.username,
    joined: user.createdAt,
    avatar: avatars.get(user.id) ?? null,
    battles,
    guessr,
    geoStats,
    geoStreak,
    geoSeasons,
    geoProgress,
    connections: connDigest(digest),
    quizBests: quizBests(digest?.best),
    neaBests: neaBests(nea),
    about,
    aboutNames: Object.fromEntries(Object.entries(about.pokemon).map(([slot, p]) => [slot, pokemonName(p.id) ?? ""])),
    replays: mine.filter((r) => r.public).slice(0, 6),
    // Team insights: linked once they're available here (migration 0041) and there are battles to read.
    insights: insights && !!battles?.recent.length,
  };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await findProfile((await params).name);
  const t = serverT(profile);
  if (found === "unavailable") return pageMetadata({ title: t("meta.unavailableTitle"), description: t("meta.unavailableDescription"), noindex: true });
  if (!found) return pageMetadata({ title: t("meta.notFoundTitle"), description: t("meta.notFoundDescription"), noindex: true });
  return pageMetadata({
    title: t("meta.title", { name: found.username }),
    description: t("meta.description", { name: found.username }),
    path: `/u/${encodeURIComponent(found.username)}`,
  });
}

export default async function UserProfilePage({ params }: PageProps) {
  const found = await findProfile((await params).name);
  if (!found) notFound();
  const t = serverT(profile);
  if (found === "unavailable") {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <BackButton href="/users" label={t("back")} />
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" data-testid="profile-unavailable">
            {t("unavailable")}
          </CardContent>
        </Card>
      </div>
    );
  }
  const now = Date.now();
  const rated = found.battles?.formats.filter((f) => f.rating !== undefined) ?? [];
  const en = t.locale === "en";
  // A page in another language names the picked Pokémon in it (forms keep their English name) and the game choices.
  const aboutNames = en ? found.aboutNames : Object.fromEntries(Object.entries(found.about.pokemon).map(([slot, p]) => [slot, p.id <= 1025 ? speciesName(p.id, found.aboutNames[slot], t.locale) : found.aboutNames[slot]]));
  return (
    <ClientMessages namespaces={[friends, addFriend, aboutMe, geoRecord, geoNames, guessrRanked, quizModes]}>
    <div className="mx-auto max-w-4xl space-y-6">
      <BackButton href="/users" label={t("back")} />
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/users" className="flex items-center gap-1 text-screen hover:text-foreground">
          <Search className="h-3 w-3" aria-hidden /> {t("find")}
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
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {t("since", { date: new Date(found.joined).toLocaleDateString(INTL_LOCALE[t.locale], { month: "long", year: "numeric" }) })}
              </p>
            </div>
            <ProfileActions username={found.username} />
          </div>
          {found.avatar?.trainer && (
            // Their 3D trainer (three.js loads only on profiles that have one).
            <div className={found.avatar.trainer.stage === "plain" ? "-mb-6 h-56 w-full sm:-my-6 sm:h-72 sm:w-96" : "h-56 w-full overflow-hidden rounded-lg border sm:h-72 sm:w-96"} data-testid="profile-trainer">
              <Avatar3D config={found.avatar.trainer} pose="victory" stage label={t("trainerOf", { name: found.username })} />
            </div>
          )}
        </div>
      </section>

      <AboutMe username={found.username} initial={found.about} names={aboutNames} local={aboutLocal(t.locale)} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="profile-guessr">
          <CardContent className="space-y-3 p-5">
            <p className="hud-label text-screen">{t("ranked")}</p>
            {found.guessr && found.guessr.games > 0 ? (
              <div className="space-y-2">
                <GeoDivisionBadge elo={found.guessr.elo} />
                <p className="text-sm text-muted-foreground">
                  {t("rankedDuels", { record: `${found.guessr.wins}–${found.guessr.losses}${found.guessr.draws ? `–${found.guessr.draws}` : ""}`, n: found.guessr.games })}
                  {found.guessr.position ? t("position", { position: found.guessr.position, players: found.guessr.players }) : ""}
                  {found.guessr.bestScore > 0 ? t("bestScore", { score: formatNumber(found.guessr.bestScore, t.locale) }) : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noRanked")}</p>
            )}
            {found.geoSeasons.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="hud-label">{t("pastSeasons")}</p>
                <GeoSeasonHistory records={found.geoSeasons} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="hud-label text-screen">{t("ladder")}</p>
            {rated.length ? (
              <ul className="space-y-2">
                {rated.slice(0, 4).map((f) => (
                  <li key={f.format} className="flex items-center justify-between gap-3" data-testid="profile-ladder-format">
                    <span className="truncate text-sm font-semibold">{f.formatName}</span>
                    <span className="flex flex-col items-end gap-0.5">
                      {/* Elo leads (the ladder's rating, shown as its Poké Ball to Master Ball tier); GXE and Glicko-2 follow. */}
                      <TierBadge rating={f.elo ?? f.rating!} games={f.elo === undefined ? f.ratedGames : undefined} size="sm" tr={serverT(tier)} />
                      <GlickoBadge rating={f.rating!} rd={f.rd} gxe={f.gxe} elo={f.elo} headline={false} size="sm" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noLadder")}</p>
            )}
          </CardContent>
        </Card>
        <Card className="md:col-span-2" data-testid="profile-connections">
          <CardContent className="space-y-3 p-5">
            <p className="hud-label text-screen">PokéConnections</p>
            {found.connections ? (
              <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
                {[
                  [t("conn.streak"), `🔥${found.connections.streak}`],
                  [t("conn.bestStreak"), found.connections.best],
                  [t("conn.gamesWon"), found.connections.wins],
                  [t("conn.perfect"), found.connections.perfect],
                  [t("conn.duelRecord"), `${found.connections.duelWins}–${found.connections.duelLosses}${found.connections.duelDraws ? `–${found.connections.duelDraws}` : ""}`],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col-reverse rounded-md border bg-shade/20 p-2">
                    <dt className="text-[11px] text-muted-foreground">{label}</dt>
                    <dd className="font-display text-xl font-bold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noConn")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <QuizBests username={found.username} quiz={found.quizBests} nea={found.neaBests} />

      <GeoProfileStats stats={found.geoStats} streak={found.geoStreak} progress={found.geoProgress} />

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="hud-label flex items-center gap-1.5 text-screen">
              <Swords className="h-3.5 w-3.5" aria-hidden /> {t("battleRecord")}
            </p>
            {found.insights && (
              <Link href={`/battle/insights/${encodeURIComponent(found.username)}`} className="hud-label flex items-center gap-1 hover:text-foreground" data-testid="profile-insights">
                <BarChart3 className="h-3.5 w-3.5" aria-hidden /> {t("insights")}
              </Link>
            )}
          </div>
          {found.battles ? (
            <BattleProfileView profile={{ ...found.battles, name: found.username }} now={now} empty={t("battleEmpty", { name: found.username })} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("battleSoon")}</p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <p className="hud-label flex items-center gap-1.5">
          <Clapperboard className="h-3.5 w-3.5" aria-hidden /> {t("replays")}
        </p>
        {found.replays.length ? (
          <div className="space-y-2" data-testid="profile-replays">
            {found.replays.map((r) => (
              <ReplayRow key={r.id} r={r} now={now} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noReplays")}</p>
        )}
      </section>
    </div>
    </ClientMessages>
  );
}

import Link from "@/components/ui/Link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { CalendarRange, Compass, Medal, Trophy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { fetchBoardOrUnavailable } from "@/lib/server/leaderboard";
import { fetchGeoBoardOrUnavailable } from "@/lib/server/geo-leaderboard";
import { currentGeoWeekly, geoRegions, isGeoSpec } from "@/lib/server/geo";
import { GEO_WEEKLY_BOARD_RE, geoPreviousWeek, geoWeeklyBoard, geoWeeklyMap, geoWeeklyNumber, isGeoWeek } from "@/lib/geo-weekly";
import { GEO_ROUND_OPTIONS, WORLD_REGION, geoBoardKey, geoMapRank } from "@/lib/geo-types";
import { GEO_REGION_STREAK_BOARD } from "@/lib/geo-streak-types";
import type { GeoEra } from "@/lib/geo-families";
import { dailyNumber, isValidDailyDate, previousDate } from "@/lib/daily";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LocalDateRedirect } from "./local-date-redirect";
import { GeoDivisionBadge, YourGeoLadderSpot } from "@/components/geo/GeoRanked";
import { geoRankedTop } from "@/lib/server/geo-ranked";
import { utcDay } from "@/lib/geo-ranked";
import { LadderTable, LadderTabs, YourBattleStanding } from "@/components/battle/LadderParts";
import { isLadderFormat } from "@/lib/battle/ladder";
import type { StandardFormatId } from "@/lib/battle/play";
import { ladderTop } from "@/lib/server/battle-engine/ladder";
import { avatarsByNames } from "@/lib/server/avatars";
import { NameAvatar } from "@/components/avatar/Avatar";
import { connBoardStore } from "@/lib/server/connections-board";
import { connNumber, isPlayableConnDate, type ConnBoardRow } from "@/lib/connections/types";
import { clock } from "@/lib/share/text";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import type { Translator } from "@/i18n/catalog";
import leaderboard from "@/messages/leaderboard";
import geoNames from "@/messages/geo-names";
import guessrRanked from "@/messages/guessr-ranked";
import { localEra, localMap } from "@/lib/geo-i18n";

type T = Translator<typeof leaderboard.en>;

function leaderboardPage() {
  const t = serverT(leaderboard);
  return { t, page: { title: t("meta.title"), description: t("meta.description"), path: "/leaderboard" } };
}
export function leaderboardMetadata(): Metadata {
  return pageMetadata(leaderboardPage().page);
}
/** The cached per-board pages (what /leaderboard is rewritten to) sit in a segment without the image file, so they name it. */
export function leaderboardBoardMetadata(): Metadata {
  const { t, page } = leaderboardPage();
  return pageMetadata({ ...page, image: { url: "/leaderboard/opengraph-image", alt: t("meta.imageAlt") } });
}

/** A number as the page's language writes it; English keeps the server's own formatting. */
const num = (t: T, n: number, english?: string) => (t.locale === "en" ? n.toLocaleString(english) : n.toLocaleString(t.locale));

export interface LeaderboardParams {
  board?: string;
  format?: string;
  date?: string;
}

/** The leaderboard for a board (and, from a full link, a date or format). Shared by /leaderboard and its cached per-board pages. */
export async function LeaderboardView({ params }: { params: LeaderboardParams }) {
  const board =
    params.board === "daily" ||
    params.board === "iq" ||
    params.board === "geo" ||
    params.board === "geo-ranked" ||
    params.board === "connections" ||
    params.board === "battle"
      ? params.board
      : // Quiz modes have no boards (personal bests show on profiles): old quiz links land on the Daily.
        "daily";
  const t = serverT(leaderboard);
  const today = new Date().toISOString().slice(0, 10);
  const date = params.date && isValidDailyDate(params.date) ? params.date : today;

  const tabs = [
    { id: "daily", label: t("tabs.daily") },
    { id: "iq", label: t("tabs.iq") },
    { id: "geo", label: t("tabs.geo") },
    { id: "geo-ranked", label: t("tabs.geoRanked") },
    { id: "connections", label: t("tabs.connections") },
    { id: "battle", label: t("tabs.battle") },
  ];
  const tabRow = (
    <div className="flex flex-wrap justify-center gap-2 max-md:grid max-md:grid-cols-2" data-testid="leaderboard-tabs">
      {tabs.map((tab) => (
        <Link key={tab.id} href={`/leaderboard?board=${tab.id}`} className="max-md:block">
          <Badge variant={tab.id === board ? "default" : "outline"} className="px-3 py-1 hover:bg-accent max-md:flex max-md:h-10 max-md:w-full max-md:justify-center max-md:text-[11px]">
            {tab.label}
          </Badge>
        </Link>
      ))}
    </div>
  );

  if (board === "battle") {
    const battleFormat: StandardFormatId = isLadderFormat(params.format) ? params.format : "gen9randombattle";
    const rows = await ladderTop(battleFormat);
    const avatars = await avatarsByNames((rows ?? []).map((r) => r.name));
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-4 text-center">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("heading")}</h1>
          {tabRow}
          <p className="text-sm text-muted-foreground">
            {t("battle.intro")}{" "}
            <Link href={`/battle/ladder?format=${battleFormat}`} className="text-primary underline-offset-2 hover:underline">
              {t("battle.full")}
            </Link>
          </p>
        </div>
        <div className="flex justify-center">
          <LadderTabs format={battleFormat} hrefBase="/leaderboard?board=battle&format=" />
        </div>
        {rows === null ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">{t("battle.soon")}</CardContent>
          </Card>
        ) : (
          <>
            <YourBattleStanding format={battleFormat} />
            <LadderTable rows={rows} format={battleFormat} avatars={avatars} />
          </>
        )}
      </div>
    );
  }

  if (board === "geo-ranked") {
    const ladder = await geoRankedTop(utcDay(Date.now()));
    const avatars = await avatarsByNames((ladder ?? []).map((r) => r.name));
    return (
      <div className="mx-auto max-w-3xl space-y-6" data-testid="leaderboard-geo-ranked">
        <div className="space-y-4 text-center">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("heading")}</h1>
          {tabRow}
          <p className="text-sm text-muted-foreground">{t("geoRanked.intro")}</p>
        </div>
        {ladder === null ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">{t("geoRanked.soon")}</CardContent>
          </Card>
        ) : (
          <>
            <ClientMessages namespaces={[guessrRanked]}>
              <YourGeoLadderSpot />
            </ClientMessages>
            {ladder.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  {t.rich("geoRanked.empty", {
                    link: (c) => (
                      <Link href="/pokeguessr#ranked" className="text-primary underline-offset-2 hover:underline">
                        {c}
                      </Link>
                    ),
                  })}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="p-3">#</th>
                        <th className="p-3">{t("col.trainer")}</th>
                        <th className="p-3">{t("col.division")}</th>
                        <th className="hidden p-3 text-right sm:table-cell">{t("col.wl")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ladder.map((row) => (
                        <tr key={row.position} className="border-b last:border-0">
                          <td className="p-3 font-mono tabular-nums text-muted-foreground">{row.position}</td>
                          <td className="max-w-[10rem] truncate p-3 font-semibold">
                            <span className="flex items-center gap-2">
                              <NameAvatar name={row.name} avatars={avatars} />
                              <span className="truncate">{row.name}</span>
                            </span>
                          </td>
                          <td className="p-3">
                            <ClientMessages namespaces={[guessrRanked]}>
                              <GeoDivisionBadge elo={row.elo} division={row.division} size="sm" />
                            </ClientMessages>
                          </td>
                          <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                            {row.wins}–{row.losses}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    );
  }

  if (board === "connections") {
    const connDate = params.date && isPlayableConnDate(params.date) ? params.date : today;
    const rows = await connBoardTop(connDate);
    const avatars = await avatarsByNames((rows ?? []).map((r) => r.name));
    return (
      <div className="mx-auto max-w-3xl space-y-6" data-testid="leaderboard-connections">
        {!params.date && <LocalDateRedirect serverDate={connDate} board="connections" />}
        <div className="space-y-4 text-center">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("heading")}</h1>
          {tabRow}
          <p className="text-sm text-muted-foreground">
            {t("connections.intro", { n: connNumber(connDate), date: connDate })}
          </p>
        </div>
        {rows === null ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">{t("connections.soon")}</CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {t.rich("connections.empty", {
                link: (c) => (
                  <Link href="/pokeconnections" className="text-primary underline-offset-2 hover:underline">
                    {c}
                  </Link>
                ),
              })}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-3">#</th>
                    <th className="p-3">{t("col.trainer")}</th>
                    <th className="p-3 text-right">{t("col.mistakes")}</th>
                    <th className="p-3 text-right">{t("col.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={`${row.name}-${i}`} className="border-b last:border-0">
                      <td className="p-3 font-mono">{i + 1}</td>
                      <td className="p-3 font-medium">
                        <span className="flex items-center gap-2">
                          <NameAvatar name={row.name} avatars={avatars} />
                          {row.name}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums">{row.mistakes === 0 ? t("connections.perfect") : row.mistakes}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{clock(row.ms / 1000)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {t("connections.footnote")}
        </p>
      </div>
    );
  }

  if (board === "geo") {
    const g = serverT(geoNames);
    const maps = geoRegions()
      .map((r) => ({
        ...r,
        name: localMap(g, r),
        // Every game, then Classic 2D and Modern 3D (each where the map has enough of its places).
        boards: ([undefined, "2d", "3d"] as (GeoEra | undefined)[]).flatMap((era) =>
          // A board per game length (3 / 5 / 10 rounds) and the streak.
          ([...GEO_ROUND_OPTIONS.map((rounds) => ({ kind: "game" as const, rounds })), { kind: "streak" as const, rounds: undefined }])
            .filter(({ kind, rounds }) => isGeoSpec({ region: r.id, kind, rounds, ...(era ? { era } : {}) }))
            .map(({ kind, rounds }) => ({
              id: geoBoardKey({ region: r.id, kind, era, rounds }),
              name: geoBoardName(t, g, kind === "streak" ? t("geo.streak") : t("geo.rounds", { rounds: rounds! }), era),
            }))
        ),
      }))
      // Region Streak (name the region from one screenshot) is played on the world map.
      .map((r) => (r.id === WORLD_REGION ? { ...r, boards: [...r.boards, { id: GEO_REGION_STREAK_BOARD, name: t("geo.regionStreak") }] } : r))
      .filter((r) => r.boards.length)
      .sort((a, b) => geoMapRank(a.id) - geoMapRank(b.id));
    // The Weekly Challenge: this week's board, and the weeks before it by their Monday.
    const thisWeek = currentGeoWeekly();
    const weekAsked = GEO_WEEKLY_BOARD_RE.exec(params.format ?? "")?.[1];
    const week = weekAsked && isGeoWeek(weekAsked) && (!thisWeek || weekAsked <= thisWeek.week) ? weekAsked : null;
    const weekMapName = (w: string) => maps.find((r) => r.id === geoWeeklyMap(w, (id) => isGeoSpec({ region: id, kind: "game" })))?.name ?? "";
    const lastWeek = thisWeek && isGeoWeek(geoPreviousWeek(thisWeek.week)) ? geoPreviousWeek(thisWeek.week) : null;
    const map = week ? undefined : maps.find((r) => r.boards.some((b) => b.id === params.format));
    const mode = week ? geoWeeklyBoard(week) : map ? params.format! : null;
    const geoRead = mode ? await fetchGeoBoardOrUnavailable({ mode }) : await fetchGeoBoardOrUnavailable({ daily: date });
    const geoEntries = geoRead === "unavailable" ? [] : geoRead;
    // What the board invites to when it's empty or nearly: today's Daily, this week's Weekly, or a game on the map.
    const invite: GeoInvite = week
      ? { kind: "weekly", current: week === thisWeek?.week, label: t("geo.weekly", { n: geoWeeklyNumber(week), map: weekMapName(week) }) }
      : map
        ? { kind: "map", current: true, label: map.name, href: `/pokeguessr?region=${map.id}` }
        : // Your local date can be a day either side of the server's.
          { kind: "daily", current: date >= previousDate(today), label: t("geo.daily", { n: dailyNumber(date) }) };
    const avatars = await avatarsByNames((geoEntries ?? []).map((r) => r.player_name));
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {!mode && !params.date && <LocalDateRedirect serverDate={date} board="geo" />}
        <div className="space-y-4 text-center">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("heading")}</h1>
          {tabRow}
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/leaderboard?board=geo">
              <Badge variant={!mode ? "secondary" : "outline"} className="hover:bg-accent">
                {t("geo.daily", { n: dailyNumber(date) })}
              </Badge>
            </Link>
            {thisWeek && (
              <Link href={`/leaderboard?board=geo&format=${geoWeeklyBoard(thisWeek.week)}`} data-testid="geo-board-weekly">
                <Badge variant={week === thisWeek.week ? "secondary" : "outline"} className="border-warning/50 hover:bg-accent">
                  {t("geo.weekly", { n: geoWeeklyNumber(thisWeek.week), map: weekMapName(thisWeek.week) })}
                </Badge>
              </Link>
            )}
            {lastWeek && (
              <Link href={`/leaderboard?board=geo&format=${geoWeeklyBoard(lastWeek)}`}>
                <Badge variant={week === lastWeek ? "secondary" : "outline"} className="hover:bg-accent">
                  {t("geo.lastWeek", { map: weekMapName(lastWeek) })}
                </Badge>
              </Link>
            )}
            {maps
              .filter((r) => !r.theme)
              .map((r) => (
                <Link key={r.id} href={`/leaderboard?board=geo&format=${r.boards[0].id}`}>
                  <Badge variant={map?.id === r.id ? "secondary" : "outline"} className="hover:bg-accent">
                    {r.name}
                  </Badge>
                </Link>
              ))}
          </div>
          {maps.some((r) => r.theme) && (
            <div className="flex flex-wrap justify-center gap-2" aria-label={t("geo.themed")}>
              {maps
                .filter((r) => r.theme)
                .map((r) => (
                  <Link key={r.id} href={`/leaderboard?board=geo&format=${r.boards[0].id}`}>
                    <Badge variant={map?.id === r.id ? "secondary" : "outline"} className="hover:bg-accent">
                      {r.name}
                    </Badge>
                  </Link>
                ))}
            </div>
          )}
          {week && (
            <p className="text-sm text-muted-foreground" data-testid="geo-weekly-board-title">
              {t("geo.weeklyTitle", { n: geoWeeklyNumber(week), map: weekMapName(week), week })}
            </p>
          )}
          {map && (
            <div className="flex flex-wrap justify-center gap-2">
              {map.boards.map((b) => (
                <Link key={b.id} href={`/leaderboard?board=geo&format=${b.id}`}>
                  <Badge variant={mode === b.id ? "secondary" : "outline"} className="hover:bg-accent">
                    {t("geo.mapBoard", { map: map.name, board: b.name })}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </div>
        {geoRead === "unavailable" ? (
          <BoardUnavailable t={t} />
        ) : geoEntries === null ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">{t("notEnabledLine")}</CardContent>
          </Card>
        ) : geoEntries.length === 0 ? (
          <GeoBoardInvite {...invite} t={t} empty />
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-3">#</th>
                    <th className="p-3">{t("col.trainer")}</th>
                    <th className="p-3 text-right">{t("col.score")}</th>
                    <th className="hidden p-3 text-right sm:table-cell">{t("col.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {geoEntries.map((row, i) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3 font-mono">{i + 1}</td>
                      <td className="p-3 font-medium">
                        <span className="flex items-center gap-2">
                          <NameAvatar name={row.player_name} avatars={avatars} />
                          {row.player_name}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">
                        {mode && /streak$/.test(mode) ? t("geo.inARow", { score: row.score }) : t("geo.outOf", { score: num(t, row.score, "en-US"), max: num(t, 25000, "en-US") })}
                      </td>
                      <td className="hidden p-3 text-right tabular-nums sm:table-cell">{t("seconds", { s: Math.round(row.duration_ms / 1000) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        {/* A board that's only getting started: the scores it has (never made-up ones), and the way onto it. */}
        {geoEntries && geoEntries.length > 0 && geoEntries.length < GEO_BOARD_FEW && invite.current && <GeoBoardInvite {...invite} t={t} count={geoEntries.length} />}
      </div>
    );
  }

  const read = board === "daily" ? await fetchBoardOrUnavailable({ kind: "daily", date }) : await fetchBoardOrUnavailable({ kind: "iq" });
  const entries = read === "unavailable" ? [] : read;
  const avatars = await avatarsByNames((entries ?? []).map((r) => r.player_name));


  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {board === "daily" && !params.date && <LocalDateRedirect serverDate={date} />}
      <div className="space-y-4 text-center">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("heading")}</h1>
        {tabRow}
        {board === "daily" ? (
          <p className="text-sm text-muted-foreground">{t("dailyIntro", { n: dailyNumber(date), date })}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("iqIntro")}</p>
        )}
      </div>

      {read === "unavailable" ? (
        <BoardUnavailable t={t} />
      ) : entries === null ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("notEnabled")}</CardTitle>
            <CardDescription>{t.rich("supabase", { code: (c) => <code>{c}</code> })}</CardDescription>
          </CardHeader>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{t("noScores")}</CardContent>
        </Card>
      ) : (
        <>
          {entries.length >= 3 && (
            <div className="grid grid-cols-3 items-end gap-3">
              {[entries[1], entries[0], entries[2]].map((row, i) => {
                const place = i === 1 ? 1 : i === 0 ? 2 : 3;
                return (
                  <div
                    key={row.id}
                    className={cn("rounded-lg border bg-card p-4 text-center", place === 1 && "border-primary/40 bg-primary/5 pb-8 pt-6")}
                  >
                    <Medal
                      className={cn(
                        "mx-auto h-6 w-6",
                        place === 1 && "text-yellow-400",
                        place === 2 && "text-slate-300",
                        place === 3 && "text-amber-600"
                      )}
                      aria-label={t("rank", { place })}
                    />
                    <NameAvatar name={row.player_name} avatars={avatars} size={40} className="mx-auto mt-2" />
                    <div className="mt-2 truncate font-semibold">{row.player_name}</div>
                    <div className="font-mono text-sm tabular-nums text-muted-foreground">{t("pts", { score: num(t, row.score) })}</div>
                    <Badge variant="secondary" className="mt-2">{t("iq", { n: row.pokeiq })}</Badge>
                  </div>
                );
              })}
            </div>
          )}
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-3">#</th>
                    <th className="p-3">{t("col.trainer")}</th>
                    <th className="p-3 text-right">{t("col.score")}</th>
                    <th className="p-3 text-right">{t("col.pokeiq")}</th>
                    <th className="hidden p-3 text-right sm:table-cell">{t("col.correct")}</th>
                    <th className="hidden p-3 text-right sm:table-cell">{t("col.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((row, i) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3 font-mono">{i + 1}</td>
                      <td className="p-3 font-medium">
                        <span className="flex items-center gap-2">
                          <NameAvatar name={row.player_name} avatars={avatars} />
                          {row.player_name}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{num(t, row.score)}</td>
                      <td className="p-3 text-right tabular-nums">{row.pokeiq}</td>
                      <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                        {row.correct}/{row.total}
                      </td>
                      <td className="hidden p-3 text-right tabular-nums sm:table-cell">{t("seconds", { s: Math.round(row.duration_ms / 1000) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
      <p className="text-center text-xs text-muted-foreground">
        {t("footnote")}
      </p>
    </div>
  );
}

/** A board whose read failed (the database is down): said plainly, never an empty board inviting a first score. */
function BoardUnavailable({ t }: { t: T }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-muted-foreground" data-testid="board-unavailable">
        {t("unavailable")}
      </CardContent>
    </Card>
  );
}

/** A day's PokéConnections board (the top 100), or null while it's off. */
async function connBoardTop(date: string): Promise<ConnBoardRow[] | null> {
  try {
    return (await connBoardStore()?.top(date, 100)) ?? null;
  } catch (err) {
    console.error("[connections] leaderboard failed:", err);
    return null;
  }
}

/** Fewer scores than this on a current Daily or Weekly board: an invitation to play shows under them. */
const GEO_BOARD_FEW = 5;

interface GeoInvite {
  kind: "daily" | "weekly" | "map";
  /** Still open: today's Daily (or the day either side), this week's Weekly. */
  current: boolean;
  label: string;
  href?: string;
}

/**
 * A PokéGuessr board with nobody (or only a few) on it: no made-up scores,
 * just the way onto it. Empty: a card that fills the table's spot. A few
 * scores: a line under them.
 */
function GeoBoardInvite({ kind, current, label, href, empty, count = 0, t }: GeoInvite & { empty?: boolean; count?: number; t: T }) {
  const daily = kind === "daily";
  const weekly = kind === "weekly";
  const Icon = daily ? Compass : weekly ? CalendarRange : Trophy;
  // The Daily's Play starts today's game straight away; the Weekly's tile is in the hub's Play section.
  const playHref = daily ? "/pokeguessr?play=daily#play" : weekly ? "/pokeguessr#play" : (href ?? "/pokeguessr");
  const playLabel = daily
    ? current
      ? t("invite.playDaily")
      : t("invite.playDailyInstead")
    : weekly
      ? current
        ? t("invite.playWeekly")
        : t("invite.playWeeklyInstead")
      : t("invite.playMap");
  const title = !current
    ? t("invite.notSaved", { label })
    : daily
      ? t("invite.firstDaily")
      : weekly
        ? t("invite.firstWeekly")
        : t("invite.firstMap", { label });
  const blurb = daily ? t("invite.blurbDaily") : weekly ? t("invite.blurbWeekly") : t("invite.blurbMap");
  if (!empty) {
    return (
      <div className="flex flex-col items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-center sm:flex-row sm:text-left" data-testid="geo-board-few">
        <p className="text-sm text-muted-foreground">
          {daily ? t("invite.fewDaily", { count }) : weekly ? t("invite.fewWeekly", { count }) : t("invite.fewMap", { count })}
        </p>
        <Link href={playHref} className={cn(buttonVariants({ size: "sm", variant: weekly ? "success" : "default" }), "shrink-0")}>
          <Icon className="h-4 w-4" aria-hidden /> {playLabel}
        </Link>
      </div>
    );
  }
  return (
    <Card data-testid="geo-board-empty">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-10 text-center sm:py-12">
        <span className={cn("flex h-14 w-14 items-center justify-center rounded-full", weekly ? "bg-success/15 text-success" : daily ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary")} aria-hidden>
          <Icon className="h-7 w-7" />
        </span>
        <p className="hud-label">{label}</p>
        <h2 className="text-balance font-display text-2xl font-bold uppercase leading-tight sm:text-3xl">{title}</h2>
        <p className="max-w-md text-balance text-sm text-muted-foreground">{current ? blurb : daily ? t("invite.pastDaily") : t("invite.pastWeekly")}</p>
        <Link href={playHref} className={cn(buttonVariants({ size: "lg", variant: weekly ? "success" : "default" }), "mt-1 w-full sm:w-auto")} data-testid="geo-board-play">
          <Icon className="h-4 w-4" aria-hidden /> {playLabel}
        </Link>
      </CardContent>
    </Card>
  );
}

/** A PokéGuessr board's name on its map: the game length or the streak, after the era when there is one. */
function geoBoardName(t: T, g: Parameters<typeof localEra>[0], board: string, era: GeoEra | undefined): string {
  return era ? t("geo.eraBoard", { era: localEra(g, era), board }) : board;
}

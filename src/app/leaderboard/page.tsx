import Link from "next/link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Medal } from "lucide-react";
import { fetchBoard } from "@/lib/server/leaderboard";
import { fetchGeoBoard } from "@/lib/server/geo-leaderboard";
import { geoRegions, isGeoSpec } from "@/lib/server/geo";
import { GEO_KINDS, geoBoardKey, geoMapRank } from "@/lib/geo-types";
import { dailyNumber, isValidDailyDate } from "@/lib/daily";
import { FORMAT_INFO, MODULE_INFO, PLAY_MODULES, PLAYABLE_FORMATS } from "@/lib/modes";
import { DIFFICULTIES, type Difficulty, type ModuleId, type QuizFormat } from "@/engines/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LocalDateRedirect } from "./local-date-redirect";
import { RankedUnavailable, rankedStore } from "@/lib/server/ranked";
import type { RankedLeaderRow } from "@/lib/ranked";
import { TierBadge, YourLadderSpot } from "@/components/pokedle/Ranked";
import { LadderTable, LadderTabs, YourBattleStanding } from "@/components/battle/LadderParts";
import { isLadderFormat } from "@/lib/battle/ladder";
import type { StandardFormatId } from "@/lib/battle/play";
import { ladderTop } from "@/lib/server/battle-engine/ladder";

export const metadata: Metadata = pageMetadata({
  title: "Leaderboards",
  description: "The top PokéIQ trainers: today's Daily Challenge, PokéIQ ratings, PokéGuessr and every quiz mode, updated live.",
  path: "/leaderboard",
});
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ board?: string; format?: string; difficulty?: string; date?: string }>;
}

export default async function LeaderboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const board =
    params.board === "daily" ||
    params.board === "iq" ||
    params.board === "geo" ||
    params.board === "pokedle" ||
    params.board === "battle" ||
    PLAY_MODULES.includes(params.board as ModuleId)
      ? params.board!
      : "daily";
  const format: QuizFormat = (PLAYABLE_FORMATS as readonly string[]).includes(params.format ?? "") ? (params.format as QuizFormat) : "classic";
  const difficulty: Difficulty = (DIFFICULTIES as readonly string[]).includes(params.difficulty ?? "")
    ? (params.difficulty as Difficulty)
    : "medium";
  const today = new Date().toISOString().slice(0, 10);
  const date = params.date && isValidDailyDate(params.date) ? params.date : today;

  const tabs = [
    { id: "daily", label: "Daily" },
    { id: "iq", label: "PokéIQ Test" },
    { id: "geo", label: "PokéGuessr" },
    { id: "pokedle", label: "Pokédle Ranked" },
    { id: "battle", label: "Battle Ladder" },
    ...PLAY_MODULES.map((m) => ({ id: m, label: MODULE_INFO[m].title })),
  ];
  const tabRow = (
    <div className="flex flex-wrap justify-center gap-2">
      {tabs.map((t) => (
        <Link key={t.id} href={`/leaderboard?board=${t.id}`}>
          <Badge variant={t.id === board ? "default" : "outline"} className="px-3 py-1 hover:bg-accent">
            {t.label}
          </Badge>
        </Link>
      ))}
    </div>
  );

  if (board === "battle") {
    const battleFormat: StandardFormatId = isLadderFormat(params.format) ? params.format : "gen9randombattle";
    const rows = await ladderTop(battleFormat);
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-4 text-center">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Leaderboard</h1>
          {tabRow}
          <p className="text-sm text-muted-foreground">
            The ranked battle ladder: the top 100 by rating in each format.{" "}
            <Link href={`/battle/ladder?format=${battleFormat}`} className="text-primary underline-offset-2 hover:underline">
              Full ladder
            </Link>
          </p>
        </div>
        <div className="flex justify-center">
          <LadderTabs format={battleFormat} hrefBase="/leaderboard?board=battle&format=" />
        </div>
        {rows === null ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">Ranked battles open soon.</CardContent>
          </Card>
        ) : (
          <>
            <YourBattleStanding format={battleFormat} />
            <LadderTable rows={rows} format={battleFormat} />
          </>
        )}
      </div>
    );
  }

  if (board === "pokedle") {
    const ladder = await rankedLadder();
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-4 text-center">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Leaderboard</h1>
          {tabRow}
          <p className="text-sm text-muted-foreground">Ranked Pokédle duels: the top 100 by rating.</p>
        </div>
        {ladder === null ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">Ranked play opens soon.</CardContent>
          </Card>
        ) : (
          <>
            <YourLadderSpot />
            {ladder.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  Nobody is ranked yet.{" "}
                  <Link href="/pokedle#ranked" className="text-primary underline-offset-2 hover:underline">
                    Queue a ranked duel
                  </Link>{" "}
                  and be the first!
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="p-3">#</th>
                        <th className="p-3">Trainer</th>
                        <th className="p-3">Rank</th>
                        <th className="hidden p-3 text-right sm:table-cell">W–L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ladder.map((row) => (
                        <tr key={row.position} className="border-b last:border-0">
                          <td className="p-3 font-mono tabular-nums text-muted-foreground">{row.position}</td>
                          <td className="max-w-[10rem] truncate p-3 font-semibold">{row.name}</td>
                          <td className="p-3">
                            <TierBadge rating={row.rating} games={row.games} size="sm" />
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

  if (board === "geo") {
    const maps = geoRegions()
      .map((r) => ({
        ...r,
        boards: GEO_KINDS.filter((kind) => isGeoSpec({ region: r.id, kind })).map((kind) => ({
          id: geoBoardKey({ region: r.id, kind }),
          name: kind === "streak" ? "Streak" : "5 rounds",
        })),
      }))
      .filter((r) => r.boards.length)
      .sort((a, b) => geoMapRank(a.id) - geoMapRank(b.id));
    const map = maps.find((r) => r.boards.some((b) => b.id === params.format));
    const mode = map ? params.format! : null;
    const geoEntries = mode ? await fetchGeoBoard({ mode }) : await fetchGeoBoard({ daily: date });
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {!mode && !params.date && <LocalDateRedirect serverDate={date} board="geo" />}
        <div className="space-y-4 text-center">
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Leaderboard</h1>
          {tabRow}
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/leaderboard?board=geo">
              <Badge variant={!mode ? "secondary" : "outline"} className="hover:bg-accent">
                Daily #{dailyNumber(date)}
              </Badge>
            </Link>
            {maps.map((r) => (
              <Link key={r.id} href={`/leaderboard?board=geo&format=${r.boards[0].id}`}>
                <Badge variant={map?.id === r.id ? "secondary" : "outline"} className="hover:bg-accent">
                  {r.name}
                </Badge>
              </Link>
            ))}
          </div>
          {map && (
            <div className="flex flex-wrap justify-center gap-2">
              {map.boards.map((b) => (
                <Link key={b.id} href={`/leaderboard?board=geo&format=${b.id}`}>
                  <Badge variant={mode === b.id ? "secondary" : "outline"} className="hover:bg-accent">
                    {map.name} {b.name}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </div>
        {geoEntries === null ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">Leaderboards aren&apos;t enabled here.</CardContent>
          </Card>
        ) : geoEntries.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No scores yet. <Link href="/guessr" className="text-primary underline-offset-2 hover:underline">Play PokéGuessr</Link> and be the first!
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-3">#</th>
                    <th className="p-3">Trainer</th>
                    <th className="p-3 text-right">Score</th>
                    <th className="hidden p-3 text-right sm:table-cell">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {geoEntries.map((row, i) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3 font-mono">{i + 1}</td>
                      <td className="p-3 font-medium">{row.player_name}</td>
                      <td className="p-3 text-right font-mono tabular-nums">
                        {mode?.endsWith(":streak") ? `${row.score} in a row` : `${row.score.toLocaleString("en-US")} / 25,000`}
                      </td>
                      <td className="hidden p-3 text-right tabular-nums sm:table-cell">{Math.round(row.duration_ms / 1000)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const entries =
    board === "daily"
      ? await fetchBoard({ kind: "daily", date })
      : board === "iq"
        ? await fetchBoard({ kind: "iq" })
        : await fetchBoard({ kind: "module", module: board, format, difficulty });


  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {board === "daily" && !params.date && <LocalDateRedirect serverDate={date} />}
      <div className="space-y-4 text-center">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Leaderboard</h1>
        {tabRow}
        {board === "daily" ? (
          <p className="text-sm text-muted-foreground">Daily Challenge #{dailyNumber(date)} · {date}</p>
        ) : board === "iq" ? (
          <p className="text-sm text-muted-foreground">Ranked by measured PokéIQ from the adaptive test</p>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-center gap-2">
              {PLAYABLE_FORMATS.map((f) => (
                <Link key={f} href={`/leaderboard?board=${board}&format=${f}&difficulty=${difficulty}`}>
                  <Badge variant={f === format ? "secondary" : "outline"} className="hover:bg-accent">
                    {FORMAT_INFO[f].title}
                  </Badge>
                </Link>
              ))}
            </div>
            <div className="flex justify-center gap-2">
              {DIFFICULTIES.map((d) => (
                <Link key={d} href={`/leaderboard?board=${board}&format=${format}&difficulty=${d}`}>
                  <Badge variant={d === difficulty ? "secondary" : "outline"} className="capitalize hover:bg-accent">
                    {d}
                  </Badge>
                </Link>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">All-generation runs only</p>
          </div>
        )}
      </div>

      {entries === null ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Leaderboards aren&apos;t enabled here</CardTitle>
            <CardDescription>
              Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> and run the migration in{" "}
              <code>supabase/migrations/</code>. Everything else works without it.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">No scores yet — be the first on the board!</CardContent>
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
                      aria-label={`Rank ${place}`}
                    />
                    <div className="mt-2 truncate font-semibold">{row.player_name}</div>
                    <div className="font-mono text-sm tabular-nums text-muted-foreground">{row.score.toLocaleString()} pts</div>
                    <Badge variant="secondary" className="mt-2">IQ {row.pokeiq}</Badge>
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
                    <th className="p-3">Trainer</th>
                    <th className="p-3 text-right">Score</th>
                    <th className="p-3 text-right">PokéIQ</th>
                    <th className="hidden p-3 text-right sm:table-cell">Correct</th>
                    <th className="hidden p-3 text-right sm:table-cell">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((row, i) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-3 font-mono">{i + 1}</td>
                      <td className="p-3 font-medium">{row.player_name}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{row.score.toLocaleString()}</td>
                      <td className="p-3 text-right tabular-nums">{row.pokeiq}</td>
                      <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                        {row.correct}/{row.total}
                      </td>
                      <td className="hidden p-3 text-right tabular-nums sm:table-cell">{Math.round(row.duration_ms / 1000)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
      <p className="text-center text-xs text-muted-foreground">
        Every score here was graded on the server — submissions carry a signed result, never a raw number.
      </p>
    </div>
  );
}

/** The ranked ladder's top 100, or null while ranked play is off. */
async function rankedLadder(): Promise<RankedLeaderRow[] | null> {
  const store = rankedStore();
  if (!store) return null;
  try {
    return await store.top(100);
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[ranked] ladder failed:", err);
    return null;
  }
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Dex } from "@pkmn/dex";
import { Crown, Flag, Hourglass, ShieldAlert, Swords, TrendingUp } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { BattleSprite } from "@/components/battle/BattleSprite";
import { GlickoBadge } from "@/components/battle/GlickoBadge";
import { Card, CardContent } from "@/components/ui/card";
import { USERNAME_RE } from "@/lib/server/auth";
import { accountBattleKey } from "@/lib/server/battle-engine/identity";
import { battleProfile } from "@/lib/server/battle-engine/records";
import { insightsAvailable, playerInsights } from "@/lib/server/battle-engine/insights";
import { winRate, type Insights, type RatingPoint } from "@/lib/battle/insights";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import type { BattleFormatRecord } from "@/lib/battle/profile";
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ format?: string }>;
}

export const dynamic = "force-dynamic";

/**
 * A trainer's team insights across their saved battles: most common leads,
 * win rate per Pokémon, the foes that beat them most, and their rating
 * over time. Server-rendered (the sums are done by the database); linked
 * from their profile and the ladder only once insights are available.
 */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const name = decodeURIComponent((await params).name);
  return pageMetadata({
    title: `${name} · Team insights`,
    description: `${name}'s battle insights on PokéIQ: most common leads, win rate per Pokémon, toughest opponents and rating over time.`,
    path: `/battle/insights/${encodeURIComponent(name)}`,
    noindex: true,
  });
}

const sprite = (species: string) => {
  const s = Dex.species.get(species);
  return s.exists ? { id: s.id, num: s.num } : null;
};

export default async function InsightsPage({ params, searchParams }: PageProps) {
  const name = decodeURIComponent((await params).name);
  if (!USERNAME_RE.test(name)) notFound();
  const account = await accountBattleKey(name);
  if (!account) notFound();
  const { format: raw } = await searchParams;
  const [available, profile] = await Promise.all([insightsAvailable(), battleProfile(account.key).catch(() => null)]);
  const formats = profile?.formats ?? [];
  const format = raw === "all" ? null : formats.find((f) => f.format === raw)?.format ?? formats[0]?.format ?? null;
  const record = formats.find((f) => f.format === format);
  const insights = available ? await playerInsights(account.key, format).catch(() => null) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <BattleHeader back={`/u/${encodeURIComponent(account.username)}`} crumb="Team insights" title={`${account.username}'s`} accent="insights">
        Leads, Pokémon, toughest opponents and rating over {account.username}&apos;s saved battles, worked out from their replays.
      </BattleHeader>

      {formats.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Format">
          {[...formats.map((f) => ({ id: f.format as string, label: PLAY_FORMAT_INFO[f.format]?.short ?? f.formatName })), { id: "all", label: "All formats" }].map((f) => {
            const on = (f.id === "all" && format === null) || f.id === format;
            return (
              <Link
                key={f.id}
                href={`/battle/insights/${encodeURIComponent(account.username)}?format=${f.id}`}
                role="tab"
                aria-selected={on}
                scroll={false}
                className={cn(
                  "rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-screen/60 hover:text-foreground"
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      )}

      {!insights ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{available ? "No battles to look at yet." : "Team insights open soon."}</CardContent>
        </Card>
      ) : (
        <Body insights={insights} record={record} name={account.username} />
      )}
    </div>
  );
}

function Body({ insights, record, name }: { insights: Insights; record: BattleFormatRecord | undefined; name: string }) {
  if (!insights.battles) {
    return (
      <Card data-testid="insights-empty">
        <CardContent className="space-y-2 py-10 text-center text-muted-foreground">
          <p>No saved replays to learn from here yet: insights come from battles whose replay was saved (every ranked battle saves one).</p>
          {insights.pending > 0 && <p className="text-xs">{insights.pending} more battles are being read; check back in a moment.</p>}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4" data-testid="insights">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Battles read", String(insights.battles)],
          ["Win rate", winRate(insights.wins, insights.battles)],
          ["Pokémon used", String(insights.mons.length)],
          ["Different leads", String(insights.leads.length)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse rounded-md border bg-card p-3">
            <dt className="hud-label">{label}</dt>
            <dd className="font-display text-2xl font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Rating over time" icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden />} testid="insights-trend">
          {record?.rating !== undefined && <GlickoBadge rating={record.rating} rd={record.rd} gxe={record.gxe} elo={record.elo} size="sm" />}
          <RatingTrend points={insights.trend} />
        </Section>
        <Section title="Most common leads" icon={<Flag className="h-3.5 w-3.5" aria-hidden />} testid="insights-leads">
          <UsageList rows={insights.leads} total={insights.battles} />
        </Section>
      </div>

      <Section title="Win rate by Pokémon" icon={<Swords className="h-3.5 w-3.5" aria-hidden />} testid="insights-mons" aside="Battles each one came out in">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {insights.mons.map((m) => (
            <li key={m.species} className="flex items-center gap-2 rounded-md border bg-shade/10 px-2 py-1.5">
              <BattleSprite species={sprite(m.species)} size={36} animated={false} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{m.species}</span>
                <span className="text-[11px] text-muted-foreground">
                  {m.wins}–{m.games - m.wins} in {m.games} battle{m.games === 1 ? "" : "s"}
                </span>
              </span>
              <WinBadge wins={m.wins} games={m.games} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Toughest opponents" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />} testid="insights-threats" aside={`Foes with a KO or a win against ${name}: most KOs, then most wins`}>
        {insights.threats.length ? (
          <ol className="divide-y rounded-md border">
            {insights.threats.map((t, i) => (
              <li key={t.species} className="flex items-center gap-3 px-3 py-2">
                <span className="w-5 text-right font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <BattleSprite species={sprite(t.species)} size={36} animated={false} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{t.species}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {t.games} battle{t.games === 1 ? "" : "s"} · {t.losses} win{t.losses === 1 ? "" : "s"} against {name}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={cn("block font-display text-lg font-bold leading-none tabular-nums", t.kos ? "text-destructive" : "text-muted-foreground")}>{t.kos}</span>
                  <span className="text-[10px] text-muted-foreground">KO{t.kos === 1 ? "" : "s"}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing has knocked out {name}&apos;s Pokémon yet.</p>
        )}
      </Section>

      {insights.pending > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="insights-pending">
          <Hourglass className="h-3.5 w-3.5" aria-hidden /> {insights.pending} older battle{insights.pending === 1 ? " is" : "s are"} still to be read: they&apos;ll count on a later visit.
        </p>
      )}
    </div>
  );
}

function Section({ title, icon, aside, testid, children }: { title: string; icon: React.ReactNode; aside?: string; testid: string; children: React.ReactNode }) {
  return (
    <Card data-testid={testid}>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            {icon} {title}
          </p>
          {aside && <p className="text-[11px] text-muted-foreground">{aside}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function WinBadge({ wins, games }: { wins: number; games: number }) {
  const rate = games ? wins / games : 0;
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums", rate >= 0.6 ? "bg-success/15 text-success" : rate < 0.4 ? "bg-destructive/15 text-destructive" : "bg-shade/40 text-foreground")}>
      {winRate(wins, games)}
    </span>
  );
}

function UsageList({ rows, total }: { rows: Insights["leads"]; total: number }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No leads seen yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.species} className="flex items-center gap-2.5">
          <BattleSprite species={sprite(r.species)} size={36} animated={false} className="shrink-0" />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <span className="truncate">{r.species}</span>
              {i === 0 && <Crown className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Most used" />}
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-shade/40" aria-hidden>
              <span className="block h-full rounded-full bg-primary" style={{ width: `${(100 * r.games) / Math.max(1, total)}%` }} />
            </span>
          </span>
          <span className="w-16 shrink-0 text-right text-[11px] leading-tight text-muted-foreground">
            {r.games}× lead
            <br />
            {winRate(r.wins, r.games)} won
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The rating after each ranked game, as a line (and the GXE after the last, where known). Pure SVG: no script. */
function RatingTrend({ points }: { points: RatingPoint[] }) {
  if (points.length < 2) return <p className="text-sm text-muted-foreground">Play {points.length ? "another ranked battle" : "a couple of ranked battles"} in this format to see a trend.</p>;
  const w = 320;
  const h = 120;
  const pad = 6;
  const ratings = points.map((p) => p.rating);
  const lo = Math.min(...ratings);
  const hi = Math.max(...ratings);
  const span = Math.max(20, hi - lo);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = (r: number) => pad + (1 - (r - lo + (span - (hi - lo)) / 2) / span) * (h - 2 * pad);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${h}L${x(0).toFixed(1)},${h}Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.rating - first.rating;
  const date = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-32 w-full" preserveAspectRatio="none" role="img" aria-label={`Rating from ${first.rating} to ${last.rating} over ${points.length} ranked battles`}>
        <path d={area} fill="hsl(var(--primary) / 0.12)" />
        <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {date(first.at)} · {first.rating}
        </span>
        <span className={cn("font-mono font-semibold tabular-nums", delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "")}>
          {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
          {Math.abs(delta)} over {points.length - 1} game{points.length === 2 ? "" : "s"}
        </span>
        <span>
          {last.rating} · {date(last.at)}
        </span>
      </figcaption>
      {last.gxe !== undefined && <p className="text-[11px] text-muted-foreground">GXE after the last game: {last.gxe.toFixed(1)}%</p>}
    </figure>
  );
}

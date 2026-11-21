/* eslint-disable @next/next/no-img-element -- the region map pictures are static files */
import Link from "@/components/ui/Link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Crown, Play } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { readGeoShare, type GeoShareView } from "@/lib/server/geo-share";
import { guessrSquare } from "@/lib/share";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DUEL_HP } from "@/lib/duel-types";
import { serverT } from "@/i18n/server";
import { formatNumber, type Translator } from "@/i18n/catalog";
import pokeguessr from "@/messages/pokeguessr";
import geoNamesNs from "@/messages/geo-names";
import { localDifficulty, localEra, localMap, type GeoNamesT } from "@/lib/geo-i18n";
import { WORLD_REGION } from "@/lib/geo-types";

type T = Translator<typeof pokeguessr.en>;

/**
 * /pokeguessr/r/<token>: a shared PokéGuessr result (a finished game, daily or
 * streak by its signed result, a duel by its code). Rendered from the token
 * alone, so a link can't be forged; nothing here names a place.
 */

interface PageProps {
  params: Promise<{ token: string }>;
}

async function read(params: PageProps["params"]) {
  let raw: string;
  try {
    raw = decodeURIComponent((await params).token);
  } catch {
    return null;
  }
  const view = await readGeoShare(raw);
  return view && localView(view, serverT(pokeguessr), serverT(geoNamesNs));
}

/**
 * The view in the page's language: geo-share writes it in English (as English pages show it), from the signed token
 * alone; another language rebuilds the same lines from the same facts. Still nothing names a place.
 */
function localView(view: GeoShareView, t: T, names: GeoNamesT): GeoShareView {
  if (t.locale === "en") return view;
  const fmt = (n: number) => formatNumber(n, t.locale);
  const num = (s: string) => Number(s.replace(/,/g, ""));
  const map = view.map.id === WORLD_REGION ? names("world") : localMap(names, view.map);
  const chip = (c: string): string => {
    let m: RegExpExecArray | null;
    if (c === view.map.name) return map;
    if (c === "Classic 2D" || c === "Modern 3D") return localEra(names, c === "Classic 2D" ? "2d" : "3d");
    if (c === "Easy" || c === "Hard") return localDifficulty(names, c === "Easy" ? "easy" : "hard");
    if ((m = /^Daily #(\d+)$/.exec(c))) return t("result.daily", { n: m[1] });
    if ((m = /^Weekly #(\d+)$/.exec(c))) return t("result.weekly", { n: m[1] });
    if ((m = /^(\d+) rounds$/.exec(c))) return t("result.rounds", { n: m[1] });
    if ((m = /^\+([\d,]+) game bonus$/.exec(c))) return t("result.bonus", { bonus: fmt(num(m[1])) });
    const fixed: Record<string, Parameters<T>[0]> = {
      Streak: "result.chips.streak",
      "Points race": "result.chips.race",
      "HP duel": "result.chips.hpDuel",
      Turbo: "result.chips.turbo",
      Ranked: "result.chips.ranked",
      "Region Streak": "result.chips.regionStreak",
    };
    return fixed[c] ? t(fixed[c]) : c;
  };
  const chips = view.chips.map(chip);
  const n = view.total;
  if (view.kind === "streak") {
    return {
      ...view,
      eyebrow: `PokéGuessr · ${t("result.streak.eyebrow", { map })}`,
      headline: t("result.inARow", { n }),
      detail: t("result.streak.detail", { n }),
      chips,
      playLabel: t("result.play.game"),
      title: t("result.streak.title", { n, map }),
    };
  }
  if (view.kind === "region-streak") {
    return {
      ...view,
      eyebrow: `PokéGuessr · ${t("result.chips.regionStreak")}`,
      headline: t("result.inARow", { n }),
      detail: t("result.regionStreak.detail", { n }),
      chips,
      playLabel: t("result.play.regionStreak"),
      title: t("result.regionStreak.title", { n }),
    };
  }
  if (view.kind === "duel") {
    const players = view.players ?? [];
    const w = players.findIndex((p) => p.winner);
    const race = view.duelMode === "race";
    const rounds = players[0]?.scores.length ?? 0;
    const headline = w < 0 ? t("result.duel.draw") : t("result.duel.wins", { name: players[w].name });
    const totals = / ([\d,]+) to ([\d,]+) over \d+ rounds\.$/.exec(view.detail);
    const detail =
      w < 0
        ? t("result.duel.drew", { a: players[0]?.name ?? "", b: players[1]?.name ?? "", n: rounds })
        : race
          ? t("result.duel.beatRace", { winner: players[w].name, loser: players[1 - w]?.name ?? "", mine: totals ? fmt(num(totals[1])) : "", theirs: totals ? fmt(num(totals[2])) : "", n: rounds })
          : t("result.duel.beatHp", { winner: players[w].name, loser: players[1 - w]?.name ?? "", hp: fmt(players[w].hp), max: fmt(DUEL_HP), n: rounds });
    return {
      ...view,
      eyebrow: `PokéGuessr · ${race ? t("result.duel.race") : t("result.duel.duel")} · ${map}`,
      headline,
      detail,
      chips,
      playLabel: t("result.play.duel"),
      title: t("result.duel.title", { headline, map }),
    };
  }
  // A game, the Daily or the Weekly.
  const daily = /^PokéGuessr · Daily #(\d+)$/.exec(view.eyebrow);
  const weekly = /^PokéGuessr · Weekly #(\d+)$/.exec(view.eyebrow);
  const what = daily ? t("result.daily", { n: daily[1] }) : weekly ? t("result.weekly", { n: weekly[1] }) : map;
  const total = fmt(view.total);
  const places = view.rounds.length;
  return {
    ...view,
    eyebrow: `PokéGuessr · ${what}`,
    headline: total,
    detail: view.map.id === WORLD_REGION ? t("result.game.detailWorld", { total, max: fmt(view.max), n: places }) : t("result.game.detail", { total, max: fmt(view.max), n: places, map }),
    chips,
    playLabel: daily ? t("result.play.daily") : weekly ? t("result.play.weekly") : t("result.play.game"),
    title: t("result.game.title", { total, what }),
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const view = await read(params);
  if (!view) return { title: serverT(pokeguessr)("result.fallback"), robots: { index: false } };
  return pageMetadata({ title: view.title, description: view.detail, socialTitle: serverT(pokeguessr)("result.socialTitle", { title: view.title }), noindex: true });
}

export default async function GeoResultPage({ params }: PageProps) {
  const view = await read(params);
  if (!view) notFound();
  const t = serverT(pokeguessr);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const streak = view.kind === "streak" || view.kind === "region-streak";
  return (
    <div className="mx-auto max-w-xl space-y-6 py-4">
      <Card className="overflow-hidden" data-testid="geo-result-page">
        <div className="relative">
          <img src={view.map.thumb} alt={t("result.mapAlt", { map: t.locale === "en" ? view.map.name : view.map.id === WORLD_REGION ? serverT(geoNamesNs)("world") : localMap(serverT(geoNamesNs), view.map) })} className="h-48 w-full object-cover opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 text-center">
            <p className="hud-label text-screen">{t("result.shared")}</p>
            <p className="mt-2 font-display text-lg font-semibold uppercase tracking-wide text-muted-foreground">{view.eyebrow.replace("PokéGuessr · ", "")}</p>
            <h1 className="mt-1 font-display text-5xl font-bold uppercase tabular-nums tracking-tight sm:text-6xl" data-testid="geo-result-headline">
              {view.headline}
            </h1>
          </div>
        </div>
        <CardContent className="space-y-6 p-6 text-center">
          <p className="text-muted-foreground">{view.detail}</p>
          {view.players ? (
            <div className="space-y-2 text-left">
              {view.players.map((p) => (
                <div key={p.name} className={cn("flex items-center gap-3 rounded-md border px-3 py-2", p.winner && "border-success/60 bg-success/10")}>
                  {p.winner && <Crown className="h-4 w-4 text-success" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate font-display text-lg font-bold uppercase">{p.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{t("result.hp", { hp: fmt(p.hp) })}</span>
                  <span className="text-lg" aria-hidden>
                    {p.scores.map(guessrSquare).join("")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-3xl leading-none" aria-label={streak ? t("result.inARow", { n: view.total }) : t("result.rounds", { n: view.rounds.length })}>
                {streak ? `${"✅".repeat(Math.min(view.total, 20))}${view.total > 20 ? "…" : ""}❌` : view.rounds.map(guessrSquare).join("")}
              </p>
              {!streak && <p className="font-pixel text-[10px] text-muted-foreground">{view.rounds.map(fmt).join(" · ")}</p>}
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {view.chips.map((c) => (
              <span key={c} className="rounded-sm border bg-shade/20 px-2 py-1 font-pixel text-[10px] uppercase">
                {c}
              </span>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t("result.beat")}</p>
          <Link href={view.playHref} className={cn(buttonVariants({ size: "lg" }), "h-14 w-full text-base")} data-testid="share-play">
            <Play className="h-5 w-5" aria-hidden /> {view.playLabel}
          </Link>
          <Link href="/pokeguessr" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            {t("result.allModes")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

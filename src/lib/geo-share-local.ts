import { DUEL_HP } from "@/lib/duel-types";
import type { GeoShareView } from "@/lib/server/geo-share";
import { type Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import type pokeguessr from "@/messages/pokeguessr";
import { localDifficulty, localEra, localMap, type GeoNamesT } from "@/lib/geo-i18n";
import { WORLD_REGION } from "@/lib/geo-types";

type T = Translator<typeof pokeguessr.en>;

/**
 * A shared PokéGuessr result's view in the page's language (/pokeguessr/r/<token> and its share image): geo-share
 * writes it in English (as English pages show it), from the signed token alone; another language rebuilds the same
 * lines from the same facts. Still nothing names a place.
 */
export function localView(view: GeoShareView, t: T, names: GeoNamesT): GeoShareView {
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

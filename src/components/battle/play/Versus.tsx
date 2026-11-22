"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Swords, Trophy } from "lucide-react";
import { CPU_LEVEL_INFO, PLAY_FORMAT_INFO, type BattleView } from "@/lib/battle/play";
import type { BattleVersusRecord, BattleVersusResponse } from "@/lib/battle/versus";
import { battleIdHeaders, ensureBattleId } from "@/lib/battle/replay-client";
import { seededTrainer, type TrainerConfig } from "@/lib/trainer/config";
import { Dex } from "@pkmn/dex";
import { Figure, History, VersusIntro, type VersusSide } from "@/components/duel/VersusIntro";
import { PokemonArt } from "@/components/duel/VersusCharacter";
import { softwareWebgl, webglAvailable } from "./arena/webgl";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import playNs from "@/messages/battle-play";
import formatsNs from "@/messages/battle-formats";
import { cpuLevelBlurb, cpuLevelName, customRulesName, formatName } from "@/lib/battle/format-labels";

/**
 * The versus screen before a battle's first turn (the duel's, shared with
 * PokéGuessr): both trainers' 3D characters squaring up (the computer gets a
 * trainer of its own), each with their battle record and ladder rating in
 * this format from their battle profile. A few seconds long; Skip, Space or
 * Enter ends it at once. The first turn plays out once it's gone.
 */

export const YOU_ACCENT = "#f0457f";
export const FOE_ACCENT = "#a78bfa";
/** How long the intro stays up unless skipped. */
export const VERSUS_MS = 3_400;
/** A 3D trainer not on screen by then gives way to a flat one (their art, or their lead Pokémon's). */
export const VERSUS_PAINT_MS = 800;

/** A side's lead Pokémon as far as this player's log (or their own request) tells: its Dex number and shininess. */
export function versusLead(view: BattleView, side: "p1" | "p2"): { num: number; shiny: boolean } | null {
  const pick = (name: string, details: string) => {
    const species = Dex.species.get(details.split(",")[0] || name);
    return species.exists && species.num > 0 ? { num: species.num, shiny: /, shiny\b/.test(details) } : null;
  };
  let preview: { num: number; shiny: boolean } | null = null;
  for (const line of view.log.lines) {
    const [, cmd, who, details = ""] = line.split("|");
    if ((cmd === "switch" || cmd === "drag") && who?.startsWith(`${side}a`)) {
      const found = pick(who.slice(who.indexOf(":") + 1).trim(), details);
      if (found) return found;
    }
    if (cmd === "poke" && who === side && !preview) preview = pick("", details);
  }
  const mine = view.request?.data.side;
  if (mine?.id === side && mine.pokemon[0]) {
    const found = pick("", mine.pokemon[0].details);
    if (found) return found;
  }
  return preview;
}

/** The computer's own trainer, one look per difficulty. */
export function cpuTrainer(level: string): TrainerConfig {
  const base = seededTrainer(`cpu:${level}`, 137);
  const look: Partial<TrainerConfig> =
    level === "hard"
      ? { top: "jacket", topColor: "black", topTrim: "red", accent: "red", closed: true, hat: "none", hair: "spiky", hairColor: "silver", eyes: "sharp", expr: "smug", bottoms: "pants", bottomsColor: "black", gloves: "full", glovesColor: "black", ball: "poke" }
      : level === "easy"
        ? { top: "tee", topColor: "sky", hat: "cap", hatColor: "sky", expr: "happy", bottoms: "shorts", bottomsColor: "navy", gloves: "none", ball: "poke" }
        : { top: "hoodie", topColor: "purple", topTrim: "white", hat: "visor", hatColor: "white", expr: "determined", bottoms: "joggers", bottomsColor: "charcoal", ball: "poke" };
  return { ...base, ...look };
}

/** A trainer without a 3D trainer of their own still gets one (the same one every time for their name). */
export const standIn = (name: string) => seededTrainer(`battle:${name.toLowerCase()}`);

const cache = new Map<string, Promise<BattleVersusResponse | null>>();

/** Your record and the named trainers' (accounts), for this format. undefined while loading. */
export function useBattleVersus(names: string[], format: string, enabled: boolean): BattleVersusResponse | null | undefined {
  const key = `${names.map((n) => n.toLowerCase()).sort().join(",")}|${format}`;
  const [data, setData] = useState<BattleVersusResponse | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let p = cache.get(key);
    if (!p) {
      const [list, f] = key.split("|");
      p = ensureBattleId()
        .then(() => fetch(`/api/battle/versus?names=${encodeURIComponent(list)}&format=${encodeURIComponent(f)}`, { headers: battleIdHeaders(), cache: "no-store" }))
        .then((r) => (r.ok ? (r.json() as Promise<BattleVersusResponse>) : null))
        .catch(() => null);
      cache.set(key, p);
    }
    void p.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [key, enabled]);
  return data;
}

function RecordCard({ record, loading, rated }: { record: BattleVersusRecord | null | undefined; loading: boolean; rated: boolean }) {
  const t = useT(playNs);
  const n = (v: number) => formatNumber(v, t.locale);
  const dash = loading ? <span className="inline-block h-3 w-8 animate-pulse rounded bg-white/15 align-middle" aria-label={t("versus.loading")} /> : "—";
  const rate = record && record.battles ? Math.round(((record.wins + record.draws / 2) / record.battles) * 100) : null;
  return (
    <div data-testid="versus-battle-record">
      <dl className="grid grid-cols-3 border-y border-white/10 text-center">
        <Figure label={t("versus.battles")} value={record ? n(record.battles) : dash} />
        <Figure label={t("versus.won")} value={rate !== null ? `${rate}%` : record ? "—" : dash} className="border-l border-white/10" />
        <Figure label={rated ? t("versus.rating") : t("versus.wl")} value={rated ? (record?.elo !== undefined ? n(record.elo) : record ? "—" : dash) : record ? `${record.wins}–${record.losses}` : dash} className="border-l border-white/10" />
      </dl>
      <div className="space-y-2 px-3 py-2.5 sm:px-4 sm:py-3">
        {record?.position ? <p className="font-display text-xs font-bold text-[#ffd23c] sm:text-sm">{t("versus.position", { n: record.position })}</p> : null}
        <History recent={record?.recent} loading={loading} label={t("versus.last5")} none={t("versus.none")} />
      </div>
    </div>
  );
}

function CpuCard({ level }: { level: string }) {
  const t = useT(playNs);
  const tf = useT(formatsNs);
  const info = CPU_LEVEL_INFO[level as keyof typeof CPU_LEVEL_INFO];
  return (
    <div className="border-t border-white/10 px-3 py-2.5 sm:px-4 sm:py-3" data-testid="versus-cpu">
      <p className="font-pixel text-[8px] uppercase text-white/55 sm:text-[9px]">{t("versus.difficulty")}</p>
      <p className="font-display text-lg font-extrabold uppercase leading-tight sm:text-2xl">{info ? cpuLevelName(tf, level as keyof typeof CPU_LEVEL_INFO) : level}</p>
      {info && <p className="mt-1 text-xs leading-snug text-white/70 sm:text-sm">{cpuLevelBlurb(tf, level as keyof typeof CPU_LEVEL_INFO)}</p>}
    </div>
  );
}

export function BattleVersus({ view, onDone }: { view: BattleView; onDone: () => void }) {
  const t = useT(playNs);
  const tf = useT(formatsNs);
  const youSeat = view.you ?? 0;
  const foeSeat = youSeat === 0 ? 1 : 0;
  const you = view.players[youSeat];
  const foe = view.players[foeSeat];
  const cpu = view.cpu?.level ?? null;
  const names = useMemo(() => (foe && !cpu && !foe.bot ? [foe.name] : []), [foe, cpu]);
  const data = useBattleVersus(names, view.format, true);
  const loading = data === undefined;
  const rated = !!view.ranked || PLAY_FORMAT_INFO[view.format]?.random === true;
  const [left, setLeft] = useState(3);
  // Without WebGL, or with it drawn in software (seconds of shader compiling): the flat look (their art, their lead's,
  // the computer's badge). Session storage "pokeiq:battle:versus-3d" = "1" forces the 3D trainers (for checking them).
  const [gl] = useState(() => {
    if (!webglAvailable()) return false;
    try {
      if (window.sessionStorage.getItem("pokeiq:battle:versus-3d") === "1") return true;
    } catch {
      // storage blocked
    }
    return !softwareWebgl();
  });

  useEffect(() => {
    // The count starts once both trainers are drawn (or after a moment, whatever has loaded by then).
    const opened = Date.now();
    let t0 = 0;
    const id = window.setInterval(() => {
      const now = Date.now();
      if (!t0) {
        const drawn = document.querySelectorAll("[data-testid=battle-versus] [data-testid=versus-character]:is([data-painted='1'], :not([data-kind=trainer]))").length;
        if (drawn >= 2 || now - opened > 1_200) t0 = now;
        else return;
      }
      const gone = now - t0;
      setLeft(Math.max(1, 3 - Math.floor(gone / (VERSUS_MS / 3))));
      if (gone >= VERSUS_MS) onDone();
    }, 100);
    return () => window.clearInterval(id);
  }, [onDone]);

  // Each side's flat look, should their 3D trainer not draw: their lead Pokémon's art (the computer's badge without one).
  const youLead = versusLead(view, youSeat === 0 ? "p1" : "p2");
  const foeLead = versusLead(view, foeSeat === 0 ? "p1" : "p2");
  const youFlat = youLead ? <PokemonArt id={youLead.num} shiny={youLead.shiny} facing="right" /> : undefined;
  const foeFlat = foeLead ? <PokemonArt id={foeLead.num} shiny={foeLead.shiny} facing="left" /> : undefined;

  const youSide: VersusSide = {
    name: you?.name ?? t("you"),
    you: true,
    avatar: you?.avatar ?? null,
    fallback: gl ? standIn(you?.name ?? "you") : undefined,
    flat: youFlat,
    stats: null,
    record: <RecordCard record={data ? data.you : null} loading={loading} rated={rated} />,
    accent: YOU_ACCENT,
  };
  const foeSide: VersusSide = cpu
    ? {
        name: foe?.name ?? t("versus.computer"),
        fallback: gl ? cpuTrainer(cpu) : undefined,
        flat: foeFlat ?? (
          <span className="flex aspect-square w-[70%] items-center justify-center self-center rounded-full border-4 border-white/40 bg-[radial-gradient(circle_at_35%_30%,#c4b5fd,#6d28d9_70%)] shadow-2xl" aria-hidden data-testid="versus-cpu-badge">
            <Bot className="h-1/2 w-1/2 text-white" />
          </span>
        ),
        tag: (
          <span className="inline-flex items-center gap-1 rounded-sm border border-white/30 bg-white/10 px-1.5 py-0.5 font-pixel text-[9px] uppercase text-white/90">
            <Bot className="h-3 w-3" aria-hidden /> {t("versus.computer")}
          </span>
        ),
        stats: null,
        record: <CpuCard level={cpu} />,
        accent: FOE_ACCENT,
      }
    : {
        name: foe?.name ?? t("opponent"),
        avatar: foe?.avatar ?? null,
        fallback: gl ? standIn(foe?.name ?? "opponent") : undefined,
        flat: foeFlat,
        stats: null,
        record: <RecordCard record={data ? (data.names[(foe?.name ?? "").toLowerCase()] ?? null) : null} loading={loading && names.length > 0} rated={rated} />,
        accent: FOE_ACCENT,
      };

  const format =
    tf.locale === "en"
      ? (view.formatName ?? PLAY_FORMAT_INFO[view.format]?.name ?? "Battle")
      : view.rules
        ? customRulesName(tf, view.rules)
        : view.formatName && view.format !== "custom" && view.format !== "tower"
          ? view.formatName
          : PLAY_FORMAT_INFO[view.format]
            ? formatName(tf, view.format)
            : t("versus.battle");
  // On the body: a transformed ancestor would otherwise pin "fixed" to itself.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col" data-testid="battle-versus" role="dialog" aria-label={t("versus.label", { you: youSide.name, foe: foeSide.name })}>
      <VersusIntro
        testId="battle-versus-intro"
        left={youSide}
        right={foeSide}
        title={t("versus.title")}
        icon={view.ranked ? <Trophy className="h-8 w-8 text-[#ffd23c] sm:h-11 sm:w-11" aria-hidden /> : <Swords className="h-7 w-7 sm:h-10 sm:w-10" aria-hidden />}
        subtitle={
          <>
            {view.ranked ? t("rankedDot") : ""}
            {format}
          </>
        }
        detail={view.frontier ? t("versus.frontier", { round: view.frontier.round, battle: view.frontier.battle }) : cpu ? t("versus.cpu", { level: cpuLevelName(tf, cpu) }) : view.kind === "pvp" ? t("versus.live") : undefined}
        countdown={
          <span key={left} className="geo-digit font-display text-6xl font-extrabold leading-none sm:text-8xl" data-testid="battle-versus-digit">
            {left}
          </span>
        }
        onSkip={onDone}
        paintWithin={VERSUS_PAINT_MS}
        sharedGl
      />
    </div>,
    document.body
  );
}

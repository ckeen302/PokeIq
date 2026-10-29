"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Crown, Heart, Lock, Skull, Users } from "lucide-react";
import { avatarSrc } from "@/lib/avatar";
import { EMOTE_SHOW_MS, EMOTE_TEXT, isReaction, type DuelEmote } from "@/lib/pvp-types";
import { TAUNTS, TAUNT_GAP_MS, isTaunt, tauntBlocked, tauntOf, type TauntId } from "@/lib/trainer/taunts";
import { lowerFirst, seededTrainer, unlockHint } from "@/lib/trainer/config";
import { PARTY_MODE_NAMES, PARTY_TEAM_HP, TEAM_COLORS, TEAM_NAMES, partyColor, type PartyPlayerView, type PartyView } from "@/lib/geo-party";
import { HP_COLOR_HEX, hpColor } from "@/lib/geo-duel-rules";
import { sfx } from "@/lib/duel-sfx";
import { Avatar } from "@/components/avatar/Avatar";
import { VersusCharacter } from "@/components/duel/VersusCharacter";
import { useUnlocks } from "@/components/duel/TauntStage";
import { cn } from "@/lib/utils";

/** Pieces of a PokéGuessr party's screens (GeoParty.tsx): colours, the roster, HP, the line-up, reactions, the podium. */

export const fmt = (n: number) => n.toLocaleString("en-US");

/** A seat's colour: its team's in a team duel, its own in a Battle Royale. */
export function seatColor(view: Pick<PartyView, "players" | "settings">, seat: number): string {
  const p = view.players[seat];
  return view.settings.mode === "team" && p?.team !== undefined ? TEAM_COLORS[p.team] : partyColor(seat);
}

export const seatPin = (view: PartyView, seat: number) => {
  const p = view.players[seat];
  return p?.avatar ? avatarSrc(p.avatar) : undefined;
};

/** At most this many 3D trainers on one screen (each is its own WebGL canvas). */
export const MAX_3D = 8;

export function Lives({ lives, max, className }: { lives: number; max: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${lives} of ${max} lives`} data-testid="party-lives">
      {Array.from({ length: max }, (_, i) => (
        <Heart key={i} className={cn("h-3.5 w-3.5", i < lives ? "fill-[#ff5a5a] text-[#ff5a5a]" : "text-white/25")} aria-hidden />
      ))}
    </span>
  );
}

/** A team's HP bar (Pokémon's colours as it drains). */
export function TeamHp({ team, hp, you, className }: { team: 0 | 1; hp: number; you?: boolean; className?: string }) {
  const f = Math.max(0, hp) / PARTY_TEAM_HP;
  const [a, b] = HP_COLOR_HEX[hpColor(f)];
  return (
    <div className={cn("min-w-0", className)} data-testid={`party-hp-${team}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-display text-xs font-bold uppercase tracking-wide sm:text-sm" style={{ color: TEAM_COLORS[team] }}>
          {TEAM_NAMES[team]}
          {you && <span className="ml-1.5 rounded-sm bg-white/15 px-1 font-pixel text-[8px] text-white">You</span>}
        </span>
        <span className="font-pixel text-[11px] tabular-nums text-white" data-testid={`party-hp-value-${team}`}>
          {fmt(Math.max(0, hp))}
        </span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-black/50 ring-1 ring-white/15">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${f * 100}%`, background: `linear-gradient(${a}, ${b})` }} />
      </div>
    </div>
  );
}

/** Who's in, at a glance: guessed or not, lives, out. A column on desktop, a strip on a phone. */
export function Roster({ view, guessed, className }: { view: PartyView; guessed?: boolean[]; className?: string }) {
  const team = view.settings.mode === "team";
  const order = view.players.map((_, s) => s).sort((a, b) => Number(!!view.players[a].out) - Number(!!view.players[b].out) || (view.players[a].team ?? 0) - (view.players[b].team ?? 0));
  return (
    <ul className={cn("flex gap-1.5", className)} aria-label="Trainers" data-testid="party-roster">
      {order.map((seat) => {
        const p = view.players[seat];
        const done = guessed?.[seat];
        return (
          <li
            key={seat}
            className={cn(
              "flex min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-white backdrop-blur",
              p.out && "opacity-45",
              seat === view.you && "ring-1 ring-white/50"
            )}
            data-testid={`party-roster-${seat}`}
            data-guessed={done ? "true" : undefined}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seatColor(view, seat) }} aria-hidden />
            <span className="max-w-[7.5rem] truncate text-xs font-semibold">{seat === view.you ? "You" : p.name}</span>
            {!team && !p.out && <Lives lives={p.lives ?? 0} max={view.settings.lives} className="[&_svg]:h-2.5 [&_svg]:w-2.5" />}
            {p.out ? <Skull className="h-3 w-3 text-white/60" aria-label="Out" /> : done ? <Check className="h-3.5 w-3.5 text-[#9be15d]" aria-label="Guessed" /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** One trainer standing on a party screen: their 3D trainer (or art), name and colour. */
export function PartyTrainer({
  view,
  seat,
  three,
  pose = "idle",
  taunt,
  className,
  label,
}: {
  view: PartyView;
  seat: number;
  three: boolean;
  pose?: "idle" | "fight" | "victory" | "wave";
  taunt?: { id: TauntId; n: number } | null;
  className?: string;
  label?: React.ReactNode;
}) {
  const p = view.players[seat];
  const fallback = useMemo(() => seededTrainer(p?.name ?? "trainer", p?.avatar?.pokemonId ?? 25), [p?.name, p?.avatar?.pokemonId]);
  if (!p) return null;
  return (
    <div className={cn("relative flex min-w-0 flex-col items-center", className)} data-testid={`party-trainer-${seat}`} data-playing={taunt?.id}>
      <div className="relative w-full">
        <div aria-hidden className="absolute inset-x-[18%] bottom-[3%] h-[10%] rounded-[50%] bg-black/40 blur-md" />
        <div aria-hidden className="absolute inset-[22%] rounded-full opacity-50 blur-2xl" style={{ background: seatColor(view, seat) }} />
        {three ? (
          <VersusCharacter avatar={p.avatar} fallback={fallback} facing="right" pose={pose} taunt={taunt} className="relative mx-auto w-full" />
        ) : (
          <div className="relative flex aspect-square w-full items-center justify-center">
            <Avatar avatar={p.avatar} size={64} className="ring-2 ring-white/40" />
          </div>
        )}
        {taunt && (
          <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2 py-0.5 font-display text-[10px] font-bold uppercase text-[#1e1a3f] shadow-lg" role="status">
            {tauntOf(taunt.id)?.name}
          </span>
        )}
      </div>
      <p className="mt-1 flex max-w-full items-center gap-1 truncate font-display text-xs font-bold uppercase tracking-wide text-white sm:text-sm">
        {view.host === seat && <Crown className="h-3.5 w-3.5 shrink-0 text-[#ffd23c]" aria-label="Host" />}
        <span className="truncate">{seat === view.you ? "You" : p.name}</span>
      </p>
      {label}
    </div>
  );
}

/** The line-up before round 1: everyone's trainer, the game and the countdown. */
export function PartyLineup({ view, mapName, secondsLeft }: { view: PartyView; mapName: string; secondsLeft: number }) {
  const reduced = useReducedMotion();
  const team = view.settings.mode === "team";
  const three = view.players.length <= MAX_3D;
  const seats = view.players.map((_, s) => s);
  const side = (t: 0 | 1) => seats.filter((s) => view.players[s].team === t);
  const figure = (seat: number, i: number) => (
    <motion.div
      key={seat}
      initial={reduced ? false : { opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: reduced ? 0 : 0.05 * i, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(three ? "w-[min(26vw,10rem)] lg:w-[min(13vw,12rem)]" : "w-[4.5rem] sm:w-24")}
    >
      <PartyTrainer view={view} seat={seat} three={three} pose="fight" />
    </motion.div>
  );
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#14112b] text-white" data-testid="party-lineup">
      <div aria-hidden className="geo-split absolute inset-0 opacity-90" />
      <header className="relative z-10 px-4 pt-14 text-center sm:pt-10">
        <Users className="mx-auto h-8 w-8 sm:h-10 sm:w-10" aria-hidden />
        <h2 className="font-display text-4xl font-extrabold uppercase italic leading-none drop-shadow-[0_3px_0_rgba(0,0,0,0.45)] sm:text-6xl">{PARTY_MODE_NAMES[view.settings.mode]}</h2>
        <p className="mt-1 font-display text-sm font-bold uppercase text-[#ffd23c] sm:text-lg">
          {team ? `${fmt(PARTY_TEAM_HP)} HP a team · best pin counts` : `${view.players.length} trainers · ${view.settings.lives} ${view.settings.lives === 1 ? "life" : "lives"} each`}
        </p>
        <p className="font-display text-xs uppercase tracking-wider text-white/70 sm:text-sm">{mapName}</p>
      </header>
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-3 py-4">
        {team ? (
          <div className="grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6">
            {([0, 1] as const).map((t) => (
              <div key={t} className={cn("flex flex-wrap justify-center gap-2 sm:gap-4", t === 1 && "order-3")}>
                <p className="w-full text-center font-display text-sm font-extrabold uppercase italic sm:text-xl" style={{ color: TEAM_COLORS[t] }}>
                  {TEAM_NAMES[t]}
                </p>
                {side(t).map((s, i) => figure(s, i))}
              </div>
            ))}
            <span className="geo-glow order-2 font-display text-4xl font-extrabold italic sm:text-7xl">VS</span>
          </div>
        ) : (
          <div className="flex max-w-6xl flex-wrap justify-center gap-2 sm:gap-4">{seats.map((s, i) => figure(s, i))}</div>
        )}
      </div>
      <footer className="relative z-10 flex h-24 shrink-0 items-center justify-center sm:h-32">
        <span key={secondsLeft} className="geo-digit font-display text-6xl font-extrabold leading-none sm:text-8xl" data-testid="party-intro-digit">
          {secondsLeft}
        </span>
      </footer>
    </div>
  );
}

/** Reactions as they arrive, stacked by the top right: whose and which. */
export function PartyEmoteFeed({ view }: { view: PartyView }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<{ n: number; seat: number; emote: DuelEmote }[]>([]);
  const seen = useRef(-1);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const list = view.emotes ?? [];
    if (seen.current < 0) seen.current = Math.max(0, ...list.filter((e) => view.now - e.at > 1500).map((e) => e.n));
    const fresh = list.filter((e) => e.n > seen.current && view.now - e.at < EMOTE_SHOW_MS);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((e) => e.n));
    const reactions = fresh.filter(isReaction);
    if (!reactions.length) return;
    if (reactions.some((e) => e.seat !== view.you)) sfx("ping");
    setShown((s) => [...s, ...reactions.map(({ n, seat, emote }) => ({ n, seat, emote }))].slice(-5));
    const ns = new Set(reactions.map((e) => e.n));
    timers.current.push(window.setTimeout(() => setShown((s) => s.filter((x) => !ns.has(x.n))), 3_000));
  }, [view.emotes, view.now, view.you]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);
  return (
    <div className="pointer-events-none fixed right-3 top-24 z-50 flex flex-col items-end gap-2" aria-live="polite">
      <AnimatePresence>
        {shown.map((e) => (
          <motion.span
            key={e.n}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16, scale: 0.7 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-2xl shadow-lg backdrop-blur"
            data-testid={`party-emote-${e.seat}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: seatColor(view, e.seat) }} aria-hidden />
            <span className="max-w-[8rem] truncate font-display text-[11px] font-bold uppercase text-muted-foreground">{e.seat === view.you ? "You" : view.players[e.seat]?.name}</span>
            {e.emote === "gg" ? <span className="font-display text-lg font-bold">GG</span> : EMOTE_TEXT[e.emote]}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Taunts playing on each seat's trainer right now (from the party's reactions; yours play the moment you press). */
export function usePartyTaunts(view: PartyView) {
  const [playing, setPlaying] = useState<Record<number, { id: TauntId; n: number }>>({});
  const seen = useRef(-1);
  const count = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);
  function start(seat: number, id: TauntId) {
    const n = ++count.current;
    setPlaying((p) => ({ ...p, [seat]: { id, n } }));
    timers.current.push(
      window.setTimeout(
        () =>
          setPlaying((p) => {
            if (p[seat]?.n !== n) return p;
            const next = { ...p };
            delete next[seat];
            return next;
          }),
        (tauntOf(id)?.secs ?? 3) * 1000 + 250
      )
    );
  }
  useEffect(() => {
    const list = (view.emotes ?? []).filter((e) => isTaunt(e.emote));
    if (seen.current < 0) seen.current = Math.max(0, ...list.filter((e) => view.now - e.at >= 2_000).map((e) => e.n));
    const fresh = list.filter((e) => e.n > seen.current);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((e) => e.n));
    for (const e of fresh) if (e.seat !== view.you) start(e.seat, e.emote as TauntId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- new taunts only
  }, [view.emotes]);
  return { playing, start };
}

/** The dances and emotes bar on the standings screen. */
export function TauntBar({ onTaunt }: { onTaunt: (id: TauntId) => Promise<string | null> }) {
  const unlocks = useUnlocks();
  const [coolUntil, setCoolUntil] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!coolUntil) return;
    const id = window.setTimeout(() => tick((n) => n + 1), Math.max(0, coolUntil - Date.now()) + 20);
    return () => window.clearTimeout(id);
  }, [coolUntil]);
  const cooling = coolUntil > Date.now();
  async function send(id: TauntId) {
    if (cooling) return;
    setCoolUntil(Date.now() + TAUNT_GAP_MS);
    setNote(null);
    const err = await onTaunt(id);
    if (err) setNote(err);
  }
  return (
    <div className="space-y-2 rounded-xl border border-white/15 bg-[#1e1a3f]/80 p-2.5 backdrop-blur sm:p-3" data-testid="party-taunt-bar">
      {(["dance", "emote"] as const).map((kind) => (
        <div key={kind} className="flex items-start gap-2">
          <p className="w-14 shrink-0 pt-2 font-pixel text-[9px] uppercase text-white/60">{kind === "dance" ? "Dances" : "Emotes"}</p>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {TAUNTS.filter((t) => t.kind === kind).map((t) => {
              const locked = !!tauntBlocked(t.id, unlocks);
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={locked || cooling}
                  onClick={() => void send(t.id)}
                  title={locked ? `${t.name}: ${unlockHint(t)}` : t.name}
                  aria-label={locked ? `${t.name} (locked: ${lowerFirst(unlockHint(t))})` : `Play ${t.name}`}
                  className={cn(
                    "flex h-8 items-center gap-1 rounded-full border px-3 font-display text-[11px] font-bold uppercase tracking-wide transition-[background-color,transform,opacity] sm:text-xs",
                    locked ? "cursor-not-allowed border-white/10 text-white/40" : "border-white/25 text-white hover:scale-105 hover:bg-white/10 disabled:opacity-50 disabled:hover:scale-100"
                  )}
                  data-testid={`party-taunt-${t.id}`}
                >
                  {t.name}
                  {locked && <Lock className="h-3 w-3" aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {note && (
        <p className="text-[11px] text-white/70" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

export type { PartyPlayerView };

"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LogOut, Smile, Swords, WifiOff } from "lucide-react";
import { DUEL_HP, type DuelRoundResult, type DuelView } from "@/lib/duel-types";
import { DUEL_COUNTDOWN_FLASH_MS, HP_COLOR_HEX, countValue, hpColor, revealTimeline, type RevealTimeline } from "@/lib/geo-duel-rules";
import { GEO_EMOTES, geoEmote, type DuelEmote, type GeoEmoteId, type PvpEmoteView } from "@/lib/pvp-types";
import { avatarSrc } from "@/lib/avatar";
import { artUrl } from "@/lib/pokemon/art";
import { play } from "@/lib/sound";
import { Avatar } from "@/components/avatar/Avatar";
import { SEAT_COLORS } from "@/components/duel/DuelParts";
import { cn } from "@/lib/utils";
import { GeoBallIcon, GeoDivisionBadge, GymLeaderAvatar, GymLeaderTag } from "./GeoRanked";
import { geoDivisionOf } from "@/lib/geo-ranked";

/**
 * The duel's HUD, GeoGuessr's: a top band with slanted HP bars at the screen
 * edges (filling inward, the HP number inside, avatar and name outside), a
 * centre notch with the round and the damage multiplier, and in the reveal
 * the two glowing scores straddling the band's edge over a two-tone distance
 * pill. The reveal sequence (scores count up, the damage floats, the bar
 * drains, "It's super effective!") runs here from what the server stamped.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
/** You are always green and the opponent purple, whatever seat you sit in. */
export const YOU_COLOR = "#4cbb17";
export const THEM_COLOR = "#6c5ce7";

export const seatImage = (view: DuelView, seat: number): string | undefined => {
  const p = view.players[seat];
  return p?.avatar ? avatarSrc(p.avatar) : undefined;
};

export function distanceText(squares: number): string {
  if (squares === 0) return "Right on it!";
  return `${squares.toFixed(1)} sq`;
}

// ---------------------------------------------------------------------------
// The reveal sequence
// ---------------------------------------------------------------------------

export interface RevealState {
  /** Each seat's score as it counts up. */
  scores: number[];
  /** Each seat's HP as the loser's drains. */
  hp: number[];
  /** The damage number is up. */
  damage: boolean;
  /** The loser's avatar shakes. */
  shaking: boolean;
  /** "It's super effective!" is up. */
  superPop: boolean;
  /** The scores have landed. */
  scored: boolean;
  /** Everything has landed. */
  done: boolean;
}

const SHAKE_MS = 450;

/** Runs the reveal's timeline for a round result: a frame loop driving the numbers, with the sounds on each beat. */
export function useRevealSequence(result: DuelRoundResult | null, me: number | null): RevealState {
  const reduced = useReducedMotion();
  const key = result ? `${result.index}:${result.damage}` : "";
  const [state, setState] = useState<RevealState>(() => initial(result));
  useEffect(() => {
    if (!result) return;
    const tl = revealTimeline(result, !!reduced);
    const scores = result.guesses.map((g) => g?.score ?? 0);
    const before = result.hpBefore;
    const after = result.hp;
    const hurt = result.hurt;
    let raf = 0;
    const t0 = performance.now();
    let lastTally = 0;
    const fired = new Set<string>();
    const once = (beat: string, at: number | null, t: number, go: () => void) => {
      if (at !== null && t >= at && !fired.has(beat)) {
        fired.add(beat);
        go();
      }
    };
    const frame = (now: number) => {
      const t = reduced ? tl.total : now - t0;
      const sc = scores.map((s) => countValue(0, s, t - tl.scoresAt, tl.scoresDone - tl.scoresAt));
      const hp = before.map((h, seat) => (seat === hurt && tl.drainAt !== null && tl.drainDone !== null ? countValue(h, after[seat], t - tl.drainAt, tl.drainDone - tl.drainAt) : h));
      setState({
        scores: sc,
        hp,
        damage: tl.damageAt !== null && t >= tl.damageAt,
        shaking: tl.drainAt !== null && t >= tl.drainAt && t < tl.drainAt + SHAKE_MS,
        superPop: tl.superAt !== null && t >= tl.superAt,
        scored: t >= tl.scoresDone,
        done: t >= tl.total,
      });
      if (!reduced) {
        if (t < tl.scoresDone && now - lastTally > 90 && sc.some((v, i) => v > 0 && v < scores[i])) {
          lastTally = now;
          play("tally");
        }
        once("scored", tl.scoresDone, t, () => {
          if (me !== null && result.winner !== null) play(result.winner === me ? "roundwin" : "roundlose");
        });
        once("hit", tl.drainAt, t, () => play("hit"));
        once("super", tl.superAt, t, () => play("super"));
      }
      if (t < tl.total) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one sequence per revealed round
  }, [key, reduced]);
  return state;
}

function initial(result: DuelRoundResult | null): RevealState {
  return { scores: [0, 0], hp: result ? [...result.hpBefore] : [DUEL_HP, DUEL_HP], damage: false, shaking: false, superPop: false, scored: false, done: false };
}

/** The timeline for a result, for anything that wants to schedule around the sequence. */
export const timelineOf = (result: DuelRoundResult, reduced: boolean): RevealTimeline => revealTimeline(result, reduced);

// ---------------------------------------------------------------------------
// The band
// ---------------------------------------------------------------------------

export interface BandProps {
  view: DuelView;
  me: number;
  /** The round shown in the notch (1-based). */
  round: number;
  /** Each seat's HP as shown (animated during a reveal). */
  hp: number[];
  /** The ramp's multiplier for the round, and each seat's own. */
  multiplier: number;
  multipliers: number[];
  /** The revealed round and the sequence, when revealing. */
  result?: DuelRoundResult | null;
  seq?: RevealState;
  /** Slimmer in-round (the picture shows through under it). */
  compact?: boolean;
  /** Hung under the notch: the countdown pill. */
  below?: React.ReactNode;
  className?: string;
}

export function DuelBand({ view, me, round, hp, multiplier, multipliers, result, seq, compact, below, className }: BandProps) {
  const race = view.mode === "race";
  const revealing = !!result && !!seq;
  const division = view.ranked ? geoDivisionOf(view.ranked.elos[me]) : null;
  return (
    <div
      className={cn("geo-band relative z-20 w-full shrink-0 border-b-4 border-[#a99cff] text-white", compact ? "h-[7.25rem] sm:h-[8.5rem]" : "h-[10.5rem] sm:h-[15rem]", className)}
      data-testid="geo-duel-band"
      data-phase={revealing ? "reveal" : "round"}
    >
      {[0, 1].map((seat) => (
        <Fighter
          key={seat}
          view={view}
          seat={seat}
          me={me}
          hp={hp[seat]}
          multiplier={multipliers[seat] ?? 1}
          right={seat === 1}
          compact={compact}
          damage={revealing && result.hurt === seat && seq.damage ? result.damage : 0}
          shaking={revealing && result.hurt === seat && seq.shaking}
          winner={revealing && seq.scored && result.winner === seat}
          dim={revealing && seq.scored && result.winner !== null && result.winner !== seat}
        />
      ))}

      {/* The centre stack: the emblem, the round and the damage multiplier. */}
      <div className="absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center gap-0.5 pt-1.5 sm:pt-2">
        {division ? (
          <GeoBallIcon division={division.id} className={cn("drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]", compact ? "h-6 w-6 sm:h-8 sm:w-8" : "h-8 w-8 sm:h-14 sm:w-14")} />
        ) : (
          <span className={cn("flex items-center justify-center rounded-full bg-black/40 ring-2 ring-[#a99cff]/60", compact ? "h-6 w-6 sm:h-8 sm:w-8" : "h-8 w-8 sm:h-14 sm:w-14")}>
            <Swords className={compact ? "h-3.5 w-3.5 sm:h-4 sm:w-4" : "h-4 w-4 sm:h-7 sm:w-7"} aria-hidden />
          </span>
        )}
        <div className={cn("font-display font-extrabold uppercase italic leading-none tracking-wide", compact ? "text-base sm:text-xl" : "text-xl sm:text-[1.65rem]")} data-testid="geo-duel-round">
          Round {round}
          <span className="text-white/45">/{view.maxRounds}</span>
        </div>
        {!race && (
          <div className={cn("geo-glow font-display font-extrabold uppercase italic leading-none tracking-wider", compact ? "text-[13px] sm:text-base" : "text-base sm:text-2xl")} data-testid="geo-duel-multiplier">
            {multiplier.toFixed(1).replace(/\.0$/, "")}× Damage
          </div>
        )}
        {race && (
          <div className="font-display text-xs font-bold uppercase tracking-wider text-[#c8bfff]">Points race</div>
        )}
        {below && <div className="mt-1.5">{below}</div>}
      </div>

      {/* The reveal: both scores straddling the band's edge, the distance pill between them. */}
      {revealing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex translate-y-1/2 items-center justify-center gap-3 sm:gap-10">
          <Score value={seq.scores[0]} missed={!result.guesses[0]} winner={seq.scored && result.winner === 0} dim={seq.scored && result.winner === 1} testId="geo-duel-score-0" />
          <AnimatePresence>
            {seq.scored && (
              <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 320, damping: 18 }}
                className="flex h-11 items-stretch overflow-hidden rounded-xl border-[3px] border-[#a99cff] bg-[#1e1a3f] font-display text-sm font-bold uppercase italic shadow-xl sm:h-14 sm:text-lg"
                data-testid="geo-duel-distance"
              >
                <span className="flex items-center px-3 sm:px-5" style={{ background: YOU_COLOR }}>
                  {result.guesses[me] ? distanceText(result.guesses[me]!.squares) : "No pin"}
                </span>
                <span className="flex w-8 items-center justify-center bg-[#1e1a3f] sm:w-10" aria-hidden>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3a4 4 0 0 0-4 4c0 3 4 7 4 7s4-4 4-7a4 4 0 0 0-4-4z" />
                    <path d="M16 10a4 4 0 0 0-4 4c0 3 4 7 4 7s4-4 4-7a4 4 0 0 0-4-4z" />
                  </svg>
                </span>
                <span className="flex items-center px-3 sm:px-5" style={{ background: THEM_COLOR }}>
                  {result.guesses[1 - me] ? distanceText(result.guesses[1 - me]!.squares) : "No pin"}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <Score value={seq.scores[1]} missed={!result.guesses[1]} winner={seq.scored && result.winner === 1} dim={seq.scored && result.winner === 0} testId="geo-duel-score-1" />
        </div>
      )}

      {/* "It's super effective!" */}
      <AnimatePresence>
        {revealing && seq.superPop && (
          <div className="geo-super pointer-events-none absolute left-1/2 top-full z-30 mt-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#ffd23c] px-4 py-1.5 font-display text-base font-extrabold uppercase italic tracking-wide text-[#1e1a3f] shadow-xl sm:mt-14 sm:text-2xl" data-testid="geo-super-effective" role="status">
            It&apos;s super effective!
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Score({ value, missed, winner, dim, testId }: { value: number; missed: boolean; winner: boolean; dim: boolean; testId: string }) {
  return (
    <span
      className={cn(
        "geo-glow min-w-[4.5rem] text-center font-display text-3xl font-extrabold italic tabular-nums transition-[transform,opacity] duration-200 sm:min-w-[9rem] sm:text-6xl",
        winner && "scale-110",
        dim && "opacity-70"
      )}
      data-testid={testId}
    >
      {missed && value === 0 ? "—" : fmt(value)}
    </span>
  );
}

/** One trainer's corner of the band: the avatar outside, the slanted HP bar filling inward, the name and badges, their multiplier chip. */
function Fighter({
  view,
  seat,
  me,
  hp,
  multiplier,
  right,
  compact,
  damage,
  shaking,
  winner,
  dim,
}: {
  view: DuelView;
  seat: number;
  me: number;
  hp: number;
  multiplier: number;
  right: boolean;
  compact?: boolean;
  damage: number;
  shaking: boolean;
  winner: boolean;
  dim: boolean;
}) {
  const player = view.players[seat];
  const race = view.mode === "race";
  const you = seat === me;
  const frac = Math.max(0, Math.min(1, hp / DUEL_HP));
  const tone = hpColor(frac);
  const [light, dark] = HP_COLOR_HEX[tone];
  const avatar = compact ? 40 : 56;
  return (
    <div className={cn("absolute top-2 flex w-[37%] flex-col sm:top-3 sm:w-[30%]", right ? "right-0 items-end pr-2 sm:pr-4" : "left-0 items-start pl-2 sm:pl-4")} data-testid={`geo-fighter-${seat}`} data-hp-color={tone}>
      <div className={cn("flex w-full items-center gap-1.5 sm:gap-2", right && "flex-row-reverse")}>
        {/* The avatar overlaps the bar's outer end. */}
        <div className={cn("relative z-[2] shrink-0 rounded-full ring-[3px] ring-[#a99cff] shadow-lg transition-opacity", shaking && "geo-shake", dim && "opacity-70")} data-testid={`geo-avatar-${seat}`} data-shaking={shaking ? "true" : undefined}>
          {player?.bot ? <GymLeaderAvatar name={player.name} size={avatar} /> : <Avatar avatar={player?.avatar} size={avatar} large={avatar > 48} />}
          <GeoEmotePops view={view} seat={seat} />
        </div>
        {!race ? (
          <div className={cn("relative -mx-3 h-7 min-w-0 flex-1 sm:-mx-4 sm:h-10", right ? "pl-3 sm:pl-4" : "pr-3 sm:pr-4")}>
            <div className="geo-skew h-full w-full bg-[#a99cff] p-[3px]" data-testid={`geo-hp-${seat}`}>
              <div className="geo-skew relative h-full w-full overflow-hidden bg-[#0f0d1f]">
                <div
                  className="absolute inset-y-0 w-full transition-[background] duration-300"
                  style={{
                    background: `linear-gradient(180deg, ${light}, ${dark})`,
                    transform: `scaleX(${frac})`,
                    transformOrigin: right ? "right" : "left",
                    boxShadow: `inset 0 -4px 0 rgba(0,0,0,0.18)`,
                  }}
                  data-testid={`geo-hp-fill-${seat}`}
                />
              </div>
            </div>
            <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-extrabold italic tabular-nums text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.6)] sm:text-xl" data-testid={`geo-hp-value-${seat}`}>
              {fmt(Math.round(hp))}
            </span>
            {damage > 0 && (
              <span key={damage} className="geo-float pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap font-display text-2xl font-extrabold italic text-[#ff5a5a] drop-shadow-[0_2px_0_rgba(0,0,0,0.7)] sm:text-4xl" data-testid={`geo-damage-${seat}`} aria-live="polite">
                −{fmt(damage)}
              </span>
            )}
          </div>
        ) : (
          <div className={cn("flex min-w-0 flex-1 items-center", right ? "justify-start" : "justify-end")}>
            <span className="rounded-md bg-black/40 px-3 py-1 font-display text-base font-extrabold italic tabular-nums sm:text-2xl" data-testid={`geo-duel-total-${seat}`}>
              {fmt(view.totals?.[seat] ?? 0)} pts
            </span>
          </div>
        )}
      </div>
      <div className={cn("mt-1 flex max-w-full items-center gap-1.5 sm:gap-2", right && "flex-row-reverse")}>
        <span className={cn("truncate font-display text-xs font-bold uppercase sm:text-base", winner && "text-[#9be15d]")} data-testid={`geo-name-${seat}`}>
          {player?.name ?? "—"}
        </span>
        {you && <span className="rounded-sm bg-white/15 px-1 font-pixel text-[8px] uppercase sm:text-[9px]">You</span>}
        {player?.bot && <GymLeaderTag />}
        {player?.quiet && view.status === "playing" && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Connection lost" />}
      </div>
      <div className={cn("mt-0.5 flex items-center gap-1.5", right && "flex-row-reverse")}>
        {view.ranked && <GeoDivisionBadge elo={view.ranked.elos[seat]} size="sm" className="[&_span]:!text-white/80" />}
        {!race && (
          <span className={cn("rounded-full px-2 py-0.5 font-display text-[10px] font-bold italic sm:text-xs", multiplier > 1 ? "bg-[#ffd23c] text-[#1e1a3f]" : "bg-white/15 text-white/80")} data-testid={`geo-multiplier-${seat}`} title="This trainer's damage multiplier">
            ×{multiplier}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The opponent-guessed bar
// ---------------------------------------------------------------------------

/** Under the band once the opponent has locked in: "Opponent guessed", a draining bar, red and flashing for the last seconds. */
export function OpponentGuessedBar({ name, leftMs, totalMs, mine }: { name: string; leftMs: number; totalMs: number; mine: boolean }) {
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, leftMs / totalMs)) : 0;
  const urgent = leftMs <= DUEL_COUNTDOWN_FLASH_MS;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      role="status"
      className={cn("pointer-events-none absolute inset-x-0 z-20 overflow-hidden bg-[#1e1a3f]/90 text-white backdrop-blur", urgent && "geo-flash-red")}
      data-testid="geo-opponent-guessed"
      data-urgent={urgent ? "true" : undefined}
    >
      <div className="flex items-center justify-center gap-2 py-1.5 font-display text-sm font-bold uppercase tracking-wider sm:text-base">
        {mine ? (
          <>Locked in. Waiting for {name}…</>
        ) : (
          <>
            <span className={cn("rounded-sm px-1.5 py-0.5 text-[11px]", urgent ? "bg-[#ff5a5a]" : "bg-[#ffd23c] text-[#1e1a3f]")}>{name} guessed</span>
            {Math.ceil(leftMs / 1000)} s to guess
          </>
        )}
      </div>
      <div className="h-1.5 w-full bg-black/40">
        <div className={cn("h-full origin-left transition-transform duration-300 ease-linear", urgent ? "bg-[#ff5a5a]" : "bg-[#ffd23c]")} style={{ transform: `scaleX(${frac})` }} />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// The live channel
// ---------------------------------------------------------------------------

/**
 * How the duel's pushes are doing (use-duel-live.ts): a green dot and "Live"
 * while they arrive; an amber pulsing "Reconnecting…" while the channel is
 * down and the page polls every second instead. Nothing while connecting
 * for the first time, or where pushes aren't set up.
 */
export function LivePill({ status, className }: { status: "off" | "connecting" | "up" | "down"; className?: string }) {
  if (status === "off" || status === "connecting") return null;
  const down = status === "down";
  return (
    <span
      role="status"
      className={cn("hud-btn pointer-events-none !w-auto gap-1.5 px-2.5 text-xs font-semibold", down ? "text-[#ffd23c]" : "text-white/80", className)}
      data-testid="geo-duel-live"
      data-live={status}
      title={down ? "Lost the live connection: updates come every second until it's back" : "Live: your opponent's moves show at once"}
    >
      <span className={cn("inline-block h-2 w-2 rounded-full", down ? "animate-pulse bg-[#ffd23c]" : "bg-[#9be15d] shadow-[0_0_6px_#9be15d]")} aria-hidden />
      {down ? "Reconnecting…" : "Live"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Leaving
// ---------------------------------------------------------------------------

/** The in-game leave button: a confirm strip, since leaving forfeits. */
export function DuelLeave({ busy, onLeave }: { busy: boolean; onLeave: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {sure ? (
        <div className="flex items-center gap-2 rounded-md bg-black/70 px-3 py-1.5 text-sm text-white backdrop-blur">
          <span className="hidden sm:inline">Leaving forfeits the duel.</span>
          <button type="button" disabled={busy} onClick={onLeave} className="rounded bg-[#ff5a5a] px-2.5 py-1 font-display text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            Forfeit
          </button>
          <button type="button" onClick={() => setSure(false)} className="rounded px-2 py-1 font-display text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white">
            Stay
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setSure(true)} className="hud-btn !w-auto gap-1.5 px-2.5 text-xs font-semibold" aria-label="Leave duel" title="Leave duel">
          <LogOut className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Leave duel</span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emotes
// ---------------------------------------------------------------------------

/** The persistent emote button at the frame's left edge: opens the eight Pokémon reactions. */
export function EmoteButton({ onEmote, className }: { onEmote: (e: DuelEmote) => Promise<string | null>; className?: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [coolUntil, setCoolUntil] = useState(0);
  const cooling = coolUntil > Date.now();
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-emotes]")) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className={cn("absolute left-3 top-1/2 z-30 -translate-y-1/2", className)} data-emotes>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Send a reaction"
        title="Send a reaction"
        data-testid="geo-emote-button"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1e1a3f]/90 text-white shadow-lg ring-2 ring-white/20 backdrop-blur transition-transform hover:scale-105"
      >
        <Smile className="h-5 w-5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -8, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, scale: 0.9 }}
            transition={{ duration: 0.18 }}
            className="absolute left-12 top-1/2 grid -translate-y-1/2 grid-cols-[repeat(4,3rem)] gap-1 rounded-xl bg-[#1e1a3f]/95 p-2 shadow-2xl ring-2 ring-[#a99cff]/50 backdrop-blur"
            role="menu"
            aria-label="Reactions"
          >
            {GEO_EMOTES.map((e) => (
              <button
                key={e.id}
                type="button"
                role="menuitem"
                disabled={cooling}
                onClick={async () => {
                  setCoolUntil(Date.now() + 1500);
                  setOpen(false);
                  setNote(await onEmote(e.id));
                }}
                data-testid={`geo-emote-${e.id}`}
                title={e.label}
                aria-label={`Send ${e.label}`}
                className="flex h-12 w-12 flex-col items-center justify-center rounded-lg transition-[background-color,transform] hover:scale-105 hover:bg-white/10 disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- the Pokémon's artwork, cached */}
                <img src={artUrl(e.pokemonId, 96)} alt="" className="h-9 w-9 object-contain" loading="lazy" />
              </button>
            ))}
            {note && <p className="col-span-4 text-center text-[11px] text-white/70">{note}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The last reaction shown per duel and seat, so a reaction doesn't pop again when the next screen mounts a fresh band. */
const seenEmotes = new Map<string, number>();

/** Reactions popping by a seat's avatar: the Pokémon (or the text) with its label. */
function GeoEmotePops({ view, seat }: { view: DuelView; seat: number }) {
  const [shown, setShown] = useState<PvpEmoteView[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const key = `${view.code}:${seat}`;
    const seen = seenEmotes.get(key) ?? 0;
    const fresh = (view.emotes ?? []).filter((e) => e.n > seen);
    if (!fresh.length) return;
    seenEmotes.set(key, Math.max(...fresh.map((e) => e.n)));
    const mine = fresh.filter((e) => e.seat === seat);
    if (!mine.length) return;
    if (seat !== view.you) play("ping");
    setShown((s) => [...s, ...mine].slice(-3));
    const ns = new Set(mine.map((e) => e.n));
    timers.current.push(window.setTimeout(() => setShown((s) => s.filter((x) => !ns.has(x.n))), 2600));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- new reactions only
  }, [view.emotes]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);
  if (!shown.length) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-full z-40 -translate-x-1/2" aria-live="polite" data-testid={`geo-emote-pop-${seat}`}>
      {shown.map((e) => (
        <EmotePop key={e.n} emote={e.emote} />
      ))}
    </div>
  );
}

function EmotePop({ emote }: { emote: DuelEmote }) {
  const geo = geoEmote(emote);
  return (
    <div className="geo-emote-pop mt-1 flex flex-col items-center">
      {geo ? (
        // eslint-disable-next-line @next/next/no-img-element -- the Pokémon's artwork, cached
        <img src={artUrl(geo.pokemonId, 96)} alt={geo.label} className="h-14 w-14 object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)] sm:h-16 sm:w-16" />
      ) : null}
      <span className="whitespace-nowrap rounded-full bg-white px-2 py-0.5 font-display text-[11px] font-bold text-[#1e1a3f] shadow">{geo ? geo.label : emote === "gg" ? "GG" : emoteText(emote)}</span>
    </div>
  );
}

const emoteText = (e: DuelEmote) => ({ gg: "GG", fire: "🔥", wow: "😮", sweat: "😅", clap: "👏" })[e as Exclude<DuelEmote, GeoEmoteId>] ?? e;

// ---------------------------------------------------------------------------
// The versus / round intro
// ---------------------------------------------------------------------------

/** The round lead-in: the diagonal split, both trainers' cards, "VS" for round 1, and the giant countdown digit. */
export function VersusIntro({ view, me, round, secondsLeft, mapName }: { view: DuelView; me: number; round: number; secondsLeft: number; mapName: string }) {
  const versus = round === 1;
  const reduced = useReducedMotion();
  const mult = view.round?.multiplier ?? 1;
  const card = (seat: number) => {
    const p = view.players[seat];
    return (
      <motion.div
        key={`card-${seat}`}
        initial={reduced ? false : { opacity: 0, x: seat === 0 ? -40 : 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className={cn("flex w-[9.5rem] flex-col items-center gap-2 rounded-xl border-[3px] border-[#a99cff] bg-[#1e1a3f]/95 p-3 text-center shadow-2xl sm:w-[14rem] sm:p-5", versus ? "" : "scale-90")}
        data-testid={`geo-vs-card-${seat}`}
      >
        <div className="rounded-full ring-4 ring-[#a99cff]/70">{p?.bot ? <GymLeaderAvatar name={p.name} size={versus ? 72 : 48} /> : <Avatar avatar={p?.avatar} size={versus ? 72 : 48} large />}</div>
        <p className="w-full truncate font-display text-base font-extrabold uppercase italic sm:text-xl">{p?.name ?? "—"}</p>
        {seat === me && <span className="rounded-sm bg-white/15 px-1.5 font-pixel text-[9px] uppercase">You</span>}
        {view.ranked && <GeoDivisionBadge elo={view.ranked.elos[seat]} size="sm" className="[&_span]:!text-white/90" />}
        {view.mode !== "race" && (
          <p className="font-display text-xs font-bold text-[#c8bfff]">
            {fmt(view.hp[seat])} <span className="text-white/60">HP</span>
          </p>
        )}
      </motion.div>
    );
  };
  return (
    <div className="geo-split relative flex h-full flex-col items-center justify-center overflow-hidden text-white" data-testid="geo-versus">
      <div className="absolute inset-x-0 top-4 flex flex-col items-center gap-0.5 text-center sm:top-8">
        {view.ranked ? <GeoBallIcon division={geoDivisionOf(view.ranked.elos[me]).id} className="h-10 w-10 drop-shadow-lg sm:h-16 sm:w-16" /> : <Swords className="h-8 w-8 sm:h-12 sm:w-12" aria-hidden />}
        <p className="font-display text-3xl font-extrabold uppercase italic sm:text-5xl">Round {round}</p>
        <p className="font-display text-base font-bold uppercase text-[#ffd23c] sm:text-xl">
          {view.mode === "race" ? "Points race" : mult > 1 ? `${mult}× damage` : "HP battle"}
          {view.turbo ? " · Turbo" : ""}
        </p>
        <p className="font-display text-sm uppercase tracking-wider text-white/70">{mapName}</p>
      </div>
      <div className="flex items-center gap-4 sm:gap-12">
        {card(0)}
        {versus ? (
          <motion.span
            initial={reduced ? false : { scale: 0.3, opacity: 0, rotate: -12 }}
            animate={{ scale: 1, opacity: 1, rotate: -6 }}
            transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.25 }}
            className="geo-glow font-display text-5xl font-extrabold italic sm:text-8xl"
            aria-label="versus"
          >
            VS
          </motion.span>
        ) : (
          <span key={`digit-${secondsLeft}`} className="geo-digit font-display text-[7rem] font-extrabold leading-none sm:text-[11rem]" data-testid="geo-intro-digit">
            {secondsLeft}
          </span>
        )}
        {card(1)}
      </div>
      {versus && (
        <span key={secondsLeft} className="geo-digit absolute bottom-6 font-display text-6xl font-extrabold leading-none sm:bottom-10 sm:text-8xl" data-testid="geo-intro-digit">
          {secondsLeft}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The HP timeline (end screen)
// ---------------------------------------------------------------------------

/** Both trainers' HP after each round, as two lines. */
export function HpTimeline({ view, me }: { view: DuelView; me: number }) {
  const rounds = view.revealed;
  if (!rounds.length || view.mode === "race") return null;
  const w = 320;
  const h = 90;
  const pad = 6;
  const xs = (i: number) => pad + (i / Math.max(1, rounds.length)) * (w - 2 * pad);
  const ys = (hp: number) => pad + (1 - Math.max(0, hp) / DUEL_HP) * (h - 2 * pad);
  const line = (seat: number) => [`M${xs(0)} ${ys(DUEL_HP)}`, ...rounds.map((r, i) => `L${xs(i + 1)} ${ys(r.hp[seat])}`)].join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" role="img" aria-label="HP after each round" data-testid="geo-hp-timeline">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={pad} x2={w - pad} y1={ys(DUEL_HP * f)} y2={ys(DUEL_HP * f)} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 4" />
      ))}
      {[0, 1].map((seat) => (
        <path key={seat} d={line(seat)} fill="none" stroke={seat === me ? YOU_COLOR : THEM_COLOR} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {rounds.map((r, i) =>
        [0, 1].map((seat) => <circle key={`${i}-${seat}`} cx={xs(i + 1)} cy={ys(r.hp[seat])} r={3.5} fill={seat === me ? YOU_COLOR : THEM_COLOR} stroke="#1e1a3f" strokeWidth={1.5} />)
      )}
    </svg>
  );
}

export { SEAT_COLORS };

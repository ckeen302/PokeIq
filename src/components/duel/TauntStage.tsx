"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Eye, EyeOff, Lock } from "lucide-react";
import type { AvatarUnlocks } from "@/lib/avatar";
import type { DuelPlayerView } from "@/lib/duel-types";
import type { PvpEmoteView } from "@/lib/pvp-types";
import { seededTrainer, unlockHint } from "@/lib/trainer/config";
import { TAUNTS, TAUNT_GAP_MS, isTaunt, tauntBlocked, tauntOf, type TauntId } from "@/lib/trainer/taunts";
import type { TrainerSettings } from "@/lib/trainer/client";
import { useAccount } from "@/lib/account";
import { cn } from "@/lib/utils";
import { VersusCharacter } from "./VersusCharacter";

/**
 * Post-game taunts on a duel's result screen: both trainers in 3D, and a bar
 * of dances and emotes. What one trainer plays animates on their trainer on
 * both screens (sent as a duel reaction, so it arrives by the live channel
 * or the next poll). Preset moves only; one every few seconds; either
 * trainer can mute the other's. Trainers without a 3D trainer get one
 * picked from their name.
 */

interface TauntView {
  code: string;
  now: number;
  you: number | null;
  players: DuelPlayerView[];
  emotes?: PvpEmoteView[];
  end?: { winner: number | null };
}

type Playing = { id: TauntId; n: number } | null;

const MUTE_KEY = "pokeiq:mute-taunts";
const GUEST: AvatarUnlocks = { level: 1, tier: null, badges: 0 };

function readMute(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function TauntStage({ view, onTaunt }: { view: TauntView; onTaunt: (id: TauntId) => Promise<string | null> }) {
  const me = view.you ?? 0;
  const them = 1 - me;
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState<[Playing, Playing]>([null, null]);
  const [muted, setMuted] = useState(false);
  const [coolUntil, setCoolUntil] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [, tick] = useState(0);
  const unlocks = useUnlocks();
  const timers = useRef<number[]>([]);
  const count = useRef(0);
  const seen = useRef(-1);

  useEffect(() => setMuted(readMute()), []);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);

  function play(seat: number, id: TauntId) {
    const n = ++count.current;
    setPlaying((p) => (seat === 0 ? [{ id, n }, p[1]] : [p[0], { id, n }]));
    const secs = tauntOf(id)?.secs ?? 3;
    timers.current.push(window.setTimeout(() => setPlaying((p) => (p[seat]?.n === n ? (seat === 0 ? [null, p[1]] : [p[0], null]) : p)), secs * 1000 + 250));
  }

  // The opponent's taunts as they arrive (yours play the moment you press them).
  useEffect(() => {
    const list = (view.emotes ?? []).filter((e) => isTaunt(e.emote));
    if (seen.current < 0) {
      // On arrival: only what's still playing.
      seen.current = Math.max(0, ...list.filter((e) => view.now - e.at >= 2_000).map((e) => e.n));
    }
    const fresh = list.filter((e) => e.n > seen.current);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((e) => e.n));
    const last = fresh.filter((e) => e.seat === them).pop();
    if (last && !muted) play(them, last.emote as TauntId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- new taunts only
  }, [view.emotes]);

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
    play(me, id);
    const err = await onTaunt(id);
    if (err) setNote(err);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (next) setPlaying((p) => (them === 0 ? [null, p[1]] : [p[0], null]));
    try {
      window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      // Not saved: it still applies on this page.
    }
  }

  const fallbacks = useMemo(() => view.players.map((p) => seededTrainer(p?.name ?? "trainer", p?.avatar?.pokemonId ?? 25)), [view.players]);
  const winner = view.end?.winner;
  const sides = [me, them];

  return (
    <section className="mx-auto w-full max-w-4xl px-4" aria-label="Dances and emotes" data-testid="taunt-stage">
      <div className="grid grid-cols-2 gap-3 sm:gap-6">
        {sides.map((seat, i) => {
          const p = view.players[seat];
          const now = playing[seat];
          return (
            <div key={seat} className="relative min-w-0" data-testid={`taunt-trainer-${seat === me ? "you" : "them"}`} data-playing={now?.id}>
              <div aria-hidden className="absolute inset-x-[16%] bottom-[3%] h-[10%] rounded-[50%] bg-black/40 blur-md" />
              <VersusCharacter
                avatar={p?.bot ? null : p?.avatar}
                fallback={fallbacks[seat]}
                facing={i === 0 ? "right" : "left"}
                pose={winner === seat ? "victory" : "idle"}
                taunt={now}
                className="mx-auto h-56 w-full max-w-[19rem] sm:h-72 lg:h-80"
              />
              <p className="mt-1 truncate text-center font-display text-xs font-bold uppercase tracking-wide text-white/80 sm:text-sm">
                {seat === me ? "You" : p?.name}
              </p>
              {now && (
                <span
                  className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 font-display text-[11px] font-bold uppercase text-[#1e1a3f] shadow-lg sm:text-xs"
                  role="status"
                  data-testid={`taunt-label-${seat === me ? "you" : "them"}`}
                >
                  {tauntOf(now.id)?.name}
                  {reduced ? " (still)" : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {view.you !== null && (
        <div className="mt-3 space-y-2 rounded-xl border border-white/15 bg-[#1e1a3f]/80 p-2.5 backdrop-blur sm:p-3" data-testid="taunt-bar">
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
                      aria-label={locked ? `${t.name} (locked: ${unlockHint(t).toLowerCase()})` : `Play ${t.name}`}
                      className={cn(
                        "flex h-8 items-center gap-1 rounded-full border px-3 font-display text-[11px] font-bold uppercase tracking-wide transition-[background-color,transform,opacity] sm:text-xs",
                        locked ? "cursor-not-allowed border-white/10 text-white/40" : "border-white/25 text-white hover:scale-105 hover:bg-white/10 disabled:opacity-50 disabled:hover:scale-100",
                      )}
                      data-testid={`taunt-${t.id}`}
                      data-locked={locked || undefined}
                    >
                      {t.name}
                      {locked && <Lock className="h-3 w-3" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
            <p className="text-[11px] text-white/60" role="status">
              {note ?? (unlocks === GUEST ? "Sign in and win ranked games to earn more moves." : "Earn more with badges, ranked wins and streaks.")}
            </p>
            <button
              type="button"
              onClick={toggleMute}
              aria-pressed={muted}
              className="flex h-8 items-center gap-1.5 rounded-full border border-white/20 px-3 text-xs text-white/80 hover:bg-white/10 hover:text-white"
              data-testid="taunt-mute"
            >
              {muted ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
              {muted ? `${view.players[them]?.name ?? "Opponent"} muted` : "Mute opponent"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The signed-in trainer's unlocks (guests: the free moves). */
function useUnlocks(): AvatarUnlocks {
  const { user } = useAccount();
  const [u, setU] = useState<AvatarUnlocks>(GUEST);
  useEffect(() => {
    if (!user) return;
    let live = true;
    fetch("/api/avatar/trainer", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<TrainerSettings>) : null))
      .then((s) => {
        if (live && s) setU(s.unlocks);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user]);
  return u;
}

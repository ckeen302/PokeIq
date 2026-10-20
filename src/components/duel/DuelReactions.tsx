"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import { DUEL_EMOTES, EMOTE_GAP_MS, EMOTE_SHOW_MS, EMOTE_TEXT, type DuelEmote, type PvpEmoteView } from "@/lib/pvp-types";
import type { DuelPlayerView } from "@/lib/duel-types";
import type { ChatLine } from "@/lib/chat";
import { setDuelSfx, sfx, useDuelSfx } from "@/lib/duel-sfx";
import { ChatBox } from "@/components/chat/ChatBox";
import { cn } from "@/lib/utils";

/**
 * What duellists can say to each other: preset reactions during play (and
 * after), and chat in the lobby and on the results screen. Every duel's
 * screens share these.
 */

interface ReactionsView {
  now: number;
  you: number | null;
  players: DuelPlayerView[];
  emotes?: PvpEmoteView[];
}

/** The duel's chat box: open in the lobby and on the results screen (until the chat moves on to a rematch). */
export function DuelChat({
  view,
  game,
  onSend,
}: {
  view: { code: string; you: number | null; players: DuelPlayerView[]; chat?: ChatLine[]; rematch?: string };
  game: string;
  onSend: (text: string) => Promise<string | null>;
}) {
  return (
    <ChatBox
      lines={view.chat}
      you={view.you}
      players={view.players}
      code={view.code}
      game={game}
      onSend={onSend}
      closed={view.rematch ? "A rematch is open: press Rematch to keep chatting there." : undefined}
      className="mx-auto w-full max-w-3xl"
    />
  );
}

/** The reactions bar and the sound switch. */
export function DuelTools({ onEmote }: { onEmote: (e: DuelEmote) => Promise<string | null> }) {
  const on = useDuelSfx();
  const [coolUntil, setCoolUntil] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    if (!coolUntil) return;
    const id = window.setTimeout(() => force((n) => n + 1), Math.max(0, coolUntil - Date.now()) + 20);
    return () => window.clearTimeout(id);
  }, [coolUntil]);
  const cooling = coolUntil > Date.now();
  return (
    <div className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-2">
      <span className="hud-label">React</span>
      {DUEL_EMOTES.map((e) => (
        <button
          key={e}
          type="button"
          disabled={cooling}
          onClick={async () => {
            setCoolUntil(Date.now() + EMOTE_GAP_MS);
            const err = await onEmote(e);
            setNote(err);
          }}
          className="h-9 min-w-9 rounded-full border border-foreground/15 bg-card px-2.5 text-base font-bold transition-transform hover:scale-110 hover:border-primary/60 disabled:opacity-50 disabled:hover:scale-100"
          aria-label={`Send ${e === "gg" ? "GG" : EMOTE_TEXT[e]}`}
        >
          {e === "gg" ? <span className="font-display text-xs">GG</span> : EMOTE_TEXT[e]}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setDuelSfx(!on)}
        aria-pressed={on}
        className="ml-2 flex h-9 items-center gap-1 rounded-full border border-foreground/15 bg-card px-3 text-xs text-muted-foreground hover:text-foreground"
        title={on ? "Sound effects on" : "Sound effects off"}
      >
        {on ? <Volume2 className="h-3.5 w-3.5" aria-hidden /> : <VolumeX className="h-3.5 w-3.5" aria-hidden />} Sound {on ? "on" : "off"}
      </button>
      {note && (
        <p className="w-full text-center text-xs text-muted-foreground" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/** Reactions as they arrive: a bubble on the sender's side of the screen. */
export function EmoteFeed({ view }: { view: ReactionsView }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<{ n: number; seat: number; emote: DuelEmote }[]>([]);
  const seen = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const fresh = (view.emotes ?? []).filter((e) => e.n > seen.current && view.now - e.at < EMOTE_SHOW_MS);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((e) => e.n));
    if (fresh.some((e) => e.seat !== view.you)) sfx("ping");
    setShown((s) => [...s, ...fresh.map(({ n, seat, emote }) => ({ n, seat, emote }))].slice(-6));
    const ns = new Set(fresh.map((e) => e.n));
    // Each bubble's own timer: later polls don't cut it short.
    timers.current.push(window.setTimeout(() => setShown((s) => s.filter((x) => !ns.has(x.n))), 3_000));
  }, [view.emotes, view.now, view.you]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 mx-auto flex max-w-4xl justify-between px-4" aria-live="polite">
      {[0, 1].map((seat) => (
        <div key={seat} className={cn("flex flex-col gap-2", seat === 1 && "items-end")}>
          <AnimatePresence>
            {shown
              .filter((e) => e.seat === seat)
              .map((e) => (
                <motion.span
                  key={e.n}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.6 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: reduced ? 0 : -10 }}
                  className="flex items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-2xl shadow-lg backdrop-blur"
                >
                  <span className="max-w-[8rem] truncate font-display text-[11px] font-bold uppercase text-muted-foreground">
                    {seat === view.you ? "You" : view.players[seat]?.name}
                  </span>
                  {e.emote === "gg" ? <span className="font-display text-lg font-bold">GG</span> : EMOTE_TEXT[e.emote]}
                </motion.span>
              ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

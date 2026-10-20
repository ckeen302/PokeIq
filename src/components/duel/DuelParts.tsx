"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Link2, Loader2, LogOut, Swords, WifiOff } from "lucide-react";
import type { DuelPlayerView } from "@/lib/duel-types";
import { useProgress } from "@/lib/progress";
import { shareOrCopy } from "@/lib/share";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { cn } from "@/lib/utils";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";

/** Pieces every duel screen shares: seats, the lobby, leaving, notices. */

/** Each seat's colour, for names, pins and boards. */
export const SEAT_COLORS = ["#e2306f", "#38bdf8"];

export const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
export const clock = (ms: number) => {
  const s = seconds(ms);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function SeatDot({ seat }: { seat: number }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEAT_COLORS[seat] }} aria-hidden />;
}

/** When each matched duel's "Matched!" first showed, so it shows once (not again on every new screen). */
const matchedShown = new Map<string, number>();
const MATCHED_SHOW_MS = 8_000;

/**
 * "Matched! You vs Blue" for the first few seconds of a duel matchmaking
 * opened (its link carries ?matched). The trainer who was waiting may only
 * arrive as round 1 starts, so it's a banner over whatever screen is up.
 */
export function MatchedNote({ view }: { view: { you: number | null; players: DuelPlayerView[] } }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("matched")) return;
    const key = window.location.pathname;
    const first = matchedShown.get(key) ?? Date.now();
    matchedShown.set(key, first);
    const left = first + MATCHED_SHOW_MS - Date.now();
    if (left <= 0) return;
    setShown(true);
    const id = window.setTimeout(() => setShown(false), left);
    return () => window.clearTimeout(id);
  }, []);
  const them = view.you === null ? undefined : view.players[1 - view.you]?.name;
  return (
    <AnimatePresence>
      {shown && them && (
        <motion.p
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ opacity: 0 }}
          role="status"
          className="mb-3 text-center font-display text-2xl font-bold uppercase text-success"
        >
          Matched! You vs {them}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** A server error, or the connection dropping. */
export function DuelNotice({ error, offline }: { error: string | null; offline: boolean }) {
  if (!error && !offline) return null;
  return (
    <p role="alert" className="mx-auto mb-3 flex max-w-xl items-center justify-center gap-1.5 text-center text-sm text-destructive">
      {!error && <WifiOff className="h-4 w-4" aria-hidden />}
      {error ?? "Connection lost. Reconnecting…"}
    </p>
  );
}

export function DuelLoading() {
  return (
    <div className="flex justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-screen" aria-label="Loading the duel" />
    </div>
  );
}

export function DuelGone({ message, href, label }: { message: string; href: string; label: string }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-4 p-6 text-center">
        <p className="font-display text-xl font-bold uppercase">Duel not found</p>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href={href} className={buttonVariants()}>
          {label}
        </Link>
      </CardContent>
    </Card>
  );
}

/** Leave mid-duel, after a second press: it forfeits. */
export function LeaveButton({ busy, onLeave }: { busy: boolean; onLeave: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="flex items-center justify-center gap-2 pt-1">
      {sure ? (
        <>
          <span className="text-sm text-muted-foreground">Leaving forfeits the duel.</span>
          <Button size="sm" variant="destructive" disabled={busy} onClick={onLeave}>
            Forfeit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSure(false)}>
            Stay
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setSure(true)}>
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Leave duel
        </Button>
      )}
    </div>
  );
}

export interface DuelLobbyProps {
  view: { code: string; you: number | null; players: DuelPlayerView[] };
  /** The share link, e.g. /pokedle/duel/<code>. */
  path: string;
  /** Above the title, e.g. "Duel · Kanto". */
  tag: string;
  title: React.ReactNode;
  /** What a visitor with a free seat reads. */
  invite: (host: string) => string;
  /** What a seated trainer reads. */
  about: string;
  shareText: string;
  rules: { label: string; text: React.ReactNode }[];
  /** The game's settings (the creator may change them until the duel starts). */
  settings?: React.ReactNode;
  /** "Start your own" when the duel is full. */
  home: string;
  busy: boolean;
  onJoin: (name: string) => void;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
  /** What the game calls itself in the lobby's copy (default "duel"). */
  noun?: string;
  /** The lobby's chat box, under the seats. */
  chat?: React.ReactNode;
}

/** The lobby: both seats, the share link, Ready, and the join form for the friend. */
export function DuelLobby({ view, path, tag, title, invite, about, shareText, rules, settings, home, busy, onJoin, onReady, onLeave, noun = "duel", chat }: DuelLobbyProps) {
  const progress = useProgress();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [shared, setShared] = useState<"done" | "failed" | null>(null);
  const me = view.you;
  const host = view.players[0]?.name ?? "A trainer";
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}${path}`;
  const ready = me !== null && view.players[me]?.ready;

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  async function share() {
    const outcome = await shareOrCopy(shareText, url);
    if (outcome === "failed") setShared("failed");
    else if (outcome !== "cancelled") setShared("done");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3 text-center">
        <p className="hud-label text-screen">{tag}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">{title}</h1>
        <p className="mx-auto max-w-xl text-muted-foreground">{me === null && view.players.length < 2 ? invite(host) : about}</p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <ol className="grid gap-3 sm:grid-cols-2" aria-label="Trainers">
            {[0, 1].map((seat) => {
              const player = view.players[seat];
              return (
                <li key={seat} className="flex items-center gap-3 rounded-md border bg-shade/20 px-4 py-3">
                  <SeatDot seat={seat} />
                  {player ? (
                    <>
                      <span className="min-w-0 flex-1 truncate font-display text-lg font-bold uppercase">
                        {player.name}
                        {me === seat && <span className="hud-label ml-2">You</span>}
                      </span>
                      <span className={cn("hud-label", player.ready ? "text-success" : player.quiet ? "text-warning" : "")}>
                        {player.ready ? "Ready" : player.quiet ? "Away" : "Not ready"}
                      </span>
                    </>
                  ) : (
                    <span className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Waiting for a challenger…
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {settings}

          {me !== null ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={url}
                  aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} link`}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-shade/20 px-3 font-mono text-xs"
                />
                <Button variant="outline" onClick={() => void share()}>
                  <Link2 className="h-4 w-4" aria-hidden /> {shared === "done" ? "Copied!" : "Copy link"}
                </Button>
              </div>
              {shared === "failed" && <CopyFallback text={url} />}
              <Button size="lg" className="w-full" variant={ready ? "secondary" : "success"} disabled={busy} onClick={() => onReady(!ready)}>
                {ready ? (view.players.length < 2 ? "Ready. Waiting for a challenger…" : "Cancel ready") : "Ready"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                The {noun} starts as soon as both of you are ready.{" "}
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onLeave}>
                  Leave
                </button>
              </p>
            </div>
          ) : view.players.length < 2 ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (isCleanName(name)) onJoin(name);
                else setNameError(NAME_REJECTED);
              }}
            >
              <label htmlFor="duel-join-name" className="hud-label">
                Your trainer name
              </label>
              <div className="flex gap-2">
                <input
                  id="duel-join-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError(null);
                  }}
                  maxLength={24}
                  required
                  placeholder="Trainer name"
                  className="h-12 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" size="lg" disabled={busy || !name.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />}
                  Join {noun}
                </Button>
              </div>
              {nameError && (
                <p role="alert" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
            </form>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              This {noun} is full.{" "}
              <Link href={home} className="underline underline-offset-2">
                Start your own
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {chat}

      <Card>
        <CardContent className={cn("grid gap-4 p-6 text-sm text-muted-foreground", rules.length === 3 ? "sm:grid-cols-3" : rules.length > 3 && "sm:grid-cols-2")}>
          {rules.map((rule) => (
            <p key={rule.label}>
              <span className="hud-label mb-1.5 block text-screen">{rule.label}</span>
              {rule.text}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Someone else's duel: who's playing and how it's going. */
export function DuelVisitor({ tag, players, status, home, label }: { tag: string; players: DuelPlayerView[]; status: string; home: string; label: string }) {
  const [a, b] = players.map((p) => p.name);
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-4 p-6 text-center">
        <p className="hud-label text-screen">{tag}</p>
        <p className="font-display text-2xl font-bold uppercase">
          {a ?? "?"} vs {b ?? "?"}
        </p>
        <p className="text-sm text-muted-foreground">{status}</p>
        <Link href={home} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
          <Swords className="h-4 w-4" aria-hidden /> {label}
        </Link>
      </CardContent>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { Bot, Link2, Loader2, Swords, Users } from "lucide-react";
import { CPU_LEVEL_INFO, CPU_LEVELS, type BattleView, type CpuLevel, type GameType } from "@/lib/battle/play";
import { useProgress } from "@/lib/progress";
import { shareOrCopy } from "@/lib/share";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { SeatDot } from "@/components/duel/DuelParts";
import { Avatar } from "@/components/avatar/Avatar";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { cn } from "@/lib/utils";

/**
 * A four-player battle's lobby (Free-For-All and Multi Battles): four
 * seats, filled by trainers who follow the invite link; the host can hand
 * every empty seat to the computer. The battle starts once every seat is
 * taken and every trainer is ready. In a Multi Battle seats 1 and 3 battle
 * together against seats 2 and 4.
 */
export interface GroupLobbyProps {
  view: BattleView;
  gameType: GameType;
  path: string;
  formatName: string;
  /** The format's rules, as the two-trainer lobby lists them. */
  rules: { label: string; text: React.ReactNode }[];
  /** Joining a bring-your-own-team format: the team picker. */
  settings?: React.ReactNode;
  busy: boolean;
  chat?: React.ReactNode;
  onJoin: (name: string) => void;
  onReady: (ready: boolean) => void;
  onFill: (level: CpuLevel) => void;
  onLeave: () => void;
}

export function GroupLobby({ view, gameType, path, formatName, rules, settings, busy, chat, onJoin, onReady, onFill, onLeave }: GroupLobbyProps) {
  const progress = useProgress();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [shared, setShared] = useState<"done" | "failed" | null>(null);
  const [level, setLevel] = useState<CpuLevel>("normal");
  const me = view.you;
  const host = view.players[0]?.name ?? "A trainer";
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}${path}`;
  const ready = me !== null && view.players[me]?.ready;
  const empty = 4 - view.players.length;
  const multi = gameType === "multi";

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  async function share() {
    const outcome = await shareOrCopy(`${host} invites you to a ${formatName} battle on PokéIQ!`, url);
    if (outcome === "failed") setShared("failed");
    else if (outcome !== "cancelled") setShared("done");
  }

  const seat = (i: number) => {
    const player = view.players[i];
    return (
      <li key={i} className="flex min-w-0 items-center gap-3 rounded-md border bg-shade/20 px-4 py-3" data-testid="lobby-seat" data-seat={i} data-filled={!!player}>
        <SeatDot seat={i} />
        {player ? (
          <>
            {player.cpu ? <Bot className="h-7 w-7 shrink-0 text-screen" aria-hidden /> : <Avatar avatar={player.avatar} size={28} />}
            <span className="min-w-0 flex-1 truncate font-display text-base font-bold uppercase">
              {player.name}
              {me === i && <span className="hud-label ml-2">You</span>}
            </span>
            <span className={cn("hud-label shrink-0", player.cpu ? "text-screen" : player.ready ? "text-success" : player.quiet ? "text-warning" : "")}>
              {player.cpu ? "Computer" : player.ready ? "Ready" : player.quiet ? "Away" : "Not ready"}
            </span>
          </>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> <span className="truncate">Waiting for a trainer…</span>
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="group-lobby">
      <div className="space-y-3 text-center">
        <p className="hud-label text-screen">Live battle · {formatName}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">
          {multi ? (
            <>
              Multi <span className="text-primary">battle</span>
            </>
          ) : (
            <>
              Free-for-<span className="text-primary">all</span>
            </>
          )}
        </h1>
        <p className="mx-auto max-w-xl text-muted-foreground">
          {multi
            ? "Four trainers, two teams: seats 1 and 3 against seats 2 and 4, one Pokémon out each."
            : "Four trainers, each on their own, one Pokémon out each. The last trainer standing wins."}{" "}
          {me === null && empty > 0 ? `${host} saved you a seat.` : "Send the link to up to three friends, or let the computer take the empty seats."}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          {multi ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((t) => (
                <div key={t} className="space-y-2">
                  <p className="hud-label flex items-center gap-1.5 text-screen">
                    <Users className="h-3.5 w-3.5" aria-hidden /> Team {t + 1}
                  </p>
                  <ol className="grid gap-2" aria-label={`Team ${t + 1}`}>
                    {[t, t + 2].map(seat)}
                  </ol>
                </div>
              ))}
            </div>
          ) : (
            <ol className="grid gap-3 sm:grid-cols-2" aria-label="Trainers">
              {[0, 1, 2, 3].map(seat)}
            </ol>
          )}

          {settings}

          {me !== null ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={url}
                  aria-label="Battle link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-shade/20 px-3 font-mono text-xs"
                />
                <Button variant="outline" onClick={() => void share()}>
                  <Link2 className="h-4 w-4" aria-hidden /> {shared === "done" ? "Copied!" : "Copy link"}
                </Button>
              </div>
              {shared === "failed" && <CopyFallback text={url} />}
              {me === 0 && empty > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2.5" data-testid="lobby-fill">
                  <Bot className="h-4 w-4 shrink-0 text-screen" aria-hidden />
                  <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {empty === 1 ? "One seat is empty." : `${empty} seats are empty.`} The computer can take {empty === 1 ? "it" : "them"}:
                  </span>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as CpuLevel)}
                    aria-label="Computer level"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    data-testid="lobby-fill-level"
                  >
                    {CPU_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {CPU_LEVEL_INFO[l].name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onFill(level)} data-testid="lobby-fill-button">
                    <Bot className="h-4 w-4" aria-hidden /> Fill with the computer
                  </Button>
                </div>
              )}
              <Button size="lg" className="w-full" variant={ready ? "secondary" : "success"} disabled={busy} onClick={() => onReady(!ready)} data-testid="lobby-ready">
                {ready ? (empty > 0 ? `Ready. Waiting for ${empty === 1 ? "one more trainer" : `${empty} more trainers`}…` : "Cancel ready") : "Ready"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                The battle starts once every seat is taken and every trainer is ready.{" "}
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onLeave}>
                  Leave
                </button>
              </p>
            </div>
          ) : empty > 0 ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (isCleanName(name)) onJoin(name);
                else setNameError(NAME_REJECTED);
              }}
            >
              <label htmlFor="group-join-name" className="hud-label">
                Your trainer name
              </label>
              <div className="flex gap-2">
                <input
                  id="group-join-name"
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
                  Join battle
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
              This battle is full.{" "}
              <Link href="/battle/play?vs=friend" className="underline underline-offset-2">
                Start your own
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {chat}

      <Card>
        <CardContent className="grid gap-4 p-6 text-sm text-muted-foreground sm:grid-cols-2">
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

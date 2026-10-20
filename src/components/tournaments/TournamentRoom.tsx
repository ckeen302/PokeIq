"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Clock, Crown, Eye, Loader2, LogIn, LogOut, Play, Swords, Trophy } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { openTournamentMatch } from "@/lib/friends-client";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { STYLE_NAME, type BracketNodeView, type TournamentMatchView, type TournamentView } from "@/lib/tournaments";
import { cn } from "@/lib/utils";
import { countdown } from "./TournamentLobby";

/** One tournament: sign-ups, the live bracket or table, your match, and the winner. Polls while it's going on. */
export function TournamentRoom({ id }: { id: string }) {
  const account = useAccount();
  const router = useRouter();
  const [view, setView] = useState<TournamentView | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState("");
  const live = !view || view.status === "signup" || view.status === "running";

  async function load() {
    try {
      const res = await fetch(`/api/tournaments/${id}`, { cache: "no-store" });
      const body = await res.json();
      if (res.ok) setView(body);
      else if (res.status === 404 || body.available === false) setMissing(body.error ?? "That tournament doesn't exist.");
    } catch {
      // the next poll
    }
  }
  useVisiblePoll(load, live ? 5_000 : null);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "That didn't work.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">{missing}</p>;
  if (!view) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-hidden />;

  const now = view.now;
  const needsTeam = !PLAY_FORMAT_INFO[view.format].random;
  const you = view.you;

  return (
    <div className="space-y-6" data-testid="tournament" data-status={view.status}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hud-label flex items-center gap-1.5">
            {view.official ? <Crown className="h-3.5 w-3.5 text-warning" aria-hidden /> : <Trophy className="h-3.5 w-3.5 text-primary" aria-hidden />}
            {view.formatName} · {STYLE_NAME[view.style]} · Bo{view.bestOf} {view.rated && "· Rated"}
          </p>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight">{view.title}</h1>
        </div>
        <StatusBadge view={view} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {you?.match && (
        <div className="hud flex flex-wrap items-center gap-3 rounded-lg border border-warning/60 bg-card p-4" role="alert" data-testid="your-match">
          <Swords className="h-6 w-6 text-warning" aria-hidden />
          <p className="flex-1">
            <span className="font-display text-lg font-bold uppercase">Your match is ready</span>
            <span className="block text-sm text-muted-foreground">You vs {you.match.against}. Turn up within 3 minutes or it&apos;s a loss.</span>
          </p>
          <Button variant="success" onClick={() => router.push(openTournamentMatch(you.match!))} data-testid="play-match">
            <Play className="h-4 w-4" aria-hidden /> Play now
          </Button>
        </div>
      )}

      {view.status === "finished" && <Winner view={view} />}
      {view.status === "cancelled" && <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">This tournament was cancelled. {view.cancelReason}</p>}

      {view.status === "signup" && (
        <div className="hud space-y-3 rounded-lg border bg-card p-4">
          <p className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-success" aria-hidden /> Sign-ups close in <span className="font-semibold tabular-nums">{countdown(view.signupEndsAt - now)}</span> or when{" "}
            {view.maxPlayers} trainers are in.
          </p>
          {!account.user ? (
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              <LogIn className="h-4 w-4" aria-hidden /> Sign in to join
            </Link>
          ) : you?.joined ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("leave")} data-testid="leave-tournament">
              <LogOut className="h-4 w-4" aria-hidden /> Leave
            </Button>
          ) : (
            <div className="space-y-2">
              {needsTeam && (
                <textarea
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  rows={5}
                  placeholder="Paste your team (Showdown export format)"
                  aria-label="Your team"
                  className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                />
              )}
              <Button size="sm" disabled={busy || view.players.length >= view.maxPlayers || (needsTeam && !team.trim())} onClick={() => void act("join", needsTeam ? { team } : {})} data-testid="join-tournament">
                <LogIn className="h-4 w-4" aria-hidden /> Join
              </Button>
            </div>
          )}
          {you?.host && (
            <div className="flex gap-2 border-t pt-3">
              <Button size="sm" variant="success" disabled={busy || view.players.length < 2} onClick={() => void act("start")} data-testid="start-tournament">
                <Play className="h-4 w-4" aria-hidden /> Start now
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("cancel")}>
                <Ban className="h-4 w-4" aria-hidden /> Cancel tournament
              </Button>
            </div>
          )}
          <PlayerList view={view} />
        </div>
      )}

      {view.status !== "signup" && view.style === "elim" && view.bracket && <Bracket root={view.bracket} matches={view.matches} />}
      {view.status !== "signup" && view.style === "rr" && <Standings view={view} />}
      {view.status !== "signup" && <MatchList view={view} />}
    </div>
  );
}

function StatusBadge({ view }: { view: TournamentView }) {
  const label = { signup: "Sign-ups open", running: "In progress", finished: "Finished", cancelled: "Cancelled" }[view.status];
  return <span className={cn("rounded-full border px-3 py-1 font-display text-xs font-semibold uppercase tracking-wider", view.status === "signup" ? "border-success/60 text-success" : view.status === "running" ? "border-warning/60 text-warning" : "text-muted-foreground")}>{label}</span>;
}

function PlayerList({ view }: { view: TournamentView }) {
  return (
    <div>
      <p className="hud-label mb-2">
        Trainers {view.players.length}/{view.maxPlayers}
      </p>
      {view.players.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody yet. Be the first!</p>
      ) : (
        <ul className="flex flex-wrap gap-2" data-testid="tournament-players">
          {view.players.map((p) => (
            <li key={p.name} className="rounded-md border bg-background px-2 py-1 text-sm">
              <Link href={`/u/${p.name}`} className="hover:underline">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Winner({ view }: { view: TournamentView }) {
  const [first, ...rest] = view.results ?? [];
  return (
    <div className="hud space-y-3 rounded-xl border border-warning/60 bg-card p-6 text-center" data-testid="tournament-winner">
      <Trophy className="mx-auto h-12 w-12 text-warning" aria-hidden />
      <p className="hud-label">Champion</p>
      <p className="font-display text-4xl font-bold uppercase text-warning">{first?.join(" & ") ?? "?"}</p>
      {rest.length > 0 && (
        <ol className="mx-auto max-w-xs space-y-1 text-sm text-muted-foreground">
          {rest.slice(0, 3).map((place, i) => (
            <li key={i}>
              {i + 2}. {place.join(", ")}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The elimination tree, one column per round. */
function Bracket({ root, matches }: { root: BracketNodeView; matches: TournamentMatchView[] }) {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const rounds: BracketNodeView[][] = [];
  const height = (n: BracketNodeView): number => (n.children ? 1 + Math.max(height(n.children[0]), height(n.children[1])) : 0);
  const walk = (n: BracketNodeView) => {
    if (!n.children) return;
    const h = height(n);
    (rounds[h - 1] ??= []).push(n);
    walk(n.children[0]);
    walk(n.children[1]);
  };
  walk(root);
  const last = rounds.length;
  return (
    <section className="space-y-2">
      <h2 className="hud-label">Bracket</h2>
      <div className="flex gap-4 overflow-x-auto pb-2" data-testid="bracket">
        {rounds.map((nodes, r) => (
          <div key={r} className="flex min-w-[12rem] flex-col justify-around gap-3">
            <p className="text-center text-xs text-muted-foreground">{r + 1 === last ? "Final" : r + 2 === last ? "Semifinals" : `Round ${r + 1}`}</p>
            {nodes.map((n) => {
              const m = n.match ? byId.get(n.match) : undefined;
              const side = (c: BracketNodeView, i: 0 | 1) => {
                const name = c.name;
                const won = n.state === "finished" && name !== null && n.name === name;
                return (
                  <div className={cn("flex items-center justify-between gap-2 px-2 py-1", won && "font-semibold text-success")}>
                    <span className={cn("truncate", !name && "italic text-muted-foreground")}>{name ?? "TBD"}</span>
                    {m && <span className="tabular-nums text-xs">{m.wins[i]}</span>}
                  </div>
                );
              };
              return (
                <div key={n.match} className={cn("rounded-md border bg-card text-sm", n.state === "available" && "border-warning/60")} data-testid="bracket-match">
                  {side(n.children![0], 0)}
                  <div className="border-t" />
                  {side(n.children![1], 1)}
                  {m?.code && m.state === "playing" && (
                    <Link href={`/battle/live/${m.code}`} className="flex items-center justify-center gap-1 border-t py-1 text-xs text-primary hover:underline">
                      <Eye className="h-3 w-3" aria-hidden /> Watch
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function Standings({ view }: { view: TournamentView }) {
  const rows = [...view.players].sort((a, b) => b.score - a.score || b.wins - a.wins);
  return (
    <section className="space-y-2">
      <h2 className="hud-label">Standings</h2>
      <table className="w-full max-w-lg rounded-lg border bg-card text-sm" data-testid="standings">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Trainer</th>
            <th className="px-3 py-2 text-right">W</th>
            <th className="px-3 py-2 text-right">L</th>
            <th className="px-3 py-2 text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.name} className="border-t">
              <td className="px-3 py-1.5 tabular-nums">{i + 1}</td>
              <td className={cn("px-3 py-1.5", p.dq && "text-muted-foreground line-through")}>{p.name}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{p.wins}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{p.losses}</td>
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MatchList({ view }: { view: TournamentView }) {
  const shown = [...view.matches].sort((a, b) => (a.state === "done" ? 1 : 0) - (b.state === "done" ? 1 : 0) || b.round - a.round);
  if (!shown.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="hud-label">Matches</h2>
      <ul className="divide-y rounded-lg border bg-card text-sm" data-testid="match-list">
        {shown.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-3 py-2" data-state={m.state}>
            <span className="w-16 text-xs text-muted-foreground">{m.round ? `Round ${m.round}` : ""}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className={cn(m.winner === m.a && "font-semibold text-success")}>{m.a}</span> vs <span className={cn(m.winner === m.b && "font-semibold text-success")}>{m.b}</span>
            </span>
            <span className="tabular-nums">
              {m.wins[0]}–{m.wins[1]}
            </span>
            <span className="w-24 text-right text-xs">
              {m.state === "playing" && m.code ? (
                <Link href={`/battle/live/${m.code}`} className="text-primary hover:underline">
                  Watch live
                </Link>
              ) : m.state === "waiting" ? (
                <span className="text-muted-foreground">Starting…</span>
              ) : m.note === "noshow" ? (
                <span className="text-muted-foreground">No-show</span>
              ) : m.note === "dq" ? (
                <span className="text-muted-foreground">Disqualified</span>
              ) : m.winner === null ? (
                <span className="text-muted-foreground">Draw</span>
              ) : (
                <span className="text-muted-foreground">Done</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

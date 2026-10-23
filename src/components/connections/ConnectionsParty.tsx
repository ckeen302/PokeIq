"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { Check, Copy, Crown, Loader2, PartyPopper, Shuffle, Users, XCircle } from "lucide-react";
import { PARTY_MAX, PARTY_MIN, PARTY_PENALTY_MS, partyHref, type PartySeatResponse, type PartyStanding, type PartyView } from "@/lib/connections/party";
import { CONN_GROUP_SIZE, CONN_GROUPS, CONN_MAX_MISTAKES, guessKey, type ConnTile } from "@/lib/connections/types";
import { useConnPrefs } from "@/lib/connections/local";
import { saveSeat } from "@/lib/duel-seat";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { setTrainerName, useProgress } from "@/lib/progress";
import { play, unlockAudio, vibrate } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelNotice, clock, seconds } from "@/components/duel/DuelParts";
import { GridTile, GroupBar, MistakeDots, WhyPanel, type TileMotion } from "./parts";
import { cn } from "@/lib/utils";

/**
 * PokéConnections party mode: 2 to 8 trainers race one puzzle from a share
 * link. The lobby, the live placings (groups found and mistakes only), the
 * race and the winner screen with the final standings. Every guess is
 * checked by the server; a trainer sees only their own found groups until
 * the race is over.
 */

const HOME = "/connections";
const TOAST_MS = 1600;

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;

// ---------------------------------------------------------------------------
// Starting one
// ---------------------------------------------------------------------------

/** "Start a party" on /connections: opens a party and goes to its lobby, where the share link is. */
export function ConnectionsPartyCard() {
  const router = useRouter();
  const progress = useProgress();
  const id = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  async function start() {
    if (!isCleanName(name)) return setError(NAME_REJECTED);
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connections/party", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      const data = (await res.json().catch(() => ({}))) as Partial<PartySeatResponse> & { error?: string };
      if (!res.ok || !data.code || !data.token) throw new Error(data.error ?? "Couldn't open a party.");
      saveSeat(data.code, data.token);
      if (!progress?.name) setTrainerName(name.trim());
      router.push(partyHref(data.code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open a party.");
      setBusy(false);
    }
  }

  return (
    <Card data-testid="conn-party-card">
      <CardContent className="grid gap-4 p-6 md:grid-cols-[1fr_15rem]">
        <div className="space-y-2">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            <Users className="h-3.5 w-3.5" aria-hidden /> Party · PokéConnections
          </p>
          <h2 className="font-display text-2xl font-bold uppercase">Race up to {PARTY_MAX} friends</h2>
          <p className="text-sm text-muted-foreground">
            Everyone gets the same sixteen Pokémon from a share link. You all see each other&apos;s placings as you go (groups found and mistakes, never which Pokémon), and the best time wins.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-2">
          <label htmlFor={id} className="hud-label">
            Your trainer name
          </label>
          <input
            id={id}
            value={name}
            maxLength={24}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Trainer name"
            className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="lg" disabled={busy || !name.trim()} onClick={() => void start()} data-testid="conn-party-start">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PartyPopper className="h-4 w-4" aria-hidden />} Start a party
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The party
// ---------------------------------------------------------------------------

export function ConnectionsParty({ code }: { code: string }) {
  const router = useRouter();
  const prefs = useConnPrefs();
  const progress = useProgress();
  const symbols = prefs?.symbols ?? true;
  const { view, now, gone, offline, error, setError, busy, act, join } = useDuel<PartyView>(`/api/connections/party/${code}`, code);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [tileMotion, setTileMotion] = useState<{ kind: Exclude<TileMotion, null>; ids: number[] } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const heard = useRef(-1);
  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const me = view?.you ?? null;
  const mine = view?.mine;
  const tilesKey = view?.tiles?.map((t) => t.id).join(",") ?? "";
  useEffect(() => {
    setOrder(tilesKey ? tilesKey.split(",").map(Number) : []);
    setSelected([]);
  }, [tilesKey]);

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Each answer from the server: a group (bounce, then a bar), one away or a miss (shake).
  useEffect(() => {
    if (!view || me === null || !mine) return;
    const results = mine.results;
    if (heard.current >= 0 && results.length > heard.current) {
      const kind = results[results.length - 1];
      const last = mine.guesses[mine.guesses.length - 1];
      if (kind === "correct") {
        play("correct");
        setTileMotion({ kind: "jump", ids: last });
        setSelected([]);
        window.setTimeout(() => setTileMotion(null), 650);
      } else {
        play("wrong");
        vibrate(60);
        setTileMotion({ kind: "shake", ids: last });
        if (kind === "one-away") showToast("One away…");
        window.setTimeout(() => setTileMotion(null), 450);
      }
    }
    heard.current = results.length;
  }, [view, me, mine, showToast]);

  const found = useMemo(() => new Set((mine?.found ?? []).flatMap((g) => g.members.map((m) => m.id))), [mine]);
  const tilesById = useMemo(() => new Map((view?.tiles ?? []).map((t) => [t.id, t])), [view?.tiles]);
  const remaining = order.filter((id) => !found.has(id)).map((id) => tilesById.get(id)).filter((t): t is ConnTile => Boolean(t));
  const mineRow = view && me !== null ? view.standings.find((s) => s.seat === me) : undefined;
  const racing = !!view && view.status === "playing" && !!view.round && now >= view.round.startsAt && !!view.tiles;
  const canGuess = racing && !!mineRow && !mineRow.solved && !mineRow.out;

  function toggle(id: number) {
    if (!canGuess || busy) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < CONN_GROUP_SIZE ? [...s, id] : s));
  }
  function shuffle() {
    setOrder((o) => {
      const rest = o.filter((id) => !found.has(id));
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      return [...o.filter((id) => found.has(id)), ...rest];
    });
  }
  async function submit() {
    if (!canGuess || busy || selected.length !== CONN_GROUP_SIZE) return;
    unlockAudio();
    if (mine?.guesses.some((g) => guessKey(g) === guessKey(selected))) return showToast("Already guessed!");
    await act({ action: "group", tiles: selected });
  }
  async function leave() {
    if (await act({ action: "leave" })) router.push(HOME);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${partyHref(code)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy: copy the address from your browser instead.");
    }
  }

  if (gone) return <DuelGone message={gone} href={HOME} label="Back to PokéConnections" />;
  if (!view) return <DuelLoading />;
  const notice = <DuelNotice error={error} offline={offline} />;

  // ---- lobby ------------------------------------------------------------------------
  if (view.status === "lobby") {
    const isHost = me === 0;
    const others = view.players.filter((p) => !p.host);
    const waiting = others.filter((p) => !p.ready);
    return (
      <div className="mx-auto max-w-2xl space-y-4" data-testid="conn-party-lobby">
        {notice}
        <div className="space-y-2 text-center">
          <p className="hud-label text-screen">PokéConnections · Party</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight">
            Party <span className="text-primary">Lobby</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {view.players.length} of {view.max} here. Share the link: the host starts the race once everyone has readied up.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-shade/20 px-3 py-2 text-sm" data-testid="conn-party-link">
                {typeof window === "undefined" ? partyHref(code) : `${window.location.origin}${partyHref(code)}`}
              </code>
              <Button variant="outline" onClick={() => void copyLink()}>
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <ul className="divide-y rounded-md border" aria-label="Players">
              {view.players.map((p, seat) => (
                <li key={seat} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="conn-party-player">
                  <span className="font-semibold">{p.name}</span>
                  {seat === me && <span className="hud-label">You</span>}
                  {p.host && (
                    <span className="hud-label flex items-center gap-1 text-warning">
                      <Crown className="h-3 w-3" aria-hidden /> Host
                    </span>
                  )}
                  <span className={cn("ml-auto text-xs font-semibold uppercase", p.ready ? "text-success" : "text-muted-foreground")}>{p.away ? "Away" : p.ready ? "Ready" : "Not ready"}</span>
                </li>
              ))}
            </ul>
            {me === null ? (
              view.players.length >= view.max ? (
                <p className="text-center text-sm text-muted-foreground">This party is full.</p>
              ) : (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!isCleanName(name)) return setError(NAME_REJECTED);
                    void join(name.trim());
                  }}
                >
                  <input
                    aria-label="Your trainer name"
                    value={name}
                    maxLength={24}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Trainer name"
                    className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <Button type="submit" disabled={busy || !name.trim()} data-testid="conn-party-join">
                    Join the party
                  </Button>
                </form>
              )
            ) : isHost ? (
              <div className="space-y-2 text-center">
                <Button size="lg" disabled={busy || view.players.length < PARTY_MIN || waiting.length > 0} onClick={() => void act({ action: "start" })} data-testid="conn-party-begin">
                  Start the race
                </Button>
                <p className="text-xs text-muted-foreground">
                  {view.players.length < PARTY_MIN ? `Waiting for at least ${PARTY_MIN} players.` : waiting.length ? `Waiting for ${waiting.map((p) => p.name).join(", ")} to ready up.` : "Everyone is ready."}
                </p>
              </div>
            ) : (
              <div className="text-center">
                <Button size="lg" variant={view.players[me].ready ? "outline" : "default"} disabled={busy} onClick={() => void act({ action: "ready", ready: !view.players[me].ready })} data-testid="conn-party-ready">
                  {view.players[me].ready ? "Not ready" : "Ready!"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="space-y-1 text-center text-xs text-muted-foreground">
          <p>
            The same sixteen Pokémon for everyone. Each mistake adds {PARTY_PENALTY_MS / 1000} seconds to your time, and {CONN_MAX_MISTAKES} mistakes put you out.
          </p>
          <p>You see everyone&apos;s groups found and mistakes as you go, never which Pokémon.</p>
        </div>
        {me !== null && (
          <div className="text-center">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void leave()}>
              Leave the party
            </Button>
          </div>
        )}
      </div>
    );
  }

  const placings = <Placings standings={view.standings} you={me} />;

  // ---- watching ---------------------------------------------------------------------
  if (me === null && view.status === "playing") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        <p className="text-center text-sm text-muted-foreground">This party is under way. Here are the placings.</p>
        {placings}
        <div className="text-center">
          <Link href={HOME} className="text-sm underline underline-offset-2">
            Start your own party
          </Link>
        </div>
      </div>
    );
  }

  // ---- the end ----------------------------------------------------------------------
  if (view.status === "finished") {
    const winner = view.end?.winner;
    const myRow = view.standings.find((s) => s.seat === me);
    return (
      <MotionConfig reducedMotion="user">
        <div className="mx-auto max-w-2xl space-y-6" data-testid="conn-party-result">
          {notice}
          <div className="space-y-2 text-center">
            <p className="hud-label text-screen">Party over · PokéConnections</p>
            <div className="flex items-center justify-center gap-3 font-display text-5xl font-bold uppercase">
              <Crown className="h-10 w-10 text-warning" aria-hidden />
              {winner === null || winner === undefined ? "No winner" : `${view.players[winner]?.name} wins!`}
            </div>
            {myRow && <p className="text-muted-foreground">You finished {ordinal(myRow.place)} of {view.standings.length}.</p>}
          </div>
          {placings}
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={HOME} className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-display text-sm font-semibold uppercase text-primary-foreground">
              Start a new party
            </Link>
          </div>
          {view.reveal && <WhyPanel groups={view.reveal} symbols={symbols} />}
        </div>
      </MotionConfig>
    );
  }

  // ---- lead-in ----------------------------------------------------------------------
  if (!racing) {
    const startsAt = view.round?.startsAt ?? now;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <p className="hud-label text-screen">Get ready</p>
            <motion.p key={seconds(startsAt - now)} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-7xl font-bold tabular-nums">
              {Math.max(1, seconds(startsAt - now))}
            </motion.p>
            <p className="text-sm text-muted-foreground">{view.players.length} racers, sixteen Pokémon, four groups.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- the race ---------------------------------------------------------------------
  const done = mineRow?.solved || mineRow?.out;
  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_16rem]" data-testid="conn-party">
        <div className="space-y-4">
          {notice}
          <p className="text-center font-display text-lg font-bold tabular-nums" aria-label="Race clock">
            {clock(Math.max(0, now - view.round!.startsAt))}
          </p>
          <div className="relative">
            <AnimatePresence>
              {toast && (
                <motion.div
                  key={toast.n}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute inset-x-0 top-[40%] z-20 flex justify-center"
                  role="status"
                  aria-live="assertive"
                >
                  <span className="rounded-md bg-foreground px-5 py-2.5 font-display text-base font-bold uppercase tracking-wider text-background shadow-[0_10px_30px_rgb(0_0_0/0.45)]">{toast.text}</span>
                </motion.div>
              )}
            </AnimatePresence>
            <LayoutGroup>
              <div className="space-y-2 sm:space-y-2.5">
                {(mine?.found ?? []).map((g) => (
                  <GroupBar key={g.level} group={g} symbols={symbols} />
                ))}
                {remaining.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 sm:gap-2.5" data-testid="conn-grid" aria-label="Tiles to group">
                    {remaining.map((t, i) => (
                      <GridTile
                        key={t.id}
                        tile={t}
                        index={i}
                        selected={selected.includes(t.id)}
                        disabled={!canGuess}
                        motionKind={tileMotion?.ids.includes(t.id) ? tileMotion.kind : null}
                        order={tileMotion ? tileMotion.ids.indexOf(t.id) : 0}
                        onToggle={() => toggle(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (selected.length === CONN_GROUP_SIZE) void submit();
                            else toggle(t.id);
                          }
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </LayoutGroup>
          </div>
          {done ? (
            <Card className={cn(mineRow?.solved ? "border-success/50" : "border-destructive/40")}>
              <CardContent className="space-y-1 p-5 text-center">
                <p className="font-display text-2xl font-bold uppercase">{mineRow?.solved ? "All four found!" : "Out of mistakes"}</p>
                <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Waiting for the others…
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <MistakeDots left={CONN_MAX_MISTAKES - (mineRow?.mistakes ?? 0)} max={CONN_MAX_MISTAKES} />
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button variant="outline" onClick={shuffle} className="rounded-full sm:min-w-28">
                  <Shuffle className="h-4 w-4" aria-hidden /> Shuffle
                </Button>
                <Button variant="outline" onClick={() => (setSelected([]), setError(null))} disabled={selected.length === 0} className="rounded-full sm:min-w-28">
                  Deselect all
                </Button>
                <Button onClick={() => void submit()} disabled={busy || selected.length !== CONN_GROUP_SIZE} className="rounded-full sm:min-w-28" data-testid="conn-submit">
                  Submit
                </Button>
              </div>
            </div>
          )}
          <div className="text-center">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void leave()}>
              Leave the race
            </Button>
          </div>
        </div>
        <aside aria-label="Placings">{placings}</aside>
      </div>
    </MotionConfig>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The placings: place, name, groups found and mistakes (a solve's time when done). Never which tiles. */
function Placings({ standings, you }: { standings: PartyStanding[]; you: number | null }) {
  return (
    <Card>
      <CardContent className="p-0">
        <ol className="divide-y" data-testid="conn-party-standings">
          {standings.map((s) => (
            <li key={s.seat} className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", s.seat === you && "bg-screen/[0.08]")} data-testid="conn-party-standing" data-place={s.place}>
              <span className="w-6 font-display text-lg font-bold tabular-nums text-muted-foreground">{s.place}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {s.name}
                {s.seat === you && <span className="hud-label ml-1.5">You</span>}
              </span>
              {s.solved ? (
                <span className="font-display font-bold tabular-nums text-success">{clock(s.score ?? 0)}</span>
              ) : (
                <span className="flex items-center gap-1 tabular-nums text-muted-foreground" aria-label={`${s.found} of ${CONN_GROUPS} groups`}>
                  {s.out && <XCircle className="h-3.5 w-3.5 text-destructive" aria-label="Out" />}
                  {s.found}/{CONN_GROUPS}
                </span>
              )}
              <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                {s.mistakes} miss{s.mistakes === 1 ? "" : "es"}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

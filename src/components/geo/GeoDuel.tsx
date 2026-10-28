"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Crown, Expand, Loader2, MapPin as MapPinIcon, RotateCcw, Swords, Timer, Trophy, WifiOff, X } from "lucide-react";
import {
  DUEL_COUNTDOWN_MS,
  DUEL_HP,
  DUEL_IDLE_ROUNDS,
  DUEL_ROUND_MS,
  duelMultiplier,
  type DuelRoundResult,
  type DuelView,
} from "@/lib/duel-types";
import type { GeoAnswer, GeoRegionInfo } from "@/lib/geo-types";
import { play, unlockAudio } from "@/lib/sound";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HpBar } from "@/components/game/HpBar";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, LeaveButton, MatchedNote, SEAT_COLORS, SeatDot, clock, seconds } from "@/components/duel/DuelParts";
import { DuelChat, DuelTools, EmoteFeed } from "@/components/duel/DuelReactions";
import { GeoMap, type MapPin, type RevealedRound } from "./GeoMap";
import { ReportShot } from "./ReportShot";
import { shotFit } from "./ShotCarousel";
import { FullscreenButton, GameShell, dockClass } from "./GameShell";
import { GEO_ERA_NAMES } from "@/lib/geo-families";
import { cn } from "@/lib/utils";
import { AddFriendAfterGame } from "@/components/community/AddFriend";
import { Avatar } from "@/components/avatar/Avatar";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { rankedExtra } from "@/components/pokedle/Ranked";
import { GEO_RANKED_MATCH } from "@/lib/geo-ranked";
import { GeoDivisionBadge, GeoRankedOutcome, GymLeaderAvatar, GymLeaderTag } from "./GeoRanked";

/**
 * A PokéGuessr duel at /guessr/duel/<code>: the lobby, the rounds, the reveals
 * and the result. The server runs the duel; useDuel polls its state (every
 * second in play) and sends the trainer's actions. Timers count down on the
 * server's clock, corrected for this device's.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

/** As in the single-player game: no "Kanto " before route names, and the region when the map doesn't say it. */
const clean = (s: string) => s.replace(/^(Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea) (?=Route)/, "");
/** The in-game name, without the wiki's disambiguation ("Iron Ruins (Sinnoh)", "Battle Tower (Generation III)", "Victory Road (BW)"). */
const shown = (s: string) => clean(s).replace(/ \((Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea|Generation [IVX]+|BW|B2W2|Jagged Pass)\)$/, "");
function placeName(answer: GeoAnswer, map: GeoRegionInfo): string {
  const name = answer.parent ? `${shown(answer.name)} · ${shown(answer.parent)}` : shown(answer.name);
  return answer.region && answer.region !== map.name ? `${name}, ${answer.region}` : name;
}

function distanceText(squares: number): string {
  if (squares === 0) return "Right on it!";
  return `${squares.toFixed(1)} map square${squares === 1 ? "" : "s"} away`;
}

export interface GeoDuelProps {
  code: string;
  /** Every map: the duel is played on one of them. */
  regions: GeoRegionInfo[];
}

export function GeoDuel({ code, regions }: GeoDuelProps) {
  const router = useRouter();
  const { view, now, gone, offline, error, setError, busy, sawPlay, act, send, join, rematch: takeRematch } = useDuel<DuelView>(`/api/geo/duel/${code}`, code);
  const [pick, setPick] = useState<MapPin | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [summary, setSummary] = useState(false);
  const heard = useRef({ revealed: -1, theirGuess: false, end: false });

  // A new round: a fresh pin.
  const roundIndex = view?.round?.index;
  useEffect(() => {
    setPick(null);
    setZoomed(false);
    setError(null);
  }, [roundIndex, setError]);

  // Each new screen (lobby, a round, a reveal, the result) starts at the top.
  const screen = !view ? "" : view.status === "lobby" ? "lobby" : view.round ? `round ${view.round.index}` : `reveal ${view.revealed.length} ${summary}`;
  useEffect(() => {
    if (screen) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [screen]);

  // Sounds: the opponent locking in, and each reveal (did you win the round?).
  useEffect(() => {
    if (!view || view.you === null) return;
    const h = heard.current;
    const theirGuess = !!view.round?.guessed[1 - view.you];
    if (theirGuess && !h.theirGuess && !view.round?.yours) play("click");
    h.theirGuess = theirGuess;
    if (h.revealed >= 0 && view.revealed.length > h.revealed) play(view.revealed[view.revealed.length - 1].hurt === view.you ? "wrong" : "correct");
    h.revealed = view.revealed.length;
    // A forfeit skips the last reveal, so its result sounds straight away.
    if (view.end?.reason === "left" && !h.end && sawPlay && view.end.winner === view.you) play("fanfare");
    h.end = !!view.end;
  }, [view, sawPlay]);

  async function rematch() {
    const next = await takeRematch();
    if (next) router.push(`/guessr/duel/${next}`);
  }

  async function leave() {
    if (await act({ action: "leave" })) router.push("/guessr");
  }

  const live = view?.round && now >= view.round.startsAt ? view.round : undefined;
  const last = view?.revealed[view.revealed.length - 1];
  const revealing = !!view && view.status === "playing" && !view.round && !!last;

  async function guess() {
    if (!live || !pick || live.yours || busy) return;
    unlockAudio();
    await act({ action: "guess", round: live.index, ...pick });
  }

  async function nextRound() {
    if (!view || view.you === null || !last || view.next?.pressed[view.you] || busy) return;
    unlockAudio();
    await act({ action: "next", round: last.index });
  }

  function showResults() {
    if (view?.end) play(view.end.winner === view.you ? "fanfare" : view.end.winner === null ? "streak" : "wrong");
    setSummary(true);
  }

  // GeoGuessr's shortcuts: Space / Enter to guess, then for the next round. Esc closes the zoomed view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setZoomed(false);
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, a")) return;
      if (live && pick && !live.yours) {
        e.preventDefault();
        void guess();
      } else if (revealing) {
        e.preventDefault();
        void nextRound();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const map = view ? regions.find((r) => r.id === view.region) : undefined;
  const race = view?.mode === "race";
  if (gone || (view && !map)) {
    return <DuelGone message={gone ?? "This duel's map isn't available any more."} href="/guessr" label="Back to PokéGuessr" />;
  }
  if (!view || !map) return <DuelLoading />;

  const notice = (
    <>
      <MatchedNote view={view} />
      <DuelNotice error={error} offline={offline} />
      <EmoteFeed view={view} />
    </>
  );
  const tools = view.you !== null && (
    <DuelTools
      onEmote={(e) => {
        unlockAudio();
        return send({ action: "emote", emote: e });
      }}
    />
  );
  const chat = <DuelChat view={view} game="PokéGuessr duel" onSend={(text) => send({ action: "chat", text })} />;

  if (view.status === "lobby") {
    return (
      <>
        {notice}
        <DuelLobby
          view={view}
          path={`/guessr/duel/${view.code}`}
          tag={`${race ? `Points race · ${view.maxRounds} rounds` : "HP battle"} · ${map.name}${view.era ? ` · ${GEO_ERA_NAMES[view.era]}` : ""}`}
          title={
            <>
              Poké<span className="text-primary">Guessr</span> Duel
            </>
          }
          invite={(host) =>
            race
              ? `${host} challenges you to a ${view.maxRounds}-round points race! The same places for both of you: most points wins.`
              : `${host} challenges you! The same places for both of you, ${fmt(DUEL_HP)} HP each.`
          }
          about={`${race ? `A ${view.maxRounds}-round points race` : "Head to head"} on the ${map.name} map${view.era ? `, ${GEO_ERA_NAMES[view.era]} screenshots only` : ""}. Both of you get the same places; the closer pin wins the round.`}
          shareText={race ? `Race me in PokéGuessr! Same ${view.maxRounds} places, most points wins.` : `Duel me in PokéGuessr! Same places, ${fmt(DUEL_HP)} HP each.`}
          rules={[
            {
              label: "Rounds",
              text: `The same screenshot for both of you. Once one of you guesses, the other has ${DUEL_COUNTDOWN_MS / 1000} seconds (${DUEL_ROUND_MS / 1000} s a round at most).`,
            },
            race
              ? { label: "Scoring", text: `Every round is worth up to ${fmt(5000)} points, no damage and no multipliers. ${view.maxRounds} rounds, and your points add up.` }
              : {
                  label: "Damage",
                  text: `${fmt(DUEL_HP)} HP each. The lower score loses the difference: 1× at first, ×1.5 from round 4, ×2 from round 6, up to ×3.`,
                },
            {
              label: "Winning",
              text: race
                ? `After ${view.maxRounds} rounds, the higher total wins; level totals are a draw. Leave (or go quiet) and you forfeit.`
                : `First to 0 HP loses. After ${view.maxRounds} rounds, more HP wins. Leave (or go quiet) and you forfeit.`,
            },
          ]}
          home="/guessr"
          chat={chat}
          busy={busy}
          onJoin={join}
          onReady={(ready) => void act({ action: "ready", ready })}
          onLeave={() => void leave()}
        />
      </>
    );
  }
  if (view.you === null) {
    const winner = view.end?.winner;
    return (
      <DuelVisitor
        tag={`PokéGuessr duel · ${map.name}`}
        players={view.players}
        status={
          view.status === "finished"
            ? winner === null || winner === undefined
              ? "It ended in a draw."
              : `${view.players[winner]?.name} won.`
            : race
              ? `Under way: round ${view.revealed.length + 1} of ${view.maxRounds}. ${fmt(view.totals?.[0] ?? 0)} points to ${fmt(view.totals?.[1] ?? 0)}.`
              : `Under way: round ${view.revealed.length + 1}. ${fmt(view.hp[0])} HP to ${fmt(view.hp[1])}.`
        }
        home="/guessr"
        label="Start your own duel"
      />
    );
  }
  const me = view.you;
  const them = view.players[1 - me]?.name ?? "your opponent";

  if (view.status === "finished" && (summary || !sawPlay || view.end?.reason === "left" || !last)) {
    return (
      <>
        {notice}
        <DuelSummary view={view} map={map} busy={busy} onRematch={() => void rematch()} />
        <div className="mx-auto mt-4 max-w-3xl space-y-4">
          {view.you !== null && <AddFriendAfterGame kind="guessr" code={view.code} />}
          {tools}
          {chat}
        </div>
      </>
    );
  }

  const leaveButton = <LeaveButton busy={busy} onLeave={() => void leave()} />;

  // ---- lead-in: "Round 2" ----------------------------------------------------------
  if (view.round && !live) {
    const { index, startsAt } = view.round;
    const mult = duelMultiplier(index);
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {notice}
        <DuelHud view={view} center={<div className="hud-label">Get ready</div>} />
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <p className="hud-label text-screen">
              Round {index + 1} of {view.maxRounds}
            </p>
            <motion.p
              key={seconds(startsAt - now)}
              initial={{ scale: 1.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-display text-7xl font-bold tabular-nums"
            >
              {Math.max(1, seconds(startsAt - now))}
            </motion.p>
            <p className={cn("text-sm", mult > 1 ? "font-semibold text-warning" : "text-muted-foreground")}>
              {mult > 1 ? `Damage ×${mult} this round` : `${fmt(DUEL_HP)} HP each. The lower score loses the difference.`}
            </p>
          </CardContent>
        </Card>
        {tools}
        {leaveButton}
      </div>
    );
  }

  // ---- guessing --------------------------------------------------------------------------
  if (live) {
    const left = live.endsAt - now;
    const locked = live.yours ?? null;
    const theyGuessed = live.guessed[1 - me];
    const timeUp = left <= 0;
    return (
      <GameShell>
        {({ fs, toggle }) => (
      <div className={fs ? "relative h-full" : "mx-auto max-w-6xl space-y-3"}>
        <div className={fs ? "absolute left-14 right-14 top-3 z-20 space-y-2" : "contents"}>
        {notice}
        <DuelHud
          view={view}
          center={
            <>
              <div className="hud-label">
                Round {live.index + 1}/{view.maxRounds}
                {live.multiplier > 1 ? ` · ×${live.multiplier}` : ""}
              </div>
              <div className={cn("flex items-center justify-center gap-1 font-pixel text-lg tabular-nums", live.countdown ? "text-destructive" : "text-screen")}>
                <Timer className="h-4 w-4" aria-hidden />
                {clock(left)}
              </div>
            </>
          }
        />
        <AnimatePresence>
          {(theyGuessed || locked) && (
            <motion.p
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="status"
              className={cn(
                "rounded-md border px-4 py-2 text-center font-display text-sm font-semibold uppercase tracking-wider",
                locked ? "border-screen/40 text-screen" : "border-warning/50 bg-warning/[0.08] text-warning"
              )}
            >
              {locked ? `Locked in. Waiting for ${them}…` : `${them} has guessed! ${seconds(left)} s left`}
            </motion.p>
          )}
        </AnimatePresence>
        </div>
        <div className={fs ? "absolute inset-0" : "relative"}>
          <div className={cn("screen relative w-full overflow-hidden", fs ? "h-full rounded-none" : "aspect-[16/9] rounded-lg")}>
            {live.shot && (
              // eslint-disable-next-line @next/next/no-img-element -- server-proxied, CDN-cached screenshot
              <img key={live.shot} src={live.shot} alt="Where is this?"
                data-testid="geo-shot"
                onLoad={(e) => {
                  e.currentTarget.style.imageRendering = shotFit(e.currentTarget).pixelated ? "pixelated" : "auto";
                }}
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
            )}
            <button
              type="button"
              onClick={() => setZoomed(true)}
              className="absolute left-3 top-3 z-[3] flex h-9 w-9 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
              aria-label="View the whole screenshot"
              title="Whole screenshot"
            >
              <Expand className="h-4 w-4" />
            </button>
            <FullscreenButton fs={fs} onClick={toggle} />
          </div>

          <div className={dockClass(fs)}>
            <div className="rounded-md lg:opacity-80 lg:shadow-2xl lg:transition-opacity lg:group-hover:opacity-100">
              <GeoMap
                region={map}
                pick={locked ?? pick}
                onPick={
                  locked || timeUp
                    ? undefined
                    : (p) => {
                        setPick(p);
                        play("click");
                      }
                }
              />
            </div>
            <Button className="w-full" size="lg" disabled={!pick || !!locked || busy || timeUp} onClick={() => void guess()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MapPinIcon className="h-4 w-4" aria-hidden />}
              {locked ? `Waiting for ${them}…` : timeUp ? "Time's up" : pick ? "Guess" : "Place your pin on the map"}
            </Button>
          </div>
        </div>
        <div className={fs ? "absolute bottom-4 left-4 z-20 max-w-[min(24rem,50%)] space-y-2" : "contents"}>
          {tools}
          {leaveButton}
        </div>

        <AnimatePresence>
          {zoomed && live.shot && (
            <motion.div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setZoomed(false)}
              role="dialog"
              aria-label="Screenshot, full screen"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- same cached screenshot, full size */}
              <img src={live.shot} alt="Where is this?" className="max-h-full max-w-full rounded-md object-contain" />
              <button
                type="button"
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
        )}
      </GameShell>
    );
  }

  // ---- reveal --------------------------------------------------------------------------
  if (last) {
    const final = view.status === "finished";
    const pressed = view.next?.pressed[me] ?? false;
    const nextIn = view.next ? seconds(view.next.at - now) : 0;
    return (
      <GameShell>
        {({ fs }) => (
      <div className={cn("mx-auto max-w-4xl space-y-4", fs && "p-4")}>
        {notice}
        <DuelHud
          view={view}
          hit={last}
          center={
            <div className="hud-label">
              Round {last.index + 1}/{view.maxRounds}
              {last.multiplier > 1 ? ` · ×${last.multiplier}` : ""}
            </div>
          }
        />
        <DuelReveal view={view} map={map} result={last}>
          <Button size="lg" className="w-full" disabled={!final && (pressed || busy)} onClick={() => (final ? showResults() : void nextRound())}>
            {final ? "See results ▶" : pressed ? `Waiting for ${them}… (${nextIn})` : `Next round (${nextIn}) ▶`}
          </Button>
        </DuelReveal>
        {tools}
        {!final && leaveButton}
      </div>
        )}
      </GameShell>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Both trainers' names and HP bars, facing each other, with the round in the middle. */
function DuelHud({ view, center, hit }: { view: DuelView; center: React.ReactNode; hit?: DuelRoundResult }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-md border bg-card/90 px-4 py-2 backdrop-blur">
      <Fighter view={view} seat={0} damage={hit?.hurt === 0 ? hit.damage : 0} />
      <div className="text-center">{center}</div>
      <Fighter view={view} seat={1} damage={hit?.hurt === 1 ? hit.damage : 0} right />
    </div>
  );
}

function Fighter({ view, seat, damage, right }: { view: DuelView; seat: number; damage: number; right?: boolean }) {
  const player = view.players[seat];
  const hp = view.hp[seat];
  const race = view.mode === "race";
  return (
    <div className={cn("min-w-0 space-y-1", right && "text-right")}>
      <div className={cn("flex items-center gap-1.5", right && "flex-row-reverse")}>
        <SeatDot seat={seat} />
        {player && (player.bot ? <GymLeaderAvatar name={player.name} size={24} /> : <Avatar avatar={player.avatar} size={24} />)}
        <span className="truncate font-display font-bold uppercase">{player?.name ?? "—"}</span>
        {view.you === seat && <span className="hud-label">You</span>}
        {player?.bot && <GymLeaderTag />}
        {player?.quiet && view.status === "playing" && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Connection lost" />}
      </div>
      {view.ranked && (
        <div className={cn("flex", right && "justify-end")}>
          <GeoDivisionBadge elo={view.ranked.elos[seat]} size="sm" />
        </div>
      )}
      {/* The right-hand bar drains towards its own edge. */}
      {!race && (
        <div className={cn(right && "-scale-x-100")}>
          <HpBar value={hp / DUEL_HP} />
        </div>
      )}
      <div className={cn("flex items-center gap-2 font-pixel text-xs tabular-nums", right && "flex-row-reverse")}>
        <span data-testid={race ? `geo-duel-total-${seat}` : undefined}>{race ? `${fmt(view.totals?.[seat] ?? 0)} pts` : `${fmt(hp)} HP`}</span>
        {damage > 0 && (
          <motion.span key={damage} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-destructive">
            −{fmt(damage)}
          </motion.span>
        )}
      </div>
    </div>
  );
}

/** A revealed round: both scores and the damage (with the button to go on), then the place and both pins on the map. */
function DuelReveal({ view, map, result, children }: { view: DuelView; map: GeoRegionInfo; result: DuelRoundResult; children: React.ReactNode }) {
  const me = view.you;
  const name = (seat: number) => (seat === me ? "You" : (view.players[seat]?.name ?? "They"));
  const revealed: RevealedRound[] = result.guesses.map((g, seat) => ({
    guess: g && { x: g.x, y: g.y },
    answer: result.answer,
    label: view.players[seat]?.name,
    color: SEAT_COLORS[seat],
  }));
  const score = (seat: number) => {
    const g = result.guesses[seat];
    return (
      <div className={cn("rounded-md border bg-shade/20 p-3 text-center", result.hurt !== null && result.hurt !== seat && "border-success/50")}>
        <p className="hud-label flex items-center justify-center gap-1.5">
          <SeatDot seat={seat} /> {view.players[seat]?.name}
        </p>
        <p className="font-display text-3xl font-bold tabular-nums">{g ? fmt(g.score) : "No guess"}</p>
        <p className="text-xs text-muted-foreground">{g ? distanceText(g.squares) : "Out of time: 0 points"}</p>
      </div>
    );
  };
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-[1fr_minmax(0,18rem)_1fr] items-center gap-3">
        {score(0)}
        <div className="space-y-2 text-center">
          <p className="font-display text-lg font-bold uppercase leading-tight">
            {view.mode === "race"
              ? result.guesses[0]?.score === result.guesses[1]?.score
                ? "Even round"
                : `${name((result.guesses[0]?.score ?? 0) > (result.guesses[1]?.score ?? 0) ? 0 : 1)} won the round`
              : result.hurt === null
              ? "Even round: no damage"
              : `${name(result.hurt)} ${result.hurt === me ? "take" : "takes"} ${fmt(result.damage)} damage`}
            {result.hurt !== null && result.multiplier > 1 && <span className="text-warning"> (×{result.multiplier})</span>}
          </p>
          {children}
        </div>
        {score(1)}
      </motion.div>
      <GeoMap region={map} revealed={revealed} />
      <p className="text-center text-muted-foreground">
        It was <span className="font-semibold text-foreground">{placeName(result.answer, map)}</span>
        <span className="text-sm"> · Pokémon {result.answer.game}</span>
      </p>
      {me !== null && (
        <div className="text-center">
          <ReportShot key={result.shot} shot={result.shot} mode="duel" />
        </div>
      )}
    </>
  );
}

function DuelSummary({ view, map, busy, onRematch }: { view: DuelView; map: GeoRegionInfo; busy: boolean; onRematch: () => void }) {
  const me = view.you!;
  const end = view.end!;
  const them = view.players[1 - me]?.name ?? "Your opponent";
  const ranked = !!view.ranked;
  const finder = useMatchmaking(ranked ? GEO_RANKED_MATCH : undefined);
  const myName = view.players[me]?.name ?? "";
  const won = end.winner === me;
  const draw = end.winner === null;
  const rounds = view.revealed.length;
  const reason = {
    hp: won ? `${them} ran out of HP.` : "You ran out of HP.",
    rounds:
      view.mode === "race"
        ? `After ${rounds} rounds, ${draw ? "you're level on points" : won ? "you scored more points" : `${them} scored more points`}.`
        : `After ${rounds} rounds, ${draw ? "you're level on HP" : won ? "you have more HP" : `${them} has more HP`}.`,
    left: won ? `${them} left the duel.` : "You left the duel.",
    idle: draw
      ? `Neither of you guessed for ${DUEL_IDLE_ROUNDS} rounds.`
      : won
        ? `${them} stopped guessing.`
        : `You didn't guess for ${DUEL_IDLE_ROUNDS} rounds.`,
  }[end.reason];
  const allRounds: RevealedRound[] = view.revealed.flatMap((r) =>
    r.guesses.map((g, seat) => ({ guess: g && { x: g.x, y: g.y }, answer: r.answer, label: String(r.index + 1), color: SEAT_COLORS[seat] }))
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">Duel over · {map.name}</p>
        <div
          className={cn(
            "flex items-center justify-center gap-3 font-display text-6xl font-bold uppercase",
            won ? "text-success" : draw ? "text-screen" : "text-destructive"
          )}
        >
          {won && <Crown className="h-12 w-12" aria-hidden />}
          {draw ? "Draw" : won ? "Victory!" : "Defeat"}
        </div>
        <p className="text-muted-foreground">{reason}</p>
      </div>

      <DuelHud view={view} center={<div className="hud-label">Final</div>} />

      {ranked && <GeoRankedOutcome view={view} />}

      {allRounds.length > 0 && <GeoMap region={map} revealed={allRounds} />}

      <Card>
        <CardContent className="space-y-5 p-5">
          {finder.error && (
            <p role="alert" className="text-sm text-destructive">
              {finder.error}
            </p>
          )}
          {rounds > 0 && (
            <div className={cn("grid items-center gap-x-4 gap-y-1.5 text-sm", view.mode === "race" ? "grid-cols-[auto_1fr_auto_auto]" : "grid-cols-[auto_1fr_auto_auto_auto]")}>
              <span />
              <span className="hud-label">Place</span>
              {[0, 1].map((seat) => (
                <span key={seat} className="hud-label flex items-center justify-end gap-1.5">
                  <SeatDot seat={seat} />
                  {view.players[seat]?.name}
                </span>
              ))}
              {view.mode !== "race" && <span className="hud-label text-right">Damage</span>}
              {view.revealed.map((r) => (
                <div key={r.index} className="contents">
                  <span className="font-pixel text-xs text-muted-foreground">
                    R{r.index + 1}
                    {r.multiplier > 1 ? ` ×${r.multiplier}` : ""}
                  </span>
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{placeName(r.answer, map)}</span>
                    <span className="text-muted-foreground"> · {r.answer.game}</span>
                  </span>
                  {r.guesses.map((g, seat) => (
                    <span key={seat} className={cn("text-right tabular-nums", r.hurt !== null && r.hurt !== seat && "font-bold text-success")}>
                      {g ? fmt(g.score) : "—"}
                    </span>
                  ))}
                  {view.mode !== "race" && (
                    <span className="text-right font-pixel text-xs tabular-nums" style={r.hurt === null ? undefined : { color: SEAT_COLORS[r.hurt] }}>
                      {r.hurt === null ? "0" : `−${fmt(r.damage)}`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {view.rematch && (
            <p role="status" className="text-center font-display text-sm font-semibold uppercase tracking-wider text-warning">
              Rematch requested!
            </p>
          )}
          {finder.searching ? (
            <div className="space-y-2 rounded-md border border-screen/40 bg-screen/[0.06] p-3 text-center" role="status">
              <p className="flex items-center justify-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-screen">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching for a ranked rival…
              </p>
              <Button type="button" size="sm" variant="ghost" onClick={finder.cancel}>
                <X className="h-3.5 w-3.5" aria-hidden /> Cancel
              </Button>
            </div>
          ) : (
            <div className={cn("grid gap-2", ranked ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
              {ranked && (
                <Button size="lg" variant="success" disabled={busy || !myName} onClick={() => void finder.search(myName, rankedExtra())} data-testid="geo-ranked-again">
                  <Trophy className="h-4 w-4" aria-hidden /> Queue ranked
                </Button>
              )}
              <Button size="lg" variant={ranked ? "secondary" : "success"} disabled={busy} onClick={onRematch}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                {view.rematch ? "Accept rematch" : ranked ? "Casual rematch" : "Rematch"}
              </Button>
              <Link href="/guessr" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                <Swords className="h-4 w-4" aria-hidden /> Back to PokéGuessr
              </Link>
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">
            {ranked
              ? "A rematch is casual: the same opponent and map with new places, and no rating on the line. It starts when you both press it."
              : "A rematch keeps the map and the trainers, with new places. It starts when you both press it."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

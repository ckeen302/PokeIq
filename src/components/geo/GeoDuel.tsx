"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Crown, Loader2, RotateCcw, Swords, Trophy, X } from "lucide-react";
import { DUEL_HP, DUEL_IDLE_ROUNDS, DUEL_ROUND_MS, duelMultiplier, type DuelRoundResult, type DuelView } from "@/lib/duel-types";
import type { DuelEmote } from "@/lib/pvp-types";
import { DUEL_COUNTDOWN_FLASH_MS, countdownAfterGuess } from "@/lib/geo-duel-rules";
import type { GeoAnswer, GeoRegionInfo } from "@/lib/geo-types";
import { play, unlockAudio } from "@/lib/sound";
import { Button, buttonVariants } from "@/components/ui/button";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelLobby, DuelNotice, DuelVisitor, MatchedNote, SEAT_COLORS, SeatDot, seconds } from "@/components/duel/DuelParts";
import { DuelChat, DuelTools, EmoteFeed } from "@/components/duel/DuelReactions";
import { GeoMap, LINE_DRAW_MS, mapAspect, type MapPin, type RevealedRound } from "./GeoMap";
import { ReportShot } from "./ReportShot";
import { shotFit } from "./ShotCarousel";
import { CountdownPill, FullscreenButton, GameShell, GuessButton, MapDock } from "./GameShell";
import { DuelBand, DuelLeave, EmoteButton, HpTimeline, LivePill, OpponentGuessedBar, THEM_COLOR, VersusIntro, YOU_COLOR, seatImage, useRevealSequence } from "./DuelHud";
import { useDuelLive } from "./use-duel-live";
import { GEO_ERA_NAMES } from "@/lib/geo-families";
import { cn } from "@/lib/utils";
import { AddFriendAfterGame } from "@/components/community/AddFriend";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { rankedExtra } from "@/components/pokedle/Ranked";
import { GEO_RANKED_MATCH } from "@/lib/geo-ranked";
import { GeoRankedOutcome } from "./GeoRanked";
import { GeoVersus } from "./GeoVersus";
import { ShareResultLink } from "./ShareResultLink";
import { TauntStage } from "@/components/duel/TauntStage";
import type { TauntId } from "@/lib/trainer/taunts";

/**
 * A PokéGuessr duel at /guessr/duel/<code>: the lobby, the versus intro, the
 * rounds, the reveals and the end screen. The server runs the duel; useDuel
 * polls its state and sends the trainer's actions, and where Supabase
 * Realtime is set up (use-duel-live.ts) the server's pushes fetch the state
 * the moment it changes, with the polls eased off to a 3 s safety net (back
 * to every second while the channel is down, with "Reconnecting…" in the
 * HUD). Timers count down on the server's clock, corrected for this
 * device's. In play the duel takes the whole window (GameShell), GeoGuessr
 * style.
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

/** The camera fits both pins and the answer this long (ms), after the lines have drawn. */
const FIT_MS = 800;

export interface GeoDuelProps {
  code: string;
  /** Every map: the duel is played on one of them. */
  regions: GeoRegionInfo[];
}

export function GeoDuel({ code, regions }: GeoDuelProps) {
  const router = useRouter();
  const { view, now, gone, offline, error, setError, busy, sawPlay, act, send, join, rematch: takeRematch, refresh, setLive } = useDuel<DuelView>(`/api/geo/duel/${code}`, code);
  // Pushed changes: fetch at once; while they arrive, polls ease off.
  const liveStatus = useDuelLive(view?.live, code, refresh);
  useEffect(() => setLive(liveStatus === "up"), [liveStatus, setLive]);
  const [pick, setPick] = useState<MapPin | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [summary, setSummary] = useState(false);
  const heard = useRef({ theirGuess: false, end: false, tick: -1 });

  // A new round: a fresh pin.
  const roundIndex = view?.round?.index;
  useEffect(() => {
    setPick(null);
    setZoomed(false);
    setError(null);
  }, [roundIndex, setError]);

  // Sounds: the opponent locking in, the countdown's last seconds, and a forfeit's result.
  useEffect(() => {
    if (!view || view.you === null) return;
    const h = heard.current;
    const theirGuess = !!view.round?.guessed[1 - view.you];
    if (theirGuess && !h.theirGuess && !view.round?.yours) play("ping");
    h.theirGuess = theirGuess;
    // A forfeit skips the last reveal, so its result sounds straight away.
    if (view.end?.reason === "left" && !h.end && sawPlay) play(view.end.winner === view.you ? "matchwin" : "matchlose");
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

  // The last five seconds tick.
  const leftS = live ? seconds(live.endsAt - now) : -1;
  useEffect(() => {
    if (!live || live.yours || leftS < 0 || leftS > DUEL_COUNTDOWN_FLASH_MS / 1000) return;
    if (heard.current.tick === leftS) return;
    heard.current.tick = leftS;
    if (leftS > 0) play("countdown");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per second
  }, [leftS]);

  async function guess() {
    if (!live || !pick || live.yours || busy) return;
    unlockAudio();
    play("guess");
    await act({ action: "guess", round: live.index, ...pick });
  }

  async function nextRound() {
    if (!view || view.you === null || !last || view.next?.pressed[view.you] || busy) return;
    unlockAudio();
    await act({ action: "next", round: last.index });
  }

  function showResults() {
    if (view?.end) play(view.end.winner === view.you ? "matchwin" : view.end.winner === null ? "streak" : "matchlose");
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
    </>
  );
  const livePill = <LivePill status={liveStatus} />;
  const sendEmote = (e: DuelEmote) => {
    unlockAudio();
    return send({ action: "emote", emote: e });
  };
  const tools = view.you !== null && <DuelTools onEmote={sendEmote} />;
  const chat = <DuelChat view={view} game="PokéGuessr duel" onSend={(text) => send({ action: "chat", text })} />;
  const countdownMs = countdownAfterGuess(!!view.turbo);

  if (view.status === "lobby") {
    return (
      <>
        {notice}
        {liveStatus === "down" && <div className="mb-3 flex justify-center">{livePill}</div>}
        <EmoteFeed view={view} />
        <DuelLobby
          view={view}
          path={`/guessr/duel/${view.code}`}
          tag={`${race ? `Points race · ${view.maxRounds} rounds` : "HP battle"}${view.turbo ? " · Turbo" : ""} · ${map.name}${view.era ? ` · ${GEO_ERA_NAMES[view.era]}` : ""}`}
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
              text: `The same screenshot for both of you. Once one of you guesses, the other has ${countdownMs / 1000} seconds${view.turbo ? " (Turbo)" : ""} (${DUEL_ROUND_MS / 1000} s a round at most).`,
            },
            race
              ? { label: "Scoring", text: `Every round is worth up to ${fmt(5000)} points, no damage and no multipliers. ${view.maxRounds} rounds, and your points add up.` }
              : {
                  label: "Damage",
                  text: `${fmt(DUEL_HP)} HP each. The lower score loses the difference times the round winner's multiplier: ×1 for rounds 1–3, ×1.5 for 4–6, ×2 for 7–9, ×2.5 in round 10. Damage lands in full.`,
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
      <GameShell onExit={() => router.push("/guessr")}>
        {() => (
          <div className="h-full overflow-y-auto">
            {notice}
            {liveStatus === "down" && <div className="flex justify-center pt-3">{livePill}</div>}
            <EmoteFeed view={view} />
            <DuelEnd view={view} map={map} busy={busy} onRematch={() => void rematch()} onTaunt={(id) => send({ action: "emote", emote: id })} />
            <div className="mx-auto max-w-3xl space-y-4 px-4 pb-10 text-foreground">
              {view.you !== null && <AddFriendAfterGame kind="guessr" code={view.code} />}
              <div className="rounded-md bg-card p-3">{tools}</div>
              {chat}
            </div>
          </div>
        )}
      </GameShell>
    );
  }

  const emoteButton = <EmoteButton onEmote={sendEmote} />;

  // ---- lead-in: the versus intro, then "Round N" with the countdown digit ----------
  if (view.round && !live) {
    const { index, startsAt } = view.round;
    return (
      <GameShell>
        {() => (
          <>
            {index === 0 ? (
              <>
                <GeoVersus view={view} me={me} secondsLeft={Math.max(1, seconds(startsAt - now))} mapName={`${map.name}${view.era ? ` · ${GEO_ERA_NAMES[view.era]}` : ""}`} />
                <div className="absolute inset-x-0 top-0 z-20">{notice}</div>
                <EmoteButton onEmote={sendEmote} className="max-lg:bottom-4 max-lg:top-auto max-lg:translate-y-0" />
              </>
            ) : (
              <>
                {notice}
                <VersusIntro view={view} me={me} round={index + 1} secondsLeft={Math.max(1, seconds(startsAt - now))} mapName={`${map.name}${view.era ? ` · ${GEO_ERA_NAMES[view.era]}` : ""}`} />
                {emoteButton}
              </>
            )}
            <div className="absolute left-3 top-3 z-30 flex items-center gap-2">
              <DuelLeave busy={busy} onLeave={() => void leave()} />
              {livePill}
            </div>
          </>
        )}
      </GameShell>
    );
  }

  // ---- guessing --------------------------------------------------------------------------
  if (live) {
    const totalMs = live.countdown ? countdownMs : DUEL_ROUND_MS;
    // A pushed countdown lands within a few ms of the guess, while the page's clock ticks every 250 ms: never more than the countdown.
    const left = Math.min(live.endsAt - now, totalMs);
    const locked = live.yours ?? null;
    const theyGuessed = live.guessed[1 - me];
    const timeUp = left <= 0;
    return (
      <GameShell>
        {({ fs, toggle }) => (
          <div className="relative flex h-full flex-col">
            <DuelBand
              view={view}
              me={me}
              round={live.index + 1}
              hp={view.hp}
              multiplier={live.multiplier}
              multipliers={live.multipliers}
              compact
              below={<CountdownPill ms={left} totalMs={totalMs} urgentMs={live.countdown ? DUEL_COUNTDOWN_FLASH_MS : 10_000} testId="geo-duel-clock" />}
            />
            <div className="relative min-h-0 flex-1">
              <AnimatePresence>
                {(theyGuessed || locked) && !timeUp && <OpponentGuessedBar name={them} leftMs={left} totalMs={countdownMs} mine={!!locked && !theyGuessed} />}
              </AnimatePresence>
              <div className="absolute inset-0">
                {notice && <div className="absolute inset-x-0 top-12 z-30 px-4">{notice}</div>}
                <div className="screen relative h-full w-full overflow-hidden rounded-none">
                  {live.shot && (
                    // eslint-disable-next-line @next/next/no-img-element -- server-proxied, CDN-cached screenshot
                    <img
                      key={live.shot}
                      src={live.shot}
                      alt="Where is this?"
                      data-testid="geo-shot"
                      onLoad={(e) => {
                        e.currentTarget.style.imageRendering = shotFit(e.currentTarget).pixelated ? "pixelated" : "auto";
                        e.currentTarget.style.opacity = "1";
                      }}
                      className="absolute inset-0 h-full w-full object-cover object-center opacity-0 transition-opacity duration-[350ms]"
                    />
                  )}
                </div>
                <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
                  <DuelLeave busy={busy} onLeave={() => void leave()} />
                  <FullscreenButton fs={fs} onClick={toggle} />
                  {livePill}
                </div>
                <div className="absolute bottom-[5.5rem] left-3 z-[3] md:bottom-3">
                  <button type="button" onClick={() => setZoomed(true)} className="hud-btn" aria-label="View the whole screenshot" title="Whole screenshot">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  </button>
                </div>
                {emoteButton}
                <MapDock aspect={mapAspect(map)}
                  hasPin={!!pick && !locked}
                  map={({ fill }) => (
                    <GeoMap
                      region={map}
                      pick={locked ?? pick}
                      pinImage={seatImage(view, me)}
                      fill={fill}
                      onPick={
                        locked || timeUp
                          ? undefined
                          : (p) => {
                              setPick(p);
                              play("pin");
                            }
                      }
                    />
                  )}
                  button={
                    <GuessButton
                      hasPin={!!pick}
                      busy={busy}
                      disabled={!!locked || busy || timeUp}
                      label={locked ? `Waiting for ${them}…` : timeUp ? "Time's up" : undefined}
                      onClick={() => void guess()}
                    />
                  }
                />
              </div>
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
                  <button type="button" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close">
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
        {() => (
          <DuelReveal view={view} map={map} result={last} me={me} notice={notice} emoteButton={emoteButton} livePill={livePill}>
            <button
              type="button"
              disabled={!final && (pressed || busy)}
              onClick={() => (final ? showResults() : void nextRound())}
              data-testid="geo-duel-next"
              className={cn(
                "flex h-12 w-full items-center justify-center gap-2 rounded-md px-6 font-display text-base font-bold uppercase tracking-wider text-white shadow-lg transition-[background-color,transform]",
                !final && (pressed || busy) ? "cursor-wait bg-black/60" : "bg-[#4cbb17] hover:bg-[#58d01c] active:scale-[0.98]"
              )}
            >
              {final ? "See results ▶" : pressed ? `Waiting for ${them}… (${nextIn})` : `Next round (${nextIn}) ▶`}
            </button>
            {!final && (
              <div className="mt-2 flex justify-center">
                <DuelLeave busy={busy} onLeave={() => void leave()} />
              </div>
            )}
          </DuelReveal>
        )}
      </GameShell>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * A revealed round: the band with both scores and the distance pill, the
 * full-bleed result map (both avatar pins, dashed lines to the answer, then
 * the camera fits them), the damage sequence, and at the bottom the place and
 * the button to go on.
 */
function DuelReveal({
  view,
  map,
  result,
  me,
  notice,
  emoteButton,
  livePill,
  children,
}: {
  view: DuelView;
  map: GeoRegionInfo;
  result: DuelRoundResult;
  me: number;
  notice: React.ReactNode;
  emoteButton: React.ReactNode;
  livePill?: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const seq = useRevealSequence(result, me);
  const revealed: RevealedRound[] = result.guesses.map((g, seat) => ({
    guess: g && { x: g.x, y: g.y },
    answer: result.answer,
    label: view.players[seat]?.name,
    color: seat === me ? YOU_COLOR : THEM_COLOR,
    image: seatImage(view, seat),
  }));
  const name = (seat: number) => (seat === me ? "You" : (view.players[seat]?.name ?? "They"));
  const headline =
    view.mode === "race"
      ? result.winner === null
        ? "Even round"
        : `${name(result.winner)} won the round`
      : result.hurt === null
        ? "Even round: no damage"
        : `${name(result.hurt)} ${result.hurt === me ? "take" : "takes"} ${fmt(result.damage)} damage`;
  return (
    <div className="relative flex h-full flex-col" data-testid="geo-duel-reveal">
      <DuelBand view={view} me={me} round={result.index + 1} hp={seq.hp} multiplier={result.winner === null ? duelMultiplier(result.index) : result.multiplier} multipliers={result.multipliers} result={result} seq={seq} />
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-x-0 top-0 bottom-[8rem] md:bottom-[5.75rem]">
          <GeoMap region={map} revealed={revealed} fit={{ delay: LINE_DRAW_MS, duration: FIT_MS }} fill controls={false} />
        </div>
        {notice && <div className="absolute inset-x-0 top-16 z-30 px-4">{notice}</div>}
        {livePill && <div className="absolute left-3 top-3 z-20">{livePill}</div>}
        {emoteButton}
        {/* The bottom bar: the round's verdict, the place and Next. */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: reduced ? 0 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute inset-x-0 bottom-0 z-20 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur"
        >
          <div className="mx-auto grid max-w-5xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto]">
            <div className="flex min-w-0 items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- the same cached screenshot, as a thumbnail */}
              <img src={result.shot} alt="" className="hidden h-12 w-16 shrink-0 rounded border border-white/20 object-cover sm:block" />
              <div className="min-w-0">
                <p className="font-display text-base font-extrabold uppercase italic leading-tight sm:text-lg" data-testid="geo-duel-headline">
                  {headline}
                  {result.hurt !== null && result.multiplier > 1 && <span className="text-[#ffd23c]"> (×{result.multiplier})</span>}
                </p>
                <p className="truncate text-sm text-white/80">
                  It was <span className="font-semibold text-white">{placeName(result.answer, map)}</span>
                  <span className="text-white/60"> · Pokémon {result.answer.game}</span>
                </p>
                <div className="text-xs text-white/60 [&_button]:text-white/60 [&_button:hover]:text-white">
                  <ReportShot key={result.shot} shot={result.shot} mode="duel" />
                </div>
              </div>
            </div>
            <div className="w-full md:w-72">{children}</div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/**
 * The end screen: the result word, the final band, the per-round damage
 * table, the HP timeline, the rating change (ranked) and what to do next.
 */
function DuelEnd({ view, map, busy, onRematch, onTaunt }: { view: DuelView; map: GeoRegionInfo; busy: boolean; onRematch: () => void; onTaunt: (id: TauntId) => Promise<string | null> }) {
  const me = view.you!;
  const end = view.end!;
  const reduced = useReducedMotion();
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
    r.guesses.map((g, seat) => ({ guess: g && { x: g.x, y: g.y }, answer: r.answer, label: String(r.index + 1), color: seat === me ? YOU_COLOR : THEM_COLOR, image: seatImage(view, seat) }))
  );
  const lastIndex = view.revealed.length - 1;
  const totalDamage = (seat: number) => view.revealed.reduce((s, r) => s + (r.winner === seat ? r.damage : 0), 0);

  return (
    <div className="text-white" data-testid="geo-duel-end">
      <div className="geo-split relative overflow-hidden px-4 pb-6 pt-8 text-center sm:pt-12">
        <p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-white/70">Duel over · {map.name}{view.turbo ? " · Turbo" : ""}</p>
        <motion.div
          initial={reduced ? false : { scale: 0.6, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 14 }}
          className={cn("geo-glow mt-1 flex items-center justify-center gap-3 font-display text-6xl font-extrabold uppercase italic sm:text-8xl", won ? "text-[#9be15d]" : draw ? "text-[#c8bfff]" : "text-[#ff5a5a]")}
          data-testid="geo-duel-result"
        >
          {won && <Crown className="h-12 w-12 sm:h-16 sm:w-16" aria-hidden />}
          {draw ? "Draw" : won ? "Victory!" : "Defeat"}
        </motion.div>
        <p className="mt-1 text-white/80">{reason}</p>
        {/* Both trainers, and the dances and emotes either can play for the other to see. */}
        <div className="mt-4 sm:mt-6">
          <TauntStage view={view} onTaunt={onTaunt} />
        </div>
      </div>

      <DuelBand
        view={view}
        me={me}
        round={Math.max(1, rounds)}
        hp={view.hp}
        multiplier={lastIndex >= 0 ? duelMultiplier(lastIndex) : 1}
        multipliers={lastIndex >= 0 ? view.revealed[lastIndex].multipliers : [1, 1]}
        compact
      />

      <div className="mx-auto max-w-4xl space-y-5 px-4 py-5">
        {ranked && (
          <div className="rounded-md bg-card text-foreground">
            <GeoRankedOutcome view={view} />
          </div>
        )}

        {finder.error && (
          <p role="alert" className="text-sm text-[#ff5a5a]">
            {finder.error}
          </p>
        )}
        {finder.searching ? (
          <div className="space-y-2 rounded-md border border-[#a99cff]/40 bg-white/5 p-3 text-center" role="status">
            <p className="flex items-center justify-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-[#c8bfff]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching for a ranked rival…
            </p>
            <Button type="button" size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={finder.cancel}>
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
            <Link href="/guessr" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white")}>
              <Swords className="h-4 w-4" aria-hidden /> Back to PokéGuessr
            </Link>
          </div>
        )}
        {view.rematch && (
          <p role="status" className="text-center font-display text-sm font-semibold uppercase tracking-wider text-[#ffd23c]">
            Rematch requested!
          </p>
        )}
        {/* The duel's result page and preview card (both trainers, HP and rounds), by its code. */}
        <ShareResultLink token={`duel:${view.code}`} text="Our PokéGuessr duel" className="[&_button]:border-white/30 [&_button]:bg-transparent [&_button]:text-white [&_button:hover]:bg-white/10 [&_button:hover]:text-white" />
        <Link href="/guessr/history" className="block text-center text-xs font-semibold text-white/70 underline-offset-2 hover:text-white hover:underline" data-testid="geo-duel-history-link">
          Duel history and replays
        </Link>

        {rounds > 0 && (
          <div className="grid gap-4 md:grid-cols-[1fr_minmax(0,20rem)]">
            {/* The per-round table. */}
            <div className={cn("grid items-center gap-x-3 gap-y-1.5 rounded-md bg-white/5 p-3 text-sm", view.mode === "race" ? "grid-cols-[auto_1fr_auto_auto]" : "grid-cols-[auto_1fr_auto_auto_auto]")} data-testid="geo-duel-table">
              <span />
              <span className="hud-label !text-white/60">Place</span>
              {[0, 1].map((seat) => (
                <span key={seat} className="hud-label flex items-center justify-end gap-1.5 !text-white/60">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: seat === me ? YOU_COLOR : THEM_COLOR }} aria-hidden />
                  {view.players[seat]?.name}
                </span>
              ))}
              {view.mode !== "race" && <span className="hud-label text-right !text-white/60">Damage</span>}
              {view.revealed.map((r) => (
                <div key={r.index} className="contents">
                  <span className="font-pixel text-xs text-white/60">
                    R{r.index + 1}
                    {r.multiplier > 1 ? ` ×${r.multiplier}` : ""}
                  </span>
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{placeName(r.answer, map)}</span>
                    <span className="text-white/60"> · {r.answer.game}</span>
                  </span>
                  {r.guesses.map((g, seat) => (
                    <span key={seat} className={cn("text-right tabular-nums", r.winner === seat && "font-bold text-[#9be15d]")}>
                      {g ? fmt(g.score) : "—"}
                    </span>
                  ))}
                  {view.mode !== "race" && (
                    <span className="text-right font-pixel text-xs tabular-nums" style={r.hurt === null ? undefined : { color: r.hurt === me ? "#ff5a5a" : "#9be15d" }}>
                      {r.hurt === null ? "0" : `−${fmt(r.damage)}`}
                    </span>
                  )}
                </div>
              ))}
              {view.mode !== "race" && (
                <>
                  <span className="font-pixel text-xs text-white/60">Total</span>
                  <span className="text-white/60">damage dealt</span>
                  {[0, 1].map((seat) => (
                    <span key={seat} className="text-right font-bold tabular-nums">
                      {fmt(totalDamage(seat))}
                    </span>
                  ))}
                  <span />
                </>
              )}
            </div>
            {view.mode !== "race" && (
              <div className="rounded-md bg-white/5 p-3">
                <p className="hud-label mb-1 !text-white/60">HP over the duel</p>
                <HpTimeline view={view} me={me} />
                <p className="mt-1 flex justify-between text-[11px] text-white/60">
                  <span style={{ color: YOU_COLOR }}>You</span>
                  <span style={{ color: THEM_COLOR }}>{them}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {allRounds.length > 0 && (
          <div className="overflow-hidden rounded-md">
            <GeoMap region={map} revealed={allRounds} />
          </div>
        )}

        <p className="text-center text-xs text-white/60">
          {ranked
            ? "A rematch is casual: the same opponent and map with new places, and no rating on the line. It starts when you both press it."
            : "A rematch keeps the map and the trainers, with new places. It starts when you both press it."}
        </p>
      </div>
    </div>
  );
}

export { SEAT_COLORS, SeatDot };

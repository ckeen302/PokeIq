"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Crown, Eye, Heart, Link2, Loader2, LogOut, Play, RotateCcw, Share2, Swords, UserMinus, Users, X } from "lucide-react";
import type { DuelEmote } from "@/lib/pvp-types";
import type { TauntId } from "@/lib/trainer/taunts";
import { DUEL_COUNTDOWN_FLASH_MS } from "@/lib/geo-duel-rules";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { WORLD_REGION, geoMapRank } from "@/lib/geo-types";
import {
  PARTY_COUNTDOWN_SECONDS,
  PARTY_LIVES,
  PARTY_MAX_PLAYERS,
  PARTY_ROUND_CAPS,
  PARTY_ROUND_SECONDS,
  PARTY_TEAM_HP,
  PARTY_TEAM_MAX,
  TEAM_COLORS,
  partyPath,
  type PartyMode,
  type PartyRoundResult,
  type PartySettings,
  type PartyView,
} from "@/lib/geo-party";
import { play, unlockAudio } from "@/lib/sound";
import { useGuessrMusic } from "@/lib/use-guessr-music";
import { shareOrCopy } from "@/lib/share";
import { useProgress } from "@/lib/progress";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/avatar/Avatar";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelNotice, seconds } from "@/components/duel/DuelParts";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { GeoMap, LINE_DRAW_MS, mapAspect, type MapPin, type RevealedRound } from "./GeoMap";
import { CountdownPill, FullscreenButton, GameShell, GuessButton, MapDock } from "./GameShell";
import { EmoteButton, LivePill, fmtIn, multIn } from "./DuelHud";
import { useDuelLive } from "./use-duel-live";
import { LiveShot, shotFit } from "./ShotCarousel";
import { ReportShot } from "./ReportShot";
import { Lives, MAX_3D, PartyEmoteFeed, PartyLineup, PartyTrainer, Roster, TauntBar, TeamHp, seatColor, seatPin, usePartyTaunts } from "./PartyParts";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import partyNs from "@/messages/guessr-party";
import { gameName, mapName, namedMap, placeName, type GuessrNames } from "./duel-names";

type P = Translator<typeof partyNs.en>;

/**
 * A PokéGuessr party at /pokeguessr/party/<code>: the lobby (the host sets the
 * game up and starts it), the line-up, the rounds, the reveals and the
 * standings. The server runs the party (server/geo-party.ts); useDuel polls
 * its state and sends actions with this trainer's seat token (kept per code,
 * so a reload rejoins), and the duel's live channel fetches the moment
 * anything changes, with polling as the fallback.
 */

const FIT_MS = 650;
/** Names joined as the language does: "Red and Blue", "Red and Blue and Green" (English, as before). */
const joinNames = (t: P, names: string[]) => names.reduce((a, b) => t("and", { a, b }));

export function GeoParty({ code, regions, names }: { code: string; regions: GeoRegionInfo[]; names?: GuessrNames }) {
  const router = useRouter();
  const t = useT(partyNs);
  const { view, now, gone, offline, error, setError, busy, sawPlay, act, send, join, refresh, setLive } = useDuel<PartyView>(`/api/geo/party/${code}`, code);
  const liveStatus = useDuelLive(view?.live, code, refresh);
  useEffect(() => setLive(liveStatus === "up"), [liveStatus, setLive]);
  // On the standings, taunts and Play again should land quickly even without pushes: a 3 s poll for the first few minutes.
  const endAt = view?.end?.at;
  useEffect(() => {
    if (!endAt || liveStatus === "up") return;
    const id = window.setInterval(() => {
      if (Date.now() - endAt < 5 * 60_000) refresh();
    }, 3_000);
    return () => window.clearInterval(id);
  }, [endAt, liveStatus, refresh]);
  const [pick, setPick] = useState<MapPin | null>(null);
  const [summary, setSummary] = useState(false);
  /** The round's whole screenshot, full screen (as a duel's and a solo round's). */
  const [zoomed, setZoomed] = useState(false);
  const heard = useRef({ tick: -1, end: false });
  const aim = useRef({ at: 0, timer: 0 as number | undefined });

  const roundIndex = view?.round?.index;
  useEffect(() => {
    setPick(null);
    setZoomed(false);
    setError(null);
  }, [roundIndex, setError]);
  // A new game in the room: the standings close.
  const game = view?.game;
  useEffect(() => setSummary(false), [game]);

  const live = view?.round && now >= view.round.startsAt ? view.round : undefined;
  const last = view?.revealed[view.revealed.length - 1];
  const revealing = !!view && view.status === "playing" && !view.round && !!last;
  const me = view?.you ?? null;
  const playingNow = !!live && me !== null && live.playing[me];

  const leftS = live ? seconds(live.endsAt - now) : -1;
  useEffect(() => {
    if (!live || !playingNow || live.yours || leftS < 0 || leftS > DUEL_COUNTDOWN_FLASH_MS / 1000) return;
    if (heard.current.tick === leftS) return;
    heard.current.tick = leftS;
    if (leftS > 0) play("countdown");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per second
  }, [leftS]);

  useEffect(() => {
    if (!view?.end || heard.current.end || !sawPlay) return;
    heard.current.end = true;
    if (view.end.reason === "left") play(me !== null && view.end.places[me] === 1 ? "matchwin" : "matchlose");
  }, [view?.end, sawPlay, me]);

  async function guess() {
    if (!live || !pick || live.yours || busy || !playingNow) return;
    unlockAudio();
    play("guess");
    await act({ action: "guess", round: live.index, ...pick });
  }

  /** Team duels: tell teammates where the pin sits (a few times a second at most). */
  function sendAim(p: MapPin) {
    if (!live || view?.settings.mode !== "team") return;
    const index = live.index;
    window.clearTimeout(aim.current.timer);
    const wait = Math.max(0, aim.current.at + 400 - Date.now());
    aim.current.timer = window.setTimeout(() => {
      aim.current.at = Date.now();
      void send({ action: "aim", round: index, ...p });
    }, wait);
  }

  async function nextRound() {
    if (!view || me === null || !last || view.next?.pressed[me] || busy) return;
    unlockAudio();
    await act({ action: "next", round: last.index });
  }

  async function leave() {
    if (await act({ action: "leave" })) router.push("/pokeguessr");
  }

  function showResults() {
    if (view?.end && me !== null) play(view.end.places[me] === 1 ? "matchwin" : "matchlose");
    setSummary(true);
  }

  // Space / Enter to guess, then for the next round; Esc closes the zoomed view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setZoomed(false);
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, a")) return;
      if (live && pick && !live.yours && playingNow) {
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

  const map = view ? regions.find((r) => r.id === view.settings.region) : undefined;
  /** The standings: the game is over and its last reveal (if this trainer saw the game) has been seen. */
  const ended = view?.status === "finished" && (summary || !sawPlay || !last || view.end?.reason === "left");
  // The music plays while this trainer's game is on (the line-up, the rounds and their reveals), not in the lobby, for a watcher or on the standings.
  useGuessrMusic(!gone && !!map && me !== null && (view?.status === "playing" || (view?.status === "finished" && !ended)));
  if (gone || (view && !map)) return <DuelGone message={gone ?? t("gone")} href="/pokeguessr" label={t("back")} />;
  if (!view || !map) return <DuelLoading />;

  const notice = <DuelNotice error={error} offline={offline} />;
  const livePill = <LivePill status={liveStatus} />;
  const sendEmote = (e: DuelEmote) => {
    unlockAudio();
    return send({ action: "emote", emote: e });
  };
  const shownMap = mapName(map, names);

  if (view.status === "lobby") {
    return (
      <>
        {notice}
        <PartyLobby
          view={view}
          regions={regions}
          names={names}
          busy={busy}
          onJoin={join}
          onSettings={(s) => void act({ action: "settings", ...s })}
          onTeam={(team, seat) => void act({ action: "team", team, ...(seat !== undefined ? { seat } : {}) })}
          onKick={(seat) => void act({ action: "kick", seat })}
          onStart={() => {
            unlockAudio();
            void act({ action: "start" });
          }}
          onLeave={() => void leave()}
        />
      </>
    );
  }

  if (me === null) {
    return <PartyWatch view={view} mapName={shownMap} />;
  }

  if (ended) {
    return (
      <GameShell onExit={() => router.push("/pokeguessr")}>
        {() => (
          <div className="h-full overflow-y-auto">
            {notice}
            <PartyEmoteFeed view={view} />
            <PartyEnd view={view} map={map} names={names} busy={busy} onAgain={() => void act({ action: "again" })} onTaunt={(id) => send({ action: "emote", emote: id })} />
          </div>
        )}
      </GameShell>
    );
  }

  const emoteButton = <EmoteButton onEmote={sendEmote} />;
  const leaveButton = <PartyLeave busy={busy} out={!!view.players[me]?.out} onLeave={() => void leave()} />;

  // ---- lead-in -------------------------------------------------------------------
  if (view.round && !live) {
    const { index, startsAt } = view.round;
    const secondsLeft = Math.max(1, seconds(startsAt - now));
    return (
      <GameShell>
        {() => (
          <>
            {index === 0 ? (
              <PartyLineup view={view} mapName={shownMap} secondsLeft={secondsLeft} />
            ) : (
              <RoundIntro view={view} round={index + 1} secondsLeft={secondsLeft} mapName={shownMap} />
            )}
            <div className="absolute inset-x-0 top-12 z-20">{notice}</div>
            <PartyEmoteFeed view={view} />
            <div className="geo-safe-tl absolute left-3 top-3 z-30 flex items-center gap-2">
              {leaveButton}
              {livePill}
            </div>
          </>
        )}
      </GameShell>
    );
  }

  // ---- guessing (or watching, once out) -----------------------------------------------
  if (live) {
    const totalMs = live.countdown ? view.settings.countdownSeconds * 1000 : view.settings.roundSeconds * 1000;
    const left = Math.min(live.endsAt - now, totalMs);
    const locked = live.yours ?? null;
    const timeUp = left <= 0;
    const waiting = live.playing.filter((on, s) => on && !live.guessed[s]).length;
    const mates = (live.mates ?? []).flatMap((m, s) => (m ? [{ x: m.x, y: m.y, color: seatColor(view, s), image: seatPin(view, s), label: `${view.players[s].name}${m.locked ? " ✓" : ""}` }] : []));
    return (
      <GameShell>
        {({ fs, toggle }) => (
          <div className="relative flex h-full flex-col">
            <PartyBand view={view} round={live.index + 1} below={<CountdownPill ms={left} totalMs={totalMs} urgentMs={live.countdown ? DUEL_COUNTDOWN_FLASH_MS : 10_000} testId="party-clock" clock />} />
            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-0">
                {notice && <div className="absolute inset-x-0 top-12 z-30 px-4">{notice}</div>}
                <div className="screen relative h-full w-full overflow-hidden rounded-none" style={{ height: "calc(100% - var(--geo-bar))" }}>
                  {live.shot && <LiveShot key={live.shot} src={live.shot} alt={t("round.alt")} />}
                </div>
                <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
                  {leaveButton}
                  <FullscreenButton fs={fs} onClick={toggle} />
                  {livePill}
                </div>
                <div className="absolute left-3 z-[3] bottom-[calc(var(--geo-bar)+0.75rem)] md:bottom-3">
                  <button type="button" onClick={() => setZoomed(true)} className="hud-btn" aria-label={t("round.zoom")} title={t("round.zoomTitle")} data-testid="party-zoom">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  </button>
                </div>
                {/* Who's in and who has guessed: a column on the right on desktop, a strip on a phone. */}
                <Roster view={view} guessed={live.guessed} className="absolute right-3 top-3 z-20 max-h-[calc(100%-7rem)] flex-col items-end overflow-y-auto max-md:left-[7.5rem] max-md:flex-row max-md:items-start max-md:justify-end max-md:overflow-x-auto max-md:overflow-y-hidden" />
                <PartyEmoteFeed view={view} />
                {emoteButton}
                {playingNow ? (
                  <MapDock
                    aspect={mapAspect(map)}
                    hasPin={!!pick && !locked}
                    map={({ fill, land }) => (
                      <GeoMap
                        land={land}
                        region={namedMap(map, names)}
                        pick={locked ?? pick}
                        pinImage={seatPin(view, me)}
                        others={mates}
                        fill={fill}
                        onPick={
                          locked || timeUp
                            ? undefined
                            : (p) => {
                                setPick(p);
                                play("pin");
                                sendAim(p);
                              }
                        }
                      />
                    )}
                    button={
                      <GuessButton
                        hasPin={!!pick}
                        busy={busy}
                        disabled={!!locked || busy || timeUp}
                        label={locked ? (waiting ? t("round.waitingMore", { n: waiting }) : t("round.locked")) : timeUp ? t("round.timeUp") : undefined}
                        onClick={() => void guess()}
                      />
                    }
                  />
                ) : (
                  <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
                    <p className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 font-display text-sm font-bold uppercase tracking-wide text-white backdrop-blur" data-testid="party-spectating">
                      <Eye className="h-4 w-4" aria-hidden /> {t("round.watching", { guessed: live.guessed.filter(Boolean).length, playing: live.playing.filter(Boolean).length })}
                    </p>
                  </div>
                )}
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
                  aria-label={t("round.fullScreen")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- same cached screenshot, full size */}
                  <img
                    src={live.shot}
                    alt={t("round.alt")}
                    onLoad={(e) => (e.currentTarget.style.imageRendering = shotFit(e.currentTarget).pixelated ? "pixelated" : "auto")}
                    className="max-h-[calc(100vh-2rem)] max-w-full rounded-md object-contain"
                  />
                  <button type="button" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label={t("round.close")}>
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

  // ---- reveal --------------------------------------------------------------------
  if (last) {
    const final = view.status === "finished";
    const pressed = view.next?.pressed[me] ?? false;
    const nextIn = view.next ? seconds(view.next.at - now) : 0;
    const stillIn = !view.players[me]?.out;
    const nextLabel = final ? t("reveal.standings") : !stillIn ? t("reveal.nextIn", { n: nextIn }) : pressed ? t("reveal.waiting", { n: nextIn }) : t("reveal.next", { n: nextIn });
    return (
      <GameShell>
        {() => (
          <PartyReveal view={view} map={map} names={names} result={last} notice={notice} emoteButton={emoteButton} livePill={livePill}>
            <button
              type="button"
              disabled={!final && (pressed || busy || !stillIn)}
              onClick={() => (final ? showResults() : void nextRound())}
              data-testid="party-next"
              className={cn(
                "flex h-12 w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-6 font-display text-base font-bold uppercase tracking-wider text-white shadow-lg transition-[background-color,transform]",
                !final && (pressed || busy || !stillIn) ? "cursor-wait bg-black/60" : "bg-[#4cbb17] hover:bg-[#58d01c] active:scale-[0.98]"
              )}
            >
              <span className="min-w-0 truncate" title={nextLabel}>{nextLabel}</span>
            </button>
            {!final && <div className="mt-2 flex justify-center">{leaveButton}</div>}
          </PartyReveal>
        )}
      </GameShell>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// In play
// ---------------------------------------------------------------------------

function PartyLeave({ busy, out, onLeave }: { busy: boolean; out: boolean; onLeave: () => void }) {
  const t = useT(partyNs);
  const [sure, setSure] = useState(false);
  if (sure && !out) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-black/70 px-3 py-1.5 text-sm text-white backdrop-blur">
        <span className="hidden sm:inline">{t("leave.sure")}</span>
        <button type="button" disabled={busy} onClick={onLeave} className="rounded bg-[#ff5a5a] px-2.5 py-1 font-display text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {t("leave.leave")}
        </button>
        <button type="button" onClick={() => setSure(false)} className="rounded px-2 py-1 font-display text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white">
          {t("leave.stay")}
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => (out ? onLeave() : setSure(true))} className="hud-btn !w-auto gap-1.5 px-2.5 text-xs font-semibold" aria-label={t("leave.title")} title={t("leave.title")}>
      <LogOut className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">{t("leave.leave")}</span>
    </button>
  );
}

/** The band over the round: the round, the clock, and lives or team HP. */
function PartyBand({ view, round, below }: { view: PartyView; round: number; below?: React.ReactNode }) {
  const t = useT(partyNs);
  const me = view.you!;
  const team = view.settings.mode === "team";
  const myTeam = view.players[me]?.team;
  const alive = view.players.filter((p) => !p.out).length;
  const mult = view.round?.multiplier ?? 1;
  return (
    <div className="relative z-30 border-b-2 border-[#a99cff]/60 bg-[#1e1a3f]/95 px-3 pb-2 pt-2 text-white shadow-lg backdrop-blur" data-testid="party-band">
      <div className="mx-auto grid max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-3">
        {team ? (
          <TeamHp team={0} hp={view.hp?.[0] ?? PARTY_TEAM_HP} you={myTeam === 0} />
        ) : (
          <div className="min-w-0">
            <p className="hud-label !text-white/60">{t("band.you")}</p>
            {view.players[me]?.out ? <p className="font-display text-sm font-bold uppercase text-[#ff8a8a]">{t("band.out")}</p> : <Lives lives={view.players[me]?.lives ?? 0} max={view.settings.lives} className="[&_svg]:h-4 [&_svg]:w-4" />}
          </div>
        )}
        <div className="flex flex-col items-center">
          <p className="font-display text-lg font-extrabold uppercase italic leading-none sm:text-2xl" data-testid="party-round">
            {t("band.round", { round })}
          </p>
          <p className="font-pixel text-[9px] uppercase text-[#ffd23c]">{team ? t("band.damage", { m: multIn(t.locale, mult) }) : t("band.left", { alive, total: view.players.length })}</p>
        </div>
        {team ? (
          <TeamHp team={1} hp={view.hp?.[1] ?? PARTY_TEAM_HP} you={myTeam === 1} className="text-right" />
        ) : (
          <div className="min-w-0 text-right">
            <p className="hud-label !text-white/60">{t("modes.royale")}</p>
            <p className="font-display text-sm font-bold uppercase">{t("band.standing", { alive })}</p>
          </div>
        )}
      </div>
      {below && <div className="mt-1.5 flex justify-center">{below}</div>}
    </div>
  );
}

function RoundIntro({ view, round, secondsLeft, mapName }: { view: PartyView; round: number; secondsLeft: number; mapName: string }) {
  const t = useT(partyNs);
  const team = view.settings.mode === "team";
  const alive = view.players.filter((p) => !p.out).length;
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-4 overflow-hidden bg-[#14112b] px-4 text-center text-white" data-testid="party-round-intro">
      <div aria-hidden className="geo-split absolute inset-0 opacity-80" />
      <div className="relative z-10 space-y-1">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-white/70">{mapName}</p>
        <h2 className="font-display text-5xl font-extrabold uppercase italic sm:text-7xl">{t("intro.round", { round })}</h2>
        <p className="font-display text-sm font-bold uppercase text-[#ffd23c] sm:text-lg">{team ? t("intro.damage", { m: multIn(t.locale, view.round?.multiplier ?? 1) }) : t("intro.standing", { alive })}</p>
      </div>
      {team ? (
        <div className="relative z-10 grid w-full max-w-xl grid-cols-2 gap-6">
          <TeamHp team={0} hp={view.hp?.[0] ?? 0} />
          <TeamHp team={1} hp={view.hp?.[1] ?? 0} />
        </div>
      ) : (
        <Roster view={view} className="relative z-10 max-w-3xl flex-wrap justify-center" />
      )}
      <span key={secondsLeft} className="geo-digit relative z-10 font-display text-6xl font-extrabold leading-none sm:text-8xl" data-testid="party-intro-digit">
        {secondsLeft}
      </span>
    </div>
  );
}

/** The verdict on a revealed round, from the server's stamps. */
function verdict(t: P, view: PartyView, r: PartyRoundResult): string {
  const fmt = fmtIn(t.locale);
  const name = (s: number) => (s === view.you ? t("you") : view.players[s]?.name ?? t("aTrainer"));
  const list = (seats: number[]) =>
    seats.length <= 2 ? (seats.length === 2 ? t("and", { a: name(seats[0]), b: name(seats[1]) }) : seats.map(name).join("")) : t("more", { a: name(seats[0]), b: name(seats[1]), n: seats.length - 2 });
  /** One trainer (not you), you alone, or more than one. */
  const who = (seats: number[]) => (seats.length === 1 ? (seats[0] === view.you ? "You" : "One") : "Many");
  if (r.team) {
    if (r.team.hurt === null) return t("reveal.evenNoDamage");
    const team = t(`teams.${r.team.hurt}`);
    const damage = fmt(r.team.damage);
    return view.players[view.you ?? 0]?.team === r.team.hurt ? t("reveal.teamYouTake", { team, damage }) : t("reveal.teamTakes", { team, damage });
  }
  if (r.out?.length) return t(`reveal.out${who(r.out)}`, { names: list(r.out) });
  if (!r.losers?.length) return t("reveal.evenNoLives");
  return t(`reveal.loses${who(r.losers)}`, { names: list(r.losers) });
}

function PartyReveal({
  view,
  map,
  names,
  result,
  notice,
  emoteButton,
  livePill,
  children,
}: {
  view: PartyView;
  map: GeoRegionInfo;
  names?: GuessrNames;
  result: PartyRoundResult;
  notice: React.ReactNode;
  emoteButton: React.ReactNode;
  livePill: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT(partyNs);
  const fmt = fmtIn(t.locale);
  const reduced = useReducedMotion();
  const revealed: RevealedRound[] = result.guesses.flatMap((g, seat) =>
    g ? [{ guess: { x: g.x, y: g.y }, answer: result.answer, label: seat === view.you ? t("you") : view.players[seat]?.name.slice(0, 12), color: seatColor(view, seat), image: seatPin(view, seat) }] : []
  );
  // Always draw the answer, even when nobody guessed.
  if (!revealed.length) revealed.push({ guess: null, answer: result.answer });
  const order = result.playing.flatMap((on, s) => (on ? [s] : [])).sort((a, b) => (result.guesses[b]?.score ?? 0) - (result.guesses[a]?.score ?? 0));
  const team = result.team;
  return (
    <div className="relative flex h-full flex-col" data-testid="party-reveal">
      <PartyBand view={view} round={result.index + 1} />
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-x-0 top-0 bottom-[8.5rem] md:bottom-[5.75rem] md:right-[19rem]">
          <GeoMap region={namedMap(map, names)} revealed={revealed} fit={{ delay: LINE_DRAW_MS, duration: FIT_MS }} fill controls={false} />
        </div>
        {notice && <div className="absolute inset-x-0 top-16 z-30 px-4">{notice}</div>}
        <div className="geo-safe-tl absolute left-3 top-3 z-20">{livePill}</div>
        {emoteButton}
        <PartyEmoteFeed view={view} />
        {/* The round's scores, best first. */}
        <ol className="absolute right-0 top-0 z-10 hidden max-h-[calc(100%-5.75rem)] w-[19rem] space-y-1 overflow-y-auto border-l border-white/10 bg-[#1e1a3f]/95 p-3 text-white md:block" data-testid="party-round-scores">
          {team && (
            <li className="mb-2 grid grid-cols-2 gap-2 text-center">
              {([0, 1] as const).map((k) => (
                <div key={k} className={cn("rounded-md bg-white/5 p-2", team.winner === k && "ring-1 ring-[#9be15d]")}>
                  <p className="font-display text-[11px] font-bold uppercase" style={{ color: TEAM_COLORS[k] }}>
                    {t(`teams.${k}`)}
                  </p>
                  <p className="font-display text-lg font-extrabold tabular-nums">{fmt(team.scores[k])}</p>
                </div>
              ))}
            </li>
          )}
          {order.map((s, i) => {
            const g = result.guesses[s];
            const lost = result.losers?.includes(s);
            const out = result.out?.includes(s);
            const best = team && (team.best[0] === s || team.best[1] === s);
            return (
              <li key={s} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", s === view.you ? "bg-white/15" : "bg-white/5")} data-testid={`party-score-${s}`}>
                <span className="w-5 font-pixel text-[10px] text-white/60">{i + 1}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seatColor(view, s) }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-semibold">{s === view.you ? t("you") : view.players[s]?.name}</span>
                {best && <Crown className="h-3.5 w-3.5 text-[#ffd23c]" aria-label={t("reveal.counted")} />}
                {out ? (
                  <span className="font-pixel text-[9px] uppercase text-[#ff5a5a]">{t("reveal.out")}</span>
                ) : lost ? (
                  <span className="flex items-center gap-0.5 font-pixel text-[9px] text-[#ff8a8a]">
                    −1 <Heart className="h-3 w-3 fill-current" aria-hidden />
                  </span>
                ) : null}
                <span className="w-14 text-right font-display font-bold tabular-nums">{g ? fmt(g.score) : "—"}</span>
              </li>
            );
          })}
        </ol>
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: reduced ? 0 : 0.2 }}
          className="absolute inset-x-0 bottom-0 z-20 border-t-4 border-[#a99cff] bg-[#1e1a3f]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.5)] backdrop-blur"
        >
          <div className="mx-auto grid max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 md:grid-cols-[1fr_auto]">
            <div className="flex min-w-0 items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- the same cached screenshot, as a thumbnail */}
              <img src={result.shot} alt="" className="hidden h-12 w-16 shrink-0 rounded border border-white/20 object-cover sm:block" />
              <div className="min-w-0">
                <p className="truncate font-display text-base font-extrabold uppercase italic leading-tight sm:text-lg" data-testid="party-headline">
                  {verdict(t, view, result)}
                  {team && team.hurt !== null && team.multiplier > 1 && <span className="text-[#ffd23c]">{t("reveal.multiplier", { m: multIn(t.locale, team.multiplier) })}</span>}
                </p>
                <p className="truncate text-sm text-white/80">
                  {t.rich("reveal.itWas", {
                    p: (c) => <span className="font-semibold text-white">{c}</span>,
                    g: (c) => <span className="text-white/60">{c}</span>,
                    place: placeName(result.answer, map, names),
                    game: gameName(result.answer.game, names),
                  })}
                </p>
                {view.you !== null && result.guesses[view.you] && (
                  <p className="text-xs text-white/70 md:hidden">
                    {t.rich("reveal.scored", { b: (c) => <span className="font-bold text-white">{c}</span>, score: fmt(result.guesses[view.you]!.score), place: order.indexOf(view.you) + 1 })}
                  </p>
                )}
                <div className="text-xs text-white/60 [&_button]:text-white/60 [&_button:hover]:text-white">
                  <ReportShot key={result.shot} shot={result.shot} mode="duel" />
                </div>
              </div>
            </div>
            <div className="w-full min-w-0 md:w-auto md:min-w-72 md:max-w-[26rem]">{children}</div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/** Someone without a seat while a game is on: who's playing and how it stands. */
function PartyWatch({ view, mapName }: { view: PartyView; mapName: string }) {
  const t = useT(partyNs);
  const removed = view.removed;
  return (
    <Card className="mx-auto max-w-lg" data-testid="party-watch">
      <CardContent className="space-y-4 p-6 text-center">
        <p className="hud-label text-screen">
          {t("watch.tag", { mode: t(`modes.${view.settings.mode}`), map: mapName })}
        </p>
        <p className="font-display text-2xl font-bold uppercase">{removed ? t("watch.removed") : view.status === "finished" ? t("watch.over") : t("watch.underWay", { round: view.revealed.length + 1 })}</p>
        <p className="text-sm text-muted-foreground">
          {removed
            ? t("watch.removedText")
            : view.status === "finished"
              ? t("watch.overText")
              : t("watch.underWayText", { still: view.players.filter((p) => !p.out).length, total: view.players.length })}
        </p>
        <ul className="flex flex-wrap justify-center gap-1.5">
          {view.players.map((p, s) => (
            <li key={s} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", p.out && "opacity-50")}>
              <span className="h-2 w-2 rounded-full" style={{ background: seatColor(view, s) }} aria-hidden />
              {p.name}
            </li>
          ))}
        </ul>
        <Link href="/pokeguessr#party" className={buttonVariants({ variant: "outline" })}>
          <Users className="h-4 w-4" aria-hidden /> {t("watch.start")}
        </Link>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The lobby
// ---------------------------------------------------------------------------

type SettingsPatch = Partial<PartySettings>;

function PartyLobby({
  view,
  regions,
  names,
  busy,
  onJoin,
  onSettings,
  onTeam,
  onKick,
  onStart,
  onLeave,
}: {
  view: PartyView;
  regions: GeoRegionInfo[];
  names?: GuessrNames;
  busy: boolean;
  onJoin: (name: string) => void;
  onSettings: (s: SettingsPatch) => void;
  onTeam: (team: 0 | 1, seat?: number) => void;
  onKick: (seat: number) => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const t = useT(partyNs);
  const fmt = fmtIn(t.locale);
  const progress = useProgress();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [shared, setShared] = useState<"done" | "failed" | null>(null);
  const me = view.you;
  const host = me !== null && view.host === me;
  const s = view.settings;
  const team = s.mode === "team";
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}${partyPath(view.code)}`;
  const map = regions.find((r) => r.id === s.region);
  const three = view.players.length <= MAX_3D;
  const full = view.players.length >= PARTY_MAX_PLAYERS;
  const blocked = team
    ? [0, 1].some((k) => !view.players.some((p) => p.team === k))
      ? t("lobby.needTeams")
      : [0, 1].some((k) => view.players.filter((p) => p.team === k).length > PARTY_TEAM_MAX)
        ? t("lobby.teamMax", { n: PARTY_TEAM_MAX })
        : null
    : view.players.length < 2
      ? t("lobby.needMore")
      : null;

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  async function share() {
    const outcome = await shareOrCopy(t("lobby.share", { code: view.code.toUpperCase() }), url);
    if (outcome === "failed") setShared("failed");
    else if (outcome !== "cancelled") setShared("done");
  }

  const card = (seat: number) => {
    const p = view.players[seat];
    return (
      <li key={seat} className={cn("group relative overflow-hidden rounded-lg border bg-[#1e1a3f] p-2 text-white", seat === me && "ring-2 ring-primary")} data-testid={`party-seat-${seat}`}>
        <div aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: seatColor(view, seat) }} />
        <PartyTrainer view={view} seat={seat} three={three} pose={p.quiet ? "idle" : "wave"} className={three ? "" : "[&>div:first-child]:max-w-[5rem] mx-auto"} label={p.quiet ? <span className="font-pixel text-[9px] uppercase text-warning">{t("lobby.away")}</span> : undefined} />
        {host && seat !== me && (
          <button
            type="button"
            onClick={() => onKick(seat)}
            disabled={busy}
            className="absolute right-1.5 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/70 opacity-100 transition hover:bg-[#ff5a5a] hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            aria-label={t("lobby.remove", { name: p.name })}
            title={t("lobby.remove", { name: p.name })}
            data-testid={`party-kick-${seat}`}
          >
            <UserMinus className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {team && (host || seat === me) && (
          <button
            type="button"
            onClick={() => onTeam(p.team === 0 ? 1 : 0, seat === me ? undefined : seat)}
            disabled={busy}
            className="mt-1 w-full rounded border border-white/20 py-1 font-display text-[10px] font-bold uppercase tracking-wide text-white/80 hover:bg-white/10"
            data-testid={`party-switch-${seat}`}
          >
            {p.team === 0 ? t("lobby.toBlue") : t("lobby.toRed")}
          </button>
        )}
      </li>
    );
  };
  const grid = cn("grid gap-2", three ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6");
  const seats = view.players.map((_, i) => i);

  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="party-lobby">
      <div className="space-y-3 text-center">
        <p className="hud-label text-screen">
          {t("lobby.tag", { mode: t(`modes.${s.mode}`), map: map ? mapName(map, names) : s.region })}
        </p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-6xl">{t.rich("lobby.title", { g: (c) => <span className="text-primary">{c}</span> })}</h1>
        <p className="mx-auto max-w-xl text-muted-foreground">
          {me === null
            ? t("lobby.invite", { host: view.players[view.host]?.name ?? t("aTrainer"), mode: t(`modes.${s.mode}`) })
            : host
              ? t("lobby.host")
              : t("lobby.waitingFor", { host: view.players[view.host]?.name ?? t("lobby.theHost") })}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-display text-lg font-bold uppercase">
                {t("lobby.trainers")} <span className="text-muted-foreground">{view.players.length}/{team ? PARTY_TEAM_MAX * 2 : PARTY_MAX_PLAYERS}</span>
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-shade/20 px-3 py-1.5">
                <span className="hud-label">{t("lobby.room")}</span>
                <span className="font-mono text-lg font-bold uppercase tracking-[0.25em]" data-testid="party-code">
                  {view.code}
                </span>
              </div>
            </div>
            {team ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {([0, 1] as const).map((k) => (
                  <div key={k} className="space-y-2" data-testid={`party-team-${k}`}>
                    <p className="flex items-center justify-between font-display text-sm font-bold uppercase" style={{ color: TEAM_COLORS[k] }}>
                      {t(`teams.${k}`)}
                      {me !== null && view.players[me]?.team !== k && (
                        <button type="button" onClick={() => onTeam(k)} disabled={busy} className="rounded border px-2 py-0.5 text-[10px] text-foreground hover:bg-muted" data-testid={`party-join-team-${k}`}>
                          {t("lobby.join")}
                        </button>
                      )}
                    </p>
                    <ul className="grid grid-cols-2 gap-2">{seats.filter((i) => view.players[i].team === k).map(card)}</ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className={grid}>{seats.map(card)}</ul>
            )}

            {me !== null ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input readOnly value={url} aria-label={t("lobby.link")} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-shade/20 px-3 font-mono text-xs" />
                  <Button variant="outline" onClick={() => void share()}>
                    <Link2 className="h-4 w-4" aria-hidden /> {shared === "done" ? t("lobby.copied") : t("lobby.copy")}
                  </Button>
                </div>
                {shared === "failed" && <CopyFallback text={url} />}
              </div>
            ) : full ? (
              <p className="text-center text-sm text-muted-foreground">
                {t.rich("lobby.full", {
                  link: (c) => (
                    <Link href="/pokeguessr#party" className="underline underline-offset-2">
                      {c}
                    </Link>
                  ),
                })}
              </p>
            ) : view.removed ? (
              <p className="text-center text-sm text-muted-foreground">{t("lobby.removed")}</p>
            ) : (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isCleanName(name)) onJoin(name);
                  else setNameError(t.locale === "en" ? NAME_REJECTED : t("lobby.nameRejected"));
                }}
              >
                <label htmlFor="party-join-name" className="hud-label">
                  {t("lobby.nameLabel")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="party-join-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                    maxLength={24}
                    required
                    placeholder={t("lobby.namePlaceholder")}
                    className="h-12 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button type="submit" size="lg" disabled={busy || !name.trim()} data-testid="party-join">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />}
                    {t("lobby.joinParty")}
                  </Button>
                </div>
                {nameError && (
                  <p role="alert" className="text-sm text-destructive">
                    {nameError}
                  </p>
                )}
              </form>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardContent className="space-y-4 p-4 sm:p-6" data-testid="party-settings">
            <p className="font-display text-lg font-bold uppercase">{t("lobby.game")}</p>
            <Choice label={t("lobby.mode")} value={s.mode} options={(["royale", "team"] as PartyMode[]).map((m) => ({ id: m, name: t(`modes.${m}`) }))} host={host} onPick={(mode) => onSettings({ mode })} testId="party-set-mode" />
            <div className="space-y-1.5">
              <label htmlFor="party-map" className="hud-label">
                {t("lobby.map")}
              </label>
              {host ? (
                <select
                  id="party-map"
                  value={s.region}
                  onChange={(e) => onSettings({ region: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                  data-testid="party-set-map"
                >
                  {[...regions]
                    .sort((a, b) => geoMapRank(a.id) - geoMapRank(b.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id === WORLD_REGION ? t("lobby.world") : r.theme ? t("lobby.themed", { name: mapName(r, names) }) : mapName(r, names)}
                      </option>
                    ))}
                </select>
              ) : (
                <p className="text-sm font-semibold">{map && mapName(map, names)}</p>
              )}
            </div>
            {!team && <Choice label={t("lobby.lives")} value={s.lives} options={PARTY_LIVES.map((n) => ({ id: n, name: String(n) }))} host={host} onPick={(lives) => onSettings({ lives })} testId="party-set-lives" />}
            <Choice label={t("lobby.timer")} value={s.roundSeconds} options={PARTY_ROUND_SECONDS.map((n) => ({ id: n, name: t("lobby.seconds", { n }) }))} host={host} onPick={(roundSeconds) => onSettings({ roundSeconds })} testId="party-set-timer" />
            <Choice label={t("lobby.afterPin")} value={s.countdownSeconds} options={PARTY_COUNTDOWN_SECONDS.map((n) => ({ id: n, name: t("lobby.seconds", { n }) }))} host={host} onPick={(countdownSeconds) => onSettings({ countdownSeconds })} testId="party-set-countdown" />
            <Choice label={t("lobby.rounds")} value={s.rounds} options={PARTY_ROUND_CAPS.map((n) => ({ id: n, name: String(n) }))} host={host} onPick={(rounds) => onSettings({ rounds })} testId="party-set-rounds" />
            <p className="text-xs text-muted-foreground">
              {team ? t("lobby.teamHelp", { hp: fmt(PARTY_TEAM_HP) }) : t("lobby.royaleHelp", { s: s.countdownSeconds })}
            </p>
            {me !== null &&
              (host ? (
                <div className="space-y-1.5">
                  <Button size="lg" variant="success" className="w-full" disabled={busy || !!blocked} onClick={onStart} data-testid="party-start">
                    <Play className="h-4 w-4" aria-hidden /> {t("lobby.start")}
                  </Button>
                  {blocked && <p className="text-center text-xs text-muted-foreground">{blocked}</p>}
                </div>
              ) : (
                <p className="flex items-center justify-center gap-2 rounded-md border border-dashed py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("lobby.waitHost")}
                </p>
              ))}
            {me !== null && (
              <p className="text-center text-xs text-muted-foreground">
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onLeave} data-testid="party-leave">
                  {t("lobby.leaveParty")}
                </button>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Choice<T extends string | number>({ label, value, options, host, onPick, testId }: { label: string; value: T; options: { id: T; name: string }[]; host: boolean; onPick: (v: T) => void; testId: string }) {
  return (
    <div className="space-y-1.5">
      <p className="hud-label">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={!host && value !== o.id}
            onClick={() => host && value !== o.id && onPick(o.id)}
            data-testid={`${testId}-${o.id}`}
            className={cn(
              "rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
              value === o.id ? "border-screen bg-screen/15 text-foreground" : host ? "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground" : "hidden"
            )}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The standings
// ---------------------------------------------------------------------------

function PartyEnd({ view, map, names, busy, onAgain, onTaunt }: { view: PartyView; map: GeoRegionInfo; names?: GuessrNames; busy: boolean; onAgain: () => void; onTaunt: (id: TauntId) => Promise<string | null> }) {
  const t = useT(partyNs);
  const fmt = fmtIn(t.locale);
  const ordinal = (place: number) => t("end.ordinal", { place });
  const reduced = useReducedMotion();
  const me = view.you!;
  const end = view.end!;
  const team = view.settings.mode === "team";
  const host = view.host === me;
  const place = end.places[me] ?? view.players.length;
  const won = place === 1 && (!team || end.team !== null);
  const draw = team && end.team === null;
  const taunts = usePartyTaunts(view);
  const order = view.players.map((_, s) => s).sort((a, b) => end.places[a] - end.places[b] || view.totals[b] - view.totals[a]);
  // The podium: the top three (and you, if you're not among them), in 3D.
  const podium = order.slice(0, 3);
  if (!podium.includes(me)) podium.push(me);
  const reason = team
    ? end.reason === "left"
      ? t("end.otherLeft")
      : end.reason === "hp"
        ? t("end.outOfHp", { team: t(`teams.${end.team === 0 ? 1 : 0}`) })
        : draw
          ? t("end.level")
          : t("end.moreHp", { n: view.revealed.length, team: t(`teams.${end.team ?? 0}`) })
    : end.reason === "last"
      ? end.winners.length === 1 && end.winners[0] === me
        ? t("end.lastYou")
        : t(end.winners.length === 1 ? "end.lastOne" : "end.lastMany", { names: joinNames(t, end.winners.map((s) => (s === me ? t("you") : view.players[s].name))) })
      : end.reason === "rounds"
        ? t("end.afterRounds", { n: view.revealed.length })
        : t("end.allLeft");
  // Sharing the result: words that read on their own (a bio link doesn't unfurl), then the room's link for a rematch.
  const [shared, setShared] = useState<"done" | "failed" | null>(null);
  const where = map.id === WORLD_REGION ? t("end.where") : mapName(map, names);
  const winners = end.winners.map((s) => view.players[s].name);
  const after = won ? t("end.weWon") : t("end.nextTime");
  const shareText = team
    ? draw
      ? t("end.shareDraw", { where, n: view.revealed.length })
      : view.hp
        ? t("end.shareTeamHp", { team: t(`teams.${end.team ?? 0}`), where, a: fmt(Math.max(0, view.hp[end.team ?? 0])), b: fmt(Math.max(0, view.hp[end.team === 0 ? 1 : 0])), after })
        : t("end.shareTeam", { team: t(`teams.${end.team ?? 0}`), where, after })
    : winners.length && place !== 1
      ? t("end.shareRoyaleWon", { place, n: view.players.length, where, winners: joinNames(t, winners) })
      : t("end.shareRoyale", { place, n: view.players.length, where });
  async function shareResult() {
    const outcome = await shareOrCopy(t("end.shareNext", { text: shareText }), `${window.location.origin}${partyPath(view.code)}`);
    setShared(outcome === "failed" ? "failed" : outcome === "cancelled" ? null : "done");
  }
  const allRounds: RevealedRound[] = view.revealed.flatMap((r) => {
    const g = r.guesses[me];
    return [{ guess: g && { x: g.x, y: g.y }, answer: r.answer, label: String(r.index + 1), color: seatColor(view, me), image: seatPin(view, me) }];
  });

  return (
    <div className="text-white" data-testid="party-end">
      <div className="geo-split relative overflow-hidden px-4 pb-6 pt-8 text-center sm:pt-12">
        <p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-white/70">
          {t("end.over", { mode: t(`modes.${view.settings.mode}`), map: mapName(map, names) })}
        </p>
        <motion.div
          initial={reduced ? false : { scale: 0.6, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 14 }}
          className={cn("geo-glow mt-1 flex items-center justify-center gap-3 font-display text-5xl font-extrabold uppercase italic sm:text-8xl", won ? "text-[#9be15d]" : draw ? "text-[#c8bfff]" : "text-[#ff5a5a]")}
          data-testid="party-result"
        >
          {won && <Crown className="h-10 w-10 sm:h-16 sm:w-16" aria-hidden />}
          {draw ? t("end.draw") : won ? t("end.victory") : team ? t("end.defeat") : t("end.place", { place })}
        </motion.div>
        <p className="mt-1 text-white/80">{reason}</p>
        <div className="mx-auto mt-4 flex max-w-4xl flex-wrap items-end justify-center gap-x-2 gap-y-4 sm:mt-6 sm:gap-x-6" data-testid="party-podium">
          {podium.map((s) => (
            <PartyTrainer
              key={s}
              view={view}
              seat={s}
              three
              pose={end.places[s] === 1 ? "victory" : "idle"}
              taunt={taunts.playing[s] ?? null}
              className={cn("w-[44%] max-w-[13rem] sm:w-[22%]", end.places[s] === 1 && "sm:-translate-y-4")}
              label={<span className="font-pixel text-[10px] uppercase text-[#ffd23c]">{ordinal(end.places[s])}</span>}
            />
          ))}
        </div>
        <div className="mx-auto mt-3 max-w-4xl">
          <TauntBar
            onTaunt={(id) => {
              taunts.start(me, id);
              return onTaunt(id);
            }}
          />
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-5 px-4 py-5">
        <div className="grid gap-2 sm:grid-cols-2">
          {host ? (
            <Button size="lg" variant="success" disabled={busy} onClick={onAgain} data-testid="party-again">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} {t("end.again")}
            </Button>
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-md border border-white/20 py-2.5 text-sm text-white/80">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("end.waitAgain")}
            </p>
          )}
          <Button size="lg" variant="outline" onClick={() => void shareResult()} className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" data-testid="party-share">
            {shared === "done" ? <Check className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />} {shared === "done" ? t("end.copied") : t("end.share")}
          </Button>
          <Link href="/pokeguessr" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white sm:col-span-2")}>
            <X className="h-4 w-4" aria-hidden /> {t("back")}
          </Link>
        </div>
        {shared === "failed" && <CopyFallback text={`${t("end.shareNext", { text: shareText })} ${typeof window !== "undefined" ? window.location.origin : ""}${partyPath(view.code)}`} />}

        <ol className="divide-y divide-white/10 overflow-hidden rounded-md bg-white/5" data-testid="party-standings">
          {order.map((s) => {
            const p = view.players[s];
            const outRound = view.revealed.findIndex((r) => r.out?.includes(s));
            return (
              <li key={s} className={cn("flex items-center gap-3 px-3 py-2 text-sm", s === me && "bg-white/10")} data-testid={`party-standing-${s}`}>
                <span className={cn("w-9 font-display text-base font-extrabold italic", end.places[s] === 1 ? "text-[#ffd23c]" : "text-white/70")}>{ordinal(end.places[s])}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seatColor(view, s) }} aria-hidden />
                <Avatar avatar={p.avatar} size={28} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {p.name}
                  {s === me && <span className="ml-1.5 rounded-sm bg-white/15 px-1 font-pixel text-[8px]">{t("you")}</span>}
                </span>
                <span className="hidden text-xs text-white/60 sm:inline">
                  {team ? t(`teams.${p.team ?? 0}`) : p.left ? t("end.left") : outRound >= 0 ? t("end.outIn", { n: outRound + 1 }) : <Lives lives={p.lives ?? 0} max={view.settings.lives} />}
                </span>
                <span className="w-20 text-right font-display font-bold tabular-nums">{fmt(view.totals[s] ?? 0)}</span>
              </li>
            );
          })}
        </ol>

        {allRounds.length > 0 && (
          <div className="space-y-2">
            <p className="hud-label !text-white/60">{t("end.pins")}</p>
            <div className="overflow-hidden rounded-md">
              <GeoMap region={namedMap(map, names)} revealed={allRounds} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

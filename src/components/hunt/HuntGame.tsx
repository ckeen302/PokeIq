"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import { localDateString } from "@/lib/daily";
import { play, unlockAudio } from "@/lib/sound";
import { useGuessrMusic } from "@/lib/use-guessr-music";
import { useGeoNames } from "@/lib/geo-i18n-client";
import { WORLD_REGION, type GeoRegionInfo } from "@/lib/geo-types";
import type { MapPin } from "@/components/geo/GeoMap";
import { ConfirmExit, GameShell } from "@/components/geo/GameShell";
import {
  HUNT_DAILY_FROM,
  HUNT_MAX_ROUND_SCORE,
  isHuntMapRegion,
  type HuntGuessResponse,
  type HuntMapRegionId,
  type HuntMode,
  type HuntReveal as HuntRevealData,
  type HuntRoundPublic,
  type HuntStartResponse,
} from "@/lib/hunt/types";
import { HuntHub } from "./HuntHub";
import { HuntRound } from "./HuntRound";
import { HuntReveal, type HuntRevealPin, type HuntRevealSpot } from "./HuntReveal";
import { HuntResults, type HuntResultRound } from "./HuntResults";
import { HuntState } from "./HuntState";
import type { HuntPokemonView } from "./HuntCard";
import type { HuntShareRound } from "./share";

/**
 * Pokémon Hunt's game: the state machine, the pins, the clock and the API
 * calls. The screens are hunt design's components (HuntHub, HuntRound,
 * HuntReveal, HuntResults); the frame, map dock, timer and score tracker
 * inside them are PokéGuessr's.
 *
 *   hub → starting → playing → grading → reveal → (playing …) → results
 */

type Phase = "hub" | "starting" | "playing" | "grading" | "reveal" | "results";

interface Game {
  token: string;
  mode: HuntMode;
  map: GeoRegionInfo;
  rounds: number;
  timer: number;
  daily?: { date: string; number: number };
  round: HuntRoundPublic;
}

/** A graded round, kept for the results screen and the share grid. */
interface Played {
  round: HuntRoundPublic;
  body: HuntGuessResponse;
}

const RECENT_KEY = "pokeiq:hunt-recent";
const DAILY_KEY = "pokeiq:hunt-daily";
const BEST_KEY = "pokeiq:hunt-best";
const RECENT_MAX = 60;

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: forgotten with the tab.
  }
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** The Daily Hunt's number on a date (#1 on HUNT_DAILY_FROM), as the server counts it. */
const dailyNumberOf = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${HUNT_DAILY_FROM}T00:00:00Z`)) / 86_400_000) + 1;

interface DailyRecord {
  date: string;
  score: number;
  share: HuntShareRound[];
}

const pokemonOf = (r: HuntRoundPublic): HuntPokemonView => ({ id: r.id, name: r.name, dex: r.dex, art: r.art });

/** The reveal's spots and pins as the design's components draw them (names in the page's language). */
function revealView(reveal: HuntRevealData, region: (name: string) => string): { spots: HuntRevealSpot[]; pins: HuntRevealPin[] } {
  const spots = reveal.spots.map((s) => {
    const games = [...new Set(s.methods.map((m) => m.games))];
    const methods = [...new Set(s.methods.map((m) => m.method))];
    return { x: s.pin[0], y: s.pin[1], region: region(s.region), place: s.name, game: games.join(" / "), method: methods.join(", "), mask: s.mask, labels: s.methods.map((m) => `${m.games} · ${m.method}`) };
  });
  const pins = reveal.pins.flatMap((p) => (p.spot === null ? [] : [{ pin: p.pin, spot: p.spot, score: p.score, found: p.found }]));
  return { spots, pins };
}

export function HuntGame({ maps }: { maps: GeoRegionInfo[] }) {
  const t = useT(huntNs);
  const names = useGeoNames();
  const regionName = useCallback((id: string) => names.region(id[0].toUpperCase() + id.slice(1)), [names]);

  const [phase, setPhase] = useState<Phase>("hub");
  // PokéGuessr's music plays while a hunt is on (from a mode's Play, through its rounds and their reveals), not in the menus or on the final results.
  useGuessrMusic(phase === "starting" || phase === "playing" || phase === "grading" || phase === "reveal");
  const [busyMode, setBusyMode] = useState<HuntMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [pins, setPins] = useState<(MapPin | null)[]>([null]);
  const [active, setActive] = useState(0);
  const [played, setPlayed] = useState<Played[]>([]);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmExit, setConfirmExit] = useState(false);
  const [region, setRegion] = useState<HuntMapRegionId>("kanto");
  const [today, setToday] = useState<string>(HUNT_DAILY_FROM);
  const [daily, setDaily] = useState<DailyRecord | null>(null);
  const [best, setBest] = useState<Partial<Record<HuntMode, number>>>({});
  /** The hunt just finished beat the mode's best (one before it, on this device). */
  const [newBest, setNewBest] = useState(false);
  const lastMode = useRef<HuntMode>("classic");

  // The player's date (dailies follow the local day, like every daily on the site), today's Daily if played, best totals.
  useEffect(() => {
    const date = localDateString();
    setToday(date < HUNT_DAILY_FROM ? HUNT_DAILY_FROM : date);
    const rec = read<DailyRecord | null>(DAILY_KEY, null);
    setDaily(rec?.date === date ? rec : null);
    setBest(read(BEST_KEY, {}));
  }, []);

  const mapOf = useCallback((id: string) => maps.find((m) => m.id === id) ?? maps.find((m) => m.id === WORLD_REGION)!, [maps]);
  const regionMaps = maps.filter((m) => isHuntMapRegion(m.id));

  const beginRound = (round: HuntRoundPublic, timer: number) => {
    setPins(Array.from({ length: round.pins }, () => null));
    setActive(0);
    setDeadline(Date.now() + timer * 1000);
  };

  const start = async (mode: HuntMode) => {
    unlockAudio();
    lastMode.current = mode;
    setBusyMode(mode);
    setPhase("starting");
    setError(null);
    try {
      const body = await post<HuntStartResponse>("/api/geo/hunt", {
        mode,
        ...(mode === "region" ? { region } : {}),
        ...(mode === "daily" ? { date: localDateString() } : { recent: read<string[]>(RECENT_KEY, []) }),
      });
      setGame({ token: body.token, mode: body.mode, map: mapOf(body.map), rounds: body.rounds, timer: body.timer, daily: body.daily, round: body.round });
      setPlayed([]);
      beginRound(body.round, body.timer);
      setPhase("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("state.error"));
      setPhase("hub");
    } finally {
      setBusyMode(null);
    }
  };

  // The clock.
  useEffect(() => {
    if (phase !== "playing" || deadline === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase, deadline]);
  const msLeft = phase === "playing" && deadline !== null ? Math.max(0, deadline - now) : null;

  const submitting = useRef(false);
  const submit = useCallback(
    async (timeout = false) => {
      if (!game || submitting.current) return;
      submitting.current = true;
      setPhase("grading");
      const sent = pins.filter((p): p is MapPin => !!p);
      try {
        const body = await post<HuntGuessResponse>("/api/geo/hunt/guess", { token: game.token, pins: sent, ...(timeout ? { timeout: true } : {}) });
        const all = [...played, { round: game.round, body }];
        setPlayed(all);
        setGame((cur) => (cur ? { ...cur, token: body.token } : cur));
        const recent = read<string[]>(RECENT_KEY, []);
        write(RECENT_KEY, [body.reveal.id, ...recent.filter((id) => id !== body.reveal.id)].slice(0, RECENT_MAX));
        if (body.done && body.result) {
          const prev = read<Partial<Record<HuntMode, number>>>(BEST_KEY, {});
          setNewBest(!!prev[game.mode] && body.result.score > (prev[game.mode] ?? 0));
          if (body.result.score > (prev[game.mode] ?? 0)) {
            const next = { ...prev, [game.mode]: body.result.score };
            write(BEST_KEY, next);
            setBest(next);
          }
          if (game.daily) {
            const rec: DailyRecord = { date: game.daily.date, score: body.result.score, share: shareRounds(all) };
            write(DAILY_KEY, rec);
            setDaily(rec);
          }
        }
        play(body.score >= 4000 ? "correct" : "pin");
        setPhase("reveal");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("state.error"));
        setPhase("playing");
      } finally {
        submitting.current = false;
      }
    },
    [game, pins, played, t]
  );

  // Time's up: whatever pins are down go in.
  useEffect(() => {
    if (msLeft === 0 && phase === "playing") void submit(true);
  }, [msLeft, phase, submit]);

  // Space or Enter hunts once a pin is down, as PokéGuessr's Guess (the reveal binds its own keys).
  const anyPin = pins.some(Boolean);
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.code !== "Space" && e.key !== "Enter") || !anyPin) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, button, a")) return;
      if (document.querySelector('[role="dialog"]:not([aria-hidden="true"]):not([inert])')) return;
      e.preventDefault();
      void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, anyPin, submit]);

  const next = () => {
    const last = played[played.length - 1];
    if (!game || !last) return;
    if (last.body.done || !last.body.next) {
      setPhase("results");
      return;
    }
    setGame({ ...game, round: last.body.next });
    beginRound(last.body.next, game.timer);
    setPhase("playing");
  };

  const leave = () => {
    setConfirmExit(false);
    setGame(null);
    setPhase("hub");
  };
  const requestExit = () => (phase === "playing" || phase === "grading" || phase === "reveal" ? setConfirmExit(true) : leave());

  // ---- pins: one slot per pin the round takes ---------------------------------------------
  const place = (p: MapPin) => {
    play("pin");
    setPins((cur) => {
      const nextPins = cur.map((q, i) => (i === active ? p : q));
      // On to the next empty slot; with every pin down, the active one stays (the next tap moves it again).
      const empty = nextPins.findIndex((q) => !q);
      if (empty >= 0) setActive(empty);
      return nextPins;
    });
  };
  const remove = (i: number) => {
    setPins((cur) => cur.map((q, k) => (k === i ? null : q)));
    setActive(i);
  };

  // ---- render ---------------------------------------------------------------------------
  if (phase === "hub" || (phase === "starting" && !game)) {
    return (
      <HuntHub
        regions={regionMaps}
        region={region}
        onRegion={(id) => isHuntMapRegion(id) && setRegion(id)}
        onPlay={(m) => void start(m)}
        busy={busyMode}
        daily={{ n: dailyNumberOf(today), ...(daily ? { score: daily.score } : {}) }}
        best={best}
        error={error}
      />
    );
  }
  if (!game) return null;

  const mapLabel = game.mode === "region" ? regionName(game.map.id) : t("hud.world");
  const modeLine = `${game.daily ? t("hud.daily", { n: game.daily.number }) : t("hud.mode")} · ${mapLabel}`;
  const scores = played.map((p) => p.body.score);

  if (phase === "results") {
    const rounds: HuntResultRound[] = played.map((p) => ({
      pokemon: pokemonOf(p.round),
      score: p.body.score,
      regionsFound: p.body.reveal.found,
      regionsTotal: p.body.reveal.regions.length,
      ...revealView(p.body.reveal, regionName),
    }));
    return (
      <HuntResults
        region={game.map}
        rounds={rounds}
        modeLine={modeLine}
        newBest={newBest}
        share={game.daily ? { title: t("share.daily", { n: game.daily.number }), rounds: shareRounds(played) } : undefined}
        onAgain={() => (lastMode.current === "daily" ? leave() : void start(lastMode.current))}
        onHub={leave}
      />
    );
  }

  const last = played[played.length - 1];
  return (
    <GameShell onExit={requestExit}>
      {({ fs, toggle }) => (
        <>
          {phase === "reveal" && last ? (
            <HuntReveal
              region={game.map}
              pokemon={pokemonOf(last.round)}
              {...revealView(last.body.reveal, regionName)}
              score={last.body.score}
              regionsTotal={last.body.reveal.regions.length}
              regionsFound={last.body.reveal.found}
              maxPins={last.round.pins}
              fact={last.body.reveal.fact}
              dexHref={last.body.reveal.dex}
              timedOut={last.body.timedOut}
              roundIndex={played.length - 1}
              rounds={game.rounds}
              scores={scores}
              modeLine={modeLine}
              done={last.body.done}
              onNext={next}
              onExit={requestExit}
            />
          ) : (
            <HuntRound
              region={game.map}
              pokemon={pokemonOf(game.round)}
              regions={game.round.regions}
              pins={pins}
              activePin={active}
              onPlace={place}
              onSelectPin={setActive}
              onRemovePin={remove}
              onGuess={() => void submit()}
              busy={phase === "grading"}
              roundIndex={game.round.index}
              rounds={game.rounds}
              scores={scores}
              modeLine={modeLine}
              msLeft={msLeft}
              totalMs={game.timer * 1000}
              onExit={requestExit}
              fs={fs}
              onFullscreen={toggle}
            />
          )}
          {error && phase === "playing" && <HuntState kind="error" message={error} onRetry={() => setError(null)} onBack={leave} />}
          {/* Pokémon Hunt's Daily isn't kept when it's left: the plain line ("This game won't be saved"). */}
          {confirmExit && <ConfirmExit onLeave={leave} onStay={() => setConfirmExit(false)} />}
        </>
      )}
    </GameShell>
  );
}

/** Each round's pins' points, for the share grid (no Pokémon, no places). */
function shareRounds(played: Played[]): HuntShareRound[] {
  return played.map((p) => ({ pins: p.body.reveal.pins.map((x) => x.score), pinMax: HUNT_MAX_ROUND_SCORE / Math.max(1, p.round.pins), score: p.body.score }));
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  isHuntDifficulty,
  isHuntMapRegion,
  type HuntDifficulty,
  type HuntGuessResponse,
  type HuntHint,
  type HuntHintKind,
  type HuntMode,
  type HuntReveal as HuntRevealData,
  type HuntRoundPublic,
  type HuntStartResponse,
} from "@/lib/hunt/types";
import { HuntSetup, type HuntPlay } from "./HuntSetup";
import { HuntRound } from "./HuntRound";
import { HuntReveal, type HuntRevealPin, type HuntRevealSpot } from "./HuntReveal";
import { HuntResults, type HuntResultRound } from "./HuntResults";
import { HuntState } from "./HuntState";
import { useHuntBoard } from "./HuntBoard";
import type { HuntPokemonView } from "./HuntCard";
import type { HuntShareRound } from "./share";

/**
 * Pokémon Hunt's game: the state machine, the pin, the hints, the clock and the API calls. The setup is
 * drawn where the game sits (on PokéGuessr's landing, under the Pokémon Hunt tile; or on
 * /pokeguessr/hunt); a hunt itself takes the whole window in PokéGuessr's frame, on the page's body.
 *
 *   setup → starting → playing → grading → reveal → (playing …) → results
 */

type Phase = "setup" | "starting" | "playing" | "grading" | "reveal" | "results";

interface Game {
  token: string;
  mode: HuntMode;
  map: GeoRegionInfo;
  rounds: number;
  timer: number;
  daily?: { date: string; number: number };
  difficulty: HuntDifficulty;
  practice?: boolean;
  round: HuntRoundPublic;
}

/** A graded round, kept for the results screen and the share card. */
interface Played {
  round: HuntRoundPublic;
  body: HuntGuessResponse;
}

const RECENT_KEY = "pokeiq:hunt-recent";
const DAILY_KEY = "pokeiq:hunt-daily-v2";
const BEST_KEY = "pokeiq:hunt-best-v2";
const SETUP_KEY = "pokeiq:hunt-setup";
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
}

/** The best totals kept on this device: the Daily, and each map and difficulty ("world:normal"). */
const bestKey = (mode: HuntMode, map: string, difficulty: HuntDifficulty) => (mode === "daily" ? "daily" : `${map}:${difficulty}`);

const pokemonOf = (r: HuntRoundPublic): HuntPokemonView => ({ id: r.id, name: r.name, dex: r.dex, art: r.art });

/** The reveal's spots and pin as the screens draw them (region names in the page's language). */
function revealView(reveal: HuntRevealData, region: (name: string) => string): { spots: HuntRevealSpot[]; pin: HuntRevealPin | null } {
  const spots = reveal.spots.map((s) => ({ x: s.pin[0], y: s.pin[1], region: region(s.region), place: s.name, mask: s.mask, labels: s.labels }));
  const p = reveal.pins[0];
  return { spots, pin: p && p.spot !== null ? { pin: p.pin, spot: p.spot, squares: p.squares, score: p.score } : null };
}

export function HuntGame({ maps, inline = false, onActive }: {
  /** The world map and the nine region maps. */
  maps: GeoRegionInfo[];
  /** On PokéGuessr's landing: the setup is a section of the page, opened by the Pokémon Hunt tile. */
  inline?: boolean;
  /** A hunt has started (true) or ended (false): the page under it can step aside. */
  onActive?: (on: boolean) => void;
}) {
  const t = useT(huntNs);
  const names = useGeoNames();
  const regionName = useCallback((id: string) => names.region(id[0].toUpperCase() + id.slice(1)), [names]);

  const [phase, setPhase] = useState<Phase>("setup");
  // PokéGuessr's music plays while a hunt is on (from Play, through its rounds and their reveals), not in the menus or on the final results.
  useGuessrMusic(phase === "starting" || phase === "playing" || phase === "grading" || phase === "reveal");
  const [busy, setBusy] = useState<HuntPlay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [pin, setPin] = useState<MapPin | null>(null);
  const [hints, setHints] = useState<Partial<Record<HuntHintKind, HuntHint>>>({});
  const [hintBusy, setHintBusy] = useState<HuntHintKind | null>(null);
  const [hintFailed, setHintFailed] = useState<HuntHintKind | null>(null);
  const [played, setPlayed] = useState<Played[]>([]);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmExit, setConfirmExit] = useState(false);
  const [map, setMap] = useState<string>(WORLD_REGION);
  const [difficulty, setDifficulty] = useState<HuntDifficulty>("normal");
  const [today, setToday] = useState<string | null>(null);
  const [daily, setDaily] = useState<DailyRecord | null>(null);
  const [best, setBest] = useState<Record<string, number>>({});
  /** The hunt just finished beat the best (one before it, on this device). */
  const [newBest, setNewBest] = useState(false);
  const last = useRef<HuntPlay>("free");
  const [mounted, setMounted] = useState(false);
  const board = useHuntBoard(today);

  // The player's date (dailies follow the local day, like every daily on the site), today's Daily if played, best totals, the last setup.
  useEffect(() => {
    setMounted(true);
    const date = localDateString();
    setToday(date < HUNT_DAILY_FROM ? HUNT_DAILY_FROM : date);
    const rec = read<DailyRecord | null>(DAILY_KEY, null);
    setDaily(rec?.date === date ? rec : null);
    setBest(read(BEST_KEY, {}));
    const setup = read<{ map?: string; difficulty?: string }>(SETUP_KEY, {});
    if (setup.map && (setup.map === WORLD_REGION || isHuntMapRegion(setup.map))) setMap(setup.map);
    if (isHuntDifficulty(setup.difficulty)) setDifficulty(setup.difficulty);
  }, []);
  const chooseMap = (id: string) => {
    setMap(id);
    write(SETUP_KEY, { map: id, difficulty });
  };
  const chooseDifficulty = (d: HuntDifficulty) => {
    setDifficulty(d);
    write(SETUP_KEY, { map, difficulty: d });
  };

  const active = phase !== "setup";
  useEffect(() => onActive?.(active), [active, onActive]);
  // Back at the setup after a hunt: today's board again (a score may have just gone on it).
  const wasActive = useRef(false);
  const reloadBoard = board.reload;
  useEffect(() => {
    if (!active && wasActive.current) reloadBoard();
    wasActive.current = active;
  }, [active, reloadBoard]);

  const mapOf = useCallback((id: string) => maps.find((m) => m.id === id) ?? maps.find((m) => m.id === WORLD_REGION)!, [maps]);
  const setupMaps = [mapOf(WORLD_REGION), ...maps.filter((m) => isHuntMapRegion(m.id))];

  const beginRound = (timer: number) => {
    setPin(null);
    setHints({});
    setHintFailed(null);
    setDeadline(Date.now() + timer * 1000);
  };

  const start = async (what: HuntPlay) => {
    unlockAudio();
    last.current = what;
    setBusy(what);
    setPhase("starting");
    setError(null);
    const free = what === "free";
    const hard = difficulty === "hard";
    const region = free && !hard && map !== WORLD_REGION && isHuntMapRegion(map) ? map : undefined;
    try {
      const body = await post<HuntStartResponse>("/api/geo/hunt", {
        mode: !free ? "daily" : region ? "region" : "classic",
        ...(region ? { region } : {}),
        ...(free ? { difficulty, recent: read<string[]>(RECENT_KEY, []) } : { date: localDateString() }),
      });
      setGame({ token: body.token, mode: body.mode, map: mapOf(body.map), rounds: body.rounds, timer: body.timer, daily: body.daily, difficulty: body.difficulty, practice: body.practice, round: body.round });
      setPlayed([]);
      beginRound(body.timer);
      setPhase("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("state.error"));
      setPhase("setup");
    } finally {
      setBusy(null);
    }
  };

  // The clock.
  useEffect(() => {
    if (phase !== "playing" || deadline === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase, deadline]);
  const msLeft = phase === "playing" && deadline !== null ? Math.max(0, deadline - now) : null;

  // A hint: asked of the server, which records it in the game's token (and takes its cost off the round when it's graded).
  const takeHint = async (kind: HuntHintKind) => {
    if (!game || hintBusy || hints[kind]) return;
    setHintBusy(kind);
    setHintFailed(null);
    try {
      const body = await post<{ token: string; hint: HuntHint }>("/api/geo/hunt/hint", { token: game.token, hint: kind, locale: t.locale });
      setGame((cur) => (cur ? { ...cur, token: body.token } : cur));
      setHints((cur) => ({ ...cur, [kind]: body.hint }));
      play("pin");
    } catch {
      setHintFailed(kind);
    } finally {
      setHintBusy(null);
    }
  };

  const submitting = useRef(false);
  const submit = useCallback(
    async (timeout = false) => {
      if (!game || submitting.current || hintBusy) return;
      submitting.current = true;
      setPhase("grading");
      try {
        const body = await post<HuntGuessResponse>("/api/geo/hunt/guess", { token: game.token, pins: pin ? [pin] : [], ...(timeout ? { timeout: true } : {}) });
        const all = [...played, { round: game.round, body }];
        setPlayed(all);
        setGame((cur) => (cur ? { ...cur, token: body.token } : cur));
        const recent = read<string[]>(RECENT_KEY, []);
        write(RECENT_KEY, [body.reveal.id, ...recent.filter((id) => id !== body.reveal.id)].slice(0, RECENT_MAX));
        if (body.done && body.result) {
          const key = bestKey(game.mode, game.map.id, game.difficulty);
          const prev = read<Record<string, number>>(BEST_KEY, {});
          setNewBest(!!prev[key] && body.result.score > prev[key]);
          if (body.result.score > (prev[key] ?? 0)) {
            const next = { ...prev, [key]: body.result.score };
            write(BEST_KEY, next);
            setBest(next);
          }
          if (game.daily) {
            const rec: DailyRecord = { date: game.daily.date, score: body.result.score };
            if (!game.practice) write(DAILY_KEY, rec);
            if (!game.practice || !daily) setDaily(rec);
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
    [game, pin, played, t, hintBusy, daily]
  );

  // Time's up: the pin, if it's down, goes in.
  useEffect(() => {
    if (msLeft === 0 && phase === "playing") void submit(true);
  }, [msLeft, phase, submit]);

  // Space or Enter hunts once the pin is down, as PokéGuessr's Guess (the reveal binds its own keys).
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.code !== "Space" && e.key !== "Enter") || !pin) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, button, a")) return;
      if (document.querySelector('[role="dialog"]:not([aria-hidden="true"]):not([inert])')) return;
      e.preventDefault();
      void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, pin, submit]);

  const next = () => {
    const lastPlayed = played[played.length - 1];
    if (!game || !lastPlayed) return;
    if (lastPlayed.body.done || !lastPlayed.body.next) {
      setPhase("results");
      return;
    }
    setGame({ ...game, round: lastPlayed.body.next });
    beginRound(game.timer);
    setPhase("playing");
  };

  const leave = () => {
    setConfirmExit(false);
    setGame(null);
    setPhase("setup");
    // Back on the landing: the setup the hunt was started from, in view.
    if (inline) window.setTimeout(() => document.getElementById("hunt")?.scrollIntoView({ block: "start" }), 30);
  };
  const requestExit = () => (phase === "playing" || phase === "grading" || phase === "reveal" ? setConfirmExit(true) : leave());

  const place = (p: MapPin) => {
    play("pin");
    setPin(p);
  };

  // ---- render ---------------------------------------------------------------------------
  const setup = (
    <HuntSetup
      maps={setupMaps}
      map={map}
      onMap={chooseMap}
      difficulty={difficulty}
      onDifficulty={chooseDifficulty}
      onPlay={(what) => void start(what)}
      busy={busy}
      daily={today ? { n: dailyNumberOf(today), ...(daily ? { score: daily.score } : {}) } : null}
      best={best[bestKey("classic", difficulty === "hard" ? WORLD_REGION : map, difficulty)]}
      board={board}
      error={phase === "setup" ? error : null}
    />
  );

  let screen: React.ReactNode = null;
  if (game && phase !== "setup" && phase !== "starting") {
    const mapLabel = game.mode === "region" ? regionName(game.map.id) : t("hud.world");
    const modeLine = [game.daily ? t("hud.daily", { n: game.daily.number }) : t("hud.mode"), mapLabel, game.difficulty !== "normal" ? t(`setup.level.${game.difficulty}`) : null].filter(Boolean).join(" · ");
    const scores = played.map((p) => p.body.score);
    if (phase === "results") {
      const rounds: HuntResultRound[] = played.map((p) => ({ pokemon: pokemonOf(p.round), score: p.body.score, hintCost: p.body.reveal.hintCost, ...revealView(p.body.reveal, regionName) }));
      const share: HuntShareRound[] = played.map((p) => ({ score: p.body.score }));
      const result = played[played.length - 1]?.body.result;
      screen = (
        <HuntResults
          region={game.map}
          rounds={rounds}
          modeLine={modeLine}
          newBest={newBest}
          share={game.daily ? { title: t("share.daily", { n: game.daily.number }), rounds: share } : undefined}
          daily={game.daily ? { date: game.daily.date, resultToken: result?.resultToken, practice: game.practice } : undefined}
          onAgain={() => (last.current === "daily" ? leave() : void start("free"))}
          onHub={leave}
        />
      );
    } else {
      const lastPlayed = played[played.length - 1];
      screen = (
        <GameShell onExit={requestExit}>
          {({ fs, toggle }) => (
            <>
              {phase === "reveal" && lastPlayed ? (
                <HuntReveal
                  region={game.map}
                  pokemon={pokemonOf(lastPlayed.round)}
                  {...revealView(lastPlayed.body.reveal, regionName)}
                  score={lastPlayed.body.score}
                  hintCost={lastPlayed.body.reveal.hintCost}
                  fact={lastPlayed.body.reveal.fact}
                  dexHref={lastPlayed.body.reveal.dex}
                  timedOut={lastPlayed.body.timedOut}
                  roundIndex={played.length - 1}
                  rounds={game.rounds}
                  scores={scores}
                  modeLine={modeLine}
                  done={lastPlayed.body.done}
                  onNext={next}
                  onExit={requestExit}
                />
              ) : (
                <HuntRound
                  region={game.map}
                  pokemon={pokemonOf(game.round)}
                  pin={pin}
                  onPlace={place}
                  onGuess={() => void submit()}
                  busy={phase === "grading"}
                  hints={game.round.hints}
                  taken={hints}
                  hintBusy={hintBusy}
                  hintFailed={hintFailed}
                  onHint={(k) => void takeHint(k)}
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
              {/* A hunt that's left isn't kept: the plain line ("This game won't be saved"). */}
              {confirmExit && <ConfirmExit onLeave={leave} onStay={() => setConfirmExit(false)} />}
            </>
          )}
        </GameShell>
      );
    }
  } else if (phase === "starting") {
    screen = (
      <GameShell>
        {() => <HuntState kind="loading" />}
      </GameShell>
    );
  }

  return (
    <>
      {setup}
      {/* The hunt itself: on the page's body, clear of the page's own layout (the setup keeps its place underneath). */}
      {screen && mounted && createPortal(screen, document.body)}
    </>
  );
}

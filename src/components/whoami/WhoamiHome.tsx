"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Dumbbell, KeyRound, Loader2, RotateCcw, Trophy } from "lucide-react";
import {
  WHOAMI_DEFAULT_ABILITY,
  WHOAMI_DEFAULT_POOL,
  WHOAMI_LOCK_MS,
  WHOAMI_PP,
  WHOAMI_PP_POINTS,
  WHOAMI_ROUND_MS,
  WHOAMI_SOLVE_POINTS,
  poolSettingsText,
  type WhoamiAbility,
  type WhoamiPoolSettings,
  type WhoamiSoloView,
} from "@/lib/whoami";
import { pvpHref } from "@/lib/pvp-types";
import { localDateString } from "@/lib/daily";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { unlockAudio } from "@/lib/sound";
import { sfx } from "@/lib/duel-sfx";
import { useClock } from "@/components/duel/use-duel";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PlayArea } from "./PlayArea";
import { AbilityPicker, PoolPicker, artUrl, fmt, type WhoamiDexEntry } from "./parts";

/**
 * /whoami: the daily, endless practice, and duels (with a friend, or a
 * stranger). Solo games are played through /api/whoami, which seals the
 * game (and its secret) in a token the browser carries.
 */

const KEY = "pokeiq-whoami";
interface Saved {
  best?: number;
  daily?: Record<string, { score: number; asked: number }>;
  pool?: WhoamiPoolSettings;
  ability?: WhoamiAbility;
}
function load(): Saved {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}
function save(patch: Partial<Saved>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch }));
  } catch {
    // Private mode: nothing is kept.
  }
}

async function post(body: Record<string, unknown>): Promise<{ state: string; view: WhoamiSoloView }> {
  const res = await fetch("/api/whoami", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as { state: string; view: WhoamiSoloView };
}

/** Pool sizes by settings, worked out from the dex the page sends (the curated set with each Pokémon's generation and legendary flag). */
function poolSize(gens: Map<number, [number, boolean]>, s: WhoamiPoolSettings) {
  let n = 0;
  for (const [g, legend] of gens.values()) if (g >= s.from && g <= s.to && !(s.casual && legend)) n++;
  return n;
}

export function WhoamiHome({ dex, meta }: { dex: WhoamiDexEntry[]; meta: [number, number, boolean][] }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(dex.map((e) => [e[0], e])), [dex]);
  const gens = useMemo(() => new Map(meta.map(([id, g, l]) => [id, [g, l] as [number, boolean]])), [meta]);
  const [saved, setSaved] = useState<Saved>({});
  const [pool, setPool] = useState<WhoamiPoolSettings>(WHOAMI_DEFAULT_POOL);
  const [ability, setAbility] = useState<WhoamiAbility>(WHOAMI_DEFAULT_ABILITY);
  const [game, setGame] = useState<{ state: string; view: WhoamiSoloView; offset: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const today = localDateString();

  useEffect(() => {
    const s = load();
    setSaved(s);
    if (s.pool) setPool(s.pool);
    if (s.ability) setAbility(s.ability);
  }, []);

  async function start(mode: "daily" | "practice") {
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const sent = Date.now();
      const out = await post({ action: "start", mode, ...(mode === "daily" ? { date: today } : { settings: pool }) });
      setGame({ ...out, offset: out.view.now - (sent + Date.now()) / 2 });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a game.");
    } finally {
      setBusy(false);
    }
  }

  const size = poolSize(gens, pool);
  const played = saved.daily?.[today];

  if (game) {
    return (
      <SoloGame
        key={game.state.slice(0, 16)}
        game={game}
        dex={byId}
        onUpdate={(state, view) => setGame((g) => g && { ...g, state, view })}
        onDone={(view) => {
          const score = view.score ?? 0;
          const patch: Partial<Saved> = {};
          if (score > (saved.best ?? 0)) patch.best = score;
          if (view.mode === "daily" && view.date && !saved.daily?.[view.date]) patch.daily = { ...saved.daily, [view.date]: { score, asked: view.known.filter((k) => k.via === "ask").length } };
          if (Object.keys(patch).length) {
            save(patch);
            setSaved((s) => ({ ...s, ...patch }));
          }
        }}
        best={saved.best}
        onExit={() => setGame(null)}
        onAgain={() => void start("practice")}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3 text-center">
        <p className="hud-label text-screen">Deduction race</p>
        <h1 className="font-display text-5xl font-bold uppercase tracking-tight sm:text-6xl">
          Who Am <span className="text-primary">I?</span>
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          A secret Pokémon. {WHOAMI_PP} PP of yes/no questions. Every answer strikes Pokémon off the grid; name it before the clock runs out. Broad questions cost 10 PP, sharp ones 20 to 25, and every PP you save is worth {WHOAMI_PP_POINTS} points.
        </p>
        {saved.best ? (
          <p className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
            <Trophy className="h-4 w-4 text-warning" aria-hidden /> Personal best <b className="tabular-nums">{fmt(saved.best)}</b>
          </p>
        ) : null}
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-screen/40">
          <CardContent className="space-y-3 p-6">
            <p className="hud-label flex items-center gap-1.5 text-screen">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Daily
            </p>
            <p className="font-display text-2xl font-bold uppercase">Today&apos;s Who Am I?</p>
            <p className="text-sm text-muted-foreground">The same Pokémon for everyone today, from every generation. One go a day: compare scores with your friends.</p>
            {played ? (
              <p className="rounded-md border bg-shade/20 p-3 text-sm" data-testid="whoami-daily-done">
                Played: <b>{played.score ? `${fmt(played.score)} points` : "not solved"}</b> after {played.asked} questions. Come back tomorrow.
              </p>
            ) : (
              <Button size="lg" className="w-full" disabled={busy} onClick={() => void start("daily")} data-testid="whoami-daily">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarDays className="h-4 w-4" aria-hidden />} Play today&apos;s
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="hud-label flex items-center gap-1.5 text-primary">
              <Dumbbell className="h-3.5 w-3.5" aria-hidden /> Practice
            </p>
            <p className="font-display text-2xl font-bold uppercase">Endless practice</p>
            <PoolPicker
              value={pool}
              size={size}
              onChange={(p) => {
                setPool(p);
                save({ pool: p });
              }}
            />
            <Button size="lg" variant="outline" className="w-full" disabled={busy || size < 12} onClick={() => void start("practice")} data-testid="whoami-practice">
              <Dumbbell className="h-4 w-4" aria-hidden /> {size < 12 ? "Too few Pokémon" : "Start practice"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <NewDuelCard
        body={{ kind: "whoami", settings: pool, ability }}
        href={(c) => pvpHref("whoami", c)}
        match={{ game: "whoami", ...pool, ability }}
        heading="Head to head · Who Am I?"
        blurb={`The same secret for both of you, best of three rounds. Sealed clues drop every 40 s: bid PP for them, blind. Bring one trainer ability. Pool: ${poolSettingsText(pool)} (${fmt(size)} Pokémon).`}
      >
        <AbilityPicker
          value={ability}
          onChange={(a) => {
            setAbility(a);
            save({ ability: a });
          }}
        />
      </NewDuelCard>

      <form
        className="mx-auto flex max-w-md items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim().toLowerCase();
          if (DUEL_CODE_RE.test(c)) router.push(pvpHref("whoami", c));
          else setError("A duel code is 8 letters and numbers.");
        }}
      >
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Have a duel code?"
          aria-label="Duel code"
          maxLength={8}
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm"
        />
        <Button type="submit" variant="outline" disabled={!code.trim()}>
          Join
        </Button>
      </form>

      <Card>
        <CardContent className="grid gap-4 p-6 text-sm text-muted-foreground sm:grid-cols-3">
          <p>
            <span className="hud-label mb-1.5 block text-screen">Ask</span>
            Type, generation, colour, size, base stats, abilities and moves. The server answers truthfully, and the grid strikes out everything that doesn&apos;t fit.
          </p>
          <p>
            <span className="hud-label mb-1.5 block text-screen">Guess</span>
            Pick a Pokémon from the grid. A wrong guess costs no PP, but locks you out for {WHOAMI_LOCK_MS / 1000} s. At 0 PP you can only guess.
          </p>
          <p>
            <span className="hud-label mb-1.5 block text-screen">Score</span>
            {fmt(WHOAMI_SOLVE_POINTS)} for the solve, plus {WHOAMI_PP_POINTS} for every PP left. {WHOAMI_ROUND_MS / 60_000} minutes on the clock.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SoloGame({
  game,
  dex,
  best,
  onUpdate,
  onDone,
  onExit,
  onAgain,
}: {
  game: { state: string; view: WhoamiSoloView; offset: number };
  dex: Map<number, WhoamiDexEntry>;
  best?: number;
  onUpdate: (state: string, view: WhoamiSoloView) => void;
  onDone: (view: WhoamiSoloView) => void;
  onExit: () => void;
  onAgain: () => void;
}) {
  const now = useClock() + game.offset;
  const { view, state } = game;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const over = !!view.answer;
  const timeUp = now >= view.endsAt;

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const out = await post({ ...body, state });
      onUpdate(out.state, out.view);
      return out.view;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Time's up: ask the server who it was.
  useEffect(() => {
    if (timeUp && !over) void act({ action: "view" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp, over]);
  useEffect(() => {
    if (over) onDone(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  if (over) {
    const a = view.answer!;
    const solved = view.score !== undefined;
    return (
      <Card className="mx-auto max-w-xl" data-testid="whoami-result">
        <CardContent className="space-y-4 p-8 text-center">
          <p className="hud-label text-screen">{view.mode === "daily" ? `Daily · ${view.date}` : "Practice"}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artUrl(a.id)} alt={a.name} className="mx-auto h-48 w-48 object-contain" />
          <p className="font-display text-4xl font-bold uppercase">I&apos;m {a.name}!</p>
          <p className="text-sm text-muted-foreground">The {a.genus}</p>
          {solved ? (
            <p className="font-display text-3xl font-bold text-success" data-testid="whoami-score">
              {fmt(view.score!)} points
            </p>
          ) : (
            <p className="font-display text-2xl font-bold text-destructive">Out of time</p>
          )}
          <p className="text-sm text-muted-foreground">
            {view.known.filter((k) => k.via === "ask").length} questions · {view.wrong.length} wrong guesses · {view.pp} PP left
            {solved && best !== undefined && view.score! >= best ? " · new personal best!" : best ? ` · best ${fmt(best)}` : ""}
          </p>
          <div className="flex justify-center gap-2">
            <Button onClick={onAgain}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Practice again
            </Button>
            <Button variant="outline" onClick={onExit}>
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-display text-2xl font-bold uppercase">
          Who Am <span className="text-primary">I?</span>
        </p>
        <span className="hud-label">{view.mode === "daily" ? `Daily · ${view.date}` : `Practice · ${poolSettingsText(view.settings)}`}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onExit}>
          Give up
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
      <PlayArea
        pool={view.pool}
        mine={view}
        dex={dex}
        now={now}
        endsAt={view.endsAt}
        done={view.solvedAt !== undefined}
        busy={busy}
        onAsk={(q) => {
          unlockAudio();
          void act({ action: "ask", q }).then((v) => v && sfx(v.known.at(-1)?.yes ? "correct" : "click"));
        }}
        onGuess={(id) => {
          unlockAudio();
          void act({ action: "guess", pokemon: id }).then((v) => v && sfx(v.solvedAt !== undefined ? "fanfare" : "wrong"));
        }}
      />
    </div>
  );
}

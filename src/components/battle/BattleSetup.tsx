"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Radio, Swords, UserSearch, X } from "lucide-react";
import { CPU_LEVEL_INFO, CPU_LEVELS, PLAY_FORMAT_INFO, PLAY_FORMATS, battleHref, type BattleSeatResponse, type CpuLevel, type PlayFormatId, type StandardFormatId } from "@/lib/battle/play";
import { saveBattleSeat } from "@/lib/battle/seat";
import { ensureBattleId } from "@/lib/battle/replay-client";
import { isLadderFormat } from "@/lib/battle/ladder";
import { useLadderStanding } from "@/lib/battle/ladder-client";
import { GlickoBadge } from "./GlickoBadge";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clock } from "@/components/duel/DuelParts";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { cn } from "@/lib/utils";
import { TeamPick, type TeamSource } from "./TeamPick";
import { CustomRulesEditor, RulesVerdictNote, useRulesCheck } from "./CustomRulesEditor";
import { challengeToBattle } from "@/lib/friends-client";
import { DEFAULT_CUSTOM_RULES, builderFormatFor, customName, lastCustomRules, rememberCustomRules, type CustomRules } from "@/lib/battle/custom-rules";

/**
 * Starting a battle: against the computer (pick a level), against whoever is
 * searching for the same format right now ("Find an opponent"), or a friend
 * (an invite link), in a random format or one you bring a team to.
 */

/** cpu: the computer. match: matchmaking. pvp: a friend, through an invite link. */
export type Opponent = "cpu" | "match" | "pvp";

/** The last battle against the computer, so "Play again" can start the same one. */
const LAST_KEY = "pokeiq:battle:last-cpu";

export interface CpuSetup {
  name: string;
  format: PlayFormatId;
  level: CpuLevel;
  team?: string;
  /** Custom rules (format "custom"). */
  rules?: CustomRules;
}

export function rememberCpuSetup(setup: CpuSetup) {
  try {
    window.sessionStorage.setItem(LAST_KEY, JSON.stringify(setup));
  } catch {
    // "Play again" then goes back to the setup page
  }
}

export function lastCpuSetup(): CpuSetup | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as CpuSetup) : null;
  } catch {
    return null;
  }
}

/** Device time, ticking twice a second while `on`. */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/** Starts a battle; returns its page, or throws with the server's reason. */
export async function startBattle(
  body: { mode: "cpu" | "pvp" } & Omit<CpuSetup, "level"> & { level?: CpuLevel; public?: boolean; hidden?: boolean; timer?: boolean; timeoutLoses?: boolean }
): Promise<string> {
  const rankedId = (await ensureBattleId()) ?? undefined;
  const res = await fetch("/api/battle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, rankedId }) });
  const data = (await res.json().catch(() => ({}))) as Partial<BattleSeatResponse> & { error?: string };
  if (!res.ok || !data.code || !data.token) throw new Error(data.error ?? `Request failed (${res.status})`);
  saveBattleSeat(data.code, data.token);
  if (body.rules) rememberCustomRules(body.rules);
  if (body.mode === "cpu") rememberCpuSetup({ name: body.name, format: body.format, level: body.level ?? "normal", team: body.team, rules: body.rules });
  return battleHref(body.mode, data.code);
}

/** A labelled on/off switch with a line of help. */
export function Toggle({ checked, onChange, label, hint, testId, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; hint?: string; testId?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-md border bg-card px-3 py-2", checked && "border-primary/60", disabled && "cursor-not-allowed opacity-50")}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 inline-block h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
          checked ? "bg-primary" : "bg-foreground/20"
        )}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]", checked ? "left-[1.125rem]" : "left-0.5")} />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-sm font-bold uppercase">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Live battles add the Battle Factory: both trainers rent a team. */
const LIVE_FORMATS: readonly PlayFormatId[] = [...PLAY_FORMATS, "factory"];

const OPPONENTS = [
  ["cpu", Bot, "Computer", "Battle a computer opponent, right now."],
  ["match", UserSearch, "Find an opponent", "Get paired with a trainer searching for the same format, and battle live."],
  ["pvp", Radio, "A friend", "Get an invite link and battle live, with a turn timer."],
] as const;

/** `challenge`: a friend's account name; a friend battle is sent to them as a challenge once it's open. */
export function BattleSetup({ initial = "cpu", challenge }: { initial?: Opponent; challenge?: string }) {
  const router = useRouter();
  const progress = useProgress();
  const id = useId();
  const [opponent, setOpponent] = useState<Opponent>(initial);
  const [format, setFormat] = useState<PlayFormatId>("gen9randombattle");
  const [level, setLevel] = useState<CpuLevel>("normal");
  const [team, setTeam] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<CustomRules>(DEFAULT_CUSTOM_RULES);
  /** Friend battles: listed in the Watch lobby (off: only people with the link can watch). */
  const [watchable, setWatchable] = useState(false);
  /** Friend battles: the turn timer runs from the start (off: either player can start it). */
  const [timerOn, setTimerOn] = useState(true);
  /** Friend battles: Showdown's rule, running out the clock once loses (off: the timer moves for you; twice loses). */
  const [timeoutLoses, setTimeoutLoses] = useState(true);
  /** Find an opponent: the format's ranked queue (paired by rating) instead of the casual one. */
  const [ranked, setRanked] = useState(false);
  const ladder = useLadderStanding(opponent === "match" && isLadderFormat(format) ? (format as StandardFormatId) : null);
  const custom = format === "custom";
  const info = PLAY_FORMAT_INFO[format];
  const formatName = custom ? customName(rules) : info.name;
  const needsTeam = !info.random;
  const verdict = useRulesCheck(custom ? rules : null, custom ? team : "");
  const rulesBroken = verdict?.state === "bad" && verdict.errors.length > 0;
  const teamSource = useMemo<TeamSource | undefined>(
    () =>
      custom
        ? {
            name: customName(rules),
            short: `Gen ${rules.gen}`,
            saved: builderFormatFor(rules.gen),
            quick: { rules },
            quickNote: `Random-battle sets from Gen ${rules.gen}, checked against your rules.`,
          }
        : undefined,
    [custom, rules]
  );

  // The last custom ruleset, remembered on this device.
  useEffect(() => setRules(lastCustomRules()), []);
  // Matchmaking keeps to the standard formats (and the Factory); Factory runs vs the computer have their own page.
  useEffect(() => {
    if ((opponent === "match" && format === "custom") || (opponent === "cpu" && format === "factory")) setFormat("gen9randombattle");
  }, [opponent, format]);
  const rankedOn = opponent === "match" && ranked && isLadderFormat(format) && ladder.status !== "off";
  const settings = useMemo(() => ({ format, ranked: rankedOn }), [format, rankedOn]);
  const finder = useMatchmaking(settings, { endpoint: "/api/battle/match", save: saveBattleSeat });
  const searching = finder.searching;
  const now = useTicker(searching);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const onTeam = useCallback((t: string) => setTeam(t), []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isCleanName(name)) return setError(NAME_REJECTED);
    if (opponent === "match") {
      // Searches until paired; the battle has started by the time it's found.
      const rankedId = (await ensureBattleId()) ?? undefined;
      void finder.search(name.trim(), { ...(needsTeam ? { team } : {}), rankedId });
      return;
    }
    unlockAudio();
    setBusy(true);
    try {
      const href = await startBattle({
        mode: opponent,
        name: name.trim(),
        format,
        level: opponent === "cpu" ? level : undefined,
        team: needsTeam ? team : undefined,
        rules: custom ? rules : undefined,
        ...(opponent === "pvp" ? { public: watchable, timer: timerOn, timeoutLoses } : {}),
      });
      if (!progress?.name) setTrainerName(name.trim());
      if (challenge && opponent === "pvp") await challengeToBattle(challenge, href.split("/").pop()!).catch(() => undefined);
      router.push(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a battle.");
      setBusy(false);
    }
  }

  const problem = error ?? finder.error;

  return (
    <form onSubmit={start} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {/* Opponent */}
        <fieldset className="space-y-2" disabled={searching}>
          <legend className="hud-label mb-2">Opponent</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {OPPONENTS.map(([value, Icon, title, blurb]) => (
              <label
                key={value}
                className={cn("menu-item hud flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4", opponent === value && "border-primary ring-1 ring-primary")}
                data-selected={opponent === value}
              >
                <input type="radio" name={`${id}-opponent`} value={value} checked={opponent === value} onChange={() => setOpponent(value)} className="sr-only" />
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="block font-display font-bold uppercase">{title}</span>
                  <span className="block text-sm text-muted-foreground">{blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Format */}
        <fieldset className="space-y-2" disabled={searching}>
          <legend className="hud-label mb-2">Format</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(opponent === "cpu" ? PLAY_FORMATS : LIVE_FORMATS).map((f) => (
              <label
                key={f}
                className={cn("flex cursor-pointer flex-col gap-1 rounded-md border bg-card px-3 py-2.5 hover:border-screen/60", format === f && "border-primary ring-1 ring-primary")}
              >
                <input type="radio" name={`${id}-format`} value={f} checked={format === f} onChange={() => setFormat(f)} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold uppercase">{PLAY_FORMAT_INFO[f].name}</span>
                  <span className="hud-label text-screen">{PLAY_FORMAT_INFO[f].random ? "Random" : "Your team"}</span>
                </span>
                <span className="text-xs text-muted-foreground">{PLAY_FORMAT_INFO[f].gameType === "doubles" ? "Doubles. " : ""}{PLAY_FORMAT_INFO[f].random ? PLAY_FORMAT_INFO[f].blurb : "Bring a team: saved, built here, or a quick one."}</span>
              </label>
            ))}
            {opponent !== "match" && (
              <label
                className={cn("flex cursor-pointer flex-col gap-1 rounded-md border border-dashed bg-card px-3 py-2.5 hover:border-screen/60", custom && "border-solid border-primary ring-1 ring-primary")}
                data-testid="format-custom"
              >
                <input type="radio" name={`${id}-format`} value="custom" checked={custom} onChange={() => setFormat("custom")} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold uppercase">Custom rules</span>
                  <span className="hud-label text-screen">Gen 1–9</span>
                </span>
                <span className="text-xs text-muted-foreground">{PLAY_FORMAT_INFO.custom.blurb}</span>
              </label>
            )}
          </div>
        </fieldset>

        {opponent === "cpu" && (
          <p className="text-xs text-muted-foreground" data-testid="frontier-links">
            Looking for a streak? Rent a team in the{" "}
            <Link href="/battle/factory" className="font-semibold text-foreground underline-offset-2 hover:underline">
              Battle Factory
            </Link>{" "}
            or climb the{" "}
            <Link href="/battle/tower" className="font-semibold text-foreground underline-offset-2 hover:underline">
              Battle Tower
            </Link>
            .
          </p>
        )}

        {custom && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <CustomRulesEditor rules={rules} onChange={setRules} live={opponent === "pvp"} />
              <RulesVerdictNote verdict={verdict} />
            </CardContent>
          </Card>
        )}

        {opponent === "cpu" && (
          <fieldset className="space-y-2">
            <legend className="hud-label mb-2">Computer level</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {CPU_LEVELS.map((l) => (
                <label key={l} className={cn("flex cursor-pointer flex-col gap-1 rounded-md border bg-card px-3 py-2.5 hover:border-screen/60", level === l && "border-primary ring-1 ring-primary")}>
                  <input type="radio" name={`${id}-level`} value={l} checked={level === l} onChange={() => setLevel(l)} className="sr-only" />
                  <span className="font-display text-sm font-bold uppercase">{CPU_LEVEL_INFO[l].name}</span>
                  <span className="text-xs text-muted-foreground">{CPU_LEVEL_INFO[l].blurb}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {needsTeam && (
          <fieldset disabled={searching} className={cn(searching && "opacity-60")}>
            <Card>
              <CardContent className="p-4">
                <TeamPick key={custom ? `custom:${rules.gen}:${rules.level}:${rules.levelMode}:${rules.teamSize}` : format} format={format} onChange={onTeam} idPrefix={id} source={teamSource} />
              </CardContent>
            </Card>
          </fieldset>
        )}
      </div>

      <Card className="h-fit border-primary/40 lg:sticky lg:top-20">
        <CardContent className="space-y-4 p-6">
          <p className="hud-label flex items-center gap-1.5 text-primary">
            <Swords className="h-3.5 w-3.5" aria-hidden /> {opponent === "cpu" ? "Battle the computer" : opponent === "match" ? "Battle anyone" : "Battle a friend"}
          </p>
          <p className="font-display text-2xl font-bold uppercase leading-tight">{formatName}</p>
          <p className="text-sm text-muted-foreground">
            {opponent === "cpu"
              ? `${CPU_LEVEL_INFO[level].name} computer. ${info.random ? "Random teams for both of you." : "It brings its own team."}`
              : opponent === "match"
                ? `You'll be paired with the next trainer searching for ${info.name}, and the battle starts at once.${info.random ? " Teams are random." : " You each bring your own team."}`
                : challenge
                  ? `${challenge} gets your challenge at once (and you get the link too). The battle starts when you're both ready.`
                  : "You'll get a link to send. The battle starts when you're both ready."}
          </p>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="hud-label">
              Your trainer name
            </label>
            <input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              required
              disabled={searching}
              placeholder="Trainer name"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {opponent === "match" && isLadderFormat(format) && (
            <div className="space-y-2" data-testid="ranked-option">
              <Toggle
                checked={rankedOn}
                onChange={setRanked}
                disabled={searching || ladder.status === "off"}
                label="Ranked"
                hint={ladder.status === "off" ? "Ranked battles open soon." : "Paired by rating on the ladder. A forfeit or leaving counts as a loss."}
                testId="ranked-toggle"
              />
              {rankedOn && ladder.status === "ready" && (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {ladder.you && ladder.you.games > 0 ? <GlickoBadge rating={ladder.you.rating} rd={ladder.you.rd} gxe={ladder.you.gxe} size="sm" /> : <span>Unrated: you start at 1500 ± 350.</span>}
                  <Link href={`/battle/ladder?format=${format}`} className="underline-offset-2 hover:text-foreground hover:underline">
                    Ladder
                  </Link>
                </p>
              )}
            </div>
          )}
          {opponent === "pvp" && (
            <div className="space-y-2">
              <Toggle checked={watchable} onChange={setWatchable} label="Let anyone watch" hint="List it in Watch live. Off: only people with the link can watch." testId="let-anyone-watch" />
              <Toggle checked={timerOn} onChange={setTimerOn} label="Turn timer" hint="Off: either of you can start it mid-battle." testId="timer-on" />
              <Toggle
                checked={timeoutLoses}
                onChange={setTimeoutLoses}
                label="Lose on timeout"
                hint="On, as on Showdown: run out of time and you lose (VGC-timer formats make a default move while you still have time in the bank). Off: the timer picks a move for you, and a second timeout in a row loses."
                testId="timeout-loses"
              />
            </div>
          )}
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          {searching ? (
            <div className="space-y-2 rounded-md border border-screen/40 bg-screen/[0.06] p-3 text-center" role="status" data-testid="battle-searching">
              <p className="flex items-center justify-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-screen">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {rankedOn ? "Searching for a ranked rival…" : "Searching for an opponent…"}
              </p>
              <p className="font-pixel text-xs tabular-nums text-muted-foreground">{clock(now - (finder.since ?? now))}</p>
              <Button type="button" size="sm" variant="ghost" onClick={finder.cancel}>
                <X className="h-3.5 w-3.5" aria-hidden /> Cancel
              </Button>
            </div>
          ) : (
            <Button type="submit" size="lg" className="w-full" disabled={busy || !name.trim() || (needsTeam && !team) || rulesBroken}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : opponent === "match" ? (
                <UserSearch className="h-4 w-4" aria-hidden />
              ) : (
                <Swords className="h-4 w-4" aria-hidden />
              )}
              {opponent === "cpu" ? "Start battle" : opponent === "match" ? "Find an opponent" : challenge ? `Challenge ${challenge}` : "Create battle"}
            </Button>
          )}
          {!searching && !busy && (!name.trim() || (needsTeam && !team)) && (
            <p className="text-center text-xs text-muted-foreground" data-testid="setup-why-disabled">
              {!name.trim() ? "Enter a trainer name to start." : "Pick a team, or a quick one, to start."}
            </p>
          )}
          {opponent === "match" && !searching && <p className="text-center text-xs text-muted-foreground">Leaving this page or closing the tab ends the search.</p>}
        </CardContent>
      </Card>
    </form>
  );
}

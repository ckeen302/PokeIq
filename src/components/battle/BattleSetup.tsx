"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { Bot, Loader2, Radio, Swords, UserSearch, X } from "lucide-react";
import { CPU_LEVELS, GROUP_FORMATS, GUEST_TRAINER, PLAY_FORMAT_INFO, PLAY_FORMATS, playerCount, type CpuLevel, type PlayFormatId, type StandardFormatId } from "@/lib/battle/play";
import { saveBattleSeat } from "@/lib/battle/seat";
import { ensureBattleId } from "@/lib/battle/replay-client";
import { isLadderFormat } from "@/lib/battle/ladder";
import { useLadderStanding } from "@/lib/battle/ladder-client";
import { GlickoBadge } from "./GlickoBadge";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { setTrainerName, useProgress } from "@/lib/progress";
import { useAccount } from "@/lib/account";
import { unlockAudio } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clock } from "@/components/duel/DuelParts";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { cn } from "@/lib/utils";
import { preloadAvatar3D } from "@/components/trainer3d/Avatar3D";
import { TeamPick, type TeamSource } from "./TeamPick";
import { startBattle } from "./start-battle";

// Starting a battle lives in its own module, so pages that only start one (the battle hub) don't load this setup screen.
export { lastCpuSetup, rememberCpuSetup, startBattle, type CpuSetup } from "./start-battle";
import { CustomRulesEditor, RulesVerdictNote, useRulesCheck } from "./CustomRulesEditor";
import { challengeToBattle } from "@/lib/friends-client";
import { DEFAULT_CUSTOM_RULES, builderFormatFor, lastCustomRules, type CustomRules } from "@/lib/battle/custom-rules";
import { useT } from "@/i18n/client";
import setupNs from "@/messages/battle-setup";
import formats from "@/messages/battle-formats";
import { cpuLevelBlurb, cpuLevelName, customRulesName, formatBlurb, formatName, formatShort, gameTypeLabel } from "@/lib/battle/format-labels";

/**
 * Starting a battle: against the computer (pick a level), against whoever is
 * searching for the same format right now ("Find an opponent"), or a friend
 * (an invite link), in a random format or one you bring a team to.
 */

/** cpu: the computer. match: matchmaking. pvp: a friend, through an invite link. */
export type Opponent = "cpu" | "match" | "pvp";

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

/** What the computer plays in a four-player battle against it (fourCpu.*): the four-trainer game types. */
type FourType = keyof typeof setupNs.en.fourCpu;

const OPPONENTS = [
  ["cpu", Bot],
  ["match", UserSearch],
  ["pvp", Radio],
] as const;

/** `challenge`: a friend's account name; a friend battle is sent to them as a challenge once it's open. */
export function BattleSetup({ initial = "cpu", challenge }: { initial?: Opponent; challenge?: string }) {
  const t = useT(setupNs);
  const tf = useT(formats);
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
  const account = useAccount();
  /** Ranked needs an account, as on Showdown (a guest can still battle casually). */
  const needsAccount = account.status === "ready" && !account.user;
  const ladder = useLadderStanding(opponent === "match" && isLadderFormat(format) ? (format as StandardFormatId) : null);
  const custom = format === "custom";
  const info = PLAY_FORMAT_INFO[format];
  const shownName = custom ? customRulesName(tf, rules) : formatName(tf, format);
  const four = playerCount(info.gameType) === 4;
  const group = (GROUP_FORMATS as readonly string[]).includes(format);
  // A random Showdown format (custom rules, "Showdown format") deals the teams itself.
  const needsTeam = !info.random && !(custom && rules.baseRandom);
  const verdict = useRulesCheck(custom ? rules : null, custom ? team : "");
  const rulesBroken = verdict?.state === "bad" && verdict.errors.length > 0;
  const teamSource = useMemo<TeamSource | undefined>(
    () =>
      custom
        ? {
            name: customRulesName(tf, rules),
            short: t("shortGen", { gen: rules.gen }),
            saved: builderFormatFor(rules.gen),
            quick: { rules },
            quickNote: t("quickNoteCustom", { gen: rules.gen }),
          }
        : group
          ? { name: formatName(tf, format), short: formatShort(tf, format), saved: null, quick: { format }, quickNote: t("quickNoteFormat", { format: formatName(tf, format) }) }
          : undefined,
    [custom, rules, group, format, t, tf]
  );

  // The last custom ruleset, remembered on this device.
  useEffect(() => setRules(lastCustomRules()), []);
  // The versus intro's 3D trainers come up right after a battle starts: their code is fetched now.
  useEffect(() => preloadAvatar3D(), []);
  // While the trainer picks a format: fetch the battle id, and wake the battle
  // functions (a code that can't exist is a cheap 404) so Start isn't a cold start.
  useEffect(() => {
    void ensureBattleId();
    const id = window.setTimeout(() => {
      // The bodies are read so the browser closes the requests (an unread body keeps one open).
      for (const url of ["/api/battle", "/api/battle/warm-up"]) void fetch(url, { cache: "no-store" }).then((r) => r.text()).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(id);
  }, []);
  // Matchmaking keeps to the standard formats (and the Factory); Factory runs vs the computer have their own page.
  useEffect(() => {
    if ((opponent === "match" && format === "custom") || (opponent === "cpu" && format === "factory")) setFormat("gen9randombattle");
  }, [opponent, format]);
  const rankedOn = opponent === "match" && ranked && isLadderFormat(format) && ladder.status !== "off" && !needsAccount;
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
    // Against the computer a name is optional: a first battle is one tap.
    const who = name.trim() || (opponent === "cpu" ? GUEST_TRAINER : "");
    if (!isCleanName(who)) return setError(t.locale === "en" ? NAME_REJECTED : t("nameRejected"));
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
        name: who,
        format,
        level: opponent === "cpu" ? level : undefined,
        team: needsTeam ? team : custom ? "random" : undefined,
        rules: custom ? rules : undefined,
        ...(opponent === "pvp" ? { public: watchable, timer: timerOn, timeoutLoses } : {}),
      });
      if (!progress?.name && name.trim()) setTrainerName(name.trim());
      if (challenge && opponent === "pvp") await challengeToBattle(challenge, href.split("/").pop()!).catch(() => undefined);
      router.push(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("startFailed"));
      setBusy(false);
    }
  }

  const problem = error ?? finder.error;
  const blocked = busy || (!name.trim() && opponent !== "cpu") || (needsTeam && !team) || rulesBroken;
  const startLabel = opponent === "cpu" ? t("start.cpu") : opponent === "match" ? t("start.match") : challenge ? t("start.challenge", { name: challenge }) : t("start.pvp");

  // Phones: the page is long (every format, then the levels), so while the Start button is off screen a bar along the bottom carries it.
  const [submitEl, setSubmitEl] = useState<HTMLButtonElement | null>(null);
  const [submitSeen, setSubmitSeen] = useState(true);
  useEffect(() => {
    if (!submitEl || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver(([entry]) => setSubmitSeen(entry.isIntersecting));
    seen.observe(submitEl);
    return () => seen.disconnect();
  }, [submitEl]);

  return (
    <form onSubmit={start} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {/* Opponent */}
        <fieldset className="space-y-2" disabled={searching}>
          <legend className="hud-label mb-2">{t("opponent")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {OPPONENTS.map(([value, Icon]) => (
              <label
                key={value}
                className={cn("menu-item hud flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4", opponent === value && "border-primary ring-1 ring-primary")}
                data-selected={opponent === value}
              >
                <input type="radio" name={`${id}-opponent`} value={value} checked={opponent === value} onChange={() => setOpponent(value)} className="sr-only" />
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="block font-display font-bold uppercase">{t(`opponents.${value}.title`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`opponents.${value}.blurb`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Format */}
        <fieldset className="space-y-2" disabled={searching}>
          <legend className="hud-label mb-2">{t("format")}</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(opponent === "cpu" ? PLAY_FORMATS : LIVE_FORMATS).map((f) => (
              <label
                key={f}
                className={cn("flex cursor-pointer flex-col gap-1 rounded-md border bg-card px-3 py-2.5 hover:border-screen/60", format === f && "border-primary ring-1 ring-primary")}
              >
                <input type="radio" name={`${id}-format`} value={f} checked={format === f} onChange={() => setFormat(f)} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold uppercase">{formatName(tf, f)}</span>
                  <span className="hud-label text-screen">{PLAY_FORMAT_INFO[f].random ? t("random") : t("yourTeam")}</span>
                </span>
                <span className="text-xs text-muted-foreground">{PLAY_FORMAT_INFO[f].gameType === "doubles" ? t("doubles") : ""}{PLAY_FORMAT_INFO[f].random ? formatBlurb(tf, f) : t("bringTeam")}</span>
              </label>
            ))}
            {opponent !== "match" && (
              <label
                className={cn("flex cursor-pointer flex-col gap-1 rounded-md border border-dashed bg-card px-3 py-2.5 hover:border-screen/60", custom && "border-solid border-primary ring-1 ring-primary")}
                data-testid="format-custom"
              >
                <input type="radio" name={`${id}-format`} value="custom" checked={custom} onChange={() => setFormat("custom")} className="sr-only" />
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold uppercase">{t("customRules")}</span>
                  <span className="hud-label text-screen">{t("gens")}</span>
                </span>
                <span className="text-xs text-muted-foreground">{formatBlurb(tf, "custom")}</span>
              </label>
            )}
          </div>
        </fieldset>

        {/* Showdown's other game types: three Pokémon a side, and four trainers (unranked, as on Showdown). */}
        <fieldset className="space-y-2" disabled={searching} data-testid="group-formats">
          <legend className="hud-label mb-2">{t("groupTitle")}</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {GROUP_FORMATS.map((f) => {
              const fi = PLAY_FORMAT_INFO[f];
              return (
                <label
                  key={f}
                  className={cn("flex cursor-pointer flex-col gap-1 rounded-md border bg-card px-3 py-2.5 hover:border-screen/60", format === f && "border-primary ring-1 ring-primary")}
                  data-testid={`format-${f}`}
                >
                  <input type="radio" name={`${id}-format`} value={f} checked={format === f} onChange={() => setFormat(f)} className="sr-only" />
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-bold uppercase">{formatShort(tf, f)}</span>
                    <span className="hud-label shrink-0 text-screen">{gameTypeLabel(tf, fi.gameType)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{fi.random ? formatBlurb(tf, f) : playerCount(fi.gameType) === 4 ? t("groupFour") : t("groupThree")}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {opponent === "cpu" && (
          <p className="text-xs text-muted-foreground" data-testid="frontier-links">
            {t.rich("frontier", {
              factory: (chunks) => (
                <Link href="/battle/factory" className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {chunks}
                </Link>
              ),
              tower: (chunks) => (
                <Link href="/battle/tower" className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {chunks}
                </Link>
              ),
            })}
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
            <legend className="hud-label mb-2">{t("cpuLevel")}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {CPU_LEVELS.map((l) => (
                <label key={l} className={cn("flex cursor-pointer flex-col gap-1 rounded-md border bg-card px-3 py-2.5 hover:border-screen/60", level === l && "border-primary ring-1 ring-primary")}>
                  <input type="radio" name={`${id}-level`} value={l} checked={level === l} onChange={() => setLevel(l)} className="sr-only" />
                  <span className="font-display text-sm font-bold uppercase">{cpuLevelName(tf, l)}</span>
                  <span className="text-xs text-muted-foreground">{cpuLevelBlurb(tf, l)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {needsTeam && (
          <fieldset disabled={searching} className={cn(searching && "opacity-60")}>
            <Card>
              <CardContent className="p-4">
                <TeamPick key={custom ? `custom:${rules.base ?? ""}:${rules.gen}:${rules.level}:${rules.levelMode}:${rules.teamSize}` : format} format={format} onChange={onTeam} idPrefix={id} source={teamSource} />
              </CardContent>
            </Card>
          </fieldset>
        )}
      </div>

      <Card className="h-fit border-primary/40 lg:sticky lg:top-20">
        <CardContent className="space-y-4 p-6">
          <p className="hud-label flex items-center gap-1.5 text-primary">
            <Swords className="h-3.5 w-3.5" aria-hidden /> {t(`heading.${opponent}`)}
          </p>
          <p className="font-display text-2xl font-bold uppercase leading-tight">{shownName}</p>
          <p className="text-sm text-muted-foreground">
            {opponent === "cpu"
              ? four
                ? t("summary.cpuFour", { level: cpuLevelName(tf, level), four: t(`fourCpu.${info.gameType as FourType}`), teams: info.random ? "random" : "own" })
                : t("summary.cpu", { level: cpuLevelName(tf, level), teams: info.random ? "random" : "own" })
              : opponent === "match"
                ? four
                  ? t("summary.matchFour", { format: formatName(tf, format), multi: info.gameType === "multi" ? "yes" : "no" })
                  : t("summary.match", { format: formatName(tf, format), teams: info.random ? "random" : "own" })
                : challenge
                  ? t("summary.challenge", { name: challenge })
                  : four
                    ? t("summary.pvpFour")
                    : t("summary.pvp")}
          </p>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="hud-label">
              {t("nameLabel")}
            </label>
            <input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              required={opponent !== "cpu"}
              disabled={searching}
              placeholder={t("namePlaceholder")}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {opponent === "match" && isLadderFormat(format) && (
            <div className="space-y-2" data-testid="ranked-option">
              <Toggle
                checked={rankedOn}
                onChange={setRanked}
                disabled={searching || ladder.status === "off" || needsAccount}
                label={t("ranked")}
                hint={ladder.status === "off" ? t("rankedSoon") : needsAccount ? t("rankedAccount") : t("rankedHint")}
                testId="ranked-toggle"
              />
              {needsAccount && ladder.status !== "off" && (
                <p className="text-xs text-muted-foreground" data-testid="ranked-sign-in">
                  {t.rich("signIn", {
                    link: (chunks) => (
                      <Link href="/login" className="font-semibold text-primary hover:underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              )}
              {rankedOn && ladder.status === "ready" && (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {ladder.you && ladder.you.games > 0 ? <GlickoBadge rating={ladder.you.rating} rd={ladder.you.rd} gxe={ladder.you.gxe} elo={ladder.you.elo} size="sm" /> : <span>{t("unrated")}</span>}
                  <Link href={`/battle/ladder?format=${format}`} className="underline-offset-2 hover:text-foreground hover:underline">
                    {t("ladder")}
                  </Link>
                </p>
              )}
            </div>
          )}
          {opponent === "pvp" && (
            <div className="space-y-2">
              <Toggle checked={watchable} onChange={setWatchable} label={t("watch")} hint={t("watchHint")} testId="let-anyone-watch" />
              <Toggle checked={timerOn} onChange={setTimerOn} label={t("timer")} hint={t("timerHint")} testId="timer-on" />
              <Toggle
                checked={timeoutLoses}
                onChange={setTimeoutLoses}
                label={t("timeout")}
                hint={t("timeoutHint")}
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
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {rankedOn ? t("searchingRanked") : t("searching")}
              </p>
              <p className="font-pixel text-xs tabular-nums text-muted-foreground">{clock(now - (finder.since ?? now))}</p>
              <Button type="button" size="sm" variant="ghost" onClick={finder.cancel}>
                <X className="h-3.5 w-3.5" aria-hidden /> {t("cancel")}
              </Button>
            </div>
          ) : (
            <Button ref={setSubmitEl} type="submit" size="lg" className="w-full" disabled={blocked}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : opponent === "match" ? (
                <UserSearch className="h-4 w-4" aria-hidden />
              ) : (
                <Swords className="h-4 w-4" aria-hidden />
              )}
              {startLabel}
            </Button>
          )}
          {!searching && !busy && ((!name.trim() && opponent !== "cpu") || (needsTeam && !team)) && (
            <p className="text-center text-xs text-muted-foreground" data-testid="setup-why-disabled">
              {!name.trim() && opponent !== "cpu" ? t("whyName") : t("whyTeam")}
            </p>
          )}
          {opponent === "match" && !searching && <p className="text-center text-xs text-muted-foreground">{t("leaving")}</p>}
        </CardContent>
      </Card>
      {/* Against the computer only: the other two need a name typed at the foot of the page anyway. */}
      {opponent === "cpu" && !submitSeen && !blocked && !searching && (
        <div className="sticky bottom-[calc(var(--tabbar-h)+0.5rem)] z-10 -mt-6 md:hidden" data-testid="setup-quick-start">
          <Button type="submit" size="lg" className="w-full shadow-[0_10px_30px_-8px_rgb(0_0_0/0.8)]">
            <Swords className="h-4 w-4" aria-hidden /> {t("playNow", { format: custom ? t("custom") : formatShort(tf, format) })}
          </Button>
        </div>
      )}
    </form>
  );
}

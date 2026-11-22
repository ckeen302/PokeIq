"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { Check, Copy, Crown, Loader2, Timer, XCircle } from "lucide-react";
import { buildMatcher } from "@/lib/name-em-all/match";
import { NEA_PATH, neaCategory } from "@/lib/name-em-all/categories";
import { neaClock } from "@/lib/name-em-all/share";
import { RACE_MIN, raceHref, type NeaRaceStanding, type NeaRaceView } from "@/lib/name-em-all/race";
import { isCleanName } from "@/lib/name-filter";
import { useProgress } from "@/lib/progress";
import { play } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { useDuel } from "@/components/duel/use-duel";
import { DuelGone, DuelLoading, DuelNotice, seconds } from "@/components/duel/DuelParts";
import { SlotGrid, groupSlots, type SlotState } from "./parts";
import { outsiderMap, useNameInput } from "./use-name-input";
import { useNeaTargets } from "./NeaDaily";
import { NeaShareButton } from "./NeaShare";
import { cn } from "@/lib/utils";
import type { NeaOutsider, NeaTarget } from "@/lib/name-em-all/types";
import { useT } from "@/i18n/client";
import communityNs from "@/messages/community";
import neaRace from "@/messages/nea-race";
import neaGame from "@/messages/nea-game";

/**
 * A Name 'em All race: the lobby (share link, ready-up), a short count-in,
 * the race (your own grid and name box, everyone's progress as bars), and
 * the final standings with the ones you missed revealed.
 */

const FLUSH_MS = 600;
const BAR_COLORS = ["#e2306f", "#38bdf8", "#f59e0b", "#22c55e", "#a855f7", "#f97316", "#14b8a6", "#eab308"];

/** `label`: another language's name of the race's category, from the server (English pages use categories.ts'). */
export function NeaRace({ code, label }: { code: string; label?: string }) {
  const t = useT(neaRace);
  const ct = useT(communityNs);
  const router = useRouter();
  const progress = useProgress();
  const { view, now, gone, offline, error, setError, busy, act, send, join } = useDuel<NeaRaceView>(`/api/name-em-all/race/${code}`, code);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const found = view ? neaCategory(view.category) : undefined;
  const cat = found && (t.locale === "en" ? found : { ...found, label: label ?? found.label });
  const { data } = useNeaTargets(view?.category ?? null, t.locale);
  const me = view?.you ?? null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${raceHref(code)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t("copyFailed"));
    }
  }

  if (gone) return <DuelGone message={gone} href={NEA_PATH} label={t("back")} />;
  if (!view || !cat) return <DuelLoading />;
  const notice = <DuelNotice error={error} offline={offline} />;
  const title = (
    <div className="space-y-1 text-center">
      <p className="hud-label text-screen">{t("eyebrow")}</p>
      <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">
        {t.rich("title", { label: cat.label, hl: (c) => <span className="text-primary">{c}</span> })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t("info", { total: view.total, minutes: view.minutes })}
      </p>
    </div>
  );

  // ---- lobby ----------------------------------------------------------------------------
  if (view.status === "lobby") {
    const isHost = me === 0;
    const waiting = view.players.filter((p) => !p.host && !p.ready);
    const link = typeof window === "undefined" ? raceHref(code) : `${window.location.origin}${raceHref(code)}`;
    return (
      <div className="mx-auto max-w-2xl space-y-4" data-testid="nea-race-lobby">
        {notice}
        {title}
        <div className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-shade/20 px-3 py-2 text-sm" data-testid="nea-race-link">
              {link}
            </code>
            <Button variant="outline" onClick={() => void copyLink()}>
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          <ul className="divide-y rounded-md border" aria-label={t("players")}>
            {view.players.map((p, seat) => (
              <li key={seat} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="nea-race-player">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAR_COLORS[seat % BAR_COLORS.length] }} aria-hidden />
                <span className="font-semibold">{p.name}</span>
                {seat === me && <span className="hud-label">{t("you")}</span>}
                {p.host && (
                  <span className="hud-label flex items-center gap-1 text-warning">
                    <Crown className="h-3 w-3" aria-hidden /> {t("host")}
                  </span>
                )}
                <span className={cn("ml-auto text-xs font-semibold uppercase", p.ready ? "text-success" : "text-muted-foreground")}>{p.away ? t("away") : p.ready ? t("ready") : t("notReady")}</span>
              </li>
            ))}
          </ul>
          {me === null ? (
            view.players.length >= view.max ? (
              <p className="text-center text-sm text-muted-foreground">{t("full")}</p>
            ) : (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!isCleanName(name)) return setError(ct("nameRejected"));
                  void join(name.trim());
                }}
              >
                <input aria-label={t("nameLabel")} value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" />
                <Button type="submit" disabled={busy || !name.trim()} data-testid="nea-race-join">
                  {t("join")}
                </Button>
              </form>
            )
          ) : isHost ? (
            <div className="space-y-2 text-center">
              <Button size="lg" disabled={busy || view.players.length < RACE_MIN || waiting.length > 0} onClick={() => void act({ action: "start" })} data-testid="nea-race-begin">
                {t("start")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {view.players.length < RACE_MIN ? t("waitingPlayers", { min: RACE_MIN }) : waiting.length ? t("waitingFor", { names: waiting.map((p) => p.name).join(", ") }) : t("allReady")}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <Button size="lg" variant={view.players[me].ready ? "outline" : "default"} disabled={busy} onClick={() => void act({ action: "ready", ready: !view.players[me].ready })} data-testid="nea-race-ready">
                {view.players[me].ready ? t("notReady") : t("readyUp")}
              </Button>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground">{t("note")}</p>
        {me !== null && (
          <div className="text-center">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act({ action: "leave" }).then((ok) => ok && router.push(NEA_PATH))}>
              {t("leave")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const bars = <RaceBars standings={view.standings} total={view.total} you={me} />;

  if (me === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        {title}
        <p className="text-center text-sm text-muted-foreground">{view.status === "finished" ? t("overVisitor") : t("onVisitor")}</p>
        {bars}
        <div className="text-center">
          <Link href={NEA_PATH} className="text-sm underline underline-offset-2">
            {t("own")}
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return <DuelLoading />;

  if (view.status === "playing" && view.round && now < view.round.startsAt) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {notice}
        {title}
        <div className="rounded-lg border bg-card p-10 text-center">
          <p className="hud-label text-screen">{t("getReady")}</p>
          <p className="font-display text-7xl font-bold tabular-nums">{Math.max(1, seconds(view.round.startsAt - now))}</p>
        </div>
      </div>
    );
  }

  return <RaceBoard key={code} view={view} now={now} targets={data.targets} outsiders={data.outsiders} label={cat.label} bars={bars} notice={notice} send={send} onLeave={() => void act({ action: "leave" }).then((ok) => ok && router.push(NEA_PATH))} />;
}

function RaceBoard({
  view,
  now,
  targets,
  outsiders,
  label,
  bars,
  notice,
  send,
  onLeave,
}: {
  view: NeaRaceView;
  now: number;
  targets: NeaTarget[];
  outsiders: NeaOutsider[];
  label: string;
  bars: React.ReactNode;
  notice: React.ReactNode;
  send: (body: Record<string, unknown>) => Promise<string | null>;
  onLeave: () => void;
}) {
  const t = useT(neaRace);
  const tg = useT(neaGame);
  const matcher = useMemo(() => buildMatcher(targets), [targets]);
  const outsidersMap = useMemo(() => outsiderMap(outsiders), [outsiders]);
  const groups = useMemo(() => groupSlots(targets, tg), [targets, tg]);
  const [named, setNamed] = useState<number[]>(() => view.mine ?? []);
  const namedSet = useRef(new Set<number>(view.mine ?? []));
  const pending = useRef<number[]>([]);
  const [fresh, setFresh] = useState<number | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const over = view.status === "finished";

  // The server's list wins after a reload; names typed here and not yet sent stay.
  const mineKey = (view.mine ?? []).join(",");
  useEffect(() => {
    const server = view.mine ?? [];
    let changed = false;
    for (const s of server) {
      if (namedSet.current.has(s)) continue;
      namedSet.current.add(s);
      changed = true;
    }
    if (changed) setNamed([...namedSet.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineKey]);

  // `send` is a new function on every render (the clock ticks four times a second):
  // read the latest from a ref so the flush timer isn't reset before it fires.
  const sendRef = useRef(send);
  sendRef.current = send;
  const sending = useRef(false);
  // Another language: the same passing errors as the page shows them (translated on the way in, see ApiErrors).
  const transient = useRef(new Set<string>());
  useEffect(() => {
    if (t.locale === "en") return;
    import(`@/messages/${t.locale}/api-errors.json`)
      .then((m: { default: Record<string, string> }) => {
        for (const k of ["slow-down-trainer", "the-race-server-hiccupped-try-again", "the-duel-is-busy-try-again"]) if (m.default[k]) transient.current.add(m.default[k]);
      })
      .catch(() => {});
  }, [t.locale]);
  const flush = useCallback(async () => {
    if (!pending.current.length || sending.current) return;
    sending.current = true;
    const slots = pending.current.splice(0, 200);
    let err: string | null;
    try {
      err = await sendRef.current({ action: "name", slots });
    } finally {
      sending.current = false;
    }
    if (err) {
      if (/faster|Slow down|busy|hiccup/i.test(err) || transient.current.has(err)) pending.current.unshift(...slots);
      setWarn(err);
    } else setWarn(null);
  }, []);
  useEffect(() => {
    if (over) return;
    const id = window.setInterval(() => void flush(), FLUSH_MS);
    return () => window.clearInterval(id);
  }, [flush, over]);

  const accept = useCallback(
    (slot: number) => {
      if (namedSet.current.has(slot)) return;
      namedSet.current.add(slot);
      pending.current.push(slot);
      setNamed((n) => [...n, slot]);
      setFresh(slot);
      play("correct");
      if (namedSet.current.size === targets.length) void flush();
    },
    [targets.length, flush]
  );
  const input = useNameInput({ matcher, targets, outsiders: outsidersMap, label, isNamed: (s) => namedSet.current.has(s), allowed: () => true, spelling: false, onAccept: accept });

  const nameSet = useMemo(() => new Set(named), [named]);
  const stateOf = useCallback((s: number): SlotState => (nameSet.has(s) ? "named" : over ? "missed" : "open"), [nameSet, over]);
  const grid = useMemo(() => <SlotGrid targets={targets} groups={groups} stateOf={stateOf} style="pixel" shiny={false} fresh={fresh} />, [targets, groups, stateOf, fresh]);

  const mine = view.standings.find((s) => s.seat === view.you);
  const left = view.round ? Math.max(0, view.round.endsAt - now) : 0;

  if (over) {
    const winner = view.end?.winner;
    const share = `${t("shareHead", { label })} · ${mine ? t("sharePlace", { place: t("place", { n: mine.place }), count: view.standings.length, named: mine.named, total: view.total }) : ""}${mine?.done ? " 🏆" : ""}`;
    return (
      <div className="space-y-5" data-testid="nea-race-result">
        {notice}
        <div className="space-y-2 text-center">
          <p className="hud-label text-screen">{t("over", { label })}</p>
          <p className="flex items-center justify-center gap-3 font-display text-4xl font-bold uppercase sm:text-5xl">
            <Crown className="h-9 w-9 text-warning" aria-hidden />
            {winner === null || winner === undefined ? t("noWinner") : t("wins", { name: view.players[winner]?.name ?? "" })}
          </p>
          {mine && (
            <p className="text-muted-foreground">
              {t("finished", { place: t("place", { n: mine.place }), count: view.standings.length, named: mine.named, total: view.total })}
            </p>
          )}
        </div>
        <div className="mx-auto max-w-2xl">{bars}</div>
        <div className="flex flex-wrap justify-center gap-2">
          <NeaShareButton text={share} testId="nea-race-share" />
          <Link href={NEA_PATH} className="inline-flex h-12 items-center rounded-md border bg-card px-4 font-display text-sm font-semibold uppercase tracking-wider">
            {t("newRace")}
          </Link>
        </div>
        {grid}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_17rem]" data-testid="nea-race">
      <div className="min-w-0 space-y-4">
        {notice}
        <div className="sticky top-14 z-30 -mx-4 border-b border-border/70 bg-background/95 px-4 pb-2.5 pt-2 backdrop-blur sm:mx-0 sm:rounded-b-lg sm:border-x">
          <div className="flex items-center gap-3">
            <p className="shrink-0 font-display font-bold tabular-nums leading-none" data-testid="nea-count">
              <span className="text-3xl sm:text-4xl">{named.length}</span>
              <span className="text-lg text-muted-foreground"> / {targets.length}</span>
            </p>
            <div className="meter min-w-0 flex-1" aria-hidden>
              <div className="h-full bg-success transition-[width] duration-300" style={{ width: `${(named.length / targets.length) * 100}%` }} />
            </div>
            {mine && <span className="hud-label shrink-0 text-screen">{t("place", { n: mine.place })}</span>}
            <span className={cn("flex shrink-0 items-center gap-1 font-display text-lg font-bold tabular-nums", left <= 30_000 && "text-destructive")}>
              <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
              {neaClock(left + 999)}
            </span>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={input.text}
              onChange={input.onChange}
              onKeyDown={input.onKeyDown}
              autoFocus
              placeholder={tg("hud.typeName")}
              aria-label={tg("hud.nameLabel")}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="done"
              className="h-11 min-w-0 flex-1 rounded-md border-2 border-input bg-card px-3 text-base font-semibold outline-none focus:border-screen sm:h-12 sm:text-lg"
              data-testid="nea-input"
            />
          </div>
          <p className="mt-1.5 h-5 truncate text-xs" aria-live="polite">
            {warn ? <span className="text-destructive">{warn}</span> : input.feedback ? <span className={input.feedback.kind === "dup" ? "text-muted-foreground" : "text-destructive"}>{input.feedback.text}</span> : <span className="text-muted-foreground">{t("hint", { total: targets.length })}</span>}
          </p>
        </div>
        <div className="lg:hidden">{bars}</div>
        {grid}
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={onLeave}>
            {t("leave")}
          </Button>
        </div>
      </div>
      <aside className="hidden lg:block" aria-label={t("standings")}>
        <div className="sticky top-20">{bars}</div>
      </aside>
    </div>
  );
}

/** Everyone's progress as bars, best first. Counts only, never which Pokémon. */
function RaceBars({ standings, total, you }: { standings: NeaRaceStanding[]; total: number; you: number | null }) {
  const t = useT(neaRace);
  return (
    <ol className="space-y-2 rounded-lg border bg-card p-3" data-testid="nea-race-bars">
      {standings.map((s) => (
        <li key={s.seat} className={cn("space-y-1 rounded px-1 py-0.5", s.seat === you && "bg-screen/[0.08]")} data-testid="nea-race-bar">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-5 font-display font-bold tabular-nums text-muted-foreground">{s.place}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {s.name}
              {s.seat === you && <span className="hud-label ml-1.5">{t("you")}</span>}
            </span>
            {s.out && <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-label={t("away")} />}
            <span className="tabular-nums text-muted-foreground">
              {s.named}/{total}
              {s.done && s.ms !== undefined && <b className="ml-1.5 text-success">{neaClock(s.ms)}</b>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-sm bg-shade/50">
            <div className="h-full rounded-sm transition-[width] duration-500" style={{ width: `${(s.named / total) * 100}%`, background: BAR_COLORS[s.seat % BAR_COLORS.length] }} />
          </div>
        </li>
      ))}
      {standings.length === 0 && (
        <li className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("waiting")}
        </li>
      )}
    </ol>
  );
}

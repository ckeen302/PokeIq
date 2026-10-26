"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Castle, ChevronDown, Clapperboard, Eye, Hammer, Link2, Loader2, Megaphone, MessagesSquare, Search, Shuffle, Swords, Trophy, Users, X, type LucideIcon } from "lucide-react";
import { PAST_GENS, PLAY_FORMAT_INFO, type PlayFormatId, type StandardFormatId } from "@/lib/battle/play";
import { BATTLE_FORMATS } from "@/lib/battle/formats";
import { saveBattleSeat } from "@/lib/battle/seat";
import { ensureBattleId } from "@/lib/battle/replay-client";
import { isLadderFormat } from "@/lib/battle/ladder";
import { useLadderStanding } from "@/lib/battle/ladder-client";
import { DEFAULT_CUSTOM_RULES, builderFormatFor, customName, lastCustomRules, type CustomRules } from "@/lib/battle/custom-rules";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { useProgress } from "@/lib/progress";
import { useAccount } from "@/lib/account";
import { openFriends } from "@/lib/friends-client";
import { unlockAudio } from "@/lib/sound";
import type { LiveCounts } from "@/lib/community";
import { GlickoBadge } from "./GlickoBadge";
import { Button } from "@/components/ui/button";
import { clock } from "@/components/duel/DuelParts";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { cn } from "@/lib/utils";
import { startBattle } from "./BattleSetup";
import { TeamPick, type TeamSource } from "./TeamPick";
import { CustomRulesEditor, RulesVerdictNote, useRulesCheck } from "./CustomRulesEditor";

/**
 * The battle home, after Pokémon Showdown's: pick a format and a team, then
 * one big Battle! button finds an opponent (casual or ranked). Custom rules
 * go by invite, as on Showdown. Around it: the live counters, the other ways
 * in, and the news.
 */

export interface NewsItem {
  id: string;
  date: string;
  title: string;
  body: string;
  href?: string;
  cta?: string;
}

type Pick = { id: PlayFormatId; label: string; note?: string } | { href: string; label: string; note: string };

/** Formats grouped as on Showdown's format menu. */
const GROUPS: { title: string; items: Pick[] }[] = [
  {
    title: "Random",
    items: [
      { id: "gen9randombattle", label: "Random Battle" },
      { id: "gen9randomdoublesbattle", label: "Random Doubles" },
      { id: "factory", label: "Battle Factory", note: "rental teams" },
    ],
  },
  {
    title: "Singles",
    items: [
      { id: "gen9ou", label: "OU" },
      { id: "gen9uu", label: "UU" },
      { id: "gen9ubers", label: "Ubers" },
      { href: "/battle/tower", label: "Battle Tower / BSS", note: "vs computer" },
    ],
  },
  { title: "Doubles", items: [{ id: "gen9doublesou", label: "Doubles OU" }] },
  { title: "Custom", items: [{ id: "custom", label: "Custom rules", note: "by invite" }] },
];

const formatLabel = (f: PlayFormatId, rules: CustomRules) => (f === "custom" ? customName(rules) : PLAY_FORMAT_INFO[f].name);

function FormatMenu({ value, rules, onChange, disabled }: { value: PlayFormatId; rules: CustomRules; onChange: (f: PlayFormatId) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const choose = (f: PlayFormatId) => {
    onChange(f);
    setOpen(false);
  };
  const item = (active: boolean) =>
    cn("flex w-full items-baseline justify-between gap-2 whitespace-nowrap rounded px-2 py-1.5 text-left text-sm hover:bg-accent", active && "bg-primary/15 font-semibold text-foreground");
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-12 w-full items-center justify-between gap-3 rounded-md border-2 border-screen/40 bg-background px-4 text-left transition-colors hover:border-screen disabled:opacity-60"
        data-testid="format-picker"
      >
        <span className="truncate font-display text-lg font-bold">{formatLabel(value, rules)}</span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-screen transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div role="listbox" aria-label="Format" className="absolute left-0 top-[calc(100%+6px)] z-40 grid max-h-[70vh] w-[min(600px,calc(100vw-2rem))] grid-cols-[1fr_1.2fr] gap-x-4 overflow-y-auto rounded-lg border bg-card p-3 shadow-2xl" data-testid="format-menu">
          <div className="space-y-3">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <p className="hud-label mb-1 text-screen">{g.title}</p>
                {g.items.map((it) =>
                  "href" in it ? (
                    <Link key={it.label} href={it.href} className={item(false)}>
                      {it.label} <span className="text-[11px] text-muted-foreground">{it.note} ↗</span>
                    </Link>
                  ) : (
                    <button key={it.id} type="button" role="option" aria-selected={value === it.id} className={item(value === it.id)} onClick={() => choose(it.id)}>
                      {it.label} {it.note && <span className="text-[11px] text-muted-foreground">{it.note}</span>}
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
          <div>
            <p className="hud-label mb-1 text-screen">Past gens</p>
            <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-center gap-x-1 gap-y-0.5 text-sm">
              {PAST_GENS.map((g) => (
                <div key={g} className="contents">
                  <span className="pr-1 font-pixel text-[10px] text-muted-foreground">G{g}</span>
                  {(["randombattle", "ou", "uu"] as const).map((t) => {
                    const id = `gen${g}${t}` as StandardFormatId;
                    return (
                      <button key={id} type="button" role="option" aria-selected={value === id} aria-label={PLAY_FORMAT_INFO[id].name} className={cn(item(value === id), "justify-center")} onClick={() => choose(id)}>
                        {t === "randombattle" ? "Random" : t.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Live counters (CDN-cached for 30 s: polling them costs the server next to nothing). */
function useLiveCounts(): LiveCounts | null {
  const [counts, setCounts] = useState<LiveCounts | null>(null);
  useEffect(() => {
    let gone = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/live")
        .then((r) => (r.ok ? r.json() : null))
        .then((c: LiveCounts | null) => !gone && c && setCounts(c))
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      gone = true;
      window.clearInterval(id);
    };
  }, []);
  return counts;
}

const SECONDARY: { href?: string; onClick?: () => void; icon: LucideIcon; label: string; testId: string }[] = [
  { href: "/battle/teams", icon: Hammer, label: "Team Builder", testId: "home-teambuilder" },
  { href: "/battle/ladder", icon: Trophy, label: "Ladder", testId: "home-ladder" },
  { href: "/battle/tournaments", icon: Castle, label: "Tournaments", testId: "home-tournaments" },
  { href: "/battle/watch", icon: Eye, label: "Watch live", testId: "home-watch" },
  { href: "/rooms", icon: MessagesSquare, label: "Chat rooms", testId: "home-rooms" },
  { href: "/users", icon: Search, label: "Find a user", testId: "home-find-user" },
  { onClick: () => openFriends("friends"), icon: Users, label: "Friends", testId: "home-friends" },
];

export function BattleHome({ news }: { news: NewsItem[] }) {
  const router = useRouter();
  const progress = useProgress();
  const account = useAccount();
  const id = useId();
  const counts = useLiveCounts();
  const [format, setFormat] = useState<PlayFormatId>("gen9randombattle");
  const [rules, setRules] = useState<CustomRules>(DEFAULT_CUSTOM_RULES);
  const [team, setTeam] = useState("");
  const [name, setName] = useState("");
  const [editName, setEditName] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [ranked, setRanked] = useState(false);
  const [busy, setBusy] = useState<"cpu" | "invite" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRules(lastCustomRules()), []);
  // "/battle?format=gen9ou" (a chat room's Battle! link) opens on that format.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("format");
    if (wanted && wanted in PLAY_FORMAT_INFO && wanted !== "tower") setFormat(wanted as PlayFormatId);
  }, []);
  useEffect(() => {
    if (!name && (account.user?.username || progress?.name)) setName(account.user?.username ?? progress?.name ?? "");
  }, [account.user?.username, progress?.name, name]);

  const custom = format === "custom";
  const info = PLAY_FORMAT_INFO[format];
  const needsTeam = !info.random;
  const ladderable = isLadderFormat(format);
  const ladder = useLadderStanding(ladderable ? (format as StandardFormatId) : null);
  const rankedOn = ranked && ladderable && ladder.status !== "off";
  const settings = useMemo(() => ({ format, ranked: rankedOn }), [format, rankedOn]);
  const finder = useMatchmaking(custom ? undefined : settings, { endpoint: "/api/battle/match", save: saveBattleSeat });
  const searching = finder.searching;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!searching) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [searching]);
  const verdict = useRulesCheck(custom ? rules : null, custom ? team : "");
  const rulesBroken = verdict?.state === "bad" && verdict.errors.length > 0;

  // Team formats outside the team builder's own (past generations) save no teams; quick teams still work.
  const teamSource = useMemo<TeamSource | undefined>(() => {
    if (custom) return { name: customName(rules), short: `Gen ${rules.gen}`, saved: builderFormatFor(rules.gen), quick: { rules }, quickNote: `Random-battle sets from Gen ${rules.gen}, checked against your rules.` };
    if (needsTeam && !(format in BATTLE_FORMATS)) return { name: info.name, short: info.short, saved: null, quick: { format }, quickNote: `Random-battle sets legal in ${info.name}.` };
    return undefined;
  }, [custom, rules, needsTeam, format, info.name, info.short]);
  const onTeam = useCallback((t: string) => setTeam(t), []);

  const trainer = name.trim();
  const ready = !!trainer && (!needsTeam || !!team) && !rulesBroken;

  function check(): boolean {
    setError(null);
    if (!isCleanName(trainer)) {
      setError(NAME_REJECTED);
      setEditName(true);
      return false;
    }
    return true;
  }

  async function battle() {
    if (!check()) return;
    const rankedId = (await ensureBattleId()) ?? undefined;
    void finder.search(trainer, { ...(needsTeam ? { team } : {}), rankedId, ...(hidden ? { hidden: true } : {}) });
  }

  async function open(mode: "cpu" | "pvp") {
    if (!check()) return;
    unlockAudio();
    setBusy(mode === "cpu" ? "cpu" : "invite");
    try {
      const href = await startBattle({
        mode,
        name: trainer,
        format,
        team: needsTeam ? team : undefined,
        rules: custom ? rules : undefined,
        ...(mode === "pvp" ? { hidden } : {}),
      });
      router.push(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a battle.");
      setBusy(null);
    }
  }

  const problem = error ?? finder.error;

  return (
    <section className="space-y-5" data-testid="battle-home">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="hud-label flex items-center gap-2 text-screen">
            <span className="led h-1.5 w-1.5 animate-blink text-screen" /> Battle unit · Pokémon Showdown rules
          </p>
          <h1 className="font-display text-5xl font-bold uppercase leading-none tracking-tight">
            Battle <span className="text-primary [text-shadow:0_0_30px_hsl(var(--primary)/0.45)]">anyone.</span>
          </h1>
        </div>
        <div className="flex gap-2" data-testid="live-counts">
          <Counter value={counts?.online} label="trainers online" tone="success" />
          <Counter value={counts?.battles} label="active battles" tone="primary" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The main action panel */}
        <div className="hud relative self-start rounded-xl border-2 border-primary/30 bg-card p-5 shadow-[0_24px_60px_-30px_hsl(var(--primary)/0.6)]">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0 space-y-4">
              <div className="space-y-1.5">
                <p className="hud-label">Format</p>
                <FormatMenu value={format} rules={rules} onChange={(f) => (setFormat(f), setTeam(""))} disabled={searching} />
                <p className="text-xs text-muted-foreground">{custom ? "Your own ruleset, battled by invite link (as on Showdown)." : info.blurb}</p>
              </div>
              {custom && (
                <div className="space-y-3 rounded-lg border bg-background/60 p-3">
                  <CustomRulesEditor rules={rules} onChange={setRules} live />
                  <RulesVerdictNote verdict={verdict} />
                </div>
              )}
              <div className="space-y-1.5">
                <p className="hud-label">Team</p>
                {needsTeam ? (
                  <fieldset disabled={searching} className={cn("rounded-lg border bg-background/60 p-3", searching && "opacity-60")}>
                    <TeamPick
                      key={custom ? `custom:${rules.gen}:${rules.level}:${rules.levelMode}:${rules.teamSize}` : format}
                      format={format}
                      onChange={onTeam}
                      idPrefix={id}
                      source={teamSource}
                    />
                  </fieldset>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-dashed bg-background/60 px-4 py-3 text-sm" data-testid="random-team">
                    <Shuffle className="h-5 w-5 text-screen" aria-hidden />
                    <span>
                      <b>Random team.</b> <span className="text-muted-foreground">{format === "factory" ? "Both trainers rent a Battle Factory team." : "Six Pokémon dealt for you when the battle starts."}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="space-y-1">
                <p className="hud-label">Trainer</p>
                {editName || !trainer ? (
                  <input
                    aria-label="Your trainer name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => trainer && setEditName(false)}
                    maxLength={24}
                    placeholder="Trainer name"
                    disabled={searching}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                ) : (
                  <button type="button" onClick={() => setEditName(true)} disabled={searching} className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left hover:border-screen/60">
                    <span className="truncate font-display font-bold">{trainer}</span>
                    <span className="text-xs text-muted-foreground">change</span>
                  </button>
                )}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} disabled={searching} data-testid="no-spectators" />
                Don&apos;t allow spectators
              </label>

              {!custom && ladderable && (
                <label className={cn("flex cursor-pointer items-center gap-2 text-sm", ladder.status === "off" && "cursor-not-allowed opacity-50")}>
                  <input type="checkbox" checked={rankedOn} onChange={(e) => setRanked(e.target.checked)} disabled={searching || ladder.status === "off"} data-testid="ranked-toggle" />
                  Ranked
                  {rankedOn && ladder.status === "ready" && (ladder.you && ladder.you.games > 0 ? <GlickoBadge rating={ladder.you.rating} rd={ladder.you.rd} gxe={ladder.you.gxe} size="sm" /> : <span className="text-xs text-muted-foreground">starts at 1500</span>)}
                </label>
              )}

              {problem && (
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
              )}

              {searching ? (
                <div className="space-y-2 rounded-lg border border-screen/40 bg-screen/[0.06] p-3 text-center" role="status" data-testid="battle-searching">
                  <p className="flex items-center justify-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-screen">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {rankedOn ? "Searching for a ranked rival…" : "Searching for an opponent…"}
                  </p>
                  <p className="font-pixel text-xs tabular-nums text-muted-foreground">{clock(now - (finder.since ?? now))}</p>
                  <Button type="button" size="sm" variant="ghost" onClick={finder.cancel}>
                    <X className="h-3.5 w-3.5" aria-hidden /> Cancel
                  </Button>
                </div>
              ) : custom ? (
                <Button size="lg" className="h-16 w-full text-xl" disabled={!ready || !!busy} onClick={() => void open("pvp")} data-testid="battle-invite">
                  {busy === "invite" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Link2 className="h-5 w-5" aria-hidden />} Invite a friend
                </Button>
              ) : (
                <Button size="lg" className="h-16 w-full text-2xl tracking-[0.15em]" disabled={!ready || !!busy} onClick={() => void battle()} data-testid="battle-button">
                  <Swords className="h-6 w-6" aria-hidden /> Battle!
                </Button>
              )}
              {!searching && !ready && (
                <p className="text-center text-xs text-muted-foreground" data-testid="battle-why-disabled">
                  {!trainer ? "Enter a trainer name to battle." : needsTeam && !team ? "Pick a team, or a quick one, to battle." : "Fix the rules above to battle."}
                </p>
              )}
              {!searching && (
                <div className="grid grid-cols-2 gap-2">
                  {format === "factory" ? (
                    <Link href="/battle/factory" className="flex items-center justify-center gap-1.5 rounded-md border bg-background px-2 py-2 text-xs font-semibold hover:border-screen/60">
                      <Bot className="h-3.5 w-3.5" aria-hidden /> vs Computer
                    </Link>
                  ) : (
                    <button type="button" disabled={!ready || !!busy} onClick={() => void open("cpu")} className="flex items-center justify-center gap-1.5 rounded-md border bg-background px-2 py-2 text-xs font-semibold hover:border-screen/60 disabled:opacity-50" data-testid="home-vs-cpu">
                      {busy === "cpu" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Bot className="h-3.5 w-3.5" aria-hidden />} vs Computer
                    </button>
                  )}
                  {custom ? (
                    <Link href="/battle/play" className="flex items-center justify-center gap-1.5 rounded-md border bg-background px-2 py-2 text-xs font-semibold hover:border-screen/60">
                      <Swords className="h-3.5 w-3.5" aria-hidden /> More options
                    </Link>
                  ) : (
                    <button type="button" disabled={!ready || !!busy} onClick={() => void open("pvp")} className="flex items-center justify-center gap-1.5 rounded-md border bg-background px-2 py-2 text-xs font-semibold hover:border-screen/60 disabled:opacity-50" data-testid="home-invite">
                      {busy === "invite" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />} Invite a friend
                    </button>
                  )}
                </div>
              )}
              {searching && <p className="text-center text-xs text-muted-foreground">Leaving this page ends the search.</p>}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <nav className="grid grid-cols-2 gap-2" aria-label="More battle">
            {SECONDARY.map(({ href, onClick, icon: Icon, label, testId }) => {
              const cls = "menu-item flex items-center gap-2 rounded-lg border bg-card px-3 py-3 font-display text-sm font-bold uppercase tracking-wide hover:border-screen/60";
              const inner = (
                <>
                  <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden /> <span className="truncate">{label}</span>
                </>
              );
              return href ? (
                <Link key={label} href={href} className={cls} data-testid={testId}>
                  {inner}
                </Link>
              ) : (
                <button key={label} type="button" onClick={onClick} className={cn(cls, "text-left")} data-testid={testId}>
                  {inner}
                </button>
              );
            })}
          </nav>
          <div className="rounded-xl border bg-card" data-testid="news">
            <p className="hud-label flex items-center gap-1.5 border-b px-4 py-2.5 text-screen">
              <Megaphone className="h-3.5 w-3.5" aria-hidden /> News
            </p>
            <ul className="divide-y">
              {news.slice(0, 3).map((n) => (
                <li key={n.id} className="space-y-1 px-4 py-3">
                  <p className="font-pixel text-[9px] uppercase text-muted-foreground">{new Date(`${n.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                  <p className="font-display font-bold">{n.title}</p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                  {n.href && (
                    <Link href={n.href} className="inline-block pt-0.5 text-xs font-semibold text-primary hover:underline">
                      {n.cta ?? "Read more"} →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <Link href="/battle/replays" className="flex items-center gap-2 px-1 text-xs text-muted-foreground hover:text-foreground">
            <Clapperboard className="h-3.5 w-3.5" aria-hidden /> Recent replays
          </Link>
        </div>
      </div>
    </section>
  );
}

function Counter({ value, label, tone }: { value: number | undefined; label: string; tone: "success" | "primary" }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <span className={cn("led h-2 w-2", tone === "success" ? "text-success" : "text-primary")} />
      <span className="font-display text-xl font-bold tabular-nums">{value === undefined ? "–" : value.toLocaleString("en-US")}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

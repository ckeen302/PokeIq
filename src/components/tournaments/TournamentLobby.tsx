"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { Clock, Crown, Loader2, Plus, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import {
  MAX_RR_PLAYERS,
  SIGNUP_MINUTES,
  TOURNAMENT_FORMATS,
  type BestOf,
  type TournamentFormat,
  type TournamentStyle,
  type TournamentSummary,
} from "@/lib/tournaments";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import battleTournaments from "@/messages/battle-tournaments";

/** A tournament's title in the page's language: the server names them in English ("Official hourly Random Battle", "Red's OU tournament"). */
export function tournamentName(t: Translator<typeof battleTournaments.en>, title: string): string {
  if (t.locale === "en") return title;
  const official = /^Official hourly (.+)$/.exec(title);
  if (official) return t("titles.official", { format: official[1] });
  const hosted = /^(.+)'s (.+) tournament$/.exec(title);
  return hosted ? t("titles.hosted", { host: hosted[1], format: hosted[2] }) : title;
}

const SIZES = [4, 8, 16, 32, 64];
const FIELD = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function countdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The tournament lobby: open and running tournaments, a form to open one, and recent results. */
export function TournamentLobby() {
  const account = useAccount();
  const [data, setData] = useState<{ active: TournamentSummary[]; history: TournamentSummary[] } | null>(null);
  const [off, setOff] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const t = useT(battleTournaments);

  useVisiblePoll(async () => {
    try {
      const res = await fetch("/api/tournaments", { cache: "no-store" });
      const body = await res.json();
      if (body.available === false) setOff(true);
      else if (res.ok) setData(body);
    } catch {
      // the next poll
    }
    setNow(Date.now());
  }, 10_000);

  if (off) return <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">{t("lobby.soon")}</p>;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1fr_20rem]">
      {/* Until the list is in, hold the room it usually takes, so what's below doesn't jump when it arrives. */}
      <div className={cn("space-y-6", !data && "min-h-[36rem]")}>
        <section className="space-y-3">
          <h2 className="hud-label">{t("lobby.open")}</h2>
          {!data ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          ) : data.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("lobby.none")}</p>
          ) : (
            <ul className="space-y-2" data-testid="tournament-list">
              {data.active.map((tm) => (
                <li key={tm.id}>
                  <Link href={`/battle/tournaments/${tm.id}`} className="hud flex items-center gap-3 rounded-lg border bg-card p-3 hover:border-primary/60 max-sm:flex-wrap max-sm:gap-y-1.5" data-testid="tournament-row">
                    {tm.official ? <Crown className="h-5 w-5 shrink-0 text-warning" aria-hidden /> : <Trophy className="h-5 w-5 shrink-0 text-primary" aria-hidden />}
                    <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-2rem)]">
                      <span className="block truncate font-semibold max-sm:whitespace-normal">{tournamentName(t, tm.title)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {tm.formatName} · {t(`style.${tm.style}`)} · {t("bestOf", { n: tm.bestOf })}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-sm tabular-nums max-sm:ml-8">
                      <Users className="h-3.5 w-3.5" aria-hidden /> {tm.players}/{tm.maxPlayers}
                    </span>
                    <span className={cn("w-28 text-right text-xs max-sm:ml-auto max-sm:w-auto", tm.status === "signup" ? "text-success" : "text-warning")}>
                      {tm.status === "signup" ? (
                        <>
                          <Clock className="mr-1 inline h-3 w-3" aria-hidden />
                          {t("lobby.signups", { time: countdown(tm.signupEndsAt - now) })}
                        </>
                      ) : (
                        t("lobby.running")
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {!!data?.history.length && (
          <section className="space-y-3">
            <h2 className="hud-label">{t("lobby.recent")}</h2>
            <ul className="divide-y rounded-lg border bg-card text-sm" data-testid="tournament-history">
              {data.history.map((tm) => (
                <li key={tm.id}>
                  <Link href={`/battle/tournaments/${tm.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-accent max-md:min-h-14 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-0.5 max-md:py-2.5">
                    <span className="min-w-0 flex-1 truncate max-md:basis-full max-md:font-medium">{tournamentName(t, tm.title)}</span>
                    <span className="text-xs text-muted-foreground max-md:flex-1">{tm.endedAt ? new Date(tm.endedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : ""}</span>
                    <span className="w-36 truncate text-right max-md:w-auto max-md:max-w-[50%] max-md:text-xs">
                      {tm.status === "cancelled" ? <span className="text-muted-foreground">{t("lobby.cancelled")}</span> : <span className="font-semibold text-warning">🏆 {tm.winner}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside>{account.user ? <CreateForm /> : <SignInNote />}</aside>
    </div>
  );
}

function SignInNote() {
  const t = useT(battleTournaments);
  return (
    <div className="hud space-y-2 rounded-lg border bg-card p-4 text-sm">
      <p className="hud-label">{t("lobby.openOne")}</p>
      <p className="text-muted-foreground">{t("lobby.signInNote")}</p>
      <Link href="/login?next=/battle/tournaments" className="font-semibold text-primary hover:underline">
        {t("lobby.signIn")}
      </Link>
    </div>
  );
}

function CreateForm() {
  const router = useRouter();
  const t = useT(battleTournaments);
  const [format, setFormat] = useState<TournamentFormat>("gen9randombattle");
  const [style, setStyle] = useState<TournamentStyle>("elim");
  const [maxPlayers, setMax] = useState(8);
  const [signupMinutes, setSignup] = useState(5);
  const [bestOf, setBestOf] = useState<BestOf>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, style, maxPlayers: style === "rr" ? Math.min(maxPlayers, MAX_RR_PLAYERS) : maxPlayers, signupMinutes, bestOf }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("lobby.failed"));
      router.push(`/battle/tournaments/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("lobby.failed"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="hud space-y-3 rounded-lg border bg-card p-4 text-sm" data-testid="tournament-create">
      <p className="hud-label">{t("lobby.openOne")}</p>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t("lobby.format")}</span>
        <select className={FIELD} value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)} aria-label={t("lobby.format")}>
          {TOURNAMENT_FORMATS.map((f) => (
            <option key={f} value={f}>
              {PLAY_FORMAT_INFO[f].name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted-foreground">{t("lobby.bracket")}</legend>
        <div className="flex gap-2">
          {(["elim", "rr"] as const).map((s) => (
            <Button key={s} type="button" size="sm" variant={style === s ? "default" : "outline"} onClick={() => setStyle(s)} aria-pressed={style === s}>
              {t(`style.${s}`)}
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">{t("lobby.max")}</span>
          <select className={FIELD} value={maxPlayers} onChange={(e) => setMax(Number(e.target.value))} aria-label={t("lobby.max")}>
            {(style === "rr" ? [4, 6, 8, MAX_RR_PLAYERS] : SIZES).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">{t("lobby.signupFor")}</span>
          <select className={FIELD} value={signupMinutes} onChange={(e) => setSignup(Number(e.target.value))} aria-label={t("lobby.signupTime")}>
            {SIGNUP_MINUTES.map((m) => (
              <option key={m} value={m}>
                {t("lobby.minutes", { n: m })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted-foreground">{t("lobby.each")}</legend>
        <div className="flex gap-2">
          {([1, 3] as const).map((b) => (
            <Button key={b} type="button" size="sm" variant={bestOf === b ? "default" : "outline"} onClick={() => setBestOf(b)} aria-pressed={bestOf === b}>
              {t("bestOf", { n: b })}
            </Button>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} {t("lobby.create")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("lobby.note")}</p>
    </form>
  );
}

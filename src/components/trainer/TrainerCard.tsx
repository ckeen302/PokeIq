"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { motion } from "framer-motion";
import { Pencil } from "lucide-react";
import { BADGES, connBlock, currentStreak, setTrainerName, useProgress, type Progress } from "@/lib/progress";
import { EMPTY_CONN_PLAY } from "@/lib/connections/play";
import { connStats } from "@/lib/connections/local";
import { localDateString } from "@/lib/daily";
import { dleStats } from "@/lib/dle-stats";
import { iqTitle, ratingToIQ } from "@/lib/rating";
import { ordinal } from "@/lib/cognitive/scoring";
import { MODULE_INFO, PLAY_MODULES, PLAYABLE_FORMATS as FORMATS } from "@/lib/modes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CoachPanel } from "./CoachPanel";
import { AccountPanel } from "@/components/account/AccountPanel";
import { SettingsCard } from "@/components/settings/SiteSettings";
import { EmailSettings } from "@/components/email/EmailSettings";
import { MyBattleRecord } from "@/components/battle/MyBattleRecord";
import { BadgeMedal } from "@/components/game/BadgeMedal";
import { ModeIcon } from "@/components/game/ModeIcon";
import { cn } from "@/lib/utils";
import { isCleanName } from "@/lib/name-filter";
import { useAccount } from "@/lib/account";
import { Avatar } from "@/components/avatar/Avatar";
import { AvatarPanel } from "@/components/avatar/AvatarPanel";
import { useT } from "@/i18n/client";
import { formatNumber, type Translator } from "@/i18n/catalog";
import trainerCard from "@/messages/trainer-card";
import type { CoachNames } from "./coach-text";

type CardT = Translator<typeof trainerCard.en>;

/** What a page in another language sends along: official names in its language (English pages send nothing). */
export interface TrainerLocal extends CoachNames {
  /** Species' names by National Dex number. */
  species: Record<number, string>;
}

/** The rating titles (lib/rating's iqTitle) by their English. */
const IQ_KEY: Record<string, keyof typeof trainerCard.en.iq> = {
  "Pokémon Professor": "professor",
  Champion: "champion",
  "Elite Four": "elite",
  "Gym Leader": "gym",
  "Ace Trainer": "ace",
  Trainer: "trainer",
  Youngster: "youngster",
};

/** A number as the old card wrote it (the browser's own format) in English, in the page's language otherwise. */
const num = (t: CardT, n: number) => (t.locale === "en" ? n.toLocaleString() : formatNumber(n, t.locale));
/** The same, where the card always wrote en-US. */
const usNum = (t: CardT, n: number) => (t.locale === "en" ? n.toLocaleString("en-US") : formatNumber(n, t.locale));

/** Local-first trainer profile: PokéIQ, streaks, bests and badges. */
export function TrainerCard({ local }: { local?: TrainerLocal } = {}) {
  const t = useT(trainerCard);
  const progress = useProgress();
  const account = useAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (progress) setName(progress.name);
  }, [progress]);

  if (!progress) return <Skeleton className="mx-auto h-[75vh] min-h-96 max-w-3xl" />;

  // Safe here: progress (and so this branch) only exists after mount.
  const today = localDateString();
  const iq = progress.rating !== null ? ratingToIQ(progress.rating) : null;
  const iqKey = iq !== null ? IQ_KEY[iqTitle(iq)] : undefined;
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;
  const dailyDays = Object.keys(progress.daily.results).length;
  const dleSolved = Object.values(progress.dle.results).filter((r) => r.solved).length;

  function saveName() {
    if (!isCleanName(name)) return setNameError(t("nameRejected"));
    setNameError(null);
    setTrainerName(name);
    setEditing(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-primary/25 via-primary/5 to-transparent p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Avatar avatar={account.user?.avatar} size={72} />
                <div className="space-y-1">
                  <p className="hud-label text-screen">{t("title")}</p>
                  {editing ? (
                    <>
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveName();
                        }}
                      >
                        <input
                          autoFocus
                          value={name}
                          onChange={(e) => {
                            setName(e.target.value);
                            setNameError(null);
                          }}
                          maxLength={24}
                          aria-invalid={nameError ? true : undefined}
                          className="h-10 rounded-md border border-input bg-background px-3 text-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder={t("namePlaceholder")}
                        />
                        <button type="submit" className="rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
                          {t("save")}
                        </button>
                      </form>
                      {nameError && (
                        <p role="alert" className="text-sm text-destructive">
                          {nameError}
                        </p>
                      )}
                    </>
                  ) : (
                    <button type="button" onClick={() => setEditing(true)} className="group flex items-center gap-2 text-left">
                      <h1 className="font-display text-3xl font-bold uppercase tracking-wide">{progress.name || t("unnamed")}</h1>
                      <Pencil className="h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-label={t("editName")} />
                    </button>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {t("answered", { n: progress.answered, count: num(t, progress.answered) })}
                    {dailyDays > 0 && ` · ${t("dailies", { n: dailyDays })}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-5 text-right">
                <div>
                  <div className="hud-label">PokéIQ</div>
                  <div className="font-display text-5xl font-bold tabular-nums text-screen [text-shadow:0_0_18px_hsl(var(--screen)/0.5)]">{iq ?? "--"}</div>
                  <div className="text-xs text-muted-foreground">{iq !== null ? (iqKey ? t(`iq.${iqKey}`) : iqTitle(iq)) : t("unrated")}</div>
                </div>
                <div data-testid="trainer-cognitive">
                  <div className="hud-label">{t("cognitive")}</div>
                  <div className="font-display text-5xl font-bold tabular-nums text-primary">{progress.cognitive?.score ?? "--"}</div>
                  <div className="text-xs text-muted-foreground">
                    {progress.cognitive ? t("percentile", { p: t.locale === "en" ? ordinal(progress.cognitive.percentile) : progress.cognitive.percentile }) : <Link href="/iq-test" className="hover:underline">{t("takeTest")}</Link>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <CardContent className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-4">
            <Stat label={t("stats.runs")} value={progress.runs} />
            <Stat label={t("stats.accuracy")} value={`${accuracy}%`} />
            <Stat label={t("stats.bestStreak")} value={progress.bestStreak} />
            <Stat label={t("stats.dailyStreak")} value={currentStreak(progress.daily.last, progress.daily.streak, today)} />
            <Stat label={t("stats.dailiesPlayed")} value={dailyDays} />
            <Stat label={t("stats.bestDailyStreak")} value={progress.daily.best} />
            <Stat label={t("stats.dlesSolved")} value={dleSolved} />
            <Stat label={t("stats.dleStreak")} value={dleStats(progress.dle.results, today).playStreak} />
          </CardContent>
        </Card>
      </motion.div>

      <AccountPanel />

      <SettingsCard>
        <EmailSettings />
      </SettingsCard>

      <AvatarPanel names={local} />

      <MyBattleRecord />

      <CoachPanel progress={progress} names={local} />

      {(progress.best["geo:games"] ?? 0) > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">PokéGuessr</CardTitle>
            <Link href="/pokeguessr" className="text-sm text-primary hover:underline">
              {t("play")}
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("stats.gamesPlayed")} value={progress.best["geo:games"] ?? 0} />
            <Stat label={t("stats.bestGame")} value={usNum(t, geoBest(progress.best, false))} />
            <Stat label={t("stats.bestStreak")} value={geoBest(progress.best, true)} />
            <Stat label={t("stats.bestDaily")} value={usNum(t, progress.best["geo:daily"] ?? 0)} />
          </CardContent>
        </Card>
      )}

      {(progress.conn || progress.connPlay) && <ConnectionsCard progress={progress} today={today} t={t} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("badges")} <span className="text-sm font-normal text-muted-foreground">({Object.keys(progress.badges).length}/{BADGES.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 max-[479px]:grid-cols-1 max-[479px]:gap-2 sm:grid-cols-3">
          {BADGES.map((b) => {
            const unlocked = Boolean(progress.badges[b.id]);
            return (
              <div
                key={b.id}
                className={cn("flex items-center gap-3 rounded-md border p-3", unlocked ? "border-warning/40 bg-warning/[0.06]" : "border-foreground/[0.06] opacity-60")}
                title={b.description}
              >
                <BadgeMedal id={b.id} unlocked={unlocked} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold max-sm:whitespace-normal">{b.name}</div>
                  <div className="text-[11px] leading-tight text-muted-foreground max-[479px]:text-xs">{b.description}</div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("personalBests")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-3">{t("mode")}</th>
                {FORMATS.map((f) => (
                  <th key={f} className="p-3 text-right capitalize">{t(`formats.${f}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLAY_MODULES.map((m) => (
                <tr key={m} className="border-b last:border-0">
                  <td className="p-3">
                    <ModeIcon module={m} className="mr-2 inline h-4 w-4 text-muted-foreground" />
                    {MODULE_INFO[m].title}
                  </td>
                  {FORMATS.map((f) => (
                    <td key={f} className="p-3 text-right font-mono tabular-nums">
                      {(progress.best[`${m}:${f}`] !== undefined ? num(t, progress.best[`${m}:${f}`]) : undefined) ?? <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        {t("savedHere")} <Link href="/quiz" className="text-primary hover:underline">{t("playMore")}</Link>
      </p>
    </div>
  );
}

/** Best PokéGuessr game or streak on any map (board keys are "geo:<map>" and "geo:<map>:streak"; older ones carry a style). */
function geoBest(best: Record<string, number>, streak: boolean): number {
  const boards = Object.entries(best).filter(([k]) => /^geo:[a-z]+(:classic|:retro)?(:streak)?$/.test(k) && !/^geo:(games|daily)$/.test(k));
  return Math.max(0, ...boards.filter(([k]) => k.endsWith(":streak") === streak).map(([, v]) => v));
}

/** PokéConnections: the daily streak, games won in every mode, perfect solves and the duel record. */
function ConnectionsCard({ progress, today, t }: { progress: Progress; today: string; t: CardT }) {
  const play = { ...EMPTY_CONN_PLAY, ...progress.connPlay };
  const block = connBlock(progress);
  const stats = connStats(block.results, today);
  return (
    <Card data-testid="trainer-connections">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">PokéConnections</CardTitle>
        <Link href="/pokeconnections" className="text-sm text-primary hover:underline">
          {t("play")}
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("stats.streak")} value={`🔥${stats.playStreak}`} />
        <Stat label={t("stats.bestStreak")} value={Math.max(stats.bestPlayStreak, block.best)} />
        <Stat label={t("stats.gamesWon")} value={play.wins} />
        <Stat label={t("stats.perfect")} value={play.perfect} />
        <Stat label={t("stats.dailiesWon")} value={stats.wins} />
        <Stat label={t("stats.hard")} value={play.hard} />
        <Stat label={t("stats.duelRecord")} value={`${play.duelWins}–${play.duelLosses}${play.duelDraws ? `–${play.duelDraws}` : ""}`} />
        <Stat label={t("stats.badges")} value={`${BADGES.filter((b) => b.id.startsWith("conn-") && progress.badges[b.id]).length}/${BADGES.filter((b) => b.id.startsWith("conn-")).length}`} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-foreground/5 bg-muted/40 p-3 text-center">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

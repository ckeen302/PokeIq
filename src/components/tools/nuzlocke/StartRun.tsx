"use client";

import "./nuzlocke.css";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "@/components/ui/Link";
import { buttonVariants } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useT } from "@/i18n/client";
import nuz from "@/messages/nuzlocke";
import { cn } from "@/lib/utils";
import { DEFAULT_RULES, createRun, type Rules } from "@/lib/nuzlocke/run";
import { listRuns, loadStore, saveRun } from "@/lib/nuzlocke/storage";
import { VERSION_LOOK } from "@/lib/nuzlocke/versions";
import type { GameSummary } from "@/lib/nuzlocke/view";
import { RulesForm } from "./RulesForm";
import { Sheet, Sprite, VersionDot } from "./parts";
import { handOff } from "./handoff";

export const TRACKER_PATH = "/tools/nuzlocke-tracker";
export const runPath = (id: string) => `${TRACKER_PATH}/run?id=${encodeURIComponent(id)}`;

/** The new-run sheet: the game's version, the run's name and its rules; Start saves it and opens it. */
export function StartRun({ games, gameId, onClose }: { games: GameSummary[]; gameId: string; onClose(): void }) {
  const t = useT(nuz);
  const router = useRouter();
  const [game, setGame] = useState(() => games.find((g) => g.id === gameId) ?? games[0]);
  const [version, setVersion] = useState(game.versions[0].id);
  const [name, setName] = useState<string | null>(null);
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [busy, setBusy] = useState(false);
  const versionName = game.versions.find((v) => v.id === version)?.name ?? game.name;
  // The default name is the version's ("FireRed Nuzlocke"), numbered when this device already has one.
  const defaultName = useMemo(() => {
    const base = t("start.nameDefault", { version: versionName });
    const taken = new Set(listRuns(loadStore()).map((r) => r.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }, [t, versionName]);

  const start = () => {
    if (busy) return;
    setBusy(true);
    const run = createRun({ game: game.id, version, name: (name ?? defaultName).trim() || defaultName, rules });
    if (!saveRun(run)) handOff(run);
    router.push(runPath(run.id));
  };

  return (
    <Sheet
      title={t("start.title")}
      onClose={onClose}
      closeLabel={t("picker.close")}
      testId="nz-start"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`${TRACKER_PATH}/${game.id}`} className="text-[14px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t("start.guide")}
          </Link>
          <button type="submit" form="nz-start-form" disabled={busy} className={cn(buttonVariants({ size: "lg" }), "max-sm:w-full")} data-testid="nz-start-go">
            {t("start.start")} <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      }
    >
      <form
        id="nz-start-form"
        tabIndex={-1}
        data-autofocus
        className="space-y-6 pb-1 outline-none"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        {games.length > 1 ? (
          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("start.game")}</span>
            <select
              value={game.id}
              onChange={(e) => {
                const g = games.find((x) => x.id === e.target.value)!;
                setGame(g);
                setVersion(g.versions[0].id);
              }}
              className="h-12 w-full rounded-2xl border border-foreground/[0.1] bg-background px-4 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="nz-start-game"
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="font-display text-[19px] font-bold tracking-tight">{game.name}</p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("start.version")}</legend>
          <div className={cn("grid gap-2", game.versions.length > 2 ? "grid-cols-2 sm:grid-cols-3" : game.versions.length === 2 ? "grid-cols-2" : "grid-cols-1")} role="radiogroup" aria-label={t("start.version")}>
            {game.versions.map((v) => {
              const on = v.id === version;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setVersion(v.id)}
                  data-testid={`nz-version-${v.id}`}
                  className={cn(
                    "flex h-16 items-center gap-2.5 rounded-2xl border px-3 text-left transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                    on ? "border-primary/70 bg-primary/[0.08] shadow-[0_0_0_1px_hsl(var(--primary)/0.45)]" : "border-foreground/[0.1] hover:border-foreground/25"
                  )}
                >
                  <Sprite art={VERSION_LOOK[v.id]?.mascot} className="h-11 w-11 shrink-0" eager />
                  <span className="flex min-w-0 items-center gap-2">
                    <VersionDot id={v.id} />
                    <span className="truncate text-[15.5px] font-bold">{v.name}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {game.versions.length > 1 && <p className="text-[13px] text-muted-foreground">{t("start.versionHint")}</p>}
        </fieldset>

        <label className="block space-y-2">
          <span className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("start.name")}</span>
          <input
            value={name ?? defaultName}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoComplete="off"
            className="h-12 w-full rounded-2xl border border-foreground/[0.1] bg-background px-4 text-[16px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="nz-start-name"
          />
        </label>

        <div className="space-y-2">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("start.rules")}</p>
          <RulesForm t={t} rules={rules} onChange={setRules} />
          <p className="text-[13px] text-muted-foreground">{t("start.rulesLead")}</p>
        </div>

      </form>
    </Sheet>
  );
}

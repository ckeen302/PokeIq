"use client";

import { useRef, useState } from "react";
import { BadgeMinus, Download, Medal, Pencil, Plus, ScrollText, Share2, Trash2, Upload } from "lucide-react";
import Link from "@/components/ui/Link";
import { cn } from "@/lib/utils";
import { NAME_MAX, badgeCount, badgeTotal, levelCap, stats, type Run } from "@/lib/nuzlocke/run";
import type { GameView } from "@/lib/nuzlocke/view";
import { Menu, VersionDot, type MenuItem, type NuzT } from "./parts";
import { TRACKER_PATH } from "./StartRun";

/** Holding the badge counter this long takes a badge off. */
const HOLD_MS = 550;

/**
 * The run's header: its game and version, its name (tap to rename), the level cap, the badge counter (tap to add a
 * badge, hold to take one off; the menu does too), a few numbers, and the menu.
 */
export function RunHeader({ t, run, view, readOnly, onRename, onBadge, onMenu }: { t: NuzT; run: Run; view: GameView; readOnly: boolean; onRename(name: string): void; onBadge(up: boolean): void; onMenu(id: string): void }) {
  const [editing, setEditing] = useState(false);
  const version = view.versions.find((v) => v.id === run.version);
  const s = stats(run);
  const cap = run.rules.caps ? levelCap(run, view) : null;
  const hasCaps = view.steps.some((x) => x.type === "boss" && (x.boss.cap !== undefined || x.boss.capByVersion));
  const badges = badgeCount(run, view);
  const total = badgeTotal(view, run.version);
  const items: MenuItem[] = readOnly
    ? [
        { id: "share", label: t("header.share"), icon: <Share2 /> },
        { id: "export", label: t("header.export"), icon: <Download /> },
      ]
    : [
        { id: "rules", label: t("header.rules"), icon: <ScrollText /> },
        { id: "share", label: t("header.share"), icon: <Share2 /> },
        { id: "export", label: t("header.export"), icon: <Download /> },
        { id: "import", label: t("header.import"), icon: <Upload /> },
        ...(badges > 0 ? [{ id: "badge-off", label: t("header.removeBadge"), icon: <BadgeMinus /> }] : []),
        { id: "delete", label: t("header.delete"), icon: <Trash2 />, danger: true },
      ];

  return (
    <header className="rounded-[26px] border border-foreground/[0.08] bg-card p-4 shadow-[0_20px_50px_-40px_hsl(var(--shade)/0.8)] sm:p-5" data-testid="nz-header">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <VersionDot id={run.version} />
            <span className="shrink-0 text-foreground/85" data-testid="nz-version">{version?.name ?? run.version}</span>
            <span aria-hidden className="max-sm:hidden">·</span>
            <Link href={`${TRACKER_PATH}/${view.id}`} className="truncate underline-offset-4 hover:text-foreground hover:underline max-sm:hidden">
              {view.name}
            </Link>
          </p>
          {editing ? (
            <RenameField t={t} name={run.name} onDone={(n) => (setEditing(false), n !== null && onRename(n))} />
          ) : (
            <h1 className="mt-1 flex min-w-0 items-center gap-2">
              <span className="truncate font-display text-[30px] font-bold leading-tight tracking-tight max-sm:text-[25px]" data-testid="nz-run-name">
                {run.name}
              </span>
              {!readOnly && (
                <button type="button" onClick={() => setEditing(true)} aria-label={t("header.rename")} title={t("header.rename")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10 max-md:w-10" data-testid="nz-rename">
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
              )}
            </h1>
          )}
        </div>
        <Menu label={t("header.menu")} items={items} onPick={onMenu} className="-mr-1 -mt-1" testId="nz-menu" />
      </div>

      <div className={cn("mt-4 grid gap-2.5 sm:gap-3", cap || (hasCaps && run.rules.caps) ? "grid-cols-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]" : "grid-cols-2")}>
        {run.rules.caps && hasCaps && (
          <div className="nz-cap flex min-h-[86px] flex-col justify-center rounded-2xl px-3.5 py-3 max-sm:px-3" data-testid="nz-cap" data-cap={cap?.cap ?? ""}>
            <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("header.levelCap")}</span>
            {cap ? (
              <span className="mt-0.5 flex min-w-0 items-baseline gap-2 max-sm:flex-col max-sm:gap-0">
                <span className="font-display text-[34px] font-bold leading-none text-screen [font-variant-numeric:tabular-nums] max-sm:text-[30px]" data-testid="nz-cap-value">
                  {cap.cap}
                </span>
                <span className="min-w-0 truncate text-[13px] font-semibold text-foreground/80 max-sm:text-[12px]">{t("header.capFor", { boss: cap.boss.name })}</span>
              </span>
            ) : (
              <span className="mt-1 text-[14px] font-semibold">{t("header.noCap")}</span>
            )}
          </div>
        )}
        <BadgeTile t={t} n={badges} total={total} readOnly={readOnly} onBadge={onBadge} />
        <dl className="grid min-h-[86px] grid-cols-3 items-center rounded-2xl bg-foreground/[0.04] px-2 py-3 text-center max-sm:grid-cols-1 max-sm:gap-0.5 max-sm:px-2.5 max-sm:text-left" data-testid="nz-stats">
          {(
            [
              ["caught", s.caught, ""],
              ["alive", s.alive, "text-success"],
              ["dead", s.dead, s.dead ? "text-destructive" : ""],
            ] as const
          ).map(([k, n, tone]) => (
            <div key={k} className="flex flex-col max-sm:flex-row max-sm:items-baseline max-sm:justify-between max-sm:gap-2">
              <dt className="order-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground max-sm:order-1 max-sm:text-[10px]">{t(`header.${k}`)}</dt>
              <dd className={cn("order-1 font-display text-[24px] font-bold leading-tight [font-variant-numeric:tabular-nums] max-sm:order-2 max-sm:text-[15px]", tone)} data-testid={`nz-stat-${k}`}>
                {n}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}

function RenameField({ t, name, onDone }: { t: NuzT; name: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={NAME_MAX}
      aria-label={t("header.renameField")}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() ? value : null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value.trim() ? value : null);
        if (e.key === "Escape") finish(null);
      }}
      onFocus={(e) => e.currentTarget.select()}
      className="mt-1 h-12 w-full max-w-xl rounded-xl border border-foreground/[0.14] bg-background px-3 font-display text-[26px] font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:text-[22px]"
      data-testid="nz-rename-input"
    />
  );
}

/** Badges: tap to add one, hold to take one off. */
function BadgeTile({ t, n, total, readOnly, onBadge }: { t: NuzT; n: number; total: number | null; readOnly: boolean; onBadge(up: boolean): void }) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const dots = total && total <= 8 ? total : null;
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t("header.badges")}</span>
        {!readOnly && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]" aria-hidden>
            <Plus className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="mt-1 flex items-center gap-2">
        <Medal className="h-5 w-5 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
        <span className="font-display text-[24px] font-bold leading-none [font-variant-numeric:tabular-nums] max-sm:text-[21px]" data-testid="nz-badges">
          {n}
          {total ? <span className="text-[15px] text-muted-foreground">/{total}</span> : null}
        </span>
      </span>
      {dots && (
        <span className="mt-2 flex gap-1 max-sm:hidden" aria-hidden>
          {Array.from({ length: dots }, (_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < n ? "bg-[hsl(var(--warning))]" : "bg-foreground/[0.12]")} />
          ))}
        </span>
      )}
    </>
  );
  const cls = "flex min-h-[86px] flex-col justify-center rounded-2xl border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.07)] px-3.5 py-3 text-left max-sm:px-3";
  if (readOnly) return <div className={cls}>{body}</div>;
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      aria-label={total ? t("header.badgeAdd", { n, total }) : t("header.badgeAddHand", { n })}
      title={total ? t("header.badgeAdd", { n, total }) : t("header.badgeAddHand", { n })}
      className={cn(cls, "select-none transition-[filter,transform] [-webkit-touch-callout:none] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100")}
      onPointerDown={() => {
        held.current = false;
        clear();
        timer.current = window.setTimeout(() => {
          held.current = true;
          onBadge(false);
          if (navigator.vibrate) navigator.vibrate(12);
        }, HOLD_MS);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) return void (held.current = false);
        onBadge(true);
      }}
      data-testid="nz-badge-add"
    >
      {body}
    </button>
  );
}

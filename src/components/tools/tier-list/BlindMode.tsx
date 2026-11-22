"use client";

/* eslint-disable @next/next/no-img-element -- remote Pokémon pictures */
import { useEffect, useState } from "react";
import { Check, Copy, Dices, Swords } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import { BLIND_LENGTHS, agreement, isDone, placedCount, slotKeys } from "@/lib/tier-list/blind";
import type { BlindState } from "@/lib/tier-list/state";
import { artUrl, isPixelUrl, type ArtStyle } from "@/lib/tier-list/art";
import type { Mon } from "@/lib/tier-list/types";
import { Field, PillButton, Segmented, useShowOnChange } from "./ui";

interface Props {
  blind: BlindState;
  drawn: string[];
  byKey: ReadonlyMap<string, Mon>;
  art: ArtStyle;
  shiny: boolean;
  /** A challenge link was opened and not played yet. */
  challenge: boolean;
  onSetup(patch: Partial<Pick<BlindState, "length" | "source">>): void;
  onPlace(slot: number): void;
  onNewDraw(): void;
  onAccept(): void;
  onChallenge(name: string): Promise<boolean>;
}

/** Blind Ranking: one card at a time, flipped over; every Pokémon goes into a free slot for good. */
export function BlindMode(p: Props) {
  const placed = placedCount(p.blind.slots);
  const done = isDone(p.blind.slots);
  const [started, setStarted] = useState(placed > 0);
  useEffect(() => {
    if (placed > 0) setStarted(true);
  }, [placed]);

  const phase = p.challenge ? "challenge" : done ? "done" : started ? "reveal" : "setup";
  const ref = useShowOnChange<HTMLDivElement>(phase);
  return (
    <div ref={ref} className="scroll-mt-20">
      {phase === "challenge" ? <ChallengeIntro {...p} /> : phase === "done" ? <Result {...p} /> : phase === "reveal" ? <Reveal {...p} /> : <Setup {...p} onStart={() => setStarted(true)} />}
    </div>
  );
}

function Setup(p: Props & { onStart(): void }) {
  const t = useT(tierList);
  return (
    <div className="mx-auto max-w-xl space-y-6 text-center" data-testid="blind-setup">
      <div className="relative mx-auto h-[220px] w-[170px]">
        <div className="tlm-card-back absolute inset-0 rotate-[-8deg] rounded-[24px] border border-white/10 opacity-60" />
        <div className="tlm-card-back absolute inset-0 rotate-[5deg] rounded-[24px] border border-white/10 opacity-80" />
        <div className="tlm-card-back absolute inset-0 flex items-center justify-center rounded-[24px] border border-white/15 font-display text-6xl font-bold text-white/80">?</div>
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{t("blind.setup")}</h2>
        <p className="text-[15px] text-muted-foreground">{t("blind.explain")}</p>
      </div>
      <div className="flex flex-wrap items-end justify-center gap-5 text-left">
        <Field label={t("blind.length")}>
          <Segmented label={t("blind.length")} value={p.blind.length} onChange={(v) => p.onSetup({ length: v })} options={BLIND_LENGTHS.map((n) => ({ value: n, label: String(n), testId: `blind-length-${n}` }))} />
        </Field>
        <Field label={t("blind.source")}>
          <Segmented
            label={t("blind.source")}
            value={p.blind.source}
            onChange={(v) => p.onSetup({ source: v })}
            options={[
              { value: "template", label: t("blind.fromTemplate") },
              { value: "random", label: t("blind.fromRandom"), testId: "blind-source-random" },
            ]}
          />
        </Field>
      </div>
      <PillButton primary onClick={p.onStart} disabled={!p.drawn.length} className="h-12 px-10 text-[15px]" testId="blind-start">
        {t("blind.start")}
      </PillButton>
    </div>
  );
}

function Reveal(p: Props) {
  const t = useT(tierList);
  const placed = placedCount(p.blind.slots);
  const total = Math.min(p.blind.length, p.drawn.length);
  const key = p.drawn[placed];
  const mon = key ? p.byKey.get(key) : undefined;
  const [shown, setShown] = useState(false);
  // Each new card starts face down and flips over.
  useEffect(() => {
    setShown(false);
    const id = setTimeout(() => setShown(true), 260);
    return () => clearTimeout(id);
  }, [placed]);
  const place = p.onPlace;
  const slots = p.blind.slots;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = e.key === "0" ? 10 : Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= slots.length) {
        e.preventDefault();
        place(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [place, slots.length]);
  const keys = slotKeys(slots, p.drawn);
  const src = mon ? artUrl(mon, p.art, p.shiny) : "";
  return (
    <div className="mx-auto grid max-w-4xl items-start gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-md:gap-5" data-testid="blind-reveal">
      <div className="flex flex-col items-center gap-3 md:sticky md:top-2">
        <p className="text-sm font-medium text-muted-foreground" data-testid="blind-count">{t("blind.reveal", { n: placed + 1, total })}</p>
        <div className="tlm-flip relative aspect-[3/4] w-full max-w-[320px] max-md:max-w-[200px]" data-shown={shown ? "true" : "false"} data-testid="blind-card">
          <div className="tlm-flip-inner">
            <div className="tlm-flip-face tlm-flip-front tlm-card-back flex items-center justify-center border border-white/15 font-display text-7xl font-bold text-white/70">?</div>
            <div className="tlm-flip-face tlm-flip-back flex flex-col items-center justify-end overflow-hidden border border-foreground/10 bg-card p-4 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.5)]" style={{ background: "radial-gradient(70% 55% at 50% 42%, hsl(var(--primary) / 0.18), transparent 72%), hsl(var(--card))" }}>
              {mon && <img src={src} alt={mon.n} draggable={false} className={cn("absolute inset-x-[8%] top-[6%] h-[72%] w-[84%] object-contain drop-shadow-[0_14px_22px_rgb(0_0_0/0.35)]", isPixelUrl(src) && "[image-rendering:pixelated]")} />}
              <p className="relative font-display text-2xl font-semibold tracking-tight max-md:text-lg" data-testid="blind-name">{mon?.n}</p>
            </div>
          </div>
        </div>
        <p className="text-center text-sm text-muted-foreground">{t("blind.place")} <span className="max-md:hidden">{t("blind.placeHint")}</span></p>
      </div>
      <ol className="space-y-1.5" data-testid="blind-slots">
        {keys.map((k, i) => {
          const m = k ? p.byKey.get(k) : undefined;
          const s = m ? artUrl(m, p.art, p.shiny) : "";
          return (
            <li key={i}>
              <button
                type="button"
                disabled={!!m || !shown}
                onClick={() => place(i)}
                className={cn(
                  "flex h-14 w-full items-center gap-3 rounded-2xl px-2 text-left transition-colors max-md:h-12",
                  m ? "bg-foreground/[0.05]" : "border border-dashed border-foreground/[0.14] hover:border-primary/70 hover:bg-primary/[0.06] disabled:hover:border-foreground/[0.14] disabled:hover:bg-transparent"
                )}
                aria-label={m ? t("blind.slotTaken", { n: i + 1, name: m.n }) : t("blind.slotFree", { n: i + 1 })}
                data-testid="blind-slot"
              >
                <span className={cn("w-9 shrink-0 text-center font-display text-lg font-bold", i < 3 ? "text-[hsl(var(--warning))]" : "text-muted-foreground")}>{i + 1}</span>
                {m && (
                  <>
                    <img src={s} alt="" className={cn("tlm-pop h-11 w-11 object-contain max-md:h-9 max-md:w-9", isPixelUrl(s) && "[image-rendering:pixelated]")} draggable={false} />
                    <span className="truncate font-display text-[15px] font-semibold">{m.n}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RunList({ title, keys, byKey, art, shiny, accent, other }: { title: string; keys: (string | null)[]; byKey: ReadonlyMap<string, Mon>; art: ArtStyle; shiny: boolean; accent: string; other?: (string | null)[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="truncate font-display text-lg font-semibold" style={{ color: accent }}>{title}</p>
      <ol className="space-y-1.5">
        {keys.map((k, i) => {
          const m = k ? byKey.get(k) : undefined;
          const s = m ? artUrl(m, art, shiny) : "";
          const same = other && k && other[i] === k;
          return (
            <li key={i} className={cn("flex h-14 items-center gap-2.5 rounded-2xl bg-foreground/[0.04] px-2 max-sm:h-12 max-sm:gap-1.5", same && "ring-1 ring-success/60")}>
              <span className={cn("w-8 shrink-0 text-center font-display text-lg font-bold max-sm:w-6 max-sm:text-base", i < 3 ? "text-[hsl(var(--warning))]" : "text-muted-foreground")}>{i + 1}</span>
              {m && <img src={s} alt="" className={cn("h-11 w-11 shrink-0 object-contain max-sm:h-9 max-sm:w-9", isPixelUrl(s) && "[image-rendering:pixelated]")} draggable={false} />}
              <span className="truncate font-display text-[15px] font-semibold max-sm:text-[13px]">{m?.n}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Result(p: Props) {
  const t = useT(tierList);
  const mine = slotKeys(p.blind.slots, p.drawn);
  const vs = p.blind.vs ? slotKeys(p.blind.vs.slots, p.drawn) : null;
  const [name, setName] = useState(p.blind.name ?? "");
  const [copied, setCopied] = useState(false);
  const same = p.blind.vs ? Math.round(agreement(p.blind.slots, p.blind.vs.slots) * p.blind.length) : 0;
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="blind-result">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{vs ? t("blind.compare") : t("blind.done")}</h2>
        {vs && <p className="text-sm text-muted-foreground" data-testid="blind-same">{t("blind.same", { n: same })}</p>}
      </div>
      <div className={cn("grid gap-4", vs && "grid-cols-2 max-sm:gap-2.5")} data-testid={vs ? "blind-compare" : undefined}>
        <RunList title={p.blind.name || t("blind.you")} keys={mine} byKey={p.byKey} art={p.art} shiny={p.shiny} accent="hsl(var(--primary))" other={vs ?? undefined} />
        {vs && <RunList title={p.blind.vs!.name || t("blind.friend")} keys={vs} byKey={p.byKey} art={p.art} shiny={p.shiny} accent="hsl(var(--screen))" other={mine} />}
      </div>
      <div className="space-y-3 rounded-[24px] border border-foreground/[0.07] bg-foreground/[0.03] p-5">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          <Swords className="h-5 w-5 text-primary" aria-hidden /> {t("blind.challenge")}
        </p>
        <p className="text-sm text-muted-foreground">{t("blind.challengeHint")}</p>
        <div className="flex gap-2 max-sm:flex-col">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            placeholder={t("blind.yourName")}
            aria-label={t("blind.yourName")}
            className="h-11 min-w-0 flex-1 rounded-xl bg-foreground/[0.06] px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={24}
            data-testid="blind-name-input"
          />
          <PillButton
            primary
            className="h-11"
            testId="blind-challenge"
            onClick={async () => {
              if (await p.onChallenge(name.trim())) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
          >
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? t("share.copied") : t("blind.copyChallenge")}
          </PillButton>
        </div>
      </div>
      <PillButton onClick={p.onNewDraw} testId="blind-again">
        <Dices className="h-4 w-4" aria-hidden /> {t("blind.again")}
      </PillButton>
    </div>
  );
}

function ChallengeIntro(p: Props) {
  const t = useT(tierList);
  return (
    <div className="mx-auto max-w-xl space-y-5 text-center" data-testid="blind-challenge-intro">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Swords className="h-7 w-7" aria-hidden />
      </div>
      <h2 className="font-display text-3xl font-semibold tracking-tight">{p.blind.vs?.name ? t("blind.challengeFrom", { name: p.blind.vs.name }) : t("blind.challengeFromFriend")}</h2>
      <p className="text-[15px] text-muted-foreground">{t("blind.challengeIntro")}</p>
      <PillButton primary onClick={p.onAccept} className="h-12 px-10 text-[15px]" testId="blind-accept">
        {t("blind.accept")}
      </PillButton>
    </div>
  );
}

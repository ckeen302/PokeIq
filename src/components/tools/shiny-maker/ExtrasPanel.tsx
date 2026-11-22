"use client";

import { useState, type ReactNode } from "react";
import { Download, Redo2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tools from "@/messages/tools";
import { hex, lchToRgb } from "@/lib/shiny-maker/color";
import { BACKGROUNDS, FINISHES, NAME_MAX, type Background, type Design, type Finish, type Style } from "@/lib/shiny-maker/design";
import { TYPES, TYPE_THEMES, type Preset, type TypeName } from "@/lib/shiny-maker/presets";
import { Dot } from "./ColourControls";

export type ColourBlind = "off" | "deutan" | "protan" | "tritan";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">{title}</h3>
      {children}
    </section>
  );
}

export function Seg<T extends string>({ value, items, onChange, label, testId, disabled }: { value: T; items: { v: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] p-1" role="radiogroup" aria-label={label} data-testid={testId}>
      {items.map((it) => (
        <button
          key={it.v}
          type="button"
          role="radio"
          aria-checked={it.v === value}
          disabled={disabled || it.disabled}
          title={it.title}
          onClick={() => onChange(it.v)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-40 max-lg:h-10",
            it.v === value ? "bg-white/[0.11] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-muted-foreground hover:text-foreground"
          )}
          data-value={it.v}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Chip({ on, onClick, children, testId, title }: { on?: boolean; onClick: () => void; children: ReactNode; testId?: string; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      data-testid={testId}
      className={cn(
        "flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 max-lg:h-10",
        on ? "border-white/25 bg-white/[0.1] text-foreground" : "border-white/[0.07] text-foreground/75 hover:border-white/15 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onChange, label, disabled, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className="flex h-9 items-center gap-2.5 rounded-full pr-1 text-[13.5px] text-foreground/85 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40 max-lg:h-10"
    >
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", on ? "bg-primary" : "bg-white/15")} aria-hidden>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
      </span>
      {label}
    </button>
  );
}

const PRESET_SWATCH: Record<Exclude<Preset, "normal" | "official">, [number, number, number][]> = {
  gold: [[0.8, 0.13, 82], [0.62, 0.12, 70]],
  silver: [[0.86, 0.012, 250], [0.62, 0.015, 250]],
  obsidian: [[0.3, 0.03, 285], [0.72, 0.17, 45]],
  pastel: [[0.88, 0.07, 350], [0.88, 0.07, 200]],
  neon: [[0.74, 0.3, 330], [0.8, 0.2, 200]],
  inverted: [[0.7, 0.15, 30], [0.7, 0.12, 210]],
};
const sw = ([l, c, h]: [number, number, number]) => hex(lchToRgb(l, c, h));

export interface ExtrasProps {
  design: Design;
  hdAvailable: boolean;
  hdReason: string | null;
  canAnimate: boolean;
  canGif: boolean;
  gifBusy: boolean;
  cb: ColourBlind;
  expert: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onStyle: (s: Style) => void;
  onPreset: (p: Preset | TypeName) => void;
  onBorrow: () => void;
  onFinish: (f: Finish) => void;
  onToggle: (k: "sparkle" | "glow" | "anim", v: boolean) => void;
  onBg: (b: Background) => void;
  onName: (n: string) => boolean;
  onCb: (c: ColourBlind) => void;
  onExpert: (v: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPng: (scale: number) => void;
  onGif: () => void;
}

export function ExtrasPanel(p: ExtrasProps) {
  const t = useT(tools);
  const { design } = p;
  const [name, setName] = useState(design.name);
  const [nameBad, setNameBad] = useState(false);
  const commitName = () => setNameBad(!p.onName(name));
  return (
    <div className="space-y-6" data-testid="sm-extras">
      <Section title={t("extras.style")}>
        <Seg
          label={t("extras.style")}
          value={design.style}
          onChange={p.onStyle}
          testId="sm-style"
          items={[
            { v: "px", label: t("extras.pixel") },
            { v: "hd", label: t("extras.hd"), disabled: !p.hdAvailable, title: p.hdReason ?? undefined },
          ]}
        />
        {p.hdReason && <p className="text-[12.5px] text-muted-foreground">{p.hdReason}</p>}
      </Section>

      <Section title={t("extras.start")}>
        <div className="flex flex-wrap gap-2">
          <Chip onClick={() => p.onPreset("normal")} testId="sm-preset-normal">{t("extras.startNormal")}</Chip>
          <Chip onClick={() => p.onPreset("official")} testId="sm-preset-official">{t("extras.startOfficial")}</Chip>
          {(Object.keys(PRESET_SWATCH) as (keyof typeof PRESET_SWATCH)[]).map((k) => (
            <Chip key={k} onClick={() => p.onPreset(k)} testId={`sm-preset-${k}`}>
              <span className="flex -space-x-1">{PRESET_SWATCH[k].map((c, i) => <Dot key={i} color={sw(c)} size={12} />)}</span>
              {t(`extras.${k}`)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label={t("extras.types")}>
          {TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              title={t(`types.${ty}`)}
              aria-label={t(`types.${ty}`)}
              onClick={() => p.onPreset(ty)}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 max-lg:h-10 max-lg:w-10"
              data-testid={`sm-type-${ty}`}
            >
              <span className="relative block h-5 w-5 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]" style={{ background: `conic-gradient(${sw(TYPE_THEMES[ty][0])} 0 50%, ${sw(TYPE_THEMES[ty][1])} 0 75%, ${sw(TYPE_THEMES[ty][2])} 0)` }} aria-hidden />
            </button>
          ))}
        </div>
        <button type="button" onClick={p.onBorrow} className="text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sm-borrow">
          {t("extras.borrow")}
        </button>
      </Section>

      <Section title={t("extras.finish")}>
        <div className="flex flex-wrap gap-2">
          {FINISHES.map((f) => (
            <Chip key={f} on={design.finish === f} onClick={() => p.onFinish(f)} testId={`sm-finish-${f}`}>
              {t(`extras.finishes.${f}`)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title={t("extras.effects")}>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <Toggle on={design.sparkle} onChange={(v) => p.onToggle("sparkle", v)} label={t("extras.sparkle")} testId="sm-sparkle" />
          <Toggle on={design.glow} onChange={(v) => p.onToggle("glow", v)} label={t("extras.glow")} testId="sm-glow" />
          {p.canAnimate && <Toggle on={design.anim} onChange={(v) => p.onToggle("anim", v)} label={t("extras.animate")} testId="sm-anim" />}
        </div>
      </Section>

      <Section title={t("extras.background")}>
        <Seg<Background>
          label={t("extras.background")}
          value={design.bg}
          onChange={p.onBg}
          testId="sm-bg"
          items={BACKGROUNDS.map((b) => ({ v: b, label: t(b === "glow" ? "extras.bgGlow" : b === "plain" ? "extras.bgPlain" : "extras.bgNone") }))}
        />
      </Section>

      <Section title={t("extras.download")}>
        <div className="flex flex-wrap items-center gap-2">
          {(design.style === "hd" ? [1] : [1, 4, 8]).map((n) => (
            <Chip key={n} onClick={() => p.onPng(n)} testId={`sm-png-${n}`}>
              <Download className="h-3.5 w-3.5" aria-hidden /> {t("extras.png")} {design.style === "hd" ? "" : t("extras.pngSize", { n })}
            </Chip>
          ))}
          {p.canGif && (
            <Chip onClick={p.onGif} testId="sm-gif">
              <Download className="h-3.5 w-3.5" aria-hidden /> {p.gifBusy ? t("extras.making") : t("extras.gif")}
            </Chip>
          )}
        </div>
      </Section>

      <Section title={t("extras.name")}>
        <input
          value={name}
          maxLength={NAME_MAX}
          placeholder={t("extras.namePlaceholder")}
          onChange={(e) => { setName(e.target.value); setNameBad(false); }}
          onBlur={commitName}
          onKeyDown={(e) => e.key === "Enter" && commitName()}
          aria-label={t("extras.name")}
          aria-invalid={nameBad}
          className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 text-[14px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-white/25"
          data-testid="sm-name"
        />
        {nameBad && <p className="text-[12.5px] text-destructive" role="alert">{t("extras.nameRejected")}</p>}
      </Section>

      <Section title={t("extras.colourBlind")}>
        <Seg<ColourBlind>
          label={t("extras.colourBlind")}
          value={p.cb}
          onChange={p.onCb}
          testId="sm-cb"
          items={[
            { v: "off", label: t("extras.cbOff") },
            { v: "deutan", label: t("extras.cbDeutan") },
            { v: "protan", label: t("extras.cbProtan") },
            { v: "tritan", label: t("extras.cbTritan") },
          ]}
        />
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
        <div>
          <Toggle on={p.expert} onChange={p.onExpert} label={t("extras.expert")} testId="sm-expert" />
          <p className="pl-[46px] text-[12px] text-muted-foreground">{t("extras.expertHint")}</p>
        </div>
        <div className="flex gap-1" role="group" aria-label={t("extras.history")}>
          <button type="button" disabled={!p.canUndo} onClick={p.onUndo} aria-label={t("extras.undo")} title={`${t("extras.undo")} (⌘Z)`} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-30" data-testid="sm-undo">
            <Undo2 className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <button type="button" disabled={!p.canRedo} onClick={p.onRedo} aria-label={t("extras.redo")} title={`${t("extras.redo")} (⇧⌘Z)`} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-30" data-testid="sm-redo">
            <Redo2 className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

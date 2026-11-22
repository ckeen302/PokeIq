"use client";

import { useEffect, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tools from "@/messages/tools";
import { hex, lchToRgb, maxChroma, parseHex, rgbToLch, type RGB } from "@/lib/shiny-maker/color";
import type { Species } from "@/lib/shiny-maker/data";
import { quantise, type Design, type PartColour } from "@/lib/shiny-maker/design";
import { partRefs, partSwatch, slotColours } from "@/lib/shiny-maker/recolor";
import { Dot, HueRing, type Tone } from "./ColourControls";

/** Eight shiny-worthy colours: gold, coral, rose, mint, sky, violet, pearl, charcoal ([l, c, h]). */
const CURATED: [number, number, number][] = [
  [0.8, 0.14, 82],
  [0.7, 0.16, 28],
  [0.76, 0.13, 350],
  [0.8, 0.13, 158],
  [0.72, 0.12, 235],
  [0.62, 0.16, 298],
  [0.9, 0.015, 260],
  [0.34, 0.03, 285],
];

/** The swatch as it would sit on this part: its hue and colourfulness, the lightness pulled toward the part's own. */
export function curatedFor(refL: number): PartColour[] {
  return CURATED.map(([l, c, h]) => quantise({ l: l * 0.6 + refL * 0.4, c, h, k: 1 }));
}

export function ColourPanel({
  sp,
  design,
  part,
  locked,
  expert,
  onBegin,
  onLive,
  onCommit,
  onReset,
  onToggleLock,
  onShade,
  compact,
}: {
  sp: Species;
  design: Design;
  part: number;
  locked: boolean;
  expert: boolean;
  onBegin: () => void;
  onLive: (c: PartColour) => void;
  onCommit: (c: PartColour) => void;
  onReset: () => void;
  onToggleLock: () => void;
  onShade: (slot: number, rgb: RGB | null) => void;
  compact?: boolean;
}) {
  const t = useT(tools);
  const st = design.parts[part];
  const refs = partRefs(sp, st?.src ?? 1);
  const ref = refs[part];
  const current: PartColour = st?.col ?? quantise({ l: ref.l, c: ref.c, h: ref.h, k: 1 });
  const tone: Tone = { l: current.l, h: current.h, x: Math.min(1, current.c / Math.max(0.0001, maxChroma(current.l, current.h))) };
  const swatchHex = hex(partSwatch(sp, design, part));
  const [hexText, setHexText] = useState(swatchHex);
  useEffect(() => setHexText(swatchHex), [swatchHex]);
  const name = sp.parts[part]?.n ?? "";

  const fromTone = (tn: Tone): PartColour => quantise({ l: tn.l, h: tn.h, c: tn.x * maxChroma(tn.l, tn.h), k: current.k });
  const swatches = curatedFor(ref.l);
  const currentHex = st?.col ? hex(lchToRgb(st.col.l, st.col.c, st.col.h)) : "";

  const commitHex = (s: string) => {
    const rgb = parseHex(s);
    if (!rgb) { setHexText(swatchHex); return; }
    const c = rgbToLch(...rgb);
    onBegin();
    onCommit(quantise({ l: c.l, c: c.c, h: c.h, k: current.k }));
  };

  const ringSize = compact ? 168 : 176;
  const shades = expert ? sp.parts[part].s.slice().sort((a, b) => sp.slots[b].nl.l - sp.slots[a].nl.l) : [];
  const shown = expert ? slotColours(sp, design).rgb : [];

  return (
    <div className={cn("flex gap-5", compact ? "flex-col items-center gap-4" : "items-center")}>
      <div className={cn("flex items-center gap-5", compact && "w-full justify-center")}>
        <HueRing
          tone={tone}
          size={ringSize}
          onStart={onBegin}
          onChange={(tn) => onLive(fromTone(tn))}
          labels={{ hue: t("colour.hue"), tone: t("colour.tone"), toneValue: t("colour.toneValue", { l: Math.round(tone.l * 100), c: Math.round(tone.x * 100) }) }}
        />
        <div className="flex w-[140px] flex-col justify-center gap-4">
          <div className="grid grid-cols-4 gap-x-3 gap-y-3.5" role="group" aria-label={t("colour.swatches")}>
            {swatches.map((c, i) => {
              const h = hex(lchToRgb(c.l, c.c, c.h));
              return (
                <button
                  key={i}
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80 max-lg:h-10 max-lg:w-10"
                  aria-label={t("colour.use", { hex: h.toUpperCase() })}
                  onClick={() => { onBegin(); onCommit({ ...c, k: current.k }); }}
                  data-testid="sm-swatch"
                >
                  <Dot color={h} size={24} ring={h === currentHex} />
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] pt-3 text-[13px]">
            <input
              value={hexText}
              onChange={(e) => setHexText(e.target.value)}
              onBlur={(e) => commitHex(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value); }}
              aria-label={t("colour.hex")}
              spellCheck={false}
              maxLength={7}
              className="h-8 w-[78px] rounded-md bg-transparent px-1 font-mono uppercase tracking-wide text-muted-foreground outline-none transition-colors hover:bg-white/[0.05] focus:bg-white/[0.07] focus:text-foreground"
              data-testid="sm-hex"
            />
            <button type="button" onClick={onReset} className="h-8 rounded-md px-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="sm-reset">
              {t("colour.reset")}
            </button>
          </div>
          <button
            type="button"
            onClick={onToggleLock}
            aria-pressed={locked}
            className={cn("-mt-1.5 flex h-8 items-center gap-1.5 rounded-md text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", locked ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            data-testid="sm-lock"
          >
            {locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <LockOpen className="h-3.5 w-3.5" aria-hidden />}
            {locked ? t("colour.locked") : t("colour.lock")}
          </button>
        </div>
      </div>
      {expert && (
        <div className={cn("flex flex-col gap-3 border-white/[0.07] text-[12.5px] text-muted-foreground", compact ? "w-full border-t pt-3" : "w-[170px] border-l pl-5")}>
          <label className="flex flex-col gap-1.5">
            <span>{t("colour.contrast")}</span>
            <input
              type="range"
              min={0.25}
              max={1.99}
              step={1 / 128}
              value={current.k}
              onPointerDown={onBegin}
              onKeyDown={(e) => !e.repeat && onBegin()}
              onChange={(e) => onLive(quantise({ ...current, k: Number(e.target.value) }))}
              className="accent-primary"
            />
          </label>
          <div>
            <span>{t("colour.shades")}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {shades.map((s, i) => {
                const own = design.shades[s];
                return (
                  <label key={s} className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-md ring-1 ring-white/15 focus-within:ring-2 focus-within:ring-white/80" title={t("colour.shade", { n: i + 1 })}>
                    <span className="absolute inset-0" style={{ background: hex(shown[s] ?? [0, 0, 0]) }} />
                    {own && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-white" aria-hidden />}
                    <input
                      type="color"
                      className="absolute inset-0 cursor-pointer opacity-0"
                      aria-label={t("colour.shade", { n: i + 1 })}
                      value={hex(shown[s] ?? [0, 0, 0])}
                      onChange={(e) => { const rgb = parseHex(e.target.value); if (rgb) onShade(s, rgb); }}
                    />
                  </label>
                );
              })}
            </div>
            {shades.some((s) => design.shades[s]) && (
              <button type="button" className="mt-2 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => shades.forEach((s) => onShade(s, null))}>
                {t("colour.reset")}
              </button>
            )}
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{name}</span>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import msgs from "@/messages/pokeball-maker";
import { hex, lchToRgb, maxChroma, parseHex, rgbToLch } from "@/lib/shiny-maker/color";
import type { RGB } from "@/lib/pokeball-maker/design";
import { Dot, HueRing, type Tone } from "@/components/tools/shiny-maker/ColourControls";

/** Ball colours worth a tap: the classic red, white and black, then gold, blue, green, pink, purple, teal and silver. */
const SWATCHES: RGB[] = [
  [227, 38, 47], [246, 246, 242], [27, 27, 31], [242, 194, 48], [47, 111, 224], [63, 174, 74], [240, 127, 180], [123, 63, 198], [42, 143, 184], [184, 192, 204], [243, 154, 43], [58, 52, 64],
];

/**
 * The Shiny Pokémon Maker's colour picker (a hue ring round a lightness × colourfulness plane, in OKLCH), with ball
 * swatches and a hex field. `onBegin` marks the start of a gesture (one undo step), `onChange` follows it live.
 */
export function ColourPicker({ value, onBegin, onChange, compact, label }: { value: RGB; onBegin: () => void; onChange: (c: RGB) => void; compact?: boolean; label: string }) {
  const t = useT(msgs);
  const lch = rgbToLch(value[0], value[1], value[2]);
  // Greys have no hue of their own: keep the ring where the user left it.
  const [hue, setHue] = useState(lch.h);
  useEffect(() => {
    if (lch.c > 0.015) setHue(lch.h);
  }, [lch.h, lch.c]);
  const tone: Tone = { l: lch.l, h: lch.c > 0.015 ? lch.h : hue, x: Math.min(1, lch.c / Math.max(0.0001, maxChroma(lch.l, lch.c > 0.015 ? lch.h : hue))) };
  const now = hex(value);
  const [text, setText] = useState(now);
  useEffect(() => setText(now), [now]);
  const commitHex = (s: string) => {
    const rgb = parseHex(s.startsWith("#") ? s : `#${s}`);
    if (!rgb) return setText(now);
    onBegin();
    onChange(rgb);
  };
  return (
    <div className={cn("flex items-center gap-5", compact && "flex-col gap-4")} role="group" aria-label={label}>
      <HueRing
        tone={tone}
        size={compact ? 168 : 172}
        onStart={onBegin}
        onChange={(tn) => {
          setHue(tn.h);
          onChange(lchToRgb(tn.l, tn.x * maxChroma(tn.l, tn.h), tn.h));
        }}
        labels={{ hue: t("colour.hue"), tone: t("colour.tone"), toneValue: t("colour.toneValue", { l: Math.round(tone.l * 100), c: Math.round(tone.x * 100) }) }}
      />
      <div className={cn("flex flex-col gap-3", compact ? "w-full" : "w-[156px]")}>
        <div className={cn("grid gap-x-2.5 gap-y-2.5", compact ? "grid-cols-6 justify-items-center" : "grid-cols-4")} role="group" aria-label={t("colour.swatches")}>
          {SWATCHES.map((c, i) => {
            const h = hex(c);
            return (
              <button
                key={i}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80 max-lg:h-10 max-lg:w-10"
                aria-label={t("colour.use", { hex: h.toUpperCase() })}
                onClick={() => { onBegin(); onChange(c); }}
                data-testid="pbm-swatch"
              >
                <Dot color={h} size={24} ring={h === now} />
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 border-t border-white/[0.07] pt-3 text-[13px]">
          <Dot color={now} size={16} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value); }}
            aria-label={t("colour.hex")}
            spellCheck={false}
            maxLength={7}
            className="h-8 w-[84px] rounded-md bg-transparent px-1 font-mono uppercase tracking-wide text-muted-foreground outline-none transition-colors hover:bg-white/[0.05] focus:bg-white/[0.07] focus:text-foreground"
            data-testid="pbm-hex"
          />
        </label>
      </div>
    </div>
  );
}

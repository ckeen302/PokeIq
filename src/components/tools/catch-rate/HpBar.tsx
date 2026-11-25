"use client";

import { useRef } from "react";
import { useT } from "@/i18n/client";
import msgs from "@/messages/catch-rate";

/**
 * The HP bar, drawn like the games' own: an "HP" tag, a dark track, and a fill that turns yellow at half and red at a
 * fifth. Drag it (mouse, touch, pen) or use the keyboard (arrows ±1 HP, Page Up/Down ±10%, Home/End): it's a slider.
 */
export function hpColour(f: number): "green" | "yellow" | "red" {
  return f > 0.5 ? "green" : f > 0.2 ? "yellow" : "red";
}
const FILL = {
  green: "linear-gradient(180deg, #7dfc9a 0 30%, #2bd66a 30% 100%)",
  yellow: "linear-gradient(180deg, #ffe680 0 30%, #f5c518 30% 100%)",
  red: "linear-gradient(180deg, #ff9a8a 0 30%, #f0452f 30% 100%)",
};

export function HpBar({ hp, max, onChange, locale }: { hp: number; max: number; onChange(hp: number): void; locale: string }) {
  const t = useT(msgs);
  const track = useRef<HTMLDivElement>(null);
  const f = hp / max;
  const colour = hpColour(f);
  const pctText = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(Math.max(f, 0.01));

  const fromX = (x: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    const v = Math.min(1, Math.max(0, (x - r.left) / r.width));
    onChange(Math.max(1, Math.round(v * max)));
  };
  const key = (e: React.KeyboardEvent) => {
    const step = Math.max(1, Math.round(max / 10));
    const next = { ArrowLeft: hp - 1, ArrowDown: hp - 1, ArrowRight: hp + 1, ArrowUp: hp + 1, PageDown: hp - step, PageUp: hp + step, Home: 1, End: max }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onChange(Math.min(max, Math.max(1, next)));
  };

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-[#2b2a3d] py-[3px] pl-[5px] pr-[4px] shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_0_rgb(255_255_255/0.6)]">
      <span className="rounded-full bg-gradient-to-b from-[#ffd34d] to-[#f0a800] px-1.5 py-px font-display text-[10.5px] font-bold italic leading-none tracking-wide text-[#3a2600]" aria-hidden>
        HP
      </span>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={t("hp.label")}
        aria-valuemin={1}
        aria-valuemax={max}
        aria-valuenow={hp}
        aria-valuetext={t("hp.valueText", { hp, max, pct: pctText })}
        onKeyDown={key}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          e.currentTarget.focus({ preventScroll: true });
          fromX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) fromX(e.clientX);
        }}
        className="group relative h-4 flex-1 cursor-ew-resize touch-none rounded-full bg-[#101019] outline-none ring-offset-1 ring-offset-[#2b2a3d] before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] focus-visible:ring-2 focus-visible:ring-[#8b7cff]"
        data-testid="cr-hp"
        data-hp={hp}
      >
        <div
          className="absolute inset-y-[2px] left-[2px] rounded-full transition-[width] duration-150 ease-out motion-reduce:transition-none"
          style={{ width: `calc((100% - 4px) * ${Math.max(f, 0.015)})`, background: FILL[colour] }}
          data-colour={colour}
        />
        {/* The thumb: a notch at the bar's end, easy to grab on a phone. */}
        <span
          className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[#2b2a3d] bg-white shadow-[0_2px_6px_rgb(0_0_0/0.45)] transition-transform group-active:scale-110"
          style={{ left: `calc(2px + (100% - 4px) * ${f})` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

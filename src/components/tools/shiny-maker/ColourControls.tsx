"use client";

import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { hex, lchToRgb, maxChroma, oklabToLinear, wrapHue } from "@/lib/shiny-maker/color";

/** A swatch dot with a soft highlight, as in the dock. */
export function Dot({ color, size = 18, ring, className, style }: { color: string; size?: number; ring?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full transition-[outline-color] duration-150", ring ? "outline outline-2 outline-offset-[3px] outline-white/85" : "outline outline-2 outline-offset-[3px] outline-transparent", className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.28), transparent 55%), ${color}`,
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.5)",
        ...style,
      }}
      aria-hidden
    />
  );
}

export function Knob({ color, style, size = 20 }: { color: string; style?: CSSProperties; size?: number }) {
  return (
    <span
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white"
      style={{ width: size, height: size, background: color, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.25), 0 2px 8px rgb(0 0 0 / 0.45)", ...style }}
      aria-hidden
    />
  );
}

const RING_HUES = Array.from({ length: 25 }, (_, i) => hex(lchToRgb(0.74, 0.14, i * 15)));
const L_TOP = 0.98, L_SPAN = 0.9;

/** Drags on an element, reporting the pointer's position as fractions of its box. */
function useDrag(onMove: (x: number, y: number, first: boolean) => void, onEnd?: () => void) {
  const move = useRef(onMove);
  const end = useRef(onEnd);
  move.current = onMove;
  end.current = onEnd;
  return {
    onPointerDown(e: RPointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const at = (ev: { clientX: number; clientY: number }, first: boolean) => {
        const r = el.getBoundingClientRect();
        move.current((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, first);
      };
      at(e, true);
      const mv = (ev: PointerEvent) => at(ev, false);
      const up = () => {
        el.removeEventListener("pointermove", mv);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        end.current?.();
      };
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      e.preventDefault();
    },
  };
}

export interface Tone {
  l: number;
  /** Chroma as a share of the most this lightness and hue can show (0..1). */
  x: number;
  h: number;
}

/** Lightness (up) × colourfulness (across) for one hue, always inside what a screen can show. */
export function TonePlane({
  tone,
  onChange,
  onStart,
  label,
  valueText,
  size,
}: {
  tone: Tone;
  onChange: (t: Tone) => void;
  onStart: () => void;
  label: string;
  valueText: string;
  size: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hue = Math.round(tone.h * 2) / 2;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const N = 96;
    cv.width = N;
    cv.height = N;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(N, N);
    const r = (hue * Math.PI) / 180, ca = Math.cos(r), sa = Math.sin(r);
    for (let y = 0; y < N; y++) {
      const L = L_TOP - (y / (N - 1)) * L_SPAN;
      const mc = maxChroma(L, hue);
      for (let x = 0; x < N; x++) {
        const C = (x / (N - 1)) * mc;
        const lin = oklabToLinear(L, C * ca, C * sa);
        const o = (y * N + x) * 4;
        for (let k = 0; k < 3; k++) {
          const v = Math.min(1, Math.max(0, lin[k]));
          img.data[o + k] = Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
        }
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hue]);
  const drag = useDrag((x, y, first) => {
    if (first) onStart();
    onChange({ ...tone, x: Math.min(1, Math.max(0, x)), l: Math.min(L_TOP, Math.max(L_TOP - L_SPAN, L_TOP - Math.min(1, Math.max(0, y)) * L_SPAN)) });
  });
  const onKey = (e: KeyboardEvent) => {
    const big = e.shiftKey ? 5 : 1;
    let { l, x } = tone;
    if (e.key === "ArrowUp") l += 0.01 * big;
    else if (e.key === "ArrowDown") l -= 0.01 * big;
    else if (e.key === "ArrowRight") x += 0.02 * big;
    else if (e.key === "ArrowLeft") x -= 0.02 * big;
    else return;
    e.preventDefault();
    if (!e.repeat) onStart();
    onChange({ ...tone, l: Math.min(L_TOP, Math.max(L_TOP - L_SPAN, l)), x: Math.min(1, Math.max(0, x)) });
  };
  const c = tone.x * maxChroma(tone.l, tone.h);
  return (
    <div
      className="relative touch-none rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      style={{ width: size, height: size }}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuetext={valueText}
      aria-valuenow={Math.round(tone.l * 100)}
      aria-valuemin={8}
      aria-valuemax={98}
      onKeyDown={onKey}
      {...drag}
      data-testid="sm-tone"
    >
      <canvas ref={ref} className="block h-full w-full rounded-[10px]" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.08)" }} aria-hidden />
      <Knob color={hex(lchToRgb(tone.l, c, tone.h))} style={{ left: `${tone.x * 100}%`, top: `${((L_TOP - tone.l) / L_SPAN) * 100}%` }} />
    </div>
  );
}

/** A hue ring with the tone plane inside it. */
export function HueRing({
  tone,
  onChange,
  onStart,
  labels,
  size = 176,
  ring = 12,
}: {
  tone: Tone;
  onChange: (t: Tone) => void;
  onStart: () => void;
  labels: { hue: string; tone: string; toneValue: string };
  size?: number;
  ring?: number;
}) {
  const inner = Math.round((size - ring * 2 - 20) / Math.SQRT2);
  const a = ((tone.h - 90) * Math.PI) / 180;
  const r = size / 2 - ring / 2;
  const setHue = (x: number, y: number) => {
    const ang = (Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI + 90;
    onChange({ ...tone, h: wrapHue(ang) });
  };
  const live = useRef(false);
  const drag = useDrag((x, y, first) => {
    // Only the ring itself (not the gap inside it) starts a hue drag.
    if (first) {
      live.current = Math.hypot(x - 0.5, y - 0.5) * size >= size / 2 - ring - 10;
      if (live.current) onStart();
    }
    if (live.current) setHue(x, y);
  });
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange({ ...tone, h: wrapHue(tone.h + step) });
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange({ ...tone, h: wrapHue(tone.h - step) });
    else return;
    e.preventDefault();
    if (!e.repeat) onStart();
  };
  const mask = `radial-gradient(circle, transparent ${size / 2 - ring - 0.5}px, #000 ${size / 2 - ring}px)`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        style={{ background: `conic-gradient(from 0deg, ${RING_HUES.join(",")})`, WebkitMask: mask, mask }}
        role="slider"
        tabIndex={0}
        aria-label={labels.hue}
        aria-valuenow={Math.round(tone.h)}
        aria-valuemin={0}
        aria-valuemax={359}
        onKeyDown={onKey}
        {...drag}
        data-testid="sm-hue"
      />
      <Knob color={hex(lchToRgb(0.74, 0.14, tone.h))} style={{ left: size / 2 + r * Math.cos(a), top: size / 2 + r * Math.sin(a) }} size={22} />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <TonePlane tone={tone} onChange={onChange} onStart={onStart} label={labels.tone} valueText={labels.toneValue} size={inner} />
      </div>
    </div>
  );
}

"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { typeColor } from "@/lib/pokemon/type-colors";
import { mod } from "@/lib/lab-dex/wheel";
import type { LabMon } from "@/lib/lab-dex/types";

/**
 * The lab without WebGL: a clean 2D wheel of specimen cards (the HOME
 * renders, the chosen one large in its type's light), driven by the same
 * wheel and controls as the 3D lab, under the same panels.
 */

export interface Fallback2DHandle {
  frame(p: number): void;
  /** The slot of the card at x (CSS px across a stage `width` wide), if any. */
  pick(x: number, width: number): number | null;
}

const SPAN = 4;

export const Fallback2D = forwardRef<Fallback2DHandle, { len: number; monAt: (pos: number) => LabMon | null; phone: boolean }>(function Fallback2D({ len, monAt, phone }, ref) {
  const [centre, setCentre] = useState(0);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const pRef = useRef(0);
  // The centre the cards are drawn for (placing them against it keeps every card where it belongs while React catches up).
  const drawn = useRef(centre);
  drawn.current = centre;
  const spacing = phone ? 120 : 190;
  const place = (p: number, c: number) => {
    for (let k = -SPAN; k <= SPAN; k++) {
      const el = cards.current[k + SPAN];
      if (!el) continue;
      const d = c + k - p;
      const ad = Math.abs(d);
      const s = Math.max(0.45, 1 - ad * 0.17);
      el.style.transform = `translate(-50%, -50%) translateX(${d * spacing * (1 - Math.min(0.35, ad * 0.04))}px) scale(${s})`;
      el.style.opacity = String(Math.max(0, 1 - ad * 0.22));
      el.style.zIndex = String(100 - Math.round(ad * 10));
    }
  };
  useImperativeHandle(ref, () => ({
    frame(p) {
      pRef.current = p;
      const c = Math.round(p);
      if (c !== drawn.current) setCentre(c);
      place(p, drawn.current);
    },
    pick(x, width) {
      const k = Math.round((x - width / 2) / spacing);
      if (Math.abs(k) > SPAN || len === 0) return null;
      const slot = Math.round(pRef.current) + k;
      return show(slot) ? slot : null;
    },
  }));
  const slots = Array.from({ length: SPAN * 2 + 1 }, (_, i) => centre - SPAN + i);
  const show = (slot: number) => len > 0 && (len >= SPAN * 2 + 1 || Math.abs(slot - centre) <= Math.floor((len - 1) / 2));
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="lab-fallback">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_45%,rgba(56,189,248,0.14),transparent_70%)]" />
      <div className="absolute inset-x-0 top-[58%] h-px bg-gradient-to-r from-transparent via-cyan-200/40 to-transparent" />
      {slots.map((slot, i) => {
        const m = show(slot) ? monAt(mod(slot, len)) : null;
        const sel = slot === centre;
        return (
          <div
            key={i}
            ref={(el) => { cards.current[i] = el; }}
            className="absolute left-1/2 top-[45%] will-change-transform"
            style={{ transform: `translate(-50%, -50%) translateX(${(slot - centre) * spacing}px)` }}
          >
            {m && (
              <div
                aria-hidden
                className="relative grid place-items-center rounded-2xl border border-white/10 bg-[#071022]/80 p-3 shadow-2xl"
                style={{ width: phone ? 150 : 230, height: phone ? 170 : 260, boxShadow: sel ? `0 0 60px -10px ${typeColor(m.types[0])}, inset 0 0 0 1px ${typeColor(m.types[0])}aa` : undefined }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/sizes/art/${sel ? 512 : 256}/${m.id}.webp`} alt="" className="h-[78%] w-[86%] object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.6)]" draggable={false} />
                <span className="absolute inset-x-0 bottom-2 truncate px-2 text-center font-display text-[12px] font-semibold uppercase tracking-wide text-white/85">{m.name}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

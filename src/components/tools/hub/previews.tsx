/* eslint-disable @next/next/no-img-element -- the site's own small renders, pre-sized */
import { Crown, Sparkle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The tools' pictures for the hub, all drawn from the tools' own art: the Poké
 * Ball Maker's 3D renders (floating, and a catch wobble on hover) and a rack of
 * its official balls rolling by, the tier list's tiers filling up, and the
 * favourite picker's crowned favourite. CSS motion only (hub-css.ts).
 */

type Vars = React.CSSProperties & Record<`--${string}`, string>;

/** The Poké Ball Maker's renders, floating over a floor shadow; they wobble like a catch on hover. */
export function BallStage({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <div className={cn("relative", className)} aria-hidden>
      <div className="th-shadow absolute inset-x-[16%] bottom-[2%] h-[9%]" />
      <div className="th-float relative h-full w-full">
        <img
          src="/pokeball-maker/hub.webp"
          alt=""
          width={340}
          height={340}
          fetchPriority={priority ? "high" : undefined}
          className="th-wobble h-full w-full object-contain drop-shadow-[0_18px_30px_rgb(0_0_0/0.5)]"
        />
      </div>
    </div>
  );
}

/** The official balls (the maker's Start tab), rolling by in a line. `balls` are CSS backgrounds from the maker's presets. */
export function BallRack({ balls, size = 34, className }: { balls: string[]; size?: number; className?: string }) {
  const row = [...balls, ...balls];
  return (
    <div className={cn("overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]", className)} aria-hidden>
      <div className="th-rack gap-3 py-1.5">
        {row.map((bg, i) => (
          <span key={i} className="th-ball" style={{ width: size, height: size }}>
            <i style={{ background: bg }} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** The tier list card's picture: tiers of favourites (the site's own renders), dropping in one after another. */
export const TIERS: { label: string; color: string; ids: number[] }[] = [
  { label: "S", color: "#f25f7d", ids: [6, 448, 658, 445] },
  { label: "A", color: "#f7954a", ids: [25, 149, 197, 1000] },
  { label: "B", color: "#f6c94a", ids: [133, 54, 143] },
  { label: "C", color: "#8fd46a", ids: [129, 79] },
];

/** Sized by --tile (a tile's side), set by the caller or the `tile` prop. */
export function TierFill({ rows = 3, perRow = 4, className, tile, period = 9 }: { rows?: number; perRow?: number; className?: string; tile?: string; period?: number }) {
  let n = 0;
  const total = TIERS.slice(0, rows).reduce((a, r) => a + Math.min(r.ids.length, perRow), 0);
  return (
    <div className={cn("space-y-1.5", className)} style={{ ...(tile ? { "--tile": tile } : {}), "--tp": `${period}s` } as Vars} aria-hidden>
      {TIERS.slice(0, rows).map((row) => (
        <div key={row.label} className="flex h-[calc(var(--tile)+0.5rem)] overflow-hidden rounded-xl bg-white/[0.05] ring-1 ring-inset ring-white/[0.04]">
          <div className="flex shrink-0 items-center justify-center font-display text-[calc(var(--tile)*0.5)] font-bold italic text-[#16131f]" style={{ background: row.color, width: "calc(var(--tile) + 0.35rem)" }}>
            {row.label}
          </div>
          <div className="flex items-center gap-1 px-1">
            {row.ids.slice(0, perRow).map((id) => {
              const i = n++;
              // In one after another as the page opens; then each hops out and back in its turn, round the board.
              const d1 = 0.15 + i * 0.07;
              const d2 = 1.5 + (i / total) * period;
              return (
                <img
                  key={id}
                  src={`/sizes/art/256/${id}.webp`}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  className="th-drop h-[var(--tile)] w-[var(--tile)] rounded-lg bg-white/[0.06] object-contain p-0.5"
                  style={{ "--d1": `${d1.toFixed(2)}s`, "--d2": `${d2.toFixed(2)}s` } as Vars}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The favourite picker's picture: the favourite crowned between two runners-up. */
export function PickerCrown({ className, size = "10rem" }: { className?: string; size?: string }) {
  return (
    <div className={cn("relative flex items-end justify-center", className)} style={{ "--s": size } as Vars} aria-hidden>
      <img src="/sizes/art/256/25.webp" alt="" width={256} height={256} loading="lazy" className="th-sway relative z-0 -mr-[12%] h-[calc(var(--s)*0.66)] w-[calc(var(--s)*0.66)] object-contain opacity-75 [animation-delay:-1.2s]" />
      <div className="relative z-10 flex flex-col items-center">
        <Crown className="th-crown -mb-[6%] h-[calc(var(--s)*0.2)] w-[calc(var(--s)*0.2)] text-[hsl(44_96%_62%)] drop-shadow-[0_4px_14px_hsl(44_96%_62%/0.6)]" strokeWidth={2.2} />
        <img src="/sizes/art/256/94.webp" alt="" width={256} height={256} loading="lazy" className="h-[var(--s)] w-[var(--s)] object-contain drop-shadow-[0_18px_26px_rgb(0_0_0/0.5)]" />
        <Sparkle className="th-twinkle absolute right-[6%] top-[22%] h-[calc(var(--s)*0.12)] w-[calc(var(--s)*0.12)] fill-[hsl(44_96%_70%)] text-[hsl(44_96%_70%)]" />
        <Sparkle className="th-twinkle absolute left-[8%] top-[44%] h-[calc(var(--s)*0.08)] w-[calc(var(--s)*0.08)] fill-white text-white [animation-delay:-1.3s]" />
      </div>
      <img src="/sizes/art/256/448.webp" alt="" width={256} height={256} loading="lazy" className="th-sway relative z-0 -ml-[12%] h-[calc(var(--s)*0.66)] w-[calc(var(--s)*0.66)] object-contain opacity-75" />
    </div>
  );
}

/** Small feature chips in the pixel font (the Lab's tags). */
export function Chips({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((t) => (
        <li key={t} className="rounded-sm border border-white/10 bg-black/30 px-1.5 py-1 font-pixel text-[9px] uppercase leading-none tracking-[0.12em] text-white/75 backdrop-blur-sm">
          {t}
        </li>
      ))}
    </ul>
  );
}

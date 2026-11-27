import type { HeroMon } from "./data";

/** The HOME render's file (static, the same bytes /pokedex/sizes draws). */
export const artUrl = (id: number, size: 256 | 512) => `/sizes/art/${size}/${id}.webp`;

/**
 * A Pokémon's HOME render cropped to its visible box, so the box's bottom is
 * its feet and its height its documented height. Sized by the parent (width
 * or height; the box keeps the render's proportions).
 */
export function ArtBox({ mon, size = 256, className, style, eager }: { mon: HeroMon; size?: 256 | 512; className?: string; style?: React.CSSProperties; eager?: boolean }) {
  const [bx, by, bw, bh, s] = mon.box;
  return (
    <span className={className} style={{ display: "block", position: "relative", overflow: "hidden", aspectRatio: `${bw} / ${bh}`, ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static file, cropped by its box: no resizing needed */}
      <img
        src={artUrl(mon.art, size)}
        alt=""
        draggable={false}
        decoding="async"
        loading={eager ? "eager" : "lazy"}
        style={{ position: "absolute", maxWidth: "none", width: `${(s / bw) * 100}%`, left: `${(-bx / bw) * 100}%`, top: `${(-by / bh) * 100}%` }}
      />
    </span>
  );
}

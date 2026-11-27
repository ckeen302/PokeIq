import { artUrl } from "./ArtBox";
import type { HeroMon } from "./data";

type Vars = React.CSSProperties & Record<`--${string}`, string | number>;

/** Sparkles drifting up through the portal: [left %, delay s, duration s, size px, star]. Fixed, so the server and browser agree. */
const SPARKS: [number, number, number, number, boolean][] = [
  [18, 0, 6.5, 3, false], [27, -2.1, 7.4, 6, true], [35, -4.6, 6.1, 2, false], [43, -1.2, 8.0, 3, false], [50, -3.3, 7.0, 7, true],
  [57, -5.4, 6.6, 2, false], [64, -0.6, 7.8, 3, false], [72, -2.9, 6.3, 5, true], [80, -4.1, 7.2, 2, false], [23, -6.0, 8.4, 2, false],
  [39, -3.8, 6.8, 4, true], [61, -6.6, 7.6, 3, false], [76, -1.8, 8.2, 2, false], [31, -5.1, 7.1, 2, false], [68, -3.6, 6.9, 4, true],
];

/** Seconds each silhouette holds the portal (fading in, holding, fading out). */
const SLOT = 4.6;

/**
 * Option 3: a holographic portal hovering over the floor. Inside it, one
 * Pokémon's silhouette after another materialises from the bottom up,
 * holds, and dissolves. All CSS: each silhouette is its HOME render used as
 * a mask over a gradient, on one shared loop with its own delay.
 */
export function HeroPortal({ mons }: { mons: HeroMon[] }) {
  const n = mons.length;
  return (
    <div className="lh-portal" style={{ "--n": n, "--slot": `${SLOT}s`, "--cycle": `${(SLOT * n).toFixed(2)}s` } as Vars} aria-hidden data-testid="lab-hero-portal">
      <span className="lh-pool" />
      <span className="lh-pbeam" />
      <div className="lh-gate">
        <span className="lh-halo" />
        <span className="lh-core" />
        <span className="lh-swirl" />
        <div className="lh-holo">
          {mons.map((mon, i) => {
            const [bx, by, bw, bh, s] = mon.box;
            // Each one fits the portal: held to a box as wide as it is tall.
            const fit = Math.min(1, bw / bh >= 1 ? bh / bw : 1);
            return (
              <span
                key={mon.key}
                className="lh-sil"
                data-mon={mon.key}
                style={{ "--d": `${(i * SLOT - 1.6).toFixed(2)}s`, aspectRatio: `${bw} / ${bh}`, height: `${(fit * 100).toFixed(1)}%` } as Vars}
              >
                {/* Revealed by a soft mask (inside), so the glow (outside, on .lh-sil) follows the edge. */}
                <span className="lh-sil-in">
                  <span
                    className="lh-sil-art"
                    style={{ width: `${(s / bw) * 100}%`, left: `${(-bx / bw) * 100}%`, top: `${(-by / bh) * 100}%`, "--art": `url(${artUrl(mon.art, 256)})` } as Vars}
                  />
                </span>
              </span>
            );
          })}
        </div>
        <span className="lh-rim" />
        <span className="lh-rim2" />
      </div>
      <div className="lh-sparks">
        {SPARKS.map(([l, d, t, s, star], i) => (
          <span key={i} className={star ? "lh-star" : undefined} style={{ left: `${l}%`, animationDelay: `${d}s`, animationDuration: `${t}s`, width: s, height: s }} />
        ))}
      </div>
    </div>
  );
}

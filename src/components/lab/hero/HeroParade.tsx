import { ArtBox } from "./ArtBox";
import { paradeLine, type HeroMon } from "./data";
import { formatMetres } from "@/lib/sizes/types";

type Vars = React.CSSProperties & Record<`--${string}`, string | number>;

/**
 * Option 2: a size parade. Pokémon walk left along the floor at their real
 * relative sizes (one scale for all: --u px per metre, lib/sizes heights),
 * smallest first, while a giant drifts past behind them. All CSS: the line
 * is drawn twice, end to end, and slides one line's length per loop, so it
 * never jumps.
 */
export function HeroParade({ mons, giant }: { mons: HeroMon[]; giant: HeroMon }) {
  const line = paradeLine(mons);
  const last = line[line.length - 1];
  // One loop: the line, then the gap the first figure would leave behind the last.
  const period = last.x + last.mon.w / 2 + 0.16 * Math.max(last.mon.h, last.mon.w * 0.6) + 0.5;
  return (
    <div className="lh-parade" style={{ "--L": period.toFixed(3) } as Vars} aria-hidden data-testid="lab-hero-parade">
      <div className="lh-giant-lane">
        <div className="lh-giant" style={{ "--w": giant.w, "--h": giant.h } as Vars}>
          <ArtBox mon={giant} size={512} eager className="lh-fig" />
          <span className="lh-tag lh-tag-giant">
            {giant.name} <b>{formatMetres(giant.m)}</b>
          </span>
        </div>
      </div>
      <div className="lh-lane">
        <div className="lh-track">
          {[0, 1].map((copy) =>
            line.map(({ mon, x }, i) => (
              <div
                key={`${copy}-${mon.key}`}
                className="lh-walker"
                style={{ "--x": (x + copy * period).toFixed(3), "--w": mon.w.toFixed(3), "--h": mon.h.toFixed(3), "--step": `${(0.34 + Math.sqrt(mon.h) * 0.34).toFixed(2)}s`, "--lag": `${(-i * 0.13).toFixed(2)}s` } as Vars}
                data-mon={mon.key}
              >
                <span className="lh-shadow" />
                <div className="lh-bob">
                  <ArtBox mon={mon} size={mon.h > 1.2 ? 512 : 256} eager className="lh-fig" />
                </div>
                {/* The two ends of the scale carry their name and documented size, as on /pokedex/sizes. */}
                {i === 0 && (
                  <span className="lh-tag">
                    {mon.name} <b>{formatMetres(mon.m)}</b>
                  </span>
                )}
              </div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

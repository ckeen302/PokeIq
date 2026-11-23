/* eslint-disable @next/next/no-img-element -- pixel sprites, GIFs and the HOME render are drawn as they are (no image optimizer) */
import { SPRITE_BASE, SPRITE_CELL, type SpriteColumn } from "@/lib/pokemon/sprites";
import SIZES_ART from "@/data/sizes-art.json";
import { cn } from "@/lib/utils";
import { serverT } from "@/i18n/server";
import spritesNs from "@/messages/dex-sprites";
import geoNames from "@/messages/geo-names";
import { localGame } from "@/lib/geo-i18n";

/** Each column's game as localGame reads it (English keeps the column's own label). */
const GAME_LABEL: Record<string, string> = {
  "Red & Blue": "Red / Blue",
  "Black & White": "Black / White",
  "X & Y": "X / Y",
  "Ultra Sun & Moon": "Ultra Sun / Ultra Moon",
  "Sword & Shield": "Sword / Shield",
};

/**
 * "<Name> sprites": each generation's front sprite, normal over shiny, one
 * column per generation since the species' debut (PokémonDB's layout). A
 * server component with no script of its own: the table scrolls sideways in
 * its card on a narrow screen, row labels pinned.
 */
/** The pinned label column, with a short fade on its right edge for what scrolls under it (inside the cell's border, so row lines run unbroken). */
const PINNED = "sticky left-0 z-[1] bg-card after:pointer-events-none after:absolute after:inset-y-0 after:-right-3 after:w-3 after:bg-gradient-to-r after:from-card after:to-transparent";

export function SpritesSection({ name, columns }: { name: string; columns: SpriteColumn[] }) {
  const t = serverT(spritesNs);
  const g = serverT(geoNames);
  const game = (label: string) => (t.locale === "en" ? label : localGame(g, GAME_LABEL[label] ?? label));
  const rows = [
    { key: "normal", label: t("normal"), shiny: false },
    { key: "shiny", label: t("shiny"), shiny: true },
  ] as const;
  return (
    <div className="space-y-3 hud rounded-lg border bg-card p-4" data-testid="dex-sprites">
      <div className="relative overflow-x-auto" data-hscroll>
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={cn(PINNED, "border-b p-2 pl-0")}>
                <span className="sr-only">{t("sprite")}</span>
              </th>
              {columns.map((c) => (
                <th key={c.gen} scope="col" className="w-28 min-w-28 border-b px-2 pb-2.5 pt-1 text-center align-bottom font-normal">
                  <span className="block font-pixel text-[10px] uppercase tracking-wider text-primary">{t("gen", { gen: c.gen })}</span>
                  <span className="mt-1 block whitespace-nowrap text-[11px] text-muted-foreground">{game(c.game)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th
                  scope="row"
                  className={cn(
                    PINNED,
                    "py-2 pl-0 pr-3 text-left align-middle font-normal",
                    r.key === "normal" && "border-b border-foreground/5"
                  )}
                >
                  <span className={cn("hud-label", r.shiny && "text-warning")}>{r.label}</span>
                </th>
                {columns.map((c) => {
                  const src = r.shiny ? c.shiny : c.normal;
                  return (
                    <td key={c.gen} className={cn("px-2 py-2", r.key === "normal" && "border-b border-foreground/5")}>
                      <div className="mx-auto grid h-24 w-24 place-items-center overflow-hidden">
                        {src ? (
                          <Sprite col={c} src={src} alt={t(r.shiny ? "altShiny" : "alt", { name, gen: c.gen })} />
                        ) : (
                          <>
                            <span className="text-muted-foreground/60" aria-hidden>
                              —
                            </span>
                            <span className="sr-only">{t("none")}</span>
                          </>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("note")}
      </p>
    </div>
  );
}

/**
 * The HOME render without Vercel's image optimizer, whose free allowance
 * (a few thousand new pictures a month) every species' pair of renders would
 * use up: the site's own 256 px WebP copy where it has one (public/sizes/art,
 * the same picture), else PokéAPI's file as it is, like every other column.
 */
const HOME_NORMAL = `${SPRITE_BASE}/other/home/`;
function homeSrc(src: string): string {
  const id = src.startsWith(HOME_NORMAL) ? /^(\d+)\.png$/.exec(src.slice(HOME_NORMAL.length))?.[1] : undefined;
  return id && id in SIZES_ART ? `/sizes/art/256/${id}.webp` : src;
}

function Sprite({ col, src, alt }: { col: SpriteColumn; src: string; alt: string }) {
  const look = col.look;
  if (look.kind === "home") {
    return (
      <img
        src={homeSrc(src)}
        alt={alt}
        width={SPRITE_CELL}
        height={SPRITE_CELL}
        loading="lazy"
        decoding="async"
        className="h-24 w-24 object-contain"
      />
    );
  }
  if (look.kind === "render") {
    // Cut to the model's own size: shown as is, or shrunk to fit the cell.
    return <img src={src} alt={alt} width={SPRITE_CELL} height={SPRITE_CELL} loading="lazy" decoding="async" className="h-24 w-24 object-scale-down" />;
  }
  // A canvas bigger than the cell overflows it evenly on every side (the sprite sits in its middle), and the cell crops it.
  const overflow = Math.max(0, (look.size - SPRITE_CELL) / 2);
  return (
    <img
      src={src}
      alt={alt}
      width={look.size}
      height={look.size}
      loading="lazy"
      decoding="async"
      className="max-w-none [image-rendering:pixelated]"
      style={{ width: look.size, height: look.size, margin: overflow ? -overflow : undefined }}
    />
  );
}

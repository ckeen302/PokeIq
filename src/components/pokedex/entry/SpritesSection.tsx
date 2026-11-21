/* eslint-disable @next/next/no-img-element -- pixel sprites and GIFs are drawn as they are; the HOME render goes through the image optimizer by URL */
import { SPRITE_CELL, optimizedImageUrl, type SpriteColumn } from "@/lib/pokemon/sprites";
import { cn } from "@/lib/utils";

/**
 * "<Name> sprites": each generation's front sprite, normal over shiny, one
 * column per generation since the species' debut (PokémonDB's layout). A
 * server component with no script of its own: the table scrolls sideways in
 * its card on a narrow screen, row labels pinned.
 */
export function SpritesSection({ name, columns }: { name: string; columns: SpriteColumn[] }) {
  const rows = [
    { key: "normal", label: "Normal", shiny: false },
    { key: "shiny", label: "Shiny", shiny: true },
  ] as const;
  return (
    <div className="space-y-3 hud rounded-lg border bg-card p-4" data-testid="dex-sprites">
      <div className="relative overflow-x-auto" data-hscroll>
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] border-b bg-card p-2 pl-0">
                <span className="sr-only">Sprite</span>
              </th>
              {columns.map((c) => (
                <th key={c.gen} scope="col" className="w-28 min-w-28 border-b px-2 pb-2.5 pt-1 text-center align-bottom font-normal">
                  <span className="block font-pixel text-[10px] uppercase tracking-wider text-primary">Gen {c.gen}</span>
                  <span className="mt-1 block whitespace-nowrap text-[11px] text-muted-foreground">{c.game}</span>
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
                    "sticky left-0 z-[1] bg-card py-2 pl-0 pr-3 text-left align-middle font-normal",
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
                          <Sprite col={c} src={src} alt={`${name}, Generation ${c.gen}${r.shiny ? " shiny" : ""} sprite`} />
                        ) : (
                          <>
                            <span className="text-muted-foreground/60" aria-hidden>
                              —
                            </span>
                            <span className="sr-only">None</span>
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
        Front sprites from one game per generation, via PokéAPI. Gen 9 shows the Pokémon HOME model. A dash means that game has none.
      </p>
    </div>
  );
}

function Sprite({ col, src, alt }: { col: SpriteColumn; src: string; alt: string }) {
  const look = col.look;
  if (look.kind === "home") {
    return (
      <img
        src={optimizedImageUrl(src, 96)}
        srcSet={`${optimizedImageUrl(src, 96)} 1x, ${optimizedImageUrl(src, 256)} 2x`}
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

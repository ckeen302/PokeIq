/* eslint-disable @next/next/no-img-element -- box art is pre-sized WebP in public/games */
import { boardArtUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import type { CoverArt } from "@/lib/dex/video-games-types";
import { cn } from "@/lib/utils";

/**
 * A game's box art in a frame of fixed proportions. Every picture is drawn
 * with object-fit: contain inside a box sized (in % of the frame) so that,
 * rotated, it still fits inside the frame: nothing is ever cropped, at any width.
 *
 * Two versions fan out: the second cover behind on the left, tilted back,
 * the first in front on the right. A single cover sits upright in the middle.
 * A game with no box (a phone app) gets its best-known Pokémon on a tile in
 * that Pokémon's type colour.
 */
export function GameCover({ cover, className, eager = false }: { cover: CoverArt; className?: string; eager?: boolean }) {
  const loading = eager ? "eager" : "lazy";
  return (
    <div className={cn("relative aspect-[5/4] w-full", className)} data-testid="game-cover">
      {cover.kind === "art" ? (
        <ArtTile id={cover.id} alt={cover.alt} types={cover.types} loading={loading} />
      ) : cover.files.length === 2 ? (
        <>
          {/* 58% × 78% boxes turned 6°: about 64% × 68% of the frame's width once rotated (the frame is 80% as tall as wide), so each stays inside with room to spare. */}
          <img
            src={`/games/${cover.files[1]}`}
            alt={cover.alts[1]}
            loading={loading}
            decoding="async"
            data-testid="game-cover-img"
            className="absolute left-[5%] top-[11%] h-[78%] w-[58%] -rotate-6 object-contain object-center drop-shadow-[0_6px_10px_rgb(0_0_0/0.45)]"
          />
          <img
            src={`/games/${cover.files[0]}`}
            alt={cover.alts[0]}
            loading={loading}
            decoding="async"
            data-testid="game-cover-img"
            className="absolute right-[5%] top-[11%] h-[78%] w-[58%] rotate-[5deg] object-contain object-center drop-shadow-[0_8px_14px_rgb(0_0_0/0.5)]"
          />
        </>
      ) : (
        <img
          src={`/games/${cover.files[0]}`}
          alt={cover.alts[0]}
          loading={loading}
          decoding="async"
          data-testid="game-cover-img"
          className="absolute inset-x-[10%] top-[6%] h-[88%] w-[80%] object-contain object-center drop-shadow-[0_8px_14px_rgb(0_0_0/0.5)]"
        />
      )}
    </div>
  );
}

function ArtTile({ id, alt, types, loading }: { id: number; alt: string; types: string[]; loading: "eager" | "lazy" }) {
  const a = typeColor(types[0]);
  const b = typeColor(types[1] ?? types[0]);
  return (
    <div
      className="absolute left-1/2 top-1/2 flex aspect-square h-[84%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[22%] shadow-[0_8px_14px_rgb(0_0_0/0.45)]"
      style={{ background: `linear-gradient(145deg, ${a}, ${b})` }}
      data-testid="game-cover-img"
    >
      <img src={boardArtUrl(id)} alt={`${alt}, on a tile in place of box art`} loading={loading} decoding="async" className="h-[82%] w-[82%] object-contain" />
    </div>
  );
}

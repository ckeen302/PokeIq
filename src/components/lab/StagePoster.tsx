import { cn } from "@/lib/utils";

/** A 1 × 1 transparent GIF: what wider screens get in place of the poster, so they download nothing. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/**
 * A still of a 3D stage's opening view, in the page's own HTML, for phones.
 * On a phone connection the scene's code takes seconds to arrive; until its
 * first frame is drawn (`gone`), the stage shows this picture instead of an
 * empty box, then fades it out over the live scene. Sits over the canvas and
 * under the stage's controls. Tablets and desktops don't show or fetch it.
 */
export function StagePoster({ src, gone }: { src: string; gone: boolean }) {
  return (
    <picture className={cn("pointer-events-none absolute inset-0 transition-opacity duration-500 md:hidden", gone && "opacity-0")} aria-hidden data-testid="stage-poster" data-gone={gone ? "1" : "0"}>
      <source media="(min-width: 768px)" srcSet={BLANK} />
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed, pre-sized still; the image optimizer would only add a round trip */}
      <img src={src} alt="" decoding="async" fetchPriority="high" className="h-full w-full object-cover" />
    </picture>
  );
}

/** The stills, made by scripts/lab-posters.mjs from the scenes' own first frames at 390 px. */
export const STAGE_POSTERS = {
  games: "/lab/posters/games.webp",
  race: "/lab/posters/race.webp",
  massBattle: "/lab/posters/mass-battle.webp",
} as const;

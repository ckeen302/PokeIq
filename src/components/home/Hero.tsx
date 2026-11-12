import paldea from "@/assets/guessr/paldea.webp";
import { HeroCopy, HeroPicture } from "./HeroLive";

/**
 * The title screen: today's first PokéGuessr place under "Where is this?"
 * (or, when that picture is too small to be sharp this big, a hand-picked
 * view from a modern game), the game's name, one line about it and one
 * thing to press, straight into today's places. The page's one h1 names the
 * site for search engines and screen readers. On a phone the picture runs
 * edge to edge on top and the words sit under it.
 */
export function Hero() {
  return (
    <section
      className="dark-scope relative isolate overflow-hidden rounded-2xl border border-white/10 bg-card shadow-[0_30px_80px_-30px_hsl(var(--screen)/0.45)] max-sm:-mx-4 max-sm:rounded-none max-sm:border-0 max-sm:bg-background max-sm:shadow-none lg:flex lg:max-h-[580px] lg:flex-1 lg:flex-col"
      data-testid="home-hero"
    >
      <h1 className="sr-only">PokéIQ: Pokémon games, quizzes and battles</h1>
      <div className="relative aspect-[6/5] overflow-hidden sm:absolute sm:inset-x-0 sm:top-0 sm:aspect-video lg:inset-y-0 lg:left-auto lg:aspect-auto lg:w-[66%]" data-testid="home-hero-view">
        <HeroPicture fallback={paldea} />
      </div>

      <div className="relative -mt-10 space-y-3 px-4 pb-4 sm:mt-0 sm:space-y-4 sm:px-8 sm:pb-8 sm:pt-[42%] lg:flex lg:min-h-[320px] lg:flex-1 lg:max-w-[46%] lg:flex-col lg:justify-center lg:px-12 lg:py-9">
        <HeroCopy />
      </div>
    </section>
  );
}

import { HeroCarousel } from "./HeroCarousel";
import { WORLD_THUMB, showcaseSlides } from "./showcase";

/**
 * The title screen: a slideshow of the site's games, one per tab, each with
 * its name, a line about it and a button to it. The page's one h1 names the
 * site for search engines and screen readers; the slides carry the visible
 * names.
 */
export function Hero() {
  return (
    <section className="dark-scope relative isolate overflow-hidden rounded-2xl border border-white/10 bg-card shadow-[0_30px_80px_-30px_hsl(var(--screen)/0.45)] max-sm:-mx-4 max-sm:rounded-none max-sm:border-0 max-sm:bg-background max-sm:shadow-none">
      <h1 className="sr-only">PokéIQ: Pokémon games, quizzes and battles</h1>
      <HeroCarousel guessr={{ slides: showcaseSlides(), map: WORLD_THUMB }} />
    </section>
  );
}

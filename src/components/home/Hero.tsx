import { MapPin } from "lucide-react";
import paldea from "@/assets/guessr/paldea.webp";
import { HeroCopy, HeroPicture } from "./HeroLive";

/**
 * The title screen: today's first PokéGuessr place under "Where is this?",
 * the game's name, one line about it and one thing to press, straight into
 * today's places. The page's one h1 names the site for search engines and
 * screen readers. On a phone the picture runs edge to edge on top and the
 * words sit under it.
 */
export function Hero() {
  return (
    <section
      className="dark-scope relative isolate overflow-hidden rounded-2xl border border-white/10 bg-card shadow-[0_30px_80px_-30px_hsl(var(--screen)/0.45)] max-sm:-mx-4 max-sm:rounded-none max-sm:border-0 max-sm:bg-background max-sm:shadow-none"
      data-testid="home-hero"
    >
      <h1 className="sr-only">PokéIQ: Pokémon games, quizzes and battles</h1>
      <div className="relative aspect-[6/5] overflow-hidden sm:absolute sm:inset-x-0 sm:top-0 sm:aspect-video lg:inset-y-0 lg:left-auto lg:aspect-auto lg:w-[66%]" data-testid="home-hero-view">
        <HeroPicture fallback={paldea} />
        {/* Fade the picture into the card behind the words. */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-55% to-background sm:from-35% sm:to-card lg:bg-gradient-to-r lg:from-card lg:from-0% lg:via-card/60 lg:via-30% lg:to-transparent lg:to-70%" />
        {/* The question, never the answer. */}
        <p
          className="absolute right-3 top-[3.75rem] z-[3] flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 font-display text-[13px] font-bold uppercase tracking-wider text-white shadow-[0_6px_18px_rgb(0_0_0/0.4)] backdrop-blur-sm sm:right-4 sm:top-4 lg:bottom-6 lg:right-6 lg:top-auto lg:px-4 lg:py-2 lg:text-base"
          data-testid="home-hero-question"
        >
          <MapPin className="h-4 w-4 text-primary lg:h-5 lg:w-5" aria-hidden /> Where is this?
        </p>
      </div>

      <div className="relative -mt-10 space-y-3 px-4 pb-4 sm:mt-0 sm:space-y-4 sm:px-8 sm:pb-8 sm:pt-[42%] lg:flex lg:min-h-[440px] lg:max-w-[46%] lg:flex-col lg:justify-center lg:px-12 lg:py-14">
        <HeroCopy />
      </div>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { GuessrShowcase } from "./GuessrShowcase";
import { WORLD_THUMB, showcaseSlides } from "./showcase";

/**
 * The title screen: real PokéGuessr views rotating with a pin dropping on the
 * world map, the game's name, one line about it and one thing to press. The
 * page's one h1 names the site for search engines and screen readers. On a
 * phone the view runs edge to edge on top and the text sits under it.
 */
export function Hero() {
  return (
    <section
      className="dark-scope relative isolate overflow-hidden rounded-2xl border border-white/10 bg-card shadow-[0_30px_80px_-30px_hsl(var(--screen)/0.45)] max-sm:-mx-4 max-sm:rounded-none max-sm:border-0 max-sm:bg-background max-sm:shadow-none"
      data-testid="home-hero"
    >
      <h1 className="sr-only">PokéIQ: Pokémon games, quizzes and battles</h1>
      <div className="relative aspect-[6/5] overflow-hidden sm:absolute sm:inset-x-0 sm:top-0 sm:aspect-video lg:inset-y-0 lg:left-auto lg:aspect-auto lg:w-[66%]" data-testid="home-hero-view">
        <GuessrShowcase slides={showcaseSlides()} map={WORLD_THUMB} className="absolute inset-0" />
        {/* Fade the view into the card behind the text. */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-55% to-background sm:from-35% sm:to-card lg:bg-gradient-to-r lg:from-card lg:from-0% lg:via-card/60 lg:via-30% lg:to-transparent lg:to-70%" />
      </div>

      <div className="relative -mt-10 space-y-3 px-4 pb-4 sm:mt-0 sm:space-y-4 sm:px-8 sm:pb-8 sm:pt-[42%] lg:flex lg:min-h-[420px] lg:max-w-[46%] lg:flex-col lg:justify-center lg:px-12 lg:py-14">
        <p className="hud-label flex items-center gap-2 text-success">
          <span className="led h-1.5 w-1.5 animate-blink text-success motion-reduce:animate-none" aria-hidden /> Free · no sign-up
        </p>
        <h2 className="font-display text-[1.6rem] font-bold uppercase leading-none tracking-tight [text-shadow:0_2px_18px_rgb(0_0_0/0.6)] sm:text-4xl lg:text-[2.75rem]">
          Poké<span className="text-success">Guessr</span>
        </h2>
        <p className="max-w-md text-[15px] leading-snug text-muted-foreground sm:text-lg">
          GeoGuessr for Pokémon: real in-game screenshots of every region. Look around, then drop a pin.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1 sm:gap-y-3">
          <Link
            href="/guessr"
            data-testid="home-hero-play"
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-success px-6 font-display text-[15px] font-bold uppercase tracking-wider text-success-foreground shadow-[0_4px_0_hsl(154_60%_24%),0_0_32px_hsl(var(--success)/0.35)] transition-[transform,filter] hover:brightness-110 active:translate-y-[2px] sm:w-auto"
          >
            <Compass className="h-5 w-5" aria-hidden /> Play PokéGuessr
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
          </Link>
          <Link
            href="/pokedle"
            data-testid="home-hero-pokedle"
            className="mx-auto inline-flex min-h-[44px] items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-foreground/85 underline-offset-4 hover:text-foreground hover:underline sm:mx-0"
          >
            or today&apos;s Pokédle <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

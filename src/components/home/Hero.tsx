import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { GuessrShowcase } from "./GuessrShowcase";
import { HeroStats } from "./HeroStats";
import { WORLD_THUMB, showcaseSlides } from "./showcase";


/**
 * The title screen: what PokéIQ is, in three lines, over a real PokéGuessr
 * view, with one thing to press. On a phone the view sits on top and the
 * text runs over its lower edge, so the four headline games below still fit
 * on the first screen.
 */
export function Hero() {
  return (
    <section className="dark-scope relative isolate overflow-hidden rounded-2xl border border-white/10 bg-card shadow-[0_30px_80px_-30px_hsl(var(--screen)/0.45)]">
      <div className="absolute inset-x-0 top-0 aspect-video overflow-hidden lg:inset-y-0 lg:left-auto lg:aspect-auto lg:w-[66%]">
        <GuessrShowcase slides={showcaseSlides()} map={WORLD_THUMB} className="absolute inset-0" />
        {/* Fade the view into the card behind the text. */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-35% to-card lg:bg-gradient-to-r lg:from-card lg:from-0% lg:via-card/60 lg:via-30% lg:to-transparent lg:to-70%" />
      </div>

      <div className="relative space-y-4 px-5 pb-6 pt-[40%] sm:space-y-5 sm:px-8 sm:pb-8 lg:max-w-[52%] lg:px-12 lg:py-16">
        <p className="hud-label flex items-center gap-2 text-success">
          <span className="led h-1.5 w-1.5 animate-blink text-success motion-reduce:animate-none" aria-hidden /> Free · no sign-up · {fmt(POKEDEX.length)} Pokémon
        </p>
        <h1 className="font-display text-[1.7rem] font-bold uppercase leading-[1.02] tracking-tight [text-shadow:0_2px_18px_rgb(0_0_0/0.6)] min-[400px]:text-[1.9rem] sm:text-5xl lg:text-[3.6rem]">
          Guess the <span className="text-success">place.</span>
          <br />
          Name the <span className="text-screen">Pokémon.</span>
          <br />
          Win the <span className="text-primary">battle.</span>
        </h1>
        <p className="max-w-md text-[15px] leading-snug text-muted-foreground sm:text-lg">
          GeoGuessr with real in-game screenshots, a daily Pokédle you can duel strangers in, and battles on the Pokémon Showdown engine.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-1">
          <Link
            href="/guessr"
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-success px-6 font-display text-[15px] font-bold uppercase tracking-wider text-success-foreground shadow-[0_4px_0_hsl(154_60%_24%),0_0_32px_hsl(var(--success)/0.35)] transition-[transform,filter] hover:brightness-110 active:translate-y-[2px] sm:w-auto"
          >
            <Compass className="h-5 w-5" aria-hidden /> Play PokéGuessr
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
          </Link>
          <Link href="/pokedle" className="mx-auto inline-flex min-h-[44px] items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-foreground/85 underline-offset-4 hover:text-foreground hover:underline sm:mx-0">
            or today&apos;s Pokédle <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <HeroStats />
      </div>
    </section>
  );
}

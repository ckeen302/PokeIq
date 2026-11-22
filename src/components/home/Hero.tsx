import { HERO_IMAGES, type HeroPair } from "@/lib/hero-image";
import { PlayTodayLink } from "./PlayTodayLink";
import { serverT } from "@/i18n/server";
import home from "@/messages/home";

/**
 * Which picture loads. The theme is applied as `html.light` before first paint
 * (src/lib/theme.ts), from this device's storage, so the server can't pick:
 * both pictures are in the HTML, lazy, and the one for the other theme is
 * hidden, so it's never fetched (a hidden lazy image never loads, and the
 * browser's preload scanner skips lazy images). This runs as the parser
 * reaches it, straight after the pictures, and makes the one on show eager at
 * high priority: the page's LCP image is fetched as soon as it's parsed, and
 * nobody downloads the other theme's pair. Switching theme later shows the
 * other picture, which then loads as any lazy picture on screen does.
 */
const PICK_SCRIPT = `try{var t=document.documentElement.classList.contains("light")?"light":"dark",i=document.querySelector('[data-hero-theme="'+t+'"] img');if(i){i.fetchPriority="high";i.loading="eager"}}catch(e){}`;

/** One theme's picture: tall on a phone, wide from 640 px up. */
function HeroPicture({ theme, pair, className }: { theme: "dark" | "light"; pair: HeroPair; className: string }) {
  const { tall, wide } = pair;
  return (
    <picture className={className} data-hero-theme={theme}>
      <source media={tall.media} srcSet={tall.srcSet} sizes={tall.sizes} width={tall.width} height={tall.height} />
      {/* eslint-disable-next-line @next/next/no-img-element -- art direction per breakpoint and per theme, from pre-sized static files */}
      <img
        src={wide.src}
        srcSet={wide.srcSet}
        sizes={wide.sizes}
        width={wide.width}
        height={wide.height}
        alt=""
        loading="lazy"
        // PICK_SCRIPT makes the picture on show eager before React hydrates.
        suppressHydrationWarning
        className="h-full w-full object-cover object-[50%_20%] sm:object-[100%_50%]"
      />
    </picture>
  );
}

/**
 * The home banner: a Pokémon classroom (Alakazam at the blackboard) with the
 * site's name, one line about it and one thing to press, down to Today. A
 * night-time classroom with light words in the dark theme, a daytime one with
 * dark words in the light theme. On a desktop it's a card with the words over
 * the picture's quiet left side; on a phone the tall picture runs edge to edge
 * on top and fades into the words under it. The page's one h1 names the site
 * for search engines and screen readers.
 */
export function Hero() {
  const t = serverT(home);
  return (
    <section
      className="relative isolate overflow-hidden bg-[rgb(var(--hero-base))] [--hero-base:22_15_27] max-sm:-mx-4 max-sm:h-[466px] sm:flex sm:h-[420px] sm:items-center sm:rounded-2xl sm:shadow-[0_30px_70px_-30px_rgb(60_20_90/0.55),0_0_0_1px_rgb(255_255_255/0.06)] lg:h-auto lg:max-h-[580px] lg:min-h-[470px] lg:flex-1 [.light_&]:[--hero-base:242_237_251] [.light_&]:sm:shadow-[0_30px_70px_-30px_rgb(120_80_170/0.35),0_0_0_1px_rgb(80_50_120/0.08)]"
      data-testid="home-hero"
    >
      <h1 className="sr-only">{t("h1")}</h1>
      <div className="absolute inset-x-0 top-0 h-[400px] overflow-hidden sm:inset-0 sm:h-auto" data-testid="home-hero-view">
        {/* A slow camera drift (scaled past the box's edges the whole way, so they never show). Still for reduced motion. */}
        <div className="absolute inset-0 origin-[60%_40%] motion-safe:animate-hero-drift motion-safe:will-change-transform" data-testid="home-hero-shot">
          <HeroPicture theme="dark" pair={HERO_IMAGES.dark} className="block h-full w-full [.light_&]:hidden" />
          <HeroPicture theme="light" pair={HERO_IMAGES.light} className="hidden h-full w-full [.light_&]:block" />
          <script dangerouslySetInnerHTML={{ __html: PICK_SCRIPT }} />
        </div>
        {/* Into the banner's colour (the pictures' own shadow colour, or the daytime one's wall): under the picture on a
            phone; from the left, behind the words, on a wider screen, reaching further where the card is narrower and the
            class sits further left. */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_52%,rgb(var(--hero-base)/0.75)_72%,rgb(var(--hero-base))_100%)] sm:bg-[linear-gradient(90deg,rgb(var(--hero-base))_0%,rgb(var(--hero-base)/0.8)_40%,transparent_70%)] lg:bg-[linear-gradient(90deg,rgb(var(--hero-base))_0%,rgb(var(--hero-base)/0.7)_26%,transparent_50%)] xl:bg-[linear-gradient(90deg,rgb(var(--hero-base))_0%,rgb(var(--hero-base)/0.6)_18%,transparent_34%)]" />
      </div>

      <div className="absolute inset-x-4 bottom-4 z-[1] flex flex-col gap-[11px] sm:relative sm:inset-auto sm:max-w-[470px] sm:gap-3.5 sm:px-[52px]">
        <p className="flex items-center gap-2 font-display text-[11px] uppercase leading-none tracking-[0.3em] text-success">
          <span className="led h-1.5 w-1.5 animate-blink motion-reduce:animate-none" aria-hidden /> {t("free")}
        </p>
        <h2 className="font-display text-[38px] font-bold uppercase leading-[0.95] tracking-[-0.01em] text-white [text-shadow:0_4px_24px_rgb(0_0_0/0.6)] sm:text-[56px] [.light_&]:text-[#1b1530] [.light_&]:[text-shadow:none]">
          Poké<span className="text-primary">IQ</span>
        </h2>
        <p className="text-[15px] leading-[1.4] text-white/80 [text-shadow:0_2px_12px_rgb(0_0_0/0.8)] sm:max-w-[24rem] sm:text-[19px] [.light_&]:text-[rgb(40_30_60/0.78)] [.light_&]:[text-shadow:none]">
          {t("pitch")}
        </p>
        <PlayTodayLink className="group relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary px-[26px] font-display text-[15px] font-bold uppercase tracking-[0.08em] text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow)),0_0_32px_hsl(var(--primary)/0.35)] transition-[transform,filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-[2px] sm:w-fit">
          {/* Now and then a sweep of light across the one thing to press. */}
          <span
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent [transform:translateX(-120%)_skewX(-20deg)] motion-safe:animate-shine motion-reduce:hidden"
            aria-hidden
          />
          {t("play")}
        </PlayTodayLink>
      </div>
    </section>
  );
}

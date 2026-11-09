"use client";

import { useEffect, useRef, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import NextLink from "next/link";
import Link from "@/components/ui/Link";
import { ArrowRight, Camera, Check, Clock, Compass, MapPin, Share2 } from "lucide-react";
import { TimeToNextDaily } from "@/components/NextDailyCountdown";
import { dailyNumber } from "@/lib/daily";
import { geoShotIdOf } from "@/lib/geo-storage";
import { heroLoader } from "@/lib/hero-image";
import { GEO_MAX_ROUND_SCORE, GEO_ROUNDS } from "@/lib/geo-types";
import { useProgress } from "@/lib/progress";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { useAfterLoad } from "./AfterLoad";

/** The hero's picture box: full width on a phone and a tablet, the right two thirds on a desktop. */
const SIZES = "(min-width: 1024px) 760px, 100vw";

/**
 * A picture can be drawn this many CSS pixels across and stay sharp: the
 * daily-shot API says, coarsely, for the day's first place (0: never big).
 */
type DailyShot = { shot?: string; sharpTo?: number };

/** How wide a picture of this shape is drawn to cover the box (the hero crops it, object-cover). */
const coverWidth = (box: HTMLElement, aspect: number) => Math.max(box.clientWidth, box.clientHeight * aspect);

/**
 * The title screen's picture. The page is sent with a fixed, hand-picked
 * PokéGuessr view from a modern game (the page's LCP image, sized for the
 * screen). Once the page has loaded, today's first PokéGuessr place, the
 * picture the Daily deals first (so Play opens on a picture that's already
 * here), fades in over it, but only when it's big enough to stay sharp at
 * the size it's drawn: an old handheld game's screenshot scaled up to a hero
 * is soft and blocky, so on those days the fixed view stays. The chip says
 * what's showing: "Where is this?" over today's place, never over the fixed
 * view. Nothing about where it is: no map, no pin, no name.
 */
export function HeroPicture({ fallback }: { fallback: StaticImageData }) {
  const today = useToday();
  const loaded = useAfterLoad();
  const box = useRef<HTMLDivElement>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  // Once the page has loaded, so it never slows the fixed view (the LCP) on a slow connection.
  useEffect(() => {
    if (!today || !loaded) return;
    let live = true;
    setShown(false);
    (async () => {
      try {
        const res = await fetch(`/api/geo/daily-shot?date=${today}`);
        const data = res.ok ? ((await res.json()) as DailyShot) : null;
        if (!live || typeof data?.shot !== "string" || !geoShotIdOf(data.shot)) return;
        // Too small to be sharp here (judged on a 16:9 shot before it's fetched, then on its real shape): the fixed view stays.
        const el = box.current;
        const sharpTo = data.sharpTo ?? 0;
        if (!el || coverWidth(el, 16 / 9) > sharpTo) return;
        // Decoded before it's put on the page, so it fades in whole.
        const img = new window.Image();
        img.src = data.shot;
        await img.decode();
        if (live && img.naturalHeight && coverWidth(el, img.naturalWidth / img.naturalHeight) <= sharpTo) setShot(data.shot);
      } catch {
        // The fixed view stays.
      }
    })();
    return () => {
      live = false;
    };
  }, [today, loaded]);

  // One frame at opacity 0, then the fade.
  useEffect(() => {
    if (!shot) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [shot]);

  const daily = !!shot && shown;
  return (
    <>
      <div ref={box} className="absolute inset-0" data-testid="home-hero-shot" data-shot={daily ? shot : "fallback"}>
        {/* Pre-sized static files (src/lib/hero-image), the same pictures the image optimizer would make. */}
        <Image src={fallback} loader={heroLoader} alt="" priority placeholder="blur" fill sizes={SIZES} className="object-cover" />
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element -- the game's own screenshot URL, so the Daily's round 1 is already cached
          <img
            src={shot}
            alt=""
            decoding="async"
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-[opacity,transform] ease-out motion-reduce:transition-none",
              shown ? "scale-100 opacity-100" : "scale-[1.04] opacity-0"
            )}
            style={{ transitionDuration: "900ms, 6000ms" }}
          />
        )}
      </div>
      {/* Fade the picture into the card behind the words. */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent from-55% to-background sm:from-35% sm:to-card lg:bg-gradient-to-r lg:from-card lg:from-0% lg:via-card/60 lg:via-30% lg:to-transparent lg:to-70%" />
      {/* The question over today's place, never the answer; over the fixed view, what it is. */}
      <p
        className="absolute right-3 top-[3.75rem] z-[3] flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 font-display text-[13px] font-bold uppercase tracking-wider text-white shadow-[0_6px_18px_rgb(0_0_0/0.4)] backdrop-blur-sm sm:right-4 sm:top-4 lg:bottom-6 lg:right-6 lg:top-auto lg:px-4 lg:py-2 lg:text-base"
        data-testid="home-hero-question"
        data-daily={daily ? "true" : undefined}
      >
        {daily ? (
          <>
            <MapPin className="h-4 w-4 text-primary lg:h-5 lg:w-5" aria-hidden /> Where is this?
          </>
        ) : (
          <>
            <Camera className="h-4 w-4 text-primary lg:h-5 lg:w-5" aria-hidden /> Real in-game views
          </>
        )}
      </p>
    </>
  );
}

/**
 * The words and buttons beside the picture. A new visitor (and the server's
 * HTML): the pitch and Play, straight into today's places. Once today's
 * PokéGuessr is finished on this device: the score, when the next places
 * come, a way to share it and a free game.
 */
export function HeroCopy() {
  const progress = useProgress();
  const today = useToday();
  const score = today ? progress?.best?.[`geo-daily:${today}`] : undefined;
  const done = today !== null && score !== undefined;

  return (
    <>
      {done ? (
        <p className="hud-label flex items-center gap-2 text-success" data-testid="home-hero-done">
          <Check className="h-3.5 w-3.5" aria-hidden /> Today&apos;s places · done
        </p>
      ) : (
        <p className="hud-label flex items-center gap-2 text-success">
          <span className="led h-1.5 w-1.5 animate-blink text-success motion-reduce:animate-none" aria-hidden /> Free · no sign-up
        </p>
      )}
      <h2 className="font-display text-[1.75rem] font-bold uppercase leading-none tracking-tight [text-shadow:0_2px_18px_rgb(0_0_0/0.6)] sm:text-4xl lg:text-[2.75rem]">
        Poké<span className="text-success">Guessr</span>
      </h2>
      {done ? <DoneBody score={score} today={today} /> : <FreshBody />}
      <p className="text-[13px] leading-snug text-muted-foreground max-sm:text-center sm:text-sm" data-testid="home-hero-more">
        Plus a daily Pokédle, battles and Pokémon in 3D
      </p>
    </>
  );
}

const PLAY_CLASS =
  "group inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-success px-6 font-display text-[15px] font-bold uppercase tracking-wider text-success-foreground shadow-[0_4px_0_hsl(154_60%_24%),0_0_32px_hsl(var(--success)/0.35)] transition-[transform,filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-[2px] sm:w-auto";

function FreshBody() {
  return (
    <div className="space-y-3 sm:space-y-4 lg:min-h-[8.5rem]">
      <p className="max-w-md text-[15px] leading-snug text-muted-foreground sm:text-lg">
        GeoGuessr for Pokémon: real in-game screenshots of every region. Look around, then drop a pin.
      </p>
      <div className="pt-1">
        {/* Next's own link, prefetched as it comes into view on every screen: it's the one thing most visitors press. */}
        <NextLink href="/guessr?play=daily" data-testid="home-hero-play" className={PLAY_CLASS}>
          <Compass className="h-5 w-5" aria-hidden /> Play today&apos;s places
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
        </NextLink>
      </div>
    </div>
  );
}

function DoneBody({ score, today }: { score: number; today: string }) {
  const [shared, setShared] = useState<"copied" | "failed" | null>(null);
  const max = GEO_ROUNDS * GEO_MAX_ROUND_SCORE;

  async function share() {
    const text = `PokéGuessr Daily #${dailyNumber(today)}: ${score.toLocaleString("en-US")}/${max.toLocaleString("en-US")}\nToday's places, the same for everyone. Can you beat it?`;
    const url = `${window.location.origin}/guessr?play=daily`;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && typeof navigator.share === "function") {
      try {
        await navigator.share({ text, url });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setShared("copied");
    } catch {
      setShared("failed");
    }
    window.setTimeout(() => setShared(null), 2500);
  }

  return (
    <div className="space-y-3 sm:space-y-4 lg:min-h-[8.5rem]">
      <div className="space-y-1.5">
        <p className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-bold tabular-nums leading-none sm:text-4xl" data-testid="home-hero-score">
            {score.toLocaleString("en-US")}
          </span>
          <span className="text-sm text-muted-foreground sm:text-base">/ {max.toLocaleString("en-US")} today</span>
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground sm:text-base" data-testid="home-hero-next">
          <Clock className="h-4 w-4" aria-hidden />
          <span>
            Next places in <TimeToNextDaily className="font-semibold tabular-nums text-foreground" />
          </span>
        </p>
      </div>
      {/* Side by side on a phone too, so the finished hero is no taller than the new one. */}
      <div className="grid grid-cols-2 items-center gap-3 pt-1 sm:flex sm:flex-wrap sm:gap-x-5 sm:gap-y-1">
        <button type="button" onClick={() => void share()} className={cn(PLAY_CLASS, "max-sm:px-3 max-sm:text-sm")} data-testid="home-hero-share">
          <Share2 className="h-5 w-5 shrink-0" aria-hidden />
          {shared === "copied" ? "Copied" : shared === "failed" ? "Couldn't copy" : (
            <>
              Share<span className="max-sm:hidden"> my score</span>
            </>
          )}
        </button>
        <Link
          href="/guessr?play=game"
          data-testid="home-hero-free"
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-foreground/85 underline-offset-4 hover:text-foreground hover:underline max-sm:h-12 max-sm:rounded-md max-sm:border max-sm:border-white/15 max-sm:bg-white/[0.04]"
        >
          <span className="max-sm:hidden">Play a </span>free game <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <span className="sr-only" aria-live="polite">
        {shared === "copied" ? "Score copied" : ""}
      </span>
    </div>
  );
}

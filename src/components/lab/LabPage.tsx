import Image from "next/image";
import Link from "@/components/ui/Link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { HudHeading } from "@/components/game/HudHeading";
import { buttonVariants } from "@/components/ui/button";
import { liveLabExperiences, type LabExperience } from "@/lib/lab";
import { cn } from "@/lib/utils";
import { LAB_CSS } from "./lab-css";
import { serverT } from "@/i18n/server";
import lab from "@/messages/lab";

/** How wide an experience's screenshot is drawn on its card: half the page's width from md up. */
const CARD_IMAGE_SIZES = "(min-width: 1184px) 564px, (min-width: 768px) 50vw, 100vw";
/** Phones take a pre-sized copy of each screenshot (828 px wide, scripts/lab-phone-sizes.ts), so the server resizes nothing for them. */
const PHONE = "(max-width: 639px)";
const phoneImage = (src: string) => src.replace(/^\/lab\//, "/lab/phone/");

/**
 * /lab: a hero, then a grid of equal cards, one per 3D experience. The previews are
 * screenshots of the real scenes drifting slowly (or, without one, a CSS
 * animation): /lab itself never boots WebGL.
 */

type Vars = React.CSSProperties & Record<`--${string}`, string>;

export function LabPage() {
  const t = serverT(lab);
  const experiences = liveLabExperiences();
  // The two history films share the last row; with an odd number of cards before them, the one left alone on the row
  // above sits centred instead of beside a gap.
  const lone = experiences.length % 2 === 1 ? experiences.length - 3 : -1;
  return (
    <div className="mx-auto max-w-6xl space-y-12 sm:space-y-16 max-sm:space-y-6" data-testid="lab-page">
      <LabHero />
      <section id="experiences" className="scroll-mt-20 space-y-6 sm:space-y-8" aria-labelledby="lab-experiences">
        <HudHeading index={1} id="lab-experiences" title={t("experiences")} aside={t("experiencesAside")} className="max-sm:sr-only" />
        {/* One grid of equal cards: the same width, the same picture and the same height in every row. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 max-sm:gap-8" data-testid="lab-grid">
          {experiences.map((e, i) => (
            <LabCard key={e.id} experience={e} priority={i === 0} lone={i === lone} />
          ))}
        </div>
      </section>
      {/* Last, so the page's spacing doesn't push the hero down. */}
      <style>{LAB_CSS}</style>
    </div>
  );
}

/** The hero's picture: the lab's research team (Gengar taking notes, Alakazam, Porygon scanning) studying a sleeping Mewtwo, by night and by day. */
const HERO_ART = { dark: "/lab/hero-dark.webp", light: "/lab/hero-light.webp" } as const;

function LabHero() {
  const t = serverT(lab);
  return (
    <section
      className="lab-hero dark-scope relative -mx-4 -mt-8 overflow-hidden border-b border-screen/25 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border lg:aspect-[2.17/1]"
      data-testid="lab-hero"
    >
      {/* The scene: on a phone or tablet its own picture above the title; from lg, the whole card behind it, set a little to the right so the
          title and copy sit on its calm, faded left side (its left edge feathers into the card). Night or day, as the theme is. */}
      <div className="lab-hero-art relative w-full max-sm:aspect-video sm:max-lg:aspect-[2.2/1] lg:absolute lg:inset-y-0 lg:left-[8%] lg:w-full" aria-hidden>
        {(["dark", "light"] as const).map((m) => (
          <picture key={m} className={m === "dark" ? "contents [.light_&]:hidden" : "hidden [.light_&]:contents"}>
            <source media={PHONE} srcSet={phoneImage(HERO_ART[m])} />
            <Image src={HERO_ART[m]} alt="" fill priority={m === "dark"} loading="eager" sizes="(min-width: 1184px) 1152px, 100vw" className="object-cover object-center" />
          </picture>
        ))}
      </div>
      <div className="relative z-10 flex h-full items-center px-5 pb-10 pt-6 max-sm:px-4 max-sm:pb-8 max-sm:pt-5 sm:px-10 sm:pb-12 sm:pt-8 lg:py-0 lg:pl-12">
        <div className="space-y-5 max-sm:space-y-3 lg:max-w-[22rem]">
          <p className="hud-label flex items-center gap-2 text-screen max-sm:hidden">
            <span className="led h-1.5 w-1.5 text-success" aria-hidden /> {t("kicker")}
            <span className="rounded border border-primary/60 bg-primary/15 px-2 py-1 font-pixel text-[11px] uppercase leading-none tracking-wider text-primary" data-testid="lab-beta" title={t("betaTitle")}>{t("beta")}</span>
          </p>
          {/* Phones have no kicker line: the beta tag sits above the title. */}
          <p className="sm:hidden">
            <span className="rounded border border-primary/60 bg-primary/15 px-1.5 py-0.5 font-pixel text-[10px] uppercase leading-none tracking-wider text-primary" title={t("betaTitle")}>{t("beta")}</span>
          </p>
          <h1 className="lab-title font-display text-6xl font-bold uppercase leading-[0.9] tracking-tight sm:text-8xl">
            {t.rich("title", { b: (c) => <b>{c}</b> })}
          </h1>
          {/* Phones: one short line. */}
          <p className="text-lg text-foreground/80 sm:hidden">{t("linePhone")}</p>
          <p className="max-w-md text-base text-foreground/80 sm:text-lg max-sm:hidden">
            {t("line")}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1 max-sm:hidden">
            <Link href="#experiences" className={buttonVariants({ size: "lg" })}>
              {t("explore")} <ArrowDown className="h-4 w-4" aria-hidden />
            </Link>
            <span className="hud-label text-muted-foreground">{t("sound")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function LabCard({ experience: e, priority, lone }: { experience: LabExperience; priority: boolean; lone?: boolean }) {
  const t = serverT(lab);
  const title = t(`cards.${e.id}.title`);
  return (
    <article className={cn("lab-card group relative", lone && "md:col-span-2 md:mx-auto md:w-[calc(50%-0.75rem)]")} style={{ "--lab-accent": e.accent } as Vars} data-testid={`lab-card-${e.id}`}>
      <div className="lab-glow flex h-full flex-col overflow-hidden rounded-xl border bg-card max-sm:overflow-visible max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:!shadow-none">
        {/* Every card's picture is the same 16:9 box, the screenshots' own shape: nothing is cropped or letterboxed. */}
        <Link
          href={e.href}
          tabIndex={-1}
          aria-hidden
          className="screen dark-scope relative block aspect-video shrink-0 overflow-hidden max-sm:rounded-2xl"
          data-testid={`lab-art-${e.id}`}
        >
          {e.image ? (
            // Phones take the screenshot's phone-sized file (no resizing on the server); bigger screens a resized copy.
            <>
              <picture className={cn(e.imageLight && "contents [.light_&]:hidden")}>
                <source media={PHONE} srcSet={phoneImage(e.image)} />
                <Image
                  src={e.image}
                  alt=""
                  fill
                  sizes={CARD_IMAGE_SIZES}
                  loading={priority ? "eager" : undefined}
                  fetchPriority={priority ? "high" : undefined}
                  // The Professor's Lab's picture is a screenshot with text to its edges: shown whole, never zoomed by the drift.
                  className={cn("object-cover", e.id !== "pokedex" && "lab-kb")}
                />
              </picture>
              {/* In light mode, an experience with a light look of its own shows that instead. */}
              {e.imageLight && (
                <picture className="hidden [.light_&]:contents">
                  <source media={PHONE} srcSet={phoneImage(e.imageLight)} />
                  <Image src={e.imageLight} alt="" fill sizes={CARD_IMAGE_SIZES} className="object-cover lab-kb" />
                </picture>
              )}
            </>
          ) : e.id === "race" ? (
            <RacePreview />
          ) : null}
          <span className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(180deg,transparent_60%,rgb(0_0_0/0.55))]" />
          <span className="hud-label pointer-events-none absolute bottom-3 left-3 z-[3] flex items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1.5 text-white/90 backdrop-blur-sm max-sm:hidden">
            <span className="led lab-led h-1.5 w-1.5" /> {t("live")}
          </span>
        </Link>
        {/* The title and pitch share the same room on every card (a title's two lines and a pitch's four), so no card outgrows another. */}
        <div className="lab-card-text flex flex-1 flex-col gap-3 p-6 lg:p-8 max-sm:gap-1 max-sm:px-1 max-sm:pb-0 max-sm:pt-3">
          <p className="hud-label lab-accent truncate max-sm:order-2 max-sm:font-sans max-sm:text-[15px] max-sm:normal-case max-sm:leading-snug max-sm:tracking-normal max-sm:!text-muted-foreground">{t(`cards.${e.id}.kicker`)}</p>
          <div className="lab-card-copy flex flex-col gap-3 max-sm:order-1">
            <h2 className="lab-card-title font-display text-2xl font-bold uppercase tracking-tight lg:text-3xl">
              {/* On a phone the whole card is the link. */}
              <Link href={e.href} className="hover:text-[color:hsl(var(--lab-accent))] max-sm:after:absolute max-sm:after:inset-0 max-sm:after:z-[4]">{title}</Link>
            </h2>
            <p className="lab-card-pitch text-muted-foreground max-sm:hidden">{t(`cards.${e.id}.pitch`)}</p>
          </div>
          <div className="mt-auto pt-2 max-sm:hidden">
            <Link href={e.href} className={buttonVariants({ size: "lg" })} data-testid={`lab-open-${e.id}`} aria-label={t("openLabel", { title })}>
              {t("open")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Pokémon Race until it has a screenshot: runners streaking down a night track. */
function RacePreview() {
  return (
    <span className="lab-track absolute inset-0 block" data-testid="lab-race-preview">
      <span className="lab-lanes" />
      <span className="lab-finish" />
      {[
        ["calc(50% - 5px)", "2.6s", "0s"],
        ["calc(64% - 5px)", "3.1s", "-0.8s"],
        ["calc(78% - 5px)", "2.8s", "-1.6s"],
      ].map(([top, d, delay]) => (
        <span key={top} className="lab-runner" style={{ top, "--d": d, animationDelay: delay } as Vars} />
      ))}
    </span>
  );
}

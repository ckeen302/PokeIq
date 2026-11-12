import Image from "next/image";
import Link from "@/components/ui/Link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { HudHeading } from "@/components/game/HudHeading";
import { buttonVariants } from "@/components/ui/button";
import { liveLabExperiences, type LabExperience } from "@/lib/lab";
import { cn } from "@/lib/utils";
import { LAB_CSS } from "./lab-css";

/** How wide an experience's screenshot is drawn on its card (the hero's floating panels reuse the same file). */
const CARD_IMAGE_SIZES = "(min-width: 1024px) 680px, 100vw";
/** Phones take a pre-sized copy of each screenshot (828 px wide, scripts/lab-phone-sizes.ts), so the server resizes nothing for them. */
const PHONE = "(max-width: 639px)";
const phoneImage = (src: string) => src.replace(/^\/lab\//, "/lab/phone/");
/** A 1×1 transparent GIF: what the hero's floating panels (hidden on a phone) fetch on a phone, so they don't compete with the first card's picture. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * /lab: a hero, then one big card per 3D experience. The previews are
 * screenshots of the real scenes drifting slowly (or, without one, a CSS
 * animation): /lab itself never boots WebGL.
 */

type Vars = React.CSSProperties & Record<`--${string}`, string>;

export function LabPage() {
  const experiences = liveLabExperiences();
  const shots = experiences.filter((e) => e.image);
  return (
    <div className="mx-auto max-w-6xl space-y-12 sm:space-y-16 max-sm:space-y-6" data-testid="lab-page">
      <LabHero shots={shots} />
      <section id="experiences" className="scroll-mt-20 space-y-6 sm:space-y-8" aria-labelledby="lab-experiences">
        <HudHeading index={1} id="lab-experiences" title="Experiences" aside="Real-time 3D in your browser" className="max-sm:sr-only" />
        <div className="space-y-6 sm:space-y-8 max-sm:space-y-8">
          {experiences.map((e, i) => (
            <LabCard key={e.id} experience={e} flip={i % 2 === 1} priority={i === 0} />
          ))}
        </div>
      </section>
      {/* Last, so the page's spacing doesn't push the hero down. */}
      <style>{LAB_CSS}</style>
    </div>
  );
}

/** Where each screenshot floats in the hero (desktop), front to back. */
const PANEL_POSES = [
  { className: "left-[6%] top-[30%] z-[3] w-[64%]", transform: "rotateY(-16deg) rotateX(5deg)", delay: "0s" },
  { className: "right-[2%] top-[6%] z-[2] w-[52%]", transform: "rotateY(-22deg) rotateX(7deg) translateZ(-60px)", delay: "-2.4s" },
  { className: "right-[4%] bottom-[4%] z-[1] w-[44%] lg:right-[1%]", transform: "rotateY(-24deg) rotateX(4deg) translateZ(-120px)", delay: "-4.8s" },
];

function LabHero({ shots }: { shots: LabExperience[] }) {
  return (
    <section
      className="lab-hero dark-scope relative -mx-4 -mt-8 overflow-hidden border-b border-screen/25 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border"
      data-testid="lab-hero"
    >
      <div className="lab-floor" aria-hidden />
      <div className="relative grid gap-8 px-5 pb-10 pt-10 max-sm:px-4 max-sm:pb-14 max-sm:pt-12 sm:px-10 sm:pb-14 sm:pt-14 lg:min-h-[480px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-4 lg:py-16 lg:pl-14">
        <div className="relative z-10 space-y-5 max-sm:space-y-3">
          <p className="hud-label flex items-center gap-2 text-screen max-sm:hidden">
            <span className="led h-1.5 w-1.5 text-success" aria-hidden /> PokéIQ // 3D Lab
          </p>
          <h1 className="lab-title font-display text-6xl font-bold uppercase leading-[0.9] tracking-tight sm:text-8xl">
            <b>3D</b> Lab
          </h1>
          {/* Phones: one short line. */}
          <p className="text-lg text-foreground/80 sm:hidden">Pokémon in cinematic 3D, live in your browser.</p>
          <p className="max-w-md text-base text-foreground/80 sm:text-lg max-sm:hidden">
            The cinematic side of PokéIQ. Fly through Pokémon history, stand next to every Pokémon at its real size, race them under the floodlights and spin the whole Pokémon world, live in your browser.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1 max-sm:hidden">
            <Link href="#experiences" className={buttonVariants({ size: "lg" })}>
              Explore <ArrowDown className="h-4 w-4" aria-hidden />
            </Link>
            <span className="hud-label text-muted-foreground">Best with sound on</span>
          </div>
        </div>

        {/* Screenshots of the experiences, floating in perspective. */}
        <div className="lab-stack relative h-[230px] sm:h-[340px] lg:h-[400px] max-sm:hidden" aria-hidden>
          {shots.slice(0, 3).map((e, i) => {
            const pose = PANEL_POSES[i];
            return (
              <div
                key={e.id}
                className={cn("lab-panel", pose.className)}
                style={{ transform: pose.transform, animationDelay: pose.delay, "--lab-accent": e.accent } as Vars}
              >
                {/* The same sizes as the experience's card below, so the browser downloads each screenshot once. */}
                {/* Hidden on a phone: nothing to download there (an eager, hidden picture would hold up the first card's). */}
                <picture>
                  <source media={PHONE} srcSet={BLANK} />
                  <Image src={e.image!} alt="" width={1280} height={720} sizes={CARD_IMAGE_SIZES} loading="eager" fetchPriority="high" className="block aspect-video h-auto w-full object-cover" />
                </picture>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LabCard({ experience: e, flip, priority }: { experience: LabExperience; flip: boolean; priority: boolean }) {
  return (
    <article className="lab-card group max-sm:relative" style={{ "--lab-accent": e.accent } as Vars} data-testid={`lab-card-${e.id}`}>
      <div className={cn("lab-glow grid overflow-hidden rounded-xl border bg-card max-sm:overflow-visible max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:!shadow-none lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]", flip && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]")}>
        <Link
          href={e.href}
          tabIndex={-1}
          aria-hidden
          className={cn("screen dark-scope relative block aspect-video overflow-hidden lg:aspect-auto lg:min-h-[360px] max-sm:rounded-2xl", flip && "lg:order-2")}
        >
          {e.image ? (
            // Phones take the screenshot's phone-sized file (no resizing on the server); bigger screens a resized copy.
            <picture>
              <source media={PHONE} srcSet={phoneImage(e.image)} />
              <Image
                src={e.image}
                alt=""
                fill
                sizes={CARD_IMAGE_SIZES}
                loading={priority ? "eager" : undefined}
                fetchPriority={priority ? "high" : undefined}
                className="lab-kb object-cover"
              />
            </picture>
          ) : e.id === "race" ? (
            <RacePreview />
          ) : null}
          <span className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(180deg,transparent_50%,rgb(0_0_0/0.7))]" />
          <span className="hud-label pointer-events-none absolute bottom-3 left-3 z-[3] flex max-sm:hidden items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1.5 text-white/90 backdrop-blur-sm">
            <span className="led lab-led h-1.5 w-1.5" /> Live 3D
          </span>
        </Link>
        <div className="flex flex-col justify-center gap-4 p-5 sm:p-8 lg:p-10 max-sm:gap-1 max-sm:px-1 max-sm:pb-0 max-sm:pt-3">
          <p className="hud-label lab-accent max-sm:order-2 max-sm:font-sans max-sm:text-[15px] max-sm:normal-case max-sm:leading-snug max-sm:tracking-normal max-sm:!text-muted-foreground">{e.kicker}</p>
          <h2 className="font-display text-3xl font-bold uppercase leading-none tracking-tight sm:text-4xl max-sm:order-1 max-sm:text-2xl">
            {/* On a phone the whole card is the link. */}
            <Link href={e.href} className="hover:text-[color:hsl(var(--lab-accent))] max-sm:after:absolute max-sm:after:inset-0 max-sm:after:z-[4]">{e.title}</Link>
          </h2>
          <p className="text-muted-foreground sm:text-lg max-sm:hidden">{e.pitch}</p>
          <ul className="flex flex-wrap gap-2 max-sm:hidden" aria-label="Highlights">
            {e.tags.map((t) => (
              <li key={t} className="rounded-sm border border-foreground/10 bg-background/50 px-2 py-1 font-pixel text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                {t}
              </li>
            ))}
          </ul>
          <div className="pt-1 max-sm:hidden">
            <Link href={e.href} className={buttonVariants({ size: "lg" })} data-testid={`lab-open-${e.id}`} aria-label={`Open ${e.title}`}>
              Open <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
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

import Image from "next/image";
import Link from "@/components/ui/Link";
import { ArrowRight } from "lucide-react";
import { LAB_PATH, liveLabExperiences, type LabExperience } from "@/lib/lab";
import { cn } from "@/lib/utils";
import { HomeHeading } from "./HomeHeading";

/** The home page's order: the newest and most cinematic first. Anything not listed follows; at most six show. */
const ORDER = ["games", "pokemon-story", "world-history", "sizes", "race", "mass-battle", "globe", "timeline"];
const MAX = 6;

/** One short line per experience for the home page (/lab has the full pitches). */
const LINES: Record<string, string> = {
  games: "Every Pokémon in track, pool and ring events, from its real stats",
  "pokemon-story": "How Pokémon really began, as a 3D film",
  "world-history": "The Pokémon world's own history, as the games tell it",
  sizes: "Every Pokémon at its real size, side by side",
  race: "Who's fastest? A 3D sprint under the floodlights",
  "mass-battle": "How many Magikarp does it take to beat Arceus?",
  globe: "Spin the whole Pokémon world on a 3D globe",
  timeline: "Fly through Pokémon history in a time tunnel",
};

/** Phones take the screenshot file itself (as /lab does, so it's one download for both pages); wider screens a resized copy. */
const PHONE = "(max-width: 639px)";

/** The experiences for the home page, in its order: live ones with a picture only. */
export function homeLabExperiences(all: LabExperience[] = liveLabExperiences()): LabExperience[] {
  const rank = (e: LabExperience) => {
    const i = ORDER.indexOf(e.id as string);
    return i === -1 ? ORDER.length : i;
  };
  return all
    .filter((e) => e.live && e.image)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX);
}

/**
 * The 3D Lab, the site's showpiece, as a band of big picture cards: one
 * feature and the rest beside and under it on a desktop, a row to swipe
 * through on a phone. Still pictures only: nothing here starts any 3D.
 */
export function LabShowcase() {
  const items = homeLabExperiences();
  if (!items.length) return null;
  return (
    <section
      aria-labelledby="home-lab"
      data-testid="home-lab"
      className="dark-scope relative isolate overflow-hidden rounded-2xl border border-screen/20 px-6 pb-6 pt-5 text-foreground shadow-[0_30px_80px_-40px_hsl(var(--screen)/0.5)] max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:px-4 max-sm:pb-5 lg:px-8 lg:pb-8 lg:pt-6"
      style={{
        background:
          "radial-gradient(60% 70% at 85% 0%, hsl(var(--screen) / 0.2), transparent 70%), radial-gradient(50% 60% at 0% 100%, hsl(var(--primary) / 0.16), transparent 70%), linear-gradient(180deg, hsl(250 50% 6%), hsl(252 46% 9%))",
      }}
    >
      <HomeHeading
        id="home-lab"
        title={
          <>
            <span className="text-screen">3D</span> Lab
          </>
        }
        aside={<span className="text-sm text-muted-foreground">Pokémon in cinematic 3D, right in your browser</span>}
        action={
          <Link href={LAB_PATH} prefetch={false} className="inline-flex min-h-[44px] shrink-0 items-center gap-1 text-sm font-semibold text-screen hover:underline" data-testid="home-lab-all">
            See all <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />
      <ul
        className="-mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-6 px-6 pb-1 [scrollbar-width:none] max-sm:-mx-4 max-sm:scroll-px-4 max-sm:px-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
        data-testid="home-lab-row"
      >
        {items.map((e, i) => (
          <li key={e.id} className={cn("w-[82%] shrink-0 snap-start sm:w-[46%] lg:w-auto", i === 0 && "lg:col-span-2 lg:row-span-2")}>
            <LabCard experience={e} feature={i === 0} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LabCard({ experience: e, feature }: { experience: LabExperience; feature: boolean }) {
  const line = LINES[e.id] ?? e.kicker;
  return (
    <Link
      href={e.href}
      prefetch={false}
      className="group relative block aspect-video overflow-hidden rounded-xl border border-white/10 bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-screen lg:h-full"
      style={{ "--lab-accent": e.accent } as React.CSSProperties}
      data-testid={`home-lab-${e.id}`}
    >
      <picture>
        <source media={PHONE} srcSet={e.image} />
        <Image
          src={e.image!}
          alt=""
          fill
          sizes={feature ? "(min-width: 1024px) 740px, 46vw" : "(min-width: 1024px) 360px, 46vw"}
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
        />
      </picture>
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgb(0_0_0/0.85))]" aria-hidden />
      {feature && (
        <span className="hud-label pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1.5 text-white/90 backdrop-blur-sm max-lg:hidden">
          <span className="led h-1.5 w-1.5" style={{ color: `hsl(${e.accent})` }} aria-hidden /> Live 3D
        </span>
      )}
      <span className={cn("absolute inset-x-0 bottom-0 block p-3 sm:p-4", feature && "lg:p-7")}>
        <span className={cn("block font-display text-lg font-bold uppercase leading-tight tracking-wide text-white", feature && "lg:text-4xl lg:tracking-tight")}>{e.title}</span>
        <span className={cn("mt-0.5 block text-[13px] leading-snug text-white/80 sm:text-sm", feature ? "lg:mt-2 lg:max-w-xl lg:text-lg" : "lg:truncate")}>{line}</span>
        {feature && (
          <span className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 font-display text-sm font-bold uppercase tracking-wider text-black transition-transform group-hover:translate-x-0.5 max-lg:hidden">
            Open <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        )}
      </span>
    </Link>
  );
}

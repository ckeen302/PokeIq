import Image from "next/image";
import Link from "next/link";
import { Countdown } from "@/components/Countdown";
import { TrainerCard } from "@/components/TrainerCard";
import { CATEGORY_META, QUIZ_CATEGORIES } from "@/engines/types";
import { dayNumberOf, todayKey } from "@/lib/daily";
import { officialArtworkUrl } from "@/lib/pokeapi";

export const dynamic = "force-dynamic";

/** Decorative artwork floating around the hero (pure décor, not questions). */
const HERO_SPRITES = [
  { id: 25, size: 88, className: "left-[4%] top-6", duration: "5s", tilt: "-8deg" },
  { id: 6, size: 110, className: "right-[3%] top-2", duration: "6.5s", tilt: "7deg" },
  { id: 94, size: 80, className: "left-[13%] bottom-0", duration: "5.8s", tilt: "5deg" },
  // Alakazam — the mascot — gets the biggest, slowest float.
  { id: 65, size: 96, className: "right-[13%] bottom-2", duration: "7.4s", tilt: "-6deg" },
];

const MODULE_DETAILS: Record<string, { chips: string[]; glow: string }> = {
  "whos-that": {
    chips: ["Anime silhouettes", "Shadow reveals", "Alt forms"],
    glow: "group-hover:shadow-amber-500/20",
  },
  "type-detective": {
    chips: ["Weaknesses", "Resistances", "Immunities", "STAB"],
    glow: "group-hover:shadow-emerald-500/20",
  },
  "move-master": {
    chips: ["Effects", "Learnsets", "Base power", "Move types"],
    glow: "group-hover:shadow-sky-500/20",
  },
  "stat-showdown": {
    chips: ["Speed tiers", "Stat kings", "BST duels"],
    glow: "group-hover:shadow-fuchsia-500/20",
  },
};

const STATS = [
  { value: "1025", label: "Pokémon" },
  { value: "900+", label: "moves" },
  { value: "18", label: "types" },
  { value: "∞", label: "questions" },
];

export default function Home() {
  const dateKey = todayKey();
  const dayNumber = dayNumberOf(dateKey);
  const endsAt = new Date(
    Date.parse(`${dateKey}T00:00:00Z`) + 86_400_000,
  ).toISOString();

  return (
    <div>
      <section className="relative py-14 text-center sm:py-20">
        {HERO_SPRITES.map((sprite) => (
          <div
            key={sprite.id}
            aria-hidden
            className={`float-sprite pointer-events-none absolute hidden select-none sm:block ${sprite.className}`}
            style={
              {
                "--float-duration": sprite.duration,
                "--tilt": sprite.tilt,
              } as React.CSSProperties
            }
          >
            <Image
              src={officialArtworkUrl(sprite.id)}
              alt=""
              width={sprite.size}
              height={sprite.size}
              className="opacity-80"
              priority
            />
          </div>
        ))}

        <p className="mx-auto mb-4 inline-block rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium tracking-wide text-sky-300">
          EVERY QUESTION COMPUTED LIVE · ZERO QUESTION BANKS
        </p>
        <h1 className="text-balance text-5xl font-black leading-[1.05] tracking-tight sm:text-6xl">
          How deep does your
          <br />
          <span className="text-gradient">Pokédex</span> go?
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-muted">
          Four quiz engines generate every question from live PokéAPI data the
          moment you play. No repeats. No mercy. Just mastery.
        </p>

        <div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-6 sm:gap-10">
          {STATS.map((stat) => (
            <div key={stat.label}>
              <div className="font-mono text-2xl font-bold text-foreground">
                {stat.value}
              </div>
              <div className="text-xs uppercase tracking-wider text-muted">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6" aria-label="Daily challenge">
        <Link
          href="/daily"
          className="glass card-enter shimmer-hover group relative flex flex-col gap-4 overflow-hidden rounded-3xl border-amber-400/20 p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-400/40 sm:flex-row sm:items-center sm:justify-between"
        >
          <div
            aria-hidden
            className="absolute -left-10 -top-12 h-40 w-40 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 opacity-15 blur-2xl transition-opacity duration-300 group-hover:opacity-25"
          />
          <div className="flex items-center gap-4">
            <span
              className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-rose-500 p-3 text-2xl shadow-lg"
              aria-hidden
            >
              🗓️
            </span>
            <div>
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                Daily Gauntlet #{dayNumber}
                <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  Global
                </span>
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                10 seeded questions — identical for every trainer on Earth today.
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-[11px] uppercase tracking-wider text-muted">
              Resets in
            </div>
            <Countdown
              endsAt={endsAt}
              className="font-mono text-xl font-bold text-amber-300"
            />
          </div>
        </Link>
      </section>

      <section className="grid gap-5 sm:grid-cols-2" aria-label="Quiz modules">
        {QUIZ_CATEGORIES.map((category, i) => {
          const meta = CATEGORY_META[category];
          const details = MODULE_DETAILS[category];
          return (
            <Link
              key={category}
              href={`/quiz/${category}`}
              style={{ "--delay": `${i * 90}ms` } as React.CSSProperties}
              className={`glass card-enter shimmer-hover group relative overflow-hidden rounded-3xl p-7 shadow-xl shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl focus-visible:-translate-y-1 ${details.glow}`}
            >
              <div
                aria-hidden
                className={`absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gradient-to-br ${meta.accent} opacity-15 blur-2xl transition-opacity duration-300 group-hover:opacity-30`}
              />
              <div className="flex items-start justify-between">
                <span
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.accent} text-2xl shadow-lg`}
                  aria-hidden
                >
                  {meta.emoji}
                </span>
                <span
                  aria-hidden
                  className="translate-x-0 text-xl text-muted transition-all duration-300 group-hover:translate-x-1 group-hover:text-foreground"
                >
                  →
                </span>
              </div>
              <h2 className="mt-5 text-xl font-bold">{meta.name}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {meta.tagline}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {details.chips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-muted transition-colors group-hover:bg-white/10 group-hover:text-foreground/80"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </section>

      <TrainerCard />

      <section className="mt-12 text-center text-sm text-muted">
        <p>
          ⌨️ Pro play: <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono">1</kbd>–
          <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono">4</kbd> to answer,{" "}
          <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono">Enter</kbd> to advance
        </p>
      </section>
    </div>
  );
}

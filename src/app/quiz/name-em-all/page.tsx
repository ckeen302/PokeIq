import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { BackButton } from "@/components/ui/BackButton";
import { GameInfo } from "@/components/seo/GameInfo";
import { NeaDailyCard, NeaRaceCard } from "@/components/name-em-all/HubCards";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { NEA_CATEGORIES, NEA_GROUPS, NEA_PATH, NEA_TITLE, neaHref } from "@/lib/name-em-all/categories";
import { neaCounts } from "@/lib/name-em-all/targets";

export const metadata: Metadata = pageMetadata({
  title: "Name 'em All: Can You Name Every Pokémon? Recall Quiz",
  description: "Type every Pokémon you can remember: all 1,025, a generation, a type, Legendaries, Megas, regional forms or a regional Pokédex. Daily quiz, races with friends and leaderboards.",
  path: NEA_PATH,
  image: SHARE_IMAGES.site,
});

export default function NameEmAllHub() {
  const counts = neaCounts();
  const options = NEA_CATEGORIES.map((c) => ({ id: c.id, label: c.label, total: counts[c.id] }));
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <BackButton href="/play" />
      <header className="mx-auto max-w-2xl space-y-2 text-center">
        <p className="hud-label text-screen">Recall quiz</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{NEA_TITLE}</h1>
        <p className="text-muted-foreground">
          How many Pokémon can you name from memory? Type them in, and each one pops into its slot the moment it&apos;s spelled right.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <NeaDailyCard labels={Object.fromEntries(NEA_CATEGORIES.map((c) => [c.id, c.label]))} counts={counts} />
        <NeaRaceCard options={options} />
      </div>

      <div className="space-y-6" data-testid="nea-categories">
        {NEA_GROUPS.map((g) => {
          const cats = NEA_CATEGORIES.filter((c) => c.group === g.id);
          return (
            <section key={g.id} className="space-y-2.5" aria-labelledby={`nea-g-${g.id}`}>
              <h2 id={`nea-g-${g.id}`} className="font-display text-lg font-bold uppercase tracking-wide">
                {g.label}
              </h2>
              <ul className={g.id === "all" ? "grid gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"}>
                {cats.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={neaHref(c.id)}
                      className="group flex h-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2.5 transition-colors hover:border-screen/60"
                      data-testid={`nea-cat-${c.id}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{c.label}</span>
                        <span className="hud-label">{counts[c.id].toLocaleString("en-US")} Pokémon</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <GameInfo
        hidden
        path={NEA_PATH}
        name={NEA_TITLE}
        description="A free Pokémon recall quiz: name every Pokémon in a category against the clock."
        intro="Name 'em All is a Pokémon recall quiz: pick a category and type every Pokémon in it from memory. Names count the instant they're spelled right, in any order."
        steps={[
          "Pick a category: everything, a generation, a type, the Legendaries, Megas, regional forms or a regional Pokédex.",
          "Choose Regular, Chaos or Dex order, a timer and any hints.",
          "Type names: each fills its slot as soon as it's spelled right. Capitals, accents and punctuation don't matter.",
          "Give up any time to see the ones you missed, each linked to its Pokédex page.",
        ]}
        faqs={[
          { q: "Is there a daily?", a: "Yes: one category a day, the same for everyone, with its own board. One ranked try per day." },
          { q: "Can I race my friends?", a: "Start a race, share the link, and up to eight trainers name the same category at once with live progress bars." },
          { q: "How do I get on the leaderboard?", a: "Play in Regular mode without hints or pausing. Each category ranks the fastest full clear and the most named inside its standard time." },
        ]}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { BackButton } from "@/components/ui/BackButton";
import { DetailHero } from "@/components/pokedex/detail/DetailParts";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TrainerAvatar } from "@/components/trainers/TrainerAvatar";
import { TRAINER_GAMES, trainerGame } from "@/lib/trainers/games";
import { NOTABLE, ROLE_ORDER, notable } from "@/lib/trainers/notable";
import { gameAreas, gameFile } from "@/lib/trainers/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return TRAINER_GAMES.map((g) => ({ game: g.key }));
}

interface PageProps {
  params: Promise<{ game: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const g = trainerGame((await params).game);
  if (!g) return {};
  return pageMetadata({
    title: `Every Trainer in Pokémon ${g.name} — Teams by Location`,
    description: `All ${gameFile(g.key)!.teams.length} trainer teams in Pokémon ${g.name}, route by route: Gym Leaders, the Elite Four, rivals and every generic trainer with their Pokémon, levels, moves and held items.`,
    path: `/pokedex/trainers/${g.key}`,
    socialTitle: `${g.name} trainers · PokéIQ Pokédex`,
  });
}

export default async function TrainerGamePage({ params }: PageProps) {
  const g = trainerGame((await params).game);
  if (!g) notFound();
  const f = gameFile(g.key)!;
  const regions = gameAreas(g.key);
  const notables = [...new Set(f.teams.map((t) => t.n).filter(Boolean) as string[])]
    .map((s) => notable(s)!)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || NOTABLE.indexOf(a) - NOTABLE.indexOf(b));
  const places = regions.reduce((n, r) => n + r.groups.reduce((m, gr) => m + gr.areas.length, 0), 0);
  let idx = 0;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <nav className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <BackButton href="/pokedex/trainers" label="All trainers" />
        <Link href="/pokedex" className="hover:text-foreground">
          Pokédex
        </Link>
      </nav>
      <DetailHero kicker={`Trainers · Gen ${["", "I", "II", "III", "IV"][g.gen]} · ${g.regions.join(" & ")}`} title={`Pokémon ${g.name}`}>
        <p className="max-w-2xl text-foreground/90">
          {f.teams.length.toLocaleString("en-US")} trainer teams across {places} places. Pick a route, town or dungeon to see everyone you can battle there and the exact Pokémon they use.
        </p>
      </DetailHero>

      {notables.length > 0 && (
        <Section id="notable" index={++idx} title="Notable trainers" subtitle={`${notables.length} in ${g.name}`}>
          <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]" data-hscroll data-testid="trainers-game-notables">
            {notables.map((n) => (
              <li key={n.slug} className="shrink-0">
                <Link href={`/pokedex/trainers/notable/${n.slug}#game-${g.key}`} className="flex w-24 flex-col items-center gap-1.5 rounded-lg border bg-card p-2 text-center transition-colors hover:border-screen/60">
                  <TrainerAvatar name={n.name} type={n.type} size="sm" />
                  <span className="line-clamp-2 w-full font-display text-xs font-bold uppercase leading-tight tracking-wide">{n.name}</span>
                  <span className="text-[10px] leading-tight text-muted-foreground">{n.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {regions.map((r) => (
        <Section key={r.region} id={`region-${r.region.toLowerCase().replace(/[^a-z]+/g, "-")}`} index={++idx} title={r.region} subtitle={`${r.groups.reduce((n, gr) => n + gr.areas.length, 0)} places`}>
          <div className="space-y-6">
            {r.groups.map((gr) => (
              <div key={gr.kind} className="space-y-2">
                <h3 className="hud-label">{gr.kind}</h3>
                <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" data-testid="trainers-areas">
                  {gr.areas.map((a) => (
                    <li key={a.slug}>
                      <Link href={`/pokedex/trainers/${g.key}/${a.slug}`} data-testid="trainers-area-link" className="group flex h-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2.5 transition-colors hover:border-screen/60">
                        <span className="min-w-0">
                          <span className="block truncate font-display text-sm font-bold uppercase tracking-wide group-hover:text-screen">{a.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {a.count} trainer{a.count === 1 ? "" : "s"}
                          </span>
                        </span>
                        {a.notables.length > 0 && (
                          <span className="flex shrink-0 -space-x-2">
                            {a.notables.slice(0, 3).map((s) => {
                              const n = notable(s)!;
                              return <TrainerAvatar key={s} name={n.name} type={n.type} size="sm" className="h-8 w-8 border text-[10px]" />;
                            })}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ))}
      <p className="text-center text-xs text-muted-foreground">
        Imported from{" "}
        <a href={`https://github.com/${g.repo}`} className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          {g.repo}
        </a>
        .
      </p>
    </article>
  );
}

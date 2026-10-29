import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { SHARE_IMAGES, pageMetadata, jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { BackButton } from "@/components/ui/BackButton";
import { HudHeading } from "@/components/game/HudHeading";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { TeamGrid } from "@/components/trainers/TeamView";
import { TeamTabs } from "@/components/trainers/TeamTabs";
import { TrainerAvatar } from "@/components/trainers/TrainerAvatar";
import { trainerGame } from "@/lib/trainers/games";
import { notable } from "@/lib/trainers/notable";
import { notableDirectory, notableTeams } from "@/lib/trainers/data";
import { teamTitle } from "@/lib/trainers/format";

export const dynamicParams = false;

export function generateStaticParams() {
  return notableDirectory().map((n) => ({ slug: n.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const n = notable((await params).slug);
  if (!n) return {};
  const games = notableTeams(n.slug).map((g) => trainerGame(g.game)!.name);
  return pageMetadata({
    title: `${n.name} — ${n.role}${n.type ? ` (${n.type} type)` : ""} Teams & Locations`,
    description: `${n.blurb.split(". ")[0]}. Every team ${n.name} uses in ${games.join(", ")}, with levels, moves and held items, and where to battle them.`,
    path: `/pokedex/trainers/notable/${n.slug}`,
    image: SHARE_IMAGES.pokedex,
    socialTitle: `${n.name} · PokéIQ Trainers`,
  });
}

export default async function NotableTrainerPage({ params }: PageProps) {
  const n = notable((await params).slug);
  if (!n) notFound();
  const byGame = notableTeams(n.slug);
  if (!byGame.length) notFound();
  const roles = [n.role, ...(n.alsoRoles ?? [])];

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ "@context": "https://schema.org", "@type": "Person", name: n.name, description: n.blurb, url: `${SITE_URL}/pokedex/trainers/notable/${n.slug}` }) }} />
      <nav className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <BackButton href="/pokedex/trainers" label="All trainers" />
        <Link href="/pokedex" className="hover:text-foreground">
          Pokédex
        </Link>
      </nav>

      <header className="hud flex flex-col gap-5 rounded-lg border bg-card p-5 sm:flex-row sm:items-center sm:p-6" data-testid="notable-hero">
        <TrainerAvatar name={n.name} type={n.type} size="lg" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="hud-label text-screen">
            {roles.join(" · ")} · {n.region}
          </p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{n.name}</h1>
          {(n.type || n.badge) && (
            <div className="flex flex-wrap items-center gap-2">
              {n.type && <TypeBadge type={n.type.toLowerCase()} size="lg" />}
              {n.badge && <span className="rounded-[4px] border border-foreground/10 bg-shade/30 px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wider">{n.badge}</span>}
            </div>
          )}
          <p className="max-w-2xl text-foreground/90" data-testid="notable-blurb">
            {n.blurb}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {byGame.map(({ game }) => {
              const g = trainerGame(game)!;
              return (
                <li key={game}>
                  <a href={`#game-${game}`} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs hover:border-screen/60 hover:text-screen">
                    <span className="h-2 w-2 rounded-full" style={{ background: g.color }} aria-hidden />
                    {g.name}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </header>

      {byGame.map(({ game, teams }, gi) => {
        const g = trainerGame(game)!;
        // One card per battle; rival starter variants and rematches of the same battle share a card.
        const battles = new Map<string, typeof teams>();
        for (const t of teams) battles.set(t.g ?? t.id, [...(battles.get(t.g ?? t.id) ?? []), t]);
        return (
          <section key={game} id={`game-${game}`} className="scroll-mt-28 space-y-4" aria-labelledby={`game-${game}-title`} data-testid="notable-game">
            <HudHeading id={`game-${game}-title`} index={gi + 1} title={`Pokémon ${g.name}`} aside={`${teams.length} team${teams.length === 1 ? "" : "s"}`} />
            <div className="space-y-3">
              {[...battles.values()].map((list) => {
                const first = list[0];
                const where = first.places.map((p) => ({ label: p.section ? `${p.area.name} · ${p.section}` : p.area.name, href: `/pokedex/trainers/${game}/${p.area.slug}` }));
                const label = (t: (typeof list)[number], i: number) => t.tag ?? (i === 0 ? "First battle" : `Battle ${i + 1}`);
                return (
                  <article key={first.id} className="hud space-y-3 rounded-lg border bg-card p-3 sm:p-4" data-testid="notable-battle">
                    <header>
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-bold uppercase tracking-wide">{teamTitle(first)}</h3>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {where.map((w, i) => (
                            <span key={w.href + i}>
                              <Link href={w.href} className="font-semibold text-foreground hover:text-screen">
                                {w.label}
                              </Link>
                            </span>
                          ))}
                          {list.length === 1 && first.tag && <span className="text-primary">· {first.tag}</span>}
                        </p>
                      </div>
                    </header>
                    {list.length === 1 ? (
                      <TeamGrid team={first} />
                    ) : (
                      <TeamTabs labels={list.map(label)}>
                        {list.map((t) => (
                          <TeamGrid key={t.id} team={t} />
                        ))}
                      </TeamTabs>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </article>
  );
}

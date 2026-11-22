import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { MapPin } from "lucide-react";
import { SHARE_IMAGES, pageMetadata, jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { HudHeading } from "@/components/game/HudHeading";
import { DetailNav } from "@/components/pokedex/detail/DetailParts";
import { notableOrder, pagerFor } from "@/lib/dex/neighbours";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { TeamGrid } from "@/components/trainers/TeamView";
import { TeamTabs } from "@/components/trainers/TeamTabs";
import { TrainerAvatar } from "@/components/trainers/TrainerAvatar";
import { trainerGame } from "@/lib/trainers/games";
import { ROLE_ORDER, notable } from "@/lib/trainers/notable";
import { notableDirectory, notableTeams } from "@/lib/trainers/data";
import { teamTitle } from "@/lib/trainers/format";
import { gameName } from "@/lib/trainers/explorer-local";
import { battleLabel, roleName, tagName } from "@/lib/trainers/i18n";
import { dexNames } from "@/lib/dex/local-names";
import { serverT } from "@/i18n/server";
import trainersNs from "@/messages/trainers";

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
  const t = serverT(trainersNs);
  const names = dexNames();
  const en = names.locale === "en";
  const list = notableTeams(n.slug).map((g) => (en ? trainerGame(g.game)!.name : gameName(names, trainerGame(g.game)!)));
  const games = en ? list.join(", ") : new Intl.ListFormat(names.locale, { type: "conjunction" }).format(list);
  const role = roleName(t, n.role);
  return pageMetadata({
    title: n.type ? t("meta.notableTitleType", { name: n.name, role, type: names.type(n.type) }) : t("meta.notableTitle", { name: n.name, role }),
    // The summaries are English only: another language's description leaves them out.
    description: en ? t("meta.notableDescription", { lead: n.blurb.split(". ")[0], name: n.name, games }) : t("meta.notableDescriptionLocal", { name: n.name, games }),
    path: `/pokedex/trainers/notable/${n.slug}`,
    image: SHARE_IMAGES.pokedex,
    socialTitle: t("meta.notableSocial", { name: n.name }),
  });
}

export default async function NotableTrainerPage({ params }: PageProps) {
  const n = notable((await params).slug);
  if (!n) notFound();
  const byGame = notableTeams(n.slug);
  if (!byGame.length) notFound();
  const pager = pagerFor(notableOrder(notableDirectory(), ROLE_ORDER), (x) => x.slug === n.slug, (x) => ({ href: `/pokedex/trainers/notable/${x.slug}`, label: x.name }));
  const t = serverT(trainersNs);
  const names = dexNames();
  const en = names.locale === "en";
  const roles = [n.role, ...(n.alsoRoles ?? [])].map((r) => roleName(t, r));

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ "@context": "https://schema.org", "@type": "Person", name: n.name, ...(en && { description: n.blurb }), url: `${SITE_URL}/pokedex/trainers/notable/${n.slug}` }) }} />
      <DetailNav href="/pokedex/trainers" label={t("allTrainers")} pager={pager} />

      <header className="hud flex flex-col gap-5 rounded-lg border bg-card p-5 sm:flex-row sm:items-center sm:p-6" data-testid="notable-hero">
        <TrainerAvatar name={n.name} type={n.type} size="lg" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="hud-label text-screen">
            {roles.join(" · ")} · {names.region(n.region)}
          </p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{n.name}</h1>
          {(n.type || n.badge) && (
            <div className="flex flex-wrap items-center gap-2">
              {n.type && <TypeBadge type={n.type.toLowerCase()} size="lg" label={names.locale === "en" ? undefined : names.type(n.type)} />}
              {n.badge && <span className="rounded-[4px] border border-foreground/10 bg-shade/30 px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wider">{n.badge}</span>}
            </div>
          )}
          {/* The summaries are our own English text, with no translation yet: other languages leave them out. */}
          {en && (
            <p className="max-w-2xl text-foreground/90" data-testid="notable-blurb">
              {n.blurb}
            </p>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {byGame.map(({ game }) => {
              const g = trainerGame(game)!;
              return (
                <li key={game}>
                  <a href={`#game-${game}`} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs hover:border-screen/60 hover:text-screen">
                    <span className="h-2 w-2 rounded-full" style={{ background: g.color }} aria-hidden />
                    {en ? g.name : gameName(names, g)}
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
            <HudHeading id={`game-${game}-title`} index={gi + 1} title={t("game.title", { game: en ? g.name : gameName(names, g) })} aside={t("notable.battles", { n: teams.length })} />
            <div className="space-y-3">
              {[...battles.values()].map((list) => {
                const first = list[0];
                const where = first.places.map((p) => ({ label: p.section ? `${names.place(p.area.name)} · ${p.section}` : names.place(p.area.name), href: `/pokedex/trainers/${game}/${p.area.slug}` }));
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
                          {list.length === 1 && first.tag && <span className="text-primary">· {tagName(t, names, first.tag)}</span>}
                        </p>
                      </div>
                    </header>
                    {list.length === 1 ? (
                      <TeamGrid team={first} />
                    ) : (
                      <TeamTabs label={t("team.battles")} labels={list.map((team, i) => battleLabel(t, names, team, i))}>
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

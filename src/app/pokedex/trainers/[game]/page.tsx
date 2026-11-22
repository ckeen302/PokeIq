import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { DetailHero, DetailNav } from "@/components/pokedex/detail/DetailParts";
import { pagerFor } from "@/lib/dex/neighbours";
import { Section } from "@/components/pokedex/entry/Reveal";
import { TrainerAvatar } from "@/components/trainers/TrainerAvatar";
import { ROMAN, TRAINER_GAMES, sourceUrl, trainerGame } from "@/lib/trainers/games";
import { NOTABLE, ROLE_ORDER, notable } from "@/lib/trainers/notable";
import { gameAreas, gameFile } from "@/lib/trainers/data";
import { gameName } from "@/lib/trainers/explorer-local";
import { kindName, roleName } from "@/lib/trainers/i18n";
import { dexNames } from "@/lib/dex/local-names";
import { serverT } from "@/i18n/server";
import trainersNs from "@/messages/trainers";

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
  const t = serverT(trainersNs);
  const game = gameName(dexNames(), g);
  return pageMetadata({
    title: t("meta.gameTitle", { game }),
    description: t("meta.gameDescription", { game }),
    path: `/pokedex/trainers/${g.key}`,
    image: SHARE_IMAGES.pokedex,
    socialTitle: t("meta.gameSocial", { game }),
  });
}

export default async function TrainerGamePage({ params }: PageProps) {
  const g = trainerGame((await params).game);
  if (!g) notFound();
  const t = serverT(trainersNs);
  const names = dexNames();
  const game = gameName(names, g);
  const f = gameFile(g.key)!;
  const regions = gameAreas(g.key);
  const notables = [...new Set(f.teams.map((t) => t.n).filter(Boolean) as string[])]
    .map((s) => notable(s)!)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || NOTABLE.indexOf(a) - NOTABLE.indexOf(b));
  const pager = pagerFor(TRAINER_GAMES, (x) => x.key === g.key, (x) => ({ href: `/pokedex/trainers/${x.key}`, label: gameName(names, x) }));
  let idx = 0;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav href="/pokedex/trainers" label={t("allTrainers")} pager={pager} />
      <DetailHero kicker={t("game.kicker", { gen: names.locale === "ja" ? String(g.gen) : ROMAN[g.gen], regions: g.regions.map(names.region).join(names.locale === "ja" ? "・" : " & ") })} title={t("game.title", { game })}>
        <p className="max-w-2xl text-foreground/90">{t("game.intro")}</p>
      </DetailHero>

      {notables.length > 0 && (
        <Section id="notable" index={++idx} title={t("list.notable")} subtitle={t("game.notableAside", { n: notables.length, game })}>
          <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]" data-hscroll data-testid="trainers-game-notables">
            {notables.map((n) => (
              <li key={n.slug} className="shrink-0">
                <Link href={`/pokedex/trainers/notable/${n.slug}#game-${g.key}`} className="flex w-24 flex-col items-center gap-1.5 rounded-lg border bg-card p-2 text-center transition-colors hover:border-screen/60">
                  <TrainerAvatar name={n.name} type={n.type} size="sm" />
                  <span className="line-clamp-2 w-full font-display text-xs font-bold uppercase leading-tight tracking-wide">{n.name}</span>
                  <span className="text-[10px] leading-tight text-muted-foreground">{roleName(t, n.role)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {regions.map((r) => (
        <Section key={r.region} id={`region-${r.region.toLowerCase().replace(/[^a-z]+/g, "-")}`} index={++idx} title={names.region(r.region)}>
          <div className="space-y-6">
            {r.groups.map((gr) => (
              <div key={gr.kind} className="space-y-2">
                <h3 className="hud-label">{kindName(t, gr.kind)}</h3>
                <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" data-testid="trainers-areas">
                  {gr.areas.map((a) => (
                    <li key={a.slug}>
                      <Link href={`/pokedex/trainers/${g.key}/${a.slug}`} data-testid="trainers-area-link" className="group flex h-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2.5 transition-colors hover:border-screen/60">
                        <span className="min-w-0">
                          <span className="block truncate font-display text-sm font-bold uppercase tracking-wide group-hover:text-screen">{names.place(a.name)}</span>
                          <span className="block text-[11px] text-muted-foreground">{t("game.trainers", { n: a.count })}</span>
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
        {t.rich(g.repo === "Bulbapedia" ? "game.importedWiki" : "game.importedPret", {
          repo: g.repo,
          link: (chunks) => (
            <a href={sourceUrl(g)} className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
              {chunks}
            </a>
          ),
        })}
      </p>
    </article>
  );
}

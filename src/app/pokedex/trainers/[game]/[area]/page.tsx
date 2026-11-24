import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { BookOpen, MapPin } from "lucide-react";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { DetailHero, DetailNav } from "@/components/pokedex/detail/DetailParts";
import { pagerFor, trainerAreaOrder } from "@/lib/dex/neighbours";
import { HudHeading } from "@/components/game/HudHeading";
import { TrainerCard } from "@/components/trainers/TeamView";
import { TRAINER_GAMES, trainerGame } from "@/lib/trainers/games";
import { areaTeams, gameAreas, gameFile, placeFor } from "@/lib/trainers/data";
import { gameName } from "@/lib/trainers/explorer-local";
import { dexNames } from "@/lib/dex/local-names";
import { serverT } from "@/i18n/server";
import trainersNs from "@/messages/trainers";

export const dynamicParams = false;

export function generateStaticParams() {
  return TRAINER_GAMES.flatMap((g) => {
    const f = gameFile(g.key)!;
    const used = new Set(f.teams.flatMap((t) => t.at.map((s) => s.a)));
    return f.areas.filter((_, i) => used.has(i)).map((a) => ({ game: g.key, area: a.slug }));
  });
}

interface PageProps {
  params: Promise<{ game: string; area: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { game, area } = await params;
  const g = trainerGame(game);
  const data = g ? areaTeams(g.key, area) : null;
  if (!g || !data) return {};
  const n = data.sections.reduce((k, s) => k + s.trainers.length, 0);
  const t = serverT(trainersNs);
  const names = dexNames();
  const place = names.place(data.area.name);
  const title = gameName(names, g);
  return pageMetadata({
    title: t("meta.areaTitle", { area: place, game: title }),
    description: t("meta.areaDescription", { n, area: place, game: title }),
    path: `/pokedex/trainers/${g.key}/${area}`,
    image: SHARE_IMAGES.pokedex,
    socialTitle: t("meta.areaSocial", { area: place, game: title }),
  });
}

export default async function TrainerAreaPage({ params }: PageProps) {
  const { game, area } = await params;
  const g = trainerGame(game);
  const data = g ? areaTeams(g.key, area) : null;
  if (!g || !data) notFound();
  const place = placeFor(data.area);
  const t = serverT(trainersNs);
  const names = dexNames();
  const title = gameName(names, g);
  const areaName = names.place(data.area.name);
  const count = data.sections.reduce((k, s) => k + s.trainers.length, 0);
  const others = TRAINER_GAMES.filter((o) => o.key !== g.key && gameFile(o.key)!.areas.some((a) => a.slug === area && a.region === data.area.region));
  const pager = pagerFor(trainerAreaOrder(gameAreas(g.key)), (a) => a.slug === data.area.slug, (a) => ({ href: `/pokedex/trainers/${g.key}/${a.slug}`, label: names.place(a.name) }));
  const multi = data.sections.length > 1 || data.sections[0]?.name;

  return (
    <article className="mx-auto max-w-6xl space-y-10">
      <DetailNav href={`/pokedex/trainers/${g.key}`} label={t("area.back", { game: title })} pager={pager} home={{ href: "/pokedex/trainers", label: t("allTrainers") }} />
      <DetailHero kicker={t("area.kicker", { game: title, region: names.region(data.area.region) })} title={areaName}>
        <div className="space-y-3">
          <p className="text-foreground/90">{multi ? t("area.countAcross", { n: count, k: data.sections.length }) : t("area.count", { n: count })}</p>
          <div className="flex flex-wrap gap-2">
            {place && (
              <Link
                href={`/pokedex/places/${place.slug}`}
                data-testid="trainers-place-link"
                className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden /> {t("area.place")}
              </Link>
            )}
            {place?.atlas && (
              <Link
                href={`/atlas?q=${encodeURIComponent(`${place.name} · ${data.area.region === "Sevii Islands" ? "Sevii Islands" : data.area.region}`)}`}
                className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden /> {t("area.atlas")}
              </Link>
            )}
          </div>
          {others.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("area.alsoIn")}{" "}
              {others.map((o, i) => (
                <span key={o.key}>
                  {i > 0 && ", "}
                  <Link href={`/pokedex/trainers/${o.key}/${area}`} className="font-semibold text-foreground hover:text-screen">
                    {gameName(names, o)}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
      </DetailHero>

      {data.sections.map((s, si) => (
        <section key={s.name ?? "_"} className="space-y-3" aria-label={s.name ?? areaName} data-testid="trainers-section">
          {multi && <HudHeading as="h2" index={si + 1} title={s.name ?? areaName} aside={t("game.trainers", { n: s.trainers.length })} />}
          <div className="space-y-3">
            {s.trainers.map((t) => (
              <TrainerCard key={t.key} group={t} game={g.key} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, MapPin } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { BackButton } from "@/components/ui/BackButton";
import { DetailHero } from "@/components/pokedex/detail/DetailParts";
import { HudHeading } from "@/components/game/HudHeading";
import { TrainerCard } from "@/components/trainers/TeamView";
import { TRAINER_GAMES, trainerGame } from "@/lib/trainers/games";
import { areaTeams, gameFile, placeFor } from "@/lib/trainers/data";

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
  return pageMetadata({
    title: `${data.area.name} Trainers — Pokémon ${g.name}`,
    description: `All ${n} trainer${n === 1 ? "" : "s"} on ${data.area.name} in Pokémon ${g.name}, with their Pokémon, levels, moves, held items and rematch teams.`,
    path: `/pokedex/trainers/${g.key}/${area}`,
    socialTitle: `${data.area.name} · ${g.name} trainers`,
  });
}

export default async function TrainerAreaPage({ params }: PageProps) {
  const { game, area } = await params;
  const g = trainerGame(game);
  const data = g ? areaTeams(g.key, area) : null;
  if (!g || !data) notFound();
  const place = placeFor(data.area);
  const count = data.sections.reduce((k, s) => k + s.trainers.length, 0);
  const others = TRAINER_GAMES.filter((o) => o.key !== g.key && gameFile(o.key)!.areas.some((a) => a.slug === area && a.region === data.area.region));
  const multi = data.sections.length > 1 || data.sections[0]?.name;

  return (
    <article className="mx-auto max-w-6xl space-y-8">
      <nav className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <BackButton href={`/pokedex/trainers/${g.key}`} label={`${g.name} trainers`} />
        <Link href="/pokedex/trainers" className="hover:text-foreground">
          All trainers
        </Link>
      </nav>
      <DetailHero kicker={`Pokémon ${g.name} · ${data.area.region}`} title={data.area.name}>
        <div className="space-y-3">
          <p className="text-foreground/90">
            {count} trainer{count === 1 ? "" : "s"}
            {multi ? ` across ${data.sections.length} area${data.sections.length === 1 ? "" : "s"}` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            {place && (
              <Link
                href={`/pokedex/places/${place.slug}`}
                data-testid="trainers-place-link"
                className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden /> Place &amp; wild Pokémon
              </Link>
            )}
            {place?.atlas && (
              <Link
                href={`/atlas?q=${encodeURIComponent(`${place.name} · ${data.area.region === "Sevii Islands" ? "Sevii Islands" : data.area.region}`)}`}
                className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 px-3 py-1.5 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden /> World Atlas
              </Link>
            )}
          </div>
          {others.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Also in{" "}
              {others.map((o, i) => (
                <span key={o.key}>
                  {i > 0 && ", "}
                  <Link href={`/pokedex/trainers/${o.key}/${area}`} className="font-semibold text-foreground hover:text-screen">
                    {o.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
      </DetailHero>

      {data.sections.map((s, si) => (
        <section key={s.name ?? "_"} className="space-y-3" aria-label={s.name ?? data.area.name} data-testid="trainers-section">
          {multi && <HudHeading as="h2" index={si + 1} title={s.name ?? data.area.name} aside={`${s.trainers.length} trainer${s.trainers.length === 1 ? "" : "s"}`} />}
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

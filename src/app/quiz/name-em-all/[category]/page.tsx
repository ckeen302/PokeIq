import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { GameInfo } from "@/components/seo/GameInfo";
import { NameEmAll } from "@/components/name-em-all/NameEmAll";
import { pageMetadata, jsonLd } from "@/lib/seo";
import { NEA_CATEGORIES, NEA_PATH, NEA_TITLE, neaCategory, neaHref, standardMinutes } from "@/lib/name-em-all/categories";
import { neaOutsiders, neaTargets } from "@/lib/name-em-all/targets";

/**
 * One page per Name 'em All category, statically generated with its own
 * title, description and JSON-LD, and only its own slots in the payload.
 */

interface PageProps {
  params: Promise<{ category: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return NEA_CATEGORIES.map((c) => ({ category: c.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const cat = neaCategory((await params).category);
  if (!cat) return {};
  return pageMetadata({ title: cat.title, description: cat.description, path: neaHref(cat.id) });
}

export default async function NameEmAllCategoryPage({ params }: PageProps) {
  const cat = neaCategory((await params).category);
  const targets = cat && neaTargets(cat.id);
  if (!cat || !targets) notFound();
  const minutes = standardMinutes(targets.length);
  const siblings = NEA_CATEGORIES.filter((c) => c.group === cat.group && c.id !== cat.id);

  return (
    <div className="space-y-6">
      <BackButton href={NEA_PATH} label="All categories" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({ "@context": "https://schema.org", "@type": "Quiz", name: cat.title, description: cat.description, about: { "@type": "Thing", name: "Pokémon" }, isAccessibleForFree: true }),
        }}
      />
      <header className="mx-auto max-w-3xl space-y-2 text-center">
        <p className="hud-label text-screen">{NEA_TITLE}</p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{cat.h1}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {targets.length.toLocaleString("en-US")} Pokémon · standard time {minutes}:00. {cat.description}
        </p>
      </header>

      <NameEmAll category={{ id: cat.id, label: cat.label }} targets={targets} outsiders={neaOutsiders(cat.id)} />

      <section className="mx-auto max-w-3xl space-y-3 pt-4 text-sm text-muted-foreground">
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">How it works</h2>
        <p>
          Type a name and it fills its slot the moment it&apos;s spelled right: no Enter key. Capitals, accents, spaces and punctuation don&apos;t matter, so
          “mr mime” counts for Mr. Mime and “nidoran f” for Nidoran♀. <b className="text-foreground">Regular</b> takes them in any order,{" "}
          <b className="text-foreground">Chaos</b> points at one at random and <b className="text-foreground">Dex order</b> goes one after another.
        </p>
        <p>
          Stuck? Turn on the silhouette or spelling hints, or give up to see every one you missed, each linked to its Pokédex page. Ranked runs (Regular, no
          hints, no pausing) go on two boards: the fastest full clear, and the most named inside the standard time.
        </p>
        {siblings.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="font-semibold text-foreground">More:</span>
            {siblings.map((c) => (
              <Link key={c.id} href={neaHref(c.id)} className="underline-offset-2 hover:text-foreground hover:underline">
                {c.label}
              </Link>
            ))}
            <Link href={NEA_PATH} className="underline-offset-2 hover:text-foreground hover:underline">
              All categories
            </Link>
          </p>
        )}
      </section>
      <GameInfo
        hidden
        path={neaHref(cat.id)}
        name={cat.h1}
        description={cat.description}
        intro={`${cat.h1}: a free recall quiz. ${cat.description}`}
        steps={["Pick a mode, a timer and any hints.", "Type names: each one fills its slot as soon as it's spelled right.", "Name them all before time runs out, or give up to see the ones you missed."]}
        faqs={[
          { q: "Do I need to spell names exactly?", a: "Capitals, accents, spaces and punctuation don't matter. Turn on the spelling helper to get a suggestion when you're one or two letters off." },
          { q: "How do the leaderboards work?", a: `Regular runs without hints or pauses are ranked by the fastest full clear and by the most named inside the standard ${minutes} minutes.` },
        ]}
      />
    </div>
  );
}

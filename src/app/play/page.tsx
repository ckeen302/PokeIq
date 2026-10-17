import Link from "next/link";
import type { Metadata } from "next";
import { ModeGrid } from "@/components/home/ModeGrid";
import { FORMAT_INFO, PLAYABLE_FORMATS, QUIZ_PRESETS } from "@/lib/modes";

export const metadata: Metadata = {
  title: "All Pokémon Quiz Modes",
  description: "Who's That Pokémon, cry quiz, Pokédex entries, type matchups, higher or lower — in Classic, Survival and Blitz formats.",
};

export default function PlayPage() {
  const genPresets = QUIZ_PRESETS.filter((p) => p.gens);
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Game modes</h1>
        <p className="text-muted-foreground">Pick a mode, then choose a format, difficulty and generations.</p>
      </div>
      <ModeGrid />
      <section className="grid gap-4 sm:grid-cols-3">
        {PLAYABLE_FORMATS.map((f) => (
          <div key={f} className="rounded-md border bg-card p-5">
            <h2 className="font-semibold">{FORMAT_INFO[f].title}</h2>
            <p className="text-sm text-muted-foreground">{FORMAT_INFO[f].description}</p>
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Quiz by generation</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {genPresets.map((p) => (
            <Link key={p.slug} href={`/quiz/${p.slug}`} className="rounded-lg border bg-card p-4 text-sm font-medium transition hover:border-primary/50">
              {p.h1}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

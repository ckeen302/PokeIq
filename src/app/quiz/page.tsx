import Link from "@/components/ui/Link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Swords } from "lucide-react";
import { ModeGrid } from "@/components/home/ModeGrid";
import { QuizDuelCard } from "@/components/quiz/QuizDuelCard";
import { GameInfo } from "@/components/seo/GameInfo";

export const metadata: Metadata = pageMetadata({
  title: "Who's That Pokémon Quiz and More Pokémon Quiz Modes",
  description: "Play the Who's That Pokémon quiz, a cry quiz, Pokédex entries, type matchups, higher or lower — in Classic, Survival and Blitz formats.",
  path: "/quiz",
});

/** Daily, the PokéIQ test and the Atlas left the top bar; they live here too. */
const MORE = [
  { href: "/daily", label: "Daily Challenge" },
  { href: "/iq-test", label: "PokéIQ Test" },
];

export default function PlayPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Quizzes</h1>
      </div>
      <ModeGrid />
      <nav aria-label="More to play" className="flex flex-wrap justify-center gap-3">
        {MORE.map(({ href, label }) => (
          <Link key={href} href={href} className="rounded-md border bg-card px-4 py-2 text-sm font-semibold transition hover:border-primary/50">
            {label}
          </Link>
        ))}
      </nav>
      <section className="space-y-3" aria-labelledby="duels">
        <h2 id="duels" className="flex items-center gap-2 text-xl font-bold">
          <Swords className="h-5 w-5 text-primary" aria-hidden /> Quiz duel
        </h2>
        <p className="text-sm text-muted-foreground">Answer the same questions as a friend, live.</p>
        <QuizDuelCard />
      </section>
      <GameInfo
        hidden
        path="/quiz"
        name={`the Pokémon quizzes`}
        description={`Free Pokémon quizzes including the Who's That Pokémon quiz, a cry quiz and type matchups, in Classic, Survival and Blitz formats.`}
        intro={`Play the Who's That Pokémon quiz and our other Pokémon quizzes in three formats, covering all 1,025 Pokémon.`}
        steps={[
          "Pick a quiz mode and the generations to include.",
          "Choose a format: Classic, Survival or Blitz.",
          "Answer before the clock runs out.",
          "Your PokéIQ weighs each right answer by how tricky that question is.",
        ]}
        faqs={[
          { q: `What formats are there?`, a: `Classic is 10 questions with 15 seconds each, Survival is endless with 3 lives and Blitz gives you 60 seconds to answer as many as you can.` },
          { q: `Can I choose which generations to play?`, a: `Yes, pick a mode, then choose the generations to include.` },
        ]}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { CompareView } from "@/components/which-pokemon/CompareView";
import { pageMetadata } from "@/lib/seo";
import { QUIZ_PATH } from "@/lib/which-pokemon/match";

/**
 * /quiz/which-pokemon/compare: two results side by side with a
 * compatibility score. Both results travel in the fragment, so the page is
 * static, personal, and needs no account; it is kept out of search.
 */

export const metadata: Metadata = pageMetadata({
  title: "Compare: Which Pokémon Are You?",
  description: "Two trainers' Pokémon personality results side by side, with a compatibility score. Take the quiz and compare with a friend.",
  socialTitle: "Which Pokémon are you? Compare with me",
  noindex: true,
});

export default function ComparePage() {
  return (
    <div className="space-y-8">
      <BackButton href={QUIZ_PATH} label="Which Pokémon Are You?" />
      <header className="mx-auto max-w-2xl space-y-2 text-center">
        <p className="hud-label text-screen">Compare with a friend</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Two trainers, two Pokémon</h1>
      </header>
      <CompareView />
    </div>
  );
}

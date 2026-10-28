/* eslint-disable @next/next/no-img-element -- artwork comes pre-sized from /api/art */
import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";
import { artUrl } from "@/lib/pokemon/art";
import { QUIZ_PATH } from "@/lib/which-pokemon/match";

/** Sample results on the card, left to right. */
const FACES = [25, 94, 143, 448, 700, 1000];

/** The "Which Pokémon Are You?" entry on the play hub and the home page's quiz list. */
export function WhichPokemonCard() {
  return (
    <Link
      href={QUIZ_PATH}
      className="menu-item group relative flex items-center gap-4 overflow-hidden rounded-lg border bg-card p-4 hover:border-screen/50 hover:bg-accent/40"
      aria-label="Play Which Pokémon Are You?"
      data-testid="play-which-pokemon"
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-[hsl(290_80%_62%)]" aria-hidden />
      <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-[hsl(290_80%_70%)]">
        <Sparkles className="relative z-[3] h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="hud-label text-screen">New</span>
          <span className="truncate font-display text-lg font-bold uppercase tracking-wide">Which Pokémon Are You?</span>
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">
          A personality quiz with a real trait model: 18 questions, 200 possible Pokémon, a share card and a compare-with-a-friend link.
        </span>
      </span>
      <span className="hidden shrink-0 items-center sm:flex" aria-hidden>
        {FACES.map((id, i) => (
          <img key={id} src={artUrl(id, 96)} alt="" width={40} height={40} loading="lazy" className="h-10 w-10 object-contain" style={{ marginLeft: i ? -8 : 0 }} />
        ))}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" aria-hidden />
    </Link>
  );
}

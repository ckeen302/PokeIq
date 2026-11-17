import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Credits",
  description: "The data, engine, music and textures PokéIQ is built on, and their licences.",
  alternates: { canonical: "/credits" },
};

const LINK = "underline underline-offset-2 hover:text-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-bold uppercase tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/** Everything the site is built on and the licences that ask for a notice: moved here from the footer. */
export default function CreditsPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <BackButton href="/" />
      <header className="space-y-2">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Credits</h1>
        <p className="text-sm text-muted-foreground">
          PokéIQ is a free, non-commercial fan project and is not affiliated with, endorsed or sponsored by Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon and all related names are trademarks of their respective owners.
        </p>
      </header>
      <Section title="Pokémon data">
        <p>Data from PokéAPI.</p>
      </Section>
      <Section title="Battles">
        <p>
          Battles run on Pokémon Showdown&apos;s simulator, and its battle timer and replay format are adapted from Pokémon Showdown (MIT licence, © Guangcong Luo and contributors).
        </p>
      </Section>
      <Section title="Battle music">
        <p>
          Original chiptune by Ted Kerr, celestialghost8 and congusbongus via OpenGameArt.org, under CC0 (
          <a href="/audio/battle/CREDITS.md" className={LINK}>
            credits
          </a>
          ).
        </p>
      </Section>
      <Section title="Sizes">
        <p>
          Music by cynicmusic and city textures from Poly Haven, both CC0 (
          <a href="/sizes/CREDITS.md" className={LINK}>
            credits
          </a>
          ).
        </p>
      </Section>
      <Section title="Race">
        <p>
          Stadium textures from Poly Haven and crowd sounds from OpenGameArt.org, all CC0 (
          <a href="/race/CREDITS.md" className={LINK}>
            credits
          </a>
          ).
        </p>
      </Section>
      <Section title="The two films">
        <p>
          The scores are original, written for PokéIQ and played with the MuseScore General sound font (MIT; strings from VSCO 2 CE, CC0). Credits:{" "}
          <a href="/audio/world-history/CREDITS.md" className={LINK}>
            History of the Pokémon World
          </a>
          ,{" "}
          <a href="/audio/pokemon-story/CREDITS.md" className={LINK}>
            Story of Pokémon
          </a>
          .
        </p>
      </Section>
    </article>
  );
}

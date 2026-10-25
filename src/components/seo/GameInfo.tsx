import Link from "next/link";
import { HowToButton } from "./HowToButton";
import { SITE_URL } from "@/lib/site";
import { jsonLd } from "@/lib/seo";

/** Static SEO copy under a game: intro, how to play, FAQ (collapsed), more-games links and JSON-LD. */

export interface Faq {
  q: string;
  a: string;
}

const GAMES = [
  { href: "/pokedle", label: "Pokédle" },
  { href: "/guessr", label: "PokéGuessr" },
  { href: "/connections", label: "Connections" },
  { href: "/pikadoku", label: "Pikadoku" },
  { href: "/play", label: "Pokémon quizzes" },
  { href: "/battle", label: "Battles" },
  { href: "/daily", label: "Daily Challenge" },
  { href: "/pokedex", label: "Pokédex" },
];

export function MoreGames({ current }: { current?: string }) {
  return (
    <nav aria-label="More games" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      <span className="font-semibold text-foreground">More games:</span>
      {GAMES.filter((g) => g.href !== current).map((g) => (
        <Link key={g.href} href={g.href} className="underline-offset-2 hover:text-foreground hover:underline">
          {g.label}
        </Link>
      ))}
    </nav>
  );
}

interface Props {
  /** Path of this page, excluded from the link row. */
  path: string;
  name: string;
  /** Opening sentence: names the game by its search term. */
  intro: string;
  steps: string[];
  faqs: Faq[];
  /** Short description for the structured data. */
  description: string;
  /** Show a button that opens the game's live how-to pop-up instead of the steps as text. */
  howToButton?: boolean;
}

export function GameInfo({ path, name, intro, steps, faqs, description, howToButton }: Props) {
  const app = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name,
    url: `${SITE_URL}${path}`,
    description,
    applicationCategory: "GameApplication",
    operatingSystem: "Any (web browser)",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <section className="mx-auto max-w-3xl space-y-6" aria-label={`About ${name}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(app) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faq) }} />
      <div className="space-y-3 text-sm text-muted-foreground">
        <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">How to play {name}</h2>
        <p>{intro}</p>
        {howToButton ? (
          <HowToButton name={name} />
        ) : (
          <ol className="list-decimal space-y-1 pl-5">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-base font-bold uppercase tracking-wider">FAQ</h2>
        {faqs.map((f) => (
          <details key={f.q} className="group rounded-lg border bg-card px-4 py-3 text-sm">
            <summary className="cursor-pointer font-semibold">{f.q}</summary>
            <p className="mt-2 text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
      <MoreGames current={path} />
    </section>
  );
}

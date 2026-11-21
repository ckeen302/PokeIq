import { HowToButton } from "./HowToButton";
import { webGame } from "@/lib/structured-data";
import { jsonLd } from "@/lib/seo";

/** Static SEO copy under a game: intro, how to play, FAQ (collapsed) and JSON-LD. */

export interface Faq {
  q: string;
  a: string;
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
  /** Self-explanatory pages: keep the search data, show nothing. */
  hidden?: boolean;
  /** Leave the FAQ out (the list and its structured data): the game explains itself. */
  noFaq?: boolean;
}

export function GameInfo({ path, name, intro, steps, faqs, description, howToButton, hidden, noFaq }: Props) {
  const app = webGame({ name, path, description });
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  if (hidden) return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(app) }} />;
  return (
    <section className="mx-auto max-w-3xl space-y-6" aria-label={`About ${name}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(app) }} />
      {!noFaq && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faq) }} />}
      {/* With the button (the rules are in its pop-up) it's the button alone; otherwise a heading, the intro and the steps. */}
      {howToButton ? (
        <div className="flex justify-center">
          <HowToButton name={name} />
        </div>
      ) : (
        <div className="space-y-3 text-sm text-muted-foreground">
          <h2 className="font-display text-base font-bold uppercase tracking-wider text-foreground">How to play {name}</h2>
          <p className="max-md:hidden">{intro}</p>
          <ol className="list-decimal space-y-1 pl-5">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {!noFaq && (
        <div className="space-y-2">
          <h2 className="font-display text-base font-bold uppercase tracking-wider">FAQ</h2>
          {faqs.map((f) => (
            <details key={f.q} className="group rounded-lg border bg-card px-4 py-3 text-sm">
              <summary className="tap cursor-pointer font-semibold">{f.q}</summary>
              <p className="mt-2 text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

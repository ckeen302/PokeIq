import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { languageAlternates } from "@/i18n/metadata";
import { serverT } from "@/i18n/server";
import credits from "@/messages/credits";
import site from "@/messages/site";

export function generateMetadata(): Metadata {
  const t = serverT(credits);
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/credits", languages: languageAlternates("/credits") },
  };
}

const LINK = "underline underline-offset-2 hover:text-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-bold uppercase tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/** A link to a credits file (the files themselves are English). */
const file = (href: string) =>
  function CreditsLink(c: React.ReactNode) {
    return (
      <a href={href} className={LINK}>
        {c}
      </a>
    );
  };

/** Everything the site is built on and the licences that ask for a notice: moved here from the footer. */
export default function CreditsPage() {
  const t = serverT(credits);
  const s = serverT(site);
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <BackButton href="/" />
      <header className="space-y-2">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {s("footer.disclaimer")}
        </p>
      </header>
      <Section title={t("data")}>
        <p>{t("dataBody")}</p>
      </Section>
      <Section title={t("shinyMaker")}>
        <p>
          {t.rich("shinyMakerBody", { a: file("/shiny-maker/CREDITS.md") })}
        </p>
      </Section>
      <Section title={t("battles")}>
        <p>
          {t("battlesBody")}
        </p>
      </Section>
      <Section title={t("music")}>
        <p>
          {t.rich("musicBody", { a: file("/audio/battle/CREDITS.md") })}
        </p>
      </Section>
      <Section title={t("sizes")}>
        <p>
          {t.rich("sizesBody", { a: file("/sizes/CREDITS.md") })}
        </p>
      </Section>
      <Section title={t("race")}>
        <p>
          {t.rich("raceBody", { a: file("/race/CREDITS.md") })}
        </p>
      </Section>
      <Section title={t("guessr")}>
        <p>
          {t.rich("guessrBody", { a: file("/audio/guessr/CREDITS.md") })}
        </p>
      </Section>
      <Section title={t("films")}>
        <p>
          {t.rich("filmsBody", { world: file("/audio/world-history/CREDITS.md"), story: file("/audio/pokemon-story/CREDITS.md") })}
        </p>
      </Section>
    </article>
  );
}

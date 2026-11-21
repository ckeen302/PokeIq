import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { languageAlternates } from "@/i18n/metadata";
import Link from "@/components/ui/Link";
import { serverT } from "@/i18n/server";
import privacy from "@/messages/privacy";

export function generateMetadata(): Metadata {
  const t = serverT(privacy);
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/privacy", languages: languageAlternates("/privacy") },
  };
}

const CONTACT = "pokeiq.official@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-bold uppercase tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

const b = (c: React.ReactNode) => <strong className="text-foreground">{c}</strong>;

const card = (href: string) =>
  function TrainerCardLink(c: React.ReactNode) {
    return (
      <Link href={href} className="text-foreground underline underline-offset-2">
        {c}
      </Link>
    );
  };

export default function PrivacyPage() {
  const t = serverT(privacy);
  return (
    <article className="mx-auto max-w-2xl space-y-8">
    <BackButton href="/" />
      <header className="space-y-2">
        <p className="hud-label max-md:hidden text-screen">{t("short")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("intro")}
        </p>
      </header>

      <Section title={t("collect.title")}>
        <ul className="list-disc space-y-1 pl-5">
          {(["name", "password", "email", "results", "chat", "avatars", "reports"] as const).map((k) => (
            <li key={k}>{t.rich(`collect.${k}`, { b })}</li>
          ))}
        </ul>
        <p>
          {t("collect.noAccount")}
        </p>
      </Section>

      <Section title={t("why.title")}>
        <p>
          {t("why.body")}
        </p>
      </Section>

      <Section title={t("share.title")}>
        <p>
          {t.rich("share.body", { b })}
        </p>
      </Section>

      <Section title={t("emails.title")}>
        <p>
          {t.rich("emails.body", { card: card("/trainer#settings") })}
        </p>
      </Section>

      <Section title={t("age.title")}>
        <p>
          {t.rich("age.body", { b })}
        </p>
      </Section>

      <Section title={t("delete.title")}>
        <p>
          {t.rich("delete.body", {
            mail: () => (
              <a href={`mailto:${CONTACT}`} className="text-foreground underline underline-offset-2">
                {CONTACT}
              </a>
            ),
            card: card("/trainer"),
          })}
        </p>
      </Section>

      <Section title={t("about.title")}>
        <p>
          {t("about.body")}
        </p>
      </Section>
    </article>
  );
}

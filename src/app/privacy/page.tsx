import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What PokéIQ collects, why, and how to have it deleted. In plain English.",
  alternates: { canonical: "/privacy" },
};

const CONTACT = "pokeiq.official@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-bold uppercase tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2">
        <p className="hud-label text-screen">The short version</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Privacy policy</h1>
        <p className="text-sm text-muted-foreground">
          PokéIQ is a free, non-commercial fan project. We collect as little as we can, use it only to run the game,
          and never sell it.
        </p>
      </header>

      <Section title="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-foreground">Your trainer name</strong> — shown publicly on leaderboards, friends lists and in
            matches.
          </li>
          <li>
            <strong className="text-foreground">Your password</strong> — stored only as a salted hash, never in readable form. If you
            sign in with Discord or Google, we don&apos;t have a password for you at all.
          </li>
          <li>
            <strong className="text-foreground">Your email, only if you use Discord or Google</strong> — the verified address that
            service gives us. It is private: never shown to other players.
          </li>
          <li>
            <strong className="text-foreground">Game results and progress</strong> — scores, XP, badges, streaks, ratings and battle
            records.
          </li>
          <li>
            <strong className="text-foreground">Chat messages</strong> — match chat disappears after the match ends.
          </li>
          <li>
            <strong className="text-foreground">Avatars you upload</strong> — shown on your profile.
          </li>
          <li>
            <strong className="text-foreground">Reports</strong> — when you report a player or a problem, we keep the report so a
            moderator can look at it.
          </li>
        </ul>
        <p>
          You can play without an account: your progress then stays on your device. We count visits with Vercel&apos;s
          cookie-free analytics, which doesn&apos;t identify you. No advertising, no tracking cookies.
        </p>
      </Section>

      <Section title="Why">
        <p>
          To run your account and keep your progress on every device, to show leaderboards, friends and matches, to keep
          the game fair and safe (moderation, bans, stopping cheating), and to fix problems.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>
          We do <strong className="text-foreground">not</strong> sell your data or share it for advertising. It is stored with the
          services that run the site (Supabase for the database and sign-in, Vercel for hosting). Discord and Google only
          tell us who you are when you choose to sign in with them.
        </p>
      </Section>

      <Section title="Age">
        <p>
          You must be <strong className="text-foreground">13 or older</strong> to make an account. If you believe a child under 13
          has made one, contact us and we&apos;ll delete it.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          Email{" "}
          <a href={`mailto:${CONTACT}`} className="text-foreground underline underline-offset-2">
            {CONTACT}
          </a>{" "}
          from any address, with your trainer name, and ask for your account to be deleted. We&apos;ll remove your account and
          everything tied to it. You can also unlink Discord or Google at any time from your{" "}
          <Link href="/trainer" className="text-foreground underline underline-offset-2">
            trainer card
          </Link>
          .
        </p>
      </Section>

      <Section title="About PokéIQ">
        <p>
          PokéIQ is a free fan project made for fun. It earns no money and is not affiliated with Nintendo, Game Freak,
          Creatures or The Pokémon Company. If this policy changes, we&apos;ll update this page.
        </p>
      </Section>
    </article>
  );
}

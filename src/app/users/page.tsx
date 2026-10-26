import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { UserSearch } from "@/components/community/UserSearch";

export const metadata: Metadata = pageMetadata({
  title: "Find a trainer",
  description: "Look up a PokéIQ trainer by name: their level, Pokédle and battle ratings, records and recent replays.",
  path: "/users",
});

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
    <BackButton href="/" />
      <div className="space-y-2">
        <p className="hud-label text-screen">Community</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Find a <span className="text-primary [text-shadow:0_0_30px_hsl(var(--primary)/0.45)]">trainer</span>
        </h1>
        <p className="text-muted-foreground">Search by account name to see a trainer&apos;s profile: level, ratings, records and recent replays. Add them as a friend from there.</p>
      </div>
      <UserSearch initial={typeof q === "string" ? q.slice(0, 20) : ""} />
    </div>
  );
}

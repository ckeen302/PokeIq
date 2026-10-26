import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { TournamentRoom } from "@/components/tournaments/TournamentRoom";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return pageMetadata({ title: "Tournament", description: "A Pokémon battle tournament on PokéIQ: the live bracket, matches and results.", path: `/battle/tournaments/${id}`, noindex: true });
}

export default async function TournamentPage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[a-z0-9-]{8,24}$/.test(id)) notFound();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
    <BackButton href="/battle/tournaments" label="Back to tournaments" />
      <nav aria-label="Breadcrumb" className="hud-label flex items-center gap-1.5">
        <Link href="/battle" className="text-screen hover:text-foreground">
          Battle
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <Link href="/battle/tournaments" className="text-screen hover:text-foreground">
          Tournaments
        </Link>
      </nav>
      <TournamentRoom id={id} />
    </div>
  );
}

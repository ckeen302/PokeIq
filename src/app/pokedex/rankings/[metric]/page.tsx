import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { ALL, METRICS, getMetric, rankingDescription, rankingImagePath, rankingPath, rankingTitle } from "@/lib/dex/rankings";
import { RankingView } from "@/components/pokedex/rankings/RankingView";

/** /pokedex/rankings/<list>: every Pokémon (default forms) in one static, crawlable table. */

export const dynamicParams = false;

export function generateStaticParams() {
  return METRICS.map((m) => ({ metric: m.slug }));
}

interface PageProps {
  params: Promise<{ metric: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const m = getMetric((await params).metric);
  if (!m) return {};
  return pageMetadata({
    title: rankingTitle(m, ALL),
    description: rankingDescription(m, ALL),
    path: rankingPath(m.slug),
    image: { url: rankingImagePath(m.slug), alt: rankingTitle(m, ALL) },
  });
}

export default async function RankingPage({ params }: PageProps) {
  const m = getMetric((await params).metric);
  if (!m) notFound();
  return <RankingView m={m} s={ALL} />;
}

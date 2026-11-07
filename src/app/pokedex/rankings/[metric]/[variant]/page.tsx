import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { METRICS, getMetric, isBuiltPage, parseScope, rankingDescription, rankingPath, rankingTitle, scopeSegment, variantScopes } from "@/lib/dex/rankings";
import { RankingView } from "@/components/pokedex/rankings/RankingView";

/**
 * /pokedex/rankings/<list>/<fire | gen-1 | all-forms>: one type, one
 * generation, or every form. Only the combinations with enough Pokémon are
 * built; anything else is a 404.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return METRICS.flatMap((m) => variantScopes(m).map((s) => ({ metric: m.slug, variant: scopeSegment(s)! })));
}

interface PageProps {
  params: Promise<{ metric: string; variant: string }>;
}

async function resolve(params: PageProps["params"]) {
  const { metric, variant } = await params;
  const m = getMetric(metric);
  const s = parseScope(variant);
  if (!m || !s || !isBuiltPage(m.slug, s)) return null;
  return { m, s };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const r = await resolve(params);
  if (!r) return {};
  return pageMetadata({
    title: rankingTitle(r.m, r.s),
    description: rankingDescription(r.m, r.s),
    path: rankingPath(r.m.slug, r.s),
    image: SHARE_IMAGES.pokedex,
  });
}

export default async function RankingVariantPage({ params }: PageProps) {
  const r = await resolve(params);
  if (!r) notFound();
  return <RankingView m={r.m} s={r.s} />;
}

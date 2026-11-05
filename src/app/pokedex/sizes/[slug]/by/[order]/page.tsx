import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseOrderSegment } from "@/lib/sizes/order";
import { SizesPage } from "@/components/sizes/SizesPage";
import { resolveSlug, slugMetadata } from "@/components/sizes/routes";

/**
 * /pokedex/sizes/<preset or pokemon>?by=speed&dir=desc: that page in another
 * order (next.config rewrites the query here). Rendered on first request
 * and cached from then on.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

const orderOf = (seg: string) => parseOrderSegment(seg);

export async function generateMetadata({ params }: { params: Promise<{ slug: string; order: string }> }): Promise<Metadata> {
  const { slug, order: seg } = await params;
  const order = orderOf(seg);
  return order ? slugMetadata(slug, order) : {};
}

export default async function Page({ params }: { params: Promise<{ slug: string; order: string }> }) {
  const { slug, order: seg } = await params;
  const order = orderOf(seg);
  const { preset, item } = resolveSlug(slug);
  if (!order || (!preset && !item)) notFound();
  if (preset) return <SizesPage preset={preset} order={order} />;
  return <SizesPage focus={item} order={order} />;
}

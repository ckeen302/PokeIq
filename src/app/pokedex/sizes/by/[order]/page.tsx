import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseOrderSegment } from "@/lib/sizes/order";
import { SizesPage } from "@/components/sizes/SizesPage";
import { mainMetadata } from "@/components/sizes/routes";

/**
 * /pokedex/sizes?by=speed&dir=desc: the full line in another order
 * (next.config rewrites the query here, so each order is a page of its own,
 * rendered once and cached). Height, smallest first, is /pokedex/sizes.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

const orderOf = (seg: string) => parseOrderSegment(seg);

export async function generateMetadata({ params }: { params: Promise<{ order: string }> }): Promise<Metadata> {
  const order = orderOf((await params).order);
  return order ? mainMetadata(order) : {};
}

export default async function Page({ params }: { params: Promise<{ order: string }> }) {
  const order = orderOf((await params).order);
  if (!order) notFound();
  return <SizesPage order={order} />;
}

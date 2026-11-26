import type { Metadata } from "next";
import { ShinyCounterView, one, shinyCounterMetadata, type Query } from "../view";

/**
 * A shared hunt: /tools/shiny-hunt-counter?d=… is rewritten here (next.config), so the counter's own page stays static
 * while a link renders with its hunt and its own preview card. The address people see keeps ?d=.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  return shinyCounterMetadata(one((await searchParams).d));
}

export default async function SharedPage({ searchParams }: { searchParams: Promise<Query> }) {
  return <ShinyCounterView raw={one((await searchParams).d)} />;
}

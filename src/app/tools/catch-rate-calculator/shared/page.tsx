import type { Metadata } from "next";
import { CatchRateView, catchRateMetadata, type Query } from "../view";

/**
 * A shared encounter: /tools/catch-rate-calculator?p=… is rewritten here (next.config), so the calculator's own page
 * stays static while a link renders with its inputs and its own preview card. The address people see keeps the query.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  return catchRateMetadata(await searchParams);
}

export default async function SharedPage({ searchParams }: { searchParams: Promise<Query> }) {
  return <CatchRateView query={await searchParams} />;
}

import { ALL, METRICS, getMetric } from "@/lib/dex/rankings";
import { restRowsResponse } from "@/components/pokedex/rankings/rows-html";

/** /pokedex/rankings/<list>/rows: the list's rows after those in its page, for the table to append. Built once, static. */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return METRICS.map((m) => ({ metric: m.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ metric: string }> }) {
  const m = getMetric((await params).metric);
  if (!m) return new Response(null, { status: 404 });
  return restRowsResponse(m, ALL);
}

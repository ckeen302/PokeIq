import { METRICS, getMetric, isBuiltPage, parseScope, scopeSegment, variantScopes } from "@/lib/dex/rankings";
import { restRowsResponse } from "@/components/pokedex/rankings/rows-html";

/** /pokedex/rankings/<list>/<variant>/rows: a variant's rows after those in its page, for the table to append. Built once, static. */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return METRICS.flatMap((m) => variantScopes(m).map((s) => ({ metric: m.slug, variant: scopeSegment(s)! })));
}

export async function GET(_req: Request, { params }: { params: Promise<{ metric: string; variant: string }> }) {
  const { metric, variant } = await params;
  const m = getMetric(metric);
  const s = parseScope(variant);
  if (!m || !s || !isBuiltPage(m.slug, s)) return new Response(null, { status: 404 });
  return restRowsResponse(m, s);
}

import { POKEDEX } from "@/lib/pokemon/pokedex";

/** The species a generation introduced ({id, slug, name}), for the timeline's sprite strip. Built once, served static. */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [...new Set(POKEDEX.map((p) => p.gen))].map((g) => ({ gen: String(g) }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ gen: string }> }) {
  const gen = Number((await params).gen);
  const list = POKEDEX.filter((p) => p.gen === gen).map((p) => ({ id: p.id, slug: p.slug, name: p.name }));
  return Response.json(list, { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
}

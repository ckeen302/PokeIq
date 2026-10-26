import { searchRows } from "@/lib/trainers/data";

// Built once at build time: the Trainers search loads it only when someone searches or filters.
export const dynamic = "force-static";

export function GET() {
  return Response.json(searchRows(), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}

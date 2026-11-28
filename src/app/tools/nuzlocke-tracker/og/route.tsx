import { nuzToolCard } from "@/lib/og/nuzlocke";

/** GET /tools/nuzlocke-tracker/og: the Nuzlocke Tracker's own preview card. */
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  return nuzToolCard();
}

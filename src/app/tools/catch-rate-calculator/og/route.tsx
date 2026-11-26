import type { NextRequest } from "next/server";
import { catchRateCard } from "@/lib/og/catch-rate";
import { decodeInputs, hasInputs } from "@/lib/catch-rate/link";

/** GET /tools/catch-rate-calculator/og?p=…: a shared encounter's preview card (the calculator's own card without one). */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return catchRateCard(hasInputs(q) ? decodeInputs(q) : null);
}

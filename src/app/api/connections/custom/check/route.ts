import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { analyzeCustom, validateCustom } from "@/lib/server/connections-custom";
import { NO_STORE, inputSchema } from "@/lib/server/connections-custom-http";
import type { CustomCheckResponse } from "@/lib/connections/custom";

/**
 * POST /api/connections/custom/check { title?, groups }
 *
 * The creator's live check, nothing stored: `errors` block publishing (counts,
 * duplicates, names, colours) and `warnings` are Pokémon that fit another
 * group's link too, found with the same categories the daily puzzles use.
 * Warnings only come once the puzzle has no errors.
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-custom-check:${clientIp(request)}`, 40, 1)) return tooManyRequests();
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const groups = parsed.data.groups as never as Parameters<typeof analyzeCustom>[0];
  const errors = validateCustom({ title: parsed.data.title, groups });
  const body: CustomCheckResponse = { errors, warnings: errors.length ? [] : analyzeCustom(groups) };
  return NextResponse.json(body, { headers: NO_STORE });
}

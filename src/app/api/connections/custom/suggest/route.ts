import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { findLinks, overlapWarnings, suggestGroup } from "@/lib/server/connections-suggest";
import { NO_STORE } from "@/lib/server/connections-custom-http";
import { CONN_GROUPS, CONN_GROUP_SIZE } from "@/lib/connections/types";
import { FACTS } from "@/lib/connections/facts";

/**
 * POST /api/connections/custom/suggest — the creator's helpers (nothing stored):
 *   { action: "links", q }                               the computed links matching the text
 *   { action: "suggest", link, groups, group, seed? }    up to four Pokémon for a group, not clashing with the others
 *   { action: "overlap", groups }                        live warnings for groups still being filled
 * `groups` is every group's { name, members } so far.
 */

const KNOWN = new Set(FACTS.map((f) => f.id));
const member = z.number().int().positive().refine((id) => KNOWN.has(id), "Unknown Pokémon.");
const groupsSchema = z
  .array(z.object({ name: z.string().max(40), members: z.array(member).max(CONN_GROUP_SIZE) }))
  .max(CONN_GROUPS);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("links"), q: z.string().max(40) }),
  z.object({ action: z.literal("suggest"), link: z.string().max(64), groups: groupsSchema, group: z.number().int().min(0).max(CONN_GROUPS - 1), seed: z.number().int().min(0).max(1000).optional() }),
  z.object({ action: z.literal("overlap"), groups: groupsSchema }),
]);

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-custom-suggest:${clientIp(request)}`, 60, 2)) return tooManyRequests();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;
  if (body.action === "links") return NextResponse.json({ links: findLinks(body.q) }, { headers: NO_STORE });
  if (body.action === "overlap") return NextResponse.json({ warnings: overlapWarnings(body.groups) }, { headers: NO_STORE });
  const own = body.groups[body.group]?.members ?? [];
  const others = body.groups.filter((_, i) => i !== body.group).map((g) => g.members);
  const out = suggestGroup(body.link, own, others, body.seed ?? 0);
  if (!out) return NextResponse.json({ error: "Unknown link." }, { status: 400, headers: NO_STORE });
  return NextResponse.json(out, { headers: NO_STORE });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema } from "@/lib/server/duel-core";
import { userFromRequest } from "@/lib/server/auth";
import { battlesEnabled } from "@/lib/server/battle-engine/store";
import { nextRunBattle, runResult, startFactoryRun, startTowerRun, swapRun } from "@/lib/server/battle-engine/frontier";
import { BATTLE_TEAM_MAX } from "@/lib/battle/play";
import { frontierBests } from "@/lib/server/frontier-store";
import { DUEL_CODE_RE } from "@/lib/duel-types";

/**
 * POST /api/battle/frontier: Battle Factory and Battle Tower runs.
 *   { action: "start", mode: "factory", style, name }  a new run and its rental team
 *   { action: "start", mode: "tower", name, team }     a new Tower run with your team (Showdown export), checked for Flat Rules
 *   { action: "next", run }                            the run's next battle: { code, token, href }
 *   { action: "result", code, token }                  after that battle: { won, run, best }
 *   { action: "swap", run, give, take }                the Factory's trade after a win (give -1: keep your team)
 *   { action: "bests" }                                a signed-in trainer's best streaks
 * `run` is the signed run token from the last answer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const run = z.string().min(10).max(16_000);

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    mode: z.enum(["factory", "tower"]),
    style: z.enum(["open", "bss"]).default("open"),
    name: duelNameSchema,
    team: z.string().max(BATTLE_TEAM_MAX).optional(),
  }),
  z.object({ action: z.literal("next"), run }),
  z.object({ action: z.literal("result"), code: z.string().regex(DUEL_CODE_RE), token: z.string().max(2000) }),
  z.object({ action: z.literal("swap"), run, give: z.number().int().min(-1).max(5), take: z.number().int().min(0).max(5) }),
  z.object({ action: z.literal("bests") }),
]);

export async function POST(request: NextRequest) {
  if (!rateLimit(`battle-frontier:${clientIp(request)}`, 30, 0.5)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429, headers: NO_STORE });
  }
  if (!battlesEnabled()) {
    return NextResponse.json({ error: "Battles aren't enabled on this server yet." }, { status: 503, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;
  try {
    const out = await act(body, request);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const { ok: _ok, ...rest } = out;
    void _ok;
    return NextResponse.json(rest, { headers: NO_STORE });
  } catch (err) {
    console.error("[battle-frontier]", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 503, headers: NO_STORE });
  }
}

async function act(body: z.infer<typeof bodySchema>, request: NextRequest) {
  switch (body.action) {
    case "start":
      if (body.mode === "tower") return startTowerRun(body.name, body.team ?? "");
      return startFactoryRun(body.name, body.style);
    case "next":
      return nextRunBattle(body.run);
    case "result": {
      const user = await userFromRequest(request).catch(() => null);
      return runResult(body.code, body.token, user?.id ?? null);
    }
    case "swap":
      return swapRun(body.run, body.give, body.take);
    case "bests": {
      const user = await userFromRequest(request).catch(() => null);
      return { ok: true as const, bests: user ? await frontierBests(user.id) : null };
    }
  }
}

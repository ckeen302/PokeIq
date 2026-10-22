import { NextRequest, NextResponse } from "next/server";
import { importShowdown } from "@/lib/battle/sets";
import { POKEPASTE_MAX_BYTES, POKEPASTE_TIMEOUT_MS, pokepasteId, pokepasteRawUrl } from "@/lib/battle/pokepaste";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";

/**
 * GET /api/battle/pokepaste?url=https://pokepast.es/<id> -> an imported team
 * ({ sets, name?, format?, dropped }). Only pokepast.es links are accepted,
 * and only https://pokepast.es/<id>/raw is ever fetched: no redirects, a
 * five-second timeout and a 32 KB cap. Parsed with the team builder's own
 * Showdown import.
 */

export const runtime = "nodejs";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

async function readCapped(res: Response, max: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-pokepaste:${clientIp(request)}`, 10, 0.2)) return tooManyRequests();
  const id = pokepasteId(request.nextUrl.searchParams.get("url") ?? "");
  if (!id) return fail("That isn't a pokepast.es link. Paste one like https://pokepast.es/1a2b3c4d5e6f7a8b.", 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POKEPASTE_TIMEOUT_MS);
  let text: string | null;
  try {
    const res = await fetch(pokepasteRawUrl(id), {
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store",
      headers: { accept: "text/plain" },
    });
    if (res.status === 404) return fail("No paste with that link.", 404);
    if (!res.ok) return fail("Pokepaste didn't answer properly. Try again in a moment.", 502);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > POKEPASTE_MAX_BYTES) return fail("That paste is too big to be a team.", 413);
    text = await readCapped(res, POKEPASTE_MAX_BYTES);
  } catch {
    return fail(controller.signal.aborted ? "Pokepaste took too long to answer." : "Couldn't reach Pokepaste.", 504);
  } finally {
    clearTimeout(timer);
  }
  if (text === null) return fail("That paste is too big to be a team.", 413);
  const team = importShowdown(text);
  if (!team) return fail("No Pokémon found in that paste.", 422);
  return NextResponse.json(team, { headers: { "Cache-Control": "private, max-age=300" } });
}

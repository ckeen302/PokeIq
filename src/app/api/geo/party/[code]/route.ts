import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { avatarUnlocks, seatAvatars } from "@/lib/server/avatars";
import { TAUNT_IDS, isTaunt, tauntBlocked, tauntFree, tauntOf } from "@/lib/trainer/taunts";
import { gate } from "@/lib/server/moderation";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { ALL_DUEL_EMOTES } from "@/lib/pvp-types";
import { duelNameSchema } from "@/lib/server/duel";
import { duelsEnabled } from "@/lib/server/duel-store";
import {
  aimParty,
  emoteParty,
  guessParty,
  isPartyMap,
  joinParty,
  kickPlayer,
  leaveParty,
  partyAgain,
  partyStore,
  partyToken,
  partyView,
  readPartyToken,
  setPartySettings,
  setTeam,
  skipPartyReveal,
  startParty,
  touchParty,
  type GeoParty,
  type PartyFailure,
  type PartyOutcome,
} from "@/lib/server/geo-party";
import { publishIfChanged } from "@/lib/server/geo-duel-live";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { realtimeClientConfig } from "@/lib/server/realtime";
import { PARTY_CODE_RE, PARTY_MAX_PLAYERS, parsePartySettings, type PartySeatResponse, type PartyView } from "@/lib/geo-party";

/**
 * GET  /api/geo/party/:code — the party as you may see it (header
 *      x-duel-token: your seat token; without one you're a visitor). Pages
 *      poll this, and it tells the server you're still here; a trainer whose
 *      seat the lobby dropped (a long reload) gets it back. `live` says where
 *      to subscribe for pushes (the duel's channel, by the party's code).
 * POST /api/geo/party/:code — an action:
 *   { action: "join", name }                    take a seat (returns your token)
 *   { action: "settings", token, ...settings }  host, lobby: mode, region, lives, roundSeconds, countdownSeconds, rounds
 *   { action: "team", token, team, seat? }      team duels, lobby: switch team (the host can move anyone)
 *   { action: "kick", token, seat }             host: remove a trainer (they can't come back)
 *   { action: "start", token }                  host: start the game
 *   { action: "guess", token, round, x, y }     lock in a pin
 *   { action: "aim", token, round, x, y }       team duels: where your pin sits, for your teammates
 *   { action: "next", token, round }            end the reveal early (once everyone still in presses it)
 *   { action: "leave", token }                  leave the room (mid-game: you're out)
 *   { action: "again", token }                  host, after the end: back to the lobby for another game
 *   { action: "emote", token, emote }           a preset reaction; a taunt after the end
 */

const NO_STORE = { "Cache-Control": "no-store" };
const token = z.string().min(10).max(512);
const round = z.number().int().min(0).max(40);
const seat = z.number().int().min(0).max(PARTY_MAX_PLAYERS - 1);
const pin = { x: z.number().min(0).max(1), y: z.number().min(0).max(1) };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), name: duelNameSchema }),
  z.object({
    action: z.literal("settings"),
    token,
    mode: z.enum(["royale", "team"]).optional(),
    region: z.string().max(20).optional(),
    lives: z.number().optional(),
    roundSeconds: z.number().optional(),
    countdownSeconds: z.number().optional(),
    rounds: z.number().optional(),
  }),
  z.object({ action: z.literal("team"), token, team: z.union([z.literal(0), z.literal(1)]), seat: seat.optional() }),
  z.object({ action: z.literal("kick"), token, seat }),
  z.object({ action: z.literal("start"), token }),
  z.object({ action: z.literal("guess"), token, round, ...pin }),
  z.object({ action: z.literal("aim"), token, round, ...pin }),
  z.object({ action: z.literal("next"), token, round }),
  z.object({ action: z.literal("leave"), token }),
  z.object({ action: z.literal("again"), token }),
  z.object({ action: z.literal("emote"), token, emote: z.enum([...ALL_DUEL_EMOTES, ...TAUNT_IDS]) }),
]);

type Context = { params: Promise<{ code: string }> };

const failure = (out: PartyFailure) => NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
const slow = () => NextResponse.json({ error: "Slow down, trainer." }, { status: 429, headers: NO_STORE });

async function viewOf(party: GeoParty, playerId: string | null, now: number, rev: number): Promise<PartyView> {
  return { ...(await seatAvatars(partyView(party, playerId, now, rev))), live: realtimeClientConfig() };
}

function storeError(err: unknown) {
  console.error("[geo-party]", err);
  return NextResponse.json({ error: "The party server hiccupped. Try again." }, { status: 503, headers: NO_STORE });
}

async function codeFrom(context: Context): Promise<string | null> {
  const { code } = await context.params;
  return PARTY_CODE_RE.test(code) ? code : null;
}

const missing: PartyFailure = { ok: false, status: 404, error: "This party has ended or never existed." };
const isParty = (p: GeoParty) => p?.kind === "geo-party";

export async function GET(request: NextRequest, context: Context) {
  const ip = clientIp(request);
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const seatOfToken = readPartyToken(request.headers.get("x-duel-token"), code);
  // A whole party can sit behind one address: a budget per seat, and a roomy one per address.
  if (!rateLimit(`geo-party:${ip}:${seatOfToken?.id ?? "-"}`, 30, 5) || !rateLimit(`geo-party-ip:${ip}`, 400, 40)) return slow();
  await syncHiddenShots();
  try {
    let before: GeoParty | undefined;
    let playerId: string | null = seatOfToken?.id ?? null;
    const out = await partyStore.update(code, (party, now) => {
      if (!isParty(party)) return missing;
      before = party;
      // Back after the lobby dropped the seat: take it again (if the room still has one).
      if (seatOfToken && party.status === "lobby" && !party.players.some((x) => x.id === seatOfToken.id)) {
        const back = joinParty(party, seatOfToken.name, now, seatOfToken.id);
        if (back.ok) return { ok: true as const, duel: back.party };
        playerId = null;
      }
      return { ok: true as const, duel: touchParty(party, playerId, now) };
    });
    if (!out.ok) return failure(out);
    publishIfChanged(code, before, out.duel, out.rev);
    const view = await viewOf(out.duel, playerId, out.now, out.rev);
    // The host removed this seat: the page says so rather than offering to join.
    if (seatOfToken && out.duel.banned.includes(seatOfToken.id)) view.removed = true;
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const ip = clientIp(request);
  if (!duelsEnabled()) return NextResponse.json({ error: "Parties aren't enabled on this server yet." }, { status: 503 });
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (!rateLimit(`geo-party-ip-act:${ip}`, 300, 30)) return slow();
  await syncHiddenShots();

  try {
    if (body.action === "join") {
      if (!rateLimit(`geo-party-join:${ip}`, 20, 0.5)) return slow();
      const blocked = await gate(request, "play");
      if (blocked) return blocked;
      let before: GeoParty | undefined;
      const out = await partyStore.update(code, (party, now) => {
        if (!isParty(party)) return missing;
        before = party;
        const joined = joinParty(party, body.name, now);
        return joined.ok ? { ok: true as const, duel: joined.party, playerId: joined.playerId } : joined;
      });
      if (!out.ok) return failure(out);
      publishIfChanged(code, before, out.duel, out.rev);
      const res: PartySeatResponse = { code, token: partyToken(code, out.playerId, body.name), view: await viewOf(out.duel, out.playerId, out.now, out.rev) };
      return NextResponse.json(res, { headers: NO_STORE });
    }

    const me = readPartyToken(body.token, code);
    if (!me) return NextResponse.json({ error: "That isn't your seat in this party." }, { status: 403 });
    const playerId = me.id;
    // Aiming sends a few a second while a teammate drags their pin; everything else is a button press.
    if (body.action === "aim" ? !rateLimit(`geo-party-aim:${ip}:${playerId}`, 8, 3) : !rateLimit(`geo-party-act:${ip}:${playerId}`, 30, 3)) return slow();
    if (body.action === "emote" && !rateLimit(`duel-emote:${ip}:${playerId}`, 6, 0.5)) {
      return NextResponse.json({ error: "Easy on the reactions." }, { status: 429, headers: NO_STORE });
    }
    // A taunt the trainer hasn't earned (guests: the free ones only).
    if (body.action === "emote" && isTaunt(body.emote) && !tauntFree(tauntOf(body.emote)!)) {
      const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
      const locked = tauntBlocked(body.emote, user ? await avatarUnlocks(user.id) : null);
      if (locked) return NextResponse.json({ error: locked }, { status: 403, headers: NO_STORE });
    }

    const act = (party: GeoParty, now: number): PartyOutcome => {
      switch (body.action) {
        case "settings": {
          const settings = parsePartySettings(body, party.settings);
          if (!settings) return { ok: false, status: 400, error: "Pick from the options shown." };
          if (!isPartyMap(settings.region)) return { ok: false, status: 400, error: "Unknown map." };
          return setPartySettings(party, playerId, settings, now);
        }
        case "team":
          return setTeam(party, playerId, body.seat, body.team, now);
        case "kick":
          return kickPlayer(party, playerId, body.seat, now);
        case "start":
          return startParty(party, playerId, now);
        case "guess":
          return guessParty(party, playerId, body.round, { x: body.x, y: body.y }, now);
        case "aim":
          return aimParty(party, playerId, body.round, { x: body.x, y: body.y }, now);
        case "next":
          return skipPartyReveal(party, playerId, body.round, now);
        case "leave":
          return leaveParty(party, playerId, now);
        case "again":
          return partyAgain(party, playerId, now);
        case "emote":
          return emoteParty(party, playerId, body.emote, now);
      }
    };
    let before: GeoParty | undefined;
    const out = await partyStore.update(code, (party, now) => {
      if (!isParty(party)) return missing;
      before = party;
      const acted = act(party, now);
      return acted.ok ? { ok: true as const, duel: acted.party } : acted;
    });
    if (!out.ok) return failure(out);
    publishIfChanged(code, before, out.duel, out.rev);
    return NextResponse.json(await viewOf(out.duel, playerId, out.now, out.rev), { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}

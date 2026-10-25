import { after, NextResponse } from "next/server";
import { verifyDiscordSignature } from "@/lib/discord/verify";
import { dailyEmbed, dexEmbed, errorEmbed, findPokemon, helpEmbed, pokemonChoices } from "@/lib/discord/commands";
import { createDuelEmbed, gameSchema, leaderboardEmbed } from "@/lib/discord/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Option {
  name: string;
  value?: string | number;
  focused?: boolean;
}
interface Interaction {
  type: number;
  application_id?: string;
  token?: string;
  member?: { nick?: string | null; user?: { username?: string; global_name?: string | null } };
  user?: { username?: string; global_name?: string | null };
  data?: { name?: string; options?: Option[] };
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const message = (...embeds: object[]) => json({ type: 4, data: { embeds } });

async function followUp(i: Interaction, embed: object) {
  if (!i.application_id || !i.token) return;
  await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  }).catch((err) => console.error("[discord] follow-up failed:", err));
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyDiscordSignature(raw, request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"), process.env.DISCORD_PUBLIC_KEY)) {
    return new NextResponse("invalid request signature", { status: 401 });
  }
  let i: Interaction;
  try {
    i = JSON.parse(raw) as Interaction;
  } catch {
    return json({ error: "bad body" }, 400);
  }
  if (i.type === 1) return json({ type: 1 });

  const opt = (name: string) => i.data?.options?.find((o) => o.name === name);

  if (i.type === 4) {
    const focused = i.data?.options?.find((o) => o.focused);
    return json({ type: 8, data: { choices: pokemonChoices(String(focused?.value ?? "")) } });
  }
  if (i.type !== 2) return json({ error: "unsupported" }, 400);

  switch (i.data?.name) {
    case "daily":
      return message(dailyEmbed());
    case "help":
      return message(helpEmbed());
    case "dex": {
      const p = findPokemon(String(opt("pokemon")?.value ?? ""));
      return message(p ? dexEmbed(p) : errorEmbed("No Pokémon found by that name."));
    }
    case "duel":
    case "leaderboard": {
      const game = gameSchema.safeParse(opt("game")?.value);
      if (!game.success) return message(errorEmbed("Pick a game."));
      const u = i.member?.user ?? i.user;
      const display = i.member?.nick || u?.global_name || u?.username || undefined;
      const isDuel = i.data?.name === "duel";
      // Both can touch the database: defer (type 5) and PATCH the reply when ready.
      after(async () => followUp(i, isDuel ? await createDuelEmbed(game.data, display) : await leaderboardEmbed(game.data)));
      return json({ type: 5 });
    }
    default:
      return message(errorEmbed("Unknown command."));
  }
}

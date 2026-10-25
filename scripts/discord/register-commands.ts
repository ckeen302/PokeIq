/**
 * Registers the PokéIQ slash commands (bulk overwrite, global).
 *   npx tsx --env-file=.env.local scripts/discord/register-commands.ts
 * Needs DISCORD_APP_ID and DISCORD_BOT_TOKEN. Prints counts only.
 */
const GAMES = ["pokedle", "connections", "pikadoku", "guessr", "quiz"].map((g) => ({ name: g, value: g }));
const game = { type: 3, name: "game", description: "Which game", required: true, choices: GAMES };

const commands = [
  { name: "daily", description: "Today's PokéIQ puzzles", type: 1 },
  { name: "dex", description: "Look up a Pokémon", type: 1, options: [{ type: 3, name: "pokemon", description: "Pokémon name", required: true, autocomplete: true }] },
  { name: "duel", description: "Open a casual duel and get the join link", type: 1, options: [game] },
  { name: "leaderboard", description: "Today's top 10", type: 1, options: [game] },
  { name: "help", description: "List the commands", type: 1 },
];

const app = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!app || !token) {
  console.error("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN.");
  process.exit(1);
}
const res = await fetch(`https://discord.com/api/v10/applications/${app}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
if (!res.ok) {
  console.error(`Registration failed: HTTP ${res.status}`);
  process.exit(1);
}
const out = (await res.json()) as unknown[];
console.log(`Registered ${out.length} of ${commands.length} commands.`);

export {};

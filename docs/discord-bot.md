# Discord bot

A serverless bot over Discord HTTP interactions (no gateway, no always-on process).

- `POST /api/discord`: verifies the Ed25519 signature, answers PING and the slash commands.
- `GET /api/cron/discord-daily`: Vercel Cron, 08:01 UTC daily, posts today's links to a webhook.
- Links use `SITE_URL` (`src/lib/site.ts`; set `NEXT_PUBLIC_SITE_URL` to switch domain).

## Setup

1. Create an application at https://discord.com/developers/applications and add a Bot.
2. Copy the Application ID, the Public Key (General Information) and the Bot token.
3. In Vercel, set these environment variables, then redeploy:
   - `DISCORD_APP_ID`
   - `DISCORD_PUBLIC_KEY`
   - `DISCORD_BOT_TOKEN` (only needed to register commands)
   - `DISCORD_DAILY_WEBHOOK_URL` (channel Settings, Integrations, Webhooks)
   - `CRON_SECRET` (any long random string; Vercel sends it as `Authorization: Bearer ...` to cron routes)
4. Set **Interactions Endpoint URL** to `https://<your-domain>/api/discord`. Discord sends a signed PING and saves only if the key is right.
5. Register the commands (put the variables in a local env file first):
   ```
   npx tsx --env-file=.env.local scripts/discord/register-commands.ts
   ```
6. Invite the bot with scopes `applications.commands` and `bot`.

Without `CRON_SECRET` or `DISCORD_DAILY_WEBHOOK_URL` the cron route returns `{"skipped":true}`.

## Commands

`/daily`, `/dex pokemon:`, `/duel game:`, `/leaderboard game:`, `/help`. `/duel` and `/leaderboard` defer (type 5) and edit the reply when done. Days are UTC.

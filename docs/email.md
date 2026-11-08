# Daily reminder emails

Signed-in players can opt in to an email each day when the new dailies drop. The code is deployed but **switched off**: it turns on only when the server has `RESEND_API_KEY` and `EMAIL_FROM`, plus the usual `POKEIQ_SECRET`, which signs the confirm and unsubscribe links. Until then:

- every email control is hidden (sign-up box, Settings toggle, end-of-game nudge);
- `/api/email/*` answers 404;
- the cron job (`/api/cron/daily-email`) does nothing.

## What players see

- **Sign-up:** this covers the trainer-name form and the "pick your trainer name" step after a first Discord or Google sign-in. Each shows an optional email field and an **unticked** "Email me when new dailies drop" box. After Discord or Google, the field is prefilled with that account's verified address.
- **Settings (`/trainer#settings`):**
  - "Daily reminder emails" On / Off, with an email field when none is on file (prefilled from Discord or Google);
  - "When to send": Every day, or only when a streak is at risk.
- **Double opt-in:** saving an address sends "Confirm your email". Nothing daily goes out until its link is opened.
- **End of a daily** (Pokédle, PokéGuessr daily, PokéConnections, Pikadoku, Daily Challenge): guests see "Sign up to get the daily in your inbox". Trainers who haven't turned the emails on see "Get the daily in your inbox". Trainers who get them see nothing.
- **The email:**
  - subject "Today's PokéIQ dailies are live";
  - today's PokéGuessr picture, blurred (no place name);
  - a button for each daily;
  - "Your N-day … streak ends at midnight" when a streak is at risk;
  - a footer saying why they got it, an unsubscribe link and the postal address;
  - `List-Unsubscribe` and `List-Unsubscribe-Post` headers, so mail apps show their own one-click unsubscribe.
- **Unsubscribe:** `/email/unsubscribe?token=…` turns the emails off and confirms it on the page.

## Owner setup

### 1. Apply the database migration
`supabase/migrations/0055_daily_email.sql` (table `email_subscriptions`). Until it's applied, Settings says emails aren't available yet and the cron finds nobody.

### 2. Create the Resend account
1. Sign up at https://resend.com (the free tier allows 3,000 emails a month and 100 a day; upgrade when the list outgrows it).
2. **Domains → Add domain →** `playpokeiq.com`. A subdomain such as `mail.playpokeiq.com` keeps the root domain's reputation separate, but the steps are the same.
3. Resend shows DNS records. Add each one at your DNS host exactly as shown:
   - **SPF:** an `MX` record and a `TXT` record (`v=spf1 include:amazonses.com ~all`) on the `send` subdomain Resend names;
   - **DKIM:** a `TXT` record at `resend._domainkey` holding a long public key.
4. Add **DMARC** yourself (Resend recommends it, and Gmail and Yahoo require it for bulk senders). Create a `TXT` record at `_dmarc.playpokeiq.com`:
   ```
   v=DMARC1; p=none; rua=mailto:cadenkeen@gmail.com
   ```
   Start with `p=none`. Once the reports show that only Resend sends as the domain, move to `p=quarantine`.
5. Click **Verify DNS records** and wait until the domain shows **Verified**. This can take minutes to hours.
6. **API Keys → Create API key**, with permission "Sending access" for that domain only. Copy it; it's shown once.

### 3. Set the variables in Vercel
Project → Settings → Environment Variables (Production):

| Variable | Value | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | the `re_…` key | Turns the feature on (with `EMAIL_FROM`). Secret. |
| `EMAIL_FROM` | `daily@playpokeiq.com` | Must be on the verified domain. Shown as "PokéIQ &lt;daily@playpokeiq.com&gt;". You can also write the whole `Name <address>` form. |
| `EMAIL_POSTAL_ADDRESS` | e.g. `PokéIQ, PO Box 123, City, ST 12345, USA` | **Required before sending in the US** (CAN-SPAM: a valid physical postal address, and a PO box or private mailbox is fine). If it's unset, the footer leaves the address out. |
| `CRON_SECRET` | a long random string (`openssl rand -hex 32`) | Vercel sends it to the cron as `Authorization: Bearer …`. The Discord daily post already uses it, so it may be set. |
| `EMAIL_SITE_URL` | optional, defaults to `https://playpokeiq.com` | Where the email's buttons, picture and links point. Set it if the site lives elsewhere. |
| `POKEIQ_ADMINS` | your trainer name | Already set for moderation. Needed for the test email. |

Never set `EMAIL_TEST_CAPTURE` in production. It writes mail to a file instead of sending it (for tests only).

### 4. Update the privacy policy
Before switching on, add the opt-in email to `/privacy` ("What we collect": your email if you turn on daily reminder emails; "Who we share it with": Resend sends the emails). This was left out of this change so the page's layout stays as it is until launch.

### 5. Redeploy
Deployments → … → **Redeploy** the latest production deployment. Environment variables only reach new deployments.

### 6. Send yourself a test
1. Sign in as an admin. On your trainer page, add your email under Settings → Daily reminder emails and confirm it from your inbox.
2. Open `/admin`. The **Daily email test** box appears once email is switched on. Leave the field empty to use your address on file, or type another, then click **Send test**. The test is today's real email, marked `[Test]`, and doesn't count as today's send.
3. Check that the email arrived:
   - it's in the inbox, not spam (Gmail: ⋮ → *Show original* should show SPF, DKIM and DMARC all `PASS`);
   - the picture loads;
   - the buttons open the site;
   - the unsubscribe link works.

## When it sends

`vercel.json` runs `/api/cron/daily-email` at `1 8 * * *` (08:01 UTC), the same time as the Discord daily post. That's midnight Pacific, when US players' new dailies unlock (the dailies roll over at each player's local midnight, and the server's daily date is UTC). Vercel Hobby runs cron jobs once a day and may start them any time within that hour.

Each run:
1. finds trainers who opted in, confirmed their address, and haven't been sent today's email (`last_sent_on`);
2. skips "streak at risk" trainers unless a daily streak finished yesterday hasn't been played today (the longest one is named in the email);
3. claims each batch (`last_sent_on = today`) before sending it through Resend's batch API (100 per call, `Idempotency-Key` per batch, a short pause between calls), so a re-run the same day never mails anyone twice;
4. on a Resend error, releases that batch and stops. The JSON response says how many were sent and why it stopped. Re-run it by hand from Vercel → Cron Jobs → **Run**.

## Testing locally

- Unit tests: `npx vitest run tests/daily-email.test.ts`.
- End to end: `node scripts/e2e-email.mjs http://localhost:3000` against `npm start`. It's also part of `scripts/e2e-smoke.mjs`. It checks the switched-off server, then starts a second server on the same build with email on in capture mode (`EMAIL_TEST_CAPTURE=<file>`). On that server it runs: sign up with an email → confirm → Settings toggles → cron → captured email → unsubscribe.
- To read mail locally, start the server with `RESEND_API_KEY=x EMAIL_FROM=daily@example.com EMAIL_TEST_CAPTURE=1 EMAIL_SITE_URL=http://localhost:3000`. Messages are written to `.data/email-capture.jsonl`.

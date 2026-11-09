# Moving PokéGuessr's screenshots to Cloudflare R2

PokéGuessr's ~5,200 screenshots (about 340 MB) live in the public Supabase
Storage bucket `geo`. Cloudflare R2 charges nothing for egress, so serving
them from R2 takes that traffic off both Supabase and Vercel.

The site already supports the move with two settings (`src/lib/geo-storage.ts`):

- `NEXT_PUBLIC_MEDIA_BASE` is the root that holds `geo/<id>.webp`. It defaults
  to Supabase's public root. Point it at R2 and every screenshot URL follows,
  under the same paths.
- `NEXT_PUBLIC_GEO_SHOTS_DIRECT=1` makes browsers load screenshots straight
  from the media store. Without it they load through `/api/geo/shot/<id>`, and
  that route strips the store's headers.

`scripts/r2-shots.ts` does the copy. Supabase is only read and is left exactly
as it is, so rolling back is just changing the settings back.

## Why upload times matter (read this first)

A round's screenshot must say nothing about where it was taken. Ids are
random, but a store's `Last-Modified` header carries each file's upload time.
On Supabase the screenshots went up one region at a time over 11 days, so that
time narrows down the region. That is why `GEO_SHOTS_DIRECT` is off today.
A check of 300 random shots confirms it: Alola, Kalos, Kitakami and Blueberry
Academy sit in the first quarter of the upload history (permutation test
p = 0.0005).

R2 also sends `Last-Modified` (the upload time) on public URLs. Two
protections, best first:

1. **Drop the header** with a Response Header Transform Rule on a custom
   domain (step 2d). Cloudflare's docs only stop rules from changing `cf-*` /
   `x-cf-*` headers and a few others such as `server`; `last-modified` isn't
   one of them. The Free plan allows 10 Transform Rules. This needs a custom
   domain: rules, caching and WAF don't run on the `r2.dev` URL, which
   Cloudflare also rate-limits and calls development-only.
2. **Make the times meaningless.** The script uploads every file in one fully
   shuffled order (random seed), as fast as it can. Measured here: Supabase
   serves about 17 files a second at 16 at a time, and an upload at 8 at a
   time with 150 ms per request runs at about 44 files a second. So a full
   upload takes about 2 minutes on a fast connection, and about 5 minutes on
   a 10 Mbit/s uplink (bandwidth-bound: 340 MB). Every second of that window
   holds roughly 20 to 40 files from all over the world map. Afterwards the
   script checks a random sample: the times must not correlate with the
   data's region-grouped order, and a permutation test must find no region
   bunched in one part of the run.

Do both if you can. With (1) the header is simply gone. Without a domain, (2)
alone is fine as long as the verification passes.

Keep the times meaningless later too. When new screenshots are added (they go
to Supabase through `scripts/geo/upload-additions.ts`), re-run the full script
**without** `--resume` before deploying the data that uses them. A fresh run
re-uploads everything in a new shuffled order, so the new shots don't stand
out as one late batch. Until they are on R2 they would 404 with the R2
setting on.

(Another option, if you have no domain: a Worker on `workers.dev` bound to the
bucket serves whatever headers you write, so no `Last-Modified` at all. But
the free plan caps Workers at 100,000 requests a day, so it's only worth it
for low traffic. The steps below don't use it.)

## 1. Create the bucket

1. Sign up or log in at https://dash.cloudflare.com.
2. In the left sidebar choose **R2 object storage**. The first time, R2 asks
   you to add a payment method. The free tier (10 GB stored, 1M uploads and
   10M reads a month, egress free) covers this, so nothing is charged.
3. Click **Create bucket**. Name it `pokeiq-media`, leave **Location** on
   Automatic and **Storage class** on Standard, then click **Create bucket**.
4. Note your **Account ID**. It's on the R2 overview page (right-hand
   panel, "Account details").

## 2. Give it a public URL

Pick **(a)** if you have a domain, **(b)** if you don't.

**(a) Custom domain (recommended).** The domain must be a zone in the same
Cloudflare account (**Add a domain** on the dashboard home, then follow the
nameserver steps). Then:

1. **R2 object storage → Overview →** `pokeiq-media` **→ Settings**.
2. Under **Custom Domains**, click **Add**. Enter e.g. `media.yourdomain.com`
   and click **Continue**.
3. Review the DNS record, then click **Connect Domain**.
4. Wait for the status to go from **Initializing** to **Active**. If it gets
   stuck, use the **…** menu and choose **Retry connection**.
5. Your public base is `https://media.yourdomain.com`.

**(b) r2.dev URL (no domain).** It's rate-limited, so use it only if traffic
stays small.

1. **R2 object storage →** `pokeiq-media` **→ Settings**.
2. Under **Public Development URL**, click **Enable**. Type `allow` and click
   **Allow**.
3. Check that **Public URL Access** says **Allowed**. Copy the URL shown, of
   the form `https://pub-<hash>.r2.dev`. That's your public base.

**(c) Remove Last-Modified (custom domain only).**

1. Open your domain (zone) in the dashboard. Go to **Rules → Overview** and
   click **Create rule**, then choose **Response Header Transform Rule**.
2. **Rule name**: `Shots: no upload time`.
3. **When incoming requests match**: choose **Custom filter expression**, then
   **Edit expression** and paste:
   `(http.host eq "media.yourdomain.com" and starts_with(http.request.uri.path, "/geo/"))`
4. Under **Modify response header**, choose **Remove**. **Header name**:
   `last-modified`.
5. Click **Deploy**.
6. Check it: `curl -sI https://media.yourdomain.com/geo/8EnZ4Lag0wIh.webp`
   should show no `last-modified` line. (The `etag` header is a hash of the
   file's bytes, so it reveals nothing and can stay.)

## 3. Make an API token

1. **R2 object storage → Overview**. Click **Manage API tokens** (in
   "Account details"), then **Create API token** (choose an **Account API
   token** if asked).
2. **Token name**: `pokeiq-shots-upload`.
3. **Permissions**: **Object Read & Write**.
4. **Specify bucket(s)**: **Apply to specific buckets only** →
   `pokeiq-media`.
5. **TTL**: e.g. 1 day (you can make a new one when adding shots later).
6. Click **Create API Token**. Copy the **Access Key ID** and **Secret Access
   Key** now, because the secret isn't shown again. You don't need the token
   value or the endpoint shown there (the script builds the endpoint from
   the Account ID).

## 4. Run the copy

From the repo root, in a terminal (don't save these anywhere in the repo):

```sh
export R2_ACCOUNT_ID=<account id>
export R2_ACCESS_KEY_ID=<access key id>
export R2_SECRET_ACCESS_KEY=<secret access key>
export R2_BUCKET=pokeiq-media
export R2_PUBLIC_BASE=https://media.yourdomain.com     # or https://pub-<hash>.r2.dev

npx tsx scripts/r2-shots.ts --dry-run --limit 20       # optional rehearsal: downloads 20, uploads nothing
npx tsx scripts/r2-shots.ts                            # downloads all, uploads all, verifies
```

- Downloads go to `.data/r2-shots/` (git-ignored, about 340 MB). They resume
  from where they stopped, and each one is checked against its byte count
  and Supabase's MD5 ETag.
- Each upload sets only `Content-Type: image/webp` and
  `Cache-Control: public, max-age=31536000, immutable`. No custom metadata
  and no file names. EXIF/XMP chunks would be dropped (the current shots
  have none).
- If the upload stops part-way, run `npx tsx scripts/r2-shots.ts --resume`. It
  keeps the same shuffled order and skips what's already up. If it was down
  for long (hours), prefer a fresh full run without `--resume`, so all files
  share one short window.
- The run ends with **Verified.** or **Verification FAILED.** and the reason.
  To re-check later: `npx tsx scripts/r2-shots.ts --verify-only`.
- Other options: `--concurrency N` (default 8; 16 suits a fast connection),
  `--sample N` (shots HEAD-checked, default 300), `--cache DIR`, `--seed N`.

Don't continue unless it says **Verified.**

## 5. Switch the site over in Vercel

1. https://vercel.com → the **pokeiq** project → **Settings → Environment
   Variables**.
2. Add `NEXT_PUBLIC_MEDIA_BASE` = your public base (e.g.
   `https://media.yourdomain.com`, no trailing slash, no `/geo`). Tick
   **Production** and **Preview**, then **Save**.
3. Add `NEXT_PUBLIC_GEO_SHOTS_DIRECT` = `1` the same way. Only do this if the
   verification passed. With the Transform Rule from 2(c) in place it's
   safest. Leave it unset to keep loading through `/api/geo/shot` (that still
   strips headers, but the bytes then pass through Vercel).

## 6. Redeploy

`NEXT_PUBLIC_*` values are built into the pages, so a new build is needed:
**Deployments** → the latest Production deployment → **…** → **Redeploy** →
**Redeploy**.

## 7. Check the screenshots load

1. Open https://pokeiq.vercel.app/guessr and start a game. The screenshot
   should appear as usual.
2. Right-click it → **Open image in new tab** (or DevTools → Network → Img).
   The URL should start with your public base and end `/geo/<id>.webp`.
3. `curl -sI <that URL>` should show `200`, `content-type: image/webp`,
   `cache-control: public, max-age=31536000, immutable` and, with 2(c), no
   `last-modified`.
4. Old links keep working: `https://pokeiq.vercel.app/api/geo/shot/<id>` now
   redirects (308) to the R2 file.
5. Also try a Daily, a party room, and a duel round, since they all use the
   same URLs.

## 8. Roll back

Supabase still has every file, untouched, so rolling back is instant and safe:

- **Fastest:** **Deployments** → the deployment from before the switch →
  **…** → **Instant Rollback** (labelled **Promote** on some accounts).
- **Or:** **Settings → Environment Variables**, delete
  `NEXT_PUBLIC_GEO_SHOTS_DIRECT` (back to the proxied route) and/or
  `NEXT_PUBLIC_MEDIA_BASE` (back to Supabase), then redeploy as in step 6.

Browsers may hold R2 URLs for a while (cached for a year), so leave the R2
bucket up for a few weeks after a rollback rather than deleting it.

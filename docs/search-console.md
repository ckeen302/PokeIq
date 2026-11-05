# Google Search Console

PokéIQ runs on `pokeiq.vercel.app`, a subdomain you can't add DNS records to, so
use a **URL-prefix** property and the **HTML tag** method. (On a custom domain
you can use a Domain property and a DNS TXT record instead; nothing in the code
is needed for that.)

## Verify the site

1. Open <https://search.google.com/search-console>, choose **Add property**,
   then **URL prefix**, and enter `https://pokeiq.vercel.app/` (or the
   `NEXT_PUBLIC_SITE_URL` you use).
2. Under **Other verification methods**, pick **HTML tag**. Google shows
   `<meta name="google-site-verification" content="abc123…" />`. Copy only the
   `content` value (`abc123…`).
3. In Vercel: **Project → Settings → Environment Variables**, add
   `GOOGLE_SITE_VERIFICATION` = that value, for **Production**.
4. Redeploy production (Deployments → latest → Redeploy). The tag goes into
   the pages when they're built, so a redeploy is needed.
5. Check it's live: `curl -s https://pokeiq.vercel.app/ | grep google-site-verification`.
6. Back in Search Console, press **Verify**. Keep the variable set: Google
   checks again from time to time.

## After verification

1. **Sitemaps → Add a new sitemap:** submit `sitemap.xml`. The TCG card
   sitemaps (`/pokedex/tcg/sitemap/<n>.xml`) are listed in `robots.txt`, which
   Google reads too; you can also submit them one by one.
2. **URL inspection:** inspect `/`, `/pokedle`, `/guessr` and one Pokémon
   page (for example `/pokemon/pikachu`), then press **Request indexing** for
   each.
3. **Settings → Crawl stats** and **Pages** (indexing report): look again
   after a week or two. Pages marked noindex on purpose (invites, results,
   profiles, account pages) appear under "Excluded by 'noindex' tag", which
   is expected.

Bing and the other IndexNow engines are separate: `npm run indexnow -- --submit`
(see `scripts/indexnow.mjs`).

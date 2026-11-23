# Traffic and the free plans

PokéIQ runs on Vercel's Hobby plan and Supabase's Free plan. Neither ever
charges. When a monthly allowance is used up, Vercel can pause the deployment
(visitors get a 503) for the rest of the 30 days, and Supabase can make the
database read-only or answer 402. Image Optimization is the exception: only
new pictures fail. So the question for a busy day is how much of the
**month's** allowance it uses, not how fast the site is.

## The allowances (checked 2026-11-23)

| Vercel Hobby, per month | | Source |
|---|---|---|
| Edge requests ("CDN requests": every file, page and API call that reaches Vercel) | 1,000,000 | [plans/hobby](https://vercel.com/docs/plans/hobby) |
| Function invocations | 1,000,000 | [plans/hobby](https://vercel.com/docs/plans/hobby) |
| Active CPU | 4 hours | [plans/hobby](https://vercel.com/docs/plans/hobby) |
| Fast data transfer | 100 GB | [plans/hobby](https://vercel.com/docs/plans/hobby) |
| Image transformations | 5,000 | [image-optimization/limits-and-pricing](https://vercel.com/docs/image-optimization/limits-and-pricing) |
| ISR writes / reads (8 KB units) | 200,000 / 1,000,000 | [pricing](https://vercel.com/pricing) |
| Max function duration | 300 s | [functions/limitations](https://vercel.com/docs/functions/limitations) |
| Cron jobs | once a day at most | [cron-jobs/usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |

| Supabase Free | | Source |
|---|---|---|
| Database size | 500 MB | [pricing](https://supabase.com/pricing) |
| Egress | 5 GB (+ 5 GB cached) a month | [manage-your-usage/egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress) |
| Compute | Nano: shared CPU, 0.5 GB RAM | [compute-and-disk](https://supabase.com/docs/guides/platform/compute-and-disk) |
| Connections | 60 direct, 200 through the pooler | [compute-and-disk](https://supabase.com/docs/guides/platform/compute-and-disk) |
| Realtime | 200 concurrent connections | [realtime/limits](https://supabase.com/docs/guides/realtime/limits) |
| Pausing | after 7 days of low activity | [free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing) |

The site talks to Supabase over its REST API (PostgREST pools the database
connections), so the 60-connection limit doesn't apply to page traffic.
Accounts are the site's own, not Supabase Auth, so Auth's monthly-user and
email limits don't apply either.

## Measuring

All of these run against a local production build, never the live site.

```sh
npm run build
node scripts/fake-supabase.mjs 54321 --rows 1000          # optional: counts database calls
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=local npm start -- -p 3100

# What one visitor costs, page by page: functions, CDN requests, image optimizations, bytes, database calls
node scripts/visitor-cost.mjs http://localhost:3100 --db http://127.0.0.1:54321

# A launch-day crowd playing the dailies; --pid adds the server's CPU per request
node scripts/load-test.mjs http://localhost:3100 --spike --players 200 --duration 60 --pid <next-server pid>
curl 127.0.0.1:54321/__counts                              # the database calls it made

# The database going down mid-run
curl -X POST '127.0.0.1:54321/__mode?m=down'               # m=quota answers 402, m=hang never answers, m=ok
```

## What keeps each path cheap

- **Pages**: the home page, the dailies and the Pokédex are static (CDN). The
  leaderboard pages are rebuilt at most once a minute, and a saved score
  clears them at most every 30 s per server instance.
- **Who's signed in**: a visitor who has never signed in doesn't call
  `/api/auth/me` on every page (src/lib/account-hint.ts).
- **Pictures**: the image optimizer takes only the Lab's screenshots and
  images imported in code (`images` in next.config.ts). Sprites and artwork
  are served as they are.
- **Shared reads**: leaderboards, PokéGuessr's daily stats and crowd map are
  read once for every server instance together (Next's data cache), not once
  per visitor.
- **The database down**: the dailies don't need it to play. A leaderboard page
  keeps its last good copy, and reads fail fast (src/lib/supabase.ts).

## Before a launch

- In Supabase's SQL editor, `select jobname, schedule from cron.job;` should
  list `pokeiq-prune-claims`. Every graded answer, guess and game start writes
  a row to `token_claims`, and the job deletes them after 6 hours. Without
  pg_cron (Database → Extensions) that table only grows, and it is the fastest
  way to fill the 500 MB.
- Supabase pauses a free project after 7 days of low activity. A site with
  visitors keeps it awake, but a quiet test project before launch can pause.

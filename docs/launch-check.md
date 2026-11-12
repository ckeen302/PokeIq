# Launch-day check

`scripts/launch-check.mjs` checks a deployment the way a new visitor meets it, on a phone (390 × 844) and a desktop (1440 × 900). It is read-only, so it is safe to run against production: the browser sends only GET, HEAD and CORS preflight requests. Every other request (a score, a sign-in, an analytics beacon) is stopped before it leaves. The dailies' boards get one input (a few letters typed, or a tile tapped and untapped), and nothing is ever submitted.

```sh
node scripts/launch-check.mjs https://pokeiq.vercel.app
```

What it checks, on every main route (home, the dailies, Guessr, Battle, the Pokédex, the Lab, the quizzes and the rest; the list is `ROUTES` at the top of the script):

- the page answers 200;
- no console errors or uncaught page errors;
- no failed requests to the site itself;
- no horizontal scroll at 390 px;
- the page's key element is visible: each daily's board renders and takes a first input (Pokédle's search opens, a Pikadoku square's search opens, a Connections tile selects, and Guessr's Daily is ready and its setup opens);
- the Largest Contentful Paint is under 4 s (`--lcp <ms>` changes it);
- the canonical URL is on the canonical host and names the page itself.

Then, once each:

- every share image (`og:image`, `twitter:image`) is on the canonical host, answers with an image, and is the size its tags say (1200 × 630);
- `robots.txt` names the sitemap;
- `sitemap.xml` lists URLs, all on the canonical host;
- the web manifest loads, and its icons are the sizes it says.

The script prints one line per check (`ok` or `FAIL` with the reason) and a count. It exits with 1 if any check fails.

## Options

- `--canonical <origin>`: the host that canonical tags, share images and the sitemap must use. It defaults to the base URL's own origin. A local build points them at `NEXT_PUBLIC_SITE_URL` (else https://pokeiq.vercel.app), so pass that origin there. Share images on that host are then fetched from the base URL.
- `--lcp <ms>`: the LCP limit (default 4000).
- `--only phone|desktop`: one profile only.
- `CHROMIUM_PATH=…`: use a preinstalled Chromium.

Against a local production build:

```sh
npm run build && npm start -- -p 3000
node scripts/launch-check.mjs http://localhost:3000 --canonical https://pokeiq.vercel.app
```

The check isn't part of CI. Run it by hand before a launch, and again after the deploy goes live.

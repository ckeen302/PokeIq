# Home hero clips

The title screen's slideshow plays a short clip of each tab being played on the
real site. These scripts record them from a local production build, frame by
frame, and encode them into `public/home/clips/`.

## Re-recording

```sh
export POKEIQ_SECRET=ci-only-secret-not-used-anywhere-else POKEIQ_LOCAL_ACCOUNTS=1 POKEIQ_TCG_FIXTURE=1
npm run build && npm start -- -p 3000 &
# every clip, desktop (16:9) and phone (4:5):
scripts/hero-videos/all.sh http://localhost:3000
# or one:
node scripts/hero-videos/record.mjs pokedle phone --base=http://localhost:3000
scripts/hero-videos/sheet.sh public/home/clips/pokedle-phone.mp4 /tmp/sheet.jpg   # a contact sheet to check it
```

The server must run with the same `POKEIQ_SECRET` as the scripts: the takes
work out each answer with the site's own code (`answers.ts`, `quiz-oracle.ts`,
`geo-oracle.ts`, `scripts/pikadoku-solve.ts`, the committed Connections
dailies), never by guessing. Frames go to `$HERO_OUT` (default
`/tmp/pokeiq-hero-frames`, about 0.5 GB a take); `all.sh` deletes each take's
frames once it's encoded.

## How it works

- `lib.mjs`: a headless Chromium at device scale 2 on a virtual clock
  (Playwright's clock for timers, rAF and `performance.now`; every CSS / Web
  Animation seeked by hand). Each frame is exactly 1/60 s of page time,
  however slow the machine, so there's no judder. Input is real (CDP mouse,
  touch, keyboard), with a drawn pointer on desktop and a tap ripple on phones.
  The site's nav, footer and tab bar are hidden. Network waits (a new question,
  a page) hold the clock, so loading never shows.
- `clips/<id>.mjs`: one per slide (`setup` and `run`): what's played, framed
  for the hero. `rec.mark("out")` ends the cut.
- `encode.mjs`: cuts the take (at most 9.6 s), crossfades its end into its
  start so it loops softly, and writes `<id>-<desktop|phone>.mp4` (H.264,
  1600×900 or 800×1000, no audio track, faststart, about 1–1.4 MB desktop,
  0.5–1 MB phone), `.av1.mp4` (AV1, about two thirds the size) and `.webp`
  (the first frame: the poster).

The 3D Lab take renders The Story of Pokémon in software WebGL: allow about
an hour. `HERO_LAB_T` (seconds into the film) and `HERO_LAB_SECONDS` pick the
moment.

# Speed sweep

Scripts that measure what a visitor feels on each major page of a running production build, so a speed change can
be measured before and after on the same machine.

```sh
POKEIQ_SECRET=ci-only-secret-not-used-anywhere-else POKEIQ_LOCAL_ACCOUNTS=1 POKEIQ_TCG_FIXTURE=1 npm run build
POKEIQ_SECRET=ci-only-secret-not-used-anywhere-else POKEIQ_LOCAL_ACCOUNTS=1 POKEIQ_TCG_FIXTURE=1 npm start

node scripts/perf-sweep/measure.mjs http://localhost:3000 --profile=phone --runs=3          # every route in routes.mjs
node scripts/perf-sweep/measure.mjs http://localhost:3000 --profile=desktop --only=home,pokedex
node scripts/perf-sweep/summary.mjs results/a.json results/b.json                          # one p75 table
node scripts/perf-sweep/summary.mjs --compare results/before.json results/after.json        # before → after
node scripts/perf-sweep/heavy.mjs http://localhost:3000 --minutes=5                         # memory and frame rate
node scripts/perf-sweep/profile.mjs /lab/pokedex --profile=phone                            # where a page's long tasks go
node scripts/perf-sweep/shifts.mjs http://localhost:3000/battle/teams                       # every layout shift, and what moved
```

- **Profiles** (measure.mjs): `desktop` is 1440 × 900 unthrottled; `phone` is 390 × 844 with touch, a 4× CPU
  slowdown and DevTools' Slow 4G (562.5 ms latency, 1.44 Mbps down). Each run is a cold browser context.
- **Per route**: TTFB, FCP, LCP and its element, CLS (largest session window) and what shifted, total blocking time,
  the longest task after the load event, interaction latency (Event Timing, the INP way) on a scroll and the route's
  main interaction (interactions.mjs), JS before and after load, router prefetches, image and font bytes, console
  errors and warnings, failed requests and uncacheable responses.
- **heavy.mjs** repeats each heavy page's own interaction plus a client-side trip away and back (which unmounts and
  remounts it), and records the JS heap after a forced garbage collection, DOM nodes, listeners and the frame rate.

Caveats of this machine: `next start` serves HTTP/1.1 from localhost (Vercel serves HTTP/2 and 3 from a CDN), so
first-load numbers are pessimistic about request contention and optimistic about TTFB; and headless Chromium draws
WebGL in software (SwiftShader), so the 3D pages' frame rates and their shader-compile and draw time are far worse
than on any GPU. Compare before and after on the same machine rather than reading these as field numbers.

Results of the sweeps behind each speed PR are in `results/`.

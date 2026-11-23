# 3D Lab audit

Every live 3D Lab experience, opened the way a phone and two desktops would, on a local production build of `main` (5faec10e), with `scripts/lab-audit.mjs`. The raw numbers are in `docs/lab-audit.json`.

- **Phone:** 390 × 844 at 3x, touch, Chromium's CPU slowdown at 4× and a Slow-4G-like network (150 ms round trip, 1.6 Mbps down, 750 kbps up).
- **Desktop:** 1440 × 900 at 1x and 1710 × 987 at 2x, no slowdown.
- Each page is opened cold, used for 20 seconds (drags, the mouse wheel, arrow keys, its first button), then used lightly every 30 seconds for 3 minutes (1 minute at 1710) while the JS heap is sampled.

**Read the frame rates and long tasks relatively.** This machine has no GPU: Chromium draws WebGL in software (SwiftShader), so every frame is far slower and every frame-heavy task far longer than on a real phone or laptop. A 1710 × 987 screen at 2x is the slowest of all here because it has the most pixels to draw in software. The numbers are good for comparing the experiences with each other and before/after a change, not for saying how fast a real device is.

## What the columns mean

- **First paint / Largest paint:** the browser's First Contentful Paint and Largest Contentful Paint.
- **Scene drawn:** when the stage first says its scene is drawn (its `data-ready` flag; the globe's `data-state="ready"`; Mass Battle's canvas). For Sizes this flag comes before the city is on screen: the first view shows about 4 seconds later on a phone.
- **Answers a tap:** scene drawn + how long the first tap or key press took to show its result (the Event Timing API). This stands in for time to interactive.
- **Frames/s in use:** frames per second while it was used for 20 seconds.
- **Long tasks:** main-thread tasks over 50 ms during those 20 seconds, and the longest.
- **JS heap:** at the scene's first frame → after 3 minutes (and the highest sample). Downloaded counts responses that state their size, so it's a floor.

## Results

| Experience | Screen | First paint | Largest paint | Scene drawn | Answers a tap | Frames/s in use | Long tasks in 20 s (longest) | JS heap over the run (MB) | Downloaded |
|---|---|---|---|---|---|---|---|---|---|
| Professor's Lab | Phone | 1.2 s | 1.2 s | 10.8 s | 12.2 s | 1.4 | 31 (0.9 s) | 20 → 19 (max 20) | 1.1 MB |
| Professor's Lab | 1440 | 0.2 s | 0.4 s | 11.4 s | 15.1 s | 0.3 | 7 (4.2 s) | 23 → 18 (max 23) | 0.7 MB |
| Professor's Lab | 1710 | 2.2 s | 2.2 s | 4.4 s | 13.6 s | 0.1 | 4 (9.1 s) | 17 → 17 (max 19) | 0.3 MB |
| The Story of Pokémon | Phone | 1.6 s | 9.2 s | 8.9 s | 9.8 s | 2.9 | 64 (0.6 s) | 20 → 18 (max 20) | 0.2 MB |
| The Story of Pokémon | 1440 | 0.3 s | 5.7 s | 7.3 s | 9.3 s | 0.5 | 16 (3.0 s) | 14 → 17 (max 17) | 0.2 MB |
| The Story of Pokémon | 1710 | 1.4 s | 9.5 s | 6.8 s | 10.9 s | 0.4 | 13 (4.3 s) | 14 → 16 (max 16) | 0.2 MB |
| Timeline | Phone | 3.7 s | 3.7 s | 8.5 s | 9.1 s | 4.1 | 87 (0.6 s) | 17 → 18 (max 18) | 0.7 MB |
| Timeline | 1440 | 0.2 s | 0.2 s | 1.6 s | 2.5 s | 3.1 | 65 (0.5 s) | 17 → 14 (max 17) | 1.1 MB |
| Timeline | 1710 | 0.2 s | 0.2 s | 1.4 s | 2.4 s | 1 | 22 (1.6 s) | 12 → 13 (max 13) | 0.7 MB |
| Pokémon Sizes | Phone | 1.5 s | 11.1 s | 7.1 s | 7.3 s | 0.5 | 37 (98.6 s) | 28 → 29 (max 29) | 5.8 MB |
| Pokémon Sizes | 1440 | 0.6 s | 4.4 s | 1.2 s | 5.6 s | 0.2 | 32 (4.3 s) | 100 → 28 (max 100) | 7.5 MB |
| Pokémon Sizes | 1710 | 2.5 s | 2.5 s | 3.0 s | 17.3 s | 0.1 | 32 (7.7 s) | 94 → 27 (max 94) | 7.0 MB |
| World Globe | Phone | 8.5 s | 9.8 s | 9.4 s | 9.5 s | 19.4 | 119 (0.2 s) | 13 → 11 (max 13) | 0.4 MB |
| World Globe | 1440 | 0.1 s | 1.3 s | 0.9 s | 1.2 s | 19.3 | 81 (0.2 s) | 11 → 9 (max 11) | 0.4 MB |
| World Globe | 1710 | 0.1 s | 1.8 s | 1.2 s | 1.9 s | 5 | 125 (0.5 s) | 11 → 10 (max 11) | 0.4 MB |
| Mass Battle | Phone | 1.4 s | 1.4 s | 4.1 s | 4.3 s | 8.1 | 150 (0.8 s) | 38 → 13 (max 38) | 0.2 MB |
| Mass Battle | 1440 | 0.2 s | 0.2 s | 0.7 s | 1.9 s | 1.5 | 59 (2.1 s) | 14 → 13 (max 14) | 0.2 MB |
| Mass Battle | 1710 | 0.2 s | 0.2 s | 0.8 s | 0.8 s | 1 | 35 (2.8 s) | 14 → 13 (max 14) | 0.2 MB |
| History of the Pokémon World | Phone | 1.5 s | 7.8 s | 7.6 s | 8.0 s | 6.8 | 142 (0.4 s) | 21 → 16 (max 21) | 0.7 MB |
| History of the Pokémon World | 1440 | 0.2 s | 4.1 s | 5.1 s | 6.9 s | 0.9 | 20 (1.8 s) | 12 → 14 (max 15) | 0.9 MB |
| History of the Pokémon World | 1710 | 0.9 s | 5.7 s | 7.6 s | 10.8 s | 0.5 | 12 (3.4 s) | 18 → 24 (max 24) | 0.9 MB |

**Memory:** no experience grows over the run. Every heap ends within a few MB of where it started, and DOM node counts stay flat. Sizes starts high on desktop (about 100 MB while the city is built) and drops to 28 MB once it's collected.

## By experience: what's broken, confusing or slow

**Professor's Lab** (/lab/pokedex)
- Slow to draw on a desktop with a weak GPU: the starting quality comes from screen size, cores and memory only, so a desktop without a real GPU (software rendering here) starts on the richest tier (2x pixels, shadows, the floor's reflection, depth of field) and the frame-time governor has to step it down. On this machine the desktop drew 0.3 frames a second against the phone's 1.4.
- On a phone the page paints at once but the room takes about 11 seconds behind a spinner over an empty box.
- No way to share the Pokémon on the table or make a video of it, though the address already opens on it (`?pick=25`).

**The Story of Pokémon** (/lab/pokemon-story)
- On a phone the largest paint is the title, 9 seconds in: nothing stands in for the film before its first frame.
- Otherwise steady: 2.9 frames/s on the phone (relatively good for a full post-processed scene), flat memory.

**Timeline** (/pokedex/timeline)
- On a phone the first paint is late (3.7 s) and the tunnel takes 8.5 s.
- A tap on an event opens a detail sheet that covers most of the tunnel on a phone (expected, but the tunnel is then mostly hidden).

**Pokémon Sizes** (/pokedex/sizes)
- The heaviest by far: 6–7.5 MB on first load (the city's textures and the figures), and on the phone one main-thread task blocked for 98 seconds while the city was built and its shaders compiled. Software rendering exaggerates this, but on a phone it's the experience most at risk of a stall.
- On a phone the largest paint is at 11 s: until then there's only a sky and a loading line.
- The 3D view names the Pokémon in focus but doesn't link to its Pokédex page.

**World Globe** (/pokeguessr/globe)
- The smoothest by a distance: about 19 frames/s on the phone and on a 1440 desktop even in software, 0.4 MB, flat memory.
- But on a phone nothing paints until 8.5 s: the globe is loaded client-side only, so the page's HTML is an empty dark box until the JavaScript arrives.
- Without WebGL it shows one line of text and nothing else, though the region cards are right there.
- No share link or video: a region's card can't be linked to.
- On a phone, region labels near each other (Galar, Kalos, Sinnoh) overlap when zoomed out.

**Mass Battle** (/lab/mass-battle)
- Best first paint on a phone (1.4 s) because it already has a poster: the still of the arena is the largest paint. 8 frames/s on the phone while armies fight.
- Its stage sits in the page with the setup panel below: scrolled down to the panel, the battle keeps drawing out of sight.
- "Deploying armies" waits on the network on a slow connection; it says what it's doing, so fine.

**The History of the Pokémon World** (/lab/world-history)
- Like the Story: the title is the largest paint at 7.8 s on a phone; nothing stands in before the first frame. Otherwise steady (6.8 frames/s on the phone).

## Across the Lab

- Only Mass Battle (and the switched-off Race and Games) show a still before the scene. Every other phone visit looks at a spinner or an empty stage for 7–11 seconds on a slow connection.
- Each experience picks its starting quality from its own rules (screen size, touch, `deviceMemory`). None looks at the GPU, and iPhones report no memory at all, so a weak device is only found once frames have been slow for a while.
- Sizes, Mass Battle, the Story and the History each have a share link and "Make a video". Professor's Lab and the World Globe have neither.
- Pokémon pages already link into the Professor's Lab ("View in the 3D Lab") and, at the bottom, to Sizes.

## Ranking for the hub

Most impressive, smoothest on phones, most shareable, from this audit:

1. **Pokémon Sizes:** the most striking and the most shareable (every Pokémon to scale, "Make a video" for vertical video), though the heaviest. It already leads the hub's second slot.
2. **Mass Battle:** the best phone start (poster, 1.4 s), smooth while fighting, and the most shareable result (a link to the battle, a preview card, "Make a video").
3. **World Globe:** the smoothest everywhere and very light; with the phone fixes and a region link and video it becomes shareable too.

The Story and the History are beautiful but slow to show anything on a phone, and are long-form films rather than something to share in a tap; Professor's Lab is the heaviest to start on a desktop with a weak GPU.

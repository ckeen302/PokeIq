# PokéIQ — The Ultimate Pokémon Knowledge Engine

Four quiz modules, **zero hardcoded questions**. Every question is computed at
request time from the live [PokéAPI](https://pokeapi.co), each module testing a
different kind of Pokémon mastery:

| Module | Tests |
| --- | --- |
| 👁️ **Who's That Pokémon?** | The anime classic — every question is a shadow on the burst frame, revealed in colour after you answer (alternate-form shadows at hard) |
| 🔍 **Type Detective** | Type chart mastery — weaknesses, resistances, immunities, STAB |
| ⚡ **Move Master** | Move expertise — effects, learnsets, base-power duels |
| 📊 **Stat Showdown** | Competitive knowledge — base-stat duels, stat kings, BST battles |

Plus three ways to play:

- **Classic** — 10 questions at easy/medium/hard/mixed difficulty
- **🔥 Survival** — 3 lives, ramping difficulty, questions stream in endlessly
- **🗓️ Daily Gauntlet** — a seeded 10-question run that is *identical for every
  player on Earth each UTC day* (deterministic RNG scoped through
  AsyncLocalStorage — see [src/lib/daily.ts](src/lib/daily.ts)), with its own
  leaderboard and countdown

And a progression layer: 8 unlockable **Gym Badges** (achievements), a local
**Trainer Card** (runs, accuracy, bests, badge collection), Wordle-style
shareable result cards, and synthesized sound effects with an `M` mute toggle.

## Architecture highlights

- **One contract, four engines** — every engine emits the same `QuizQuestion`
  shape ([src/engines/types.ts](src/engines/types.ts)); one reusable
  `<QuizController />` runs all four modules.
- **Self-verifying output** — every generated question passes a Zod gate
  ([src/engines/validate.ts](src/engines/validate.ts)): the correct answer must
  be among the options, options must be distinct, images must come from an
  allow-listed host. Invalid questions are dropped and logged, never served.
- **Answers never reach the client** — correct answers + explanations are
  sealed into AES-256-GCM tokens ([src/lib/answer-token.ts](src/lib/answer-token.ts));
  the browser posts its choice back for a server-side verdict.
- **Rate-limit resilience** — the HTTP layer ([src/lib/http.ts](src/lib/http.ts))
  does exponential backoff with jitter, honors `Retry-After`, keeps a 1-hour
  TTL cache, and coalesces concurrent requests (N players → 1 PokéAPI call per
  resource).
- **Graceful degradation** — the leaderboard uses Supabase when configured and
  transparently falls back to in-process storage when not.

## Getting started

```bash
npm install
npm run dev            # http://localhost:3000
```

## Verification

```bash
npm run typecheck      # strict TypeScript
npm run build          # production build
npm run verify:engines # 5 live questions per engine + Zod gate + timing
npm run verify:e2e     # Playwright smoke: desktop + mobile, all pages
                       # (first time: npx playwright install chromium)
```

`verify:e2e` starts `next start` on port 3100 itself (run `npm run build`
first), or point it at a running server with `BASE_URL=http://localhost:3000`.

## Environment (all optional)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL for the persistent leaderboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for the accounts backend (profiles/sessions/stats — RLS-locked away from the anon key) |
| `QUIZ_TOKEN_SECRET` | Stable secret for answer tokens (recommended in serverless deploys so tokens survive across instances) |

Apply [supabase/migrations/0001_leaderboard.sql](supabase/migrations/0001_leaderboard.sql)
and [supabase/migrations/0002_accounts.sql](supabase/migrations/0002_accounts.sql)
in the Supabase SQL editor.

## Accounts backend

PokéIQ ships a real credential auth system with zero required configuration:

- **Passwords** hashed with scrypt (per-user salt, constant-time compare).
- **Sessions**: 256-bit tokens in an HTTP-only `SameSite=Lax` cookie; only
  the SHA-256 of each token is stored server-side.
- **Storage**: Supabase Postgres when `SUPABASE_SERVICE_ROLE_KEY` is set,
  otherwise an atomic file-backed store at `.data/pokeiq-auth.json` — local
  accounts work with no setup at all.
- **Progress tracking**: finished runs POST to `/api/stats`; the server owns
  aggregation (games, accuracy, bests, lifetime XP). Signing in on another
  device restores your Trainer Card.
- **Competition**: the leaderboard ranks trainers by lifetime XP on an
  Olympic-style podium (your rows are highlighted), results screens show
  "+XP banked · global rank #N", and `/trainer` is a full profile — rank,
  battle record, per-module bests, badge collection and account security.
- **Account recovery without email**: signup issues a one-time recovery code
  (shown once, stored only as a SHA-256 hash). The code alone finds your
  account — recovering a forgotten username too — resets the password,
  rotates itself, and revokes all existing sessions.
- Playing never requires an account — guests keep localStorage stats.

## Deployment (Vercel)

1. Push to GitHub, import the repo in Vercel — zero-config build.
2. (Optional) add the Supabase env vars + `QUIZ_TOKEN_SECRET`.

## Keyboard & accessibility

- `1`–`4` answer, `Enter` advances; every control is keyboard-reachable.
- Confetti and the aurora backdrop respect `prefers-reduced-motion`.
- Installable PWA (Add to Home Screen on iOS), safe-area aware.

Pokémon © Nintendo/Game Freak — fan project, not affiliated.

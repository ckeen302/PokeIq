-- PokéGuessr duels: two trainers head to head on the same rounds.
--
-- One row per duel while it's played. `state` holds the whole duel (seats,
-- pins, scores, HP), including pins the opponent mustn't see before a round
-- is revealed, so RLS is on with NO policies: only the server (service role)
-- reads or writes it. Every update is a compare-and-swap on `version`.
create table if not exists public.geo_duels (
  code        text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  version     integer not null default 0 check (version >= 0),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists geo_duels_expires_idx on public.geo_duels (expires_at);

alter table public.geo_duels enable row level security;

revoke all on public.geo_duels from anon, authenticated;

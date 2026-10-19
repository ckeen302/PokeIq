-- Duels beyond PokéGuessr (Pokédle, quizzes): two trainers head to head
-- through a share link. One table for every kind; `kind` says which game.
--
-- One row per duel while it's played. `state` holds the whole duel (seats,
-- guesses, answers, scores), including secrets and picks the opponent
-- mustn't see before a round is revealed, so RLS is on with NO policies:
-- only the server (service role) reads or writes it. Every update is a
-- compare-and-swap on `version`.
create table if not exists public.duels (
  code        text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  kind        text not null check (kind in ('pokedle', 'quiz')),
  version     integer not null default 0 check (version >= 0),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists duels_expires_idx on public.duels (expires_at);

alter table public.duels enable row level security;

revoke all on public.duels from anon, authenticated;

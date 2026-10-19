-- Pokémon battles on Pokémon Showdown's simulator: against the computer, or
-- live between two trainers through an invite link.
--
-- One row per battle while it's played. Nothing in it may reach a player
-- directly: `state` (the simulator snapshot) and `input_log` hold both full
-- teams and the RNG state, `meta` holds the seed, the pending requests and
-- seat secrets, and each `log_*` column is one viewer's channel. So RLS is on
-- with NO policies: only the server (service role) reads or writes it, and it
-- hands each player their own channel and request. Every update is a
-- compare-and-swap on `version`.
create table if not exists public.battles (
  code           text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  kind           text not null check (kind in ('cpu', 'pvp', 'tower', 'factory', 'sandbox')),
  format         text not null check (char_length(format) between 1 and 60),
  version        integer not null default 0 check (version >= 0),
  -- The @pkmn/sim version that wrote `state`; another version rebuilds from `input_log`.
  sim_version    text not null,
  meta           jsonb not null,
  -- JSON.stringify(Battle.toJSON()), kept as text so the bytes round-trip exactly (~55 KB, TOAST-compressed).
  state          text,
  -- The simulator's input log: the source of truth for rebuilds, replays and audits.
  input_log      jsonb not null default '[]'::jsonb,
  -- Each viewer's protocol channel, newline-joined (hidden information already split out).
  log_p1         text not null default '',
  log_p2         text not null default '',
  log_spectator  text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

create index if not exists battles_expires_idx on public.battles (expires_at);

alter table public.battles enable row level security;

revoke all on public.battles from anon, authenticated;

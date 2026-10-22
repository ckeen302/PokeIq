-- PokéGuessr screenshot reports: players flag a bad screenshot from a round's
-- result (solo, daily or duel) with a reason: wrong place, wrong game, gives
-- the answer away, too generic to place, bad image, or something else.
--
-- One row per reporter per shot (`reporter` is "u:<profile id>" for a
-- signed-in trainer, else "d:<random device id>"). `ip_hash` is a keyed hash
-- of the reporter's address, never the address: reporters on one network
-- count once. When open reports on a shot come from 3 distinct reporters,
-- the server stops dealing it until a moderator reviews it on /admin:
--   Keep    every open report on the shot becomes 'kept' (cleared)
--   Remove  they become 'removed', and the shot stays out of rotation
--
-- Written and read only by the server (POST /api/geo/report and /api/admin,
-- service role). Until this runs, reports are logged and nothing is hidden.
-- RLS is on with NO policies and no grants for anon or authenticated.

create table if not exists public.geo_shot_reports (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  shot_id      text not null check (shot_id ~ '^[A-Za-z0-9_-]{8,24}$'),
  reason       text not null check (reason in ('wrong-place', 'wrong-game', 'gives-away', 'too-generic', 'bad-image', 'other')),
  note         text check (note is null or char_length(note) <= 300),
  mode         text not null check (mode in ('solo', 'daily', 'duel')),
  reporter     text not null check (char_length(reporter) between 3 and 80),
  ip_hash      text check (ip_hash is null or char_length(ip_hash) <= 64),
  status       text not null default 'open' check (status in ('open', 'kept', 'removed')),
  reviewed_at  timestamptz,
  reviewed_by  text check (reviewed_by is null or char_length(reviewed_by) <= 40),
  unique (shot_id, reporter)
);

-- The hidden shots (open and removed reports) and the review queue.
create index if not exists geo_shot_reports_status_idx on public.geo_shot_reports (status, shot_id);
create index if not exists geo_shot_reports_created_idx on public.geo_shot_reports (created_at desc);

alter table public.geo_shot_reports enable row level security;

revoke all on public.geo_shot_reports from anon, authenticated;
revoke all on sequence public.geo_shot_reports_id_seq from anon, authenticated;

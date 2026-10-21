-- PokéIQ avatars: each trainer's picked avatar, shown next to their name.
--
-- profiles.avatar holds { pokemonId, shiny, frame, usePicture, picture }.
-- The server checks every pick (a real Pokémon; shiny and frame unlocked by
-- the account's level and ranked tiers) before writing it, and only its
-- moderation flow sets `picture` (an approved upload's id). Null: the
-- account's default Pokémon, picked from its name. Until this runs,
-- everyone shows that default.
--
-- profiles keeps RLS on with no policies (0004): only the service-role key
-- on the server reads or writes it.

alter table public.profiles add column if not exists avatar jsonb
  check (avatar is null or (jsonb_typeof(avatar) = 'object' and pg_column_size(avatar) <= 512));

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Uploaded profile pictures, pre-moderated
-- ---------------------------------------------------------------------------
--
-- avatar_uploads: one row per uploaded picture. A new one is 'pending' and
-- only its uploader and moderators can see it, until a moderator approves
-- it ('approved': its id goes in profiles.avatar->picture) or rejects it
-- ('rejected', optionally with a strike: three stop the trainer uploading).
-- 'deleted': replaced or removed by its owner. Rows are kept (without their
-- images) so the daily limit and strikes still count.
--
-- The images live in the PRIVATE Storage bucket `avatars` as
-- <id>/64.webp and <id>/256.webp, re-encoded on the server (no metadata).
-- The server creates the bucket on first use; the insert below does the
-- same. Every image is served by /api/avatar/img, which checks the status.

create table if not exists public.avatar_uploads (
  id           text        primary key check (id ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  username     text        not null,
  status       text        not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'deleted')),
  strike       boolean     not null default false,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  text
);

create index if not exists avatar_uploads_user_idx on public.avatar_uploads (user_id, created_at desc);
create index if not exists avatar_uploads_pending_idx on public.avatar_uploads (created_at) where status = 'pending';

alter table public.avatar_uploads enable row level security;
revoke all on public.avatar_uploads from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/webp'])
on conflict (id) do nothing;

-- Problem reports: what players send with "Report a problem" (feedback), and
-- errors their browsers catch (error).
--
-- Written only by the server (POST /api/report, service role) and read only
-- in the Supabase dashboard. Reports can hold a contact address, so RLS is
-- on with NO policies: the anon key can't read or write them at all.
create table if not exists public.reports (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('error', 'feedback')),
  message     text not null check (char_length(message) between 1 and 2000),
  -- The page it was sent from, e.g. /pokedle/duel/abcd2345.
  page        text check (char_length(page) <= 500),
  user_agent  text check (char_length(user_agent) <= 400),
  contact     text check (char_length(contact) <= 200),
  -- Errors: the stack, source and digest.
  extra       jsonb
);

create index if not exists reports_created_idx on public.reports (created_at desc);

alter table public.reports enable row level security;

revoke all on public.reports from anon, authenticated;
revoke all on sequence public.reports_id_seq from anon, authenticated;

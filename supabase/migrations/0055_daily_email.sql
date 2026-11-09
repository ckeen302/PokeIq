-- Opt-in daily reminder emails ("the new dailies are live").
--
-- One row per trainer who has given an email address. Nothing is sent until
-- `email_verified_at` is set by the double opt-in link, and only while
-- `daily_email` is on. `streak_nudge` narrows it to the days a daily streak
-- is at risk (a live streak, today not played yet). `last_sent_on` is the
-- date (UTC, the site's daily) of the last daily email: the send job claims
-- a row by setting it before sending, so a re-run on the same day never
-- mails anyone twice.
--
-- Confirm and unsubscribe links are HMAC-signed with the server secret, so
-- no token is stored here.
--
-- The address is private: never shown publicly, only returned to the
-- account's owner. RLS is on with NO policies and no grants: only the server
-- (service role) reads or writes this table. Additive, safe to run more than
-- once.

create table if not exists public.email_subscriptions (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  email_verified_at timestamptz,
  daily_email boolean not null default false,
  streak_nudge boolean not null default false,
  last_sent_on date,
  confirm_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The send job's lookup: confirmed, opted-in rows.
create index if not exists email_subscriptions_daily_idx
  on public.email_subscriptions (last_sent_on)
  where daily_email and email_verified_at is not null;

alter table public.email_subscriptions enable row level security;
revoke all on public.email_subscriptions from anon, authenticated;

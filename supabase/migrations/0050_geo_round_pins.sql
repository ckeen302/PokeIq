-- PokéGuessr pin log (src/lib/server/geo-round-scores.ts): each graded pin
-- round also records where the pin went, on the world map (0–1 across and
-- down, whatever map the round was played on). Shots with a verified exact
-- spot are scored against it (src/data/geo-shot-spots.json); for the others,
-- players' pins piled up per shot show where it was taken, so spots can be
-- filled in later. Region streak picks and timed-out rounds have no pin.
--
-- Idempotent. Before this runs, rounds are still logged without the pin
-- (the server notices the missing columns and falls back). Written and read
-- only by the server (service role): RLS stays on with no policies and no
-- grants for anon or authenticated, as for the rest of the table.

alter table public.geo_round_scores add column if not exists pin_x real check (pin_x is null or (pin_x >= 0 and pin_x <= 1));
alter table public.geo_round_scores add column if not exists pin_y real check (pin_y is null or (pin_y >= 0 and pin_y <= 1));

-- Per-shot pins, for reading a shot's crowd spot.
create index if not exists geo_round_scores_pins_idx on public.geo_round_scores (shot_id) where pin_x is not null;

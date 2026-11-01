-- Name 'em All personal bests on trainer profiles: one trainer's rows by
-- player key, without scanning every board. Additive, safe to run more than once.
create index if not exists name_em_all_board_player_idx
  on public.name_em_all_board (player_key);

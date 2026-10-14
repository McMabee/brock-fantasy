-- Supplied ADP is a season metric, independent of observed draft-pick averages.
alter table public.athlete_season_summaries
  add column supplied_adp numeric default null,
  add constraint supplied_adp_valid check (
    supplied_adp is null or (kind = 'supplied_projection' and supplied_adp > 0 and supplied_adp <> 'NaN'::numeric and supplied_adp <> 'Infinity'::numeric)
  );
create function beta_private.refresh_supplied_adp_pool() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.kind <> 'supplied_projection' then return new; end if;
  if tg_op = 'INSERT' then
    if new.supplied_adp is null then return new; end if;
  elsif old.supplied_adp is not distinct from new.supplied_adp then return new;
  end if;
  update public.player_pools p set state_version = state_version + 1
  from public.fantasy_seasons s
  where s.id = p.season_id and s.label = new.season_label
    and exists(select 1 from public.athlete_seasons m join public.pool_competitions pc on pc.competition_id = m.competition_id
      where m.athlete_id = new.athlete_id and m.season_id = p.season_id and pc.pool_id = p.id);
  return new;
end;
$$;
revoke all on function beta_private.refresh_supplied_adp_pool() from public, anon, authenticated;
grant execute on function beta_private.refresh_supplied_adp_pool() to service_role;
create trigger supplied_adp_revision after insert or update of supplied_adp
on public.athlete_season_summaries for each row execute function beta_private.refresh_supplied_adp_pool();
-- get_draft_room_snapshot already serializes summaries with to_jsonb.
-- Existing grants/RLS and public RPC signatures remain unchanged.
notify pgrst, 'reload schema';

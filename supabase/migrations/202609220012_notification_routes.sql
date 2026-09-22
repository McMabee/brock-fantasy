create or replace function public.enrich_notification_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_id text;
  v_league_id uuid;
begin
  if new.data ? 'path' then return new; end if;

  v_entity_id := coalesce(new.data ->> 'draft_id', new.data ->> 'draftId');
  if v_entity_id is not null then
    new.data := new.data || jsonb_build_object('path', '/draft/' || v_entity_id);
    return new;
  end if;

  v_entity_id := coalesce(new.data ->> 'league_id', new.data ->> 'leagueId');
  if v_entity_id is not null then
    new.data := new.data || jsonb_build_object('path', '/league/' || v_entity_id);
    return new;
  end if;

  v_entity_id := coalesce(new.data ->> 'trade_id', new.data ->> 'tradeId');
  if v_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select league_id into v_league_id
    from public.trades
    where id = v_entity_id::uuid;
    if v_league_id is not null then
      new.data := new.data || jsonb_build_object('path', '/transactions/' || v_league_id::text);
      return new;
    end if;
  end if;

  v_entity_id := coalesce(new.data ->> 'claim_id', new.data ->> 'claimId');
  if v_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select league_id into v_league_id
    from public.waiver_claims
    where id = v_entity_id::uuid;
    if v_league_id is not null then
      new.data := new.data || jsonb_build_object('path', '/transactions/' || v_league_id::text);
    end if;
  end if;
  return new;
end;
$$;

create trigger notifications_add_route
before insert or update of data on public.notifications
for each row execute function public.enrich_notification_route();

update public.notifications set data = data where not (data ? 'path');

revoke all on function public.enrich_notification_route()
  from public, anon, authenticated, service_role;

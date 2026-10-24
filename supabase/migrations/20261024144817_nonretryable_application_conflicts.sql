set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Business conflicts must return once instead of entering PostgREST transaction retries
-- - Replace only the reviewed application guards and retain function identities and grants
do $migration$
declare signature text; definition text;
begin
  foreach signature in array array[
    'rpc_private.admin_set_participation(uuid,text,text[],bigint,text,text)',
    'rpc_private.confirm_matchup_schedule(uuid,text,text)',
    'rpc_private.delete_league(uuid,text,bigint,text)',
    'rpc_private.make_draft_pick(uuid,uuid,text,public.draft_pick_source,bigint)',
    'rpc_private.preview_game_revision(uuid,bigint,jsonb)',
    'rpc_private.publish_game_revision(uuid,bigint,public.game_status,integer,integer,jsonb,text,text,text)',
    'rpc_private.publish_historical_game_logs(uuid,text,text,text)',
    'rpc_private.publish_preseason_rankings(uuid,text,text,text)',
    'rpc_private.review_game_schedule(uuid,bigint,text,jsonb,text,text)',
    'rpc_private.schedule_league_draft(uuid,timestamptz,bigint,text)',
    'rpc_private.set_league_pick_duration(uuid,integer,bigint,text)',
    'rpc_private.set_period_lineup(uuid,jsonb,bigint,text)'
  ] loop
    if to_regprocedure(signature) is null then raise exception 'Missing reviewed function: %',signature; end if;
    select pg_get_functiondef(to_regprocedure(signature)) into definition;
    if position('''40001''' in definition)>0 then
      execute replace(definition,'''40001''','''PT409''');
    elsif position('''PT409''' in definition)=0 then
      raise exception 'Reviewed conflict guard changed: %',signature;
    end if;
  end loop;
end;
$migration$;

notify pgrst,'reload schema';

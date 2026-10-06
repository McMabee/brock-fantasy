-- Preserve public command signatures used by existing web/native clients while
-- routing beta leagues through the optimistic-concurrency implementation.
create function public.make_draft_pick(
  p_draft_id uuid,
  p_athlete_id uuid,
  p_idempotency_key text,
  p_source public.draft_pick_source
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.make_draft_pick(p_draft_id, p_athlete_id, p_idempotency_key, p_source, null);
$$;

create function public.set_draft_status(
  p_draft_id uuid,
  p_status text,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.set_draft_status(p_draft_id, p_status::public.draft_status, p_idempotency_key);
$$;

revoke all on function public.make_draft_pick(uuid,uuid,text,public.draft_pick_source) from public,anon,authenticated,service_role;
revoke all on function public.set_draft_status(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.make_draft_pick(uuid,uuid,text,public.draft_pick_source) to authenticated,service_role;
grant execute on function public.set_draft_status(uuid,text,text) to authenticated;

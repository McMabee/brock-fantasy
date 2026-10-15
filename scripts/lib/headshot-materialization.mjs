import { rosterPlan } from './roster-materialization.mjs';
export function headshotPlan(manifest, operatorId, mapping) {
  const roster = rosterPlan(manifest, operatorId);
  if (mapping.version !== 1 || mapping.season !== roster.season)
    throw new Error('Headshot season/version mismatch.');
  const seen = new Set();
  for (const item of mapping.headshots) {
    const player = roster.players.find((p) => p.id === item.id);
    const source = player && manifest.imports.find((i) => i.revisionHash === player.revisionHash);
    const row = source?.rows.find((r) => r.rowNumber === player.rowNumber).normalized;
    const identity = row?.identityCandidates?.length === 1 ? row.identityCandidates[0] : null;
    if (
      !player ||
      !identity ||
      seen.has(item.id) ||
      item.revisionHash !== player.revisionHash ||
      item.rowNumber !== player.rowNumber ||
      item.headshot.sourcePlayerId !== identity.sourcePlayerId ||
      item.headshot.rosterSourceHash !== identity.sourceHash ||
      item.headshot.season !== roster.season ||
      item.headshot.sourceUrl !== identity.bioUrl ||
      item.headshot.permissionReference !== 'operator-headshots-approved-2026-10-13'
    )
      throw new Error('Headshot identity/provenance mismatch.');
    const url = new URL(item.headshot.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'gobadgers.ca' ||
      !url.pathname.startsWith('/images/')
    )
      throw new Error('Unexpected headshot image source.');
    seen.add(item.id);
  }
  return {
    operatorId,
    headshots: mapping.headshots,
    missing: mapping.missing,
    permission: mapping.permission,
  };
}
export function headshotSql({ operatorId, headshots }) {
  const payload = "'" + JSON.stringify(headshots).replaceAll("'", "''") + "'::jsonb";
  return `begin;
create temp table approved_headshots as select * from jsonb_to_recordset(${payload})
  as x(id uuid,"revisionHash" text,"rowNumber" integer,headshot jsonb);
do $$ begin
  if not exists(select 1 from public.user_roles where user_id='${operatorId}'::uuid and role='admin') then raise exception 'Publishing admin required'; end if;
  if exists(select 1 from approved_headshots p where not exists(select 1 from public.athletes a
    where a.id=p.id and a.status='active' and a.bio->'rosterSource'->>'revisionHash'=p."revisionHash"
    and (a.bio->'rosterSource'->>'rowNumber')::integer=p."rowNumber")) then raise exception 'Canonical athlete source mapping differs'; end if;
end $$;
with changed as (
  update public.athletes a set bio=a.bio||jsonb_build_object('headshot',p.headshot),updated_at=clock_timestamp()
  from approved_headshots p where p.id=a.id and a.bio->'headshot' is distinct from p.headshot returning a.id
)
update public.player_pools set state_version=state_version+1 where id='b0000000-0000-4000-8000-000000000003'
  and exists(select 1 from changed);
insert into public.audit_log(actor_id,action,entity_type,entity_id,after_state,request_id)
select '${operatorId}'::uuid,'headshots.materialized','season','2026-27',
  jsonb_build_object('headshots',(select count(*) from approved_headshots),'permission','operator-headshots-approved-2026-10-13'),
  'headshots:'||md5(${payload}::text)
where not exists(select 1 from public.audit_log where request_id='headshots:'||md5(${payload}::text));
select jsonb_build_object('headshots',count(*),'optOutHeadshots',0) as headshot_publication
  from approved_headshots p join public.athletes a on a.id=p.id and a.bio->'headshot'=p.headshot;
commit;`;
}

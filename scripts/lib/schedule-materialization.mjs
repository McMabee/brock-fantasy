import { rosterPlan, sourceUuid } from './roster-materialization.mjs';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
export function schedulePlan(manifest, operatorId) {
  const programs = rosterPlan(manifest, operatorId).programs;
  const imports = manifest.imports.filter((i) =>
    ['schedule', 'combined_schedule'].includes(i.kind),
  );
  assert(
    imports.length === 4 && manifest.issues.length === 0,
    'Four clean approved schedule sources are required.',
  );
  const games = imports.flatMap((item) =>
    item.rows.map((row) => {
      const game = row.normalized;
      const program = programs.find((p) => p.program === game.program);
      assert(
        item.approval &&
          game.status === 'approved_mapping' &&
          program &&
          Number.isFinite(Date.parse(game.startsAt)),
        'Every game requires a confirmed program and start time.',
      );
      const side = /^\s*([HA])\s*[–-]/u.exec(row.raw.Location ?? '')?.[1];
      assert(side, 'Every supplied game requires a home/away designation.');
      const opponentId = sourceUuid(
        'schedule-opponent:' + manifest.seasonId + ':' + game.program + ':' + game.opponent,
      );
      const id = sourceUuid(
        'schedule-game:' +
          manifest.seasonId +
          ':' +
          game.program +
          ':' +
          item.source +
          ':' +
          game.sourceRowNumber,
      );
      return {
        id,
        competitionId: program.competitionId,
        program: game.program,
        opponentId,
        opponent: game.opponent,
        homeTeamId: side === 'H' ? program.teamId : opponentId,
        awayTeamId: side === 'H' ? opponentId : program.teamId,
        startsAt: game.startsAt,
        sourceUrl: game.mappingEvidence.sourceUrl,
        location: game.location,
        source: item.source,
        revisionHash: item.revisionHash,
        rowNumber: row.rowNumber,
        sourceKey: item.revisionHash + ':' + row.rowNumber,
        raw: row.raw,
        normalized: game,
      };
    }),
  );
  assert(
    games.length === 129 && new Set(games.map((g) => g.id)).size === 129,
    'Expected 129 distinct approved games.',
  );
  return {
    seasonId: manifest.seasonId,
    season: '2026-27',
    operatorId,
    programs,
    games,
    imports: imports.map((i) => ({
      source: i.source,
      sourceHash: i.sourceHash,
      revisionHash: i.revisionHash,
      approvalId: i.approval.approvalId,
    })),
  };
}
const sqlJson = (value) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
export function scheduleSql(plan) {
  return `begin;
create temp table schedule_plan as select ${sqlJson(plan)} as payload;
create temp table expected_games as
select * from jsonb_to_recordset((select payload->'games' from schedule_plan)) as x(
  id uuid,"competitionId" uuid,program text,"opponentId" uuid,opponent text,
  "homeTeamId" uuid,"awayTeamId" uuid,"startsAt" timestamptz,"sourceUrl" text,location text,
  source text,"revisionHash" text,"rowNumber" integer,"sourceKey" text,raw jsonb,normalized jsonb
);
do $$ declare p jsonb:=(select payload from schedule_plan); item jsonb;
begin
  if not exists(select 1 from public.user_roles where user_id=(p->>'operatorId')::uuid and role='admin') then
    raise exception 'Verified publishing administrator required'; end if;
  if not exists(select 1 from public.fantasy_seasons where id=(p->>'seasonId')::uuid and label='2026-27') then
    raise exception 'Confirmed season missing'; end if;
  for item in select value from jsonb_array_elements(p->'imports') loop
    if not exists(select 1 from public.source_imports where source=item->>'source'
      and source_hash=item->>'revisionHash' and payload->>'sourceHash'=item->>'sourceHash'
      and payload->'approval'->>'approvalId'=item->>'approvalId') then
      raise exception 'Approved stored schedule revision is missing or changed'; end if;
  end loop;
  if exists(select 1 from expected_games e where not exists(
    select 1 from public.source_imports i join public.source_rows r on r.import_id=i.id
    where i.source=e.source and i.source_hash=e."revisionHash" and r.row_number=e."rowNumber"
      and r.source_key=e."sourceKey" and r.raw=e.raw and r.normalized=e.normalized
      and (r.entity_id is null or r.entity_id=e.id)
  )) then raise exception 'Stored schedule evidence differs from the approved source'; end if;
  if exists(select 1 from expected_games e where not exists(select 1 from public.competitions c where c.id=e."competitionId" and c.season_label='2026-27'))
    then raise exception 'Approved competition mapping missing'; end if;
end $$;
insert into public.teams(id,competition_id,name,short_name,is_brock)
select distinct "opponentId","competitionId",opponent,left(opponent,12),false from expected_games on conflict(id) do nothing;
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,lineup_lock_at,source_url,source_updated_at)
select id,"competitionId","homeTeamId","awayTeamId","startsAt","startsAt","sourceUrl",clock_timestamp() from expected_games
on conflict(id) do nothing;
do $$ begin
  if (select count(*) from expected_games e join public.games g on g.id=e.id
    where g.competition_id=e."competitionId" and g.home_team_id=e."homeTeamId" and g.away_team_id=e."awayTeamId"
      and g.starts_at=e."startsAt" and g.lineup_lock_at=e."startsAt" and g.source_url=e."sourceUrl")<>129 then
    raise exception 'Canonical schedules differ; review existing corrections before retrying'; end if;
end $$;
update public.source_rows r set entity_id=e.id from expected_games e,public.source_imports i
where i.source=e.source and i.source_hash=e."revisionHash" and r.import_id=i.id and r.row_number=e."rowNumber" and r.entity_id is null;
update public.competitions set is_active=true where id in(select "competitionId" from expected_games);
insert into public.provider_entity_mappings(provider,entity_type,provider_entity_id,internal_entity_id,metadata)
select 'brock-confirmed-schedules','game',e."sourceKey",e.id,jsonb_build_object('source',e.source,'location',e.location,'season','2026-27')
from expected_games e on conflict(provider,entity_type,provider_entity_id) do nothing;
insert into public.audit_log(actor_id,action,entity_type,entity_id,after_state,request_id)
select (payload->>'operatorId')::uuid,'schedules.materialized','season',payload->>'seasonId',
  jsonb_build_object('games',129,'programs',6),'confirmed-schedules:'||md5((payload->'imports')::text)
from schedule_plan where not exists(select 1 from public.audit_log a where a.request_id='confirmed-schedules:'||md5((payload->'imports')::text));
select jsonb_build_object('games',count(*),'programs',count(distinct g.competition_id),'sourceMappings',
  (select count(*) from public.source_rows where entity_id in(select id from expected_games))) as schedule_publication
from public.games g where g.id in(select id from expected_games);
commit;
`;
}

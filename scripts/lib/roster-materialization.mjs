import { createHash } from 'node:crypto';

export const programs = {
  mens_hockey: { sport: 'hockey', division: 'mens', name: "Men's Hockey" },
  womens_hockey: { sport: 'hockey', division: 'womens', name: "Women's Hockey" },
  mens_basketball: { sport: 'basketball', division: 'mens', name: "Men's Basketball" },
  womens_basketball: { sport: 'basketball', division: 'womens', name: "Women's Basketball" },
  mens_volleyball: { sport: 'volleyball', division: 'mens', name: "Men's Volleyball" },
  womens_volleyball: { sport: 'volleyball', division: 'womens', name: "Women's Volleyball" },
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Identity is scoped to a specific approved source record, never a name/jersey
// match. Changed revisions require a reviewed crosswalk instead of auto-merging.
export function sourceUuid(key) {
  const hex = createHash('sha256').update(`brock-roster-directory-v1:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const numeric = (cell) =>
  cell?.kind === 'number' && Number.isFinite(cell.value) ? cell.value : null;

export function rosterPlan(manifest, operatorId) {
  requireValue(uuid.test(operatorId ?? ''), 'An explicit operator profile UUID is required.');
  requireValue(uuid.test(manifest.seasonId ?? ''), 'A season UUID is required.');
  requireValue(manifest.issues?.length === 0, 'Resolve source issues before roster publication.');
  const sources = manifest.imports.filter((item) => item.kind === 'roster');
  requireValue(sources.length === 6, 'All six roster sources are required.');
  const seen = new Set();
  const players = [];
  const excluded = [];
  const imports = sources.map((item) => {
    requireValue(
      item.approval?.sourceHash === item.sourceHash &&
        item.issues.length === 0 &&
        ['athlete_identity', 'verified_positions', 'current_roster_approval'].every((scope) =>
          item.approval.scopes.includes(scope),
        ),
      'Every roster needs exact source, identity, position and membership approval.',
    );
    const candidates = item.rows.filter(
      (row) => row.normalized.type === 'athlete_season_candidate',
    );
    const program = candidates[0]?.normalized.program;
    requireValue(
      programs[program] && !seen.has(program),
      'Roster programs must be unique and supported.',
    );
    seen.add(program);
    for (const row of candidates) {
      const athlete = row.normalized;
      requireValue(athlete.program === program, 'A roster contains a different program.');
      if (athlete.sourceSection !== 'current_season') continue;
      const rawName = row.raw['Full name'] ?? row.raw.Name ?? '';
      const optedOut =
        rawName.includes('**') ||
        athlete.name.includes('**') ||
        athlete.excludedFromFantasy ||
        athlete.participationStatus === 'opted_out';
      if (optedOut) {
        excluded.push({ revisionHash: item.revisionHash, rowNumber: row.rowNumber });
        continue;
      }
      requireValue(
        athlete.identityStatus === 'source_owner_confirmed' &&
          athlete.membershipStatus === 'source_owner_confirmed' &&
          athlete.positionStatus === 'source_owner_confirmed' &&
          athlete.participationStatus === 'participating' &&
          athlete.positions.length > 0,
        'Included players need confirmed current identity, membership, participation and positions.',
      );
      const sourceKey = `${item.revisionHash}:${row.rowNumber}`;
      players.push({
        id: sourceUuid(`${manifest.seasonId}:${sourceKey}`),
        membershipId: sourceUuid(`membership:${manifest.seasonId}:${sourceKey}`),
        program,
        name: athlete.name,
        positions: athlete.positions,
        jersey: athlete.jerseyNumber,
        sourceKey,
        source: item.source,
        revisionHash: item.revisionHash,
        rowNumber: row.rowNumber,
        bio: {
          ...athlete.bio,
          program,
          sourcePosition: athlete.sourcePosition,
          rosterSource: {
            source: item.source,
            sourceHash: item.sourceHash,
            revisionHash: item.revisionHash,
            rowNumber: row.rowNumber,
            approvalId: item.approval.approvalId,
            reviewedBy: item.approval.approvedBy,
          },
        },
        historicalPoints: numeric(athlete.historicalFantasyPoints),
        historicalGames: numeric(athlete.gamesPlayed),
        historicalReason: athlete.historicalAvailabilityReason,
        projectedPoints: numeric(athlete.suppliedSeasonProjection),
        projectedGames: numeric(athlete.suppliedProjectedGames),
      });
    }
    return {
      source: item.source,
      sourceHash: item.sourceHash,
      revisionHash: item.revisionHash,
      approvalId: item.approval.approvalId,
      rows: item.rows.map((row) => ({
        rowNumber: row.rowNumber,
        raw: row.raw,
        normalized: row.normalized,
      })),
    };
  });
  requireValue(players.length > 0, 'The approved directory has no participating players.');
  requireValue(
    new Set(players.map((player) => player.id)).size === players.length,
    'Duplicate source record identity.',
  );
  const season = manifest.season;
  requireValue(/^\d{4}-\d{2}$/u.test(season), 'A supported season label is required.');
  return {
    seasonId: manifest.seasonId,
    season,
    historicalSeason: `${Number(season.slice(0, 4)) - 1}-${season.slice(2, 4)}`,
    operatorId,
    imports,
    players,
    excluded,
    programs: Object.entries(programs).map(([program, value]) => ({
      ...value,
      program,
      sportId: sourceUuid(`sport:${value.sport}`),
      competitionId: sourceUuid(`competition:${manifest.seasonId}:${program}`),
      teamId: sourceUuid(`team:${manifest.seasonId}:${program}`),
    })),
  };
}

export function rosterSql(plan) {
  // SQL literal quoting is independent of shell quoting. No credentials occur
  // in this protected, reviewable data artifact.
  const literal = `'${JSON.stringify(plan).replaceAll("'", "''")}'::jsonb`;
  return `begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('brock-roster-directory'));
create temporary table roster_release(payload jsonb) on commit drop;
insert into roster_release values (${literal});
create temporary table roster_expected on commit drop as
select p.* from roster_release r, jsonb_to_recordset(r.payload->'players') as p(
  id uuid, "membershipId" uuid, program text, name text, positions text[], jersey text,
  "sourceKey" text, source text, "revisionHash" text, "rowNumber" integer, bio jsonb,
  "historicalPoints" numeric, "historicalGames" numeric, "historicalReason" text,
  "projectedPoints" numeric, "projectedGames" numeric);
create temporary table roster_programs on commit drop as
select p.* from roster_release r, jsonb_to_recordset(r.payload->'programs') as p(
  program text, sport text, division text, name text, "sportId" uuid, "competitionId" uuid, "teamId" uuid);
do $$ declare r jsonb; item jsonb; source_id uuid; expected jsonb; begin
  select payload into r from roster_release;
  if not exists (select 1 from public.profiles p join public.user_roles u on u.user_id=p.id
    where p.id=(r->>'operatorId')::uuid and u.role='admin') then
    raise exception 'Publishing operator is not an active administrator'; end if;
  if not exists (select 1 from public.fantasy_seasons where id=(r->>'seasonId')::uuid and label=r->>'season') then
    raise exception 'Season does not match the explicit release'; end if;
  if exists (select 1 from public.athlete_seasons m where m.season_id=(r->>'seasonId')::uuid
    and not exists(select 1 from roster_expected p where p.id=m.athlete_id)) then
    raise exception 'Existing season identities need a reviewed crosswalk; refusing automatic merge'; end if;
  for item in select value from jsonb_array_elements(r->'imports') loop
    select id into source_id from public.source_imports where source=item->>'source'
      and source_hash=item->>'revisionHash' and season_id=(r->>'seasonId')::uuid
      and kind='roster' and status in ('preview','published') and issues='[]'::jsonb
      and payload->>'sourceHash'=item->>'sourceHash'
      and payload->'approval'->>'approvalId'=item->>'approvalId' for update;
    if source_id is null then raise exception 'Approved stored roster revision is missing or changed'; end if;
    perform 1 from public.source_rows where import_id=source_id for update;
    if (select count(*) from public.source_rows where import_id=source_id) <> jsonb_array_length(item->'rows') then
      raise exception 'Stored roster row count differs'; end if;
    for expected in select value from jsonb_array_elements(item->'rows') loop
      if not exists(select 1 from public.source_rows sr where sr.import_id=source_id
        and sr.row_number=(expected->>'rowNumber')::integer
        and sr.source_key=(item->>'revisionHash')||':'||(expected->>'rowNumber')
        and sr.raw=expected->'raw' and sr.normalized=expected->'normalized'
        and (sr.entity_id is null or exists(select 1 from roster_expected p
          where p.id=sr.entity_id and p."sourceKey"=sr.source_key))) then
        raise exception 'Stored roster evidence or identity mapping differs'; end if;
    end loop;
  end loop;
end $$;
insert into public.sports(id,code,name)
select distinct "sportId",sport::public.sport_code,initcap(sport) from roster_programs
on conflict (code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select p."competitionId",s.id,p.division::public.division_code,'Brock '||p.name,r.payload->>'season',pool.ruleset_id,false
from roster_programs p join public.sports s on s.code=p.sport::public.sport_code
cross join roster_release r join public.player_pools pool on pool.season_id=(r.payload->>'seasonId')::uuid
join public.scoring_rulesets rules on rules.id=pool.ruleset_id and rules.status='approved'
where pool.id='b0000000-0000-4000-8000-000000000003'::uuid
on conflict (sport_id,division,season_label) do nothing;
-- Reuse competition/team IDs only by their structural unique keys, never by athlete names.
update roster_programs p set "competitionId"=c.id from public.competitions c join public.sports s on s.id=c.sport_id,
roster_release r where s.code=p.sport::public.sport_code and c.division=p.division::public.division_code
and c.season_label=r.payload->>'season';
insert into public.teams(id,competition_id,name,short_name,is_brock)
select "teamId","competitionId",'Brock Badgers '||name,'BRO',true from roster_programs
on conflict (competition_id,name) do nothing;
update roster_programs p set "teamId"=t.id from public.teams t where t.competition_id=p."competitionId"
and t.name='Brock Badgers '||p.name and t.is_brock;
insert into public.athletes(id,competition_id,team_id,display_name,position,jersey_number,bio,status)
select e.id,p."competitionId",p."teamId",e.name,e.positions[1],e.jersey,e.bio,'active'
from roster_expected e join roster_programs p on p.program=e.program on conflict(id) do nothing;
insert into public.athlete_seasons(id,athlete_id,season_id,competition_id,team_id,positions,
  draft_eligible,curated,directory_visible,source_key)
select e."membershipId",e.id,(r.payload->>'seasonId')::uuid,p."competitionId",p."teamId",e.positions,
  false,true,true,e."sourceKey" from roster_expected e join roster_programs p on p.program=e.program
cross join roster_release r on conflict(athlete_id,season_id) do nothing;
insert into public.athlete_season_summaries(athlete_id,season_label,source,fantasy_points,games_played,stats,kind,import_id)
select e.id,r.payload->>'historicalSeason',e.source,e."historicalPoints",e."historicalGames",
jsonb_build_object('availabilityReason',e."historicalReason"),'historical',i.id
from roster_expected e cross join roster_release r join public.source_imports i
on i.source=e.source and i.source_hash=e."revisionHash" on conflict do nothing;
insert into public.athlete_season_summaries(athlete_id,season_label,source,fantasy_points,games_played,stats,kind,import_id)
select e.id,r.payload->>'season',e.source,e."projectedPoints",e."projectedGames",'{}'::jsonb,'supplied_projection',i.id
from roster_expected e cross join roster_release r join public.source_imports i
on i.source=e.source and i.source_hash=e."revisionHash" on conflict do nothing;
do $$ begin
  if exists(select 1 from roster_expected e join roster_programs p on p.program=e.program
    left join public.athletes a on a.id=e.id left join public.athlete_seasons m
      on m.athlete_id=e.id and m.season_id=(select (payload->>'seasonId')::uuid from roster_release)
    where a.id is null or a.display_name is distinct from e.name or a.competition_id<>p."competitionId"
      or a.team_id<>p."teamId" or a.position<>e.positions[1] or a.jersey_number is distinct from e.jersey
      or a.bio is distinct from e.bio or a.status<>'active' or m.id is null
      or m.positions is distinct from e.positions or m.source_key is distinct from e."sourceKey"
      or m.draft_eligible or not m.curated or not m.directory_visible) then
    raise exception 'Canonical readback differs or participation was withdrawn; refusing overwrite'; end if;
  if (select count(*) from public.athlete_season_summaries h join roster_expected e on e.id=h.athlete_id
    cross join roster_release r where h.source=e.source and (
    (h.kind='historical' and h.season_label=r.payload->>'historicalSeason'
      and h.fantasy_points is not distinct from e."historicalPoints" and h.games_played is not distinct from e."historicalGames")
    or (h.kind='supplied_projection' and h.season_label=r.payload->>'season'
      and h.fantasy_points is not distinct from e."projectedPoints" and h.games_played is not distinct from e."projectedGames")))
      <> 2*(select count(*) from roster_expected) then
    raise exception 'Season summary readback differs'; end if;
end $$;
update public.source_rows sr set entity_id=e.id from roster_expected e join public.source_imports i
on i.source=e.source and i.source_hash=e."revisionHash" where sr.import_id=i.id and sr.source_key=e."sourceKey" and sr.entity_id is null;
do $$ begin
  if (select count(*) from public.source_rows sr join public.source_imports i on i.id=sr.import_id
    join roster_expected e on e.source=i.source and e."revisionHash"=i.source_hash
      and e."sourceKey"=sr.source_key and e.id=sr.entity_id)<>(select count(*) from roster_expected) then
    raise exception 'Canonical source mapping readback is incomplete'; end if;
end $$;
update public.source_imports i set status='published',published_at=coalesce(published_at,now())
from roster_release r,jsonb_array_elements(r.payload->'imports') item
where i.source=item->>'source' and i.source_hash=item->>'revisionHash';
insert into public.audit_log(actor_id,action,entity_type,entity_id,after_state,request_id)
select (r.payload->>'operatorId')::uuid,'roster.directory_published','fantasy_season',r.payload->>'seasonId',
jsonb_build_object('players',(select count(*) from roster_expected),'excluded',jsonb_array_length(r.payload->'excluded'),
  'imports',(select jsonb_agg(jsonb_build_object('source',item->>'source','revisionHash',item->>'revisionHash'))
    from jsonb_array_elements(r.payload->'imports') item),'draftActivated',false),
'roster-directory:'||md5((r.payload->'imports')::text) from roster_release r
where not exists(select 1 from public.audit_log a where a.action='roster.directory_published'
  and a.request_id='roster-directory:'||md5((r.payload->'imports')::text));
commit;
select jsonb_build_object('players',count(*),'draftEligible',count(*) filter(where draft_eligible),
  'programs',(select count(distinct competition_id) from public.athlete_seasons
    where directory_visible and season_id='${plan.seasonId}'::uuid)) as roster_publication
from public.athlete_seasons where directory_visible and season_id='${plan.seasonId}'::uuid;
`;
}

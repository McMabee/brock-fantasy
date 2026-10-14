import { createHash } from 'node:crypto';
import { normalizeHeight } from '../../packages/domain/src/player-metrics.ts';
import { rosterPlan } from './roster-materialization.mjs';
import { heightPlan } from './height-materialization.mjs';

const number = (cell) =>
  cell?.kind === 'number' && Number.isFinite(cell.value) ? cell.value : null;
const key = (a) =>
  JSON.stringify([
    a.program,
    a.name,
    a.jerseyNumber ?? a.jersey,
    a.positions,
    a.bio.eligibility,
    a.bio.major,
    a.bio.hometown,
  ]);

export function rosterMetricsPlan(current, published, officialHeights, operatorId, suppressions) {
  const baseline = rosterPlan(published, operatorId);
  const verifiedHeights = heightPlan(published, operatorId, officialHeights);
  const remaining = new Map(baseline.players.map((player) => [key(player), player]));
  const archived = new Set(
    published.imports
      .filter((source) => source.kind === 'roster')
      .flatMap((source) =>
        source.rows
          .filter(
            (row) =>
              row.normalized.type === 'athlete_season_candidate' &&
              row.normalized.sourceSection === 'previous_season',
          )
          .map((row) => key(row.normalized)),
      ),
  );
  const excludedIds = new Set(
    suppressions.athletes.flatMap((item) => (item.athleteId ? [item.athleteId] : [])),
  );
  const players = [];
  for (const source of current.imports.filter((item) => item.kind === 'roster')) {
    for (const row of source.rows) {
      const athlete = row.normalized;
      if (
        athlete.type !== 'athlete_season_candidate' ||
        athlete.excludedFromFantasy ||
        athlete.sourceSection === 'previous_season' ||
        archived.has(key(athlete))
      )
        continue;
      const old = remaining.get(key(athlete));
      if (!old || old.source !== source.source)
        throw new Error(`Roster identity changed or duplicated: ${athlete.name}`);
      remaining.delete(key(athlete));
      if (excludedIds.has(old.id)) continue;
      const adp = number(athlete.suppliedAdp);
      if ((adp !== null && adp <= 0) || ['text', 'negative'].includes(athlete.suppliedAdp?.kind))
        throw new Error(`Invalid supplied ADP: ${athlete.name}`);
      const parsed = athlete.suppliedHeight ? normalizeHeight(athlete.suppliedHeight) : null;
      if (athlete.suppliedHeight && !parsed)
        throw new Error(`Invalid supplied height: ${athlete.name}`);
      const provenance = {
        source: source.source,
        sourceHash: source.sourceHash,
        rowNumber: row.rowNumber,
        season: baseline.season,
      };
      const height = parsed
        ? { ...parsed, raw: athlete.suppliedHeight, ...provenance }
        : (verifiedHeights.heights.find((item) => item.id === old.id)?.height ?? null);
      players.push({
        id: old.id,
        previousRevision: old.revisionHash,
        previousRow: old.rowNumber,
        program: old.program,
        name: old.name,
        jersey: old.jersey,
        positions: old.positions,
        provenance,
        suppliedAdp: adp,
        height,
        projectedPoints: number(athlete.suppliedSeasonProjection),
        projectedGames: number(athlete.suppliedProjectedGames),
        historicalPoints: number(athlete.historicalFantasyPoints),
        historicalGames: number(athlete.gamesPlayed),
        historicalStats: Object.fromEntries(
          Object.entries(athlete.historicalStats ?? {}).map(([stat, value]) => [
            stat,
            number(value),
          ]),
        ),
      });
    }
  }
  for (const old of remaining.values())
    if (!excludedIds.has(old.id))
      throw new Error(`Missing athlete requires an explicit decision: ${old.name}`);
  const exclusions = baseline.players
    .filter((item) => excludedIds.has(item.id))
    .map((item) => ({
      id: item.id,
      previousRevision: item.revisionHash,
      previousRow: item.rowNumber,
    }));
  const revision = createHash('sha256')
    .update(JSON.stringify({ players, exclusions }))
    .digest('hex');
  return {
    operatorId,
    seasonId: baseline.seasonId,
    season: baseline.season,
    historicalSeason: baseline.historicalSeason,
    revision,
    players,
    exclusions,
  };
}

export function rosterMetricsSql(plan) {
  const payload = "'" + JSON.stringify(plan).replaceAll("'", "''") + "'::jsonb";
  return `begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('brock-roster-directory'));
create temp table metric_release on commit drop as select ${payload} as payload;
create temp table metric_players on commit drop as select p.* from metric_release r,
jsonb_to_recordset(r.payload->'players') p(id uuid,"previousRevision" text,"previousRow" integer,program text,name text,jersey text,positions text[],provenance jsonb,"suppliedAdp" numeric,height jsonb,"projectedPoints" numeric,"projectedGames" numeric,"historicalPoints" numeric,"historicalGames" numeric,"historicalStats" jsonb);
create temp table metric_exclusions on commit drop as select p.* from metric_release r,
jsonb_to_recordset(r.payload->'exclusions') p(id uuid,"previousRevision" text,"previousRow" integer);
do $$ begin
 if not exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id
  where p.id='${plan.operatorId}'::uuid and p.deleted_at is null and u.role='admin') then raise exception 'Publishing admin required'; end if;
 if not exists(select 1 from public.fantasy_seasons where id='${plan.seasonId}' and label='${plan.season}') then raise exception 'Season mismatch'; end if;
 perform 1 from public.athletes a join (select id from metric_players union all select id from metric_exclusions) p on p.id=a.id for update of a;
 if exists(select 1 from (select id,"previousRevision","previousRow" from metric_players union all select * from metric_exclusions) p
  where not exists(select 1 from public.athletes a join public.athlete_seasons m on m.athlete_id=a.id
  where a.id=p.id and m.season_id='${plan.seasonId}' and a.bio->'rosterSource'->>'revisionHash'=p."previousRevision"
  and (a.bio->'rosterSource'->>'rowNumber')::integer=p."previousRow")) then raise exception 'Canonical metric mapping differs'; end if;
 if exists(select 1 from metric_players p join public.athletes a on a.id=p.id
  where a.display_name<>p.name or a.jersey_number is distinct from p.jersey or a.bio->>'program'<>p.program) then raise exception 'Canonical athlete details differ'; end if;
 if exists(select 1 from metric_players p where not exists(select 1 from public.athlete_season_summaries s
  where s.athlete_id=p.id and s.season_label='${plan.season}' and s.kind='supplied_projection')) then raise exception 'Supplied summary missing'; end if;
end $$;
update public.athletes a set bio=a.bio||jsonb_build_object('metricsSource',p.provenance)||
 case when p.height is null then '{}'::jsonb else jsonb_build_object('height',p.height) end,updated_at=clock_timestamp()
from metric_players p where a.id=p.id and (a.bio->'metricsSource' is distinct from p.provenance or (p.height is not null and a.bio->'height' is distinct from p.height));
update public.athlete_season_summaries s set supplied_adp=p."suppliedAdp",fantasy_points=p."projectedPoints",games_played=p."projectedGames"
from metric_players p where s.athlete_id=p.id and s.season_label='${plan.season}' and s.kind='supplied_projection'
and (s.supplied_adp is distinct from p."suppliedAdp" or s.fantasy_points is distinct from p."projectedPoints" or s.games_played is distinct from p."projectedGames");
update public.athlete_season_summaries s set fantasy_points=p."historicalPoints",games_played=p."historicalGames",stats=s.stats||p."historicalStats"
from metric_players p where s.athlete_id=p.id and s.season_label='${plan.historicalSeason}' and s.kind='historical'
and (s.fantasy_points is distinct from p."historicalPoints" or s.games_played is distinct from p."historicalGames" or s.stats is distinct from s.stats||p."historicalStats");
-- Preserve historical picks and ownership, but suppress withdrawn athletes from
-- directory, draft selection, photo and aggregate reads through existing RLS.
update public.athlete_seasons m set directory_visible=false,draft_eligible=false
from metric_exclusions p where m.athlete_id=p.id and m.season_id='${plan.seasonId}';
update public.athletes a set status='inactive',fantasy_withdrawn_at=coalesce(a.fantasy_withdrawn_at,clock_timestamp())
from metric_exclusions p where a.id=p.id;
delete from public.draft_queues q using metric_exclusions p where q.athlete_id=p.id;
with receipt as (
 insert into public.audit_log(actor_id,action,entity_type,entity_id,after_state,request_id)
 select '${plan.operatorId}'::uuid,'roster.metrics_materialized','season','${plan.season}',
 jsonb_build_object('players',${plan.players.length},'exclusions',${plan.exclusions.length},'revision','${plan.revision}'),
 'roster-metrics:${plan.revision}' where not exists(select 1 from public.audit_log where request_id='roster-metrics:${plan.revision}') returning id
)
update public.player_pools set state_version=state_version+1 where season_id='${plan.seasonId}' and exists(select 1 from receipt);
do $$ begin
 if exists(select 1 from metric_players p join public.athletes a on a.id=p.id where a.bio->'metricsSource' is distinct from p.provenance
  or (p.height is not null and a.bio->'height' is distinct from p.height)) then raise exception 'Bio metric readback differs'; end if;
 if exists(select 1 from metric_players p join public.athlete_season_summaries s on s.athlete_id=p.id
  where (s.kind='supplied_projection' and s.season_label='${plan.season}' and (s.supplied_adp is distinct from p."suppliedAdp"
   or s.fantasy_points is distinct from p."projectedPoints" or s.games_played is distinct from p."projectedGames"))
  or (s.kind='historical' and s.season_label='${plan.historicalSeason}' and (s.fantasy_points is distinct from p."historicalPoints"
   or s.games_played is distinct from p."historicalGames" or not s.stats @> p."historicalStats"))) then raise exception 'Season metric readback differs'; end if;
 if exists(select 1 from metric_exclusions p join public.athletes a on a.id=p.id join public.athlete_seasons m on m.athlete_id=a.id
  where m.season_id='${plan.seasonId}' and (m.directory_visible or m.draft_eligible or a.status<>'inactive' or a.fantasy_withdrawn_at is null))
  then raise exception 'Withdrawal readback differs'; end if;
end $$;
select jsonb_build_object('players',(select count(*) from metric_players),'suppliedAdp',(select count(*) from metric_players where "suppliedAdp" is not null),'heights',(select count(*) from metric_players where height is not null),'excluded',(select count(*) from metric_exclusions),'revision','${plan.revision}') as metric_publication;
commit;`;
}

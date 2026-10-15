import { normalizeHeight } from '../../packages/domain/src/player-metrics.ts';
import { rosterPlan } from './roster-materialization.mjs';
import { htmlText } from './brock-data.mjs';

export function officialHeights(html, source) {
  const heading = [...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/giu)]
    .map((match) => htmlText(match[1]))
    .find((value) => /\d{4}[-–]\d{2}.*Roster/u.test(value));
  if (!heading || !/^2026[-–]27\s/u.test(heading))
    throw new Error('Official roster season is not current.');
  const starts = [
    ...html.matchAll(
      /<li\b[^>]*class="sidearm-roster-player"[^>]*data-player-id="(\d+)"[^>]*data-player-url="([^"]+)"[^>]*>/gu,
    ),
  ];
  return starts.map((match, index) => {
    const body = html.slice(
      match.index,
      starts[index + 1]?.index ?? html.indexOf('</section>', match.index),
    );
    const field = /class="sidearm-roster-player-height"[^>]*>([\s\S]*?)<\/span>/u.exec(body)?.[1];
    const raw = htmlText(field ?? '');
    const parsed = normalizeHeight(raw);
    return {
      sourcePlayerId: match[1],
      sourceUrl: new URL(match[2], source.url).href,
      height: parsed
        ? {
            ...parsed,
            raw,
            season: '2026-27',
            retrievedAt: source.retrievedAt,
            sourceHash: source.sourceHash,
          }
        : null,
    };
  });
}

export function heightPlan(manifest, operatorId, mapping) {
  const roster = rosterPlan(manifest, operatorId);
  if (mapping.version !== 1 || mapping.season !== roster.season)
    throw new Error('Height season/version mismatch.');
  const seen = new Set();
  const heights = [];
  for (const item of mapping.heights) {
    const player = roster.players.find((candidate) => candidate.id === item.id);
    const source =
      player &&
      manifest.imports.find((candidate) => candidate.revisionHash === player.revisionHash);
    const row = source?.rows.find(
      (candidate) => candidate.rowNumber === player.rowNumber,
    )?.normalized;
    const identity = row?.identityCandidates?.length === 1 ? row.identityCandidates[0] : null;
    const url = new URL(item.height.sourceUrl);
    const parsed = normalizeHeight(item.height.raw);
    if (
      !player ||
      !identity ||
      seen.has(item.id) ||
      item.revisionHash !== player.revisionHash ||
      item.rowNumber !== player.rowNumber ||
      item.height.sourcePlayerId !== identity.sourcePlayerId ||
      item.height.sourceUrl !== identity.bioUrl ||
      url.protocol !== 'https:' ||
      url.hostname !== 'gobadgers.ca' ||
      item.height.season !== roster.season ||
      !parsed ||
      parsed.inches !== item.height.inches ||
      parsed.centimetres !== item.height.centimetres ||
      !/^[a-f0-9]{64}$/u.test(item.height.sourceHash) ||
      !Number.isFinite(Date.parse(item.height.retrievedAt))
    )
      throw new Error('Height identity/provenance mismatch.');
    seen.add(item.id);
    heights.push(item);
  }
  return { operatorId, heights, missing: mapping.missing ?? [], season: roster.season };
}

export function heightSql({ operatorId, heights, season }) {
  const payload = "'" + JSON.stringify(heights).replaceAll("'", "''") + "'::jsonb";
  return `begin;
create temp table approved_heights as select * from jsonb_to_recordset(${payload}) as x(id uuid,"revisionHash" text,"rowNumber" integer,height jsonb);
do $$ begin
 if not exists(select 1 from public.user_roles where user_id='${operatorId}'::uuid and role='admin') then raise exception 'Publishing admin required'; end if;
 if exists(select 1 from approved_heights p where not exists(select 1 from public.athletes a join public.athlete_seasons m on m.athlete_id=a.id
   where a.id=p.id and a.status='active' and m.directory_visible and a.bio->'rosterSource'->>'revisionHash'=p."revisionHash"
   and (a.bio->'rosterSource'->>'rowNumber')::integer=p."rowNumber")) then raise exception 'Canonical height mapping differs'; end if;
end $$;
with changed as (
 update public.athletes a set bio=a.bio||jsonb_build_object('height',p.height),updated_at=clock_timestamp()
 from approved_heights p where a.id=p.id and a.bio->'height' is distinct from p.height returning a.id
)
update public.player_pools p set state_version=state_version+1
where exists(select 1 from changed ch join public.athlete_seasons m on m.athlete_id=ch.id join public.pool_competitions pc on pc.competition_id=m.competition_id where pc.pool_id=p.id and m.season_id=p.season_id);
insert into public.audit_log(actor_id,action,entity_type,entity_id,after_state,request_id)
select '${operatorId}'::uuid,'heights.materialized','season','${season}',jsonb_build_object('heights',(select count(*) from approved_heights)), 'heights:'||md5(${payload}::text)
where not exists(select 1 from public.audit_log where request_id='heights:'||md5(${payload}::text));
select jsonb_build_object('heights',count(*),'changedIds',coalesce(jsonb_agg(a.id),'[]'::jsonb)) as height_publication from approved_heights p join public.athletes a on a.id=p.id and a.bio->'height'=p.height;
commit;`;
}

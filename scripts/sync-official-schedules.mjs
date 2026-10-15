import { planOfficialSchedule } from './lib/official-schedule-sync.mjs';

const base = process.env.BROCK_SCHEDULE_SUPABASE_URL?.replace(/\/$/u, '');
const key = process.env.BROCK_SCHEDULE_SERVICE_ROLE_KEY;
if (!base || !key || !/^https:\/\/[a-z0-9]+\.supabase\.co$/u.test(base))
  throw new Error('Private schedule worker configuration is missing or invalid');
if (base !== 'https://fdovowiihxowzatewxgv.supabase.co')
  throw new Error(
    'Official schedule synchronization is restricted to the approved Brock beta project',
  );
async function rest(path, body) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Schedule database request failed (${response.status})`);
  return response.json();
}
const sources = await rest('official_schedule_sources?enabled=eq.true&select=*');
if (sources.length !== 6) throw new Error('Expected approved six-program schedule sources');
let failures = 0;
for (const source of sources) {
  try {
    if (
      !/^https:\/\/gobadgers\.ca\/sports\/(?:mens|womens)-(?:ice-hockey|basketball|volleyball)\/schedule\/2026-27\?grid=true$/u.test(
        source.url,
      )
    )
      throw new Error('Unapproved official schedule URL');
    const response = await fetch(source.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { 'user-agent': 'BrockFantasy-ScheduleSync/1.0' },
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html'))
      throw new Error(`Official schedule fetch failed (${response.status})`);
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Official schedule exceeds size limit');
      }
      chunks.push(Buffer.from(value));
    }
    const existing = await rest(
      `games?competition_id=eq.${encodeURIComponent(source.competition_id)}&select=id,starts_at,status,home_team_id,away_team_id,official_schedule_key,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)&limit=1000`,
    );
    const plan = planOfficialSchedule(
      Buffer.concat(chunks).toString('utf8'),
      source,
      existing.map((game) => ({ ...game, home: game.home.name, away: game.away.name })),
    );
    const result = await rest('rpc/apply_official_schedule', {
      p_source_id: source.id,
      p_games: plan.games,
    });
    console.log(`${source.program}: ${result.changed} changes applied pending confirmation`);
    if (plan.issues.length) throw new Error(plan.issues.join('; ').slice(0, 1000));
  } catch (error) {
    failures++;
    const message = error instanceof Error ? error.message : 'Official schedule sync failed';
    await rest('rpc/apply_official_schedule', {
      p_source_id: source.id,
      p_games: [],
      p_error: message,
    });
    console.error(`${source.program}: flagged for administrator review`);
  }
}
if (failures) process.exitCode = 1;

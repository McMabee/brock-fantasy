import { randomUUID } from 'node:crypto';
import { planOfficialSchedule } from './official-schedule-sync.mjs';

// - Persist the invocation and each source outcome even when only part of a sync succeeds
export async function syncOfficialSchedules({ rest, fetcher = fetch, log = console.log }) {
  const runId = randomUUID();
  await rest('rpc/begin_schedule_sync', { p_run_id: runId });
  try {
    const sources = await rest('official_schedule_sources?enabled=eq.true&select=*');
    if (sources.length !== 6) throw new Error('Expected approved six-program schedule sources');
    let failures = 0;
    for (const source of sources) {
      const startedAt = new Date().toISOString();
      let changed = 0;
      let errorCode = 'SOURCE_FETCH_FAILED';
      try {
        if (
          !/^https:\/\/gobadgers\.ca\/sports\/(?:mens|womens)-(?:ice-hockey|basketball|volleyball)\/schedule\/2026-27\?grid=true$/u.test(
            source.url,
          )
        )
          throw new Error('Unapproved official schedule URL');
        const response = await fetcher(source.url, {
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
        errorCode = 'SOURCE_PARSE_FAILED';
        const plan = planOfficialSchedule(
          Buffer.concat(chunks).toString('utf8'),
          source,
          existing.map((game) => ({ ...game, home: game.home.name, away: game.away.name })),
        );
        errorCode = 'DATABASE_APPLY_FAILED';
        const result = await rest('rpc/apply_official_schedule', {
          p_source_id: source.id,
          p_games: plan.games,
        });
        changed = result.changed;
        log(`${source.program}: ${result.changed} changes applied pending confirmation`);
        errorCode = 'SOURCE_REVIEW_REQUIRED';
        if (plan.issues.length) throw new Error(plan.issues.join('; ').slice(0, 1000));
        await rest('rpc/record_schedule_sync', {
          p_run_id: runId,
          p_source_id: source.id,
          p_status: 'succeeded',
          p_changed: changed,
          p_started_at: startedAt,
        });
      } catch (error) {
        failures++;
        const message = error instanceof Error ? error.message : 'Official schedule sync failed';
        try {
          await rest('rpc/apply_official_schedule', {
            p_source_id: source.id,
            p_games: [],
            p_error: message,
          });
        } finally {
          await rest('rpc/record_schedule_sync', {
            p_run_id: runId,
            p_source_id: source.id,
            p_status: 'failed',
            p_changed: changed,
            p_error_code: errorCode,
            p_started_at: startedAt,
          });
        }
        log(`${source.program}: flagged for administrator review`);
      }
    }

    return { runId, failures };
  } finally {
    await rest('rpc/finish_schedule_sync', { p_run_id: runId });
  }
}

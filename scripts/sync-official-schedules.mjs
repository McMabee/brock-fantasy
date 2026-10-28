import { syncOfficialSchedules } from './lib/schedule-worker.mjs';

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
const { failures } = await syncOfficialSchedules({ rest });
if (failures) process.exitCode = 1;

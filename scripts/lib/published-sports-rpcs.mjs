const migration = '20261029153800_published_rankings_and_program_games.sql';
const reads = [
  ['get_published_preseason_ranking_seasons', {}],
  ['get_published_preseason_rankings', { p_season: null }],
  ['get_upcoming_program_games', { p_competition_ids: [] }],
];

export async function verifyPublishedSportsRpcs(config, fetchImpl = fetch) {
  const base = config.EXPO_PUBLIC_SUPABASE_URL;
  const key = config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || config.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key)
    throw new Error('Published sports checks require public Supabase configuration');
  const failures = await Promise.all(
    reads.map(async ([name, body]) => {
      // - Probe read-only RPCs without an account token or privileged credential
      // - Existing protected functions deny anonymous execution with SQLSTATE 42501
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
            method: 'POST',
            headers: { apikey: key, 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
          });
          if ((response.status >= 500 || response.status === 429) && attempt === 0) {
            await response.body?.cancel();
            continue;
          }
          const result = await response.json().catch(() => null);
          if ([401, 403].includes(response.status) && result?.code === '42501') return null;
          if (result?.code === 'PGRST202') return `${name}: missing from the REST schema cache`;
          if (response.ok) return `${name}: anonymous access must remain denied`;
          return `${name}: readiness check failed with HTTP ${response.status}`;
        } catch {
          if (attempt === 1) return `${name}: readiness request failed`;
        }
      }
      return `${name}: readiness request failed`;
    }),
  );
  const unavailable = failures.filter(Boolean);
  if (unavailable.length)
    throw new Error(
      `Published sports RPCs are not ready:\n${unavailable.join('\n')}\n` +
        `Verify deployment of ${migration} on the configured Supabase project`,
    );
  return reads.map(([name]) => name);
}

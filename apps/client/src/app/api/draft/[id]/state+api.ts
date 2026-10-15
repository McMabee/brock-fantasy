import type { RequestHandler } from 'expo-router/server';
import { legalDraftAthletes } from '@brock-fantasy/domain';
import type { DraftSnapshot } from '@/lib/draft-state';
import { AppAccessUnavailable, withAvailability } from '@/server/app-access';
import { actor, apiConfig, json } from '@/server/session';

const legality = new Map<string, readonly string[]>();
const handle: RequestHandler = async (request, params) => {
  const id = params.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id))
    return json({ error: 'Invalid draft.' }, 400);
  const current = await actor(request);
  const config = apiConfig();
  if (!current || !config) return json({ error: 'Authentication is required.' }, 401);
  const query = new URL(request.url).searchParams;
  const response = await fetch(config.url + '/rest/v1/rpc/get_draft_room_snapshot', {
    method: 'POST',
    headers: {
      apikey: config.key,
      authorization: 'Bearer ' + current.accessToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_draft_id: id,
      p_known_revision: query.get('revision'),
      p_known_pool_revision: query.get('poolRevision'),
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {
    throw new AppAccessUnavailable('Draft service unavailable.');
  });
  if ([401, 403].includes(response.status))
    return json({ error: 'Draft membership is required.' }, 403);
  if (!response.ok) throw new AppAccessUnavailable('Draft service unavailable.');
  const snapshot = (await response.json().catch(() => {
    throw new AppAccessUnavailable('Draft response unavailable.');
  })) as DraftSnapshot;
  if (!snapshot.unchanged && snapshot.draft && snapshot.myTeamId) {
    const key =
      id +
      ':' +
      snapshot.draft.state_version +
      ':' +
      snapshot.poolRevision +
      ':' +
      snapshot.myTeamId;
    let legal = legality.get(key);
    if (!legal) {
      legal = legalDraftAthletes(
        snapshot.candidates ?? [],
        snapshot.slots ?? [],
        snapshot.myTeamId,
      );
      if (legality.size >= 64) legality.delete(legality.keys().next().value!);
      legality.set(key, legal);
    }
    snapshot.legalAthleteIds = [...legal];
  }
  return json(snapshot);
};
export const GET = withAvailability(handle);

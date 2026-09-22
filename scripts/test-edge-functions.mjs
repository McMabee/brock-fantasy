import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const statusCommand =
  process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json']]
    : ['pnpm', ['exec', 'supabase', 'status', '-o', 'json']];
const status = JSON.parse(
  execFileSync(statusCommand[0], statusCommand[1], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
);
const email = `edge-smoke-${Date.now()}@example.test`;
const password = `LocalOnly-${crypto.randomUUID()}!`;
const runLabel = Date.now().toString(36);
const provider = `edge-smoke-${runLabel}`;
const rulesetId = crypto.randomUUID();
const competitionId = crypto.randomUUID();
const homeTeamId = crypto.randomUUID();
const awayTeamId = crypto.randomUUID();
const athleteId = crypto.randomUUID();
const gameId = crypto.randomUUID();
const leagueId = crypto.randomUUID();
const fantasyTeamId = crypto.randomUUID();
const opposingFantasyTeamId = crypto.randomUUID();
const serviceHeaders = {
  apikey: status.SERVICE_ROLE_KEY,
  authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
};
const anonHeaders = {
  apikey: status.ANON_KEY,
  authorization: `Bearer ${status.ANON_KEY}`,
  'content-type': 'application/json',
};
let userId;

try {
  const createUser = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Edge Smoke Admin' },
    }),
  });
  const created = await expectJson(createUser, 200, 'create local smoke user');
  userId = created.id;
  if (typeof userId !== 'string') throw new Error('Local auth did not return a user id.');

  const grantRole = await fetch(`${status.REST_URL}/user_roles`, {
    method: 'POST',
    headers: { ...serviceHeaders, prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, role: 'admin' }),
  });
  await expectStatus(grantRole, 201, 'grant local admin role');

  const login = await fetch(`${status.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: anonHeaders,
    body: JSON.stringify({ email, password }),
  });
  const session = await expectJson(login, 200, 'authenticate local smoke user');
  if (typeof session.access_token !== 'string')
    throw new Error('Local auth returned no access token.');
  let userHeaders = {
    apikey: status.ANON_KEY,
    authorization: `Bearer ${session.access_token}`,
    'content-type': 'application/json',
  };

  const preMfaAdmin = await fetch(`${status.FUNCTIONS_URL}/ingest-sports-data`, {
    method: 'POST',
    headers: userHeaders,
    body: '{}',
  });
  await expectStatus(preMfaAdmin, 403, 'block administrator without AAL2');

  const enrollment = await fetch(`${status.API_URL}/auth/v1/factors`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ factor_type: 'totp', friendly_name: 'Edge smoke authenticator' }),
  });
  const enrolled = await expectJson(enrollment, 200, 'enroll local TOTP factor');
  if (typeof enrolled.id !== 'string' || typeof enrolled.totp?.secret !== 'string') {
    throw new Error('Local TOTP enrollment returned no factor or secret.');
  }
  const challengeResponse = await fetch(
    `${status.API_URL}/auth/v1/factors/${enrolled.id}/challenge`,
    { method: 'POST', headers: userHeaders, body: '{}' },
  );
  const challenge = await expectJson(challengeResponse, 200, 'create local TOTP challenge');
  const verification = await fetch(`${status.API_URL}/auth/v1/factors/${enrolled.id}/verify`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ challenge_id: challenge.id, code: totp(enrolled.totp.secret) }),
  });
  const verified = await expectJson(verification, 200, 'verify local TOTP challenge');
  if (typeof verified.access_token !== 'string') {
    throw new Error('Local TOTP verification returned no AAL2 access token.');
  }
  userHeaders = {
    ...userHeaders,
    authorization: `Bearer ${verified.access_token}`,
  };

  const now = new Date();
  const gameStart = new Date(now.getTime() + 60 * 60_000);
  await insertRows('scoring_rulesets', {
    id: rulesetId,
    sport: 'hockey',
    name: `Edge Smoke ${runLabel}`,
    version: 1,
    status: 'approved',
    draft_config: { pickSeconds: 30, autopickStrategy: 'queued_then_ranked_legal' },
    transaction_config: {},
    matchup_config: { periodDays: 7, tiesAllowed: true, tiebreaker: 'points_for' },
    approved_by: userId,
    approved_at: now.toISOString(),
  });
  await insertRows('scoring_rules', [
    { ruleset_id: rulesetId, stat_key: 'goals', label: 'Goals', points: 3, sort_order: 1 },
    { ruleset_id: rulesetId, stat_key: 'assists', label: 'Assists', points: 2, sort_order: 2 },
    { ruleset_id: rulesetId, stat_key: 'shots', label: 'Shots', points: 0.5, sort_order: 3 },
  ]);
  await insertRows('roster_slot_rules', {
    ruleset_id: rulesetId,
    slot_code: 'F1',
    label: 'Forward',
    allowed_positions: ['F'],
    slot_count: 1,
    is_starter: true,
  });
  await insertRows('competitions', {
    id: competitionId,
    sport_id: '00000000-0000-4000-8000-000000000001',
    division: 'mens',
    name: `Edge Hockey ${runLabel}`,
    season_label: `smoke-${runLabel}`,
    ruleset_id: rulesetId,
    is_active: true,
  });
  await insertRows('teams', [
    {
      id: homeTeamId,
      competition_id: competitionId,
      name: 'Edge Brock',
      short_name: 'BRO',
      is_brock: true,
    },
    {
      id: awayTeamId,
      competition_id: competitionId,
      name: 'Edge Opponent',
      short_name: 'OPP',
      is_brock: false,
    },
  ]);
  await insertRows('athletes', {
    id: athleteId,
    competition_id: competitionId,
    team_id: homeTeamId,
    display_name: 'Synthetic Athlete A',
    position: 'F',
  });
  await insertRows('games', {
    id: gameId,
    competition_id: competitionId,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    starts_at: gameStart.toISOString(),
    status: 'scheduled',
  });
  const baseFixture = JSON.parse(
    await readFile(new URL('../supabase/fixtures/hockey_game_001.json', import.meta.url), 'utf8'),
  );
  const correctedFixture = JSON.parse(
    await readFile(
      new URL('../supabase/fixtures/hockey_game_001.corrected.json', import.meta.url),
      'utf8',
    ),
  );
  for (const fixture of [baseFixture, correctedFixture]) {
    fixture.provider = provider;
    fixture.providerGameId = `game-${runLabel}`;
    fixture.players[0].providerAthleteId = `athlete-${runLabel}`;
    fixture.raw.runLabel = runLabel;
  }
  await insertRows('provider_entity_mappings', [
    {
      provider,
      entity_type: 'game',
      provider_entity_id: baseFixture.providerGameId,
      internal_entity_id: gameId,
      verified_at: now.toISOString(),
      verified_by: userId,
    },
    {
      provider,
      entity_type: 'athlete',
      provider_entity_id: baseFixture.players[0].providerAthleteId,
      internal_entity_id: athleteId,
      verified_at: now.toISOString(),
      verified_by: userId,
    },
  ]);
  await insertRows('leagues', {
    id: leagueId,
    competition_id: competitionId,
    commissioner_id: userId,
    ruleset_id: rulesetId,
    name: `Edge League ${runLabel}`,
    format: 'head_to_head',
    status: 'active',
    invite_code: `EDGE${runLabel}`,
  });
  await insertRows('league_members', {
    league_id: leagueId,
    user_id: userId,
    role: 'commissioner',
  });
  await insertRows('fantasy_teams', [
    {
      id: fantasyTeamId,
      league_id: leagueId,
      owner_id: userId,
      name: 'Edge Scorers',
      draft_position: 1,
      waiver_priority: 1,
    },
    {
      id: opposingFantasyTeamId,
      league_id: leagueId,
      owner_id: null,
      name: 'Edge Opponents',
      draft_position: 2,
      waiver_priority: 2,
    },
  ]);
  await insertRows('roster_entries', {
    league_id: leagueId,
    fantasy_team_id: fantasyTeamId,
    athlete_id: athleteId,
    slot_code: 'F1',
    status: 'starter',
    acquisition_type: 'commissioner',
  });
  await insertRows('lineup_entries', {
    league_id: leagueId,
    fantasy_team_id: fantasyTeamId,
    game_id: gameId,
    athlete_id: athleteId,
    slot_code: 'F1',
    locked_at: gameStart.toISOString(),
  });
  await insertRows('matchups', {
    league_id: leagueId,
    period: 1,
    starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    home_team_id: fantasyTeamId,
    away_team_id: opposingFantasyTeamId,
    status: 'active',
  });

  const ingest = await fetch(`${status.FUNCTIONS_URL}/ingest-sports-data`, {
    method: 'POST',
    headers: userHeaders,
    body: '{}',
  });
  await expectStatus(ingest, 422, 'reject malformed ingestion payload');

  const rejectedReceipt = await fetch(
    `${status.REST_URL}/provider_raw_receipts?validation_status=eq.rejected&select=id&limit=1`,
    { headers: serviceHeaders },
  );
  const receipts = await expectJson(rejectedReceipt, 200, 'read immutable rejected receipt');
  if (!Array.isArray(receipts) || receipts.length !== 1) {
    throw new Error('Malformed payload was not retained as a rejected raw receipt.');
  }

  const pauseIngestion = await fetch(`${status.REST_URL}/rpc/set_competition_ingestion_status`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
      p_competition_id: competitionId,
      p_paused: true,
      p_reason: 'Edge smoke provider outage',
      p_idempotency_key: `pause-${runLabel}`,
    }),
  });
  await expectStatus(pauseIngestion, 200, 'pause competition ingestion');
  const heldIngest = await fetch(`${status.FUNCTIONS_URL}/ingest-sports-data`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify(baseFixture),
  });
  await expectStatus(heldIngest, 423, 'hold fixture while competition ingestion is paused');
  const heldReceipts = await readRows(
    `provider_raw_receipts?source_hint=eq.${provider}&validation_status=eq.held&select=id`,
  );
  if (heldReceipts.length !== 1) {
    throw new Error('Paused ingestion did not preserve one held raw receipt.');
  }
  const resumeIngestion = await fetch(`${status.REST_URL}/rpc/set_competition_ingestion_status`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
      p_competition_id: competitionId,
      p_paused: false,
      p_reason: 'Edge smoke provider restored',
      p_idempotency_key: `resume-${runLabel}`,
    }),
  });
  await expectStatus(resumeIngestion, 200, 'resume competition ingestion');

  const firstIngest = await fetch(`${status.FUNCTIONS_URL}/ingest-sports-data`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify(baseFixture),
  });
  await expectStatus(firstIngest, 200, 'score approved hockey fixture');
  await expectPoints(10.5, 'initial hockey scoring');

  const correction = await fetch(`${status.FUNCTIONS_URL}/ingest-sports-data`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify(correctedFixture),
  });
  await expectStatus(correction, 200, 'apply provider correction');
  await expectPoints(9.5, 'corrected hockey scoring');

  const duplicate = await fetch(`${status.FUNCTIONS_URL}/ingest-sports-data`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify(correctedFixture),
  });
  const duplicateResult = await expectJson(duplicate, 200, 'replay duplicate provider revision');
  if (duplicateResult?.ignored !== true) {
    throw new Error('Duplicate provider revision was not reported as ignored.');
  }
  await expectPoints(9.5, 'idempotent corrected hockey scoring');

  const revisionConflict = structuredClone(correctedFixture);
  revisionConflict.players[0].stats.goals = 7;
  revisionConflict.raw.reusedRevision = true;
  const conflict = await fetch(`${status.FUNCTIONS_URL}/ingest-sports-data`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify(revisionConflict),
  });
  await expectStatus(conflict, 409, 'reject reused revision with changed payload');
  await expectPoints(9.5, 'rejected revision conflict');

  const revisions = await readRows(
    `stat_revisions?game_id=eq.${gameId}&athlete_id=eq.${athleteId}&select=id`,
  );
  if (revisions.length !== 1) throw new Error('Provider correction did not create one revision.');

  const push = await fetch(`${status.FUNCTIONS_URL}/dispatch-push-notifications`, {
    method: 'POST',
    headers: userHeaders,
    body: '{}',
  });
  await expectStatus(push, 200, 'dispatch empty notification queue');

  const deletion = await fetch(`${status.FUNCTIONS_URL}/delete-account`, {
    method: 'POST',
    headers: userHeaders,
    body: '{}',
  });
  await expectStatus(deletion, 204, 'delete local smoke account');
  userId = undefined;

  process.stdout.write(
    'Edge smoke passed: auth/admin, ingestion pause/hold/resume, fixture scoring/correction, push, deletion.\n',
  );
} finally {
  await deleteRows('leagues', `id=eq.${leagueId}`);
  await deleteRows('provider_entity_mappings', `provider=eq.${provider}`);
  await deleteRows('competitions', `id=eq.${competitionId}`);
  await deleteRows('scoring_rulesets', `id=eq.${rulesetId}`);
  await deleteRows('provider_raw_receipts', `source_hint=eq.${provider}`);
  if (userId) {
    await fetch(`${status.API_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    });
  }
}

async function expectJson(response, expectedStatus, action) {
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${action} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function expectStatus(response, expectedStatus, action) {
  if (response.status === expectedStatus) return;
  const text = await response.text();
  throw new Error(`${action} returned ${response.status}: ${text.slice(0, 300)}`);
}

async function insertRows(table, rows) {
  const response = await fetch(`${status.REST_URL}/${table}`, {
    method: 'POST',
    headers: { ...serviceHeaders, prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  await expectStatus(response, 201, `insert ${table}`);
}

async function readRows(query) {
  const response = await fetch(`${status.REST_URL}/${query}`, { headers: serviceHeaders });
  const rows = await expectJson(response, 200, `read ${query.split('?')[0]}`);
  if (!Array.isArray(rows)) throw new Error(`Expected a row array from ${query.split('?')[0]}.`);
  return rows;
}

async function deleteRows(table, filter) {
  const response = await fetch(`${status.REST_URL}/${table}?${filter}`, {
    method: 'DELETE',
    headers: serviceHeaders,
  });
  if (!response.ok) {
    process.stderr.write(`Cleanup warning: ${table} returned ${response.status}.\n`);
  }
}

async function expectPoints(expected, action) {
  const events = await readRows(
    `fantasy_point_events?fantasy_team_id=eq.${fantasyTeamId}&game_id=eq.${gameId}&select=points`,
  );
  const total = events.reduce((sum, event) => sum + Number(event.points), 0);
  if (Math.abs(total - expected) > 0.0001) {
    throw new Error(`${action} expected ${expected} points but found ${total}.`);
  }
  const matchups = await readRows(
    `matchups?league_id=eq.${leagueId}&period=eq.1&select=home_points`,
  );
  if (matchups.length !== 1 || Math.abs(Number(matchups[0].home_points) - expected) > 0.0001) {
    throw new Error(`${action} did not update the matchup total to ${expected}.`);
  }
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.replace(/=+$/u, '').toUpperCase()) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('TOTP enrollment returned an invalid base32 secret.');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    1_000_000;
  return value.toString().padStart(6, '0');
}

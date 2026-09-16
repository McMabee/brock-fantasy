import { z } from 'npm:zod@4.6.5';

import { AccessError, authenticatedAdmin, serviceClient } from '../_shared/clients.ts';
import { corsHeaders } from '../_shared/cors.ts';

const schema = z.object({
  provider: z.string().min(1),
  providerGameId: z.string().min(1),
  revision: z.string().min(1).optional(),
  capturedAt: z.iso.datetime({ offset: true }),
  gameStatus: z.enum(['scheduled', 'in_progress', 'final', 'postponed', 'cancelled']),
  players: z.array(
    z.object({
      providerAthleteId: z.string().min(1),
      athleteName: z.string().min(1),
      teamProviderId: z.string().min(1),
      position: z.string().optional(),
      stats: z.record(z.string(), z.number().finite()),
    }),
  ),
  raw: z.unknown(),
});

const encoder = new TextEncoder();

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(stableStringify(value)));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request.headers.get('origin'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST')
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });

  const db = serviceClient();
  let runId: string | null = null;
  let rawReceiptId: string | null = null;
  try {
    const user = await authenticatedAdmin(request.headers.get('authorization'));
    const requestPayload: unknown = await request.json();
    const receiptHash = await sha256(requestPayload);
    const sourceHint =
      requestPayload !== null &&
      typeof requestPayload === 'object' &&
      'provider' in requestPayload &&
      typeof requestPayload.provider === 'string'
        ? requestPayload.provider
        : null;
    const rawReceipt = await db
      .from('provider_raw_receipts')
      .upsert(
        { source_hint: sourceHint, payload: requestPayload, payload_hash: receiptHash },
        { onConflict: 'payload_hash', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle();
    if (rawReceipt.error) throw rawReceipt.error;
    if (rawReceipt.data) rawReceiptId = rawReceipt.data.id as string;
    else {
      const existingReceipt = await db
        .from('provider_raw_receipts')
        .select('id')
        .eq('payload_hash', receiptHash)
        .single();
      if (existingReceipt.error) throw existingReceipt.error;
      rawReceiptId = existingReceipt.data.id as string;
    }

    const snapshot = schema.parse(requestPayload);
    const payloadHash = receiptHash;
    const sourceIdentity = `${snapshot.provider}:${snapshot.providerGameId}:${snapshot.revision ?? payloadHash}`;

    const { data: mapping } = await db
      .from('provider_entity_mappings')
      .select('internal_entity_id')
      .eq('provider', snapshot.provider)
      .eq('entity_type', 'game')
      .eq('provider_entity_id', snapshot.providerGameId)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (!mapping) {
      await db
        .from('provider_raw_receipts')
        .update({ validation_status: 'rejected', validation_error: 'Game mapping not found' })
        .eq('id', rawReceiptId);
      return Response.json({ error: 'Game mapping not found' }, { status: 422, headers });
    }
    const gameId = mapping.internal_entity_id as string;
    const { data: game, error: gameError } = await db
      .from('games')
      .select('competition_id')
      .eq('id', gameId)
      .single();
    if (gameError) throw gameError;
    const { data: existing } = await db
      .from('provider_snapshots')
      .select('id, processed_at, payload_hash')
      .eq('source_identity', sourceIdentity)
      .maybeSingle();
    if (existing && existing.payload_hash !== payloadHash) {
      await db
        .from('provider_raw_receipts')
        .update({
          validation_status: 'rejected',
          validation_error: 'Provider revision was reused with a different payload.',
        })
        .eq('id', rawReceiptId);
      return Response.json(
        { error: 'Provider revision was reused with a different payload.' },
        { status: 409, headers },
      );
    }
    if (existing?.processed_at) {
      await db
        .from('provider_raw_receipts')
        .update({
          validation_status: 'accepted',
          validation_error: null,
          provider_snapshot_id: existing.id,
        })
        .eq('id', rawReceiptId);
      return Response.json(
        { sourceIdentity, ignored: true, processedAt: existing.processed_at },
        { headers },
      );
    }

    const { data: run, error: runError } = await db
      .from('sync_runs')
      .insert({
        provider: snapshot.provider,
        competition_id: game.competition_id,
        status: 'running',
      })
      .select('id')
      .single();
    if (runError) throw runError;
    runId = run.id as string;
    let stored: { id: string };
    if (existing) {
      stored = { id: existing.id as string };
    } else {
      const snapshotInsert = await db
        .from('provider_snapshots')
        .upsert(
          {
            provider: snapshot.provider,
            game_id: gameId,
            source_identity: sourceIdentity,
            provider_revision: snapshot.revision,
            game_status: snapshot.gameStatus,
            captured_at: snapshot.capturedAt,
            payload: snapshot,
            payload_hash: payloadHash,
          },
          { onConflict: 'source_identity', ignoreDuplicates: true },
        )
        .select('id')
        .maybeSingle();
      if (snapshotInsert.error) throw snapshotInsert.error;
      if (snapshotInsert.data) {
        stored = { id: snapshotInsert.data.id as string };
      } else {
        const racedSnapshot = await db
          .from('provider_snapshots')
          .select('id, payload_hash')
          .eq('source_identity', sourceIdentity)
          .single();
        if (racedSnapshot.error) throw racedSnapshot.error;
        if (racedSnapshot.data.payload_hash !== payloadHash)
          throw new Error('Provider revision was reused with a different payload.');
        stored = { id: racedSnapshot.data.id as string };
      }
    }
    await db
      .from('provider_raw_receipts')
      .update({
        validation_status: 'accepted',
        validation_error: null,
        provider_snapshot_id: stored.id,
      })
      .eq('id', rawReceiptId);

    const providerAthleteIds = snapshot.players.map((player) => player.providerAthleteId);
    const { data: mappings, error: mappingError } = await db
      .from('provider_entity_mappings')
      .select('provider_entity_id, internal_entity_id')
      .eq('provider', snapshot.provider)
      .eq('entity_type', 'athlete')
      .not('verified_at', 'is', null)
      .in('provider_entity_id', providerAthleteIds);
    if (mappingError) throw mappingError;
    const athleteMap = new Map(
      (mappings ?? []).map((item) => [
        item.provider_entity_id as string,
        item.internal_entity_id as string,
      ]),
    );
    const { data: mappedAthletes, error: athleteError } = await db
      .from('athletes')
      .select('id, competition_id')
      .in('id', [...athleteMap.values()]);
    if (athleteError) throw athleteError;
    const eligibleAthleteIds = new Set(
      (mappedAthletes ?? [])
        .filter((athlete) => athlete.competition_id === game.competition_id)
        .map((athlete) => athlete.id as string),
    );
    const { data: competition, error: competitionError } = await db
      .from('competitions')
      .select('ruleset_id')
      .eq('id', game.competition_id)
      .single();
    if (competitionError) throw competitionError;
    const { data: scoringRules, error: scoringRulesError } = await db
      .from('scoring_rules')
      .select('stat_key')
      .eq('ruleset_id', competition.ruleset_id);
    if (scoringRulesError) throw scoringRulesError;
    const requiredStats = (scoringRules ?? []).map((rule) => rule.stat_key as string);
    let updated = 0;
    let errors = 0;
    for (const player of snapshot.players) {
      const athleteId = athleteMap.get(player.providerAthleteId);
      if (!athleteId || !eligibleAthleteIds.has(athleteId)) {
        errors += 1;
        await db.from('sync_errors').insert({
          sync_run_id: run.id,
          provider_snapshot_id: stored.id,
          error_code: 'UNMAPPED_ATHLETE',
          message: `No competition-eligible mapping for provider athlete ${player.providerAthleteId}`,
          context: {
            providerAthleteId: player.providerAthleteId,
            athleteName: player.athleteName,
          },
        });
        continue;
      }
      const missingStats = requiredStats.filter((statKey) => !(statKey in player.stats));
      if (missingStats.length > 0) {
        errors += 1;
        await db.from('sync_errors').insert({
          sync_run_id: run.id,
          provider_snapshot_id: stored.id,
          error_code: 'INCOMPLETE_STAT_LINE',
          message: `Missing required statistics for provider athlete ${player.providerAthleteId}`,
          context: { providerAthleteId: player.providerAthleteId, missingStats },
        });
        continue;
      }
      const { data: previous } = await db
        .from('normalized_player_game_stats')
        .select('stats')
        .eq('game_id', gameId)
        .eq('athlete_id', athleteId)
        .maybeSingle();
      if (previous && stableStringify(previous.stats) !== stableStringify(player.stats)) {
        const { error: revisionError } = await db.from('stat_revisions').upsert(
          {
            game_id: gameId,
            athlete_id: athleteId,
            source_identity: sourceIdentity,
            previous_stats: previous.stats,
            corrected_stats: player.stats,
          },
          { onConflict: 'game_id,athlete_id,source_identity', ignoreDuplicates: true },
        );
        if (revisionError) throw revisionError;
      }
      const { error: statError } = await db.from('normalized_player_game_stats').upsert({
        game_id: gameId,
        athlete_id: athleteId,
        source_identity: sourceIdentity,
        stats: player.stats,
        updated_at: new Date().toISOString(),
      });
      if (statError) throw statError;
      updated += 1;
    }

    await db.from('games').update({ status: snapshot.gameStatus }).eq('id', gameId);
    const { data: replay, error: replayError } = await db.rpc('replay_game', {
      p_game_id: gameId,
      p_source_identity: sourceIdentity,
    });
    if (replayError) throw replayError;
    if (errors > 0) {
      await db.from('provider_snapshots').update({ processed_at: null }).eq('id', stored.id);
    }
    await db
      .from('sync_runs')
      .update({
        status: errors ? 'partial' : 'succeeded',
        finished_at: new Date().toISOString(),
        updated_count: updated,
        ignored_count: errors,
      })
      .eq('id', run.id);
    return Response.json({ sourceIdentity, updated, errors, replay }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ingestion failure';
    if (rawReceiptId) {
      await db
        .from('provider_raw_receipts')
        .update({ validation_status: 'rejected', validation_error: message.slice(0, 1_000) })
        .eq('id', rawReceiptId)
        .eq('validation_status', 'received');
    }
    if (runId) {
      await db
        .from('sync_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          metadata: { error: message },
        })
        .eq('id', runId);
    }
    return Response.json(
      { error: message },
      {
        status:
          error instanceof z.ZodError ? 422 : error instanceof AccessError ? error.status : 500,
        headers,
      },
    );
  }
});

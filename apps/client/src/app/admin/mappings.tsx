import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createHeading, useAppTheme, useThemedStyles, type ThemeColors } from '@/theme';

interface MappingReviewRow {
  id: string;
  provider: string;
  entityType: string;
  providerEntityId: string;
  internalEntityId: string;
  targetLabel: string;
  verifiedAt: string | null;
}

interface SyncErrorRow {
  id: string;
  errorCode: string;
  message: string;
  context: Record<string, unknown>;
  createdAt: string;
}

interface MappingRecord {
  id: string;
  provider: string;
  entity_type: string;
  provider_entity_id: string;
  internal_entity_id: string;
  verified_at: string | null;
}

interface ErrorRecord {
  id: string;
  error_code: string;
  message: string;
  context: Record<string, unknown>;
  created_at: string;
}

const demoMappings: MappingReviewRow[] = [
  {
    id: 'demo-map-1',
    provider: 'approved-provider',
    entityType: 'athlete',
    providerEntityId: 'player-19842',
    internalEntityId: 'demo-athlete-1',
    targetLabel: 'Avery Campbell · F',
    verifiedAt: null,
  },
  {
    id: 'demo-map-2',
    provider: 'approved-provider',
    entityType: 'game',
    providerEntityId: 'game-2026-009',
    internalEntityId: 'demo-game-1',
    targetLabel: 'Brock vs. Toronto · Oct 9',
    verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

const demoErrors: SyncErrorRow[] = [
  {
    id: 'demo-error-1',
    errorCode: 'UNMAPPED_ATHLETE',
    message: 'No competition-eligible mapping for provider athlete player-19842',
    context: { providerAthleteId: 'player-19842', athleteName: 'Avery Campbell' },
    createdAt: new Date(Date.now() - 480_000).toISOString(),
  },
  {
    id: 'demo-error-2',
    errorCode: 'INCOMPLETE_STAT_LINE',
    message: 'Missing required statistics for provider athlete player-20301',
    context: { providerAthleteId: 'player-20301', missingStats: ['shots'] },
    createdAt: new Date(Date.now() - 840_000).toISOString(),
  },
];

export default function AdminMappingsScreen() {
  useRequireAdmin();
  const { demoMode, user } = useSession();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const [mappings, setMappings] = useState<MappingReviewRow[]>(demoMode ? demoMappings : []);
  const [syncErrors, setSyncErrors] = useState<SyncErrorRow[]>(demoMode ? demoErrors : []);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [resolutionReasons, setResolutionReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!demoMode);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) {
      setMappings(demoMappings);
      setSyncErrors(demoErrors);
      setLoading(false);
      return;
    }
    if (!supabase || !user) return;
    const client = supabase;
    const load = async () => {
      const [mappingResult, errorResult, competitionResult, teamResult, athleteResult, gameResult] =
        await Promise.all([
          client
            .from('provider_entity_mappings')
            .select(
              'id, provider, entity_type, provider_entity_id, internal_entity_id, verified_at',
            )
            .order('verified_at', { ascending: true, nullsFirst: true })
            .limit(50),
          client
            .from('sync_errors')
            .select('id, error_code, message, context, created_at')
            .is('resolved_at', null)
            .order('created_at', { ascending: false })
            .limit(50),
          client.from('competitions').select('id, name'),
          client.from('teams').select('id, name'),
          client.from('athletes').select('id, display_name, position'),
          client.from('games').select('id, starts_at'),
        ]);
      setLoading(false);
      const loadError =
        mappingResult.error ??
        errorResult.error ??
        competitionResult.error ??
        teamResult.error ??
        athleteResult.error ??
        gameResult.error;
      if (loadError) {
        setError(loadError.message);
        return;
      }
      const targetLabels = new Map<string, string>();
      for (const item of competitionResult.data as { id: string; name: string }[]) {
        targetLabels.set(item.id, item.name);
      }
      for (const item of teamResult.data as { id: string; name: string }[]) {
        targetLabels.set(item.id, item.name);
      }
      for (const item of athleteResult.data as {
        id: string;
        display_name: string;
        position: string;
      }[]) {
        targetLabels.set(item.id, `${item.display_name} · ${item.position}`);
      }
      for (const item of gameResult.data as { id: string; starts_at: string }[]) {
        targetLabels.set(item.id, `Game · ${formatTimestamp(item.starts_at)}`);
      }
      setMappings(
        (mappingResult.data as MappingRecord[]).map((item) => ({
          id: item.id,
          provider: item.provider,
          entityType: item.entity_type,
          providerEntityId: item.provider_entity_id,
          internalEntityId: item.internal_entity_id,
          targetLabel: targetLabels.get(item.internal_entity_id) ?? 'Missing internal target',
          verifiedAt: item.verified_at,
        })),
      );
      setSyncErrors(
        (errorResult.data as ErrorRecord[]).map((item) => ({
          id: item.id,
          errorCode: item.error_code,
          message: item.message,
          context: item.context,
          createdAt: item.created_at,
        })),
      );
    };
    void load();
  }, [demoMode, user]);

  const reviewMapping = async (mapping: MappingReviewRow, verified: boolean) => {
    const reason = reviewReasons[mapping.id]?.trim() ?? '';
    setMessage(null);
    setError(null);
    if (!validReason(reason)) {
      setError('Enter a mapping review reason between 8 and 500 characters.');
      return;
    }
    setWorkingKey(`mapping-${mapping.id}`);
    if (!demoMode && supabase) {
      const result = await supabase.rpc('review_provider_mapping', {
        p_mapping_id: mapping.id,
        p_verified: verified,
        p_reason: reason,
        p_idempotency_key: `mapping-review-${Date.now()}`,
      });
      if (result.error) {
        setWorkingKey(null);
        setError(result.error.message);
        return;
      }
    }
    setMappings((current) =>
      current.map((item) =>
        item.id === mapping.id
          ? { ...item, verifiedAt: verified ? new Date().toISOString() : null }
          : item,
      ),
    );
    setReviewReasons((current) => ({ ...current, [mapping.id]: '' }));
    setWorkingKey(null);
    setMessage(`Mapping ${verified ? 'verified' : 'reopened'} for review.`);
  };

  const resolveError = async (syncError: SyncErrorRow) => {
    const reason = resolutionReasons[syncError.id]?.trim() ?? '';
    setMessage(null);
    setError(null);
    if (!validReason(reason)) {
      setError('Enter an error resolution reason between 8 and 500 characters.');
      return;
    }
    setWorkingKey(`error-${syncError.id}`);
    if (!demoMode && supabase) {
      const result = await supabase.rpc('resolve_sync_error', {
        p_sync_error_id: syncError.id,
        p_reason: reason,
        p_idempotency_key: `sync-resolution-${Date.now()}`,
      });
      if (result.error) {
        setWorkingKey(null);
        setError(result.error.message);
        return;
      }
    }
    setSyncErrors((current) => current.filter((item) => item.id !== syncError.id));
    setResolutionReasons((current) => ({ ...current, [syncError.id]: '' }));
    setWorkingKey(null);
    setMessage(`${syncError.errorCode} marked resolved.`);
  };

  return (
    <AppShell
      eyebrow="Restricted data operations"
      title="Provider mappings"
      action={<Pill label="ADMIN · MFA REQUIRED" tone="warning" />}
    >
      <Card style={styles.summary}>
        <Text style={styles.summaryTitle}>Review before replay</Text>
        <Text style={uiStyles.body}>
          Verify that every provider identity points to the intended internal competition, team,
          athlete, or game. Unmapped-athlete errors cannot be resolved until their provider identity
          has a verified mapping. Re-submit the held or partial snapshot after resolving its errors.
        </Text>
        <View style={styles.summaryActions}>
          <ActionButton label="Back to operations" href="/admin" variant="ghost" />
          <ActionButton
            label="Import corrected snapshot"
            href="/admin/import"
            variant="secondary"
          />
        </View>
      </Card>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" style={styles.success}>
          {message}
        </Text>
      ) : null}

      <SectionTitle
        title="Identity review"
        detail={`${mappings.filter((item) => !item.verifiedAt).length} awaiting verification`}
      />
      {!loading && mappings.length === 0 ? (
        <EmptyState
          title="No provider mappings"
          body="Mappings appear here after an approved provider roster or schedule sync."
        />
      ) : null}
      <View style={styles.list}>
        {mappings.map((mapping) => (
          <Card key={mapping.id} style={styles.itemCard}>
            <View style={styles.headingRow}>
              <View style={styles.headingCopy}>
                <Text style={styles.itemTitle}>{mapping.targetLabel}</Text>
                <Text style={styles.itemMeta}>
                  {mapping.provider} · {mapping.entityType}
                </Text>
              </View>
              <Pill
                label={mapping.verifiedAt ? 'VERIFIED' : 'REVIEW REQUIRED'}
                tone={mapping.verifiedAt ? 'positive' : 'warning'}
              />
            </View>
            <View style={styles.identityPair}>
              <View style={styles.identityColumn}>
                <Text style={styles.identityLabel}>PROVIDER ID</Text>
                <Text selectable style={styles.identityValue}>
                  {mapping.providerEntityId}
                </Text>
              </View>
              <View style={styles.identityColumn}>
                <Text style={styles.identityLabel}>INTERNAL ID</Text>
                <Text selectable style={styles.identityValue}>
                  {mapping.internalEntityId}
                </Text>
              </View>
            </View>
            <TextInput
              accessibilityLabel={`${mapping.provider} ${mapping.entityType} ${mapping.providerEntityId} review reason`}
              maxLength={500}
              multiline
              onChangeText={(value) =>
                setReviewReasons((current) => ({ ...current, [mapping.id]: value }))
              }
              placeholder={
                mapping.verifiedAt
                  ? 'Reason to reopen this mapping'
                  : 'Verification evidence or reason'
              }
              placeholderTextColor={colors.muted}
              style={[uiStyles.input, styles.reasonInput]}
              value={reviewReasons[mapping.id] ?? ''}
            />
            <View style={styles.actions}>
              <ActionButton
                label={mapping.verifiedAt ? 'Reopen mapping' : 'Verify mapping'}
                loading={workingKey === `mapping-${mapping.id}`}
                onPress={() => void reviewMapping(mapping, !mapping.verifiedAt)}
                variant={mapping.verifiedAt ? 'danger' : 'primary'}
              />
            </View>
          </Card>
        ))}
      </View>

      <SectionTitle title="Unresolved ingestion errors" detail={`${syncErrors.length} open`} />
      {!loading && syncErrors.length === 0 ? (
        <EmptyState
          title="No unresolved ingestion errors"
          body="New mapping and schema exceptions will appear here for administrator review."
        />
      ) : null}
      <View style={styles.list}>
        {syncErrors.map((syncError) => (
          <Card key={syncError.id} style={styles.itemCard}>
            <View style={styles.headingRow}>
              <View style={styles.headingCopy}>
                <Text style={styles.errorCode}>{syncError.errorCode}</Text>
                <Text style={styles.errorMessage}>{syncError.message}</Text>
              </View>
              <Text style={styles.itemMeta}>{formatTimestamp(syncError.createdAt)}</Text>
            </View>
            <Text selectable style={styles.context}>
              {formatContext(syncError.context)}
            </Text>
            <TextInput
              accessibilityLabel={`${syncError.errorCode} ${syncError.id} resolution reason`}
              maxLength={500}
              multiline
              onChangeText={(value) =>
                setResolutionReasons((current) => ({ ...current, [syncError.id]: value }))
              }
              placeholder="Resolution evidence or reason"
              placeholderTextColor={colors.muted}
              style={[uiStyles.input, styles.reasonInput]}
              value={resolutionReasons[syncError.id] ?? ''}
            />
            <View style={styles.actions}>
              <ActionButton
                label="Mark resolved"
                loading={workingKey === `error-${syncError.id}`}
                onPress={() => void resolveError(syncError)}
                variant="secondary"
              />
            </View>
          </Card>
        ))}
      </View>
    </AppShell>
  );
}

function validReason(value: string) {
  return value.length >= 8 && value.length <= 500;
}

function formatContext(context: Record<string, unknown>) {
  return Object.entries(context)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ');
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    summary: { gap: 10 },
    summaryTitle: { ...createHeading(colors), fontSize: 18 },
    summaryActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
    list: { gap: 14 },
    itemCard: { gap: 14 },
    headingRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    headingCopy: { flex: 1, minWidth: 220 },
    itemTitle: { ...createHeading(colors), fontSize: 17 },
    itemMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
    identityPair: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    identityColumn: {
      backgroundColor: colors.canvasSoft,
      borderRadius: 10,
      flex: 1,
      minWidth: 240,
      padding: 12,
    },
    identityLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
    identityValue: { color: colors.text, fontFamily: 'monospace', fontSize: 11, marginTop: 5 },
    reasonInput: { minHeight: 72, paddingTop: 13, textAlignVertical: 'top' },
    actions: { flexDirection: 'row', justifyContent: 'flex-end' },
    errorCode: { color: colors.danger, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
    errorMessage: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 5 },
    context: {
      backgroundColor: colors.canvasSoft,
      borderRadius: 10,
      color: colors.muted,
      fontFamily: 'monospace',
      fontSize: 10,
      lineHeight: 16,
      padding: 12,
    },
    error: { color: colors.danger, fontWeight: '700', marginTop: 14 },
    success: { color: colors.brand, fontWeight: '700', marginTop: 14 },
  });

const useStyles = () => useThemedStyles(createStyles);

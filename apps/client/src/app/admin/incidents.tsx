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

interface CompetitionIncidentRow {
  id: string;
  name: string;
  division: string;
  seasonLabel: string;
  ingestionPaused: boolean;
  ingestionPauseReason: string | null;
  ingestionPausedAt: string | null;
}

interface CompetitionRow {
  id: string;
  name: string;
  division: string;
  season_label: string;
}

interface IncidentControlRow {
  competition_id: string;
  ingestion_paused: boolean;
  ingestion_pause_reason: string | null;
  ingestion_paused_at: string | null;
}

const demoCompetitions: CompetitionIncidentRow[] = [
  "Men's Hockey",
  "Women's Hockey",
  "Men's Basketball",
  "Women's Basketball",
  "Men's Volleyball",
  "Women's Volleyball",
].map((name, index) => ({
  id: `demo-competition-${index + 1}`,
  name,
  division: name.startsWith("Men's") ? 'mens' : 'womens',
  seasonLabel: '2026–27',
  ingestionPaused: false,
  ingestionPauseReason: null,
  ingestionPausedAt: null,
}));

export default function AdminIncidentsScreen() {
  useRequireAdmin();
  const { demoMode, user } = useSession();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const [competitions, setCompetitions] = useState<CompetitionIncidentRow[]>(
    demoMode ? demoCompetitions : [],
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) {
      setCompetitions(demoCompetitions);
      setLoading(false);
      return;
    }
    if (!supabase || !user) return;
    const client = supabase;
    const load = async () => {
      const [competitionResult, controlResult] = await Promise.all([
        client.from('competitions').select('id, name, division, season_label').order('name'),
        client
          .from('competition_ingestion_controls')
          .select('competition_id, ingestion_paused, ingestion_pause_reason, ingestion_paused_at'),
      ]);
      setLoading(false);
      const loadError = competitionResult.error ?? controlResult.error;
      if (loadError) {
        setError(loadError.message);
        return;
      }
      const controls = new Map(
        (controlResult.data as IncidentControlRow[]).map((control) => [
          control.competition_id,
          control,
        ]),
      );
      setCompetitions(
        (competitionResult.data as CompetitionRow[]).map((row) => {
          const control = controls.get(row.id);
          return {
            id: row.id,
            name: row.name,
            division: row.division,
            seasonLabel: row.season_label,
            ingestionPaused: control?.ingestion_paused ?? false,
            ingestionPauseReason: control?.ingestion_pause_reason ?? null,
            ingestionPausedAt: control?.ingestion_paused_at ?? null,
          };
        }),
      );
    };
    void load();
  }, [demoMode, user]);

  const changeStatus = async (competition: CompetitionIncidentRow, paused: boolean) => {
    const reason = reasons[competition.id]?.trim() ?? '';
    setMessage(null);
    setError(null);
    if (reason.length < 8 || reason.length > 500) {
      setError('Enter an incident or resolution reason between 8 and 500 characters.');
      return;
    }

    setWorkingId(competition.id);
    const changedAt = new Date().toISOString();
    if (!demoMode && supabase) {
      const result = await supabase.rpc('set_competition_ingestion_status', {
        p_competition_id: competition.id,
        p_paused: paused,
        p_reason: reason,
        p_idempotency_key: `competition-ingestion-${Date.now()}`,
      });
      if (result.error) {
        setWorkingId(null);
        setError(result.error.message);
        return;
      }
    }

    setCompetitions((current) =>
      current.map((row) =>
        row.id === competition.id
          ? {
              ...row,
              ingestionPaused: paused,
              ingestionPauseReason: paused ? reason : null,
              ingestionPausedAt: paused ? changedAt : null,
            }
          : row,
      ),
    );
    setReasons((current) => ({ ...current, [competition.id]: '' }));
    setWorkingId(null);
    setMessage(`${competition.name} ingestion ${paused ? 'paused' : 'resumed'}.`);
  };

  return (
    <AppShell
      eyebrow="Restricted incident control"
      title="Competition ingestion"
      action={<Pill label="ADMIN · MFA REQUIRED" tone="warning" />}
    >
      <Card style={styles.summary}>
        <Text style={styles.summaryTitle}>Preserve first, then pause</Text>
        <Text style={uiStyles.body}>
          Pausing stops normalization and scoring for only the selected competition. Incoming valid
          payloads remain as held raw receipts and can be submitted again after the incident is
          resolved. Every state change requires a reason and is written to the audit log.
        </Text>
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
        title="Competition controls"
        detail={`${competitions.filter((item) => item.ingestionPaused).length} paused`}
      />
      {!loading && competitions.length === 0 ? (
        <EmptyState
          title="No competitions configured"
          body="Load approved competition records before configuring incident controls."
        />
      ) : null}
      <View style={styles.list}>
        {competitions.map((competition) => (
          <Card key={competition.id} style={styles.competition}>
            <View style={styles.headingRow}>
              <View style={styles.headingCopy}>
                <Text style={styles.competitionName}>{competition.name}</Text>
                <Text style={styles.competitionMeta}>
                  {formatDivision(competition.division)} · {competition.seasonLabel}
                </Text>
              </View>
              <Pill
                label={competition.ingestionPaused ? 'PAUSED' : 'INGESTING'}
                tone={competition.ingestionPaused ? 'warning' : 'positive'}
              />
            </View>

            {competition.ingestionPaused ? (
              <View style={styles.pauseDetail}>
                <Text style={styles.pauseLabel}>ACTIVE INCIDENT</Text>
                <Text style={styles.pauseReason}>{competition.ingestionPauseReason}</Text>
                <Text style={styles.pauseTime}>
                  Paused {formatTimestamp(competition.ingestionPausedAt)}
                </Text>
              </View>
            ) : null}

            <TextInput
              accessibilityLabel={`${competition.name} ${competition.ingestionPaused ? 'resolution' : 'incident'} reason`}
              maxLength={500}
              multiline
              onChangeText={(value) =>
                setReasons((current) => ({ ...current, [competition.id]: value }))
              }
              placeholder={
                competition.ingestionPaused
                  ? 'Resolution note (minimum 8 characters)'
                  : 'Incident reason (minimum 8 characters)'
              }
              placeholderTextColor={colors.muted}
              style={[uiStyles.input, styles.reasonInput]}
              value={reasons[competition.id] ?? ''}
            />
            <View style={styles.actions}>
              <ActionButton label="Back to operations" href="/admin" variant="ghost" />
              <ActionButton
                label={competition.ingestionPaused ? 'Resume ingestion' : 'Pause ingestion'}
                loading={workingId === competition.id}
                onPress={() => void changeStatus(competition, !competition.ingestionPaused)}
                variant={competition.ingestionPaused ? 'secondary' : 'danger'}
              />
            </View>
          </Card>
        ))}
      </View>
    </AppShell>
  );
}

function formatDivision(value: string) {
  if (value === 'mens') return "Men's";
  if (value === 'womens') return "Women's";
  return 'Open';
}

function formatTimestamp(value: string | null) {
  if (!value) return 'just now';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    summary: { maxWidth: 850, gap: 8 },
    summaryTitle: { ...createHeading(colors), fontSize: 18 },
    list: { gap: 14 },
    competition: { gap: 14 },
    headingRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    headingCopy: { flex: 1, minWidth: 220 },
    competitionName: { ...createHeading(colors), fontSize: 18 },
    competitionMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
    pauseDetail: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.dangerBorder,
      borderRadius: 10,
      borderWidth: 1,
      gap: 5,
      padding: 12,
    },
    pauseLabel: { color: colors.danger, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
    pauseReason: { color: colors.dangerText, fontSize: 13, fontWeight: '700' },
    pauseTime: { color: colors.muted, fontSize: 10 },
    reasonInput: { minHeight: 76, paddingTop: 13, textAlignVertical: 'top' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
    error: { color: colors.danger, fontWeight: '700', marginTop: 14 },
    success: { color: colors.brand, fontWeight: '700', marginTop: 14 },
  });

const useStyles = () => useThemedStyles(createStyles);

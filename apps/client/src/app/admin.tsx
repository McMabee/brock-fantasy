import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { createHeading, useThemedStyles, type ThemeColors } from '@/theme';
import { useOperations } from '@/hooks/use-operations';
import { useRequireAdmin } from '@/hooks/use-route-access';

export default function AdminScreen() {
  useRequireAdmin();
  const operations = useOperations();
  const { width } = useWindowDimensions();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const wide = width >= 850;
  return (
    <AppShell
      eyebrow="Restricted"
      title="Operations centre"
      action={<Pill label="ADMIN · MFA REQUIRED" tone="warning" />}
    >
      <View style={styles.metrics}>
        <Metric
          value={String(operations.competitionCount)}
          label="Competitions"
          detail="Configured"
        />
        <Metric
          value={
            operations.syncRows[0]?.finishedAt
              ? relativeTime(operations.syncRows[0].finishedAt)
              : '—'
          }
          label="Latest sync"
          detail={operations.syncRows[0]?.provider ?? 'No completed run'}
        />
        <Metric
          value={String(operations.unresolvedErrors)}
          label="Ingestion alerts"
          detail="Needs review"
          warning={operations.unresolvedErrors > 0}
        />
        <Metric
          value={String(operations.syncRows.filter((row) => row.status === 'failed').length)}
          label="Failed recent runs"
          detail="Latest 12 runs"
        />
      </View>

      {operations.error ? (
        <EmptyState title="Operations data unavailable" body={operations.error} />
      ) : null}

      <View style={[styles.grid, wide && styles.gridWide]}>
        <View style={styles.main}>
          <SectionTitle title="Sports data health" detail="Provider and fixture ingestion" />
          <Card style={styles.tableCard}>
            {operations.syncRows.map((row) => (
              <View key={row.id} style={styles.syncRow}>
                <View style={styles.syncCopy}>
                  <Text style={styles.syncName}>{row.provider}</Text>
                  <Text style={styles.syncMeta}>
                    Finished {row.finishedAt ? relativeTime(row.finishedAt) : 'not yet'} ·{' '}
                    {row.changed} changed
                  </Text>
                </View>
                <Pill
                  label={row.status}
                  tone={row.status === 'succeeded' ? 'positive' : 'warning'}
                />
              </View>
            ))}
            {!operations.loading && operations.syncRows.length === 0 ? (
              <Text style={uiStyles.body}>No ingestion runs have been recorded.</Text>
            ) : null}
          </Card>

          <SectionTitle title="Recent audit events" />
          <Card>
            {operations.auditEvents.map((event) => (
              <View key={event.id} style={styles.auditRow}>
                <Text style={styles.auditKind}>{event.action.toUpperCase()}</Text>
                <View style={styles.auditCopy}>
                  <Text style={styles.auditDetail}>
                    {event.entityType} · {event.entityId}
                  </Text>
                  <Text style={styles.auditActor}>{relativeTime(event.createdAt)}</Text>
                </View>
              </View>
            ))}
            {!operations.loading && operations.auditEvents.length === 0 ? (
              <Text style={uiStyles.body}>No audit events have been recorded.</Text>
            ) : null}
          </Card>
        </View>

        <View style={styles.side}>
          <SectionTitle title="Actions" />
          <Card style={styles.actions}>
            <Text style={styles.actionTitle}>Ingestion and scoring</Text>
            <Text style={uiStyles.body}>
              Imports are immutable and replay through the same normalization pipeline as provider
              data.
            </Text>
            <ActionButton label="Import provider snapshot" href="/admin/import" />
            <ActionButton label="Review mappings" href="/admin/mappings" variant="secondary" />
            <ActionButton label="Preview score replay" disabled variant="secondary" />
          </Card>
          <Card style={styles.incident}>
            <Text style={styles.incidentLabel}>INCIDENT CONTROL</Text>
            <Text style={styles.incidentTitle}>Scoring pause</Text>
            <Text style={styles.incidentBody}>
              Pause only the affected competition while preserving raw provider inputs.
            </Text>
            <ActionButton label="Open incident workflow" href="/admin/incidents" variant="danger" />
          </Card>
        </View>
      </View>
    </AppShell>
  );
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function Metric({
  value,
  label,
  detail,
  warning = false,
}: {
  value: string;
  label: string;
  detail: string;
  warning?: boolean;
}) {
  const styles = useStyles();
  return (
    <Card style={styles.metric}>
      <Text style={[styles.metricValue, warning && styles.metricWarning]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </Card>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    metric: { flex: 1, minWidth: 190 },
    metricValue: { color: colors.brand, fontSize: 29, fontWeight: '900' },
    metricWarning: { color: colors.accent },
    metricLabel: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 5 },
    metricDetail: { color: colors.muted, fontSize: 9, marginTop: 3 },
    grid: { gap: 18 },
    gridWide: { flexDirection: 'row', alignItems: 'flex-start' },
    main: { flex: 1.65, minWidth: 0 },
    side: { flex: 0.8, minWidth: 280 },
    tableCard: { paddingVertical: 4 },
    syncRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    syncCopy: { flex: 1, minWidth: 180 },
    syncName: { color: colors.text, fontSize: 12, fontWeight: '800' },
    syncMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
    auditRow: {
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 13,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    auditKind: { color: colors.brand, fontSize: 8, fontWeight: '900', width: 105 },
    auditCopy: { flex: 1 },
    auditDetail: { color: colors.text, fontSize: 11, fontWeight: '700' },
    auditActor: { color: colors.muted, fontSize: 9, marginTop: 4 },
    actions: { gap: 11 },
    actionTitle: { ...createHeading(colors), fontSize: 17 },
    incident: {
      marginTop: 14,
      backgroundColor: colors.dangerSurface,
      borderColor: colors.dangerBorder,
      gap: 8,
    },
    incidentLabel: { color: colors.danger, fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
    incidentTitle: { ...createHeading(colors), fontSize: 17 },
    incidentBody: { color: colors.dangerText, fontSize: 11, lineHeight: 17, marginBottom: 7 },
  });

const useStyles = () => useThemedStyles(createStyles);

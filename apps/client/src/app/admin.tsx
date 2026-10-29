import { AuditEventList } from '@/components/admin-operations';
import { useResponsiveDimensions as useWindowDimensions } from '@/hooks/use-responsive-dimensions';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Href } from 'expo-router';

import { ActionButton, AppShell, Card, EmptyState, Pill, useUiStyles } from '@/components/ui';
import { PressableLink } from '@/components/pressable-link';
import { heading } from '@/theme';
import { useOperations } from '@/hooks/use-operations';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { AdminAccess } from '@/components/admin-access';
import { useAdminAccountManager } from '@/hooks/use-admin-account-manager';
import { useAdminLeagueRead } from '@/hooks/use-admin-leagues';
import type { AdminLeagueSummary } from '@/lib/admin-leagues';

export default function AdminScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const access = useRequireAdmin();
  const canManageAccounts = useAdminAccountManager(access.allowed);
  const operations = useOperations(access.allowed);
  const leagues = useAdminLeagueRead<AdminLeagueSummary>(
    'admin_get_league_summary',
    {},
    access.allowed,
  );
  const { width } = useWindowDimensions();
  const wide = width >= 1280;
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Restricted" title="Operations centre">
      <View style={styles.content}>
        <View style={styles.metrics}>
          <PressableLink
            href="/admin/leagues"
            accessibilityRole="link"
            accessibilityLabel="Leagues registered, view league directory"
            style={{ flex: 1, minWidth: 190 }}
          >
            <Metric
              value={leagues.data ? String(leagues.data.openCount) : '—'}
              label="Leagues registered"
              detail={
                leagues.error
                  ? 'Unavailable · View leagues'
                  : leagues.loading && !leagues.data
                    ? 'Loading leagues…'
                    : `Open leagues · ${leagues.data?.currentSeasonLabel ?? 'No current season'}`
              }
            />
          </PressableLink>
          <Metric
            value={
              operations.latestSync?.finishedAt
                ? relativeTime(operations.latestSync.finishedAt)
                : '—'
            }
            href={{
              pathname: '/admin/syncs',
              params: { kind: operations.latestSync?.jobKind ?? 'player' },
            }}
            label="Latest sync"
            detail={
              operations.latestSync?.provider ??
              (operations.available
                ? 'No completed run'
                : operations.error
                  ? 'Unavailable'
                  : 'Loading…')
            }
          />
          <Metric
            value={operations.available ? String(operations.unresolvedErrors) : '—'}
            href="/admin/alerts"
            label="Ingestion alerts"
            detail={
              operations.available ? 'Needs review' : operations.error ? 'Unavailable' : 'Loading…'
            }
            warning={operations.unresolvedErrors > 0}
          />
          <Metric
            value={
              operations.available
                ? String(operations.syncRows.filter((row) => row.status === 'failed').length)
                : '—'
            }
            href={{
              pathname: '/admin/syncs',
              params: {
                status: 'failed',
                kind:
                  operations.syncRows.find((row) => row.status === 'failed')?.jobKind ?? 'player',
              },
            }}
            label="Failed recent runs"
            detail={
              operations.available
                ? 'Latest 12 runs'
                : operations.error
                  ? 'Unavailable'
                  : 'Loading…'
            }
          />
        </View>

        {operations.error ? (
          <EmptyState title="Operations data unavailable" body={operations.error} />
        ) : null}

        <View style={[styles.grid, wide && styles.gridWide]}>
          <View style={styles.main}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Sports data health
            </Text>
            <Card style={styles.tableCard}>
              {operations.syncRows.map((row) => (
                <View key={row.id} style={styles.syncRow}>
                  <View style={styles.syncCopy}>
                    <Text style={styles.syncName}>{row.provider}</Text>
                    <Text style={styles.syncMeta}>
                      Finished {row.finishedAt ? relativeTime(row.finishedAt) : 'not yet'},{' '}
                      {row.changed} changed
                    </Text>
                  </View>
                  <Pill
                    label={row.status}
                    tone={row.status === 'succeeded' ? 'positive' : 'warning'}
                  />
                </View>
              ))}
              {operations.available && !operations.loading && operations.syncRows.length === 0 ? (
                <Text style={uiStyles.body}>No ingestion runs have been recorded.</Text>
              ) : null}
            </Card>

            <Text accessibilityRole="header" style={[styles.sectionTitle, { marginTop: 10 }]}>
              Recent audit events
            </Text>
            <Card>
              <ScrollView style={{ maxHeight: 420 }} accessibilityLabel="40 recent audit events">
                <AuditEventList events={operations.auditEvents} />
                <ActionButton label="Show all" href="/admin/audit" variant="secondary" />
              </ScrollView>
              {operations.available &&
              !operations.loading &&
              operations.auditEvents.length === 0 ? (
                <Text style={uiStyles.body}>No audit events have been recorded.</Text>
              ) : null}
            </Card>
          </View>

          <View style={styles.side}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Actions
            </Text>
            <Card style={styles.actions}>
              <View style={styles.actionGroup}>
                <Text accessibilityRole="header" style={styles.actionTitle}>
                  Varsity participants
                </Text>
                <ActionButton
                  label="Varsity participant accounts"
                  href="/admin/participants"
                  variant="secondary"
                />
              </View>
              <View style={styles.actionGroup}>
                <Text accessibilityRole="header" style={styles.actionTitle}>
                  Game scores and player statistics
                </Text>
                <ActionButton label="Update game scores and stats" href="/admin/games" />
                <ActionButton
                  label="Schedule confirmations, overrides & projection alerts"
                  href="/admin/schedules"
                  variant="secondary"
                />
                <ActionButton
                  label="Review historical game logs"
                  href="/admin/history"
                  variant="secondary"
                />
                <ActionButton
                  label="Review preseason rankings"
                  href="/admin/rankings"
                  variant="secondary"
                />
              </View>
              <View style={styles.actionGroup}>
                <Text accessibilityRole="header" style={styles.actionTitle}>
                  Advanced tools
                </Text>
                <ActionButton
                  label="Import provider snapshot"
                  href="/admin/import"
                  variant="secondary"
                />
                {canManageAccounts ? (
                  <ActionButton
                    label="Administrator invitations"
                    href="/admin/accounts"
                    variant="secondary"
                  />
                ) : null}
              </View>
            </Card>
          </View>
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
  href,
}: {
  value: string;
  label: string;
  detail: string;
  warning?: boolean;
  href?: Href;
}) {
  const styles = useThemedStyles(createStyles);
  const card = (
    <Card style={styles.metric}>
      <Text style={[styles.metricValue, warning && styles.metricWarning]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </Card>
  );
  return href ? (
    <PressableLink
      href={href}
      accessibilityRole="link"
      accessibilityLabel={`View ${label}`}
      style={{ flex: 1, minWidth: 190 }}
    >
      {card}
    </PressableLink>
  ) : (
    card
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    content: { gap: 24 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    metric: { flex: 1, minWidth: 190 },
    metricValue: { fontFamily: 'Inter', color: colors.text, fontSize: 29, fontWeight: '900' },
    metricWarning: { color: colors.accent },
    metricLabel: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 12,
      fontWeight: '800',
      marginTop: 5,
    },
    metricDetail: { fontFamily: 'Inter', color: colors.muted, fontSize: 9, marginTop: 3 },
    grid: { gap: 24 },
    gridWide: { flexDirection: 'row', alignItems: 'flex-start' },
    main: { flex: 1.65, minWidth: 0, gap: 14 },
    side: { flex: 0.8, minWidth: 280, gap: 14 },
    sectionTitle: { ...heading, fontSize: 22, color: colors.text },
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
    syncName: { fontFamily: 'Inter', color: colors.text, fontSize: 12, fontWeight: '800' },
    syncMeta: { fontFamily: 'Inter', color: colors.muted, fontSize: 9, marginTop: 3 },
    auditRow: {
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 13,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    auditKind: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 8,
      fontWeight: '900',
      width: 105,
    },
    auditCopy: { flex: 1 },
    auditDetail: { fontFamily: 'Inter', color: colors.text, fontSize: 11, fontWeight: '700' },
    auditActor: { fontFamily: 'Inter', color: colors.muted, fontSize: 9, marginTop: 4 },
    actions: { gap: 24 },
    actionGroup: { gap: 12 },
    actionTitle: {
      ...heading,
      fontSize: 22,
      color: colors.text,
      paddingBottom: 10,
      borderBottomWidth: 2,
      borderBottomColor: colors.red,
    },
    incident: {
      marginTop: 14,
      backgroundColor: colors.canvasSoft,
      borderColor: colors.red,
      gap: 8,
    },
    incidentLabel: {
      fontFamily: 'Inter',
      color: colors.danger,
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 1.5,
    },
    incidentTitle: { ...heading, fontSize: 17, color: colors.text },
    incidentBody: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 11,
      lineHeight: 17,
      marginBottom: 7,
    },
  });

import { buildSnakeOrder } from '@brock-fantasy/domain';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, useUiStyles } from '@/components/ui';
import { useDraft } from '@/hooks/use-draft';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createHeading, radii, useAppTheme, useThemedStyles, type ThemeColors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

const PICK_SECONDS = 30;

export default function DraftRoomScreen() {
  useRequireUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { demoMode } = useSession();
  const draftData = useDraft(id);
  const { width } = useWindowDimensions();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const [demoPickedIds, setDemoPickedIds] = useState<string[]>([]);
  const [remaining, setRemaining] = useState(PICK_SECONDS);
  const [queuedIds, setQueuedIds] = useState<readonly string[]>(draftData.queuedAthleteIds);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickedIds = demoMode ? demoPickedIds : draftData.picks.map((pick) => pick.athleteId);
  const teamIds = draftData.draft?.teamIdsInDraftOrder ?? [];
  const order = useMemo(
    () => (teamIds.length >= 2 ? buildSnakeOrder(teamIds, draftData.draft?.rounds ?? 1) : []),
    [draftData.draft?.rounds, teamIds],
  );
  const pickIndex = demoMode
    ? demoPickedIds.length
    : Math.max(0, (draftData.draft?.currentOverallPick ?? 1) - 1);
  const currentTeamId = order[pickIndex];
  const currentTeam = draftData.teams.find((team) => team.id === currentTeamId);
  const available = draftData.athletes
    .filter(
      (athlete) =>
        !pickedIds.includes(athlete.id) &&
        `${athlete.displayName} ${athlete.position}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (left, right) =>
        (draftData.rankings.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (draftData.rankings.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.displayName.localeCompare(right.displayName),
    );
  const wide = width >= 880;
  const mayPick = demoMode || currentTeamId === draftData.myTeamId;

  const commitPick = async (athleteId: string) => {
    if (submitting || pickedIds.includes(athleteId) || !currentTeamId) return;
    if (!mayPick) {
      setError('Another manager is on the clock. Draft state will update automatically.');
      return;
    }
    setSubmitting(athleteId);
    setError(null);
    if (supabase) {
      const result = (await supabase.rpc('make_draft_pick', {
        p_draft_id: id ?? 'demo-draft',
        p_athlete_id: athleteId,
        p_idempotency_key: `pick-${Date.now()}-${athleteId}`,
        p_source: 'manager',
      })) as { error: { message: string } | null };
      if (result.error) {
        setError(result.error.message);
        setSubmitting(null);
        return;
      }
      await draftData.reload();
    } else {
      setDemoPickedIds((current) => [...current, athleteId]);
      setRemaining(PICK_SECONDS);
    }
    setSubmitting(null);
  };

  const toggleQueue = async (athleteId: string) => {
    const next = queuedIds.includes(athleteId)
      ? queuedIds.filter((idInQueue) => idInQueue !== athleteId)
      : [...queuedIds, athleteId];
    setQueuedIds(next);
    if (!supabase || !id) return;
    const result = (await supabase.rpc('set_draft_queue', {
      p_draft_id: id,
      p_athlete_ids: next,
      p_idempotency_key: `queue-${Date.now()}`,
    })) as { error: { message: string } | null };
    if (result.error) {
      setQueuedIds(queuedIds);
      setError(result.error.message);
    }
  };

  useEffect(() => {
    setQueuedIds(draftData.queuedAthleteIds);
  }, [draftData.queuedAthleteIds]);

  useEffect(() => {
    if (!demoMode || !currentTeamId || submitting) return;
    const timer = setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [currentTeamId, demoMode, submitting]);

  useEffect(() => {
    if (demoMode || !draftData.draft?.pickDeadline) return;
    const updateClock = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil((Date.parse(draftData.draft?.pickDeadline ?? '') - Date.now()) / 1000),
        ),
      );
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, [demoMode, draftData.draft?.pickDeadline]);

  useEffect(() => {
    if (!demoMode || remaining !== 0 || submitting) return;
    const autopick = draftData.athletes.find((athlete) => !pickedIds.includes(athlete.id));
    if (autopick) void commitPick(autopick.id);
  }, [demoMode, draftData.athletes, pickedIds, remaining, submitting]);

  const round = teamIds.length > 0 ? Math.floor(pickIndex / teamIds.length) + 1 : 1;

  return (
    <AppShell>
      <View style={styles.draftHeader}>
        <View>
          <Pill label={`SNAKE DRAFT · ROUND ${round}`} tone="positive" />
          <Text accessibilityRole="header" style={styles.title}>
            {draftData.leagueName ? `${draftData.leagueName} Draft` : 'Loading draft…'}
          </Text>
          <Text style={styles.subtitle}>
            Pick {Math.min(pickIndex + 1, order.length)} of {order.length} · Server-authoritative
          </Text>
        </View>
        <View style={styles.clock}>
          <Text style={styles.clockLabel}>ON THE CLOCK</Text>
          <Text accessibilityLiveRegion="polite" style={styles.clockValue}>
            0:{String(remaining).padStart(2, '0')}
          </Text>
          <Text style={styles.clockTeam}>{currentTeam?.name ?? 'Draft complete'}</Text>
        </View>
      </View>

      <View style={styles.orderStrip}>
        {order.slice(pickIndex, pickIndex + 5).map((teamId, index) => (
          <View
            key={`${pickIndex}-${teamId}-${index}`}
            style={[styles.orderPick, index === 0 && styles.orderPickActive]}
          >
            <Text style={styles.orderNumber}>{pickIndex + index + 1}</Text>
            <Text numberOfLines={1} style={styles.orderTeam}>
              {draftData.teams.find((team) => team.id === teamId)?.name}
            </Text>
          </View>
        ))}
      </View>

      {draftData.error || error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {draftData.error ?? error}
        </Text>
      ) : null}
      <View style={[styles.draftGrid, wide && styles.draftGridWide]}>
        <Card style={styles.playerPanel}>
          <View style={styles.playerHeader}>
            <View>
              <Text style={styles.panelTitle}>Available athletes</Text>
              <Text style={styles.panelMeta}>{available.length} available</Text>
            </View>
            <TextInput
              accessibilityLabel="Search athletes"
              onChangeText={setQuery}
              placeholder="Search player or position"
              placeholderTextColor={colors.muted}
              style={[uiStyles.input, styles.search]}
              value={query}
            />
          </View>
          <View style={styles.tableHead}>
            <Text style={styles.playerCell}>ATHLETE</Text>
            <Text style={styles.positionCell}>POS</Text>
            <Text style={styles.rankCell}>RANK</Text>
            <Text style={styles.actionCell}>ACTION</Text>
          </View>
          {available.map((athlete) => (
            <View key={athlete.id} style={styles.playerRow}>
              <View style={styles.playerIdentity}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {athlete.displayName
                      .split(' ')
                      .map((part) => part[0])
                      .join('')}
                  </Text>
                </View>
                <View>
                  <Text style={styles.playerName}>{athlete.displayName}</Text>
                  <Text style={styles.playerMeta}>Brock · #{athlete.jerseyNumber}</Text>
                </View>
              </View>
              <Text style={styles.positionValue}>{athlete.position}</Text>
              <Text style={styles.rankValue}>{draftData.rankings.get(athlete.id) ?? '—'}</Text>
              <View style={styles.playerActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${queuedIds.includes(athlete.id) ? 'Remove' : 'Add'} ${athlete.displayName} ${queuedIds.includes(athlete.id) ? 'from' : 'to'} queue`}
                  disabled={Boolean(submitting)}
                  onPress={() => void toggleQueue(athlete.id)}
                  style={({ pressed }) => [
                    styles.queueButton,
                    pressed && styles.draftButtonPressed,
                  ]}
                >
                  <Text style={styles.queueButtonText}>
                    {queuedIds.includes(athlete.id) ? 'QUEUED' : '+ QUEUE'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Draft ${athlete.displayName}`}
                  disabled={Boolean(submitting) || !mayPick}
                  onPress={() => void commitPick(athlete.id)}
                  style={({ pressed }) => [
                    styles.draftButton,
                    pressed && styles.draftButtonPressed,
                    !mayPick && styles.draftButtonDisabled,
                  ]}
                >
                  <Text style={styles.draftButtonText}>
                    {submitting === athlete.id ? '…' : mayPick ? 'DRAFT' : 'WAIT'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </Card>

        <View style={styles.sidePanel}>
          <Card>
            <Text style={styles.panelTitle}>Your queue</Text>
            <Text style={styles.panelMeta}>Autopick uses queue, then ranked legal athlete.</Text>
            {queuedIds.map((athleteId, index) => {
              const athlete = draftData.athletes.find((item) => item.id === athleteId);
              return (
                <View key={athleteId} style={styles.queueRow}>
                  <Text style={styles.queueNumber}>{index + 1}</Text>
                  <Text style={styles.queueName}>
                    {athlete?.displayName ?? 'Unavailable athlete'}
                  </Text>
                  <Text style={styles.queuePosition}>{athlete?.position ?? '—'}</Text>
                </View>
              );
            })}
            {queuedIds.length === 0 ? <Text style={styles.empty}>Your queue is empty.</Text> : null}
          </Card>
          <Card>
            <Text style={styles.panelTitle}>Recent picks</Text>
            {pickedIds.length === 0 ? (
              <Text style={styles.empty}>No picks committed yet.</Text>
            ) : (
              pickedIds
                .slice(-5)
                .reverse()
                .map((athleteId, index) => {
                  const athlete = draftData.athletes.find((item) => item.id === athleteId);
                  return (
                    <View key={`${athleteId}-${index}`} style={styles.queueRow}>
                      <Text style={styles.queueNumber}>{pickedIds.length - index}</Text>
                      <Text style={styles.queueName}>{athlete?.displayName}</Text>
                      <Pill label="COMMITTED" tone="positive" />
                    </View>
                  );
                })
            )}
          </Card>
          <ActionButton
            label="Return to league"
            href={`/league/${draftData.draft?.leagueId ?? 'demo-league'}`}
            variant="secondary"
          />
        </View>
      </View>
    </AppShell>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    draftHeader: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 20,
      paddingTop: 20,
    },
    title: { ...createHeading(colors), fontSize: 33, marginTop: 10 },
    subtitle: { color: colors.muted, fontSize: 12, marginTop: 6 },
    clock: {
      alignItems: 'center',
      backgroundColor: colors.panel,
      borderColor: colors.brand,
      borderWidth: 1,
      borderRadius: radii.md,
      paddingHorizontal: 22,
      paddingVertical: 13,
      minWidth: 170,
    },
    clockLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
    clockValue: {
      color: colors.brand,
      fontSize: 30,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    },
    clockTeam: { color: colors.text, fontSize: 10, fontWeight: '700', marginTop: 2 },
    orderStrip: {
      flexDirection: 'row',
      overflow: 'hidden',
      marginVertical: 20,
      borderRadius: radii.sm,
      borderColor: colors.border,
      borderWidth: 1,
    },
    orderPick: {
      flex: 1,
      minWidth: 130,
      padding: 11,
      backgroundColor: colors.canvasSoft,
      borderRightColor: colors.border,
      borderRightWidth: 1,
    },
    orderPickActive: { backgroundColor: colors.selected },
    orderNumber: { color: colors.brand, fontSize: 9, fontWeight: '900' },
    orderTeam: { color: colors.text, fontSize: 10, fontWeight: '700', marginTop: 3 },
    draftGrid: { gap: 16 },
    draftGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
    playerPanel: { flex: 1.7, padding: 0, overflow: 'hidden' },
    playerHeader: {
      padding: 17,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    panelTitle: { ...createHeading(colors), fontSize: 17 },
    panelMeta: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
    search: { minHeight: 40, width: 230, maxWidth: '100%', fontSize: 12 },
    tableHead: { flexDirection: 'row', backgroundColor: colors.canvasSoft, padding: 10 },
    playerCell: { color: colors.muted, fontSize: 8, fontWeight: '900', flex: 1 },
    positionCell: {
      color: colors.muted,
      fontSize: 8,
      fontWeight: '900',
      width: 45,
      textAlign: 'center',
    },
    rankCell: {
      color: colors.muted,
      fontSize: 8,
      fontWeight: '900',
      width: 45,
      textAlign: 'center',
    },
    actionCell: {
      color: colors.muted,
      fontSize: 8,
      fontWeight: '900',
      width: 142,
      textAlign: 'center',
    },
    playerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 11,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    playerIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
    avatar: {
      width: 35,
      height: 35,
      borderRadius: 11,
      backgroundColor: colors.panelStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.brand, fontSize: 9, fontWeight: '900' },
    playerName: { color: colors.text, fontSize: 12, fontWeight: '800' },
    playerMeta: { color: colors.muted, fontSize: 9, marginTop: 2 },
    positionValue: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '800',
      width: 45,
      textAlign: 'center',
    },
    rankValue: { color: colors.muted, fontSize: 11, width: 45, textAlign: 'center' },
    playerActions: { width: 142, flexDirection: 'row', gap: 5, justifyContent: 'flex-end' },
    draftButton: {
      width: 65,
      backgroundColor: colors.brand,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    draftButtonPressed: { opacity: 0.7 },
    draftButtonDisabled: { opacity: 0.45 },
    draftButtonText: { color: colors.onBrand, fontSize: 9, fontWeight: '900' },
    queueButton: {
      minWidth: 67,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 7,
      paddingVertical: 8,
      alignItems: 'center',
    },
    queueButtonText: { color: colors.text, fontSize: 8, fontWeight: '900' },
    sidePanel: { flex: 0.8, minWidth: 280, gap: 14 },
    queueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 11,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    queueNumber: { color: colors.brand, fontSize: 9, fontWeight: '900', width: 18 },
    queueName: { color: colors.text, fontSize: 11, fontWeight: '700', flex: 1 },
    queuePosition: { color: colors.muted, fontSize: 10 },
    empty: { color: colors.muted, fontSize: 11, paddingVertical: 18 },
    error: { color: colors.danger, fontSize: 12, marginBottom: 10 },
  });

const useStyles = () => useThemedStyles(createStyles);

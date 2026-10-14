import {
  BETA_SEASON,
  buildSnakeOrder,
  formatDraftClock,
  previewDraftQueue,
} from '@brock-fantasy/domain';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActionButton, AppShell, Card, Pill, uiStyles } from '@/components/ui';
import { DraftChat } from '@/components/draft-chat';
import { DraftPlayerPanel, DraftPlayerPhoto } from '@/components/draft-player-panel';
import { useDraft } from '@/hooks/use-draft';
import { useDraftQueue } from '@/hooks/use-draft-queue';
import { useTurnAlert } from '@/hooks/use-turn-alert';
import { useRequireUser } from '@/hooks/use-route-access';
import { betaCommand } from '@/lib/web-api';
import type { DraftPlayer } from '@/lib/draft-state';
import { colors, heading } from '@/theme';

type Tab = 'available' | 'roster' | 'queue' | 'chat';
export default function DraftRoomScreen() {
  useRequireUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useDraft(id);
  const { width, height } = useWindowDimensions();
  const wide = width >= 1000;
  const [tab, setTab] = useState<Tab>('available');
  const [query, setQuery] = useState('');
  const [program, setProgram] = useState('');
  const [position, setPosition] = useState('');
  const [expired, setExpired] = useState(true);
  const [selected, setSelected] = useState<DraftPlayer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickIntent = useRef<{ athleteId: string; version: number; key: string } | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const athleteById = useMemo(() => new Map(data.athletes.map((a) => [a.id, a])), [data.athletes]);
  const pickedIds = useMemo(() => new Set(data.picks.map((p) => p.athleteId)), [data.picks]);
  const availableIds = useMemo(
    () => new Set(data.athletes.filter((a) => !pickedIds.has(a.id)).map((a) => a.id)),
    [data.athletes, pickedIds],
  );
  const queueEnabled =
    data.connected &&
    Boolean(data.draft && ['active', 'scheduled', 'paused'].includes(data.draft.status));
  const queue = useDraftQueue(id, data.queuedAthleteIds, availableIds, queueEnabled);
  const order = useMemo(
    () =>
      data.draft && data.draft.teamIdsInDraftOrder.length >= 2
        ? buildSnakeOrder(data.draft.teamIdsInDraftOrder, data.draft.rounds)
        : [],
    [data.draft?.rounds, data.draft?.teamIdsInDraftOrder],
  );
  const pickIndex = Math.max(0, (data.draft?.currentOverallPick ?? 1) - 1);
  const onClock = data.draft?.status === 'active' ? order[pickIndex] : undefined;
  const myTurn = data.connected && Boolean(onClock && onClock === data.myTeamId);
  const turn = useTurnAlert(id, pickIndex + 1, myTurn);
  const remaining = expired ? 0 : 1;
  const mayPick = myTurn && !expired && !submitting;
  const filtered = useMemo(
    () =>
      data.athletes
        .filter(
          (a) =>
            availableIds.has(a.id) &&
            data.legalAthleteIds.has(a.id) &&
            (!program || a.program === program) &&
            (!position || a.positions.includes(position)) &&
            (a.displayName + ' ' + a.program + ' ' + a.positions.join(' '))
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => a.rank - b.rank),
    [availableIds, data.athletes, data.legalAthleteIds, position, program, query],
  );
  const programs = useMemo(
    () => [...new Set(data.athletes.map((a) => a.program))].sort(),
    [data.athletes],
  );
  const mine = data.roster.filter((r) => r.fantasy_team_id === data.myTeamId);
  const mySlots = data.slots.filter((s) => s.teamId === data.myTeamId);
  const unplaced = [...mine];
  const rosterCells = mySlots.map((slot) => {
    const index = unplaced.findIndex((r) => r.slot_code === slot.code);
    return { slot, entry: index >= 0 ? unplaced.splice(index, 1)[0] : undefined };
  });
  const empty = rosterCells.flatMap((cell, index) =>
    cell.entry ? [] : [{ slot: cell.slot, index }],
  );
  const previews = previewDraftQueue(
    queue.ids.filter((qid) => data.legalAthleteIds.has(qid)),
    data.candidates,
    empty.map((c) => c.slot),
  );
  const previewByCell = new Map(
    [...previews].map(([index, athleteId]) => [empty[index]!.index, athleteId]),
  );

  useEffect(() => {
    const update = () =>
      setExpired(
        !(
          data.draft?.status === 'active' &&
          data.draft.pickDeadline &&
          Date.parse(data.draft.pickDeadline) > Date.now() + data.serverOffset
        ),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [data.draft?.pickDeadline, data.draft?.status, data.serverOffset]);
  useEffect(() => {
    if (!myTurn || turn.reducedMotion) {
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.6, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      pulse.setValue(1);
    };
  }, [myTurn, pulse, turn.reducedMotion]);

  const commit = async (athleteId: string) => {
    if (!mayPick || !id || !data.legalAthleteIds.has(athleteId)) return;
    setSubmitting(true);
    setError(null);
    const version = data.draft?.stateVersion ?? 0;
    if (pickIntent.current?.athleteId !== athleteId || pickIntent.current.version !== version)
      pickIntent.current = { athleteId, version, key: crypto.randomUUID() };
    const result = await betaCommand('make_draft_pick', {
      p_draft_id: id,
      p_athlete_id: athleteId,
      p_idempotency_key: pickIntent.current.key,
      p_source: 'manager',
      p_expected_version: version,
    }).catch(() => ({ data: null, error: 'Pick confirmation interrupted. Reconnecting…' }));
    if (result.error) setError(result.error);
    else pickIntent.current = null;
    await data.reload();
    setSubmitting(false);
  };
  const players = (
    <Card style={styles.players}>
      <Text style={styles.panelTitle}>Available players</Text>
      <Text style={styles.meta}>{filtered.length} legal selections for your roster</Text>
      <TextInput
        accessibilityLabel="Search available players"
        placeholder="Search player, program, or position"
        placeholderTextColor={colors.muted}
        style={uiStyles.input}
        value={query}
        onChangeText={setQuery}
      />
      <ScrollView horizontal contentContainerStyle={styles.filters}>
        <Filter label="All programs" active={!program} onPress={() => setProgram('')} />
        {programs.map((p) => (
          <Filter
            key={p}
            label={p.replace(/^Brock\s+/u, '')}
            active={program === p}
            onPress={() => setProgram(p)}
          />
        ))}
      </ScrollView>
      <ScrollView horizontal contentContainerStyle={styles.filters}>
        <Filter label="All positions" active={!position} onPress={() => setPosition('')} />
        {['F', 'D', 'G', 'BC', 'FC', 'HT', 'S', 'L'].map((p) => (
          <Filter key={p} label={p} active={position === p} onPress={() => setPosition(p)} />
        ))}
      </ScrollView>
      <ScrollView
        style={{ maxHeight: Math.max(300, height - 370) }}
        contentContainerStyle={{ gap: 8 }}
      >
        {filtered.map((a) => {
          const projected = a.summaries.find(
            (s) => s.kind === 'supplied_projection' && s.season_label === BETA_SEASON,
          );
          return (
            <View key={a.id} style={styles.playerRow}>
              <DraftPlayerPhoto player={a} />
              <View style={styles.identity}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={'View ' + a.displayName + ' player details'}
                  onPress={() => setSelected(a)}
                >
                  <Text style={styles.playerName}>{a.displayName}</Text>
                </Pressable>
                <Text style={styles.meta}>
                  {a.program.replace(/^Brock\s+/u, '')} · {a.positions.join('/')} · #
                  {a.jerseyNumber ?? '—'}
                </Text>
                <Text style={styles.stats}>
                  Rank {a.rank} · Proj FP {projected?.fantasy_points ?? '—'} · Proj GP{' '}
                  {projected?.games_played ?? '—'}
                </Text>
              </View>
              <View style={styles.actions}>
                <SmallButton
                  label={queue.ids.includes(a.id) ? 'Remove from queue' : '+ Queue'}
                  disabled={!queueEnabled}
                  onPress={() => queue.toggle(a.id)}
                />
                <SmallButton
                  label={submitting ? 'Confirming…' : myTurn ? 'Draft' : 'Wait'}
                  disabled={!mayPick}
                  onPress={() => void commit(a.id)}
                />
              </View>
            </View>
          );
        })}
        {!filtered.length ? (
          <Text style={uiStyles.body}>
            {data.draft?.status === 'complete'
              ? 'Draft complete. Review your roster.'
              : data.loading
                ? 'Loading players…'
                : 'No players match your filters and remaining roster requirements.'}
          </Text>
        ) : null}
      </ScrollView>
    </Card>
  );
  const roster = (
    <Card style={styles.panel}>
      <Text style={styles.panelTitle}>
        Your roster · {mine.length}/{mySlots.length || 10}
      </Text>
      <Text style={styles.meta}>✓ Drafted · ⏳ Queued previews</Text>
      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
        {rosterCells.map((cell, index) => {
          const ghost = previewByCell.get(index);
          const athlete = athleteById.get(cell.entry?.athlete_id ?? ghost ?? '');
          const name =
            cell.slot.code === 'BN'
              ? 'Bench ' + (index - mySlots.filter((s) => s.code !== 'BN').length + 1)
              : cell.slot.label;
          return (
            <View key={index} style={[styles.rosterSlot, ghost ? styles.preview : null]}>
              <Text style={styles.slotLabel}>{name}</Text>
              {athlete ? (
                <Pressable accessibilityRole="link" onPress={() => setSelected(athlete)}>
                  <Text style={styles.playerName}>
                    {cell.entry ? '✓ ' : '⏳ '}
                    {athlete.displayName}
                  </Text>
                  <Text style={styles.meta}>
                    {cell.entry ? 'Drafted' : 'Queued · not drafted'} ·{' '}
                    {athlete.positions.join('/')}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.meta}>Empty</Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </Card>
  );
  const queuePanel = (
    <Card style={styles.panel}>
      <Text style={styles.panelTitle}>Your queue {queue.saving ? '· Saving…' : ''}</Text>
      <Text style={styles.meta}>Autopick takes your first legal queued player.</Text>
      {queue.error ? (
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {queue.error}
          </Text>
          <ActionButton
            label="Retry queue save"
            onPress={queue.retry}
            disabled={!queueEnabled}
            variant="secondary"
          />
        </View>
      ) : null}
      <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ gap: 8 }}>
        {queue.ids.map((qid, index) => {
          const athlete = athleteById.get(qid);
          return (
            <View key={qid} style={styles.rosterSlot}>
              <Text style={styles.playerName}>
                {index + 1}. {athlete?.displayName ?? 'Unavailable player'}
              </Text>
              {!data.legalAthleteIds.has(qid) ? (
                <Text style={styles.meta}>Not currently legal for your roster</Text>
              ) : null}
              <View style={styles.actions}>
                <SmallButton
                  label="Move up"
                  disabled={!queueEnabled || index === 0}
                  onPress={() => queue.move(qid, -1)}
                />
                <SmallButton
                  label="Move down"
                  disabled={!queueEnabled || index === queue.ids.length - 1}
                  onPress={() => queue.move(qid, 1)}
                />
                <SmallButton
                  label="Remove"
                  disabled={!queueEnabled}
                  onPress={() => queue.remove(qid)}
                />
              </View>
            </View>
          );
        })}
        {!queue.ids.length ? <Text style={styles.meta}>Your queue is empty.</Text> : null}
      </ScrollView>
    </Card>
  );
  const recent = (
    <Card style={styles.panel}>
      <Text style={styles.panelTitle}>
        Pick history · {data.picks.length}/{order.length}
      </Text>
      <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ gap: 10 }}>
        {[...data.picks].reverse().map((pick) => (
          <View key={pick.id} style={styles.historyRow}>
            <Text style={styles.stats}>
              #{pick.overallPick} ·{' '}
              {data.teams.find((t) => t.id === pick.fantasyTeamId)?.name ?? 'Team'} ·{' '}
              {pick.source === 'autopick' ? 'Autopick' : 'Drafted'}
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => setSelected(athleteById.get(pick.athleteId) ?? null)}
            >
              <Text style={styles.playerName}>
                {athleteById.get(pick.athleteId)?.displayName ?? 'Unavailable player'}
              </Text>
            </Pressable>
          </View>
        ))}
        {!data.picks.length ? <Text style={styles.meta}>No picks yet.</Text> : null}
      </ScrollView>
    </Card>
  );
  const chat = (
    <Card style={styles.panel}>
      <DraftChat leagueId={data.draft?.leagueId} />
    </Card>
  );
  return (
    <AppShell>
      <View style={styles.header}>
        <View style={{ gap: 8 }}>
          <Pill
            label={
              data.draft?.status === 'complete'
                ? 'DRAFT COMPLETE'
                : 'SNAKE DRAFT · ROUND ' +
                  (Math.floor(
                    Math.min(pickIndex, Math.max(0, order.length - 1)) / (data.teams.length || 1),
                  ) +
                    1)
            }
            tone="info"
          />
          <Text accessibilityRole="header" style={styles.title}>
            {data.leagueName ? data.leagueName + ' Draft' : 'Loading draft…'}
          </Text>
          <Text style={styles.meta}>
            Pick {Math.min(pickIndex + 1, order.length)} of {order.length}
          </Text>
        </View>
        <View style={styles.clock}>
          <Text style={styles.meta}>ON THE CLOCK</Text>
          <DraftClock
            status={data.draft?.status}
            deadline={data.draft?.pickDeadline}
            offset={data.serverOffset}
          />
          <Text style={styles.clockTeam}>
            {onClock
              ? data.teams.find((t) => t.id === onClock)?.name
              : data.draft?.status === 'complete'
                ? 'All picks committed'
                : 'Draft waiting'}
          </Text>
        </View>
      </View>
      {!data.connected && !data.loading ? (
        <View accessibilityRole="alert" style={styles.notice}>
          <Text style={styles.error}>
            {data.error ?? 'Reconnecting…'} Picks are disabled until the draft reconnects.
          </Text>
          <ActionButton
            label="Retry connection"
            variant="secondary"
            onPress={() => void data.reload()}
          />
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {myTurn ? (
        <Animated.View
          style={[styles.turnBanner, { opacity: pulse }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.turnText}>
            {remaining > 0 ? 'You are on the clock!' : 'Your pick timed out. Awaiting autopick…'}
          </Text>
        </Animated.View>
      ) : null}
      <View style={styles.toolbar}>
        <ActionButton
          label={turn.enabled ? 'Mute turn sound' : 'Enable turn sound'}
          onPress={turn.toggle}
          variant="secondary"
        />
        <ActionButton
          label="Return to league"
          href={data.draft?.leagueId ? '/league/' + data.draft.leagueId : '/dashboard'}
          variant="secondary"
        />
      </View>
      {turn.message ? <Text style={styles.meta}>{turn.message}</Text> : null}
      <ScrollView horizontal contentContainerStyle={styles.filters}>
        {order.slice(pickIndex, pickIndex + 5).map((teamId, index) => (
          <View key={pickIndex + index} style={styles.orderItem}>
            <Text style={styles.stats}>
              #{pickIndex + index + 1} {data.teams.find((t) => t.id === teamId)?.name}
            </Text>
          </View>
        ))}
      </ScrollView>
      {!wide ? (
        <View style={styles.filters}>
          {(['available', 'roster', 'queue', 'chat'] as Tab[]).map((item) => (
            <Filter
              key={item}
              label={
                item === 'roster'
                  ? 'Your roster'
                  : item === 'queue'
                    ? 'Your queue'
                    : item === 'chat'
                      ? 'Chat'
                      : 'Players'
              }
              active={tab === item}
              onPress={() => setTab(item)}
            />
          ))}
        </View>
      ) : null}
      {wide ? (
        <View style={styles.layout}>
          <View style={{ flex: 1.8, minWidth: 0, gap: 16 }}>
            {players}
            {recent}
          </View>
          <View style={{ flex: 1, minWidth: 280, gap: 16 }}>
            {roster}
            {queuePanel}
            {chat}
          </View>
        </View>
      ) : (
        <View style={{ gap: 16 }}>
          {tab === 'available' ? (
            <>
              {players}
              {recent}
            </>
          ) : tab === 'roster' ? (
            roster
          ) : tab === 'queue' ? (
            queuePanel
          ) : (
            chat
          )}
        </View>
      )}
      <DraftPlayerPanel
        player={selected ? (athleteById.get(selected.id) ?? null) : null}
        onClose={() => setSelected(null)}
      />
    </AppShell>
  );
}
// Clock ticks stay inside this small component. Player cards and photographs
// are rendered only when draft data or the viewer's controls change.
function DraftClock({
  status,
  deadline,
  offset,
}: {
  status: string | undefined;
  deadline: string | undefined;
  offset: number;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const update = () =>
      setSeconds(
        deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - Date.now() - offset) / 1000)) : 0,
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadline, offset]);
  const label =
    status === 'complete'
      ? 'Draft complete'
      : status === 'paused'
        ? 'Paused'
        : status === 'scheduled'
          ? 'Scheduled'
          : !status
            ? 'Loading…'
            : seconds === 0
              ? 'Awaiting autopick'
              : formatDraftClock(seconds);
  return <Text style={styles.clockValue}>{label}</Text>;
}
function Filter({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.filter, active ? styles.filterActive : null]}
    >
      <Text style={styles.filterText}>{label}</Text>
    </Pressable>
  );
}
function SmallButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.smallButton, disabled ? { opacity: 0.45 } : null]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: { ...heading, fontSize: 30 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  clock: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    minWidth: 200,
  },
  clockValue: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  clockTeam: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 6 },
  notice: { gap: 10, borderWidth: 1, borderColor: colors.danger, padding: 14, borderRadius: 12 },
  error: { color: colors.danger, fontSize: 14 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  turnBanner: {
    backgroundColor: colors.navy,
    borderColor: colors.gray,
    borderWidth: 2,
    padding: 16,
    borderRadius: 12,
  },
  turnText: { color: colors.white, fontWeight: '900', fontSize: 22 },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingVertical: 4 },
  filter: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterActive: { borderColor: colors.link, borderWidth: 2 },
  filterText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  layout: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  players: { gap: 12 },
  panel: { gap: 10 },
  panelTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  playerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  identity: { flex: 1, minWidth: 180, gap: 3 },
  playerName: { color: colors.text, fontWeight: '800', fontSize: 14 },
  stats: { color: colors.text, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  smallButton: {
    borderColor: colors.border,
    borderWidth: 1,
    padding: 9,
    borderRadius: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  buttonText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  rosterSlot: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, gap: 5 },
  slotLabel: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  preview: { borderStyle: 'dashed', opacity: 0.7 },
  historyRow: { gap: 4, borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 10 },
  orderItem: { padding: 10, borderColor: colors.border, borderWidth: 1, borderRadius: 8 },
});

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';
import {
  ActionButton,
  AppShell,
  Card,
  ErrorState,
  LoadingState,
  Pill,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { PlayerInsightsPanel, NextGame, projectedPoints } from '@/components/player-insights';
import { RulesLink } from '@/components/rules-link';
import { useLeague } from '@/hooks/use-league';
import { usePlayerInsights } from '@/hooks/use-player-insights';
import { useRequireUser } from '@/hooks/use-route-access';
import { ROSTER_GUIDE, positionLabel, rosterSlotLabel } from '@/lib/roster-guide';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { useSession } from '@/providers/session-provider';
import { useThemeColors } from '@/providers/theme-provider';
import { useResponsiveDimensions } from '@/hooks/use-responsive-dimensions';
import { DraftPlayerPhoto } from '@/components/player-photo';
import { createSingleFlight } from '@/lib/single-flight';
import { useActivePoll, useScreenActive } from '@/hooks/use-active-poll';
import { sameSavedLineup } from '@/lib/lineup-recovery';

interface SlotRule {
  slot_code: string;
  label: string;
  allowed_positions: readonly string[];
  slot_count: number;
  is_starter: boolean;
}
interface BetaEntry {
  athlete_id: string;
  display_name: string;
  positions: readonly string[];
  slot_code: string;
  status: 'starter' | 'bench';
  locked: boolean;
  participation_conflict?: boolean;
  locks_at: string | null;
}
interface BetaLineup {
  period: { number: number; ends_at: string } | null;
  state_version: number;
  entries: readonly BetaEntry[];
}
const requestLineup = createSingleFlight<{ data: unknown; error: { message: string } | null }>();

export default function BetaLineupScreen() {
  const ui = useUiStyles();
  const colors = useThemeColors();
  const { width } = useResponsiveDimensions();
  const wide = width >= 1100;
  useRequireUser();
  const { user, readScope } = useSession();
  const active = useScreenActive();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const leagueData = useLeague(leagueId);
  const insights = usePlayerInsights(leagueData.league?.playerPoolId);
  const [lineup, setLineup] = useState<BetaLineup | null>(null);
  const [slots, setSlots] = useState<readonly SlotRule[]>([]);
  const [assignment, setAssignment] = useState<Record<string, string>>({});
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflictReview, setConflictReview] = useState(false);
  const saveInFlight = useRef(false);
  const saveAttempt = useRef<{ identity: object; signature: string; key: string } | null>(null);
  const storageKey =
    user?.id && leagueData.myTeamId ? `bf-lineup:${user.id}:${leagueData.myTeamId}` : null;
  const identity = useMemo(
    () => ({ readScope, teamId: leagueData.myTeamId }),
    [readScope, leagueData.myTeamId],
  );
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const lineupIdentity = useRef<object | null>(null);
  const getLineup = useCallback(
    async () =>
      requestLineup(
        readScope,
        leagueData.myTeamId ?? '',
        async () =>
          await supabase!.rpc('get_beta_lineup', { p_fantasy_team_id: leagueData.myTeamId }),
      ),
    [readScope, leagueData.myTeamId],
  );

  const load = useCallback(async () => {
    if (!supabase || !leagueData.myTeamId || !leagueData.league?.rulesetId) return;
    const [result, rules] = await Promise.all([
      getLineup(),
      supabase
        .from('roster_slot_rules')
        .select('slot_code,label,allowed_positions,slot_count,is_starter')
        .eq('ruleset_id', leagueData.league.rulesetId),
    ]);
    if (latestIdentity.current !== identity) return;
    if (result.error || rules.error) {
      setMessage(result.error?.message ?? rules.error?.message ?? 'Lineup unavailable');
      return;
    }
    const next = result.data as BetaLineup;
    lineupIdentity.current = identity;
    setLineup(next);
    setConflictReview(false);
    saveAttempt.current = null;
    setSlots(rules.data ?? []);
    const committed = Object.fromEntries(
      next.entries.map((entry) => [entry.athlete_id, entry.slot_code]),
    );
    try {
      const cached =
        Platform.OS === 'web' && storageKey
          ? (JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as {
              version: number;
              assignment: Record<string, string>;
            } | null)
          : null;
      const valid =
        cached?.version === next.state_version &&
        Object.keys(cached.assignment).length === next.entries.length &&
        next.entries.every((entry) => typeof cached.assignment[entry.athlete_id] === 'string');
      setAssignment(valid && cached ? cached.assignment : committed);
    } catch {
      setAssignment(committed);
    }
  }, [getLineup, identity, leagueData.myTeamId, leagueData.league?.rulesetId, storageKey]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !storageKey || !lineup || !Object.keys(assignment).length) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ version: lineup.state_version, assignment }),
      );
    } catch {
      /* - Browser storage is optional */
    }
  }, [assignment, lineup, storageKey]);
  const refreshLocks = useCallback(async () => {
    if (!supabase || !leagueData.myTeamId) return;
    const result = await getLineup();
    if (latestIdentity.current !== identity || lineupIdentity.current !== identity || result.error)
      return;
    const next = result.data as BetaLineup;
    const locks = new Map(next.entries.map((entry) => [entry.athlete_id, entry]));
    // - Refresh locks without overwriting unsaved assignments or their concurrency version
    setLineup((current) =>
      current
        ? {
            ...current,
            entries: current.entries.map((entry) => ({
              ...entry,
              locked: locks.get(entry.athlete_id)?.locked ?? true,
              locks_at: locks.get(entry.athlete_id)?.locks_at ?? null,
            })),
          }
        : current,
    );
  }, [getLineup, identity, leagueData.myTeamId]);
  useActivePoll(refreshLocks, active && Boolean(leagueData.myTeamId), 15000);

  const slotByCode = useMemo(() => new Map(slots.map((slot) => [slot.slot_code, slot])), [slots]);
  const entriesBySlot = useMemo(() => {
    // - Group assignments once for constant time slot lookups
    const groups = new Map<string, BetaEntry[]>();
    for (const entry of lineup?.entries ?? []) {
      const code = assignment[entry.athlete_id] ?? entry.slot_code;
      const group = groups.get(code) ?? [];
      group.push(entry);
      groups.set(code, group);
    }
    return groups;
  }, [lineup, assignment]);
  const dirty =
    lineup?.entries.some((entry) => assignment[entry.athlete_id] !== entry.slot_code) ?? false;
  const swap = (sourceId: string, targetId: string) => {
    if (saving || sourceId === targetId) return;
    const source = lineup?.entries.find((entry) => entry.athlete_id === sourceId);
    const target = lineup?.entries.find((entry) => entry.athlete_id === targetId);
    const sourceSlot = slotByCode.get(assignment[sourceId] ?? '');
    const targetSlot = slotByCode.get(assignment[targetId] ?? '');
    if (
      !source ||
      !target ||
      source.locked ||
      target.locked ||
      !sourceSlot ||
      !targetSlot ||
      !source.positions.some((position) => targetSlot.allowed_positions.includes(position)) ||
      !target.positions.some((position) => sourceSlot.allowed_positions.includes(position))
    ) {
      setMessage('Choose two unlocked athletes eligible for each other’s positions.');
      return;
    }
    setAssignment((current) => ({
      ...current,
      [sourceId]: targetSlot.slot_code,
      [targetId]: sourceSlot.slot_code,
    }));
    setSelected(null);
    setMessage(
      `${source.display_name} and ${target.display_name} swapped. Save lineup to confirm.`,
    );
  };
  const move = (sourceId: string, code: string) => {
    const source = lineup?.entries.find((entry) => entry.athlete_id === sourceId);
    const target = slotByCode.get(code);
    if (!source || !target || saving) return;
    if (
      source.locked ||
      !source.positions.some((position) => target.allowed_positions.includes(position))
    ) {
      setMessage('This athlete is locked or ineligible for that position.');
      return;
    }
    if (assignment[sourceId] === code) return;
    const occupants = entriesBySlot.get(code) ?? [];
    if (occupants.length >= target.slot_count) {
      if (target.slot_count === 1 && occupants[0]) swap(sourceId, occupants[0].athlete_id);
      else {
        setSelected(sourceId);
        setMessage('Bench is full. Select an eligible reserve to complete the swap.');
      }
      return;
    }
    setAssignment((current) => ({ ...current, [sourceId]: code }));
    setSelected(null);
    setMessage('Assignment updated. Save lineup to confirm.');
  };
  const forgetDraft = () => {
    if (Platform.OS === 'web' && storageKey) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* - Browser storage is optional */
      }
    }
  };
  const save = async () => {
    if (
      !lineup ||
      lineupIdentity.current !== identity ||
      !leagueData.myTeamId ||
      saveInFlight.current ||
      conflictReview
    )
      return;
    if (lineup.entries.length !== 10 || Object.keys(assignment).length !== 10) {
      setMessage('Include all ten rostered athletes before saving.');
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const entries = lineup.entries.map((entry) => ({
        athlete_id: entry.athlete_id,
        slot_code: assignment[entry.athlete_id],
      }));
      const signature = JSON.stringify([lineup.state_version, entries]);
      if (
        saveAttempt.current?.identity !== identity ||
        saveAttempt.current.signature !== signature
      ) {
        saveAttempt.current = {
          identity,
          signature,
          key: `lineup-${leagueData.myTeamId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
      }
      const result = await betaCommand('set_period_lineup', {
        p_fantasy_team_id: leagueData.myTeamId,
        p_entries: entries,
        p_expected_version: lineup.state_version,
        p_idempotency_key: saveAttempt.current.key,
      });
      if (latestIdentity.current !== identity) return;
      if (result.status === 409 || result.code === 'PT409') {
        // - Refresh once without automatically submitting the user's pending changes
        const refreshed = await supabase!.rpc('get_beta_lineup', {
          p_fantasy_team_id: leagueData.myTeamId,
        });
        if (latestIdentity.current !== identity) return;
        const next = refreshed.data as BetaLineup | null;
        if (!refreshed.error && next && sameSavedLineup(lineup.entries, next.entries)) {
          setLineup(next);
          saveAttempt.current = null;
          setMessage(
            'League updated. Your changes are retained. Review current locks, then save again.',
          );
        } else {
          setConflictReview(true);
          setMessage(
            'The saved roster changed. Your pending changes remain on screen. Review them, then reload the saved lineup and reapply your changes.',
          );
        }
        return;
      }
      if (result.error) {
        setMessage(result.error);
        return;
      }
      forgetDraft();
      await Promise.all([load(), leagueData.reload()]);
      setMessage('Lineup saved. Future games use these assignments; earned points remain.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  if (!leagueData.league?.playerPoolId && !leagueData.loading)
    return (
      <AppShell title="Legacy league">
        <ActionButton label="Open legacy lineup" href={`/lineup/${leagueId}`} />
      </AppShell>
    );
  return (
    <AppShell
      eyebrow="Fantasy lineup"
      title="Seven starters, three bench"
      action={
        <Pill
          label={dirty ? 'UNSAVED CHANGES' : 'SAVED LINEUP'}
          tone={dirty ? 'warning' : 'info'}
        />
      }
    >
      <Text style={ui.body}>
        Drag athletes between spots or select an athlete and a destination. When the bench is full,
        select the starter and an eligible reserve to swap. Save lineup to commit. Athletes lock at
        scheduled game start and unlock when marked finished. Unlimited swaps between games affect
        future games only; earned points remain.
      </Text>
      <RulesLink section="lineup" label="Lineup locks & eligible positions explained" />
      {leagueData.league?.rosterFormat === 'varsity' ? (
        <Text style={ui.body}>
          Varsity format, any two hockey, two basketball and two volleyball athletes, plus FLEX
        </Text>
      ) : null}
      {lineup?.entries.some((entry) => entry.participation_conflict) ? (
        <Card>
          <Text accessibilityRole="alert" style={ui.body}>
            Replace these athletes from your own varsity program before saving your next lineup:{' '}
            {lineup.entries
              .filter((entry) => entry.participation_conflict)
              .map((entry) => entry.display_name)
              .join(', ')}
            . They cannot score in games starting after your participation changed.
          </Text>
          <ActionButton label="Replace conflicting athletes" href={`/transactions/${leagueId}`} />
        </Card>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {message}
        </Text>
      ) : null}
      {!lineup || lineupIdentity.current !== identity ? (
        message ? (
          <ErrorState message={message} onRetry={() => void load()} />
        ) : (
          <LoadingState label="Loading your lineup" rows={5} />
        )
      ) : (
        <>
          <View
            style={{ gap: 24, flexDirection: wide ? 'row' : 'column', alignItems: 'flex-start' }}
          >
            {(['starters', 'bench'] as const).map((group) => (
              <View
                key={group}
                style={
                  wide
                    ? {
                        gap: 14,
                        flex: group === 'bench' ? undefined : 1,
                        width: group === 'bench' ? 340 : undefined,
                        minWidth: 0,
                      }
                    : { gap: 14, width: '100%' }
                }
              >
                <SectionTitle
                  title={group === 'bench' ? 'Bench' : 'Starting lineup'}
                  detail={
                    group === 'bench'
                      ? 'Three reserves, separate from your starters'
                      : 'Seven starting spots, changes apply after Save lineup'
                  }
                />
                {ROSTER_GUIDE.filter((guide) => (guide.code === 'BN') === (group === 'bench')).map(
                  (guide) => {
                    const slot = slotByCode.get(guide.code);
                    if (!slot) return null;
                    const entries = entriesBySlot.get(guide.code) ?? [];
                    return (
                      <DropZone key={guide.code} onDrop={(sourceId) => move(sourceId, guide.code)}>
                        <Card style={{ gap: 12 }}>
                          <Text accessibilityRole="header" style={ui.title}>
                            {rosterSlotLabel(
                              guide.code,
                              leagueData.league?.rosterFormat === 'varsity',
                            )}
                            , {entries.length}/{slot.slot_count}
                          </Text>
                          <Text style={ui.body}>
                            {guide.code === 'BN'
                              ? 'Reserves do not score while benched'
                              : guide.code === 'FLEX'
                                ? 'Any sport or position'
                                : slot.label}
                          </Text>
                          {entries.map((entry) => {
                            const player = insights.byId.get(entry.athlete_id);
                            return (
                              <Draggable
                                key={entry.athlete_id}
                                id={entry.athlete_id}
                                disabled={entry.locked || saving}
                              >
                                <DropZone onDrop={(sourceId) => swap(sourceId, entry.athlete_id)}>
                                  <View
                                    style={{
                                      padding: 12,
                                      gap: 10,
                                      borderWidth: 1,
                                      borderColor:
                                        selected === entry.athlete_id
                                          ? colors.brand
                                          : colors.border,
                                      borderRadius: 10,
                                      opacity: entry.locked ? 0.65 : 1,
                                    }}
                                  >
                                    <Pressable
                                      accessibilityRole="button"
                                      accessibilityLabel={`Insights for ${entry.display_name}`}
                                      onPress={() => setAthleteId(entry.athlete_id)}
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 12,
                                      }}
                                    >
                                      <DraftPlayerPhoto
                                        player={
                                          player ?? { displayName: entry.display_name, bio: {} }
                                        }
                                        size={52}
                                      />
                                      <Text style={[ui.title, { flex: 1, minWidth: 0 }]}>
                                        {entry.display_name} ↗
                                      </Text>
                                    </Pressable>
                                    <Text style={ui.body}>
                                      {entry.positions.map(positionLabel).join(' / ')}
                                    </Text>
                                    <Text style={ui.body}>
                                      Next period: {projectedPoints(player?.nextProjection)}
                                    </Text>
                                    {player ? <NextGame game={player.nextGame} /> : null}
                                    <Pill
                                      label={
                                        entry.locked ? 'LOCKED, until game finishes' : 'UNLOCKED'
                                      }
                                      tone={entry.locked ? 'warning' : 'info'}
                                    />
                                    <ActionButton
                                      label={
                                        selected && selected !== entry.athlete_id
                                          ? `Swap with ${entry.display_name}`
                                          : selected === entry.athlete_id
                                            ? 'Selected, choose a destination'
                                            : `Move ${entry.display_name}`
                                      }
                                      disabled={entry.locked || saving}
                                      variant="secondary"
                                      onPress={() => {
                                        if (selected && selected !== entry.athlete_id)
                                          swap(selected, entry.athlete_id);
                                        else
                                          setSelected(
                                            selected === entry.athlete_id ? null : entry.athlete_id,
                                          );
                                      }}
                                    />
                                  </View>
                                </DropZone>
                              </Draggable>
                            );
                          })}
                          {!entries.length ? <Text style={ui.body}>Empty spot</Text> : null}
                          {selected ? (
                            <ActionButton
                              label={`Move selected athlete to ${guide.shortLabel}`}
                              disabled={saving}
                              variant="secondary"
                              onPress={() => move(selected, guide.code)}
                            />
                          ) : null}
                        </Card>
                      </DropZone>
                    );
                  },
                )}
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
            <ActionButton label="Back to league" href={`/league/${leagueId}`} variant="ghost" />
            <ActionButton
              label="Reload saved lineup"
              variant="secondary"
              disabled={saving}
              onPress={() => {
                forgetDraft();
                void load();
              }}
            />
            <ActionButton
              label="Save lineup"
              onPress={() => void save()}
              loading={saving}
              disabled={conflictReview || !lineup.period || lineup.entries.length !== 10 || !dirty}
            />
          </View>
        </>
      )}
      <PlayerInsightsPanel
        leagueId={leagueId}
        athleteId={athleteId}
        player={athleteId ? insights.byId.get(athleteId) : undefined}
        loading={insights.loading}
        error={insights.error}
        onClose={() => setAthleteId(null)}
      />
    </AppShell>
  );
}

function Draggable({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return Platform.OS === 'web' ? (
    <div
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', id);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      {children}
    </div>
  ) : (
    <View>{children}</View>
  );
}
function DropZone({ onDrop, children }: { onDrop: (id: string) => void; children: ReactNode }) {
  return Platform.OS === 'web' ? (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = event.dataTransfer.getData('text/plain');
        if (id) onDrop(id);
      }}
    >
      {children}
    </div>
  ) : (
    <View>{children}</View>
  );
}

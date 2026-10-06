import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  uiStyles,
} from '@/components/ui';
import { useLeague } from '@/hooks/use-league';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { colors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

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
  locks_at: string | null;
  unlocks_at: string | null;
}
interface BetaLineup {
  period: { number: number; ends_at: string } | null;
  state_version: number;
  entries: readonly BetaEntry[];
}

export default function BetaLineupScreen() {
  useRequireUser();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const leagueData = useLeague(leagueId);
  const [lineup, setLineup] = useState<BetaLineup | null>(null);
  const [slots, setSlots] = useState<readonly SlotRule[]>([]);
  const [assignment, setAssignment] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!leagueData.myTeamId || !leagueData.league?.rulesetId || !supabase) return;
    const [lineupResult, slotsResult] = await Promise.all([
      supabase.rpc('get_beta_lineup', { p_fantasy_team_id: leagueData.myTeamId }),
      supabase
        .from('roster_slot_rules')
        .select('slot_code, label, allowed_positions, slot_count, is_starter')
        .eq('ruleset_id', leagueData.league.rulesetId)
        .order('is_starter', { ascending: false })
        .order('slot_code'),
    ]);
    if (lineupResult.error || slotsResult.error) {
      setMessage(
        lineupResult.error?.message ?? slotsResult.error?.message ?? 'Lineup is unavailable.',
      );
      return;
    }
    const next = lineupResult.data as unknown as BetaLineup;
    setLineup(next);
    setSlots(slotsResult.data ?? []);
    setAssignment(
      Object.fromEntries(next.entries.map((entry) => [entry.athlete_id, entry.slot_code])),
    );
  }, [leagueData.league?.rulesetId, leagueData.myTeamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const used = useMemo(
    () =>
      Object.values(assignment).reduce<Record<string, number>>(
        (counts, slot) => ({ ...counts, [slot]: (counts[slot] ?? 0) + 1 }),
        {},
      ),
    [assignment],
  );
  const assign = (entry: BetaEntry, slot: SlotRule) => {
    if (
      entry.locked ||
      !entry.positions.some((position) => slot.allowed_positions.includes(position))
    )
      return;
    const current = assignment[entry.athlete_id];
    if (current !== slot.slot_code && (used[slot.slot_code] ?? 0) >= slot.slot_count) {
      setMessage(`${slot.label} is full.`);
      return;
    }
    setMessage(null);
    setAssignment((value) => ({ ...value, [entry.athlete_id]: slot.slot_code }));
  };

  const save = async () => {
    if (!lineup || !leagueData.myTeamId) return;
    if (lineup.entries.length !== 10 || Object.keys(assignment).length !== 10) {
      setMessage('A beta roster must contain all ten athletes before the lineup can be saved.');
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await betaCommand('set_period_lineup', {
      p_fantasy_team_id: leagueData.myTeamId,
      p_entries: lineup.entries.map((entry) => ({
        athlete_id: entry.athlete_id,
        slot_code: assignment[entry.athlete_id],
      })),
      p_expected_version: lineup.state_version,
      p_idempotency_key: `period-lineup-${leagueData.myTeamId}-${Date.now()}`,
    });
    setSaving(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage(
      'Period lineup committed. Each athlete and occupied slot locks at that athlete’s first game until the period ends.',
    );
    await Promise.all([load(), leagueData.reload()]);
  };

  if (!leagueData.league?.playerPoolId && !leagueData.loading) {
    return (
      <AppShell eyebrow="Lineup" title="Legacy league">
        <Card>
          <Text style={uiStyles.body}>This league uses game-specific lineups.</Text>
          <ActionButton label="Open legacy lineup" href={`/lineup/${leagueId ?? ''}`} />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="Fantasy period lineup"
      title="Set your ten-athlete roster"
      action={
        <Pill label={lineup?.period ? `PERIOD ${lineup.period.number}` : 'LOADING'} tone="info" />
      }
    >
      <Text style={uiStyles.body}>
        Starter and bench status are both protected once an athlete’s scheduled game starts. Locked
        athletes remain visible and cannot be moved until the period ends.
      </Text>
      {message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {!lineup ? (
        <EmptyState
          title="Loading lineup"
          body="Authorizing and loading the current fantasy period."
        />
      ) : (
        <>
          <SectionTitle
            title="Roster assignments"
            detail={
              lineup.period
                ? `Locks release after ${new Date(lineup.period.ends_at).toLocaleString()}`
                : 'No active period'
            }
          />
          <View style={styles.entries}>
            {lineup.entries.map((entry) => (
              <Card key={entry.athlete_id} style={[styles.entry, entry.locked && styles.locked]}>
                <View style={styles.entryHeading}>
                  <View>
                    <Text style={styles.name}>{entry.display_name}</Text>
                    <Text style={styles.meta}>
                      {entry.positions.join(' / ')} ·{' '}
                      {entry.locked
                        ? `LOCKED ${entry.locks_at ? `since ${new Date(entry.locks_at).toLocaleString()}` : ''}`
                        : 'UNLOCKED'}
                    </Text>
                  </View>
                  <Pill
                    label={entry.locked ? 'LOCKED' : (assignment[entry.athlete_id] ?? 'UNASSIGNED')}
                    tone={entry.locked ? 'warning' : 'info'}
                  />
                </View>
                <View style={styles.slotChoices}>
                  {slots
                    .filter((slot) =>
                      entry.positions.some((position) => slot.allowed_positions.includes(position)),
                    )
                    .map((slot) => (
                      <Pressable
                        key={slot.slot_code}
                        disabled={entry.locked}
                        onPress={() => assign(entry, slot)}
                        style={[
                          styles.choice,
                          assignment[entry.athlete_id] === slot.slot_code && styles.choiceSelected,
                          entry.locked && styles.choiceDisabled,
                        ]}
                      >
                        <Text style={styles.choiceText}>
                          {slot.slot_code} · {used[slot.slot_code] ?? 0}/{slot.slot_count}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </Card>
            ))}
          </View>
          <View style={styles.actions}>
            <ActionButton
              label="Back to league"
              href={leagueId ? `/league/${leagueId}` : '/dashboard'}
              variant="ghost"
            />
            <ActionButton
              label="Commit period lineup"
              onPress={() => void save()}
              loading={saving}
              disabled={!lineup.period || lineup.entries.length !== 10}
            />
          </View>
        </>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  message: { color: colors.brand, fontSize: 12, marginTop: 12 },
  entries: { gap: 10 },
  entry: { gap: 10 },
  locked: { borderColor: colors.red },
  entryHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start',
  },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  slotChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  choiceSelected: { borderColor: colors.red, backgroundColor: colors.white },
  choiceDisabled: { opacity: 0.5 },
  choiceText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 9,
    marginTop: 16,
  },
});

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppShell, Card, EmptyState, Pill, SectionTitle } from '@/components/ui';
import { useLeague } from '@/hooks/use-league';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createHeading, useThemedStyles, type ThemeColors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

interface GameOption {
  id: string;
  startsAt: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled';
}

interface StarterSlot {
  code: string;
  label: string;
  allowedPositions: readonly string[];
}

interface GameRow {
  id: string;
  starts_at: string;
  status: GameOption['status'];
}

interface SlotRow {
  slot_code: string;
  label: string;
  allowed_positions: string[];
}

interface LineupRow {
  athlete_id: string;
  slot_code: string;
}

export default function LineupScreen() {
  useRequireUser();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { demoMode } = useSession();
  const leagueData = useLeague(leagueId);
  const styles = useStyles();
  const [games, setGames] = useState<readonly GameOption[]>([]);
  const [slots, setSlots] = useState<readonly StarterSlot[]>([]);
  const [selectedGameId, setSelectedGameId] = useState('');
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!leagueData.league) return;
    if (demoMode || !supabase) {
      const demoGame = {
        id: 'demo-game',
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        status: 'scheduled' as const,
      };
      const demoSlots = leagueData.roster
        .filter((entry) => entry.status === 'starter')
        .map((entry) => ({
          code: entry.slotCode,
          label: entry.slotCode,
          allowedPositions: [entry.position],
        }));
      setGames([demoGame]);
      setSelectedGameId(demoGame.id);
      setSlots(demoSlots);
      setSelection(
        Object.fromEntries(
          leagueData.roster
            .filter((entry) => entry.status === 'starter')
            .map((entry) => [entry.slotCode, entry.athleteId]),
        ),
      );
      return;
    }
    const client = supabase;
    const load = async () => {
      const [gameResult, slotResult] = await Promise.all([
        client
          .from('games')
          .select('id, starts_at, status')
          .eq('competition_id', leagueData.league?.competitionId ?? '')
          .in('status', ['scheduled', 'postponed'])
          .gte('starts_at', new Date().toISOString())
          .order('starts_at')
          .limit(20),
        client
          .from('roster_slot_rules')
          .select('slot_code, label, allowed_positions')
          .eq('ruleset_id', leagueData.league?.rulesetId ?? '')
          .eq('is_starter', true)
          .order('id'),
      ]);
      const error = gameResult.error ?? slotResult.error;
      if (error) {
        setMessage(error.message);
        return;
      }
      const nextGames = (gameResult.data as GameRow[]).map<GameOption>((game) => ({
        id: game.id,
        startsAt: game.starts_at,
        status: game.status,
      }));
      setGames(nextGames);
      setSelectedGameId((current) => current || nextGames[0]?.id || '');
      setSlots(
        (slotResult.data as SlotRow[]).map((slot) => ({
          code: slot.slot_code,
          label: slot.label,
          allowedPositions: slot.allowed_positions,
        })),
      );
    };
    void load();
  }, [demoMode, leagueData.league, leagueData.roster]);

  useEffect(() => {
    if (demoMode || !supabase || !selectedGameId || !leagueData.myTeamId) return;
    const client = supabase;
    const load = async () => {
      const result = await client
        .from('lineup_entries')
        .select('athlete_id, slot_code')
        .eq('fantasy_team_id', leagueData.myTeamId ?? '')
        .eq('game_id', selectedGameId);
      if (result.error) setMessage(result.error.message);
      else
        setSelection(
          Object.fromEntries(
            (result.data as LineupRow[]).map((entry) => [entry.slot_code, entry.athlete_id]),
          ),
        );
    };
    void load();
  }, [demoMode, leagueData.myTeamId, selectedGameId]);

  const selectedGame = games.find((game) => game.id === selectedGameId);
  const locked = !selectedGame || Date.parse(selectedGame.startsAt) <= Date.now();
  const selectedAthleteIds = useMemo(() => new Set(Object.values(selection)), [selection]);

  const assign = (slotCode: string, athleteId: string) => {
    setSelection((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([, selectedAthleteId]) => selectedAthleteId !== athleteId),
      );
      return { ...next, [slotCode]: athleteId };
    });
  };

  const save = async () => {
    if (!leagueData.myTeamId || !selectedGameId || locked) return;
    setSaving(true);
    setMessage(null);
    if (supabase) {
      const result = (await supabase.rpc('set_lineup', {
        p_fantasy_team_id: leagueData.myTeamId,
        p_game_id: selectedGameId,
        p_entries: Object.entries(selection).map(([slotCode, athleteId]) => ({
          slot_code: slotCode,
          athlete_id: athleteId,
        })),
        p_idempotency_key: `lineup-${selectedGameId}-${Date.now()}`,
      })) as { error: { message: string } | null };
      if (result.error) setMessage(result.error.message);
      else setMessage('Lineup committed. It will lock at the game start time.');
    } else setMessage('Demo lineup saved locally.');
    setSaving(false);
  };

  return (
    <AppShell eyebrow="Game roster" title="Set lineup">
      <SectionTitle title="Choose a game" detail="Each game has an independent lock" />
      {games.length === 0 ? (
        <EmptyState
          title="No upcoming games"
          body="Lineup controls appear when a scheduled game is imported."
        />
      ) : (
        <View style={styles.gameList}>
          {games.map((game) => (
            <Pressable
              aria-checked={game.id === selectedGameId}
              accessibilityRole="radio"
              accessibilityState={{ checked: game.id === selectedGameId }}
              key={game.id}
              onPress={() => setSelectedGameId(game.id)}
              style={[styles.game, game.id === selectedGameId && styles.gameSelected]}
            >
              <Text style={styles.gameDate}>{new Date(game.startsAt).toLocaleString()}</Text>
              <Pill label={game.status.toUpperCase()} tone="info" />
            </Pressable>
          ))}
        </View>
      )}

      <SectionTitle title="Starter slots" detail={locked ? 'Locked' : 'Tap an eligible athlete'} />
      <View style={styles.slots}>
        {slots.map((slot) => (
          <Card key={slot.code} style={styles.slot}>
            <Text style={styles.slotCode}>{slot.code}</Text>
            <Text style={styles.slotLabel}>{slot.label}</Text>
            <View style={styles.athletes}>
              {leagueData.roster
                .filter((entry) => slot.allowedPositions.includes(entry.position))
                .map((entry) => {
                  const selected = selection[slot.code] === entry.athleteId;
                  const usedElsewhere = selectedAthleteIds.has(entry.athleteId) && !selected;
                  return (
                    <Pressable
                      aria-checked={selected}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: locked || usedElsewhere }}
                      disabled={locked || usedElsewhere}
                      key={entry.athleteId}
                      onPress={() => assign(slot.code, entry.athleteId)}
                      style={[
                        styles.athlete,
                        selected && styles.athleteSelected,
                        usedElsewhere && styles.disabled,
                      ]}
                    >
                      <Text style={[styles.athleteName, selected && styles.athleteNameSelected]}>
                        {entry.displayName}
                      </Text>
                      <Text style={styles.position}>{entry.position}</Text>
                    </Pressable>
                  );
                })}
            </View>
          </Card>
        ))}
      </View>
      {message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <ActionButton
          label="Back to league"
          href={`/league/${leagueId ?? 'demo-league'}`}
          variant="ghost"
        />
        <ActionButton
          label="Commit lineup"
          onPress={() => void save()}
          disabled={locked || Object.keys(selection).length === 0}
          loading={saving}
        />
      </View>
    </AppShell>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    gameList: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    game: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 13,
      gap: 8,
      backgroundColor: colors.canvasSoft,
    },
    gameSelected: { borderColor: colors.brand },
    gameDate: { color: colors.text, fontSize: 11, fontWeight: '700' },
    slots: { gap: 12 },
    slot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
    slotCode: { ...createHeading(colors), color: colors.brand, width: 58, fontSize: 18 },
    slotLabel: { color: colors.text, width: 110, fontSize: 12, fontWeight: '700' },
    athletes: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 7, minWidth: 240 },
    athlete: {
      backgroundColor: colors.canvasSoft,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 9,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    athleteSelected: { borderColor: colors.brand, backgroundColor: colors.selected },
    athleteName: { color: colors.text, fontSize: 10, fontWeight: '700' },
    athleteNameSelected: { color: colors.brand },
    position: { color: colors.muted, fontSize: 8, marginTop: 2 },
    disabled: { opacity: 0.35 },
    message: { color: colors.brand, fontSize: 12, marginTop: 12 },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      flexWrap: 'wrap',
      gap: 9,
      marginTop: 15,
    },
  });

const useStyles = () => useThemedStyles(createStyles);

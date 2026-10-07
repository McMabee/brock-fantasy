import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BETA_PLAYER_POOL_ID } from '@brock-fantasy/domain';
import { AppShell, Card, EmptyState, Pill, SectionTitle, uiStyles } from '@/components/ui';
import { firstRelated } from '@/lib/relations';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

interface AthleteRow {
  id: string;
  display_name: string;
  position: string;
  jersey_number: string | null;
  status: string;
}
interface RankRow {
  rank: number;
  athlete: AthleteRow | readonly AthleteRow[];
}

export default function PlayerDirectoryScreen() {
  useRequireUser();
  const router = useRouter();
  const [players, setPlayers] = useState<readonly (AthleteRow & { rank: number })[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('pool_rankings')
      .select('rank, athlete:athletes!inner(id, display_name, position, jersey_number, status)')
      .eq('pool_id', BETA_PLAYER_POOL_ID)
      .order('rank')
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setError(loadError.message);
          return;
        }
        setPlayers(
          (data as unknown as RankRow[]).flatMap((row) => {
            const athlete = firstRelated(row.athlete);
            return athlete ? [{ ...athlete, rank: row.rank }] : [];
          }),
        );
      });
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? players.filter((player) =>
          `${player.display_name} ${player.position}`.toLowerCase().includes(needle),
        )
      : players;
  }, [players, query]);

  return (
    <AppShell
      eyebrow="Brock six-program pool"
      title="Players"
      action={<Pill label={`${players.length} ELIGIBLE`} tone="info" />}
    >
      <SectionTitle
        title="Search player records"
        detail="Current season, history, ADP, and scoring detail"
      />
      <TextInput
        accessibilityLabel="Search players"
        onChangeText={setQuery}
        placeholder="Search name or position"
        placeholderTextColor={colors.muted}
        style={[uiStyles.input, styles.search]}
        value={query}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!visible.length ? (
        <EmptyState
          title="No eligible player records"
          body="The player directory becomes available after reviewed pool rankings are activated."
        />
      ) : (
        <Card style={styles.list}>
          {visible.map((player) => (
            <Pressable
              accessibilityRole="link"
              key={player.id}
              onPress={() => router.push(`/players/${player.id}`)}
              style={styles.row}
            >
              <View style={styles.rank}>
                <Text style={styles.rankText}>{player.rank}</Text>
              </View>
              <View style={styles.copy}>
                <Text style={styles.name}>{player.display_name}</Text>
                <Text style={styles.meta}>
                  {player.position}
                  {player.jersey_number ? ` · #${player.jersey_number}` : ''}
                </Text>
              </View>
              <Text style={styles.view}>VIEW</Text>
            </Pressable>
          ))}
        </Card>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  search: { marginBottom: 20 },
  error: { color: colors.brand, marginBottom: 10, fontSize: 12 },
  list: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { color: colors.white, fontWeight: '800', fontSize: 11 },
  copy: { flex: 1 },
  name: { color: colors.text, fontWeight: '800', fontSize: 14 },
  meta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  view: { color: colors.red, fontSize: 10, fontWeight: '900' },
});

import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BETA_SEASON } from '@brock-fantasy/domain';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  uiStyles,
} from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';
import { useSession } from '@/providers/session-provider';

const programs: Readonly<Record<string, string>> = {
  mens_hockey: "Men's Hockey",
  womens_hockey: "Women's Hockey",
  mens_basketball: "Men's Basketball",
  womens_basketball: "Women's Basketball",
  mens_volleyball: "Men's Volleyball",
  womens_volleyball: "Women's Volleyball",
};
interface PlayerRow {
  id: string;
  display_name: string;
  position: string;
  jersey_number: string | null;
  bio: { program?: string; sourcePosition?: string };
  summaries: readonly {
    season_label: string;
    kind: string;
    fantasy_points: number | null;
    games_played: number | null;
  }[];
}

export default function PlayerDirectoryScreen() {
  const access = useRequireUser();
  const { user } = useSession();
  const router = useRouter();
  const [players, setPlayers] = useState<readonly PlayerRow[]>([]);
  const [query, setQuery] = useState('');
  const [program, setProgram] = useState('all');
  const [sort, setSort] = useState<'name' | 'projection'>('name');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!access.allowed) {
      setPlayers([]);
      return;
    }
    let cancelled = false;
    setPlayers([]);
    setLoading(true);
    setError(null);
    const load = async () => {
      if (!supabase) throw new Error('Player data is not configured.');
      const result = await supabase
        .from('athletes')
        .select(
          'id, display_name, position, jersey_number, bio, membership:athlete_seasons!inner(directory_visible), summaries:athlete_season_summaries(season_label, kind, fantasy_points, games_played)',
        )
        .eq('status', 'active')
        .eq('membership.directory_visible', true)
        .eq('membership.season_id', 'b0000000-0000-4000-8000-000000000002')
        .order('display_name');
      if (cancelled) return;
      if (result.error) setError('Unable to load the player list. Try again.');
      else setPlayers(result.data ?? []);
      setLoading(false);
    };
    void load().catch(() => {
      if (!cancelled) {
        setLoading(false);
        setError('Unable to load the player list. Try again.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [access.allowed, user?.id, reload]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('en-CA');
    const filtered = players.filter(
      (player) =>
        (program === 'all' || player.bio.program === program) &&
        `${player.display_name} ${player.position} ${player.bio.sourcePosition ?? ''} ${programs[player.bio.program ?? ''] ?? ''} ${player.jersey_number ?? ''}`
          .toLocaleLowerCase('en-CA')
          .includes(needle),
    );
    return filtered.sort((a, b) => {
      if (sort === 'projection') {
        const points = (player: PlayerRow) =>
          player.summaries.find(
            (summary) =>
              summary.kind === 'supplied_projection' && summary.season_label === BETA_SEASON,
          )?.fantasy_points ?? -Infinity;
        if (points(a) !== points(b)) return points(a) > points(b) ? -1 : 1;
      }
      return a.display_name.localeCompare(b.display_name, 'en-CA');
    });
  }, [players, query, program, sort]);

  return (
    <AppShell
      eyebrow={`Brock six-program pool · ${BETA_SEASON}`}
      title="Players"
      action={<Pill label={loading ? 'LOADING' : `${players.length} PLAYERS`} tone="info" />}
    >
      <SectionTitle
        title="Explore the Brock rosters"
        detail="Search by name, position, program or jersey number"
      />
      <TextInput
        accessibilityLabel="Search players"
        onChangeText={setQuery}
        placeholder="Search players"
        placeholderTextColor={colors.muted}
        style={[uiStyles.input, styles.search]}
        value={query}
      />
      <View style={styles.filters}>
        {Object.entries({ all: 'All programs', ...programs }).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: program === value }}
            onPress={() => setProgram(value)}
            style={[styles.filter, program === value && styles.selected]}
          >
            <Text style={[styles.filterText, program === value && styles.selectedText]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.toolbar}>
        <Text style={uiStyles.body}>{visible.length} shown</Text>
        <ActionButton
          label={sort === 'name' ? 'Sort by projected FP' : 'Sort by name'}
          onPress={() => setSort(sort === 'name' ? 'projection' : 'name')}
          variant="secondary"
        />
        <ActionButton
          label="Refresh"
          onPress={() => setReload((value) => value + 1)}
          loading={loading}
          variant="ghost"
        />
      </View>
      {!access.allowed || loading ? (
        <EmptyState title="Loading players" body="Loading the current Brock rosters…" />
      ) : error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : !visible.length ? (
        <EmptyState
          title={players.length ? 'No matching players' : 'No player records yet'}
          body={
            players.length
              ? 'Try another name, position or program.'
              : 'The current roster has not been published.'
          }
        />
      ) : (
        <Card style={styles.list}>
          {visible.map((player) => {
            const projection = player.summaries.find(
              (summary) =>
                summary.kind === 'supplied_projection' && summary.season_label === BETA_SEASON,
            );
            return (
              <Pressable
                accessibilityRole="link"
                key={player.id}
                onPress={() => router.push(`/players/${player.id}`)}
                style={styles.row}
              >
                <View style={styles.copy}>
                  <Text style={styles.name}>{player.display_name}</Text>
                  <Text style={styles.meta}>
                    {programs[player.bio.program ?? ''] ?? 'Brock Badgers'} ·{' '}
                    {player.bio.sourcePosition ?? player.position}
                    {player.jersey_number !== null ? ` · #${player.jersey_number}` : ''}
                  </Text>
                </View>
                <View style={styles.projection}>
                  <Text style={styles.points}>{projection?.fantasy_points ?? '—'}</Text>
                  <Text style={styles.meta}>Projected FP</Text>
                </View>
                <Text style={styles.view}>VIEW</Text>
              </Pressable>
            );
          })}
        </Card>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  search: { marginBottom: 14 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  filter: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  selected: { backgroundColor: colors.navy, borderColor: colors.navy },
  filterText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  selectedText: { color: colors.white },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  error: { color: colors.brand, marginBottom: 10, fontSize: 12 },
  list: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1 },
  name: { color: colors.text, fontWeight: '800', fontSize: 14 },
  meta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  projection: { alignItems: 'flex-end' },
  points: { color: colors.text, fontWeight: '800', fontSize: 16 },
  view: { color: colors.red, fontSize: 10, fontWeight: '900' },
});

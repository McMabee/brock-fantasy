import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BETA_SEASON, playerMetrics } from '@brock-fantasy/domain';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { PreseasonRankings } from '@/components/preseason-rankings';
import { DraftPlayerPhoto } from '@/components/draft-player-panel';
import { supabase } from '@/lib/supabase';
import { loadPlayerAdps, type PlayerAdps } from '@/lib/player-adp';
import { programNames as programs } from '@/lib/player-program';

import { useRequireUser } from '@/hooks/use-route-access';
import { useSession } from '@/providers/session-provider';

interface PlayerRow {
  id: string;
  display_name: string;
  position: string;
  jersey_number: string | null;
  bio: Record<string, unknown> & { program?: string; sourcePosition?: string };
  summaries: readonly {
    season_label: string;
    kind: string;
    fantasy_points: number | null;
    games_played: number | null;
    supplied_adp?: number | null;
  }[];
}

export default function PlayerDirectoryScreen() {
  const [view, setView] = useState<'directory' | 'rankings'>('directory');
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const colors = useThemeColors();
  const access = useRequireUser();
  const { user } = useSession();
  const router = useRouter();
  const [players, setPlayers] = useState<readonly PlayerRow[]>([]);
  const [query, setQuery] = useState('');
  const [program, setProgram] = useState('all');
  const [sort, setSort] = useState<'name' | 'projection' | 'adp'>('name');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adps, setAdps] = useState<PlayerAdps>({});
  const [adpError, setAdpError] = useState<string | null>(null);
  const owner = useRef(user?.id);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!access.allowed) {
      setPlayers([]);
      setAdps({});
      return;
    }
    let cancelled = false;
    if (owner.current !== user?.id) {
      setPlayers([]);
      setAdps({});
    }
    owner.current = user?.id;
    setLoading(true);
    setError(null);
    setAdpError(null);
    void loadPlayerAdps().then(
      (next) => {
        if (!cancelled) setAdps(next);
      },
      () => {
        if (!cancelled) setAdpError('Average draft positions are temporarily unavailable.');
      },
    );
    const load = async () => {
      if (!supabase) throw new Error('Player data is not configured.');
      const result = await supabase
        .from('athletes')
        .select(
          'id, display_name, position, jersey_number, bio, membership:athlete_seasons!inner(directory_visible), summaries:athlete_season_summaries(*)',
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

  // - Cache season metrics and search text once per roster refresh
  const directoryData = useMemo(
    () =>
      new Map(
        players.map(
          (player) =>
            [
              player.id,
              {
                metrics: playerMetrics(player.bio, player.summaries, BETA_SEASON),
                searchText:
                  `${player.display_name} ${player.position} ${player.bio.sourcePosition ?? ''} ${programs[player.bio.program ?? ''] ?? ''} ${player.jersey_number ?? ''}`.toLocaleLowerCase(
                    'en-CA',
                  ),
              },
            ] as const,
        ),
      ),
    [players],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('en-CA');
    const filtered = players.filter(
      (player) =>
        (program === 'all' || player.bio.program === program) &&
        directoryData.get(player.id)!.searchText.includes(needle),
    );
    return filtered.sort((a, b) => {
      if (sort === 'projection') {
        const left = directoryData.get(a.id)!.metrics.projectedPoints ?? -Infinity;
        const right = directoryData.get(b.id)!.metrics.projectedPoints ?? -Infinity;
        if (left !== right) return left > right ? -1 : 1;
      }
      if (sort === 'adp') {
        const left =
          adps[a.id]?.average ?? directoryData.get(a.id)!.metrics.suppliedAdp ?? Infinity;
        const right =
          adps[b.id]?.average ?? directoryData.get(b.id)!.metrics.suppliedAdp ?? Infinity;
        if (left !== right) return left < right ? -1 : 1;
      }
      return a.display_name.localeCompare(b.display_name, 'en-CA');
    });
  }, [players, directoryData, adps, query, program, sort]);

  return (
    <AppShell
      eyebrow={`Brock six-program pool, ${BETA_SEASON}`}
      title="Players"
      action={<Pill label={loading ? 'LOADING' : `${players.length} PLAYERS`} tone="info" />}
    >
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
        <ActionButton
          label="Player directory"
          variant={view === 'directory' ? 'primary' : 'secondary'}
          onPress={() => setView('directory')}
        />
        <ActionButton
          label="Preseason rankings"
          variant={view === 'rankings' ? 'primary' : 'secondary'}
          onPress={() => setView('rankings')}
        />
      </View>
      {view === 'rankings' ? (
        <PreseasonRankings />
      ) : (
        <>
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
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
          </ScrollView>
          <View style={styles.toolbar}>
            <Text style={uiStyles.body}>{visible.length} shown</Text>
            <ActionButton
              label="Refresh"
              onPress={() => setReload((value) => value + 1)}
              loading={loading}
              variant="ghost"
            />
          </View>
          <View style={styles.toolbar}>
            <Text style={uiStyles.body}>Sort by</Text>
            {(
              [
                { value: 'name', label: 'Name' },
                { value: 'projection', label: 'Projected FP' },
                { value: 'adp', label: 'ADP' },
              ] as const
            ).map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${option.label}`}
                aria-pressed={sort === option.value}
                accessibilityState={{ selected: sort === option.value }}
                onPress={() => setSort(option.value)}
                style={[styles.filter, sort === option.value && styles.selected]}
              >
                <Text style={[styles.filterText, sort === option.value && styles.selectedText]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {error && players.length > 0 ? (
            <ErrorState
              message={`${error} Showing your last loaded roster.`}
              onRetry={() => setReload((value) => value + 1)}
            />
          ) : null}
          {adpError && players.length > 0 ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {adpError}
            </Text>
          ) : null}
          {!access.allowed || (loading && players.length === 0) ? (
            <LoadingState label="Loading the current Brock rosters" rows={5} />
          ) : error && players.length === 0 ? (
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
              {visible.map((player, index) => {
                const metrics = directoryData.get(player.id)!.metrics;
                return (
                  <Pressable
                    accessibilityRole="link"
                    key={player.id}
                    onPress={() => router.push(`/players/${player.id}`)}
                    style={[styles.row, index === visible.length - 1 && uiStyles.lastRow]}
                  >
                    <DraftPlayerPhoto
                      player={{ displayName: player.display_name, bio: player.bio }}
                      size={44}
                    />
                    <View style={styles.copy}>
                      <Text style={styles.name}>{player.display_name}</Text>
                      <Text style={styles.meta}>
                        {programs[player.bio.program ?? ''] ?? 'Brock Badgers'},{' '}
                        {player.bio.sourcePosition ?? player.position}
                        {player.jersey_number !== null ? `, #${player.jersey_number}` : ''}
                      </Text>
                      <Text style={styles.meta}>
                        Height {metrics.heightLabel}, ADP{' '}
                        {adps[player.id]?.average?.toFixed(1) ??
                          metrics.suppliedAdp?.toFixed(1) ??
                          '—'}
                      </Text>
                    </View>
                    <View style={styles.projection}>
                      <Text style={styles.points}>{metrics.projectedPoints ?? '—'}</Text>
                      <Text style={styles.meta}>Projected FP</Text>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    search: { marginBottom: 14 },
    filters: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
    filter: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 9,
      minHeight: 44,
      justifyContent: 'center',
    },
    selected: { backgroundColor: colors.navy, borderColor: colors.navy },
    filterText: { fontFamily: 'Inter', color: colors.text, fontSize: 11, fontWeight: '700' },
    selectedText: { color: colors.white },
    toolbar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    error: { fontFamily: 'Inter', color: colors.text, marginBottom: 10, fontSize: 12 },
    list: { paddingVertical: 4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingVertical: 14,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    copy: { flex: 1, minWidth: 100 },
    name: { fontFamily: 'Inter', color: colors.text, fontWeight: '800', fontSize: 14 },
    meta: { fontFamily: 'Inter', color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
    projection: { alignItems: 'flex-end' },
    points: { fontFamily: 'Inter', color: colors.text, fontWeight: '800', fontSize: 16 },
    view: { fontFamily: 'Inter', color: colors.text, fontSize: 10, fontWeight: '900' },
  });

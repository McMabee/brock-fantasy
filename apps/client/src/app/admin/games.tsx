import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  uiStyles,
} from '@/components/ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { betaCommand } from '@/lib/web-api';
import { webRequest } from '@/lib/web-request';
import { colors } from '@/theme';

interface AdminGame {
  id: string;
  starts_at: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled';
  home_score: number | null;
  away_score: number | null;
  state_version: number;
  stats_complete: boolean;
  manual_override: boolean;
  home: { name: string } | null;
  away: { name: string } | null;
}

interface GameDetail {
  game: AdminGame;
  stats: readonly { athlete_id: string; stats: Record<string, unknown> }[];
  athletes: readonly { id: string; display_name: string; position: string }[];
  sport: 'hockey' | 'basketball' | 'volleyball' | null;
}

interface EditableStatLine {
  athleteId: string;
  stats: Readonly<Record<string, number>>;
}

interface ScorePreview {
  players: readonly {
    athlete_id: string;
    previous_points: number;
    projected_points: number | null;
    point_difference: number | null;
    missing_stats: readonly string[];
  }[];
}

const STAT_KEYS: Readonly<Record<'hockey' | 'basketball' | 'volleyball', readonly string[]>> = {
  hockey: ['goals', 'assists', 'power_play_goals', 'short_handed_goals', 'penalty_minutes'],
  basketball: [
    'points',
    'offensive_rebounds',
    'defensive_rebounds',
    'assists',
    'blocks',
    'steals',
    'turnovers',
    'fouls',
    'foul_out',
  ],
  volleyball: [
    'kills',
    'aces',
    'solo_blocks',
    'assisted_blocks',
    'assists',
    'digs',
    'attack_errors',
    'service_errors',
    'reception_errors',
    'setting_errors',
    'ball_handling_errors',
    'blocking_errors',
  ],
};

const GOALIE_STAT_KEYS = ['wins', 'goals_allowed', 'saves', 'shutouts'] as const;

function displayStat(key: string): string {
  return key.replace(/_/gu, ' ');
}

function statisticKeys(
  sport: NonNullable<GameDetail['sport']>,
  position: string,
): readonly string[] {
  return sport === 'hockey' && position.toUpperCase() === 'G' ? GOALIE_STAT_KEYS : STAT_KEYS[sport];
}

export default function AdminGamesScreen() {
  useRequireAdmin();
  const [games, setGames] = useState<readonly AdminGame[]>([]);
  const [selected, setSelected] = useState<GameDetail | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AdminGame['status']>('final');
  const [homeScore, setHomeScore] = useState('0');
  const [awayScore, setAwayScore] = useState('0');
  const [statLines, setStatLines] = useState<readonly EditableStatLine[]>([]);
  const [includedAthleteIds, setIncludedAthleteIds] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('manual-review');
  const [preview, setPreview] = useState<ScorePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const loadGames = async () => {
    const result =
      Platform.OS === 'web'
        ? await webRequest<{ games: AdminGame[] }>('/api/admin/games')
        : { data: null, error: 'Scorekeeping is available through the web beta.' };
    if (result.error) setMessage(result.error);
    else setGames(result.data?.games ?? []);
  };

  useEffect(() => {
    void loadGames();
  }, []);

  const filteredGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return games;
    return games.filter((game) =>
      [game.home?.name, game.away?.name, game.status, game.id]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [games, query]);

  const selectGame = async (game: AdminGame) => {
    setMessage(null);
    setPreview(null);
    const result = await webRequest<GameDetail>(
      `/api/admin/games?gameId=${encodeURIComponent(game.id)}`,
    );
    if (result.error || !result.data) {
      setMessage(result.error ?? 'Unable to load game details.');
      return;
    }
    const currentByAthlete = new Map(
      result.data.stats.map((line) => [line.athlete_id, line.stats]),
    );
    setSelected(result.data);
    setStatus(game.status);
    setHomeScore(String(game.home_score ?? 0));
    setAwayScore(String(game.away_score ?? 0));
    setIncludedAthleteIds(new Set(currentByAthlete.keys()));
    setStatLines(
      result.data.athletes.map((athlete) => ({
        athleteId: athlete.id,
        stats: Object.fromEntries(
          Object.entries(currentByAthlete.get(athlete.id) ?? {}).flatMap(([key, value]) =>
            typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [],
          ),
        ),
      })),
    );
  };

  const buildStats = (): Record<string, unknown>[] => {
    return statLines
      .filter((line) => includedAthleteIds.has(line.athleteId))
      .map((line) => ({ athlete_id: line.athleteId, stats: line.stats }));
  };

  const updateStat = (athleteId: string, key: string, rawValue: string) => {
    setStatLines((current) =>
      current.map((line) => {
        if (line.athleteId !== athleteId) return line;
        const next = { ...line.stats } as Record<string, number>;
        if (rawValue.trim() === '') delete next[key];
        else {
          const number = Number(rawValue);
          if (!Number.isFinite(number)) return line;
          next[key] = number;
        }
        return { ...line, stats: next };
      }),
    );
  };

  const toggleAthlete = (athleteId: string) => {
    setIncludedAthleteIds((current) => {
      const next = new Set(current);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });
  };

  const previewRevision = async () => {
    if (!selected) return;
    const stats = buildStats();
    if (!stats.length) {
      setMessage('Include at least one player stat line.');
      return;
    }
    setWorking(true);
    setMessage(null);
    const result = await betaCommand<ScorePreview>('preview_game_revision', {
      p_game_id: selected.game.id,
      p_expected_version: selected.game.state_version,
      p_stats: stats,
    });
    setWorking(false);
    if (result.error) setMessage(result.error);
    else setPreview(result.data);
  };

  const publishRevision = async () => {
    if (!selected) return;
    const stats = buildStats();
    const home = Number(homeScore);
    const away = Number(awayScore);
    if (
      !stats.length ||
      !Number.isInteger(home) ||
      home < 0 ||
      !Number.isInteger(away) ||
      away < 0 ||
      reason.trim().length < 8 ||
      source.trim().length < 3
    ) {
      setMessage(
        'Include at least one player, provide non-negative scores, an 8-character reason, and a source reference.',
      );
      return;
    }
    setWorking(true);
    setMessage(null);
    const result = await betaCommand<{ state_version: number }>('publish_game_revision', {
      p_game_id: selected.game.id,
      p_expected_version: selected.game.state_version,
      p_status: status,
      p_home_score: home,
      p_away_score: away,
      p_stats: stats,
      p_reason: reason.trim(),
      p_source_identity: source.trim(),
      p_idempotency_key: `game-revision-${selected.game.id}-${Date.now()}`,
    });
    setWorking(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage('Revision published and scoring replay queued atomically.');
    await loadGames();
    setSelected(null);
  };

  const statsByAthlete = useMemo(
    () => new Map(statLines.map((line) => [line.athleteId, line.stats])),
    [statLines],
  );

  return (
    <AppShell
      eyebrow="Administrator scorekeeping"
      title="Games, mappings, and score revisions"
      action={<Pill label="AAL2 VERIFIED" tone="warning" />}
    >
      <Text style={uiStyles.body}>
        Search an official or manual game record, inspect the current normalized player lines,
        preview point changes, then publish one audited revision.
      </Text>
      {message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <View style={styles.layout}>
        <Card style={styles.searchPane}>
          <TextInput
            accessibilityLabel="Search games"
            onChangeText={setQuery}
            placeholder="Search team, status, or game ID"
            placeholderTextColor={colors.muted}
            style={uiStyles.input}
            value={query}
          />
          <View style={styles.gameList}>
            {filteredGames.map((game) => (
              <Pressable
                key={game.id}
                onPress={() => void selectGame(game)}
                style={[styles.gameRow, selected?.game.id === game.id && styles.gameRowActive]}
              >
                <Text style={styles.gameName}>
                  {game.home?.name ?? 'Unknown'} vs {game.away?.name ?? 'Unknown'}
                </Text>
                <Text style={styles.gameMeta}>
                  {new Date(game.starts_at).toLocaleString()} · {game.status} · v
                  {game.state_version}
                </Text>
              </Pressable>
            ))}
            {!filteredGames.length ? (
              <EmptyState
                title="No games found"
                body="Import or reconcile schedules before scorekeeping."
              />
            ) : null}
          </View>
        </Card>
        <Card style={styles.editor}>
          {!selected ? (
            <EmptyState
              title="Select a game"
              body="The editor shows the game’s normalized player lines and revision controls."
            />
          ) : (
            <>
              <SectionTitle
                title={`${selected.game.home?.name ?? 'Home'} vs ${selected.game.away?.name ?? 'Away'}`}
                detail={`Revision ${selected.game.state_version}`}
              />
              <View style={styles.scores}>
                <Field
                  label="Status"
                  value={status}
                  onChange={(value) => {
                    if (
                      ['scheduled', 'in_progress', 'final', 'postponed', 'cancelled'].includes(
                        value,
                      )
                    ) {
                      setStatus(value as AdminGame['status']);
                    }
                  }}
                />
                <Field label="Home score" value={homeScore} onChange={setHomeScore} />
                <Field label="Away score" value={awayScore} onChange={setAwayScore} />
              </View>
              {selected.sport ? (
                <>
                  <Text style={uiStyles.label}>
                    {selected.sport.toUpperCase()} player stat lines
                  </Text>
                  <Text style={styles.hint}>
                    Include only athletes credited in this game. Leave a field blank only when the
                    official source does not provide it; enter 0 for a recorded zero.
                  </Text>
                  <View style={styles.statLines}>
                    {selected.athletes.map((athlete) => {
                      const included = includedAthleteIds.has(athlete.id);
                      const values = statsByAthlete.get(athlete.id) ?? {};
                      return (
                        <View key={athlete.id} style={styles.statLine}>
                          <View style={styles.statHeader}>
                            <View>
                              <Text style={styles.assetName}>{athlete.display_name}</Text>
                              <Text style={styles.assetMeta}>{athlete.position}</Text>
                            </View>
                            <Pressable
                              accessibilityRole="switch"
                              accessibilityState={{ checked: included }}
                              onPress={() => toggleAthlete(athlete.id)}
                              style={[styles.include, included && styles.includeActive]}
                            >
                              <Text
                                style={[styles.includeText, included && styles.includeTextActive]}
                              >
                                {included ? 'INCLUDED' : 'ADD PLAYER'}
                              </Text>
                            </Pressable>
                          </View>
                          {included ? (
                            <View style={styles.statInputs}>
                              {statisticKeys(selected.sport ?? 'hockey', athlete.position).map(
                                (key) => (
                                  <Field
                                    key={key}
                                    label={displayStat(key)}
                                    value={values[key] === undefined ? '' : String(values[key])}
                                    onChange={(value) => updateStat(athlete.id, key, value)}
                                    numeric
                                  />
                                ),
                              )}
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : (
                <EmptyState
                  title="Competition sport is unavailable"
                  body="Resolve the competition-to-sport mapping before entering player statistics."
                />
              )}
              <Field label="Reason for revision" value={reason} onChange={setReason} />
              <Field
                label="Official source or manual reference"
                value={source}
                onChange={setSource}
              />
              <View style={styles.actions}>
                <ActionButton
                  label="Preview scoring differences"
                  onPress={() => void previewRevision()}
                  loading={working}
                  variant="secondary"
                />
                <ActionButton
                  label="Publish audited revision"
                  onPress={() => void publishRevision()}
                  loading={working}
                />
              </View>
              {preview ? (
                <View style={styles.preview}>
                  {preview.players.map((player) => (
                    <Text key={player.athlete_id} style={styles.previewLine}>
                      {player.athlete_id.slice(0, 8)} ·{' '}
                      {player.missing_stats.length
                        ? `incomplete: ${player.missing_stats.join(', ')}`
                        : `${player.previous_points} → ${player.projected_points} (${player.point_difference! >= 0 ? '+' : ''}${player.point_difference})`}
                    </Text>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </Card>
      </View>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={uiStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        placeholderTextColor={colors.muted}
        style={uiStyles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  message: { color: colors.brand, fontSize: 13, marginTop: 12 },
  layout: { gap: 16, marginTop: 16 },
  searchPane: { gap: 12 },
  editor: { gap: 11 },
  gameList: { gap: 6, maxHeight: 440 },
  gameRow: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 11 },
  gameRowActive: { borderColor: colors.red },
  gameName: { color: colors.text, fontWeight: '800', fontSize: 13 },
  gameMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  assetName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  assetMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  scores: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flex: 1, minWidth: 150, gap: 6 },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  statLines: { gap: 8 },
  statLine: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, gap: 10 },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statInputs: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  include: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  includeActive: { borderColor: colors.red, backgroundColor: colors.white },
  includeText: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  includeTextActive: { color: colors.red },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
  preview: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, gap: 5 },
  previewLine: { color: colors.text, fontSize: 11 },
});

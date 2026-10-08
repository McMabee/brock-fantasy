import { formatFantasyPoints } from '@brock-fantasy/domain';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BETA_PLAYER_POOL_ID, BETA_SEASON } from '@brock-fantasy/domain';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  uiStyles,
} from '@/components/ui';
import { firstRelated } from '@/lib/relations';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';
import { useSession } from '@/providers/session-provider';

interface AthleteRow {
  id: string;
  display_name: string;
  position: string;
  jersey_number: string | null;
  status: string;
  bio: { sourcePosition?: string; eligibility?: string; major?: string; hometown?: string };
}
interface MembershipRow {
  competition_id: string;
  team_id: string;
  positions: readonly string[];
}
interface GameRow {
  id: string;
  starts_at: string;
  status: string;
}
interface StatRow {
  game_id: string;
  stats: Record<string, number | null>;
  fantasy_points: number | null;
  complete: boolean;
  missing_stats: readonly string[];
  updated_at: string;
  game: GameRow | readonly GameRow[];
}
interface EventRow {
  game_id: string;
  points: number;
  stat_key: string;
  created_at: string;
}
interface HistoryRow {
  season_label: string;
  kind: string;
  fantasy_points: number | null;
  games_played: number | null;
  stats: Record<string, number | null>;
}
interface ProjectionRow {
  status: 'ready' | 'unavailable';
  points: number | null;
  model_version: string;
  generated_at: string;
  input_cutoff: string;
}

function parseAdp(value: unknown): { average_pick: number | null; sample_size: number } | null {
  const candidate: unknown = Array.isArray(value) ? (value as readonly unknown[])[0] : value;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const row = candidate as Record<string, unknown>;
  return (row.average_pick === null || typeof row.average_pick === 'number') &&
    typeof row.sample_size === 'number'
    ? { average_pick: row.average_pick, sample_size: row.sample_size }
    : null;
}

export default function PlayerScreen() {
  const access = useRequireUser();
  const { user } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [athlete, setAthlete] = useState<AthleteRow | null>(null);
  const [memberships, setMemberships] = useState<readonly MembershipRow[]>([]);
  const [stats, setStats] = useState<readonly StatRow[]>([]);
  const [events, setEvents] = useState<readonly EventRow[]>([]);
  const [history, setHistory] = useState<readonly HistoryRow[]>([]);
  const [projection, setProjection] = useState<ProjectionRow | null>(null);
  const [adp, setAdp] = useState<{ average_pick: number | null; sample_size: number } | null>(null);
  const [upcomingGames, setUpcomingGames] = useState<readonly GameRow[]>([]);
  const [season, setSeason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client || !id || !access.allowed) return;
    let cancelled = false;
    setAthlete(null);
    setHistory([]);
    setStats([]);
    setEvents([]);
    setProjection(null);
    setAdp(null);
    setUpcomingGames([]);
    setSeason(null);
    setError(null);
    setLoading(true);
    const load = async () => {
      const [
        athleteResult,
        membershipResult,
        statResult,
        eventResult,
        historyResult,
        projectionResult,
        adpResult,
      ] = await Promise.all([
        client
          .from('athletes')
          .select('id, display_name, position, jersey_number, status, bio')
          .eq('id', id)
          .eq('status', 'active')
          .single(),
        client
          .from('athlete_seasons')
          .select('competition_id, team_id, positions')
          .eq('athlete_id', id),
        client
          .from('normalized_player_game_stats')
          .select(
            'game_id, stats, fantasy_points, complete, missing_stats, updated_at, game:games!inner(id, starts_at, status)',
          )
          .eq('athlete_id', id)
          .order('updated_at', { ascending: false })
          .limit(100),
        client
          .from('fantasy_point_events')
          .select('game_id, points, stat_key, created_at')
          .eq('athlete_id', id)
          .order('created_at', { ascending: false })
          .limit(500),
        client
          .from('athlete_season_summaries')
          .select('season_label, kind, fantasy_points, games_played, stats')
          .eq('athlete_id', id)
          .order('season_label', { ascending: false }),
        client
          .from('weekly_projections')
          .select('status, points, model_version, generated_at, input_cutoff')
          .eq('athlete_id', id)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        client.rpc('get_athlete_adp', {
          p_athlete_id: id,
          p_pool_id: BETA_PLAYER_POOL_ID,
          p_league_size: null,
        }),
      ]);
      if (cancelled) return;
      setLoading(false);
      const firstError =
        athleteResult.error ??
        membershipResult.error ??
        statResult.error ??
        eventResult.error ??
        historyResult.error ??
        projectionResult.error ??
        adpResult.error;
      if (firstError) {
        setError('This player record is unavailable. Return to the roster list and try again.');
        return;
      }
      setAthlete(athleteResult.data);
      const nextMemberships = (membershipResult.data ?? []) as unknown as MembershipRow[];
      setMemberships(nextMemberships);
      setStats(statResult.data ?? []);
      setEvents(eventResult.data ?? []);
      setHistory(historyResult.data ?? []);
      setProjection(projectionResult.data ?? null);
      setAdp(parseAdp(adpResult.data as unknown));
      const teams = [...new Set(nextMemberships.map((membership) => membership.team_id))];
      if (teams.length) {
        const games = await client
          .from('games')
          .select('id, starts_at, status')
          .or(
            teams
              .flatMap((team) => [`home_team_id.eq.${team}`, `away_team_id.eq.${team}`])
              .join(','),
          )
          .gte('starts_at', new Date().toISOString())
          .in('status', ['scheduled', 'in_progress'])
          .order('starts_at')
          .limit(1);
        if (!cancelled && !games.error) setUpcomingGames(games.data ?? []);
      }
    };
    void load().catch(() => {
      if (!cancelled) {
        setLoading(false);
        setError('Unable to load this player record. Try again.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, access.allowed, user?.id]);

  const logs = useMemo(
    () =>
      stats.map((line) => {
        const game = firstRelated(line.game);
        const breakdown = events
          .filter((event) => event.game_id === line.game_id)
          .reduce((total, event) => total + event.points, 0);
        return { ...line, game, scored: breakdown };
      }),
    [events, stats],
  );
  const nextGame =
    upcomingGames[0] ??
    logs
      .filter((line) => line.game && Date.parse(line.game.starts_at) > Date.now())
      .sort(
        (left, right) => Date.parse(left.game!.starts_at) - Date.parse(right.game!.starts_at),
      )[0]?.game;
  const total = events.reduce((sum, event) => sum + event.points, 0);
  const lastUpdated = stats[0]?.updated_at;
  const seasonProjection = history.find(
    (item) => item.kind === 'supplied_projection' && item.season_label === BETA_SEASON,
  );

  return (
    <AppShell
      eyebrow="Athlete record"
      title={
        access.allowed
          ? (athlete?.display_name ?? (loading ? 'Loading player…' : 'Player unavailable'))
          : 'Players'
      }
      action={<Pill label={athlete?.status?.toUpperCase() ?? 'LOADING'} tone="info" />}
    >
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!access.allowed || loading || !athlete ? (
        <EmptyState
          title={loading ? 'Loading player' : 'Player unavailable'}
          body={
            loading
              ? 'Loading the player’s roster and supplied season records…'
              : 'Return to the player list to browse the current Brock rosters.'
          }
        />
      ) : (
        <>
          <Text style={uiStyles.body}>
            {athlete.bio.sourcePosition ?? athlete.position}
            {athlete.jersey_number !== null ? ` · #${athlete.jersey_number}` : ''}
            {athlete.bio.eligibility ? ` · ${athlete.bio.eligibility}` : ''}
          </Text>
          {athlete.bio.major || athlete.bio.hometown ? (
            <Text style={uiStyles.body}>
              {[athlete.bio.major, athlete.bio.hometown].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <View style={styles.summary}>
            <Card style={styles.metric}>
              <Text style={styles.metricLabel}>{BETA_SEASON} PROJECTED FP</Text>
              <Text style={styles.metricValue}>{seasonProjection?.fantasy_points ?? '—'}</Text>
              <Text style={styles.note}>
                {seasonProjection?.games_played ?? '—'} projected games · supplied season projection
              </Text>
            </Card>
            <Card style={styles.metric}>
              <Text style={styles.metricLabel}>CURRENT POINTS</Text>
              <Text style={styles.metricValue}>{formatFantasyPoints(total)}</Text>
            </Card>
            <Card style={styles.metric}>
              <Text style={styles.metricLabel}>ADP</Text>
              <Text style={styles.metricValue}>
                {adp?.sample_size ? (adp.average_pick?.toFixed(1) ?? '—') : '—'}
              </Text>
              <Text style={styles.note}>
                {adp?.sample_size
                  ? `${adp.sample_size} completed production drafts`
                  : 'No completed production drafts'}
              </Text>
            </Card>
            <Card style={styles.metric}>
              <Text style={styles.metricLabel}>NEXT GAME / LOCK</Text>
              <Text style={styles.next}>
                {nextGame ? new Date(nextGame.starts_at).toLocaleString() : 'No scheduled game'}
              </Text>
              <Text style={styles.note}>
                Locks at the player’s scheduled game time through the fantasy period.
              </Text>
            </Card>
          </View>
          <SectionTitle
            title="Current season"
            detail={`${memberships.flatMap((membership) => membership.positions).join(' / ') || athlete.position} · ${lastUpdated ? `updated ${new Date(lastUpdated).toLocaleString()}` : 'No current statistics'}`}
          />
          {!logs.length ? (
            <EmptyState
              title="No game logs"
              body="Current-season logs appear after an imported, mapped game has player statistics."
            />
          ) : (
            <Card>
              {logs.map((line) => (
                <View key={line.game_id} style={styles.log}>
                  <View style={styles.logCopy}>
                    <Text style={styles.logDate}>
                      {line.game ? new Date(line.game.starts_at).toLocaleString() : line.game_id}
                    </Text>
                    <Text style={styles.note}>
                      {line.complete ? 'Complete' : `Incomplete: ${line.missing_stats.join(', ')}`}
                    </Text>
                  </View>
                  <Text style={styles.points}>
                    {line.complete ? `${formatFantasyPoints(line.scored)} pts` : 'Pending'}
                  </Text>
                </View>
              ))}
            </Card>
          )}
          <SectionTitle
            title="Scoring breakdown"
            detail="Additive per-game events; corrections remain auditable"
          />
          <Card>
            {events.slice(0, 50).map((event, index) => (
              <View key={`${event.game_id}-${event.stat_key}-${index}`} style={styles.event}>
                <Text style={styles.eventKey}>{event.stat_key.replaceAll('_', ' ')}</Text>
                <Text style={styles.points}>
                  {event.points >= 0 ? '+' : ''}
                  {formatFantasyPoints(event.points)}
                </Text>
              </View>
            ))}
            {!events.length ? (
              <Text style={uiStyles.body}>No scoring events have been published.</Text>
            ) : null}
          </Card>
          <SectionTitle
            title="Season history and supplied projections"
            detail="Historical totals never score active fantasy teams"
          />
          {history.length ? (
            <View style={styles.seasons}>
              {[...new Set(history.map((item) => item.season_label))].map((label) => (
                <Text
                  key={label}
                  onPress={() => setSeason(label)}
                  style={[styles.season, season === label && styles.seasonSelected]}
                >
                  {label}
                </Text>
              ))}
            </View>
          ) : null}
          <Card>
            {history
              .filter((item) => !season || item.season_label === season)
              .map((item, index) => (
                <View key={`${item.season_label}-${item.kind}-${index}`} style={styles.history}>
                  <View>
                    <Text style={styles.logDate}>
                      {item.season_label} · {item.kind.replaceAll('_', ' ')}
                    </Text>
                    <Text style={styles.note}>
                      {item.games_played ?? '—'} games · supplied record
                    </Text>
                  </View>
                  <Text style={styles.points}>{item.fantasy_points ?? '—'}</Text>
                </View>
              ))}
            {!history.length ? (
              <Text style={uiStyles.body}>
                No supplied historical totals are available for this player.
              </Text>
            ) : null}
          </Card>
          <SectionTitle title="Weekly forecast" detail="Versioned projection-provider interface" />
          <Card>
            <Text style={uiStyles.body}>
              {projection?.status === 'ready'
                ? `${formatFantasyPoints(projection.points)} points · ${projection.model_version}`
                : 'Weekly projections are unavailable until the approved model is provided. Historical inputs are retained with an input cutoff for backtesting.'}
            </Text>
          </Card>
        </>
      )}
      <ActionButton label="Back to players" href="/players" variant="secondary" />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.brand, fontSize: 12, marginBottom: 12 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 22 },
  metric: { flex: 1, minWidth: 190, gap: 5 },
  metricLabel: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  metricValue: { color: colors.text, fontWeight: '900', fontSize: 28 },
  next: { color: colors.text, fontWeight: '700', fontSize: 13 },
  note: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  log: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 11,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logCopy: { flex: 1 },
  logDate: { color: colors.text, fontSize: 12, fontWeight: '800' },
  points: { color: colors.red, fontSize: 12, fontWeight: '900' },
  event: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  eventKey: { color: colors.text, fontSize: 11, textTransform: 'capitalize' },
  history: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  season: {
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 10,
    fontWeight: '700',
  },
  seasonSelected: { borderColor: colors.red },
});

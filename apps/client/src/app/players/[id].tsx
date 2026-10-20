import { HistoricalGameLogs } from '@/components/historical-game-logs';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { formatFantasyPoints } from '@brock-fantasy/domain';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BETA_SEASON, gameProjection, playerMetrics } from '@brock-fantasy/domain';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  LoadingState,
  Pill,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { DraftPlayerPhoto } from '@/components/draft-player-panel';
import { firstRelated } from '@/lib/relations';
import { supabase } from '@/lib/supabase';

import { useRequireUser } from '@/hooks/use-route-access';
import { useSession } from '@/providers/session-provider';
import { loadPlayerAdps, type PlayerAdp } from '@/lib/player-adp';
import { programNames } from '@/lib/player-program';
import { InfoButton } from '@/components/info-button';
import { PlayerForecastPanel } from '@/components/player-forecast';
import { PlayerTradeAction } from '@/components/player-trade-action';
import { PendingConfirmation, gameTime, projectedPoints } from '@/components/player-insights';

interface AthleteRow {
  id: string;
  display_name: string;
  position: string;
  jersey_number: string | null;
  status: string;
  bio: Record<string, unknown> & {
    sourcePosition?: string;
    eligibility?: string;
    major?: string;
    hometown?: string;
  };
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
  home_team_id?: string;
  schedule_confirmed?: boolean;
  neutral_site?: boolean;
  home?: { name: string } | readonly { name: string }[];
  away?: { name: string } | readonly { name: string }[];
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
  supplied_adp?: number | null;
  stats: Record<string, number | null>;
}

export default function PlayerScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const access = useRequireUser();
  const { user } = useSession();
  const { id, leagueId } = useLocalSearchParams<{ id: string; leagueId?: string }>();
  const [athlete, setAthlete] = useState<AthleteRow | null>(null);
  const [memberships, setMemberships] = useState<readonly MembershipRow[]>([]);
  const [stats, setStats] = useState<readonly StatRow[]>([]);
  const [events, setEvents] = useState<readonly EventRow[]>([]);
  const [history, setHistory] = useState<readonly HistoryRow[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<readonly GameRow[]>([]);
  const [season, setSeason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adp, setAdp] = useState<PlayerAdp | undefined>(undefined);
  const [adpError, setAdpError] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client || !id || !access.allowed) return;
    let cancelled = false;
    setAthlete(null);
    setHistory([]);
    setStats([]);
    setEvents([]);
    setUpcomingGames([]);
    setSeason(null);
    setError(null);
    setLoading(true);
    setAdp(undefined);
    setAdpError(null);
    void loadPlayerAdps().then(
      (values) => {
        if (!cancelled) setAdp(values[id]);
      },
      () => {
        if (!cancelled) setAdpError('Average draft position is temporarily unavailable.');
      },
    );
    const load = async () => {
      const [athleteResult, membershipResult, statResult, eventResult, historyResult] =
        await Promise.all([
          client
            .from('athletes')
            .select('id, display_name, position, jersey_number, status, bio')
            .eq('id', id)
            .eq('status', 'active')
            .single(),
          client
            .from('athlete_seasons')
            .select('competition_id, team_id, positions, season:fantasy_seasons!inner(label)')
            .eq('season.label', BETA_SEASON)
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
            .select('*')
            .eq('athlete_id', id)
            .order('season_label', { ascending: false }),
        ]);
      if (cancelled) return;
      setLoading(false);
      const firstError =
        athleteResult.error ??
        membershipResult.error ??
        statResult.error ??
        eventResult.error ??
        historyResult.error;
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
      const teams = [...new Set(nextMemberships.map((membership) => membership.team_id))];
      if (teams.length) {
        const games = await client
          .from('games')
          .select(
            'id, starts_at, status, home_team_id, schedule_confirmed, neutral_site, home:teams!games_home_team_id_fkey(name), away:teams!games_away_team_id_fkey(name)',
          )
          .or(
            teams
              .flatMap((team) => [`home_team_id.eq.${team}`, `away_team_id.eq.${team}`])
              .join(','),
          )
          .in('schedule_kind', ['regular', 'playoff'])
          .order('starts_at')
          .limit(250);
        if (!cancelled && !games.error) setUpcomingGames(games.data ?? []);
        if (!cancelled && games.error)
          setError('The season schedule is unavailable. Please retry.');
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

  const logs = useMemo(() => {
    // - Join canonical stats by game so multiple fantasy leagues cannot multiply athlete points
    const byGame = new Map(stats.map((line) => [line.game_id, line]));
    const games = upcomingGames.length
      ? upcomingGames
      : stats.flatMap((line) => {
          const game = firstRelated(line.game);
          return game ? [game] : [];
        });
    return games.map((game) => {
      const line = byGame.get(game.id);
      return {
        game_id: game.id,
        game,
        complete: line?.complete ?? false,
        missing_stats: line?.missing_stats ?? [],
        scored: line?.fantasy_points ?? null,
        stats: line?.stats ?? {},
      };
    });
  }, [upcomingGames, stats]);
  const nextGame =
    upcomingGames.find(
      (game) => game.status === 'scheduled' && Date.parse(game.starts_at) > Date.now(),
    ) ??
    logs
      .filter((line) => line.game && Date.parse(line.game.starts_at) > Date.now())
      .sort((left, right) => Date.parse(left.game.starts_at) - Date.parse(right.game.starts_at))[0]
      ?.game;
  const total = logs.reduce((sum, line) => sum + (line.scored ?? 0), 0);
  const lastUpdated = stats[0]?.updated_at;
  const metrics = playerMetrics(athlete?.bio ?? {}, history, BETA_SEASON);
  const baseline = gameProjection(metrics.projectedPoints, metrics.projectedGames);
  const visibleHistory = useMemo(
    () => history.filter((item) => !season || item.season_label === season),
    [history, season],
  );
  const shownEvents = events.slice(0, 50);

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
      {!access.allowed || loading ? (
        <LoadingState label="Loading player statistics" rows={4} />
      ) : !athlete ? (
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
          <Card style={styles.playerHero}>
            <DraftPlayerPhoto
              player={{ displayName: athlete.display_name, bio: athlete.bio }}
              size={112}
              eager
            />
            <View style={{ flex: 1, minWidth: 150, gap: 8 }}>
              <Text style={uiStyles.body}>
                {programNames[String(athlete.bio.program)] ?? 'Brock athlete'},{' '}
                {athlete.bio.sourcePosition ?? athlete.position}
                {athlete.jersey_number !== null ? `, #${athlete.jersey_number}` : ''}
                {athlete.bio.eligibility ? `, ${athlete.bio.eligibility}` : ''}
              </Text>
              {athlete.bio.major || athlete.bio.hometown ? (
                <Text style={uiStyles.body}>
                  {[athlete.bio.major, athlete.bio.hometown].filter(Boolean).join(', ')}
                </Text>
              ) : null}
              <Text style={uiStyles.body}>Height, {metrics.heightLabel}</Text>
            </View>
          </Card>
          <View style={styles.summary}>
            <Card style={styles.metric}>
              <View style={styles.metricHeading}>
                <Text style={styles.metricLabel}>{BETA_SEASON} PROJECTED FP</Text>
                <InfoButton topic="projection" />
              </View>
              <Text style={styles.metricValue}>{metrics.projectedPoints ?? '—'}</Text>
            </Card>
            <Card style={styles.metric}>
              <View style={styles.metricHeading}>
                <Text style={styles.metricLabel}>CURRENT POINTS</Text>
                <InfoButton topic="points" />
              </View>
              <Text style={styles.metricValue}>{formatFantasyPoints(total)}</Text>
            </Card>
            <Card style={styles.metric}>
              <View style={styles.metricHeading}>
                <Text style={styles.metricLabel}>ADP</Text>
                <InfoButton topic="adp" />
              </View>
              <Text style={styles.metricValue}>
                {adp?.average?.toFixed(1) ?? metrics.suppliedAdp?.toFixed(1) ?? '—'}
              </Text>
              {adpError ? (
                <Text accessibilityRole="alert" style={styles.note}>
                  {adpError}
                </Text>
              ) : null}
            </Card>
            <Card style={styles.metric}>
              <View style={styles.metricHeading}>
                <Text style={styles.metricLabel}>NEXT GAME / LOCK</Text>
                <InfoButton topic="locks" />
              </View>
              <Text style={styles.next}>
                {nextGame ? gameTime(nextGame.starts_at) : 'No scheduled game'}
              </Text>
              <Text style={styles.note}>
                Locks at scheduled game start and unlocks when that game is marked finished.
              </Text>
            </Card>
          </View>
          <PlayerTradeAction athleteId={id} leagueId={leagueId} />
          <SectionTitle
            title="Season schedule and game log"
            detail={`${memberships.flatMap((membership) => membership.positions).join(' / ') || athlete.position}, ${lastUpdated ? `updated ${new Date(lastUpdated).toLocaleString()}` : 'No current statistics'}`}
          />
          {!logs.length ? (
            <EmptyState
              title="No game logs"
              body="Regular-season and confirmed playoff fixtures appear here as schedules are synced."
            />
          ) : (
            <Card>
              {logs.map((line, index) => (
                <View
                  key={line.game_id}
                  style={[styles.log, index === logs.length - 1 && uiStyles.lastRow]}
                >
                  <View style={styles.logCopy}>
                    <Text style={styles.logDate}>{gameTime(line.game.starts_at)}</Text>
                    <Text style={styles.note}>
                      {line.game.neutral_site
                        ? 'Neutral, vs '
                        : line.game.home_team_id &&
                            memberships.some(
                              (membership) => membership.team_id === line.game.home_team_id,
                            )
                          ? 'vs '
                          : '@ '}
                      {firstRelated(
                        memberships.some(
                          (membership) => membership.team_id === line.game.home_team_id,
                        )
                          ? line.game.away
                          : line.game.home,
                      )?.name ?? 'Opponent pending'}
                      , {line.game.status}
                    </Text>
                    {line.game.schedule_confirmed === false ? <PendingConfirmation /> : null}
                    {Object.keys(line.stats).length ? (
                      <Text style={styles.note}>
                        {Object.entries(line.stats)
                          .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value ?? '—'}`)
                          .join(', ')}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.points}>
                    {line.complete && line.scored !== null
                      ? `${formatFantasyPoints(line.scored)} pts`
                      : ['cancelled', 'postponed'].includes(line.game.status)
                        ? line.game.status
                        : Date.parse(line.game.starts_at) <= Date.now()
                          ? `Stats pending, estimate ${projectedPoints(baseline)}`
                          : `Projected: ${projectedPoints(baseline)}`}
                  </Text>
                </View>
              ))}
            </Card>
          )}
          <SectionTitle
            title="Scoring breakdown"
            detail="How each game contributes to your score"
          />
          <Card>
            {shownEvents.map((event, index) => (
              <View
                key={`${event.game_id}-${event.stat_key}-${index}`}
                style={[styles.event, index === shownEvents.length - 1 && uiStyles.lastRow]}
              >
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
            {visibleHistory.map((item, index) => (
              <View
                key={`${item.season_label}-${item.kind}-${index}`}
                style={[styles.history, index === visibleHistory.length - 1 && uiStyles.lastRow]}
              >
                <View>
                  <Text style={styles.logDate}>
                    {item.season_label}, {item.kind.replaceAll('_', ' ')}
                  </Text>
                  <Text style={styles.note}>{item.games_played ?? '—'} games, supplied record</Text>
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
          <View style={{ marginTop: 24, gap: 24 }}>
            <PlayerForecastPanel athleteId={id} />
            <HistoricalGameLogs athleteId={id} />
          </View>
        </>
      )}
      <View style={styles.backToPlayers}>
        <ActionButton label="Back to players" href="/players" variant="secondary" />
      </View>
    </AppShell>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    backToPlayers: { marginTop: 20 },
    playerHero: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 24,
      alignItems: 'center',
      marginBottom: 20,
    },
    error: { fontFamily: 'Inter', color: colors.text, fontSize: 12, marginBottom: 12 },
    summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 22 },
    metric: { flex: 1, minWidth: 190, gap: 5 },
    metricHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    metricLabel: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
    },
    metricValue: { fontFamily: 'Inter', color: colors.text, fontWeight: '900', fontSize: 28 },
    next: { fontFamily: 'Inter', color: colors.text, fontWeight: '700', fontSize: 13 },
    note: { fontFamily: 'Inter', color: colors.muted, fontSize: 10, lineHeight: 15 },
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
    logDate: { fontFamily: 'Inter', color: colors.text, fontSize: 12, fontWeight: '800' },
    points: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    event: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 8,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    eventKey: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 11,
      textTransform: 'capitalize',
    },
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
      fontFamily: 'Inter',
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

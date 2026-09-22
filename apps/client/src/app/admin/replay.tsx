import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createHeading, useThemedStyles, type ThemeColors } from '@/theme';

interface ReplayGameOption {
  id: string;
  competitionName: string;
  startsAt: string;
  gameStatus: string;
  provider: string;
  sourceIdentity: string;
  capturedAt: string;
  processedAt: string | null;
}

interface ReplayChange {
  fantasyTeamName: string;
  athleteName: string;
  statLabel: string;
  statValue: number;
  currentPoints: number;
  projectedPoints: number;
  delta: number;
}

interface ReplayPreview {
  gameId: string;
  gameStatus: string;
  sourceIdentity: string | null;
  currentPoints: number;
  projectedPoints: number;
  delta: number;
  eventCount: number;
  ingestionPaused: boolean;
  unresolvedErrors: number;
  canReplay: boolean;
  changes: ReplayChange[];
}

interface SnapshotRecord {
  game_id: string;
  provider: string;
  source_identity: string;
  captured_at: string;
  processed_at: string | null;
}

interface GameRecord {
  id: string;
  competition_id: string;
  starts_at: string;
  status: string;
}

const demoGames: ReplayGameOption[] = [
  {
    id: 'demo-game-1',
    competitionName: "Men's Hockey",
    startsAt: new Date(Date.now() - 7_200_000).toISOString(),
    gameStatus: 'in_progress',
    provider: 'approved-provider',
    sourceIdentity: 'approved-provider:game-2026-009:revision-4',
    capturedAt: new Date(Date.now() - 60_000).toISOString(),
    processedAt: null,
  },
  {
    id: 'demo-game-2',
    competitionName: "Women's Basketball",
    startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    gameStatus: 'final',
    provider: 'approved-provider',
    sourceIdentity: 'approved-provider:game-2026-104:revision-2',
    capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
    processedAt: new Date(Date.now() - 3_500_000).toISOString(),
  },
];

const demoPreview: ReplayPreview = {
  gameId: 'demo-game-1',
  gameStatus: 'in_progress',
  sourceIdentity: 'approved-provider:game-2026-009:revision-4',
  currentPoints: 72.5,
  projectedPoints: 78.5,
  delta: 6,
  eventCount: 2,
  ingestionPaused: false,
  unresolvedErrors: 0,
  canReplay: true,
  changes: [
    {
      fantasyTeamName: 'Power Playmakers',
      athleteName: 'Avery Campbell',
      statLabel: 'Goals',
      statValue: 2,
      currentPoints: 3,
      projectedPoints: 6,
      delta: 3,
    },
    {
      fantasyTeamName: 'Power Playmakers',
      athleteName: 'Jordan Lee',
      statLabel: 'Assists',
      statValue: 2,
      currentPoints: 1,
      projectedPoints: 4,
      delta: 3,
    },
  ],
};

export default function AdminReplayScreen() {
  useRequireAdmin();
  const { demoMode, user } = useSession();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const [games, setGames] = useState<ReplayGameOption[]>(demoMode ? demoGames : []);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(
    demoMode ? (demoGames[0]?.id ?? null) : null,
  );
  const [preview, setPreview] = useState<ReplayPreview | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) {
      setGames(demoGames);
      setSelectedGameId(demoGames[0]?.id ?? null);
      setLoading(false);
      return;
    }
    if (!supabase || !user) return;
    const client = supabase;
    const load = async () => {
      const snapshotResult = await client
        .from('provider_snapshots')
        .select('game_id, provider, source_identity, captured_at, processed_at')
        .order('captured_at', { ascending: false })
        .limit(50);
      if (snapshotResult.error) {
        setLoading(false);
        setError(snapshotResult.error.message);
        return;
      }
      const latestByGame = new Map<string, SnapshotRecord>();
      for (const snapshot of snapshotResult.data as SnapshotRecord[]) {
        if (!latestByGame.has(snapshot.game_id)) latestByGame.set(snapshot.game_id, snapshot);
      }
      const gameIds = [...latestByGame.keys()];
      if (gameIds.length === 0) {
        setLoading(false);
        return;
      }
      const gameResult = await client
        .from('games')
        .select('id, competition_id, starts_at, status')
        .in('id', gameIds);
      if (gameResult.error) {
        setLoading(false);
        setError(gameResult.error.message);
        return;
      }
      const competitionIds = [
        ...new Set((gameResult.data as GameRecord[]).map((game) => game.competition_id)),
      ];
      const competitionResult = await client
        .from('competitions')
        .select('id, name')
        .in('id', competitionIds);
      setLoading(false);
      if (competitionResult.error) {
        setError(competitionResult.error.message);
        return;
      }
      const competitionNames = new Map(
        (competitionResult.data as { id: string; name: string }[]).map((competition) => [
          competition.id,
          competition.name,
        ]),
      );
      const nextGames = (gameResult.data as GameRecord[])
        .map((game) => {
          const snapshot = latestByGame.get(game.id);
          if (!snapshot) return null;
          return {
            id: game.id,
            competitionName: competitionNames.get(game.competition_id) ?? 'Unknown competition',
            startsAt: game.starts_at,
            gameStatus: game.status,
            provider: snapshot.provider,
            sourceIdentity: snapshot.source_identity,
            capturedAt: snapshot.captured_at,
            processedAt: snapshot.processed_at,
          };
        })
        .filter((game): game is ReplayGameOption => game !== null)
        .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
      setGames(nextGames);
      setSelectedGameId(nextGames[0]?.id ?? null);
    };
    void load();
  }, [demoMode, user]);

  const generatePreview = async () => {
    if (!selectedGameId) return;
    setWorking(true);
    setError(null);
    setPreview(null);
    if (demoMode) {
      const selected = games.find((game) => game.id === selectedGameId);
      setPreview(
        selectedGameId === demoPreview.gameId
          ? demoPreview
          : {
              ...demoPreview,
              gameId: selectedGameId,
              gameStatus: selected?.gameStatus ?? 'final',
              sourceIdentity: selected?.sourceIdentity ?? null,
              currentPoints: 91,
              projectedPoints: 91,
              delta: 0,
              eventCount: 0,
              changes: [],
            },
      );
      setWorking(false);
      return;
    }
    if (!supabase) return;
    const result = await supabase.rpc('preview_game_replay', { p_game_id: selectedGameId });
    setWorking(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    try {
      setPreview(parsePreview(result.data));
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Replay preview was invalid.');
    }
  };

  return (
    <AppShell
      eyebrow="Restricted scoring operations"
      title="Score replay preview"
      action={<Pill label="READ ONLY · MFA REQUIRED" tone="info" />}
    >
      <Card style={styles.summary}>
        <Text style={styles.summaryTitle}>Inspect the delta before replay</Text>
        <Text style={uiStyles.body}>
          This screen calculates the same score targets as the replay command without inserting
          point events, changing matchup totals, or marking a snapshot processed. Resolve mapping or
          ingestion errors and resume the competition before any replay.
        </Text>
        <View style={styles.summaryActions}>
          <ActionButton label="Back to operations" href="/admin" variant="ghost" />
          <ActionButton label="Review mappings" href="/admin/mappings" variant="secondary" />
        </View>
      </Card>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <SectionTitle title="Snapshot game" detail={`${games.length} available`} />
      {!loading && games.length === 0 ? (
        <EmptyState
          title="No provider snapshots"
          body="Ingest an approved provider or manual snapshot before generating a replay preview."
        />
      ) : null}
      <View accessibilityRole="radiogroup" style={styles.gameList}>
        {games.map((game) => {
          const selected = game.id === selectedGameId;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              key={game.id}
              onPress={() => {
                setSelectedGameId(game.id);
                setPreview(null);
              }}
              style={[styles.gameOption, selected && styles.gameOptionSelected]}
            >
              <View style={styles.gameCopy}>
                <Text style={styles.gameName}>{game.competitionName}</Text>
                <Text style={styles.gameMeta}>
                  {formatTimestamp(game.startsAt)} · {game.provider} · {game.gameStatus}
                </Text>
                <Text numberOfLines={1} style={styles.sourceIdentity}>
                  {game.sourceIdentity}
                </Text>
              </View>
              <Pill
                label={game.processedAt ? 'PROCESSED' : 'PENDING'}
                tone={game.processedAt ? 'positive' : 'warning'}
              />
            </Pressable>
          );
        })}
      </View>
      {games.length > 0 ? (
        <View style={styles.previewAction}>
          <ActionButton
            disabled={!selectedGameId}
            label="Generate read-only preview"
            loading={working}
            onPress={() => void generatePreview()}
          />
        </View>
      ) : null}

      {preview ? <PreviewResult preview={preview} /> : null}
    </AppShell>
  );
}

function PreviewResult({ preview }: { preview: ReplayPreview }) {
  const styles = useStyles();
  return (
    <>
      <SectionTitle title="Projected replay" detail={`${preview.eventCount} point events`} />
      <View style={styles.metrics}>
        <PreviewMetric
          label="Current generated points"
          value={formatPoints(preview.currentPoints)}
        />
        <PreviewMetric
          label="Projected generated points"
          value={formatPoints(preview.projectedPoints)}
        />
        <PreviewMetric label="Net delta" value={formatSignedPoints(preview.delta)} />
      </View>
      <Card style={[styles.readiness, !preview.canReplay && styles.readinessBlocked]}>
        <View style={styles.headingRow}>
          <Text style={styles.readinessTitle}>
            {preview.canReplay ? 'No replay blockers detected' : 'Replay is blocked'}
          </Text>
          <Pill
            label={preview.canReplay ? 'READY FOR REVIEW' : 'ACTION REQUIRED'}
            tone={preview.canReplay ? 'positive' : 'warning'}
          />
        </View>
        {preview.ingestionPaused ? (
          <Text style={styles.blocker}>Competition ingestion is paused.</Text>
        ) : null}
        {preview.unresolvedErrors > 0 ? (
          <Text style={styles.blocker}>
            {preview.unresolvedErrors} unresolved ingestion error
            {preview.unresolvedErrors === 1 ? '' : 's'}.
          </Text>
        ) : null}
        {!preview.sourceIdentity ? (
          <Text style={styles.blocker}>No provider source identity is available.</Text>
        ) : null}
        <Text selectable style={styles.previewSource}>
          {preview.sourceIdentity ?? 'No source identity'}
        </Text>
      </Card>

      <SectionTitle title="Point changes" />
      {preview.changes.length === 0 ? (
        <EmptyState
          title="Replay is already balanced"
          body="Generated score events already match the normalized statistics for this game."
        />
      ) : (
        <View style={styles.changeList}>
          {preview.changes.map((change, index) => (
            <Card
              key={`${change.fantasyTeamName}-${change.athleteName}-${change.statLabel}-${index}`}
              style={styles.changeCard}
            >
              <View style={styles.changeCopy}>
                <Text style={styles.changeTitle}>{change.athleteName}</Text>
                <Text style={styles.changeMeta}>
                  {change.fantasyTeamName} · {change.statLabel} = {change.statValue}
                </Text>
              </View>
              <View style={styles.changePoints}>
                <Text style={styles.changeCalculation}>
                  {formatPoints(change.currentPoints)} → {formatPoints(change.projectedPoints)}
                </Text>
                <Text style={styles.changeDelta}>{formatSignedPoints(change.delta)}</Text>
              </View>
            </Card>
          ))}
        </View>
      )}
    </>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <Card style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Card>
  );
}

function parsePreview(value: unknown): ReplayPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Replay preview returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  const changes = Array.isArray(record.changes) ? record.changes : [];
  return {
    gameId: readString(record.game_id) ?? '',
    gameStatus: readString(record.game_status) ?? 'unknown',
    sourceIdentity: readString(record.source_identity),
    currentPoints: readNumber(record.current_points),
    projectedPoints: readNumber(record.projected_points),
    delta: readNumber(record.delta),
    eventCount: readNumber(record.event_count),
    ingestionPaused: record.ingestion_paused === true,
    unresolvedErrors: readNumber(record.unresolved_errors),
    canReplay: record.can_replay === true,
    changes: changes.map((change) => parseChange(change)),
  };
}

function parseChange(value: unknown): ReplayChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Replay preview contained an invalid point change.');
  }
  const record = value as Record<string, unknown>;
  return {
    fantasyTeamName: readString(record.fantasy_team_name) ?? 'Unknown fantasy team',
    athleteName: readString(record.athlete_name) ?? 'Unknown athlete',
    statLabel: readString(record.stat_label) ?? readString(record.stat_key) ?? 'Unknown stat',
    statValue: readNumber(record.stat_value),
    currentPoints: readNumber(record.current_points),
    projectedPoints: readNumber(record.projected_points),
    delta: readNumber(record.delta),
  };
}

function readNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatPoints(value: number) {
  return value
    .toFixed(3)
    .replace(/\.000$/u, '.0')
    .replace(/(\.\d*[1-9])0+$/u, '$1');
}

function formatSignedPoints(value: number) {
  return `${value > 0 ? '+' : ''}${formatPoints(value)}`;
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    summary: { gap: 10 },
    summaryTitle: { ...createHeading(colors), fontSize: 18 },
    summaryActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
    gameList: { gap: 10 },
    gameOption: {
      backgroundColor: colors.panel,
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      minHeight: 76,
      padding: 14,
    },
    gameOptionSelected: { backgroundColor: colors.selected, borderColor: colors.brand },
    gameCopy: { flex: 1, minWidth: 230 },
    gameName: { ...createHeading(colors), fontSize: 16 },
    gameMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
    sourceIdentity: { color: colors.brand, fontFamily: 'monospace', fontSize: 9, marginTop: 5 },
    previewAction: { alignItems: 'flex-end', marginTop: 14 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    metric: { flex: 1, minWidth: 190 },
    metricValue: { color: colors.brand, fontSize: 27, fontWeight: '900' },
    metricLabel: { color: colors.muted, fontSize: 10, marginTop: 5 },
    readiness: { gap: 8, marginTop: 14 },
    readinessBlocked: { backgroundColor: colors.warningSurface },
    headingRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    readinessTitle: { ...createHeading(colors), fontSize: 16 },
    blocker: { color: colors.danger, fontSize: 12, fontWeight: '700' },
    previewSource: { color: colors.muted, fontFamily: 'monospace', fontSize: 9 },
    changeList: { gap: 10 },
    changeCard: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
    },
    changeCopy: { flex: 1, minWidth: 220 },
    changeTitle: { ...createHeading(colors), fontSize: 15 },
    changeMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
    changePoints: { alignItems: 'flex-end' },
    changeCalculation: { color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
    changeDelta: {
      color: colors.brand,
      fontSize: 14,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
      marginTop: 3,
    },
    error: { color: colors.danger, fontWeight: '700', marginTop: 14 },
  });

const useStyles = () => useThemedStyles(createStyles);

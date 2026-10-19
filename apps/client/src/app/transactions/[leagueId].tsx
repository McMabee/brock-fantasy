import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePlayerInsights } from '@/hooks/use-player-insights';
import {
  PlayerInsightsPanel,
  projectedPoints,
  PendingConfirmation,
} from '@/components/player-insights';
import { DraftPlayerPhoto } from '@/components/draft-player-panel';
import { positionLabel } from '@/lib/roster-guide';
import { programNames } from '@/lib/player-program';
import { useParticipation } from '@/hooks/use-participation';

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
import { useLeague } from '@/hooks/use-league';
import { useTransactions } from '@/hooks/use-transactions';
import { betaCommand } from '@/lib/web-api';

import { useActionFeedback } from '@/providers/action-feedback-provider';
import { InfoButton } from '@/components/info-button';
import { useRequireUser } from '@/hooks/use-route-access';

export default function TransactionsScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const colors = useThemeColors();
  useRequireUser();
  const {
    leagueId,
    q,
    program: initialProgram,
    position: initialPosition,
    sort: initialSort,
  } = useLocalSearchParams<{
    leagueId: string;
    q?: string;
    program?: string;
    position?: string;
    sort?: string;
  }>();
  const router = useRouter();
  const leagueData = useLeague(leagueId);
  const insights = usePlayerInsights(leagueData.league?.playerPoolId);
  const participation = useParticipation();
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [search, setSearch] = useState(q ?? '');
  const [program, setProgram] = useState(initialProgram ?? 'all');
  const [position, setPosition] = useState(initialPosition ?? 'all');
  const [sort, setSort] = useState<'next' | 'season' | 'adp' | 'name'>(
    initialSort === 'season' || initialSort === 'adp' || initialSort === 'name'
      ? initialSort
      : 'next',
  );
  useEffect(() => {
    router.setParams({ q: search, program, position, sort });
  }, [search, program, position, sort, router]);
  const transactions = useTransactions({
    leagueId,
    myTeamId: leagueData.myTeamId,
    competitionId: leagueData.league?.competitionId,
    ...(leagueData.league?.playerPoolId ? { playerPoolId: leagueData.league.playerPoolId } : {}),
    rulesetId: leagueData.league?.rulesetId,
  });
  const [dropAthleteId, setDropAthleteId] = useState<string | null>(null);
  const [receivingTeamId, setReceivingTeamId] = useState('');
  const [offeredAthleteId, setOfferedAthleteId] = useState('');
  const [requestedAthleteId, setRequestedAthleteId] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const actionKeys = useRef(new Map<string, string>());
  const actionBusy = useRef(false);
  const showFeedback = useActionFeedback();
  const actionKey = (label: string) => {
    let key = actionKeys.current.get(label);
    if (!key) {
      key = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      actionKeys.current.set(label, key);
    }
    return key;
  };
  const [message, setMessage] = useState<string | null>(null);
  const programs = useMemo(
    () =>
      [
        ...new Set(
          transactions.freeAgents.map(
            (athlete) => insights.byId.get(athlete.id)?.program ?? athlete.program,
          ),
        ),
      ].sort(),
    [insights.byId, transactions.freeAgents],
  );
  const available = useMemo(() => {
    // - Cache joins and normalized search keys before filtering and sorting
    const query = search.trim().toLocaleLowerCase();
    const rows = transactions.freeAgents
      .flatMap((athlete) => {
        const player = insights.byId.get(athlete.id);
        if (leagueData.league?.playerPoolId && !insights.loading && !insights.error && !player)
          return [];
        return [{ ...athlete, player, key: athlete.displayName.toLocaleLowerCase() }];
      })
      .filter(
        (row) =>
          (!query || row.key.includes(query)) &&
          (program === 'all' || (row.player?.program ?? row.program) === program) &&
          (position === 'all' ||
            position === 'FLEX' ||
            (row.player?.positions ?? row.position.split(/\s*[/,;]\s*/u)).includes(position)),
      );
    return rows.sort((left, right) => {
      const a =
        sort === 'next'
          ? left.player?.nextProjection
          : sort === 'season'
            ? left.player?.seasonProjection
            : left.player?.adp;
      const b =
        sort === 'next'
          ? right.player?.nextProjection
          : sort === 'season'
            ? right.player?.seasonProjection
            : right.player?.adp;
      if (sort !== 'name') {
        if (a == null && b != null) return 1;
        if (a != null && b == null) return -1;
        if (a != null && b != null && a !== b) return sort === 'adp' ? a - b : b - a;
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }, [
    transactions.freeAgents,
    insights.byId,
    insights.loading,
    insights.error,
    leagueData.league?.playerPoolId,
    search,
    program,
    position,
    sort,
  ]);
  const myTeamId = leagueData.myTeamId;
  const myAssets = transactions.rosterAssets.filter((asset) => asset.fantasyTeamId === myTeamId);
  const otherTeams = leagueData.teams.filter((team) => team.id !== myTeamId);
  const requestedAssets = transactions.rosterAssets.filter(
    (asset) => asset.fantasyTeamId === receivingTeamId,
  );

  useEffect(() => {
    if (!receivingTeamId && otherTeams[0]) setReceivingTeamId(otherTeams[0].id);
  }, [otherTeams, receivingTeamId]);

  const invoke = async (label: string, command: () => Promise<{ error: string | null }>) => {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setWorking(label);
    setMessage(null);
    try {
      const result = await command();
      if (result.error) {
        setMessage(result.error);
        showFeedback({ title: result.error, tone: 'error' });
      } else {
        actionKeys.current.clear();
        const receipt = (
          result as { data?: { process_after?: string; trade_id?: string; status?: string } }
        ).data;
        const text = label.startsWith('request_waiver')
          ? `Waiver claim submitted${receipt?.process_after ? ' — processes ' + new Date(receipt.process_after).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) : ''}. Check My claims for the outcome.`
          : label.startsWith('add_free_agent')
            ? 'Athlete added to your roster.'
            : label === 'propose-trade'
              ? 'Trade proposal sent.'
              : label.startsWith('trade-response')
                ? 'Trade response saved. Accepted trades enter review before athletes move.'
                : label.startsWith('trade-cancel')
                  ? 'Trade proposal cancelled.'
                  : 'Trade veto vote recorded.';
        setMessage(text);
        showFeedback({
          title: text,
          tone: 'success',
          ...(receipt?.trade_id && (label === 'propose-trade' || label.startsWith('trade-response'))
            ? { eventKey: `trade:${receipt.trade_id}:${receipt.status ?? 'proposed'}` }
            : label.startsWith('trade-cancel:')
              ? { eventKey: `trade:${label.slice('trade-cancel:'.length)}:cancelled` }
              : {}),
        });
        setDropAthleteId(null);
        const refreshed = await Promise.allSettled([
          transactions.reload(),
          leagueData.reload(),
          insights.reload(),
        ]);
        if (refreshed.some((result) => result.status === 'rejected' || result.value === false))
          setMessage(
            'Your transaction was saved, but the latest lists could not load. Refresh to see the result.',
          );
      }
    } catch {
      const error =
        'The transaction result could not be confirmed. Retry to safely check the same request.';
      setMessage(error);
      showFeedback({ title: error, tone: 'error' });
    } finally {
      actionBusy.current = false;
      setWorking(null);
    }
  };

  const addOrClaim = async (athleteId: string, waiver: boolean) => {
    if (!myTeamId) return;
    const command = waiver ? 'request_waiver' : 'add_free_agent';
    await invoke(`${command}:${athleteId}`, async () => {
      return betaCommand(command, {
        p_fantasy_team_id: myTeamId,
        p_athlete_in_id: athleteId,
        p_athlete_out_id: dropAthleteId,
        p_idempotency_key: actionKey(`${command}:${athleteId}:${dropAthleteId ?? 'none'}`),
      });
    });
  };

  const proposeTrade = async () => {
    if (!myTeamId || !receivingTeamId || !offeredAthleteId || !requestedAthleteId) return;
    await invoke('propose-trade', async () => {
      return betaCommand('propose_trade', {
        p_proposing_team_id: myTeamId,
        p_receiving_team_id: receivingTeamId,
        p_offered_athlete_ids: [offeredAthleteId],
        p_requested_athlete_ids: [requestedAthleteId],
        p_expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        p_idempotency_key: actionKey(
          `trade:${receivingTeamId}:${offeredAthleteId}:${requestedAthleteId}`,
        ),
      });
    });
  };

  const respond = async (tradeId: string, accept: boolean) => {
    await invoke(`trade-response:${tradeId}`, async () => {
      return betaCommand('respond_to_trade', {
        p_trade_id: tradeId,
        p_accept: accept,
        p_idempotency_key: actionKey(`response:${tradeId}:${accept}`),
      });
    });
  };

  const cancel = async (tradeId: string) => {
    await invoke(`trade-cancel:${tradeId}`, async () => {
      return betaCommand('cancel_trade', {
        p_trade_id: tradeId,
        p_idempotency_key: actionKey(`cancel:${tradeId}`),
      });
    });
  };

  const vote = async (tradeId: string) => {
    await invoke(`trade-vote:${tradeId}`, async () => {
      return betaCommand('vote_trade', {
        p_trade_id: tradeId,
        p_idempotency_key: `trade-vote-${tradeId}`,
      });
    });
  };

  const athleteNames = useMemo(
    () =>
      new Map(
        [...transactions.freeAgents, ...transactions.rosterAssets].map((athlete) => [
          athlete.id,
          athlete.displayName,
        ]),
      ),
    [transactions.freeAgents, transactions.rosterAssets],
  );
  const teamNames = useMemo(
    () => new Map(leagueData.teams.map((team) => [team.id, team.name])),
    [leagueData.teams],
  );
  const athleteName = (athleteId: string) => athleteNames.get(athleteId) ?? 'Unknown athlete';
  const teamName = (teamId: string) => teamNames.get(teamId) ?? 'Unknown team';

  if ((leagueData.loading || transactions.loading) && transactions.freeAgents.length === 0)
    return (
      <AppShell eyebrow="League management" title="Transactions">
        <LoadingState label="Loading league transactions" rows={4} />
      </AppShell>
    );
  return (
    <AppShell eyebrow="Roster moves" title="Transactions">
      {leagueData.error || transactions.error || message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {leagueData.error ?? transactions.error ?? message}
        </Text>
      ) : null}
      <SectionTitle title="Drop choice" detail="Optional unless your roster is full" />
      {participation.error ? (
        <Card>
          <Text accessibilityRole="alert" style={uiStyles.body}>
            {participation.error}
          </Text>
          <ActionButton
            label="Retry account participation"
            onPress={() => void participation.reload()}
            variant="secondary"
          />
        </Card>
      ) : null}
      {myAssets.length >= 10 && !dropAthleteId ? (
        <Text style={uiStyles.body}>
          Your roster is full. Select an athlete to replace before adding or claiming someone.
        </Text>
      ) : null}
      <View style={styles.choices}>
        <Choice label="No drop" selected={!dropAthleteId} onPress={() => setDropAthleteId(null)} />
        {myAssets.map((asset) => (
          <Choice
            key={asset.id}
            label={`${asset.displayName} · ${positionLabel(asset.position)}`}
            selected={dropAthleteId === asset.id}
            onPress={() => setDropAthleteId(asset.id)}
          />
        ))}
      </View>

      <SectionTitle
        title="Available athletes"
        detail={`${available.length} shown · ${transactions.freeAgents.length} unrostered`}
      />
      <Card style={{ gap: 12 }}>
        <TextInput
          accessibilityLabel="Search available athletes"
          placeholder="Search by athlete name"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          style={uiStyles.input}
        />
        <Text style={uiStyles.label}>Program</Text>
        <View style={styles.choices}>
          {['all', ...programs].map((value) => (
            <Choice
              key={value}
              label={value === 'all' ? 'All programs' : (programNames[value] ?? value)}
              selected={program === value}
              onPress={() => setProgram(value)}
            />
          ))}
        </View>
        <Text style={uiStyles.label}>Eligible position</Text>
        <View style={styles.choices}>
          {['all', 'F', 'D', 'G', 'BC', 'FC', 'HT', 'L', 'S', 'FLEX'].map((value) => (
            <Choice
              key={value}
              label={
                value === 'all'
                  ? 'All positions'
                  : value === 'FLEX'
                    ? 'FLEX · any athlete'
                    : positionLabel(value)
              }
              selected={position === value}
              onPress={() => setPosition(value)}
            />
          ))}
        </View>
        <Text style={uiStyles.label}>Sort</Text>
        <View style={styles.choices}>
          {(['next', 'season', 'adp', 'name'] as const).map((value) => (
            <Choice
              key={value}
              label={
                {
                  next: 'Next-period projection',
                  season: 'Season projection',
                  adp: 'ADP',
                  name: 'Name',
                }[value]
              }
              selected={sort === value}
              onPress={() => setSort(value)}
            />
          ))}
        </View>
        {insights.players[0]?.period ? (
          <Text style={uiStyles.body}>
            Next fantasy period {insights.players[0].period.number}:{' '}
            {new Date(insights.players[0].period.startsAt).toLocaleDateString('en-CA', {
              timeZone: 'America/Toronto',
            })}{' '}
            –{' '}
            {new Date(insights.players[0].period.endsAt).toLocaleDateString('en-CA', {
              timeZone: 'America/Toronto',
            })}
          </Text>
        ) : null}
        {insights.error ? (
          <View style={{ gap: 10 }}>
            <Text accessibilityRole="alert" style={uiStyles.body}>
              {insights.error}
            </Text>
            <ActionButton
              label="Retry athlete stats"
              onPress={() => void insights.reload()}
              variant="secondary"
            />
          </View>
        ) : null}
      </Card>
      {available.length === 0 ? (
        <EmptyState
          title="No free agents"
          body={
            search || program !== 'all' || position !== 'all'
              ? 'No athletes match these filters. Try another program, position or name.'
              : 'No unrostered athletes are available in this league.'
          }
        />
      ) : (
        <Card>
          {available.map((athlete, index) => {
            const programCode =
              athlete.player?.programCode ?? athlete.player?.bio.program ?? athlete.bio.program;
            const restricted = Boolean(
              participation.participation?.programs.some((program) => program === programCode),
            );
            const disabled =
              Boolean(working) ||
              !myTeamId ||
              restricted ||
              participation.loading ||
              Boolean(participation.error) ||
              (myAssets.length >= 10 && !dropAthleteId);
            return (
              <View
                key={athlete.id}
                style={[styles.assetRow, index === available.length - 1 && uiStyles.lastRow]}
              >
                <View style={styles.assetCopy}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Insights for ${athlete.displayName}`}
                    onPress={() => setAthleteId(athlete.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  >
                    <DraftPlayerPhoto player={athlete.player ?? athlete} size={56} />
                    <Text style={[styles.assetName, { flexShrink: 1 }]}>
                      {athlete.displayName} ↗
                    </Text>
                  </Pressable>
                  <Text style={styles.assetMeta}>
                    {programNames[athlete.player?.program ?? athlete.program] ??
                      athlete.player?.program ??
                      athlete.program}{' '}
                    · {athlete.player?.team ?? athlete.team} · {positionLabel(athlete.position)}
                  </Text>
                  <Text style={styles.assetMeta}>
                    Next period: {projectedPoints(athlete.player?.nextProjection)} · Season
                    projection: {projectedPoints(athlete.player?.seasonProjection)} · ADP:{' '}
                    {athlete.player?.adp?.toFixed(1) ?? 'Unavailable'}
                  </Text>
                  {athlete.player?.pending ? <PendingConfirmation /> : null}
                  {restricted ? (
                    <Text style={styles.assetMeta}>
                      Your varsity program · unavailable to your account
                    </Text>
                  ) : null}
                </View>
                {transactions.freeAgentsEnabled ? (
                  <ActionButton
                    label="Add now"
                    onPress={() => void addOrClaim(athlete.id, false)}
                    loading={working === `add_free_agent:${athlete.id}`}
                    variant="secondary"
                    disabled={disabled}
                  />
                ) : null}
                {transactions.waiversEnabled ? (
                  <ActionButton
                    label="Waiver claim"
                    disabled={disabled}
                    onPress={() => void addOrClaim(athlete.id, true)}
                    loading={working === `request_waiver:${athlete.id}`}
                  />
                ) : null}
              </View>
            );
          })}
        </Card>
      )}

      {transactions.tradesEnabled ? (
        <>
          <SectionTitle
            title="Propose a one-for-one trade"
            detail="Assets are revalidated atomically at acceptance"
          />
          <Card style={styles.tradeBuilder}>
            <Text style={uiStyles.label}>Trade with</Text>
            <View style={styles.choices}>
              {otherTeams.map((team) => (
                <Choice
                  key={team.id}
                  label={team.name}
                  selected={receivingTeamId === team.id}
                  onPress={() => {
                    setReceivingTeamId(team.id);
                    setRequestedAthleteId('');
                  }}
                />
              ))}
            </View>
            <Text style={uiStyles.label}>You offer</Text>
            <View style={styles.choices}>
              {myAssets.map((asset) => (
                <Choice
                  key={asset.id}
                  label={asset.displayName}
                  selected={offeredAthleteId === asset.id}
                  onPress={() => setOfferedAthleteId(asset.id)}
                />
              ))}
            </View>
            <Text style={uiStyles.label}>You request</Text>
            <View style={styles.choices}>
              {requestedAssets.map((asset) => (
                <Choice
                  key={asset.id}
                  label={asset.displayName}
                  selected={requestedAthleteId === asset.id}
                  onPress={() => setRequestedAthleteId(asset.id)}
                />
              ))}
            </View>
            <ActionButton
              label="Send trade proposal"
              onPress={() => void proposeTrade()}
              disabled={!offeredAthleteId || !requestedAthleteId}
              loading={working === 'propose-trade'}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle title="My claims" />
      <InfoButton topic="waivers" />
      <Card>
        {transactions.claims.length ? (
          transactions.claims.map((claim) => (
            <View key={claim.id} style={{ gap: 6, paddingVertical: 12 }}>
              <Text style={uiStyles.body}>
                {athleteName(claim.athlete_in_id)}
                {claim.athlete_out_id
                  ? ` · conditional drop: ${athleteName(claim.athlete_out_id)}`
                  : ''}
              </Text>
              <Pill
                label={
                  claim.status === 'pending'
                    ? 'PENDING · NOT YET ACQUIRED'
                    : claim.status.toUpperCase()
                }
                tone={claim.status === 'successful' ? 'positive' : 'info'}
              />
              <Text style={uiStyles.body}>
                Processes{' '}
                {new Date(claim.process_after).toLocaleString('en-CA', {
                  timeZone: 'America/Toronto',
                })}
              </Text>
              {claim.outcome_reason ? (
                <Text style={uiStyles.body}>{claim.outcome_reason}</Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={uiStyles.body}>No waiver claims submitted.</Text>
        )}
      </Card>
      <SectionTitle title="Trade history" />
      <InfoButton topic="trades" />
      {transactions.trades.length === 0 ? (
        <EmptyState
          title="No trades"
          body="Proposed and completed trades will remain visible here."
        />
      ) : (
        <Card>
          {transactions.trades.map((trade, index) => {
            const offered = trade.items
              .filter((item) => item.fromTeamId === trade.proposingTeamId)
              .map((item) => athleteName(item.athleteId))
              .join(', ');
            const requested = trade.items
              .filter((item) => item.fromTeamId === trade.receivingTeamId)
              .map((item) => athleteName(item.athleteId))
              .join(', ');
            return (
              <View
                key={trade.id}
                style={[
                  styles.tradeRow,
                  index === transactions.trades.length - 1 && uiStyles.lastRow,
                ]}
              >
                <View style={styles.assetCopy}>
                  <View style={styles.tradeHeading}>
                    <Text style={styles.assetName}>
                      {teamName(trade.proposingTeamId)} ↔ {teamName(trade.receivingTeamId)}
                    </Text>
                    <Pill
                      label={trade.executionStatus.toUpperCase()}
                      tone={trade.executionStatus === 'completed' ? 'positive' : 'info'}
                    />
                  </View>
                  <Text style={styles.assetMeta}>
                    {offered || '—'} for {requested || '—'} · expires{' '}
                    {new Date(trade.expiresAt).toLocaleDateString()}
                    {trade.reviewEndsAt
                      ? ` · review ends ${new Date(trade.reviewEndsAt).toLocaleString()}`
                      : ''}
                  </Text>
                </View>
                {trade.status === 'proposed' && trade.receivingTeamId === myTeamId ? (
                  <View style={styles.rowActions}>
                    <ActionButton
                      label="Reject"
                      onPress={() => void respond(trade.id, false)}
                      variant="secondary"
                    />
                    <ActionButton label="Accept" onPress={() => void respond(trade.id, true)} />
                  </View>
                ) : null}
                {trade.status === 'proposed' && trade.proposingTeamId === myTeamId ? (
                  <ActionButton
                    label="Cancel"
                    onPress={() => void cancel(trade.id)}
                    variant="secondary"
                  />
                ) : null}
                {trade.status === 'accepted' &&
                myTeamId &&
                trade.proposingTeamId !== myTeamId &&
                trade.receivingTeamId !== myTeamId ? (
                  <ActionButton
                    label="Veto trade"
                    onPress={() => void vote(trade.id)}
                    loading={working === `trade-vote:${trade.id}`}
                    variant="secondary"
                  />
                ) : null}
              </View>
            );
          })}
        </Card>
      )}
      <View style={styles.footerActions}>
        <ActionButton
          label="Back to league"
          href={leagueId ? `/league/${leagueId}` : '/dashboard'}
          variant="ghost"
        />
      </View>
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

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    message: { fontFamily: 'Inter', color: colors.text, fontSize: 12, marginBottom: 10 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    choice: {
      minHeight: 44,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 8,
      backgroundColor: colors.canvasSoft,
    },
    choiceSelected: { borderColor: colors.red, backgroundColor: colors.canvasSoft },
    choiceText: { fontFamily: 'Inter', color: colors.muted, fontSize: 13, fontWeight: '700' },
    choiceTextSelected: { color: colors.text },
    assetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 18,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    assetCopy: { flex: 1, minWidth: 190 },
    assetName: { fontFamily: 'Inter', color: colors.text, fontSize: 16, fontWeight: '800' },
    assetMeta: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 13,
      lineHeight: 21,
      marginTop: 6,
    },
    tradeBuilder: { gap: 12 },
    tradeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tradeHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
    rowActions: { flexDirection: 'row', gap: 7 },
    footerActions: { marginTop: 14, alignItems: 'flex-end' },
  });

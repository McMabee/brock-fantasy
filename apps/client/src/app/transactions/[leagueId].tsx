import { useLocalSearchParams } from 'expo-router';
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
import { useLeague } from '@/hooks/use-league';
import { useTransactions } from '@/hooks/use-transactions';
import { supabase } from '@/lib/supabase';
import { useThemedStyles, type ThemeColors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

export default function TransactionsScreen() {
  useRequireUser();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const leagueData = useLeague(leagueId);
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const transactions = useTransactions({
    leagueId,
    competitionId: leagueData.league?.competitionId,
    rulesetId: leagueData.league?.rulesetId,
  });
  const [dropAthleteId, setDropAthleteId] = useState<string | null>(null);
  const [receivingTeamId, setReceivingTeamId] = useState('');
  const [offeredAthleteId, setOfferedAthleteId] = useState('');
  const [requestedAthleteId, setRequestedAthleteId] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const myTeamId = leagueData.myTeamId;
  const myAssets = transactions.rosterAssets.filter((asset) => asset.fantasyTeamId === myTeamId);
  const otherTeams = leagueData.teams.filter((team) => team.id !== myTeamId);
  const requestedAssets = transactions.rosterAssets.filter(
    (asset) => asset.fantasyTeamId === receivingTeamId,
  );

  useEffect(() => {
    if (!receivingTeamId && otherTeams[0]) setReceivingTeamId(otherTeams[0].id);
  }, [otherTeams, receivingTeamId]);

  const invoke = async (
    label: string,
    command: () => Promise<{ error: { message: string } | null }>,
  ) => {
    setWorking(label);
    setMessage(null);
    const result = await command();
    if (result.error) setMessage(result.error.message);
    else {
      setMessage('Transaction committed.');
      await Promise.all([transactions.reload(), leagueData.reload()]);
    }
    setWorking(null);
  };

  const addOrClaim = async (athleteId: string, waiver: boolean) => {
    if (!myTeamId) return;
    if (!supabase) {
      setMessage(waiver ? 'Demo waiver claim submitted.' : 'Demo free-agent addition committed.');
      return;
    }
    const client = supabase;
    const command = waiver ? 'request_waiver' : 'add_free_agent';
    await invoke(`${command}:${athleteId}`, async () => {
      const result = await client.rpc(command, {
        p_fantasy_team_id: myTeamId,
        p_athlete_in_id: athleteId,
        p_athlete_out_id: dropAthleteId,
        p_idempotency_key: `${command}-${Date.now()}-${athleteId}`,
      });
      return result as { error: { message: string } | null };
    });
  };

  const proposeTrade = async () => {
    if (!myTeamId || !receivingTeamId || !offeredAthleteId || !requestedAthleteId) return;
    if (!supabase) {
      setMessage('Demo trade proposed.');
      return;
    }
    const client = supabase;
    await invoke('propose-trade', async () => {
      const result = await client.rpc('propose_trade', {
        p_proposing_team_id: myTeamId,
        p_receiving_team_id: receivingTeamId,
        p_offered_athlete_ids: [offeredAthleteId],
        p_requested_athlete_ids: [requestedAthleteId],
        p_expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        p_idempotency_key: `trade-${Date.now()}`,
      });
      return result as { error: { message: string } | null };
    });
  };

  const respond = async (tradeId: string, accept: boolean) => {
    if (!supabase) {
      setMessage(`Demo trade ${accept ? 'accepted' : 'rejected'}.`);
      return;
    }
    const client = supabase;
    await invoke(`trade-response:${tradeId}`, async () => {
      const result = await client.rpc('respond_to_trade', {
        p_trade_id: tradeId,
        p_accept: accept,
        p_idempotency_key: `trade-response-${Date.now()}`,
      });
      return result as { error: { message: string } | null };
    });
  };

  const cancel = async (tradeId: string) => {
    if (!supabase) {
      setMessage('Demo trade cancelled.');
      return;
    }
    const client = supabase;
    await invoke(`trade-cancel:${tradeId}`, async () => {
      const result = await client.rpc('cancel_trade', {
        p_trade_id: tradeId,
        p_idempotency_key: `trade-cancel-${Date.now()}`,
      });
      return result as { error: { message: string } | null };
    });
  };

  const athleteName = (athleteId: string) =>
    transactions.rosterAssets.find((asset) => asset.id === athleteId)?.displayName ??
    transactions.freeAgents.find((athlete) => athlete.id === athleteId)?.displayName ??
    'Unknown athlete';
  const teamName = (teamId: string) =>
    leagueData.teams.find((team) => team.id === teamId)?.name ?? 'Unknown team';

  return (
    <AppShell eyebrow="Roster moves" title="Transactions">
      {transactions.error || message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {transactions.error ?? message}
        </Text>
      ) : null}
      <SectionTitle title="Drop choice" detail="Optional unless your roster is full" />
      <View style={styles.choices}>
        <Choice label="No drop" selected={!dropAthleteId} onPress={() => setDropAthleteId(null)} />
        {myAssets.map((asset) => (
          <Choice
            key={asset.id}
            label={`${asset.displayName} · ${asset.position}`}
            selected={dropAthleteId === asset.id}
            onPress={() => setDropAthleteId(asset.id)}
          />
        ))}
      </View>

      <SectionTitle
        title="Available athletes"
        detail={`${transactions.freeAgents.length} unrostered`}
      />
      {transactions.freeAgents.length === 0 ? (
        <EmptyState
          title="No free agents"
          body="The active athlete pool is fully rostered or has not been imported."
        />
      ) : (
        <Card>
          {transactions.freeAgents.map((athlete) => (
            <View key={athlete.id} style={styles.assetRow}>
              <View style={styles.assetCopy}>
                <Text style={styles.assetName}>{athlete.displayName}</Text>
                <Text style={styles.assetMeta}>{athlete.position}</Text>
              </View>
              {transactions.freeAgentsEnabled ? (
                <ActionButton
                  label="Add now"
                  onPress={() => void addOrClaim(athlete.id, false)}
                  loading={working === `add_free_agent:${athlete.id}`}
                  variant="secondary"
                />
              ) : null}
              {transactions.waiversEnabled ? (
                <ActionButton
                  label="Waiver claim"
                  onPress={() => void addOrClaim(athlete.id, true)}
                  loading={working === `request_waiver:${athlete.id}`}
                />
              ) : null}
            </View>
          ))}
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

      <SectionTitle title="Trade history" />
      {transactions.trades.length === 0 ? (
        <EmptyState
          title="No trades"
          body="Proposed and completed trades will remain visible here."
        />
      ) : (
        <Card>
          {transactions.trades.map((trade) => {
            const offered = trade.items
              .filter((item) => item.fromTeamId === trade.proposingTeamId)
              .map((item) => athleteName(item.athleteId))
              .join(', ');
            const requested = trade.items
              .filter((item) => item.fromTeamId === trade.receivingTeamId)
              .map((item) => athleteName(item.athleteId))
              .join(', ');
            return (
              <View key={trade.id} style={styles.tradeRow}>
                <View style={styles.assetCopy}>
                  <View style={styles.tradeHeading}>
                    <Text style={styles.assetName}>
                      {teamName(trade.proposingTeamId)} ↔ {teamName(trade.receivingTeamId)}
                    </Text>
                    <Pill
                      label={trade.status.toUpperCase()}
                      tone={trade.status === 'accepted' ? 'positive' : 'info'}
                    />
                  </View>
                  <Text style={styles.assetMeta}>
                    {offered || '—'} for {requested || '—'} · expires{' '}
                    {new Date(trade.expiresAt).toLocaleDateString()}
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
              </View>
            );
          })}
        </Card>
      )}
      <View style={styles.footerActions}>
        <ActionButton
          label="Back to league"
          href={`/league/${leagueId ?? 'demo-league'}`}
          variant="ghost"
        />
      </View>
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
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    message: { color: colors.brand, fontSize: 12, marginBottom: 10 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    choice: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 8,
      backgroundColor: colors.canvasSoft,
    },
    choiceSelected: { borderColor: colors.brand, backgroundColor: colors.selected },
    choiceText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
    choiceTextSelected: { color: colors.brand },
    assetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 11,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    assetCopy: { flex: 1, minWidth: 190 },
    assetName: { color: colors.text, fontSize: 12, fontWeight: '800' },
    assetMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
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

const useStyles = () => useThemedStyles(createStyles);

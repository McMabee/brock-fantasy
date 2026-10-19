import { VarsityBadge } from '@/components/varsity-badge';
import { useResponsiveDimensions as useWindowDimensions } from '@/hooks/use-responsive-dimensions';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { formatFantasyPoints } from '@brock-fantasy/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { useLeague, type LeagueChatMessage } from '@/hooks/use-league';
import { heading, radii } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';
import { supabase } from '@/lib/supabase';
import { selectMyMatchup } from '@/lib/matchup-selection';
import { useActionFeedback } from '@/providers/action-feedback-provider';
import { useSession } from '@/providers/session-provider';
import { MatchupSetup } from '@/components/matchup-setup';
import { Platform, Share } from 'react-native';
import { betaCommand } from '@/lib/web-api';
import { LeagueSettings } from '@/components/league-settings';
import { LeagueRoster as Roster } from '@/components/league-roster';
import type { FantasyTeam, League, MatchupResult, StandingsRow } from '@brock-fantasy/domain';

type Tab = 'overview' | 'roster' | 'standings' | 'chat' | 'settings';
const TABS: readonly Tab[] = ['overview', 'roster', 'standings', 'chat', 'settings'];

export default function LeagueScreen() {
  const styles = useThemedStyles(createStyles);
  useRequireUser();
  const {
    id,
    teamId,
    tab: requestedTab,
  } = useLocalSearchParams<{
    id: string;
    teamId?: string;
    tab?: string;
  }>();
  const [viewedTeamId, setViewedTeamId] = useState<string | undefined>(teamId);
  const leagueData = useLeague(id, viewedTeamId);
  const { league, teams, standings, error: loadError } = leagueData;
  const { user } = useSession();
  const feedback = useActionFeedback();
  const copyInvite = async () => {
    if (!league) return;
    const origin = process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'https://play.brockfantasy.ca';
    const url = `${origin}/leagues/join?code=${encodeURIComponent(league.inviteCode)}`;
    try {
      if (Platform.OS === 'web') await navigator.clipboard.writeText(url);
      else await Share.share({ message: url });
      feedback({
        title: Platform.OS === 'web' ? 'Invite link copied' : 'Invite link ready',
        tone: 'success',
      });
    } catch {
      setActionError('Could not copy the invite link. You can still share the league code.');
    }
  };
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>(
    teamId ? 'roster' : (TABS.find((item) => item === requestedTab) ?? 'overview'),
  );
  useEffect(() => {
    if (teamId) {
      setViewedTeamId(teamId);
      setTab('roster');
    } else if (requestedTab && TABS.includes(requestedTab as Tab)) {
      setTab(requestedTab as Tab);
    }
  }, [requestedTab, teamId]);
  const [chatText, setChatText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const messages = leagueData.messages;
  const wide = width >= 1280;

  const sendMessage = async () => {
    const body = chatText.trim();
    if (!body) return;
    setActionError(null);
    if (!supabase || !id) {
      setActionError('League chat is temporarily unavailable. Please try again shortly.');
      return;
    }
    const result = await betaCommand('post_chat_message', {
      p_league_id: id,
      p_body: body,
      p_idempotency_key: `chat-${Date.now()}`,
    });
    if (result.error) {
      setActionError(result.error);
      return;
    }
    await leagueData.reload();
    setChatText('');
  };

  const reportMessage = async (messageId: string) => {
    if (!supabase) return;
    const result = await betaCommand('report_chat_message', {
      p_message_id: messageId,
      p_reason: 'Reported by a league member from the chat interface.',
    });
    setActionError(result.error ?? 'Message reported for moderator review.');
  };

  const muteAuthor = async (authorId: string | null) => {
    if (!supabase || !id || !authorId) return;
    const result = await betaCommand('mute_chat_user', {
      p_league_id: id,
      p_muted_user_id: authorId,
    });
    if (result.error) setActionError(result.error);
    else {
      setActionError('Manager muted in this league.');
      await leagueData.reload();
    }
  };

  if (leagueData.loading && !league)
    return (
      <AppShell title="Your league">
        <LoadingState label="Loading your league" rows={4} />
      </AppShell>
    );
  if (!league && loadError)
    return (
      <AppShell title="League unavailable">
        <ErrorState message={loadError} onRetry={() => void leagueData.reload()} />
        <ActionButton label="Your leagues" href="/dashboard" variant="secondary" />
      </AppShell>
    );
  return (
    <AppShell
      eyebrow="Private fantasy league"
      title={league?.name ?? 'Loading league…'}
      action={league ? <Pill label={league.status.toUpperCase()} tone="positive" /> : undefined}
    >
      {loadError || actionError ? (
        <Text accessibilityRole="alert" style={styles.loadError}>
          {loadError ?? actionError}
        </Text>
      ) : null}
      <View style={styles.inviteBar}>
        <View>
          <Text style={styles.inviteLabel}>PRIVATE INVITE CODE</Text>
          <Text selectable style={styles.inviteCode}>
            {league?.inviteCode ?? '—'}
          </Text>
        </View>
        <Text style={styles.inviteMeta}>
          {teams.length} of {league?.maxMembers ?? '—'} managers · {id}
        </Text>
      </View>

      {league?.commissionerId === user?.id ? (
        <ActionButton
          label="Copy invite link"
          variant="secondary"
          onPress={() => void copyInvite()}
        />
      ) : null}
      {league?.commissionerId === user?.id &&
      leagueData.draftStatus === 'complete' &&
      !leagueData.matchups.length ? (
        <MatchupSetup leagueId={id} teams={teams} onCreated={leagueData.reload} />
      ) : null}
      <ActionButton label="View matchups" href={`/matchups/${id}`} variant="secondary" />
      <View accessibilityRole="tablist" style={styles.tabs}>
        {TABS.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            aria-selected={tab === item}
            accessibilityState={{ selected: tab === item }}
            onPress={() => setTab(item)}
            style={[styles.tab, tab === item && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'overview' ? (
        <Overview
          wide={wide}
          league={league}
          teams={teams}
          draftId={leagueData.draftId}
          draftStatus={leagueData.draftStatus}
          matchups={leagueData.matchups}
          myTeamId={leagueData.myTeamId}
        />
      ) : null}
      {tab === 'roster' ? (
        <View style={styles.rosterContent}>
          <View style={styles.teamSelector}>
            {teams.map((team) => (
              <ActionButton
                key={team.id}
                label={team.name}
                variant={
                  (viewedTeamId ?? leagueData.myTeamId) === team.id ? 'primary' : 'secondary'
                }
                onPress={() => setViewedTeamId(team.id)}
              />
            ))}
          </View>
          <Roster
            varsity={league?.rosterFormat === 'varsity'}
            entries={leagueData.roster}
            poolId={league?.playerPoolId}
            editable={!viewedTeamId || viewedTeamId === leagueData.myTeamId}
            leagueId={league?.id ?? ''}
            betaLeague={Boolean(league?.playerPoolId)}
            teamName={
              teams.find((team) => team.id === (viewedTeamId ?? leagueData.myTeamId))?.name ??
              'Your roster'
            }
          />
        </View>
      ) : null}
      {tab === 'standings' ? <Standings league={league} rows={standings} teams={teams} /> : null}
      {tab === 'settings' ? <LeagueSettings data={leagueData} /> : null}
      {tab === 'chat' ? (
        <Chat
          chatText={chatText}
          messages={messages}
          onChangeText={setChatText}
          onSend={() => void sendMessage()}
          onReport={(messageId) => void reportMessage(messageId)}
          onMute={(authorId) => void muteAuthor(authorId)}
        />
      ) : null}
    </AppShell>
  );
}

function Overview({
  wide,
  league,
  teams,
  draftId,
  draftStatus,
  matchups,
  myTeamId,
}: {
  wide: boolean;
  league: League | null;
  teams: readonly FantasyTeam[];
  draftId: string | null;
  draftStatus: ReturnType<typeof useLeague>['draftStatus'];
  matchups: readonly MatchupResult[];
  myTeamId: string | null;
}) {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const matchup = selectMyMatchup(matchups, myTeamId);
  const homeName = teams.find((team) => team.id === matchup?.homeTeamId)?.name ?? 'Home team';
  const awayName = teams.find((team) => team.id === matchup?.awayTeamId)?.name ?? 'Away team';
  const draftOpen = Boolean(
    draftId && draftStatus && ['active', 'paused', 'scheduled'].includes(draftStatus),
  );
  return (
    <View style={[styles.contentGrid, wide && draftOpen && styles.contentGridWide]}>
      <View style={styles.contentMain}>
        {matchup ? (
          <Card accent>
            <View style={styles.scoreHeader}>
              <View>
                <Pill
                  label={`${matchup.status.toUpperCase()} · WEEK ${matchup.period}`}
                  tone={matchup.status === 'active' ? 'warning' : 'info'}
                />
                <Text style={styles.scoreTitle}>Current matchup</Text>
              </View>
              <Text style={styles.scoreClock}>AUDITED</Text>
            </View>
            <View style={styles.scoreGrid}>
              <View style={styles.scoreTeam}>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.push(`/league/${league?.id}/teams/${matchup.homeTeamId}`)}
                >
                  <Text style={styles.scoreTeamName}>{homeName}</Text>
                </Pressable>
                <Text style={styles.scoreLeading}>{formatFantasyPoints(matchup.homePoints)}</Text>
              </View>
              <Text style={styles.scoreDash}>—</Text>
              <View style={styles.scoreTeam}>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.push(`/league/${league?.id}/teams/${matchup.awayTeamId}`)}
                >
                  <Text style={styles.scoreTeamName}>{awayName}</Text>
                </Pressable>
                <Text style={styles.scoreValue}>{formatFantasyPoints(matchup.awayPoints)}</Text>
              </View>
            </View>
          </Card>
        ) : (
          <EmptyState
            title="No matchup scheduled"
            body="The commissioner can create fantasy periods after league setup."
          />
        )}
        <SectionTitle title="Recent activity" />
        <EmptyState
          title="No recent activity"
          body="Draft, roster, and scoring events will appear after play begins."
        />
        {draftStatus === 'complete' ? (
          <Text style={uiStyles.body}>You can view draft results in the Settings tab.</Text>
        ) : null}
      </View>
      {draftOpen ? (
        <View style={styles.contentSide}>
          <Card>
            <Text style={styles.panelTitle}>Draft room</Text>
            {league?.draftScheduledFor ? (
              <Text style={uiStyles.body}>
                Draft planned for{' '}
                {new Date(league.draftScheduledFor).toLocaleString('en-CA', {
                  timeZone: 'America/Toronto',
                })}{' '}
                (Toronto time). The commissioner starts the draft manually.
              </Text>
            ) : null}
            <View style={styles.controlActions}>
              {draftId && draftStatus && ['active', 'paused', 'scheduled'].includes(draftStatus) ? (
                <ActionButton
                  label="Open draft room"
                  href={`/draft/${draftId}`}
                  variant="secondary"
                />
              ) : null}
            </View>
          </Card>
        </View>
      ) : null}
    </View>
  );
}

function Standings({
  rows,
  teams,
  league,
}: {
  rows: readonly StandingsRow[];
  teams: readonly FantasyTeam[];
  league: League | null;
}) {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const nameFor = (teamId: string) => teamsById.get(teamId)?.name ?? 'Unknown team';
  return (
    <View>
      <SectionTitle
        title="League standings"
        detail={
          league?.format === 'points_leaderboard'
            ? 'Cumulative points leaderboard'
            : 'Head-to-head · Points-for tiebreaker'
        }
      />
      <Card>
        <View style={styles.standingHeader}>
          <Text style={styles.standingRank}>#</Text>
          <Text style={styles.standingTeam}>Team</Text>
          <Text style={styles.standingStat}>W</Text>
          <Text style={styles.standingStat}>L</Text>
          <Text style={styles.standingPoints}>PF</Text>
        </View>
        {rows.map((row, index) => (
          <View
            key={row.fantasyTeamId}
            style={[styles.standingRow, index === rows.length - 1 && uiStyles.lastRow]}
          >
            <Text style={styles.standingRank}>{row.rank}</Text>
            <Pressable
              accessibilityRole="link"
              style={styles.standingTeam}
              onPress={() => router.push(`/league/${league?.id}/teams/${row.fantasyTeamId}`)}
            >
              <Text style={styles.standingTeam}>{nameFor(row.fantasyTeamId)}</Text>
              <VarsityBadge visible={teamsById.get(row.fantasyTeamId)?.ownerIsVarsity} />
            </Pressable>
            <Text style={styles.standingStat}>{row.wins}</Text>
            <Text style={styles.standingStat}>{row.losses}</Text>
            <Text style={styles.standingPoints}>{formatFantasyPoints(row.pointsFor)}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

function Chat({
  chatText,
  messages,
  onChangeText,
  onSend,
  onReport,
  onMute,
}: {
  chatText: string;
  messages: readonly LeagueChatMessage[];
  onChangeText: (text: string) => void;
  onSend: () => void;
  onReport: (messageId: string) => void;
  onMute: (authorId: string | null) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const colors = useThemeColors();
  return (
    <View style={styles.chatLayout}>
      <SectionTitle title="League chat" detail="Text only · Report and mute available" />
      <Card style={styles.chatCard}>
        {messages.map((message) => (
          <View key={message.id} style={styles.message}>
            <View style={styles.messageHeader}>
              <Text style={styles.messageAuthor}>{message.author}</Text>
              <VarsityBadge visible={message.authorIsVarsity} />
              <Text style={styles.messageTime}>
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            <Text style={styles.messageBody}>{message.body}</Text>
            <View style={styles.chatActions}>
              <Pressable accessibilityRole="button" onPress={() => onReport(message.id)}>
                <Text style={styles.report}>Report</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => onMute(message.authorId)}>
                <Text style={styles.report}>Mute</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="League message"
            maxLength={500}
            onChangeText={onChangeText}
            placeholder="Message your league…"
            placeholderTextColor={colors.muted}
            style={[uiStyles.input, styles.composerInput]}
            value={chatText}
          />
          <ActionButton label="Send" onPress={onSend} disabled={!chatText.trim()} />
        </View>
      </Card>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    loadError: { fontFamily: 'Inter', color: colors.danger, marginBottom: 12, fontSize: 12 },
    inviteBar: {
      backgroundColor: colors.canvasSoft,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radii.sm,
      padding: 13,
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    inviteLabel: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 8,
      fontWeight: '800',
      letterSpacing: 1.5,
    },
    inviteCode: {
      fontFamily: 'Inter',
      color: colors.text,
      fontWeight: '900',
      fontSize: 17,
      letterSpacing: 1.5,
      marginTop: 3,
    },
    inviteMeta: { fontFamily: 'Inter', color: colors.muted, fontSize: 11 },
    tabs: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: 18,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    tab: { paddingHorizontal: 12, paddingVertical: 13, minHeight: 44 },
    tabActive: { borderBottomColor: colors.brand, borderBottomWidth: 2 },
    tabText: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontWeight: '700',
      textTransform: 'capitalize',
      fontSize: 13,
    },
    tabTextActive: { color: colors.text },
    rosterContent: { paddingTop: 20, gap: 20 },
    teamSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    contentGrid: { gap: 17, marginTop: 20 },
    contentGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
    contentMain: { flex: 1.6, minWidth: 0 },
    contentSide: { flex: 0.8, minWidth: 280, gap: 15 },
    scoreHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    scoreTitle: { ...heading, fontSize: 20, marginTop: 10, color: colors.text },
    scoreClock: { color: colors.accent, fontWeight: '900' },
    scoreGrid: { flexDirection: 'row', alignItems: 'center', paddingVertical: 28 },
    scoreTeam: { flex: 1, alignItems: 'center' },
    scoreTeamName: {
      fontFamily: 'Inter',
      color: colors.text,
      fontWeight: '800',
      fontSize: 12,
      textAlign: 'center',
    },
    scoreLeading: {
      fontFamily: 'Inter',
      color: colors.text,
      fontWeight: '900',
      fontSize: 36,
      marginTop: 7,
    },
    scoreValue: {
      fontFamily: 'Inter',
      color: colors.text,
      fontWeight: '900',
      fontSize: 36,
      marginTop: 7,
    },
    scoreDash: { fontFamily: 'Inter', color: colors.muted, fontSize: 20 },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingVertical: 13,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    activityTag: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 9,
      fontWeight: '900',
      width: 42,
    },
    activityTitle: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
      flex: 1,
    },
    activityTime: { fontFamily: 'Inter', color: colors.muted, fontSize: 10 },
    panelTitle: { ...heading, fontSize: 18, marginBottom: 8, color: colors.text },
    controlActions: { gap: 8, marginTop: 18 },
    standingHeader: {
      flexDirection: 'row',
      paddingBottom: 10,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    standingRow: {
      flexDirection: 'row',
      paddingVertical: 14,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    standingRank: { fontFamily: 'Inter', color: colors.muted, width: 30, fontSize: 11 },
    standingTeam: {
      fontFamily: 'Inter',
      color: colors.text,
      flex: 1,
      fontSize: 12,
      fontWeight: '700',
    },
    standingStat: {
      fontFamily: 'Inter',
      color: colors.text,
      width: 38,
      textAlign: 'right',
      fontSize: 12,
    },
    standingPoints: {
      fontFamily: 'Inter',
      color: colors.text,
      width: 60,
      textAlign: 'right',
      fontSize: 12,
      fontWeight: '800',
    },
    chatLayout: { maxWidth: 760, width: '100%', alignSelf: 'center' },
    chatCard: { gap: 4 },
    message: { backgroundColor: colors.canvasSoft, borderRadius: 12, padding: 13, marginBottom: 8 },
    messageHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    messageAuthor: { fontFamily: 'Inter', color: colors.text, fontSize: 11, fontWeight: '900' },
    messageTime: { fontFamily: 'Inter', color: colors.muted, fontSize: 9 },
    messageBody: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 6,
    },
    report: { fontFamily: 'Inter', color: colors.muted, fontSize: 9, marginTop: 8 },
    chatActions: { flexDirection: 'row', gap: 16 },
    composer: { flexDirection: 'row', gap: 9, marginTop: 10 },
    composerInput: { flex: 1 },
  });

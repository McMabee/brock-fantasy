import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { SponsorPlacement } from '@/components/sponsor-placement';
import { useLeague, type LeagueChatMessage, type LeagueRosterEntry } from '@/hooks/use-league';
import { createHeading, radii, useAppTheme, useThemedStyles, type ThemeColors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import type { FantasyTeam, League, MatchupResult, StandingsRow } from '@brock-fantasy/domain';

type Tab = 'overview' | 'roster' | 'standings' | 'chat';

export default function LeagueScreen() {
  useRequireUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const leagueData = useLeague(id);
  const { league, teams, standings, error: loadError } = leagueData;
  const { demoMode, user } = useSession();
  const { width } = useWindowDimensions();
  const styles = useStyles();
  const [tab, setTab] = useState<Tab>('overview');
  const [chatText, setChatText] = useState('');
  const [localMessages, setLocalMessages] = useState<LeagueChatMessage[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const messages = [...leagueData.messages, ...localMessages];
  const wide = width >= 850;

  const sendMessage = async () => {
    const body = chatText.trim();
    if (!body) return;
    setActionError(null);
    if (supabase && id && id !== 'demo-league') {
      const result = (await supabase.rpc('post_chat_message', {
        p_league_id: id,
        p_body: body,
        p_idempotency_key: `chat-${Date.now()}`,
      })) as { error: { message: string } | null };
      if (result.error) {
        setActionError(result.error.message);
        return;
      }
      await leagueData.reload();
    } else {
      setLocalMessages((current) => [
        ...current,
        {
          id: `m-${Date.now()}`,
          authorId: 'demo-user',
          author: 'You',
          body,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    setChatText('');
  };

  const reportMessage = async (messageId: string) => {
    if (!supabase || demoMode) return;
    const result = (await supabase.rpc('report_chat_message', {
      p_message_id: messageId,
      p_reason: 'Reported by a league member from the chat interface.',
    })) as { error: { message: string } | null };
    setActionError(result.error ? result.error.message : 'Message reported for moderator review.');
  };

  const muteAuthor = async (authorId: string | null) => {
    if (!supabase || demoMode || !id || !authorId) return;
    const result = (await supabase.rpc('mute_chat_user', {
      p_league_id: id,
      p_muted_user_id: authorId,
    })) as { error: { message: string } | null };
    if (result.error) setActionError(result.error.message);
    else {
      setActionError('Manager muted in this league.');
      await leagueData.reload();
    }
  };

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

      <View accessibilityRole="tablist" style={styles.tabs}>
        {(['overview', 'roster', 'standings', 'chat'] as const).map((item) => (
          <Pressable
            key={item}
            aria-selected={tab === item}
            accessibilityLabel={item[0]?.toUpperCase() + item.slice(1)}
            accessibilityRole="tab"
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
          matchups={leagueData.matchups}
          demoMode={demoMode}
          isCommissioner={demoMode || league?.commissionerId === user?.id}
        />
      ) : null}
      {tab === 'roster' ? (
        <Roster
          entries={leagueData.roster}
          leagueId={league?.id ?? 'demo-league'}
          teamName={teams.find((team) => team.id === leagueData.myTeamId)?.name ?? 'Your roster'}
        />
      ) : null}
      {tab === 'standings' ? <Standings league={league} rows={standings} teams={teams} /> : null}
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
  matchups,
  demoMode,
  isCommissioner,
}: {
  wide: boolean;
  league: League | null;
  teams: readonly FantasyTeam[];
  draftId: string | null;
  matchups: readonly MatchupResult[];
  demoMode: boolean;
  isCommissioner: boolean;
}) {
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const matchup = matchups.find((item) => item.status === 'active') ?? matchups[0];
  const homeName = teams.find((team) => team.id === matchup?.homeTeamId)?.name ?? 'Home team';
  const awayName = teams.find((team) => team.id === matchup?.awayTeamId)?.name ?? 'Away team';
  return (
    <View style={[styles.contentGrid, wide && styles.contentGridWide]}>
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
                <Text style={styles.scoreTeamName}>{homeName}</Text>
                <Text style={styles.scoreLeading}>{matchup.homePoints.toFixed(1)}</Text>
              </View>
              <Text style={styles.scoreDash}>—</Text>
              <View style={styles.scoreTeam}>
                <Text style={styles.scoreTeamName}>{awayName}</Text>
                <Text style={styles.scoreValue}>{matchup.awayPoints.toFixed(1)}</Text>
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
        {demoMode ? (
          <Card>
            {[
              ['+3.0', 'Evan Kelly scored a goal', '2 min ago'],
              ['ADD', 'Power Playmakers added Cole Martin', 'Yesterday'],
              ['TRADE', 'Niagara Knights proposed a trade', 'Yesterday'],
            ].map(([tag, title, time]) => (
              <View key={`${tag}-${title}`} style={styles.activityRow}>
                <Text style={styles.activityTag}>{tag}</Text>
                <Text style={styles.activityTitle}>{title}</Text>
                <Text style={styles.activityTime}>{time}</Text>
              </View>
            ))}
          </Card>
        ) : (
          <EmptyState
            title="No recent activity"
            body="Draft, roster, and scoring events will appear after play begins."
          />
        )}
      </View>
      <View style={styles.contentSide}>
        <Card>
          <Text style={styles.panelTitle}>League controls</Text>
          <Text style={uiStyles.body}>
            Server-authoritative snake draft, lineup locks, free agents, waivers, and trades for
            this{' '}
            {league?.format === 'points_leaderboard' ? 'points leaderboard' : 'head-to-head league'}
            .
          </Text>
          <View style={styles.controlActions}>
            {draftId ? (
              <ActionButton
                label="Open draft room"
                href={`/draft/${draftId}`}
                variant="secondary"
              />
            ) : null}
            {isCommissioner && league ? (
              <ActionButton
                label="Commissioner controls"
                href={`/commissioner/${league.id}`}
                variant="ghost"
              />
            ) : null}
          </View>
        </Card>
        <SponsorPlacement placement="league_sidebar" competitionId={league?.competitionId} />
      </View>
    </View>
  );
}

function Roster({
  entries,
  teamName,
  leagueId,
}: {
  entries: readonly LeagueRosterEntry[];
  teamName: string;
  leagueId: string;
}) {
  const styles = useStyles();
  return (
    <View>
      <SectionTitle title={teamName} detail="Lineup locks at game start" />
      {entries.length > 0 ? (
        <Card>
          {entries.map((entry) => (
            <View key={entry.id} style={styles.rosterRow}>
              <View style={styles.position}>
                <Text style={styles.positionText}>{entry.slotCode}</Text>
              </View>
              <View style={styles.rosterCopy}>
                <Text style={styles.rosterName}>{entry.displayName}</Text>
                <Text style={styles.rosterMeta}>
                  {entry.jerseyNumber ? `#${entry.jerseyNumber} · ` : ''}Brock {entry.position} ·{' '}
                  {entry.status}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState
          title="Roster is empty"
          body="Athletes appear here as draft picks and transactions commit."
        />
      )}
      <View style={styles.inlineActions}>
        <ActionButton label="Set lineup" href={`/lineup/${leagueId}`} />
        <ActionButton
          label="Free agents, waivers & trades"
          href={`/transactions/${leagueId}`}
          variant="secondary"
        />
      </View>
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
  const styles = useStyles();
  const nameFor = (teamId: string) =>
    teams.find((team) => team.id === teamId)?.name ?? 'Unknown team';
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
        {rows.map((row) => (
          <View key={row.fantasyTeamId} style={styles.standingRow}>
            <Text style={styles.standingRank}>{row.rank}</Text>
            <Text style={styles.standingTeam}>{nameFor(row.fantasyTeamId)}</Text>
            <Text style={styles.standingStat}>{row.wins}</Text>
            <Text style={styles.standingStat}>{row.losses}</Text>
            <Text style={styles.standingPoints}>{row.pointsFor.toFixed(1)}</Text>
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
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  return (
    <View style={styles.chatLayout}>
      <SectionTitle title="League chat" detail="Text only · Report and mute available" />
      <Card style={styles.chatCard}>
        {messages.map((message) => (
          <View key={message.id} style={styles.message}>
            <View style={styles.messageHeader}>
              <Text style={styles.messageAuthor}>{message.author}</Text>
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    loadError: { color: colors.danger, marginBottom: 12, fontSize: 12 },
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
    inviteLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.5 },
    inviteCode: {
      color: colors.brand,
      fontWeight: '900',
      fontSize: 17,
      letterSpacing: 1.5,
      marginTop: 3,
    },
    inviteMeta: { color: colors.muted, fontSize: 11 },
    tabs: {
      flexDirection: 'row',
      gap: 4,
      marginTop: 18,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    tab: { paddingHorizontal: 15, paddingVertical: 13 },
    tabActive: { borderBottomColor: colors.brand, borderBottomWidth: 2 },
    tabText: { color: colors.muted, fontWeight: '700', textTransform: 'capitalize', fontSize: 13 },
    tabTextActive: { color: colors.text },
    contentGrid: { gap: 17, marginTop: 20 },
    contentGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
    contentMain: { flex: 1.6, minWidth: 0 },
    contentSide: { flex: 0.8, minWidth: 280, gap: 15 },
    scoreHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    scoreTitle: { ...createHeading(colors), fontSize: 20, marginTop: 10 },
    scoreClock: { color: colors.accent, fontWeight: '900' },
    scoreGrid: { flexDirection: 'row', alignItems: 'center', paddingVertical: 28 },
    scoreTeam: { flex: 1, alignItems: 'center' },
    scoreTeamName: { color: colors.text, fontWeight: '800', fontSize: 12, textAlign: 'center' },
    scoreLeading: { color: colors.brand, fontWeight: '900', fontSize: 36, marginTop: 7 },
    scoreValue: { color: colors.text, fontWeight: '900', fontSize: 36, marginTop: 7 },
    scoreDash: { color: colors.muted, fontSize: 20 },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingVertical: 13,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    activityTag: { color: colors.brand, fontSize: 9, fontWeight: '900', width: 42 },
    activityTitle: { color: colors.text, fontSize: 12, fontWeight: '700', flex: 1 },
    activityTime: { color: colors.muted, fontSize: 10 },
    panelTitle: { ...createHeading(colors), fontSize: 18, marginBottom: 8 },
    controlActions: { gap: 8, marginTop: 18 },
    rosterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingVertical: 13,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    position: {
      width: 39,
      height: 39,
      backgroundColor: colors.canvasSoft,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    positionText: { color: colors.brand, fontSize: 11, fontWeight: '900' },
    rosterCopy: { flex: 1 },
    rosterName: { color: colors.text, fontSize: 13, fontWeight: '800' },
    rosterMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
    rosterPoints: { alignItems: 'flex-end' },
    rosterPointsValue: { color: colors.text, fontSize: 14, fontWeight: '900' },
    rosterPointsLabel: { color: colors.muted, fontSize: 7, letterSpacing: 1 },
    inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 15 },
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
    standingRank: { color: colors.muted, width: 30, fontSize: 11 },
    standingTeam: { color: colors.text, flex: 1, fontSize: 12, fontWeight: '700' },
    standingStat: { color: colors.text, width: 38, textAlign: 'right', fontSize: 12 },
    standingPoints: {
      color: colors.brand,
      width: 60,
      textAlign: 'right',
      fontSize: 12,
      fontWeight: '800',
    },
    chatLayout: { maxWidth: 760, width: '100%', alignSelf: 'center' },
    chatCard: { gap: 4 },
    message: { backgroundColor: colors.canvasSoft, borderRadius: 12, padding: 13, marginBottom: 8 },
    messageHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    messageAuthor: { color: colors.brand, fontSize: 11, fontWeight: '900' },
    messageTime: { color: colors.muted, fontSize: 9 },
    messageBody: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 6 },
    report: { color: colors.muted, fontSize: 9, marginTop: 8 },
    chatActions: { flexDirection: 'row', gap: 16 },
    composer: { flexDirection: 'row', gap: 9, marginTop: 10 },
    composerInput: { flex: 1 },
  });

const useStyles = () => useThemedStyles(createStyles);

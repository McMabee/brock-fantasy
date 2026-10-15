import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { StyleSheet, Text, View } from 'react-native';

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
import { useCompetitions } from '@/hooks/use-competitions';
import { useProgramGames } from '@/hooks/use-program-games';
import { useMyLeagues } from '@/hooks/use-my-leagues';
import { useRequireUser } from '@/hooks/use-route-access';
import { heading } from '@/theme';
import { RulesLink } from '@/components/rules-link';
import { PendingConfirmation } from '@/components/player-insights';

export default function DashboardScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const access = useRequireUser();
  const leagueQuery = useMyLeagues();
  const leagues = leagueQuery.data;
  const competitionQuery = useCompetitions(access.allowed);
  const competitions = competitionQuery.data;
  const programGames = useProgramGames(competitions.map((competition) => competition.id));

  return (
    <AppShell
      eyebrow="Your season"
      title="Your season. Your leagues."
      action={
        <View style={styles.actions}>
          <ActionButton label="Join league" href="/leagues/join" variant="secondary" />
          <ActionButton label="Create league" href="/leagues/new" />
        </View>
      }
    >
      <Text style={uiStyles.body}>
        Pick up where you left off. Draft your team, get your lineup ready, and follow the
        competition.
      </Text>
      <RulesLink label="New to fantasy? Start here" />
      <SectionTitle
        title="Your leagues"
        detail={leagueQuery.loading ? 'Updating…' : `${leagues.length} total`}
      />
      {leagueQuery.error ? (
        <ErrorState message={leagueQuery.error} onRetry={leagueQuery.reload} />
      ) : null}
      {access.loading || (leagueQuery.loading && leagues.length === 0) ? (
        <LoadingState label="Loading your leagues" />
      ) : leagues.length === 0 && !leagueQuery.error ? (
        <EmptyState
          title="No leagues yet"
          body="Create a private league or enter an invitation code to join your friends."
        />
      ) : (
        <View style={styles.list}>
          {leagues.map((league) => {
            const drafting =
              league.draft && ['active', 'scheduled', 'paused'].includes(league.draft.status);
            const playing = league.status === 'active';
            const primaryHref = drafting
              ? `/draft/${league.draft!.id}`
              : playing
                ? `/${league.playerPoolId ? 'lineup-beta' : 'lineup'}/${league.id}`
                : `/league/${league.id}`;
            return (
              <Card key={league.id} style={styles.leagueCard}>
                <View style={styles.leagueCopy}>
                  <Pill
                    label={
                      drafting
                        ? league.draft!.status === 'active'
                          ? 'LIVE DRAFT'
                          : 'DRAFT READY'
                        : league.status.toUpperCase()
                    }
                    tone="info"
                  />
                  <Text style={styles.leagueName}>{league.name}</Text>
                  <Text style={styles.leagueMeta}>
                    Head-to-head · {league.maxMembers} managers · {league.status}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <ActionButton
                    label={drafting ? 'Enter draft' : playing ? 'Manage lineup' : 'Open league'}
                    href={primaryHref}
                  />
                  <ActionButton
                    label="League activity"
                    href={`/league/${league.id}`}
                    variant="secondary"
                  />
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <SectionTitle title="Brock programs" detail="2026–27 season" />
      {competitionQuery.loading ? (
        <LoadingState label="Loading programs" rows={2} />
      ) : competitionQuery.error ? (
        <ErrorState message={competitionQuery.error} />
      ) : competitions.length === 0 ? (
        <EmptyState
          title="Season data is not active"
          body="Official roster and schedule information will be provided shortly."
        />
      ) : (
        <Card style={styles.dataCard}>
          {competitions.map((competition, index) => (
            <View
              key={competition.id}
              style={[styles.programRow, index === competitions.length - 1 && uiStyles.lastRow]}
            >
              <View style={styles.leagueCopy}>
                <Text style={styles.programName}>{competition.name}</Text>
                <Text style={styles.leagueMeta}>{competition.seasonLabel}</Text>
                <Text style={styles.gameTime}>
                  {programGames.loading
                    ? 'Loading game time…'
                    : (programGames.error ??
                      (programGames.games[competition.id]
                        ? `Next game · ${new Date(programGames.games[competition.id]!.starts_at).toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`
                        : 'No upcoming game scheduled'))}
                </Text>
                {programGames.games[competition.id]?.schedule_confirmed === false ? (
                  <PendingConfirmation />
                ) : null}
              </View>
              <Pill label={competition.isActive ? 'ACTIVE' : 'PENDING'} tone="info" />
            </View>
          ))}
        </Card>
      )}
    </AppShell>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    list: { gap: 12 },
    leagueCard: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 20,
      padding: 24,
    },
    leagueCopy: { flex: 1, minWidth: 160, gap: 8 },
    leagueName: { ...heading, fontSize: 28, color: colors.text },
    leagueMeta: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 12,
      marginTop: 4,
      textTransform: 'capitalize',
    },
    dataCard: { paddingVertical: 4 },
    programRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    programName: { fontFamily: 'Inter', color: colors.text, fontSize: 14, fontWeight: '800' },
    gameTime: { fontFamily: 'Inter', color: colors.muted, fontSize: 12, lineHeight: 18 },
  });

import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  uiStyles,
} from '@/components/ui';
import { SponsorPlacement } from '@/components/sponsor-placement';
import { demoLeague, demoMatchup, demoStandings, teamName } from '@/data/demo';
import { colors, heading, radii } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';
import { useCompetitions } from '@/hooks/use-competitions';
import { useMyLeagues } from '@/hooks/use-my-leagues';
import { useSession } from '@/providers/session-provider';

export default function DashboardScreen() {
  useRequireUser();
  const competitions = useCompetitions();
  const leagues = useMyLeagues();
  const { demoMode } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  return (
    <AppShell
      eyebrow="Welcome back"
      title="Game day starts here."
      action={
        <View style={styles.headingActions}>
          <ActionButton label="Join league" href="/leagues/join" variant="secondary" />
          <ActionButton label="Create league" href="/leagues/new" />
        </View>
      }
    >
      <View style={[styles.dashboardGrid, wide && styles.dashboardGridWide]}>
        <View style={styles.mainColumn}>
          {demoMode ? (
            <Card accent>
              <View style={styles.cardHeader}>
                <View>
                  <Pill label="LIVE MATCHUP" tone="warning" />
                  <Text style={styles.liveLeague}>{demoLeague.name}</Text>
                </View>
                <Text style={styles.period}>Week {demoMatchup.period}</Text>
              </View>
              <View style={styles.matchupScores}>
                <MatchupTeam
                  name={teamName(demoMatchup.homeTeamId)}
                  score={demoMatchup.homePoints}
                  leading
                />
                <View style={styles.versus}>
                  <Text style={styles.versusText}>VS</Text>
                </View>
                <MatchupTeam
                  name={teamName(demoMatchup.awayTeamId)}
                  score={demoMatchup.awayPoints}
                />
              </View>
              <View style={styles.liveFooter}>
                <View style={styles.livePulse} />
                <Text style={styles.liveFooterText}>
                  Scores update from the audited point ledger
                </Text>
                <ActionButton label="View matchup" href="/league/demo-league" variant="ghost" />
              </View>
            </Card>
          ) : (
            <EmptyState
              title="No live matchup"
              body="Live scoring appears after your league draft and first scheduled fantasy period."
            />
          )}

          <SectionTitle title="Your leagues" detail={`${leagues.length} active`} />
          {leagues.length === 0 ? (
            <EmptyState
              title="Create your first league"
              body="Choose a competition and format, then invite friends with a private code."
            />
          ) : (
            leagues.map((league) => (
              <Card key={league.id} style={styles.leagueCard}>
                <View style={styles.leagueBadge}>
                  <Text style={styles.leagueBadgeText}>
                    {league.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.leagueCopy}>
                  <Text style={styles.leagueName}>{league.name}</Text>
                  <Text style={styles.leagueMeta}>
                    {league.format === 'head_to_head' ? 'Head-to-head' : 'Points leaderboard'} ·{' '}
                    {league.status}
                  </Text>
                </View>
                {demoMode ? (
                  <View style={styles.leagueRank}>
                    <Text style={styles.leagueRankNumber}>1st</Text>
                    <Text style={styles.leagueRankLabel}>YOUR RANK</Text>
                  </View>
                ) : null}
                <ActionButton label="Open" href={`/league/${league.id}`} variant="secondary" />
              </Card>
            ))
          )}

          <SectionTitle title="Competitions" detail="All 2026–27 teams" />
          <View style={styles.competitionRows}>
            {competitions.map((competition, index) => (
              <View key={competition.id} style={styles.competitionRow}>
                <Text style={styles.competitionIndex}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.competitionInfo}>
                  <Text style={uiStyles.label}>{competition.name}</Text>
                  <Text style={styles.competitionMeta}>
                    {competition.sport} · {competition.seasonLabel}
                  </Text>
                </View>
                <Pill
                  label={competition.isActive ? 'Open' : 'Soon'}
                  tone={competition.isActive ? 'positive' : 'neutral'}
                />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sideColumn}>
          {demoMode ? (
            <Card>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Standings</Text>
                <Pill label="WEEK 6" />
              </View>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableLabel, styles.rankCell]}>#</Text>
                <Text style={[styles.tableLabel, styles.teamCell]}>TEAM</Text>
                <Text style={styles.tableLabel}>W</Text>
                <Text style={styles.tableLabel}>PTS</Text>
              </View>
              {demoStandings.map((row) => (
                <View key={row.fantasyTeamId} style={styles.tableRow}>
                  <Text style={[styles.tableValue, styles.rankCell]}>{row.rank}</Text>
                  <Text numberOfLines={1} style={[styles.tableTeam, styles.teamCell]}>
                    {teamName(row.fantasyTeamId)}
                  </Text>
                  <Text style={styles.tableValue}>{row.wins}</Text>
                  <Text style={styles.tablePoints}>{row.pointsFor}</Text>
                </View>
              ))}
            </Card>
          ) : (
            <EmptyState
              title="Standings are waiting"
              body="Complete a draft and score the first fantasy period to populate standings."
            />
          )}

          {demoMode ? (
            <Card style={styles.draftCard}>
              <Text style={styles.draftEyebrow}>NEXT UP</Text>
              <Text style={styles.draftTitle}>Women’s Basketball Draft</Text>
              <Text style={styles.draftDate}>OCT 18 · 7:30 PM</Text>
              <Text style={styles.draftBody}>Your queue has 8 athletes. You draft third.</Text>
              <ActionButton label="Open draft room" href="/draft/demo-draft" variant="secondary" />
            </Card>
          ) : null}

          <SponsorPlacement placement="dashboard_sidebar" />
        </View>
      </View>
    </AppShell>
  );
}

function MatchupTeam({
  name,
  score,
  leading = false,
}: {
  name: string;
  score: number;
  leading?: boolean;
}) {
  return (
    <View style={styles.matchupTeam}>
      <Text numberOfLines={1} style={styles.matchupTeamName}>
        {name}
      </Text>
      <Text style={[styles.matchupScore, leading && styles.matchupScoreLeading]}>
        {score.toFixed(1)}
      </Text>
      <Text style={styles.projected}>projected 94.0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headingActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dashboardGrid: { gap: 18 },
  dashboardGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  mainColumn: { flex: 1.7, minWidth: 0 },
  sideColumn: { flex: 1, gap: 16, minWidth: 300 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  liveLeague: { ...heading, fontSize: 19, marginTop: 10 },
  period: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  matchupScores: { flexDirection: 'row', alignItems: 'center', paddingVertical: 30 },
  matchupTeam: { flex: 1, alignItems: 'center' },
  matchupTeamName: { color: colors.text, fontWeight: '800', fontSize: 13, textAlign: 'center' },
  matchupScore: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 38,
    marginTop: 7,
    fontVariant: ['tabular-nums'],
  },
  matchupScoreLeading: { color: colors.brand },
  projected: { color: colors.muted, fontSize: 10, marginTop: 3 },
  versus: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.canvasSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versusText: { color: colors.muted, fontWeight: '900', fontSize: 10 },
  liveFooter: {
    backgroundColor: colors.canvasSoft,
    borderRadius: radii.sm,
    paddingLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  livePulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  liveFooterText: { color: colors.muted, fontSize: 11, flex: 1 },
  leagueCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 },
  leagueBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueBadgeText: { color: colors.canvas, fontWeight: '900', fontSize: 15 },
  leagueCopy: { flex: 1, minWidth: 200 },
  leagueName: { ...heading, fontSize: 16 },
  leagueMeta: { color: colors.muted, fontSize: 11, marginTop: 5 },
  leagueRank: { alignItems: 'center', paddingHorizontal: 8 },
  leagueRankNumber: { color: colors.brand, fontSize: 20, fontWeight: '900' },
  leagueRankLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  competitionRows: {
    backgroundColor: colors.panel,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    overflow: 'hidden',
  },
  competitionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 15,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  competitionIndex: { color: colors.brand, fontWeight: '900', fontSize: 11, width: 24 },
  competitionInfo: { flex: 1 },
  competitionMeta: { color: colors.muted, fontSize: 10, textTransform: 'capitalize', marginTop: 3 },
  cardTitle: { ...heading, fontSize: 19 },
  tableHeader: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  tableLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
    width: 30,
    textAlign: 'right',
  },
  tableRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableValue: {
    color: colors.text,
    fontSize: 12,
    width: 30,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  tablePoints: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: '800',
    width: 42,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  rankCell: { textAlign: 'left', width: 18 },
  teamCell: { flex: 1, textAlign: 'left' },
  tableTeam: { color: colors.text, fontWeight: '700', fontSize: 11 },
  draftCard: { backgroundColor: '#26331A' },
  draftEyebrow: { color: colors.brand, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  draftTitle: { ...heading, fontSize: 20, marginTop: 8 },
  draftDate: { color: colors.accent, fontWeight: '900', fontSize: 12, marginTop: 8 },
  draftBody: { color: colors.muted, fontSize: 12, marginVertical: 16 },
});

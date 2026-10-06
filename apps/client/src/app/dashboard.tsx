import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppShell, Card, EmptyState, Pill, SectionTitle } from '@/components/ui';
import { useCompetitions } from '@/hooks/use-competitions';
import { useMyLeagues } from '@/hooks/use-my-leagues';
import { useRequireUser } from '@/hooks/use-route-access';
import { colors, heading } from '@/theme';

export default function DashboardScreen() {
  useRequireUser();
  const leagues = useMyLeagues();
  const competitions = useCompetitions();

  return (
    <AppShell
      eyebrow="Your season"
      title="Dashboard"
      action={<ActionButton label="Create league" href="/leagues/new" />}
    >
      <SectionTitle title="Your leagues" detail={`${leagues.length} total`} />
      {leagues.length === 0 ? (
        <EmptyState
          title="No leagues yet"
          body="Create a private league or enter an invitation code to join your friends."
        />
      ) : (
        <View style={styles.list}>
          {leagues.map((league) => (
            <Card key={league.id} style={styles.leagueCard}>
              <View style={styles.leagueCopy}>
                <Text style={styles.leagueName}>{league.name}</Text>
                <Text style={styles.leagueMeta}>
                  Head-to-head · {league.maxMembers} managers · {league.status}
                </Text>
              </View>
              <ActionButton label="Open" href={`/league/${league.id}`} variant="secondary" />
            </Card>
          ))}
        </View>
      )}

      <SectionTitle title="Season data" detail="Official imports" />
      {competitions.length === 0 ? (
        <EmptyState
          title="Season data is not active"
          body="Official roster and schedule information will be provided shortly."
        />
      ) : (
        <Card style={styles.dataCard}>
          {competitions.map((competition) => (
            <View key={competition.id} style={styles.programRow}>
              <View style={styles.leagueCopy}>
                <Text style={styles.programName}>{competition.name}</Text>
                <Text style={styles.leagueMeta}>{competition.seasonLabel}</Text>
              </View>
              <Pill label={competition.isActive ? 'ACTIVE' : 'PENDING'} tone="info" />
            </View>
          ))}
        </Card>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  leagueCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 },
  leagueCopy: { flex: 1, minWidth: 180 },
  leagueName: { ...heading, fontSize: 18 },
  leagueMeta: { color: colors.muted, fontSize: 12, marginTop: 4, textTransform: 'capitalize' },
  dataCard: { paddingVertical: 4 },
  programRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  programName: { color: colors.text, fontSize: 14, fontWeight: '800' },
});

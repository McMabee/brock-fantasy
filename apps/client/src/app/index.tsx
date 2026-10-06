import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppShell, Card, EmptyState, Pill, SectionTitle } from '@/components/ui';
import { useCompetitions } from '@/hooks/use-competitions';
import { useSession } from '@/providers/session-provider';
import { colors, heading } from '@/theme';

export default function HomeScreen() {
  const { user, loading } = useSession();
  const competitions = useCompetitions();

  return (
    <AppShell>
      <View style={styles.hero}>
        <Pill label="2026–27 SEASON" tone="positive" />
        <Text accessibilityRole="header" style={styles.title}>
          Fantasy competition{`\n`}for Brock Badgers.
        </Text>
        <Text style={styles.body}>
          Build a private league, draft verified varsity athletes, and follow audited fantasy
          scoring across Brock programs.
        </Text>
        <View style={styles.actions}>
          <ActionButton
            label={user ? 'Open dashboard' : 'Sign in'}
            href={user ? '/dashboard' : '/auth'}
          />
          {!loading && !user ? (
            <ActionButton label="Create an account" href="/auth" variant="secondary" />
          ) : null}
        </View>
      </View>

      <SectionTitle title="2026–27 programs" detail="Imported source data" />
      {competitions.length === 0 ? (
        <EmptyState
          title="Program information is being prepared"
          body="Official roster and schedule information will be provided shortly."
        />
      ) : (
        <View style={styles.programGrid}>
          {competitions.map((competition) => (
            <Card key={competition.id} style={styles.programCard}>
              <Text style={styles.programName}>{competition.name}</Text>
              <Text style={styles.programMeta}>
                {competition.division === 'womens' ? 'Women’s' : 'Men’s'} · {competition.sport} ·{' '}
                {competition.seasonLabel}
              </Text>
              <Pill label={competition.isActive ? 'AVAILABLE' : 'COMING SOON'} tone="info" />
            </Card>
          ))}
        </View>
      )}
    </AppShell>
  );
}

const styles = StyleSheet.create({
  hero: { paddingVertical: 48, maxWidth: 750 },
  title: { ...heading, fontSize: 52, lineHeight: 56, marginTop: 18 },
  body: { color: colors.muted, fontSize: 17, lineHeight: 26, marginTop: 18, maxWidth: 640 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 24 },
  programGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  programCard: { flex: 1, minWidth: 250, gap: 9 },
  programName: { ...heading, fontSize: 18 },
  programMeta: { color: colors.muted, fontSize: 12, textTransform: 'capitalize' },
});

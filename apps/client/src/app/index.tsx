import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import type { Competition, DivisionCode } from '@brock-fantasy/domain';

import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  SectionTitle,
} from '@/components/ui';
import { useCompetitions } from '@/hooks/use-competitions';
import { ASSOCIATION_INSTAGRAM_URL } from '@/lib/association';
import { useSession } from '@/providers/session-provider';
import { heading } from '@/theme';
import { programNames } from '@/lib/player-program';

const PROGRAM_DIVISIONS = ['womens', 'mens'] as const;
const PUBLIC_PROGRAM_COLUMNS = PROGRAM_DIVISIONS.map((division) => ({
  division,
  programs: Object.entries(programNames).filter(([key]) => key.startsWith(`${division}_`)),
}));

export default function HomeScreen() {
  const styles = useThemedStyles(createStyles);
  const { user, loading } = useSession();
  const competitionQuery = useCompetitions(Boolean(user));
  const competitions = competitionQuery.data;
  // - Group programs in one pass to keep women on the left and men on the right
  const competitionColumns: Record<DivisionCode, Competition[]> = { womens: [], mens: [] };
  for (const competition of competitions)
    competitionColumns[competition.division].push(competition);

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
            href={user ? '/dashboard' : '/auth?mode=sign-in'}
          />
          {!loading && !user ? (
            <ActionButton label="Create an account" href="/auth?mode=sign-up" variant="secondary" />
          ) : null}
        </View>
        <Text style={styles.instagram}>
          Follow{' '}
          <Link
            href={ASSOCIATION_INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            accessibilityRole="link"
            style={styles.instagramLink}
          >
            @therealbrockfantasy on Instagram
          </Link>{' '}
          for association news, announcements and fantasy updates.
        </Text>
      </View>

      <SectionTitle title="2026–27 programs" />
      {!user ? (
        <View style={styles.programGrid}>
          {PUBLIC_PROGRAM_COLUMNS.map(({ division, programs }) => (
            <View key={division} style={styles.programColumn}>
              {programs.map(([key, name]) => (
                <Card key={key} style={styles.programCard}>
                  <Text style={styles.programName}>{name}</Text>
                  <Text style={styles.programMeta}>Brock Badgers, 2026–27</Text>
                </Card>
              ))}
            </View>
          ))}
        </View>
      ) : competitionQuery.loading ? (
        <LoadingState label="Loading programs" rows={2} />
      ) : competitionQuery.error ? (
        <ErrorState message={competitionQuery.error} />
      ) : competitions.length === 0 ? (
        <EmptyState
          title="Program information is being prepared"
          body="Official roster and schedule information will be provided shortly."
        />
      ) : (
        <View style={styles.programGrid}>
          {PROGRAM_DIVISIONS.map((division) => (
            <View key={division} style={styles.programColumn}>
              {competitionColumns[division].map((competition) => (
                <Card key={competition.id} style={styles.programCard}>
                  <Text style={styles.programName}>{competition.name}</Text>
                  <Text style={styles.programMeta}>
                    {competition.division === 'womens' ? 'Women’s' : 'Men’s'}, {competition.sport},{' '}
                    {competition.seasonLabel}
                  </Text>
                  <Pill label={competition.isActive ? 'AVAILABLE' : 'COMING SOON'} tone="info" />
                </Card>
              ))}
            </View>
          ))}
        </View>
      )}
    </AppShell>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    hero: { paddingVertical: 48, maxWidth: 750 },
    title: { ...heading, fontSize: 52, lineHeight: 56, marginTop: 18, color: colors.text },
    body: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 17,
      lineHeight: 26,
      marginTop: 18,
      maxWidth: 640,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 24 },
    instagram: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 14,
      lineHeight: 22,
      marginTop: 24,
      maxWidth: 640,
    },
    instagramLink: { color: colors.link, textDecorationLine: 'underline' },
    programGrid: { flexDirection: 'row', gap: 14 },
    programColumn: { flex: 1, minWidth: 0, gap: 14 },
    programCard: { minWidth: 0, gap: 9 },
    programName: { ...heading, fontSize: 18, color: colors.text },
    programMeta: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 12,
      textTransform: 'capitalize',
    },
  });

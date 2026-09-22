import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, useUiStyles } from '@/components/ui';
import { demoCompetitions } from '@/data/demo';
import { createHeading, radii, useThemedStyles, type ThemeColors } from '@/theme';

const sportGlyph = { hockey: '◆', basketball: '●', volleyball: '▲' } as const;

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const wide = width >= 780;

  return (
    <AppShell>
      <View style={[styles.hero, wide && styles.heroWide]}>
        <View style={styles.heroCopy}>
          <Pill label="2026–27 SEASON" tone="positive" />
          <Text accessibilityRole="header" style={[styles.heroTitle, wide && styles.heroTitleWide]}>
            Brock sports.{`\n`}
            <Text style={styles.heroTitleAccent}>Your roster.</Text>
          </Text>
          <Text style={styles.heroBody}>
            Draft Badgers athletes, build a private league, and follow every fantasy point across
            hockey, basketball, and volleyball.
          </Text>
          <View style={styles.heroActions}>
            <ActionButton label="Enter the league" href="/auth" />
            <ActionButton label="Explore demo" href="/dashboard" variant="secondary" />
          </View>
          <View style={styles.trustRow}>
            <Text style={styles.trustText}>Official-stat ready</Text>
            <Text style={styles.trustDot}>•</Text>
            <Text style={styles.trustText}>Auditable scoring</Text>
            <Text style={styles.trustDot}>•</Text>
            <Text style={styles.trustText}>Web + mobile (soon...)</Text>
          </View>
        </View>
        <Card accent style={styles.scoreCard}>
          <View style={styles.liveRow}>
            <Pill label="LIVE · PERIOD 3" tone="warning" />
            <Text style={styles.liveTime}>04:18</Text>
          </View>
          <Text style={styles.matchLabel}>WEEK 6 MATCHUP</Text>
          <View style={styles.teamScore}>
            <View style={styles.teamIdentity}>
              <View style={[styles.teamBadge, styles.teamBadgePrimary]}>
                <Text style={styles.teamBadgeText}>PP</Text>
              </View>
              <View>
                <Text style={styles.teamName}>Power Playmakers</Text>
                <Text style={styles.teamRecord}>4–1 · 1st place</Text>
              </View>
            </View>
            <Text style={styles.score}>78.5</Text>
          </View>
          <View style={styles.scoreRule} />
          <View style={styles.teamScore}>
            <View style={styles.teamIdentity}>
              <View style={styles.teamBadge}>
                <Text style={styles.teamBadgeText}>GM</Text>
              </View>
              <View>
                <Text style={styles.teamName}>Green Machine</Text>
                <Text style={styles.teamRecord}>3–2 · 2nd place</Text>
              </View>
            </View>
            <Text style={styles.scoreMuted}>74.0</Text>
          </View>
          <View style={styles.scoreFooter}>
            <Text style={styles.scoreFooterLabel}>Latest play</Text>
            <Text style={styles.scoreFooterValue}>E. Kelly · Goal +3.0</Text>
          </View>
        </Card>
      </View>

      <SectionTitle title="Six teams. One fantasy home." detail="Private leagues · Two formats" />
      <View style={styles.competitionGrid}>
        {demoCompetitions.map((competition) => (
          <Card key={competition.id} style={styles.competitionCard}>
            <View style={styles.competitionGlyph}>
              <Text style={styles.competitionGlyphText}>{sportGlyph[competition.sport]}</Text>
            </View>
            <View style={styles.competitionCopy}>
              <Text style={uiStyles.label}>{competition.name}</Text>
              <Text style={styles.competitionSeason}>{competition.seasonLabel}</Text>
            </View>
            <Text accessibilityLabel="Available" style={styles.availableMark}>
              ✓
            </Text>
          </Card>
        ))}
      </View>

      <View style={[styles.featureBand, wide && styles.featureBandWide]}>
        <Feature
          number="01"
          title="Draft together"
          body="A realtime snake draft with reconnect-safe picks, timer, and deterministic autopick."
        />
        <Feature
          number="02"
          title="Trust every point"
          body="Provider inputs, corrections, and adjustments remain traceable through an append-only ledger."
        />
        <Feature
          number="03"
          title="Compete your way"
          body="Choose weekly head-to-head matchups or a season-long cumulative leaderboard."
        />
      </View>
    </AppShell>
  );
}

function Feature({ number, title, body }: { number: string; title: string; body: string }) {
  const styles = useStyles();
  return (
    <View style={styles.feature}>
      <Text style={styles.featureNumber}>{number}</Text>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureBody}>{body}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    hero: { paddingTop: 42, gap: 36 },
    heroWide: { flexDirection: 'row', alignItems: 'center', paddingTop: 70, paddingBottom: 34 },
    heroCopy: { flex: 1, maxWidth: 650 },
    heroTitle: { ...createHeading(colors), fontSize: 48, lineHeight: 52, marginTop: 20 },
    heroTitleWide: { fontSize: 68, lineHeight: 70, letterSpacing: -2.5 },
    heroTitleAccent: { color: colors.brand },
    heroBody: { color: colors.muted, fontSize: 18, lineHeight: 28, maxWidth: 590, marginTop: 20 },
    heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 28 },
    trustRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 25,
      alignItems: 'center',
    },
    trustText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
    trustDot: { color: colors.brand },
    scoreCard: {
      flex: 0.76,
      minWidth: 310,
      maxWidth: 460,
      padding: 22,
      transform: [{ rotate: '1deg' }],
    },
    liveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    liveTime: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    matchLabel: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.5,
      marginTop: 24,
      marginBottom: 15,
    },
    teamScore: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    teamIdentity: { flexDirection: 'row', alignItems: 'center', gap: 11, flexShrink: 1 },
    teamBadge: {
      width: 43,
      height: 43,
      borderRadius: 13,
      backgroundColor: colors.panelStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    teamBadgePrimary: { backgroundColor: colors.brand },
    teamBadgeText: { color: colors.onBrand, fontWeight: '900', fontSize: 12 },
    teamName: { color: colors.text, fontSize: 14, fontWeight: '800' },
    teamRecord: { color: colors.muted, fontSize: 11, marginTop: 3 },
    score: { color: colors.brand, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
    scoreMuted: {
      color: colors.text,
      fontSize: 30,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    scoreRule: { height: 1, backgroundColor: colors.border, marginVertical: 15 },
    scoreFooter: {
      marginTop: 22,
      backgroundColor: colors.canvasSoft,
      borderRadius: radii.sm,
      padding: 12,
    },
    scoreFooterLabel: {
      color: colors.muted,
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
    },
    scoreFooterValue: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 4 },
    competitionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    competitionCard: {
      minWidth: 245,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      padding: 14,
    },
    competitionGlyph: {
      width: 38,
      height: 38,
      borderRadius: 11,
      backgroundColor: colors.canvasSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    competitionGlyphText: { color: colors.brand, fontSize: 17 },
    competitionCopy: { flex: 1 },
    competitionSeason: { color: colors.muted, fontSize: 11, marginTop: 2 },
    availableMark: { color: colors.brand, fontWeight: '900' },
    featureBand: {
      marginTop: 46,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      paddingTop: 30,
      gap: 28,
    },
    featureBandWide: { flexDirection: 'row' },
    feature: { flex: 1, minWidth: 220 },
    featureNumber: { color: colors.brand, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
    featureTitle: { ...createHeading(colors), fontSize: 20, marginTop: 9 },
    featureBody: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  });

const useStyles = () => useThemedStyles(createStyles);

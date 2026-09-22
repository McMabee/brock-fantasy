import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { LeagueFormat } from '@brock-fantasy/domain';

import { ActionButton, AppShell, Card, Pill, useUiStyles } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { createHeading, useAppTheme, useThemedStyles, type ThemeColors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';
import { useCompetitions } from '@/hooks/use-competitions';

export default function NewLeagueScreen() {
  useRequireUser();
  const competitions = useCompetitions();
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const [name, setName] = useState('');
  const [competitionId, setCompetitionId] = useState('');
  const [format, setFormat] = useState<LeagueFormat>('head_to_head');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!competitionId && competitions[0]) setCompetitionId(competitions[0].id);
  }, [competitionId, competitions]);

  const createLeague = async () => {
    if (name.trim().length < 3 || !competitionId) {
      setError(
        'Choose an active competition and enter a league name of at least three characters.',
      );
      return;
    }
    setLoading(true);
    setError(null);
    if (!supabase) {
      router.replace('/league/demo-league');
      return;
    }
    const result = (await supabase.rpc('create_league', {
      p_name: name.trim(),
      p_competition_id: competitionId,
      p_format: format,
      p_idempotency_key: `create-${Date.now()}`,
    })) as { data: { league_id: string } | null; error: { message: string } | null };
    setLoading(false);
    if (result.error) setError(result.error.message);
    else if (result.data) router.replace(`/league/${result.data.league_id}`);
  };

  return (
    <AppShell eyebrow="League setup" title="Create your league">
      <Card style={styles.form}>
        <View style={styles.field}>
          <Text style={uiStyles.label}>League name</Text>
          <TextInput
            accessibilityLabel="League name"
            maxLength={60}
            onChangeText={setName}
            placeholder="e.g. Brock Alumni League"
            placeholderTextColor={colors.muted}
            style={uiStyles.input}
            value={name}
          />
        </View>

        <View style={styles.field}>
          <Text style={uiStyles.label}>Competition</Text>
          <View style={styles.options}>
            {competitions.map((competition) => (
              <Option
                key={competition.id}
                active={competitionId === competition.id}
                label={competition.name}
                onPress={() => setCompetitionId(competition.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={uiStyles.label}>League format</Text>
          <View style={styles.formatGrid}>
            <FormatOption
              active={format === 'head_to_head'}
              title="Weekly head-to-head"
              body="Scheduled opponents, wins and losses, then points-for as the configured tiebreaker."
              onPress={() => setFormat('head_to_head')}
            />
            <FormatOption
              active={format === 'points_leaderboard'}
              title="Points leaderboard"
              body="Every fantasy point counts toward one season-long cumulative ranking."
              onPress={() => setFormat('points_leaderboard')}
            />
          </View>
        </View>

        <View style={styles.ruleSummary}>
          <Pill label="LOCKED AFTER DRAFT" tone="info" />
          <Text style={styles.ruleText}>
            This league uses the approved, versioned ruleset for its competition. Format and ruleset
            are pinned once drafting begins.
          </Text>
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <ActionButton label="Cancel" href="/dashboard" variant="ghost" />
          <ActionButton
            label="Create private league"
            onPress={() => void createLeague()}
            loading={loading}
          />
        </View>
      </Card>
    </AppShell>
  );
}

function Option({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      aria-checked={active}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[styles.option, active && styles.optionActive]}
    >
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function FormatOption({
  active,
  title,
  body,
  onPress,
}: {
  active: boolean;
  title: string;
  body: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      aria-checked={active}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[styles.formatOption, active && styles.formatOptionActive]}
    >
      <View style={[styles.radio, active && styles.radioActive]}>
        {active ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.formatCopy}>
        <Text style={styles.formatTitle}>{title}</Text>
        <Text style={styles.formatBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    form: { maxWidth: 840, width: '100%', alignSelf: 'center', gap: 26, padding: 25 },
    field: { gap: 10 },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    option: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 13,
      paddingVertical: 9,
      backgroundColor: colors.canvasSoft,
    },
    optionActive: { borderColor: colors.brand, backgroundColor: colors.selected },
    optionText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
    optionTextActive: { color: colors.brand },
    formatGrid: { gap: 10 },
    formatOption: {
      flexDirection: 'row',
      gap: 13,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 13,
      padding: 15,
      backgroundColor: colors.canvasSoft,
    },
    formatOptionActive: { borderColor: colors.brand, backgroundColor: colors.selected },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderColor: colors.border,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    radioActive: { borderColor: colors.brand },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
    formatCopy: { flex: 1 },
    formatTitle: { ...createHeading(colors), fontSize: 15 },
    formatBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
    ruleSummary: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.canvasSoft,
      padding: 13,
      borderRadius: 10,
    },
    ruleText: { color: colors.muted, fontSize: 11, lineHeight: 17, flex: 1, minWidth: 220 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 },
    error: { color: colors.danger, fontSize: 12 },
  });

const useStyles = () => useThemedStyles(createStyles);

import { newCommandKey } from '../../lib/command-key';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LEAGUE_SIZES } from '@brock-fantasy/domain';

import { ActionButton, AppShell, Card, Pill, useUiStyles } from '@/components/ui';
import { betaCommand } from '@/lib/web-api';

import { useRequireUser } from '@/hooks/use-route-access';
import { RulesLink } from '@/components/rules-link';
import { supabase } from '@/lib/supabase';

interface LeagueCreationContext {
  available: boolean;
  reason?: string;
  poolId?: string;
  seasonLabel?: string;
  windows?: Partial<
    Record<string, { open: boolean; deadline: string | null; firstScoringPeriodId: string | null }>
  >;
}

export default function NewLeagueScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const colors = useThemeColors();
  const { allowed, loading: sessionLoading } = useRequireUser();
  const router = useRouter();
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [size, setSize] = useState<(typeof LEAGUE_SIZES)[number]>(8);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<LeagueCreationContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const attempt = useRef<{
    name: string;
    teamName: string;
    size: number;
    poolId: string;
    key: string;
  } | null>(null);
  const selectedWindow = context?.windows?.[String(size)];

  useEffect(() => {
    let active = true;
    const client = supabase;
    if (!allowed || sessionLoading || !client) {
      setContextLoading(Boolean(sessionLoading));
      return () => {
        active = false;
      };
    }
    const load = async () => {
      setContextLoading(true);
      try {
        const result = await client.rpc('get_league_creation_context');
        if (!active) return;
        if (result.error) throw result.error;
        setContext((result.data as LeagueCreationContext | null) ?? null);
        setContextError(null);
      } catch {
        if (!active) return;
        setContext(null);
        setContextError('The current season could not be loaded. Please refresh and try again.');
      } finally {
        if (active) setContextLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [allowed, sessionLoading]);

  const createLeague = async () => {
    if (submitting.current || !allowed || sessionLoading) return;
    const leagueName = name.trim();
    const creatorTeamName = teamName.trim();
    if (leagueName.length < 3 || leagueName.length > 60) {
      setError('Enter a league name between 3 and 60 characters.');
      return;
    }
    if (creatorTeamName.length < 3 || creatorTeamName.length > 60) {
      setError('Enter a fantasy team name between 3 and 60 characters.');
      return;
    }
    if (!context?.available || !context.poolId || !selectedWindow?.open) {
      setError(context?.reason ?? 'New leagues are not available for this manager count.');
      return;
    }
    if (
      attempt.current?.name !== leagueName ||
      attempt.current.teamName !== creatorTeamName ||
      attempt.current.size !== size ||
      attempt.current.poolId !== context.poolId
    ) {
      attempt.current = {
        name: leagueName,
        teamName: creatorTeamName,
        size,
        poolId: context.poolId,
        key: newCommandKey(),
      };
    }
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await betaCommand<{ league_id: string }>('create_beta_league', {
        p_name: leagueName,
        p_team_name: creatorTeamName,
        p_pool_id: context.poolId,
        p_max_members: size,
        p_idempotency_key: attempt.current.key,
      });
      if (result.error) setError(result.error);
      else if (result.data?.league_id) router.replace(`/league/${result.data.league_id}`);
      else setError('The league could not be created. Please try again.');
    } catch {
      setError('Unable to reach the league service. Please try again.');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <AppShell eyebrow="League setup" title="Create your league">
      <Card style={styles.form}>
        <View style={styles.field}>
          <Text style={uiStyles.label}>League name</Text>
          <TextInput
            accessibilityLabel="League name"
            editable={!loading}
            maxLength={60}
            onChangeText={setName}
            placeholder="e.g. Brock Alumni League"
            placeholderTextColor={colors.muted}
            style={uiStyles.input}
            value={name}
          />
        </View>

        <View style={styles.field}>
          <Text style={uiStyles.label}>Your fantasy team name</Text>
          <TextInput
            accessibilityLabel="Your fantasy team name"
            editable={!loading}
            maxLength={60}
            onChangeText={setTeamName}
            placeholder="e.g. Power Playmakers"
            placeholderTextColor={colors.muted}
            style={uiStyles.input}
            value={teamName}
          />
        </View>

        <View style={styles.field}>
          <Text style={uiStyles.label}>Season player pool</Text>
          <Text style={styles.poolSummary}>
            {contextLoading
              ? 'Loading the newest published season.'
              : context?.available
                ? `${context.seasonLabel} includes Brock men’s and women’s hockey, basketball, and volleyball.`
                : (context?.reason ?? 'New leagues are unavailable.')}
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={uiStyles.label}>Managers</Text>
          <View style={styles.options}>
            {LEAGUE_SIZES.map((leagueSize) => (
              <Option
                key={leagueSize}
                active={size === leagueSize}
                disabled={
                  loading || contextLoading || !context?.windows?.[String(leagueSize)]?.open
                }
                label={`${leagueSize} teams`}
                onPress={() => setSize(leagueSize)}
              />
            ))}
          </View>
        </View>

        <View style={styles.ruleSummary}>
          <Pill label="HEAD-TO-HEAD, 10 ROUNDS" tone="info" />
          <Text style={styles.ruleText}>
            Each roster has seven starters, including FLEX, and three bench positions. Leagues with
            a varsity athlete or coach use two starters of any position per sport, plus FLEX. Draft
            order is randomized once, with snake-draft picks and server-side autopicks. Each pick
            defaults to two minutes; commissioners can change the timer before starting the draft,
            with a minimum of 20 seconds.
          </Text>
          {selectedWindow?.open ? (
            <Text style={styles.poolSummary}>
              New leagues are available until {formatDeadline(selectedWindow.deadline)} Toronto
              time. Your draft must finish before a period’s first scoring game to join that period.
            </Text>
          ) : (
            <Text accessibilityRole="alert" style={styles.error}>
              {contextLoading
                ? 'Checking league availability.'
                : (contextError ??
                  'This manager count has no eligible regular-season period remaining.')}
            </Text>
          )}
          <RulesLink label="Read the league rules before creating a team" />
        </View>
        {contextError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {contextError}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <ActionButton label="Cancel" href="/dashboard" variant="secondary" disabled={loading} />
          <ActionButton
            label="Create private league"
            onPress={() => void createLeague()}
            loading={loading}
            disabled={!allowed || sessionLoading || contextLoading || !selectedWindow?.open}
          />
        </View>
      </Card>
    </AppShell>
  );
}

function formatDeadline(value: string | null): string {
  if (!value) return 'the next scoring-game cutoff';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function Option({
  active,
  disabled,
  label,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.option, active && styles.optionActive]}
    >
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
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
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: colors.canvasSoft,
    },
    optionActive: { borderColor: colors.red, backgroundColor: colors.canvasSoft },
    optionText: { fontFamily: 'Inter', color: colors.muted, fontSize: 12, fontWeight: '700' },
    optionTextActive: { color: colors.text },
    poolSummary: { fontFamily: 'Inter', color: colors.muted, fontSize: 13, lineHeight: 20 },
    ruleSummary: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.canvasSoft,
      padding: 13,
      borderRadius: 10,
    },
    ruleText: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 11,
      lineHeight: 17,
      flex: 1,
      minWidth: 220,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 },
    error: { fontFamily: 'Inter', color: colors.danger, fontSize: 12 },
  });

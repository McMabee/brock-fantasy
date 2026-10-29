import { newCommandKey } from '../../lib/command-key';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, useUiStyles } from '@/components/ui';
import { betaCommand } from '@/lib/web-api';
import { supabase } from '@/lib/supabase';
import { heading } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

export default function JoinLeagueScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const colors = useThemeColors();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const suppliedCode =
    typeof code === 'string' && /^(?:[A-Z0-9]{8}|[A-Z0-9]{12})$/iu.test(code)
      ? code.toUpperCase()
      : '';
  const { allowed, loading: sessionLoading } = useRequireUser(
    suppliedCode ? `/leagues/join?code=${suppliedCode}` : '/leagues/join',
  );
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState(suppliedCode);
  useEffect(() => {
    if (suppliedCode) setInviteCode(suppliedCode);
  }, [suppliedCode]);
  useEffect(() => {
    let active = true;
    if (allowed && suppliedCode && supabase)
      void supabase
        .from('leagues')
        .select('id')
        .eq('invite_code', suppliedCode)
        .maybeSingle()
        .then((result) => {
          if (active && result.data?.id) router.replace(`/league/${result.data.id}`);
        });
    return () => {
      active = false;
    };
  }, [allowed, suppliedCode, router]);
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const attempt = useRef<{ code: string; name: string; key: string } | null>(null);

  const join = async () => {
    if (submitting.current || !allowed || sessionLoading) return;
    const code = inviteCode.trim().toUpperCase();
    const name = teamName.trim();
    if (!/^(?:[A-Z0-9]{8}|[A-Z0-9]{12})$/u.test(code)) {
      setError('Enter the 8- or 12-character invite code provided by your league commissioner.');
      return;
    }
    if (name.length < 3 || name.length > 60) {
      setError('Enter a fantasy team name between 3 and 60 characters.');
      return;
    }
    if (attempt.current?.code !== code || attempt.current.name !== name) {
      attempt.current = {
        code,
        name,
        key: newCommandKey(),
      };
    }
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await betaCommand<{ league_id: string }>('join_league', {
        p_invite_code: code,
        p_team_name: name,
        p_idempotency_key: attempt.current.key,
      });
      if (result.error) setError(result.error);
      else if (result.data?.league_id) router.replace(`/league/${result.data.league_id}`);
      else setError('The league could not be joined. Please try again.');
    } catch {
      setError('Unable to reach the league service. Please try again.');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <AppShell eyebrow="Private leagues" title="Join your friends">
      <Card style={styles.card}>
        <Pill label="INVITE REQUIRED" tone="info" />
        <Text style={styles.title}>Enter your league code</Text>
        <Text style={styles.body}>Ask the league commissioner for the private invite code.</Text>
        <Text style={styles.body}>
          Joining creates one fantasy team linked to your verified account.
        </Text>
        <View style={styles.field}>
          <Text style={uiStyles.label}>Invite code</Text>
          <TextInput
            accessibilityLabel="League invite code"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!loading}
            maxLength={16}
            onChangeText={setInviteCode}
            placeholder="A1B2C3D4E5F6"
            placeholderTextColor={colors.muted}
            style={[uiStyles.input, styles.codeInput]}
            value={inviteCode}
          />
        </View>
        <View style={styles.field}>
          <Text style={uiStyles.label}>Fantasy team name</Text>
          <TextInput
            accessibilityLabel="Fantasy team name"
            editable={!loading}
            maxLength={60}
            onChangeText={setTeamName}
            onSubmitEditing={() => void join()}
            placeholder="Power Playmakers"
            placeholderTextColor={colors.muted}
            style={uiStyles.input}
            value={teamName}
          />
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <ActionButton label="Cancel" href="/dashboard" variant="secondary" disabled={loading} />
          <ActionButton
            label="Join league"
            onPress={() => void join()}
            loading={loading}
            disabled={!allowed || sessionLoading}
          />
        </View>
      </Card>
    </AppShell>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    card: { maxWidth: 540, width: '100%', alignSelf: 'center', gap: 18, padding: 26 },
    title: { ...heading, fontSize: 25, marginTop: 4, color: colors.text },
    body: { fontFamily: 'Inter', color: colors.muted, fontSize: 13, lineHeight: 21 },
    field: { gap: 7 },
    codeInput: { fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' },
    error: { fontFamily: 'Inter', color: colors.danger, fontSize: 12 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 },
  });

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, uiStyles } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { colors, heading } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

export default function JoinLeagueScreen() {
  useRequireUser();
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const join = async () => {
    if (inviteCode.trim().length < 6 || teamName.trim().length < 3) {
      setError('Enter a valid invite code and a team name of at least three characters.');
      return;
    }
    setLoading(true);
    setError(null);
    if (!supabase) {
      router.replace('/league/demo-league');
      return;
    }
    const result = (await supabase.rpc('join_league', {
      p_invite_code: inviteCode.trim().toUpperCase(),
      p_team_name: teamName.trim(),
      p_idempotency_key: `join-${Date.now()}`,
    })) as { data: { league_id: string } | null; error: { message: string } | null };
    setLoading(false);
    if (result.error) setError(result.error.message);
    else if (result.data) router.replace(`/league/${result.data.league_id}`);
  };

  return (
    <AppShell eyebrow="Private leagues" title="Join your friends">
      <Card style={styles.card}>
        <Pill label="INVITE REQUIRED" tone="info" />
        <Text style={styles.title}>Enter your league code</Text>
        <Text style={styles.body}>
          Ask the league commissioner for the private eight-character code. Joining creates one
          fantasy team linked to your verified account.
        </Text>
        <View style={styles.field}>
          <Text style={uiStyles.label}>Invite code</Text>
          <TextInput
            accessibilityLabel="League invite code"
            autoCapitalize="characters"
            maxLength={12}
            onChangeText={setInviteCode}
            placeholder="BADGERS26"
            placeholderTextColor={colors.muted}
            style={[uiStyles.input, styles.codeInput]}
            value={inviteCode}
          />
        </View>
        <View style={styles.field}>
          <Text style={uiStyles.label}>Fantasy team name</Text>
          <TextInput
            accessibilityLabel="Fantasy team name"
            maxLength={60}
            onChangeText={setTeamName}
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
          <ActionButton label="Cancel" href="/dashboard" variant="ghost" />
          <ActionButton label="Join league" onPress={() => void join()} loading={loading} />
        </View>
      </Card>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  card: { maxWidth: 540, width: '100%', alignSelf: 'center', gap: 18, padding: 26 },
  title: { ...heading, fontSize: 25, marginTop: 4 },
  body: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  field: { gap: 7 },
  codeInput: { fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' },
  error: { color: colors.danger, fontSize: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 },
});

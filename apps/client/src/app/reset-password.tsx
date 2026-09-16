import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, uiStyles } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { colors } from '@/theme';

export default function ResetPasswordScreen() {
  const url = Linking.useURL();
  const { demoMode, user } = useSession();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!url || !supabase || user) return;
    const tokens = recoveryTokens(url);
    if (!tokens) return;
    void supabase.auth.setSession(tokens).then(({ error }) => {
      if (error) setMessage('This recovery link is invalid or has expired. Request a new one.');
    });
  }, [url, user]);

  const updatePassword = async () => {
    setMessage(null);
    if (password.length < 8 || password !== confirmation) {
      setMessage('Use at least eight characters and enter the same password twice.');
      return;
    }
    if (!supabase) {
      setComplete(true);
      setMessage('Demo password updated locally.');
      return;
    }
    if (!user) {
      setMessage('Open this page from a current recovery email before choosing a new password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) setMessage(error.message);
    else {
      setComplete(true);
      setPassword('');
      setConfirmation('');
      setMessage('Your password has been changed.');
    }
  };

  return (
    <AppShell eyebrow="Account recovery" title="Choose a new password">
      <Card style={styles.card}>
        <Pill
          label={user || demoMode ? 'RECOVERY VERIFIED' : 'RECOVERY LINK REQUIRED'}
          tone="info"
        />
        <Text style={uiStyles.body}>
          Use the newest recovery email. Links are single-purpose and may expire; request another
          from the sign-in page if this one no longer works.
        </Text>
        {!complete ? (
          <>
            <PasswordField label="New password" value={password} onChangeText={setPassword} />
            <PasswordField
              label="Confirm new password"
              value={confirmation}
              onChangeText={setConfirmation}
            />
            <ActionButton
              label="Update password"
              onPress={() => void updatePassword()}
              loading={loading}
            />
          </>
        ) : (
          <ActionButton label="Continue to your dashboard" href="/dashboard" />
        )}
        {message ? (
          <Text accessibilityRole="alert" style={styles.message}>
            {message}
          </Text>
        ) : null}
        <View style={styles.footer}>
          <ActionButton label="Back to sign in" href="/auth" variant="ghost" />
        </View>
      </Card>
    </AppShell>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={uiStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoComplete="new-password"
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        secureTextEntry
        style={uiStyles.input}
        value={value}
      />
    </View>
  );
}

function recoveryTokens(url: string): { access_token: string; refresh_token: string } | null {
  const fragment = url.includes('#') ? (url.split('#')[1] ?? '') : '';
  const query = url.includes('?') ? (url.split('?')[1]?.split('#')[0] ?? '') : '';
  const params = new URLSearchParams([query, fragment].filter(Boolean).join('&'));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  return accessToken && refreshToken
    ? { access_token: accessToken, refresh_token: refreshToken }
    : null;
}

const styles = StyleSheet.create({
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: 16 },
  field: { gap: 7 },
  message: { color: colors.brand, fontSize: 12, lineHeight: 18 },
  footer: { alignItems: 'flex-end' },
});

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, uiStyles } from '@/components/ui';
import { useSession } from '@/providers/session-provider';
import { colors } from '@/theme';

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useSession();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (loading) return;
    setError(null);
    const address = email.trim().toLowerCase();
    if (address.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const message = await requestPasswordReset(address);
      if (message) setError(message);
      else setSent(true);
    } catch {
      setError('Unable to request a reset link. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell eyebrow="Account recovery" title={sent ? 'Check your email' : 'Reset your password'}>
      <Card style={styles.card}>
        {sent ? (
          <>
            <Text accessibilityRole="alert" style={uiStyles.body}>
              If an account exists for that email, a password reset link is on its way.
            </Text>
            <Text style={uiStyles.body}>
              Check your inbox and spam folder. Open the newest link in the same browser you used
              here to choose a new password.
            </Text>
            <ActionButton
              label="Try another email"
              variant="secondary"
              onPress={() => {
                setEmail('');
                setError(null);
                setSent(false);
              }}
            />
          </>
        ) : (
          <>
            <Text style={uiStyles.body}>
              Enter the email address for your Brock Fantasy account. We will email you a link to
              choose a new password.
            </Text>
            <View style={styles.field}>
              <Text style={uiStyles.label}>Email address</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!loading}
                inputMode="email"
                maxLength={320}
                onChangeText={setEmail}
                onSubmitEditing={() => void submit()}
                placeholder="you@example.com"
                placeholderTextColor={colors.muted}
                returnKeyType="send"
                style={uiStyles.input}
                value={email}
              />
            </View>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <ActionButton label="Send reset link" loading={loading} onPress={() => void submit()} />
          </>
        )}
        <ActionButton label="Back to sign in" href="/auth" variant="ghost" />
      </Card>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: 16 },
  field: { gap: 7 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
});

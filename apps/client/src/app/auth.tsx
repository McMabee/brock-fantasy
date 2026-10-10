import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ActionButton, AppShell, Card, Pill, uiStyles } from '@/components/ui';
import { useSession } from '@/providers/session-provider';
import { colors, heading } from '@/theme';
import { authReturnPath } from '@/lib/admin-navigation';

export default function AuthScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { width } = useWindowDimensions();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setError(null);
    if (!email.includes('@') || password.length < 8) {
      setError('Enter your administrator email and password.');
      return;
    }
    setLoading(true);
    try {
      const message = await signIn(email.trim(), password);
      if (message) setError(message);
      else router.replace(next ? authReturnPath(next) : '/dashboard');
    } finally {
      setLoading(false);
    }
  };
  return (
    <AppShell>
      <View style={[styles.layout, width >= 820 && styles.layoutWide]}>
        <View style={styles.copy}>
          <Pill label="PRIVATE BETA" tone="positive" />
          <Text accessibilityRole="header" style={styles.title}>
            Administrator Sign In
          </Text>
          <Text style={styles.body}>
            The fantasy app is currently available to administrators only. Creating an account does
            not grant beta access.
          </Text>
        </View>
        <Card style={styles.formCard}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            inputMode="email"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            autoComplete="current-password"
            secureTextEntry
          />
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <ActionButton
            label="Administrator sign-in"
            onPress={() => void submit()}
            loading={loading}
          />
          <Link href="/forgot-password" style={uiStyles.link}>
            Forgot password?
          </Link>
          <ActionButton
            label="Create an account"
            variant="secondary"
            onPress={() => void Linking.openURL('https://beta.brockfantasy.ca/signup')}
          />
          <Text style={styles.terms}>
            Read our{' '}
            <Link href="/terms" style={uiStyles.link}>
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" style={uiStyles.link}>
              Privacy notice
            </Link>
            .
          </Text>
        </Card>
      </View>
    </AppShell>
  );
}
function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={uiStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        placeholderTextColor={colors.muted}
        style={uiStyles.input}
        {...props}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  layout: { paddingTop: 38, gap: 36 },
  layoutWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 70,
  },
  copy: { flex: 1, maxWidth: 520 },
  title: { ...heading, fontSize: 42, lineHeight: 46, marginTop: 18 },
  body: { color: colors.muted, fontSize: 17, lineHeight: 27, marginTop: 18 },
  formCard: { flex: 0.8, width: '100%', maxWidth: 440, gap: 17, padding: 24 },
  field: { gap: 7 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  terms: { color: colors.muted, textAlign: 'center', fontSize: 10, lineHeight: 15 },
});

import { useResponsiveDimensions as useWindowDimensions } from '@/hooks/use-responsive-dimensions';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton, AppShell, Card, Pill, useUiStyles } from '@/components/ui';
import { PublicAuthEntry } from '@/components/public-auth-entry';
import { useSession } from '@/providers/session-provider';
import { heading } from '@/theme';
import { authReturnPath } from '@/lib/admin-navigation';

export default function AuthScreen() {
  const { mode, next } = useLocalSearchParams<{ mode?: string; next?: string }>();
  if (Platform.OS === 'web' || mode === 'sign-up')
    return <PublicAuthEntry mode={mode === 'sign-up' ? 'sign-up' : 'sign-in'} next={next} />;
  return <NativeSignInScreen />;
}

function NativeSignInScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { width } = useWindowDimensions();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [eligibilityAttested, setEligibilityAttested] = useState(false);
  const submit = async () => {
    setError(null);
    if (!email.includes('@') || password.length < 8) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const message = await signIn(email.trim(), password, eligibilityAttested);
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
          <Pill label="2026–27 SEASON" tone="positive" />
          <Text accessibilityRole="header" style={styles.title}>
            Sign In
          </Text>
          <Text style={styles.body}>
            Sign in with a verified, eligible account to join leagues and play.
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
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: eligibilityAttested }}
            onPress={() => setEligibilityAttested((value) => !value)}
          >
            <Text style={uiStyles.body}>
              {eligibilityAttested ? '☑' : '☐'} I am 18 or turn 18 this calendar year.
            </Text>
          </Pressable>
          <Text style={uiStyles.body}>
            Existing accounts only need this confirmation if eligibility has not been recorded yet.
          </Text>
          <ActionButton label="Sign in" onPress={() => void submit()} loading={loading} />
          <Link href="/forgot-password" style={uiStyles.link}>
            Forgot password?
          </Link>
          <ActionButton label="Create an account" variant="secondary" href="/signup" />
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
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const colors = useThemeColors();
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
const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    layout: { paddingTop: 38, gap: 36 },
    layoutWide: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 70,
    },
    copy: { flex: 1, maxWidth: 520 },
    title: { ...heading, fontSize: 42, lineHeight: 46, marginTop: 18, color: colors.text },
    body: { fontFamily: 'Inter', color: colors.muted, fontSize: 17, lineHeight: 27, marginTop: 18 },
    formCard: { flex: 0.8, width: '100%', maxWidth: 440, gap: 17, padding: 24 },
    field: { gap: 7 },
    error: { fontFamily: 'Inter', color: colors.danger, fontSize: 12, lineHeight: 18 },
    terms: {
      fontFamily: 'Inter',
      color: colors.muted,
      textAlign: 'center',
      fontSize: 10,
      lineHeight: 15,
    },
  });

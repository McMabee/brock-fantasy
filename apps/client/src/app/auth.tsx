import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, useUiStyles } from '@/components/ui';
import { useSession } from '@/providers/session-provider';
import { createHeading, useAppTheme, useThemedStyles, type ThemeColors } from '@/theme';

type AuthMode = 'sign_in' | 'sign_up';

export default function AuthScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { demoMode, signIn, signUp, requestPasswordReset } = useSession();
  const styles = useStyles();
  const [mode, setMode] = useState<AuthMode>('sign_in');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const wide = width >= 820;

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (
      !email.includes('@') ||
      password.length < 8 ||
      (mode === 'sign_up' && !displayName.trim())
    ) {
      setError('Enter a valid email, an 8+ character password, and your display name.');
      return;
    }
    if (demoMode) {
      router.replace('/dashboard');
      return;
    }

    setLoading(true);
    const message =
      mode === 'sign_in'
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password, displayName.trim());
    setLoading(false);
    if (message) setError(message);
    else if (mode === 'sign_up')
      setNotice('Check your email to verify your account, then sign in.');
    else router.replace('/dashboard');
  };

  const reset = async () => {
    if (!email.includes('@')) {
      setError('Enter your email first.');
      return;
    }
    const message = await requestPasswordReset(email.trim());
    if (message) setError(message);
    else setNotice('If that account exists, a recovery email is on its way.');
  };

  return (
    <AppShell>
      <View style={[styles.layout, wide && styles.layoutWide]}>
        <View style={styles.copy}>
          <Pill label="PRIVATE LEAGUES" tone="positive" />
          <Text accessibilityRole="header" style={styles.title}>
            Your season,{`\n`}your Badgers.
          </Text>
          <Text style={styles.body}>
            Create a league, invite your friends, and draft across six Brock varsity competitions.
            Every pick and point is committed by the server and recorded for replay.
          </Text>
          <View style={styles.benefits}>
            {[
              'Verified public accounts',
              'Invite-only league membership',
              'Auditable scoring and corrections',
            ].map((benefit) => (
              <View key={benefit} style={styles.benefit}>
                <Text style={styles.check}>✓</Text>
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </View>

        <Card style={styles.formCard}>
          <View style={styles.tabs}>
            <AuthTab
              active={mode === 'sign_in'}
              label="Sign in"
              onPress={() => setMode('sign_in')}
            />
            <AuthTab
              active={mode === 'sign_up'}
              label="Create account"
              onPress={() => setMode('sign_up')}
            />
          </View>
          {demoMode ? (
            <View style={styles.demoNotice}>
              <Text style={styles.demoNoticeText}>
                Demo mode: any valid-looking credentials open the local preview.
              </Text>
            </View>
          ) : null}
          {mode === 'sign_up' ? (
            <Field
              label="Display name"
              value={displayName}
              onChangeText={setDisplayName}
              autoComplete="name"
            />
          ) : null}
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
            autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
            secureTextEntry
          />
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Text accessibilityRole="alert" style={styles.notice}>
              {notice}
            </Text>
          ) : null}
          <ActionButton
            label={mode === 'sign_in' ? 'Sign in' : 'Create verified account'}
            onPress={() => void submit()}
            loading={loading}
          />
          {mode === 'sign_in' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void reset()}
              style={styles.forgotButton}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          ) : null}
          <Text style={styles.terms}>
            By continuing, you agree to the platform terms and privacy notice.
          </Text>
        </Card>
      </View>
    </AppShell>
  );
}

function AuthTab({
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
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    layout: { paddingTop: 38, gap: 36 },
    layoutWide: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 70,
    },
    copy: { flex: 1, maxWidth: 520 },
    title: { ...createHeading(colors), fontSize: 52, lineHeight: 55, marginTop: 18 },
    body: { color: colors.muted, fontSize: 17, lineHeight: 27, marginTop: 18 },
    benefits: { marginTop: 26, gap: 13 },
    benefit: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    check: { color: colors.brand, fontWeight: '900', fontSize: 16 },
    benefitText: { color: colors.text, fontSize: 14, fontWeight: '700' },
    formCard: { flex: 0.8, width: '100%', maxWidth: 440, gap: 17, padding: 24 },
    tabs: {
      flexDirection: 'row',
      backgroundColor: colors.canvasSoft,
      padding: 4,
      borderRadius: 12,
    },
    tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 9 },
    tabActive: { backgroundColor: colors.panelStrong },
    tabText: { color: colors.muted, fontSize: 13, fontWeight: '800' },
    tabTextActive: { color: colors.text },
    demoNotice: { backgroundColor: colors.warningSurface, padding: 10, borderRadius: 8 },
    demoNoticeText: { color: colors.text, fontSize: 11, lineHeight: 16 },
    field: { gap: 7 },
    error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
    notice: { color: colors.brand, fontSize: 12, lineHeight: 18 },
    forgotButton: { alignSelf: 'center', padding: 6 },
    forgotText: { color: colors.brand, fontWeight: '700', fontSize: 12 },
    terms: { color: colors.muted, textAlign: 'center', fontSize: 10, lineHeight: 15 },
  });

const useStyles = () => useThemedStyles(createStyles);

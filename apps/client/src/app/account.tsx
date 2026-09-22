import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, useUiStyles } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { createHeading, useAppTheme, useThemedStyles, type ThemeColors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

export default function AccountScreen() {
  useRequireUser();
  const router = useRouter();
  const { user, demoMode, signOut } = useSession();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const logout = async () => {
    await signOut();
    router.replace('/');
  };

  const deleteAccount = async () => {
    if (confirmation !== 'DELETE') return;
    if (!supabase) {
      setMessage('Demo account deletion request completed locally.');
      return;
    }
    const result = (await supabase.functions.invoke<unknown>('delete-account')) as {
      error: { message: string } | null;
    };
    setMessage(result.error ? result.error.message : 'Account deletion completed.');
    if (!result.error) await logout();
  };

  return (
    <AppShell eyebrow="Settings" title="Your account">
      <View style={styles.grid}>
        <Card style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.email?.[0] ?? 'D').toUpperCase()}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName}>
              {user?.user_metadata.display_name ?? 'Demo manager'}
            </Text>
            <Text style={styles.profileEmail}>{user?.email ?? 'demo@brockfantasy.local'}</Text>
          </View>
          <Pill label={demoMode ? 'DEMO' : 'VERIFIED'} tone={demoMode ? 'warning' : 'positive'} />
        </Card>
        <ActionButton label="Sign out" onPress={() => void logout()} variant="secondary" />
        <ActionButton label="Authenticator security" href="/mfa" variant="ghost" />
      </View>

      <SectionTitle title="Privacy and deletion" />
      <Card style={styles.deleteCard}>
        <View style={styles.deleteCopy}>
          <Text style={styles.deleteTitle}>Delete your account</Text>
          <Text style={uiStyles.body}>
            This removes your profile and personal memberships. Competition records that must remain
            auditable are anonymized according to the retention policy.
          </Text>
        </View>
        <View style={styles.deleteAction}>
          <Text style={uiStyles.label}>Type DELETE to confirm</Text>
          <TextInput
            accessibilityLabel="Type DELETE to confirm account deletion"
            autoCapitalize="characters"
            onChangeText={setConfirmation}
            placeholder="DELETE"
            placeholderTextColor={colors.muted}
            style={uiStyles.input}
            value={confirmation}
          />
          <ActionButton
            label="Delete account"
            onPress={() => void deleteAccount()}
            variant="danger"
            disabled={confirmation !== 'DELETE'}
          />
        </View>
      </Card>
      {message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
    </AppShell>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'center' },
    profileCard: { flex: 1, minWidth: 290, flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.onBrand, fontWeight: '900', fontSize: 20 },
    profileCopy: { flex: 1 },
    profileName: { ...createHeading(colors), fontSize: 18 },
    profileEmail: { color: colors.muted, fontSize: 12, marginTop: 4 },
    deleteCard: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignItems: 'center' },
    deleteCopy: { flex: 1, minWidth: 260, gap: 8 },
    deleteTitle: { color: colors.danger, fontSize: 17, fontWeight: '800' },
    deleteAction: { width: 280, maxWidth: '100%', gap: 8 },
    message: { color: colors.brand, marginTop: 14, fontWeight: '700' },
  });

const useStyles = () => useThemedStyles(createStyles);

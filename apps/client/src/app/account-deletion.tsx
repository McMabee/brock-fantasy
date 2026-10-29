import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, useUiStyles } from '@/components/ui';
import { supportEmail } from '@/lib/supabase';

export default function AccountDeletionScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  return (
    <AppShell eyebrow="Account lifecycle" title="Delete a Brock Fantasy account">
      <Card style={{ maxWidth: 720 }}>
        <Pill label="IN-APP DELETION" tone="info" />
        <SectionTitle title="How to delete your account" />
        <Text style={uiStyles.body}>
          Sign in, open Account, and use Delete account. Type DELETE to confirm. The request removes
          your authentication identity and personal profile. Historical competition events are
          retained when needed for league results and scoring audits. Removing an account reference
          does not necessarily make retained chat or competition content anonymous.
        </Text>
        <SectionTitle title="Need help signing in?" />
        <Text style={uiStyles.body}>
          Use password recovery from the sign-in screen. If you cannot access the account, contact
          {supportEmail
            ? ` ${supportEmail}`
            : ' the support address published with the application'}{' '}
          to request deletion after identity verification.
        </Text>
        <Text style={uiStyles.body}>
          Contact Brock Fantasy support. Volunteer response times vary. Verified manual deletion
          requests have a target of 30 calendar days and remain open until an administrator closes
          them.
        </Text>
        <View style={styles.actions}>
          <ActionButton
            label="Email account support"
            disabled={!supportEmail}
            onPress={() =>
              supportEmail
                ? void Linking.openURL(
                    `mailto:${supportEmail}?subject=${encodeURIComponent('Brock Fantasy account deletion')}`,
                  )
                : undefined
            }
            variant="secondary"
          />
          <ActionButton label="Open account settings" href="/account" />
        </View>
      </Card>
    </AppShell>
  );
}

const createStyles = (_colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    actions: { marginTop: 20, gap: 12 },
  });

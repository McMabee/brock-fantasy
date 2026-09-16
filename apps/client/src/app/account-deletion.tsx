import { Linking, Text } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, uiStyles } from '@/components/ui';
import { supportEmail } from '@/lib/supabase';

export default function AccountDeletionScreen() {
  return (
    <AppShell eyebrow="Account lifecycle" title="Delete a Brock Fantasy account">
      <Card style={{ maxWidth: 720 }}>
        <Pill label="IN-APP DELETION" tone="info" />
        <SectionTitle title="How to delete your account" />
        <Text style={uiStyles.body}>
          Sign in, open Account, and use Delete account. Type DELETE to confirm. The request removes
          your authentication identity and personal profile. Historical competition events are
          anonymized when they must remain to preserve league results and scoring audits.
        </Text>
        <SectionTitle title="Need help signing in?" />
        <Text style={uiStyles.body}>
          Use password recovery from the sign-in screen. If you cannot access the account, contact
          {supportEmail
            ? ` ${supportEmail}`
            : ' the support address published with the application'}{' '}
          to request deletion after identity verification.
        </Text>
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
      </Card>
    </AppShell>
  );
}

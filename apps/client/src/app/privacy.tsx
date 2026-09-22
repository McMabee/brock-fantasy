import { Text, View } from 'react-native';

import { AppShell, Card, SectionTitle, useUiStyles } from '@/components/ui';

export default function PrivacyScreen() {
  const uiStyles = useUiStyles();
  return (
    <AppShell eyebrow="Draft for approval" title="Privacy notice">
      <Card>
        <Text style={uiStyles.body}>
          Brock Fantasy uses your email identity, display name, league memberships, fantasy teams,
          notification settings, and security metadata to operate private fantasy leagues. It does
          not require a student number, date of birth, phone number, precise location, or payment
          information.
        </Text>
        <Section title="Sports and competition records">
          Draft picks, roster transactions, point events, and corrections are retained so league
          results remain auditable. If you delete your account, personal ownership is removed or
          anonymized where a non-personal competition record must remain.
        </Section>
        <Section title="Service providers">
          The approved production notice will identify hosting, authentication, error monitoring,
          notification, and sanctioned sports-data providers before public launch.
        </Section>
        <Section title="Your choices">
          You may update your profile, disable notification permissions, or initiate account
          deletion in the application. Contact details and final retention periods must be inserted
          after Brock privacy review.
        </Section>
      </Card>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  const uiStyles = useUiStyles();
  return (
    <View>
      <SectionTitle title={title} />
      <Text style={uiStyles.body}>{children}</Text>
    </View>
  );
}

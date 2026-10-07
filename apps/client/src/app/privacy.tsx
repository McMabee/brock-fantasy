import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { AppShell, Card, SectionTitle, uiStyles } from '@/components/ui';

export default function PrivacyScreen() {
  return (
    <AppShell eyebrow="Draft for approval" title="Privacy notice">
      <Card>
        <Text style={uiStyles.body}>
          Brock Fantasy uses your email identity, display name, league memberships, fantasy teams,
          notification settings, and security metadata to operate private fantasy leagues. It does
          not require a student number, date of birth, phone number, precise location, or payment
          information.
        </Text>
        <Link
          href="/policies/privacy-notice.html"
          target="_self"
          style={[uiStyles.body, uiStyles.link]}
        >
          Read the complete privacy policy draft
        </Link>
        <Section title="Eligibility">
          You may register if you are already 18 or turn 18 by December 31 of your registration
          year. We record your eligibility attestation, registration year and policy version without
          collecting a birth date. This rule does not change Ontario's age of majority.
        </Section>
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
          deletion. Email both Ty Mabee at tymabee@proton.me and Tarik Merchant at gt22me@brocku.ca
          for privacy, access, correction or deletion requests.
        </Section>
      </Card>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View>
      <SectionTitle title={title} />
      <Text style={uiStyles.body}>{children}</Text>
    </View>
  );
}

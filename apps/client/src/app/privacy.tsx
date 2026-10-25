import { Link } from 'expo-router';
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
        <Section title="Only the information needed">
          We collect information for accounts, private leagues, legal roster rules, requested
          communications, support, and security. We do not sell personal information or use
          advertising, analytics trackers, or visitor profiling. Optional settings and marketing
          choices are separate from account access.
        </Section>
        <Link
          href="/policies/data-minimization.html"
          style={[
            uiStyles.body,
            uiStyles.link,
            { display: 'flex', minHeight: 44, paddingVertical: 10 },
          ]}
        >
          Read the data minimization statement
        </Link>
        <Link
          href="/cookies"
          style={[
            uiStyles.body,
            uiStyles.link,
            { display: 'flex', minHeight: 44, paddingVertical: 10 },
          ]}
        >
          Cookies and your choices
        </Link>
        <Link
          href="/policies/privacy-notice.html"
          target="_self"
          style={[
            uiStyles.body,
            uiStyles.link,
            { display: 'flex', minHeight: 44, paddingVertical: 10 },
          ]}
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
          results remain auditable. Account deletion removes direct account records, but retained
          chat, team names, audit payloads, and sports records can still identify people. Those
          records require purpose-based review and are not automatically anonymous.
        </Section>
        <Section title="Service providers">
          Supabase supplies accounts and the database; Vercel hosts the sites; Resend handles
          configured email; approved sports-image hosts provide athlete images; and Google Drive
          stores encrypted backups. Security verification and operational logging can process
          technical information. Provider locations and retention require release verification.
        </Section>
        <Section title="Your choices">
          You may update your profile, disable notification permissions, or initiate account
          deletion. Email Ty Mabee at tymabee@proton.me for privacy, access, correction, athlete
          concerns, accessibility, or deletion requests. You do not need to contact two people;
          Tarik can be copied internally when needed.
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

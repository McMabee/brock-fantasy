import { Text, View } from 'react-native';

import { AppShell, Card, SectionTitle, uiStyles } from '@/components/ui';

export default function TermsScreen() {
  return (
    <AppShell eyebrow="Draft for approval" title="Platform terms">
      <Card>
        <Text style={uiStyles.body}>
          Brock Fantasy is a free fantasy sports experience. It does not support real-money betting,
          paid contests, gambling deposits, withdrawals, or cash prizes.
        </Text>
        <Term title="Fair play">
          Do not manipulate drafts, scoring inputs, sponsor metrics, accounts, or league access.
          Automated abuse and attempts to bypass authorization may result in suspension.
        </Term>
        <Term title="Community conduct">
          League chat is text-only. Harassment, threats, hate, spam, impersonation, and unlawful
          content are prohibited. Members can report or mute messages.
        </Term>
        <Term title="Scoring corrections">
          Official provider corrections and audited administrative adjustments may change previously
          displayed totals. The point ledger records those changes.
        </Term>
        <Term title="Final approval">
          The product owner must add governing contact information and obtain legal, brand, privacy,
          and acceptable-use approval before publication.
        </Term>
      </Card>
    </AppShell>
  );
}

function Term({ title, children }: { title: string; children: string }) {
  return (
    <View>
      <SectionTitle title={title} />
      <Text style={uiStyles.body}>{children}</Text>
    </View>
  );
}

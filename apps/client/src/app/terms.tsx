import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { AppShell, Card, SectionTitle, useUiStyles } from '@/components/ui';

export default function TermsScreen() {
  const uiStyles = useUiStyles();
  return (
    <AppShell eyebrow="Using Brock Fantasy" title="Platform terms">
      <Card>
        <Text style={uiStyles.body}>
          Brock Fantasy is a free fantasy sports experience. It does not support real-money betting,
          paid contests, gambling deposits, withdrawals, or cash prizes.
        </Text>
        {/* - Open policy documents in the same tab */}
        <Link
          href="/policies/terms-of-use.html"
          target="_self"
          style={[uiStyles.body, uiStyles.link]}
        >
          Read the complete terms and conditions
        </Link>
        <Term title="Eligibility and independence">
          You may register with a verified email if you are already 18 or turn 18 by December 31 of
          your registration year. The service is intended for the Brock University area, with no
          geographic restriction. Brock Fantasy has approved use of Brock Athletics information and
          operates independently of Brock Athletics, OUA and U SPORTS.
        </Term>
        <Term title="Fair play">
          Do not manipulate drafts, scoring inputs, accounts, or league access. Automated abuse and
          attempts to bypass authorization may result in suspension.
        </Term>
        <Term title="Community conduct">
          Harassment or abuse of athletes, coaches and other Brock team participants is prohibited,
          including discriminatory comments, unwelcome sexual attention, stalking and intimidation.
          Accounts may be restricted or terminated following review. Report concerns to both support
          contacts below. League chat is text-only; members can report or mute messages.
        </Term>
        <Link
          href="/policies/athlete-abuse-harassment-policy.html"
          target="_self"
          style={[uiStyles.body, uiStyles.link]}
        >
          Read the athlete abuse and harassment policy
        </Link>
        <Term title="Gambling prohibition">
          Users must not gamble on Brock sporting events, including related activity outside this
          platform. Substantiated violations result in permanent account termination. This policy
          explains the review process and available appeals.
        </Term>
        <Link
          href="/policies/gambling-policy.html"
          target="_self"
          style={[uiStyles.body, uiStyles.link]}
        >
          Read the gambling policy
        </Link>
        <Term title="Scoring corrections">
          Official provider corrections and audited administrative adjustments may change previously
          displayed totals. The point ledger records those changes.
        </Term>
        <Term title="Contact and governing law">
          Contact Brock Fantasy support at bfa.support64@gmail.com. Ontario and applicable Canadian
          law govern these terms, subject to mandatory rights and protections that apply where you
          live.
        </Term>
      </Card>
    </AppShell>
  );
}

function Term({ title, children }: { title: string; children: string }) {
  const uiStyles = useUiStyles();
  return (
    <View>
      <SectionTitle title={title} />
      <Text style={uiStyles.body}>{children}</Text>
    </View>
  );
}

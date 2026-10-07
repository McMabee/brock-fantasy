import { Link } from 'expo-router';
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
        {/* Policy documents are static files; let the browser open them in the same tab. */}
        <Link
          href="/policies/terms-of-use.html"
          target="_self"
          style={[uiStyles.body, uiStyles.link]}
        >
          Read the complete terms and conditions draft
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
          Read the athlete abuse and harassment policy draft
        </Link>
        <Term title="Gambling prohibition">
          Users must not gamble on Brock sporting events, including related activity outside this
          platform. Substantiated violations result in permanent account termination. This policy
          remains a draft awaiting approval.
        </Term>
        <Link
          href="/policies/gambling-policy.html"
          target="_self"
          style={[uiStyles.body, uiStyles.link]}
        >
          Read the gambling policy draft
        </Link>
        <Term title="Scoring corrections">
          Official provider corrections and audited administrative adjustments may change previously
          displayed totals. The point ledger records those changes.
        </Term>
        <Term title="Contact and governing law">
          Requests go to both Ty Mabee at tymabee@proton.me and Tarik Merchant at gt22me@brocku.ca.
          Ontario and applicable Canadian law govern these terms. The effective date remains pending
          the operator's final publication decision.
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

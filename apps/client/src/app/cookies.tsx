import { Link } from 'expo-router';
import { Platform, Text, View } from 'react-native';

import { ActionButton, AppShell, Card, SectionTitle, useUiStyles } from '@/components/ui';

const cookies = [
  {
    name: '__Host-bf-access',
    purpose: 'Keeps you signed in to the fantasy app through Supabase.',
    lifetime: 'Up to one hour. Renewing your session can issue a new cookie.',
  },
  {
    name: '__Host-bf-refresh',
    purpose: 'Renews your signed-in session.',
    lifetime: '30 days.',
  },
  {
    name: 'bf_csrf',
    purpose: 'Protects requests that change account or league information.',
    lifetime: 'Up to one day. Staff activation can use a 15-minute lifetime.',
  },
  {
    name: 'bf_pkce and bf_auth_flow',
    purpose: 'Supports account confirmation and recovery.',
    lifetime: '15 minutes. Cleared after use.',
  },
  {
    name: 'bf_auth_next',
    purpose: 'Returns you to a requested league invitation after sign-in.',
    lifetime: '7 days.',
  },
  {
    name: '__Host-bf-staff-access',
    purpose: 'Supports verification of a staff invitation.',
    lifetime: '15 minutes.',
  },
  {
    name: '__Host-bf-signup-receipt',
    purpose: 'Provides a short-lived registration receipt on the association site.',
    lifetime: '15 minutes.',
  },
  {
    name: 'bf_consent',
    purpose:
      'Records whether you allowed optional preferences. It contains no tracking identifier.',
    lifetime: '180 days on each site.',
  },
  {
    name: 'bf_theme',
    purpose: 'Remembers your appearance preference in the fantasy app when you allow preferences.',
    lifetime: '180 days. Removed when you withdraw permission.',
  },
] as const;

export default function CookiesScreen() {
  const ui = useUiStyles();
  return (
    <AppShell eyebrow="Policies" title="Cookie policy">
      <Card>
        <Text style={ui.body}>
          Brock Fantasy uses necessary cookies for sign-in, account recovery, security, and
          remembering your cookie choices. With your permission, we also save appearance settings
          such as your theme. We do not use advertising or analytics trackers, sell personal
          information, or profile visitors.
        </Text>
        <Section title="Your choices">
          Choose Necessary only to use the sites without optional appearance storage, or Allow
          preferences to remember settings such as your theme. Both choices are available in the
          cookie notice. You can change your choice at any time through Cookie settings in the
          footer. Withdrawing permission removes the optional theme cookie. You can still switch
          themes on the current page without saving that preference.
        </Section>
        {Platform.OS === 'web' ? (
          <View style={{ alignItems: 'flex-start', marginTop: 16 }}>
            <ActionButton
              label="Manage cookie preferences"
              variant="secondary"
              onPress={() => window.dispatchEvent(new Event('bf:privacy-open'))}
            />
          </View>
        ) : null}
        <SectionTitle title="Cookies used by the sites" />
        <Text style={ui.body}>
          Cookies are used when you request their related feature. All cookies listed below are
          necessary for that feature except bf_theme, which is optional.
        </Text>
        <View style={{ gap: 18, marginTop: 16 }}>
          {cookies.map((cookie) => (
            <View key={cookie.name} style={{ gap: 4 }}>
              <Text style={ui.label}>{cookie.name}</Text>
              <Text style={ui.body}>{cookie.purpose}</Text>
              <Text style={ui.body}>Maximum lifetime: {cookie.lifetime}</Text>
            </View>
          ))}
        </View>
        <Section title="Choices on each site">
          Cookies apply only to the hostname that sets them. The fantasy app and association site
          save cookie choices separately. These choices are not used to identify or track you
          between the sites.
        </Section>
        <Section title="Other browser storage">
          The web app does not store authentication tokens in localStorage or sessionStorage.
          Unsaved lineup edits can use tab storage so they survive a reload. If you enable draft
          sounds, tab storage helps avoid repeating a sound for the same pick. These records last
          until the tab closes or you clear that storage. This browser policy does not change
          native-app storage or device controls.
        </Section>
        <Section title="External services">
          Hosting, sign-in, email, security, and approved athlete-image services may process
          technical information such as IP addresses. Cookie settings do not disable essential
          sign-in or security functions. The privacy notice explains how personal information is
          handled.
        </Section>
        <Link
          href="/privacy"
          style={[ui.body, ui.link, { display: 'flex', minHeight: 44, paddingVertical: 10 }]}
        >
          Read the privacy notice
        </Link>
        <Section title="Clearing cookies">
          Clearing necessary cookies can sign you out or interrupt account recovery. If you clear
          the cookie that records your choice, the cookie notice will ask you to choose again.
        </Section>
        <SectionTitle title="Contact" />
        <Text style={ui.body}>
          For questions about cookies or your privacy choices, contact Ty Mabee at{' '}
          <Link href="mailto:tymabee@proton.me" style={ui.link}>
            tymabee@proton.me
          </Link>
          .
        </Text>
      </Card>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  const ui = useUiStyles();
  return (
    <View>
      <SectionTitle title={title} />
      <Text style={ui.body}>{children}</Text>
    </View>
  );
}

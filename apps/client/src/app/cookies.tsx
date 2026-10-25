import { Link } from 'expo-router';
import { Text } from 'react-native';
import { AppShell, Card, useUiStyles } from '@/components/ui';
import { CookieSettings } from '@/components/cookie-notice';

export default function CookiesScreen() {
  const ui = useUiStyles();
  return (
    <AppShell title="Cookies and your choices">
      <Card>
        <Text style={ui.body}>
          Necessary cookies support sign-in, recovery, security, and your cookie choice. Optional
          cookies remember settings such as theme only when you allow preferences. Theme switching
          still works without saving it.
        </Text>
        <Text style={ui.body}>
          We do not use advertising or analytics trackers, sell personal information, or profile
          visitors. Your host-only choice contains no tracking identifier and lasts 180 days. You
          can change it at any time.
        </Text>
        <CookieSettings />
        <Link
          href="/policies/cookie-policy.html"
          style={[ui.body, ui.link, { display: 'flex', minHeight: 44, paddingVertical: 10 }]}
        >
          Read cookie purposes, providers, and expiry periods
        </Link>
      </Card>
    </AppShell>
  );
}

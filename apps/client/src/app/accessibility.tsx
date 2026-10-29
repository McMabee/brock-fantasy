import { Link } from 'expo-router';
import { Text } from 'react-native';
import { AppShell, Card, SectionTitle, useUiStyles } from '@/components/ui';

export default function AccessibilityScreen() {
  const ui = useUiStyles();
  return (
    <AppShell title="Accessibility" eyebrow="Access and support">
      <Card>
        <Text style={ui.body}>
          We are working toward WCAG 2.2 Level AA across Brock Fantasy and the association website.
          This is an improvement target, not a claim of certified or complete conformance.
        </Text>
        <SectionTitle title="Using the sites" />
        <Text style={ui.body}>
          Use Tab and Shift+Tab to move between controls, Enter or Space to activate buttons, and
          Escape to close dialogs. The skip link moves to the main content. Draft rankings have move
          controls and do not require dragging. Theme controls and browser zoom remain available.
        </Text>
        <SectionTitle title="Ask for help or another format" />
        <Text style={ui.body}>
          Contact Brock Fantasy support at bfa.support64@gmail.com. Describe the page, the barrier,
          and the format or assistance you need. Sharing your diagnosis is not required.
        </Text>
        <Text style={ui.body}>
          Automated checks cover representative workflows and cannot establish complete
          accessibility. Some dynamic states and third-party verification steps may still present
          barriers. Contact support if you need an accessible alternative.
        </Text>
        <Link
          href="/policies/accessibility-statement.html"
          style={[ui.body, ui.link, { display: 'flex', minHeight: 44, paddingVertical: 10 }]}
        >
          Read the complete accessibility statement
        </Link>
      </Card>
    </AppShell>
  );
}

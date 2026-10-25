import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { ActionButton, AppShell, Card, useUiStyles } from '@/components/ui';
import { betaCommand } from '@/lib/web-api';
import { useSession } from '@/providers/session-provider';

export default function EmailPreferencesScreen() {
  const ui = useUiStyles();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { user } = useSession();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let active = true;
    setEnabled(null);
    if (!token && user)
      void betaCommand<{ draft_updates: boolean }>('get_service_email_preferences', {}).then(
        (result) => {
          if (active) {
            setEnabled(result.data?.draft_updates ?? null);
            setMessage(result.error);
          }
        },
      );
    return () => {
      active = false;
    };
  }, [token, user?.id]);
  const save = async (value: boolean) => {
    if (working) return;
    setWorking(true);
    try {
      if (token) {
        const response = await fetch('/api/service-email/preferences', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({ token }),
          signal: AbortSignal.timeout(10_000),
        });
        const result = (await response.json()) as { error?: string };
        setMessage(
          response.ok
            ? 'Draft emails are off. In-app league notices continue. Your marketing preferences are unchanged.'
            : (result.error ?? 'Could not save the preference. Please retry.'),
        );
        if (response.ok) setEnabled(false);
      } else {
        const result = await betaCommand('set_service_email_preferences', {
          p_draft_updates: value,
        });
        setMessage(
          result.error ??
            (value ? 'Draft emails are on.' : 'Draft emails are off. In-app notices continue.'),
        );
        if (!result.error) setEnabled(value);
      }
    } catch {
      setMessage('Confirmation was interrupted. Please retry.');
    } finally {
      setWorking(false);
    }
  };
  return (
    <AppShell title="Draft email preferences" eyebrow="Your choice">
      <Card>
        <Text style={ui.body}>
          Draft emails contain factual league schedule changes, reminders, blockers, and completion
          notices. They are separate from optional launch/news subscriptions. Turning them off does
          not affect your account, league access, or in-app notices.
        </Text>
        {token ? (
          <>
            <Text style={ui.body}>
              Select the button to turn draft emails off. Opening this page does not change your
              preference.
            </Text>
            <ActionButton
              label="Turn off draft emails"
              onPress={() => void save(false)}
              disabled={working || enabled === false}
              loading={working}
              variant="secondary"
            />
          </>
        ) : user ? (
          <>
            <Text style={ui.body}>
              Draft emails: {enabled === null ? 'Loading preference…' : enabled ? 'On' : 'Off'}
            </Text>
            <ActionButton
              label={enabled ? 'Turn off draft emails' : 'Turn on draft emails'}
              onPress={() => void save(!enabled)}
              disabled={working || enabled === null}
              loading={working}
              variant="secondary"
            />
          </>
        ) : (
          <ActionButton
            label="Sign in to manage draft email preferences"
            href="/auth"
            variant="secondary"
          />
        )}
        {message ? (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
        ) : null}
      </Card>
    </AppShell>
  );
}

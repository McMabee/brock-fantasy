import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';
import { ActionButton, AppShell, Card, useUiStyles } from '@/components/ui';

const feedbackOrigin = process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'https://play.brockfantasy.ca';

export default function FeedbackScreen() {
  const ui = useUiStyles();
  const { submitted, kind: requestedKind } = useLocalSearchParams<{
    submitted?: string;
    kind?: string;
  }>();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  // - Match the static export before showing URL-dependent confirmation content
  useEffect(() => setHydrated(true), []);
  const kind =
    (Platform.OS !== 'web' || hydrated) && requestedKind === 'suggestion' ? 'Suggestion' : 'Bug';
  const title = kind === 'Bug' ? 'Report a bug' : 'Leave a suggestion';
  if (Platform.OS !== 'web')
    return (
      <AppShell title={title}>
        <Card>
          <Text style={ui.body}>Send a bug report or share an idea for Brock Fantasy.</Text>
          <ActionButton
            label="Open feedback form"
            onPress={() =>
              void Linking.openURL(`${feedbackOrigin}/feedback?kind=${kind.toLowerCase()}`)
            }
          />
        </Card>
      </AppShell>
    );
  return (
    <AppShell title={title} eyebrow="HELP IMPROVE BROCK FANTASY">
      {hydrated && submitted === '1' ? (
        <Card>
          <Text accessibilityRole="header" style={ui.title}>
            Thanks for your feedback
          </Text>
          <Text style={ui.body}>Your submission has been sent for review.</Text>
          <ActionButton label="Back to Brock Fantasy" href="/" />
        </Card>
      ) : (
        <form
          className="feedback-form"
          action="https://formsubmit.co/c561de24beb750974ce891e2eb88ed52"
          method="POST"
        >
          <p>Found a problem or have an idea? Tell us what happened and how we can improve.</p>
          <input type="hidden" name="_subject" value={`Brock Fantasy ${kind} Report`} />
          <input type="hidden" name="_template" value="table" />
          <input type="hidden" name="_next" value={`${feedbackOrigin}/feedback?submitted=1`} />
          <label className="feedback-honeypot" aria-hidden="true">
            Leave this field empty
            <input name="_honey" tabIndex={-1} autoComplete="off" />
          </label>
          <fieldset className="feedback-kind">
            <legend>What would you like to send?</legend>
            {(['Bug', 'Suggestion'] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="Report type"
                  value={value}
                  checked={kind === value}
                  onChange={() => router.setParams({ kind: value.toLowerCase() })}
                  required
                />
                {value}
              </label>
            ))}
          </fieldset>
          <label className="feedback-field">
            Title <span>Required</span>
            <input
              name="Title"
              required
              minLength={5}
              maxLength={150}
              placeholder="A short summary"
            />
          </label>
          <label className="feedback-field">
            {kind === 'Bug' ? 'What went wrong?' : 'What would you like us to improve?'}{' '}
            <span>Required</span>
            <textarea name="Description" required minLength={10} maxLength={5000} rows={5} />
          </label>
          <label className="feedback-field">
            Page address <span>Optional</span>
            <input
              name="Page address"
              type="url"
              maxLength={1000}
              placeholder="https://play.brockfantasy.ca/…"
            />
          </label>
          {kind === 'Bug' ? (
            <>
              <label className="feedback-field">
                Steps to reproduce <span>Optional</span>
                <textarea
                  name="Steps to reproduce"
                  maxLength={3000}
                  rows={4}
                  placeholder="1. Open… 2. Select… 3. The issue appears…"
                />
              </label>
              <label className="feedback-field">
                Expected result <span>Optional</span>
                <textarea name="Expected result" maxLength={2000} rows={3} />
              </label>
              <label className="feedback-field">
                Actual result <span>Optional</span>
                <textarea name="Actual result" maxLength={2000} rows={3} />
              </label>
            </>
          ) : null}
          <label className="feedback-field">
            Your email <span>Optional, so we can reply</span>
            <input type="email" name="email" autoComplete="email" maxLength={320} />
          </label>
          <p className="feedback-note">
            Reports are sent through FormSubmit to the Brock Fantasy team. Please leave out
            passwords, recovery codes and other private account details.
          </p>
          <button className="feedback-submit" type="submit">
            Send {kind.toLowerCase()}
          </button>
        </form>
      )}
    </AppShell>
  );
}

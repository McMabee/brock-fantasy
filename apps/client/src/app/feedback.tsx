import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Platform, Text } from 'react-native';
import { ActionButton, AppShell, Card, useUiStyles } from '@/components/ui';
import { useContactSubmission } from '@/hooks/use-contact-submission';

export default function FeedbackScreen() {
  const ui = useUiStyles();
  const { kind: requestedKind } = useLocalSearchParams<{ kind?: string }>();
  const router = useRouter();
  const contact = useContactSubmission();
  const kind = requestedKind === 'suggestion' ? 'Suggestion' : 'Bug';
  const title = kind === 'Bug' ? 'Report a bug' : 'Leave a suggestion';
  if (Platform.OS !== 'web')
    return (
      <AppShell title={title}>
        <Card>
          <Text style={ui.body}>Send a bug report or share an idea for Brock Fantasy.</Text>
          <ActionButton
            label="Open feedback form"
            onPress={() =>
              void Linking.openURL(
                (process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'https://play.brockfantasy.ca') +
                  '/feedback?kind=' +
                  kind.toLowerCase(),
              )
            }
          />
        </Card>
      </AppShell>
    );
  const accepted = contact.status === 'accepted' || contact.status === 'delivered';
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const value = (name: string) => {
      const field = fields.get(name);
      return typeof field === 'string' ? field : '';
    };
    const sections = [
      ['Description', value('description')],
      ['Steps to reproduce', value('steps')],
      ['Expected result', value('expected')],
      ['Actual result', value('actual')],
    ];
    const message = sections
      .filter(([, content]) => content?.trim())
      .map(([label, content]) => label + ':\n' + content)
      .join('\n\n');
    await contact.submit({
      kind: kind.toLowerCase(),
      name: '',
      replyEmail: value('email'),
      title: value('title'),
      message,
      page: value('page'),
    });
  };
  return (
    <AppShell title={title} eyebrow="Help improve Brock Fantasy">
      {accepted ? (
        <Card>
          <Text accessibilityRole="header" style={ui.title}>
            Request {contact.status === 'delivered' ? 'delivered' : 'accepted'}
          </Text>
          <Text style={ui.body}>{contact.message}</Text>
          <Text style={ui.body}>Reference: {contact.requestId}</Text>
          <ActionButton label="Back to Brock Fantasy" href="/" />
        </Card>
      ) : (
        <form
          className="feedback-form"
          method="POST"
          action="/api/contact"
          onSubmit={(event) => void submit(event)}
        >
          <p>
            Tell us what happened or share an idea. Contact requests do not subscribe you to
            marketing.
          </p>
          <fieldset className="feedback-kind">
            <legend>What would you like to send?</legend>
            {(['Bug', 'Suggestion'] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => router.setParams({ kind: value.toLowerCase() })}
                />
                {value}
              </label>
            ))}
          </fieldset>
          <label className="feedback-field">
            Title <span>Required</span>
            <input name="title" required minLength={5} maxLength={150} />
          </label>
          <label className="feedback-field">
            {kind === 'Bug' ? 'What went wrong?' : 'What would you like us to improve?'}{' '}
            <span>Required</span>
            <textarea name="description" required minLength={10} maxLength={4500} rows={5} />
          </label>
          {kind === 'Bug' ? (
            <>
              <label className="feedback-field">
                Steps to reproduce <span>Optional</span>
                <textarea name="steps" maxLength={2000} rows={3} />
              </label>
              <label className="feedback-field">
                Expected result <span>Optional</span>
                <textarea name="expected" maxLength={1000} rows={3} />
              </label>
              <label className="feedback-field">
                Actual result <span>Optional</span>
                <textarea name="actual" maxLength={1000} rows={3} />
              </label>
            </>
          ) : null}
          <label className="feedback-field">
            Page address <span>Optional; query parameters are removed</span>
            <input
              name="page"
              type="url"
              maxLength={2000}
              placeholder="https://play.brockfantasy.ca/…"
            />
          </label>
          <label className="feedback-field">
            Your email <span>Optional, so we can reply</span>
            <input name="email" type="email" autoComplete="email" maxLength={320} />
          </label>
          <p className="feedback-note">
            Keep the combined report under 5,000 characters and 8 KB. Leave out passwords, recovery
            codes, and private account details. Requests use our existing email provider; no
            advertising or analytics tracking is added.{' '}
            <a href="/privacy">How we handle your information</a>
          </p>
          <button
            className="feedback-submit"
            type="submit"
            disabled={contact.pending || contact.status === 'queued'}
          >
            {contact.pending
              ? 'Submitting…'
              : contact.status === 'queued'
                ? 'Request queued'
                : 'Send ' + kind.toLowerCase()}
          </button>
        </form>
      )}
      {!accepted && contact.message ? (
        <Card>
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {contact.message}
          </Text>
          {contact.requestId ? <Text style={ui.body}>Reference: {contact.requestId}</Text> : null}
        </Card>
      ) : null}
    </AppShell>
  );
}

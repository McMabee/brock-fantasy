import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { VARSITY_PROGRAMS } from '@brock-fantasy/domain';
import { useAdminLeagueRead } from '@/hooks/use-admin-leagues';
import { betaCommand } from '@/lib/web-api';
import { newCommandKey } from '@/lib/command-key';
import type { ParticipantMatch } from '@/lib/participant-scans';
import type { ParticipantRequestPage } from '@/lib/participant-requests';
import { participantRoles } from './participant-directory';
import { ActionButton, Card, EmptyState, LoadingState, Pill, useUiStyles } from './ui';
import { AdminPanel, AdminSelect, adminMultiline } from './admin-ui';
import { LeagueRefresh } from './admin-league-ui';
import { adminDate } from '@/lib/admin-leagues';
import { operationLabel } from '@/lib/admin-operations';

export function RequestConfirmationButton({
  match,
  enabled,
  onRefresh,
}: {
  match: ParticipantMatch;
  enabled: boolean;
  onRefresh: () => Promise<void>;
}) {
  const ui = useUiStyles();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useRef<string | null>(null);
  const current = match.confirmation_request;
  const recent = current && Date.parse(current.created_at) > Date.now() - 86400000;
  const blocked =
    !enabled ||
    match.resolved ||
    match.dismissed ||
    match.evidence_changed ||
    Boolean(recent) ||
    current?.status === 'responded';
  const send = async () => {
    if (busy || blocked) return;
    setBusy(true);
    key.current ??= newCommandKey();
    try {
      const result = await betaCommand('admin_request_participant_confirmation', {
        p_match_id: match.id,
        p_idempotency_key: key.current,
      });
      setMessage(
        result.error ??
          'Confirmation email queued. Delivery status will update after the email service processes it.',
      );
      if (!result.error) {
        key.current = null;
        await onRefresh();
      } else if (result.status && result.status < 500) {
        key.current = null;
        if (result.status === 409 || result.status === 429) await onRefresh();
      }
    } catch {
      setMessage('Send outcome unavailable. Retry to retrieve the same request safely.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      {current ? (
        <Text style={ui.body}>
          Confirmation: {operationLabel(current.status)} · Email:{' '}
          {operationLabel(current.delivery_status ?? 'not queued')}
        </Text>
      ) : null}
      {!enabled ? (
        <Text style={ui.body}>Confirmation email is awaiting release checks.</Text>
      ) : null}
      <ActionButton
        label="Request confirmation"
        variant="secondary"
        disabled={blocked}
        onPress={() => {
          setOpen(true);
          setMessage('');
        }}
      />
      <AdminPanel
        title="Request varsity confirmation"
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <Text style={ui.title}>{match.display_name}</Text>
        <Text style={ui.body}>Send to {match.email}</Text>
        <Text style={ui.body}>
          Suggested: {participantRoles[match.evidence.reference.role]} ·{' '}
          {match.evidence.reference.programs.map((program) => VARSITY_PROGRAMS[program]).join(', ')}
        </Text>
        <Text style={ui.body}>
          The recipient signs in to confirm or correct this information. An administrator reviews
          their reply before participation changes. The request expires in seven days.
        </Text>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
        ) : null}
        <ActionButton
          label="Send confirmation request"
          onPress={() => void send()}
          loading={busy}
          disabled={blocked}
        />
      </AdminPanel>
    </View>
  );
}

export function ParticipantRequests({ enabled }: { enabled: boolean }) {
  const ui = useUiStyles();
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [cursor, setCursor] = useState<{ at: string; id: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef<{ intent: string; key: string } | null>(null);
  const read = useAdminLeagueRead<ParticipantRequestPage>(
    'admin_list_participant_requests',
    {
      p_status: status,
      p_query: query,
      p_before_at: cursor?.at ?? null,
      p_before_id: cursor?.id ?? null,
    },
    enabled,
    15000,
  );
  const selected = read.data?.items.find((item) => item.id === selectedId) ?? null;
  const review = async (approve: boolean) => {
    if (!selected || busy || reason.trim().length < 8 || selected.status !== 'responded') return;
    const intent = JSON.stringify([selected.id, selected.updated_at, approve, reason.trim()]);
    if (key.current?.intent !== intent) key.current = { intent, key: newCommandKey() };
    setBusy(true);
    try {
      const result = await betaCommand('admin_review_participant_confirmation', {
        p_request_id: selected.id,
        p_approve: approve,
        p_reason: reason.trim(),
        p_expected_updated_at: selected.updated_at,
        p_idempotency_key: key.current.key,
      });
      setMessage(
        result.error ??
          (approve
            ? 'Response approved and participation saved.'
            : 'Response rejected. Participation is unchanged.'),
      );
      if (!result.error || (result.status && result.status < 500)) key.current = null;
      await read.refresh();
      if (result.status === 409) {
        setSelectedId(null);
        setReason('');
      }
    } catch {
      setMessage('Review outcome unavailable. Retry to retrieve the same result safely.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={ui.title}>
          Confirmation requests
        </Text>
        <AdminSelect
          label="Request status"
          value={status}
          options={[
            '',
            'pending',
            'responded',
            'approved',
            'rejected',
            'expired',
            'obsolete',
            'superseded',
          ].map((value) => ({ value, label: value ? operationLabel(value) : 'All requests' }))}
          onChange={(value) => {
            setStatus(value);
            setCursor(null);
            setSelectedId(null);
          }}
        />
        <TextInput
          accessibilityLabel="Find confirmation requests"
          placeholder="Participant name or email"
          maxLength={320}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => {
            setQuery(draft.trim());
            setCursor(null);
          }}
          style={ui.input}
        />
        <ActionButton
          label="Search requests"
          onPress={() => {
            setQuery(draft.trim());
            setCursor(null);
          }}
          variant="secondary"
        />
      </Card>
      <LeagueRefresh {...read} refresh={read.refresh} />
      {read.loading && !read.data ? <LoadingState label="Loading confirmation requests" /> : null}
      {message ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {message}
        </Text>
      ) : null}
      {read.data?.items.length === 0 ? (
        <EmptyState
          title="No confirmation requests"
          body="Requests sent from participant scan results appear here."
        />
      ) : null}
      {read.data?.items.map((item) => (
        <Card key={item.id} style={{ gap: 10 }}>
          <Text style={ui.title}>{item.display_name}</Text>
          <Text style={ui.body}>{item.email}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pill label={`Request: ${operationLabel(item.status)}`} />
            <Pill label={`Email: ${operationLabel(item.delivery_status ?? 'unavailable')}`} />
          </View>
          <Text style={ui.body}>
            Requested {adminDate(item.created_at)} by {item.requested_by}
          </Text>
          <ActionButton
            label={`Review request for ${item.display_name}`}
            variant="secondary"
            onPress={() => {
              setSelectedId(item.id);
              setReason('');
              setMessage('');
            }}
          />
        </Card>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {cursor ? (
          <ActionButton
            label="First request page"
            variant="secondary"
            onPress={() => {
              setCursor(null);
              setSelectedId(null);
            }}
          />
        ) : null}
        {read.data?.hasMore && read.data.nextCursor ? (
          <ActionButton
            label="Next requests"
            variant="secondary"
            onPress={() => {
              setCursor(read.data!.nextCursor);
              setSelectedId(null);
            }}
          />
        ) : null}
      </View>
      <AdminPanel
        title="Participant confirmation review"
        open={Boolean(selected)}
        onClose={() => {
          if (!busy) setSelectedId(null);
        }}
      >
        {selected ? (
          <>
            <Text style={ui.title}>{selected.display_name}</Text>
            <Text style={ui.body}>{selected.email}</Text>
            <Text style={ui.body}>
              Request: {operationLabel(selected.status)}
              {'\n'}Email: {operationLabel(selected.delivery_status ?? 'unavailable')}
              {'\n'}Expires: {adminDate(selected.expires_at)}
            </Text>
            <Text style={ui.body}>
              Suggested: {participantRoles[selected.suggested_role]} ·{' '}
              {selected.suggested_programs.map((program) => VARSITY_PROGRAMS[program]).join(', ') ||
                '—'}
            </Text>
            {selected.response_role ? (
              <>
                <Text style={ui.title}>Participant’s reply</Text>
                <Text style={ui.body}>
                  {participantRoles[selected.response_role]} ·{' '}
                  {selected.response_programs
                    ?.map((program) => VARSITY_PROGRAMS[program])
                    .join(', ') || '—'}
                </Text>
                <Text style={ui.body}>{selected.explanation || 'No explanation supplied'}</Text>
                <Text style={ui.body}>Submitted {adminDate(selected.responded_at)}</Text>
              </>
            ) : null}
            {selected.review_reason ? (
              <Text style={ui.body}>
                Reviewed by {selected.reviewed_by}: {selected.review_reason}
              </Text>
            ) : null}
            {selected.delivery_failure ? (
              <Text style={ui.body}>
                Email delivery: {operationLabel(selected.delivery_failure)}
              </Text>
            ) : null}
            {selected.status === 'responded' ? (
              <>
                <Text style={ui.label}>Review reason</Text>
                <TextInput
                  accessibilityLabel="Confirmation review reason"
                  multiline
                  value={reason}
                  maxLength={500}
                  editable={!busy}
                  onChangeText={setReason}
                  style={[ui.input, adminMultiline]}
                />
                <ActionButton
                  label="Approve submitted answer"
                  disabled={reason.trim().length < 8}
                  loading={busy}
                  onPress={() => void review(true)}
                />
                <ActionButton
                  label="Reject submitted answer"
                  variant="danger"
                  disabled={reason.trim().length < 8 || busy}
                  onPress={() => void review(false)}
                />
              </>
            ) : null}
            {message ? (
              <Text accessibilityLiveRegion="polite" style={ui.body}>
                {message}
              </Text>
            ) : null}
          </>
        ) : null}
      </AdminPanel>
    </View>
  );
}

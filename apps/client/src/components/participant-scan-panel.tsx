import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { VARSITY_PROGRAMS } from '@brock-fantasy/domain';
import { ActionButton, Card, useUiStyles } from './ui';
import { participantRoles } from './participant-directory';
import {
  groupParticipantMatches,
  participantScanTime,
  type ParticipantMatch,
  type ParticipantScanSnapshot,
} from '@/lib/participant-scans';
import { useThemeColors } from '@/providers/theme-provider';
import { betaCommand } from '@/lib/web-api';
import { newCommandKey } from '@/lib/command-key';

export function ParticipantScanPanel({
  snapshot,
  scanId,
  onRunChange,
  onRefresh,
  onSelect,
}: {
  snapshot: ParticipantScanSnapshot | null;
  scanId: string | null;
  onRunChange: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onSelect: (id: string, match: ParticipantMatch) => void;
}) {
  const ui = useUiStyles();
  const colors = useThemeColors();
  const [minimum, setMinimum] = useState('70');
  const [resolved, setResolved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<ParticipantMatch | null>(null);
  const [reason, setReason] = useState('');
  const runKey = useRef<string | null>(null);
  const reviewKey = useRef<{ intent: string; key: string } | null>(null);
  const threshold = Number(minimum);
  const validThreshold =
    minimum.trim() !== '' && Number.isInteger(threshold) && threshold >= 35 && threshold <= 100;
  const groups = useMemo(
    () =>
      groupParticipantMatches(
        snapshot?.matches ?? [],
        validThreshold ? threshold : 70,
        resolved,
        dismissed,
      ),
    [snapshot, validThreshold, threshold, resolved, dismissed],
  );
  const stale = Boolean(
    snapshot?.run && snapshot.run.reference_version_id !== snapshot.activeReferenceVersionId,
  );
  const run = async () => {
    if (working) return;
    setWorking(true);
    setMessage(null);
    runKey.current ??= newCommandKey();
    try {
      const result = await betaCommand<{ scanId: string }>('admin_run_participant_scan', {
        p_idempotency_key: runKey.current,
      });
      if (result.error || !result.data) {
        setMessage(
          result.error ?? 'Scan confirmation unavailable. Retry to retrieve the same result.',
        );
        if (result.status && result.status < 500) runKey.current = null;
        return;
      }
      runKey.current = null;
      onRunChange(null);
      if (scanId === null) await onRefresh();
      setMessage('Scan completed. Results are shared with all administrators.');
    } catch {
      setMessage('Scan confirmation unavailable. Retry to retrieve the same result.');
    } finally {
      setWorking(false);
    }
  };
  const saveReview = async () => {
    if (!review || working || reason.trim().length < 8) return;
    const intent = JSON.stringify([review.id, review.review_id, !review.dismissed, reason.trim()]);
    if (reviewKey.current?.intent !== intent) reviewKey.current = { intent, key: newCommandKey() };
    setWorking(true);
    setMessage(null);
    try {
      const result = await betaCommand('admin_review_participant_match', {
        p_match_id: review.id,
        p_dismissed: !review.dismissed,
        p_reason: reason.trim(),
        p_expected_review_id: review.review_id,
        p_idempotency_key: reviewKey.current.key,
      });
      if (result.error) {
        setMessage(result.error);
        if (result.status === 409) {
          setReview(null);
          reviewKey.current = null;
        }
      } else {
        setReview(null);
        setReason('');
        reviewKey.current = null;
        setMessage('Shared review saved.');
      }
      await onRefresh();
    } catch {
      setMessage('Review confirmation unavailable. Retry to retrieve the same result.');
    } finally {
      setWorking(false);
    }
  };
  const checkbox = (label: string, checked: boolean, toggle: () => void) => (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      onPress={toggle}
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      <Text style={ui.body}>
        {checked ? '☑' : '☐'} {label}
      </Text>
    </Pressable>
  );
  return (
    <Card style={{ gap: 14 }}>
      <Text accessibilityRole="header" style={ui.title}>
        Participant scan
      </Text>
      <Text style={ui.body}>
        Match scores describe similarity, not a verified probability of identity. Review each
        suggestion before saving participation.
      </Text>
      {!snapshot ? <Text style={ui.body}>Loading saved scans…</Text> : null}
      {snapshot && !snapshot.enabled ? (
        <Text style={ui.body}>
          Scans are disabled pending hosted acceptance. Saved results remain available.
        </Text>
      ) : null}
      {snapshot && !snapshot.activeReferenceVersionId ? (
        <Text style={ui.body}>Import the participant reference list before running a scan.</Text>
      ) : null}
      <ActionButton
        label="Run participant scan"
        loading={working}
        disabled={!snapshot?.enabled || !snapshot.activeReferenceVersionId}
        onPress={() => void run()}
      />
      {snapshot?.run ? (
        <View style={{ gap: 6 }}>
          <Text style={ui.body}>{participantScanTime(snapshot.run.completed_at)} (Toronto)</Text>
          <Text style={ui.body}>Run by {snapshot.run.runner_name}</Text>
          <Text style={ui.body}>
            {snapshot.run.account_count} accounts scanned · {snapshot.run.result_count} candidates
          </Text>
          <Text style={ui.body}>Reference version: {snapshot.run.reference_version_id}</Text>
          <Text style={ui.body}>Scoring: {snapshot.run.scoring_version}</Text>
          {stale ? (
            <Text accessibilityRole="alert" style={ui.body}>
              The reference list changed. Run a new scan before using these suggestions.
            </Text>
          ) : null}
          {snapshot.newRegistrations > 0 ? (
            <Text style={ui.body}>
              {snapshot.newRegistrations} accounts registered after this scan started.
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={ui.body}>No completed scan has been saved.</Text>
      )}
      <ActionButton
        label={history ? 'Hide scan history' : 'Show scan history'}
        variant="secondary"
        onPress={() => setHistory(!history)}
      />
      {history ? (
        <View style={{ gap: 8 }}>
          <ActionButton
            label={scanId === null ? 'Viewing latest scan' : 'View latest scan'}
            disabled={scanId === null}
            variant="secondary"
            onPress={() => onRunChange(null)}
          />
          {snapshot?.history.map((item) => (
            <ActionButton
              key={item.id}
              label={`${participantScanTime(item.completed_at)} — ${item.runner_name}`}
              disabled={scanId === item.id}
              variant="secondary"
              onPress={() => onRunChange(item.id)}
            />
          ))}
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="Minimum match score"
        value={minimum}
        onChangeText={setMinimum}
        keyboardType="numeric"
        maxLength={3}
        style={ui.input}
      />
      {!validThreshold ? (
        <Text accessibilityRole="alert" style={ui.body}>
          Enter a whole score from 35 to 100.
        </Text>
      ) : null}
      {checkbox('Show resolved', resolved, () => setResolved(!resolved))}
      {checkbox('Show dismissed', dismissed, () => setDismissed(!dismissed))}
      {message ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {message}
        </Text>
      ) : null}
      {review ? (
        <View
          style={{
            gap: 10,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 12,
            borderRadius: 10,
          }}
        >
          <Text style={ui.title}>
            {review.dismissed ? 'Undo dismissal' : 'Dismiss match'}: {review.display_name} →{' '}
            {review.evidence.reference.name}
          </Text>
          <TextInput
            accessibilityLabel="Reason for match review"
            placeholder="Reason for this review"
            placeholderTextColor={colors.muted}
            value={reason}
            maxLength={500}
            onChangeText={setReason}
            multiline
            style={ui.input}
          />
          <ActionButton
            label="Save shared review"
            disabled={reason.trim().length < 8}
            loading={working}
            onPress={() => void saveReview()}
          />
          <ActionButton
            label="Cancel match review"
            variant="secondary"
            onPress={() => {
              setReview(null);
              setReason('');
            }}
          />
        </View>
      ) : null}
      {!groups.length && snapshot?.run ? (
        <Text style={ui.body}>No candidates match these filters.</Text>
      ) : null}
      {groups.map((matches) => {
        const best = matches[0];
        const open = expanded.has(best.user_id);
        return (
          <View
            key={best.user_id}
            style={{ gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 14 }}
          >
            <Text accessibilityRole="header" style={ui.title}>
              {best.display_name} · {best.score}/100
            </Text>
            <Text style={ui.body}>{best.email}</Text>
            {best.resolved ? <Text style={ui.body}>Resolved — already classified</Text> : null}
            {best.evidence_changed ? (
              <Text style={ui.body}>
                Account identity changed since this scan. Run a new scan before using a suggestion.
              </Text>
            ) : null}
            {(open ? matches : [best]).map((match) => (
              <View key={match.id} style={{ gap: 8 }}>
                <Text style={ui.body}>
                  Matches {match.evidence.reference.name} · {match.score}/100
                </Text>
                <Text style={ui.body}>
                  {participantRoles[match.evidence.reference.role]} ·{' '}
                  {match.evidence.reference.programs.map((x) => VARSITY_PROGRAMS[x]).join(', ')}
                </Text>
                <Text style={ui.body}>{match.evidence.reasons.join('; ')}</Text>
                {match.evidence.reference.emails.length ? (
                  <Text style={ui.body}>
                    Reference emails: {match.evidence.reference.emails.join(', ')}
                  </Text>
                ) : null}
                {open
                  ? match.evidence.reference.sources.map((source, i) => (
                      <Text key={i} style={ui.body}>
                        {source.title ?? 'Athlete roster'}
                        {source.supportingStaff ? ' (supporting staff)' : ''} — {source.file}, row{' '}
                        {source.rowNumber}
                      </Text>
                    ))
                  : null}
                {match.dismissed ? (
                  <Text style={ui.body}>
                    Dismissed by {match.reviewer_name ?? 'Deleted administrator'}
                    {match.reviewed_at ? `, ${participantScanTime(match.reviewed_at)}` : ''}:{' '}
                    {match.review_reason}
                  </Text>
                ) : null}
                <ActionButton
                  label={`Select ${best.display_name}${open ? ` matching ${match.evidence.reference.name}` : ''}`}
                  disabled={stale || match.evidence_changed || working}
                  onPress={() => onSelect(best.user_id, match)}
                />
                <ActionButton
                  label={match.dismissed ? 'Undo dismissal' : 'Dismiss this match'}
                  disabled={stale || match.evidence_changed || working}
                  variant="secondary"
                  onPress={() => {
                    setReview(match);
                    setReason('');
                  }}
                />
              </View>
            ))}
            {matches.length > 1 ? (
              <ActionButton
                label={
                  open ? 'Hide alternatives' : `Show ${matches.length - 1} alternative matches`
                }
                variant="secondary"
                onPress={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(best.user_id)) next.delete(best.user_id);
                    else next.add(best.user_id);
                    return next;
                  })
                }
              />
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

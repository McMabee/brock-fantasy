import { newCommandKey } from '../lib/command-key';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { torontoDateFields, torontoDateTime, type DraftMode } from '@brock-fantasy/domain';
import { ActionButton, useUiStyles } from '@/components/ui';
import { useDraftSetup } from '@/hooks/use-draft-setup';
import { betaCommand } from '@/lib/web-api';

export function DraftSetupPanel({
  leagueId,
  onSaved,
}: {
  leagueId: string;
  onSaved: () => Promise<void>;
}) {
  const ui = useUiStyles();
  const setup = useDraftSetup(leagueId);
  const [mode, setMode] = useState<DraftMode | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    if (!setup.data) return;
    setMode(setup.data.mode);
    if (setup.data.scheduledFor) {
      const fields = torontoDateFields(setup.data.scheduledFor);
      setDate(fields.date);
      setTime(fields.time);
    }
  }, [setup.data?.mode, setup.data?.scheduledFor]);
  const save = async () => {
    if (working || !mode || !setup.data) return;
    const scheduled = date ? torontoDateTime(date, time) : null;
    if ((date && !scheduled) || (mode === 'scheduled_auto' && !scheduled)) {
      setMessage(
        'Choose a valid future Toronto date and time. Daylight-saving times that occur twice need a different time.',
      );
      return;
    }
    const payload = {
      p_league_id: leagueId,
      p_mode: mode,
      p_scheduled_for: scheduled,
      p_expected_version: setup.data.leagueVersion,
    };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.payload !== fingerprint)
      pending.current = { payload: fingerprint, key: newCommandKey() };
    setWorking(true);
    try {
      const result = await betaCommand('configure_league_draft', {
        ...payload,
        p_idempotency_key: pending.current.key,
      });
      setMessage(
        result.error ??
          (mode === 'scheduled_auto'
            ? 'Automatic draft scheduled. Managers can now prepare their private rankings.'
            : 'Live draft selected. You will start it manually.'),
      );
      if (!result.error) {
        pending.current = null;
        await Promise.all([setup.reload(), onSaved()]);
      } else if (result.status === 409) await setup.reload();
    } finally {
      setWorking(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <Text style={ui.label}>Draft mode</Text>
      <Text style={ui.body}>
        Choose how this league drafts. Live drafts need a commissioner to start them. Automatic
        drafts use private manager rankings, then approved legal defaults.
      </Text>
      {Platform.OS === 'web' ? (
        <fieldset className="draft-mode-options">
          <legend>Choose a draft mode</legend>
          {(['live', 'scheduled_auto'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`draft-mode-${leagueId}`}
                value={value}
                checked={mode === value}
                disabled={working || (value === 'scheduled_auto' && !setup.data?.automaticEnabled)}
                onChange={() => setMode(value)}
              />
              {value === 'live' ? 'Live draft' : 'Scheduled automatic draft'}
            </label>
          ))}
        </fieldset>
      ) : (
        <View style={{ gap: 12 }}>
          {(['live', 'scheduled_auto'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === value }}
              onPress={() => setMode(value)}
            >
              <Text style={ui.body}>
                {value === 'live' ? 'Live draft' : 'Scheduled automatic draft'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {setup.data && !setup.data.automaticEnabled ? (
        <Text style={ui.body}>
          Automatic drafting is awaiting release checks. Live drafting remains available.
        </Text>
      ) : null}
      <Text style={ui.body}>
        America/Toronto time.{' '}
        {mode === 'scheduled_auto'
          ? 'Preferences lock at this time. The system runs the draft over a few minutes; actual completion determines scoring eligibility.'
          : 'The planned time is optional for live drafts.'}
      </Text>
      {Platform.OS === 'web' ? (
        <div className="draft-date-fields">
          <label>
            Draft date
            <input
              type="date"
              value={date}
              disabled={working}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Draft time
            <input
              type="time"
              value={time}
              disabled={working}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Draft date YYYY-MM-DD"
            style={ui.input}
            value={date}
            onChangeText={setDate}
          />
          <TextInput
            accessibilityLabel="Draft time HH:mm"
            style={ui.input}
            value={time}
            onChangeText={setTime}
          />
        </>
      )}
      {setup.data?.blockReason ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {setup.data.blockReason}. Fix the issue, then choose a new future time.
        </Text>
      ) : null}
      {setup.error || message ? (
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          {message ?? setup.error}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <ActionButton
          label="Save draft setup"
          onPress={() => void save()}
          disabled={!mode || !setup.data || working}
          loading={working}
          variant="secondary"
        />
        {date && mode === 'live' ? (
          <ActionButton label="Clear planned date" onPress={() => setDate('')} variant="ghost" />
        ) : null}
        <ActionButton
          label="Prepare private rankings"
          href={`/draft-preferences/${leagueId}`}
          variant="secondary"
        />
      </View>
    </View>
  );
}

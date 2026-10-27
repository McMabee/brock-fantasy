import { newCommandKey } from '../../lib/command-key';
import {
  VARSITY_PROGRAMS,
  type ParticipationRole,
  type VarsityProgram,
  parseParticipation,
} from '@brock-fantasy/domain';
import { useRef, useState } from 'react';
import { Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { ActionButton, AppShell, Card, EmptyState, useUiStyles } from '@/components/ui';
import { AdminAccess } from '@/components/admin-access';
import { VarsityBadge } from '@/components/varsity-badge';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { useThemeColors } from '@/providers/theme-provider';
import { ParticipantDirectory } from '@/components/participant-directory';
import { ParticipantScanPanel } from '@/components/participant-scan-panel';
import { useParticipantScans } from '@/hooks/use-participant-scans';
import { useResponsiveDimensions } from '@/hooks/use-responsive-dimensions';
import {
  participantRead,
  type Participant,
  type ParticipantMatch,
  type ParticipantScanSnapshot,
} from '@/lib/participant-scans';
const roles: Readonly<Record<ParticipationRole, string>> = {
  none: 'Neither',
  athlete: 'Varsity athlete',
  coach: 'Varsity coach',
  athlete_coach: 'Athlete & coach',
};

export default function ParticipantsScreen() {
  const access = useRequireAdmin();
  const ui = useUiStyles();
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Participant[]>([]);
  const [selected, setSelected] = useState<Participant | null>(null);
  const [loaded, setLoaded] = useState<Participant | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [tab, setTab] = useState('Search and edit');
  const { width } = useResponsiveDimensions();
  const wide = width >= 1280;
  const shared = useParticipantScans(access.allowed);
  const selectionRequest = useRef(0);
  const saveKey = useRef<{ intent: string; key: string } | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const dirty = Boolean(
    selected &&
    loaded &&
    (reason.trim() ||
      selected.role !== loaded.role ||
      [...selected.programs].sort().join() !== [...loaded.programs].sort().join()),
  );
  const select = (id: string, match?: ParticipantMatch) => {
    if (working) return;
    const open = async () => {
      const request = ++selectionRequest.current;
      setWorking(true);
      setMessage(null);
      try {
        const [profile, scan] = await Promise.all([
          participantRead<Participant | null>('admin_get_participant', { p_user_id: id }),
          match
            ? participantRead<ParticipantScanSnapshot>('admin_get_participant_scan', {
                p_scan_id: shared.snapshot?.run?.id,
              })
            : Promise.resolve(null),
        ]);
        if (request !== selectionRequest.current) return;
        if (!profile) {
          setMessage('This account is no longer available.');
          return;
        }
        const currentMatch = scan?.matches.find((item) => item.id === match?.id);
        if (
          match &&
          (!currentMatch ||
            currentMatch.evidence_changed ||
            currentMatch.evidence.accountName !== profile.display_name ||
            currentMatch.evidence.accountEmail.toLowerCase().trim() !==
              profile.email.toLowerCase().trim() ||
            scan?.run?.reference_version_id !== scan?.activeReferenceVersionId)
        ) {
          setMessage(
            'Matching evidence changed. Refresh and run a new scan before applying this suggestion.',
          );
          await shared.refresh();
          return;
        }
        setLoaded(profile);
        const applySuggestion = currentMatch && profile.role === 'none';
        setSelected(
          applySuggestion
            ? {
                ...profile,
                role: currentMatch.evidence.reference.role,
                programs: [...currentMatch.evidence.reference.programs],
              }
            : { ...profile, programs: [...profile.programs] },
        );
        setSuggestion(
          applySuggestion
            ? `Unsaved suggestion from ${currentMatch.evidence.reference.name} (${currentMatch.score}/100). Confirm the role and every program before saving.`
            : null,
        );
        setReason('');
        saveKey.current = null;
        setTab('Search and edit');
        if (Platform.OS === 'web')
          requestAnimationFrame(() =>
            document.getElementById('participant-editor-heading')?.focus(),
          );
      } catch {
        setMessage('Unable to load the current account. Please retry.');
      } finally {
        if (request === selectionRequest.current) setWorking(false);
      }
    };
    if (!dirty) {
      void open();
      return;
    }
    if (Platform.OS === 'web') {
      if (window.confirm('Discard unsaved participation changes and open this account?'))
        void open();
    } else
      Alert.alert(
        'Discard unsaved changes?',
        'Opening another account discards the current edits.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard changes', style: 'destructive', onPress: () => void open() },
        ],
      );
  };
  const search = async () => {
    if (!supabase || working || query.trim().length < 2) return;
    setWorking(true);
    setMessage(null);
    try {
      const result = await supabase.rpc('admin_find_participants', { p_query: query.trim() });
      if (result.error) setMessage('Account search is unavailable. Please retry.');
      else {
        const participants = (result.data ?? []) as Participant[];
        setRows(participants);
        if (!participants.length) setMessage('No matching accounts.');
      }
    } catch {
      setMessage('Account search is unavailable. Please retry.');
    } finally {
      setWorking(false);
    }
  };
  const save = async () => {
    if (!selected || working || !parseParticipation(selected.role, selected.programs)) return;
    setWorking(true);
    setMessage(null);
    const intent = JSON.stringify([
      selected.id,
      selected.role,
      [...selected.programs].sort(),
      selected.revision,
      reason.trim(),
    ]);
    if (saveKey.current?.intent !== intent) saveKey.current = { intent, key: newCommandKey() };
    try {
      const result = await betaCommand('admin_set_participation', {
        p_user_id: selected.id,
        p_role: selected.role,
        p_programs: selected.programs,
        p_expected_revision: selected.revision,
        p_reason: reason.trim(),
        p_idempotency_key: saveKey.current.key,
      });
      if (result.error) {
        setMessage(result.error);
        if (result.status === 409 || result.code === 'PT409') {
          const current = await participantRead<Participant | null>('admin_get_participant', {
            p_user_id: selected.id,
          });
          setSelected(current);
          setLoaded(current);
          setReason('');
          setSuggestion(null);
          saveKey.current = null;
          setMessage(
            'Participation changed while you were editing. Current values have been loaded. Review them before submitting a new correction.',
          );
        }
      } else {
        const next = { ...selected, revision: selected.revision + 1 };
        setSelected(next);
        setLoaded(next);
        setSuggestion(null);
        saveKey.current = null;
        setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
        setReason('');
        setMessage('Participation saved. League formats and teammate restrictions are updated.');
      }
      await shared.refresh();
    } catch {
      setMessage('Unable to save participation. Please retry.');
    } finally {
      setWorking(false);
    }
  };
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Account administration" title="Varsity participants" workspace>
      <View style={{ gap: 16 }}>
        <ActionButton
          label="Refresh shared participant data"
          variant="secondary"
          loading={shared.refreshing}
          onPress={() => void shared.refresh()}
        />
        {shared.error ? (
          <Text accessibilityRole="alert" style={ui.body}>
            {shared.error}
          </Text>
        ) : null}
        {!wide ? (
          <View
            accessibilityRole="tablist"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
          >
            {['Participants', 'Search and edit', 'Scan'].map((name, index) =>
              Platform.OS === 'web' ? (
                <button
                  key={name}
                  id={`participant-tab-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  aria-controls={`participant-panel-${index}`}
                  tabIndex={tab === name ? 0 : -1}
                  onClick={() => setTab(name)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === 'ArrowRight'
                        ? (index + 1) % 3
                        : event.key === 'ArrowLeft'
                          ? (index + 2) % 3
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? 2
                              : null;
                    if (next === null) return;
                    event.preventDefault();
                    setTab(['Participants', 'Search and edit', 'Scan'][next] ?? 'Search and edit');
                    document.getElementById(`participant-tab-${next}`)?.focus();
                  }}
                  style={{
                    minHeight: 44,
                    padding: 12,
                    border: `1px solid ${tab === name ? colors.red : colors.border}`,
                    borderRadius: 10,
                    background: 'transparent',
                    color: ui.body.color,
                    font: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {name}
                </button>
              ) : (
                <Pressable
                  key={name}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === name }}
                  aria-selected={tab === name}
                  onPress={() => setTab(name)}
                  style={{
                    minHeight: 44,
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: 10,
                    borderColor: tab === name ? colors.red : colors.border,
                  }}
                >
                  <Text style={ui.body}>{name}</Text>
                </Pressable>
              ),
            )}
          </View>
        ) : null}
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
          <View
            nativeID="participant-panel-0"
            style={{
              display: wide || tab === 'Participants' ? 'flex' : 'none',
              width: wide ? undefined : '100%',
              flex: wide ? 0.23 : undefined,
              minWidth: 0,
            }}
          >
            <ParticipantDirectory
              participants={shared.participants}
              onSelect={(id) => select(id)}
            />
          </View>
          <View
            nativeID="participant-panel-1"
            style={{
              display: wide || tab === 'Search and edit' ? 'flex' : 'none',
              width: wide ? undefined : '100%',
              flex: wide ? 0.4 : undefined,
              minWidth: 0,
              gap: 20,
            }}
          >
            <Card style={{ gap: 14 }}>
              <Text style={ui.body}>
                Find an account by name or email. Athletes and coaches trigger the varsity league
                format and cannot acquire athletes from their own programs.
              </Text>
              <TextInput
                accessibilityLabel="Find participant by name or email"
                editable={!working}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => void search()}
                placeholder="Name or email"
                placeholderTextColor={colors.muted}
                style={ui.input}
                maxLength={320}
              />
              <ActionButton
                label="Find accounts"
                onPress={() => void search()}
                disabled={query.trim().length < 2}
                loading={working}
              />
            </Card>
            {message ? (
              <Text accessibilityRole="alert" style={ui.body}>
                {message}
              </Text>
            ) : null}
            {rows.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit participation for ${row.display_name}`}
                disabled={working}
                onPress={() => select(row.id)}
              >
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={ui.title}>{row.display_name}</Text>
                    <Text style={ui.body}>
                      {row.email}, {roles[row.role]}
                    </Text>
                  </View>
                  <VarsityBadge visible={row.role !== 'none'} />
                </Card>
              </Pressable>
            ))}
            {selected ? (
              <Card style={{ gap: 16 }}>
                {Platform.OS === 'web' ? (
                  <h2
                    id="participant-editor-heading"
                    tabIndex={-1}
                    style={{ margin: 0, fontSize: ui.title.fontSize, color: ui.title.color }}
                  >
                    {selected.display_name}
                  </h2>
                ) : (
                  <Text accessibilityRole="header" style={ui.title}>
                    {selected.display_name}
                  </Text>
                )}
                <Text style={ui.body}>{selected.email}</Text>
                {suggestion ? (
                  <Text accessibilityRole="alert" style={ui.body}>
                    {suggestion}
                  </Text>
                ) : null}
                <Text style={ui.body}>Supporting staff use the Varsity coach classification.</Text>
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Varsity participation"
                  style={{ gap: 10 }}
                >
                  {(Object.keys(roles) as ParticipationRole[]).map((role) => (
                    <Pressable
                      key={role}
                      accessibilityRole="radio"
                      disabled={working}
                      aria-checked={selected.role === role}
                      accessibilityState={{ checked: selected.role === role }}
                      onPress={() =>
                        setSelected({
                          ...selected,
                          role,
                          programs: role === 'none' ? [] : selected.programs,
                        })
                      }
                      style={{
                        padding: 12,
                        borderWidth: 1,
                        borderRadius: 10,
                        borderColor: selected.role === role ? colors.red : colors.border,
                      }}
                    >
                      <Text style={ui.body}>{roles[role]}</Text>
                    </Pressable>
                  ))}
                </View>
                {selected.role !== 'none' ? (
                  <View style={{ gap: 10 }}>
                    <Text style={ui.label}>Every program they play for or coach</Text>
                    {(Object.keys(VARSITY_PROGRAMS) as VarsityProgram[]).map((program) => (
                      <Pressable
                        key={program}
                        accessibilityRole="checkbox"
                        disabled={working}
                        aria-checked={selected.programs.includes(program)}
                        accessibilityState={{ checked: selected.programs.includes(program) }}
                        onPress={() =>
                          setSelected({
                            ...selected,
                            programs: selected.programs.includes(program)
                              ? selected.programs.filter((item) => item !== program)
                              : [...selected.programs, program],
                          })
                        }
                        style={{ minHeight: 44, justifyContent: 'center' }}
                      >
                        <Text style={ui.body}>
                          {selected.programs.includes(program) ? '☑' : '☐'}{' '}
                          {VARSITY_PROGRAMS[program]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text style={ui.body}>
                  Existing athletes and earned points stay on record. Conflicting teammates must be
                  replaced before the next lineup save and cannot score in games starting after this
                  correction.
                </Text>
                <TextInput
                  accessibilityLabel="Reason for participation correction"
                  editable={!working}
                  placeholder="Reason for this correction"
                  placeholderTextColor={colors.muted}
                  value={reason}
                  onChangeText={setReason}
                  maxLength={500}
                  multiline
                  style={ui.input}
                />
                <ActionButton
                  label="Save participation"
                  onPress={() => void save()}
                  loading={working}
                  disabled={
                    reason.trim().length < 8 ||
                    !parseParticipation(selected.role, selected.programs)
                  }
                />
              </Card>
            ) : (
              <EmptyState
                title="Select an account"
                body="Choose a search result to review or correct participation."
              />
            )}
          </View>
          <View
            nativeID="participant-panel-2"
            style={{
              display: wide || tab === 'Scan' ? 'flex' : 'none',
              width: wide ? undefined : '100%',
              flex: wide ? 0.37 : undefined,
              minWidth: 0,
            }}
          >
            <ParticipantScanPanel
              snapshot={shared.snapshot}
              scanId={shared.scanId}
              onRunChange={shared.setScanId}
              onRefresh={shared.refresh}
              onSelect={(id, match) => select(id, match)}
            />
          </View>
        </View>
      </View>
    </AppShell>
  );
}

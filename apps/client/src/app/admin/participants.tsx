import {
  VARSITY_PROGRAMS,
  type ParticipationRole,
  type VarsityProgram,
  parseParticipation,
} from '@brock-fantasy/domain';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ActionButton, AppShell, Card, EmptyState, useUiStyles } from '@/components/ui';
import { AdminAccess } from '@/components/admin-access';
import { VarsityBadge } from '@/components/varsity-badge';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { useThemeColors } from '@/providers/theme-provider';

interface Participant {
  id: string;
  display_name: string;
  email: string;
  role: ParticipationRole;
  programs: VarsityProgram[];
  revision: number;
}
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
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const search = async () => {
    if (!supabase || working || query.trim().length < 2) return;
    setWorking(true);
    setMessage(null);
    setSelected(null);
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
    try {
      const result = await betaCommand('admin_set_participation', {
        p_user_id: selected.id,
        p_role: selected.role,
        p_programs: selected.programs,
        p_expected_revision: selected.revision,
        p_reason: reason.trim(),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (result.error) setMessage(result.error);
      else {
        const next = { ...selected, revision: selected.revision + 1 };
        setSelected(next);
        setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
        setReason('');
        setMessage('Participation saved. League formats and teammate restrictions are updated.');
      }
    } catch {
      setMessage('Unable to save participation. Please retry.');
    } finally {
      setWorking(false);
    }
  };
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Account administration" title="Varsity participants">
      <Card style={{ gap: 14 }}>
        <Text style={ui.body}>
          Find an account by name or email. Athletes and coaches trigger the varsity league format
          and cannot acquire athletes from their own programs.
        </Text>
        <TextInput
          accessibilityLabel="Find participant by name or email"
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
          onPress={() => {
            setSelected({ ...row, programs: [...row.programs] });
            setReason('');
          }}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={ui.title}>{row.display_name}</Text>
              <Text style={ui.body}>
                {row.email} · {roles[row.role]}
              </Text>
            </View>
            <VarsityBadge visible={row.role !== 'none'} />
          </Card>
        </Pressable>
      ))}
      {selected ? (
        <Card style={{ gap: 16 }}>
          <Text accessibilityRole="header" style={ui.title}>
            {selected.display_name}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Varsity participation"
            style={{ gap: 10 }}
          >
            {(Object.keys(roles) as ParticipationRole[]).map((role) => (
              <Pressable
                key={role}
                accessibilityRole="radio"
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
                    {selected.programs.includes(program) ? '☑' : '☐'} {VARSITY_PROGRAMS[program]}
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
              reason.trim().length < 8 || !parseParticipation(selected.role, selected.programs)
            }
          />
        </Card>
      ) : (
        <EmptyState
          title="Select an account"
          body="Choose a search result to review or correct participation."
        />
      )}
    </AppShell>
  );
}

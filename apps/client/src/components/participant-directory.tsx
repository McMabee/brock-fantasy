import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import {
  VARSITY_PROGRAMS,
  type ParticipationRole,
  type VarsityProgram,
} from '@brock-fantasy/domain';
import { ActionButton, Card, useUiStyles } from './ui';
import { useThemeColors } from '@/providers/theme-provider';
import type { Participant } from '@/lib/participant-scans';

export const participantRoles: Readonly<Record<ParticipationRole, string>> = {
  none: 'Neither',
  athlete: 'Varsity athlete',
  coach: 'Varsity coach',
  athlete_coach: 'Athlete & coach',
};
export function ParticipantDirectory({
  participants,
  onSelect,
}: {
  participants: Participant[];
  onSelect: (id: string) => void;
}) {
  const ui = useUiStyles();
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<ParticipationRole | null>(null);
  const [program, setProgram] = useState<VarsityProgram | null>(null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return participants.filter(
      (p) =>
        (!role || p.role === role) &&
        (!program || p.programs.includes(program)) &&
        (!needle || `${p.display_name} ${p.email}`.toLowerCase().includes(needle)),
    );
  }, [participants, program, query, role]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const filterButton = (label: string, checked: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      <Text style={ui.body}>
        {checked ? '☑' : '☐'} {label}
      </Text>
    </Pressable>
  );
  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={ui.title}>
        Participants ({participants.length})
      </Text>
      <TextInput
        accessibilityLabel="Filter varsity participants"
        placeholder="Name or email"
        placeholderTextColor={colors.muted}
        style={ui.input}
        value={query}
        maxLength={320}
        onChangeText={(value) => {
          setQuery(value);
          setPage(0);
        }}
      />
      <Text style={ui.label}>Role</Text>
      {(['athlete', 'coach', 'athlete_coach'] as const).map((value) =>
        filterButton(participantRoles[value], role === value, () => {
          setRole(role === value ? null : value);
          setPage(0);
        }),
      )}
      <Text style={ui.label}>Program</Text>
      {(Object.keys(VARSITY_PROGRAMS) as VarsityProgram[]).map((value) =>
        filterButton(VARSITY_PROGRAMS[value], program === value, () => {
          setProgram(program === value ? null : value);
          setPage(0);
        }),
      )}
      <Text style={ui.body}>{filtered.length} matching accounts</Text>
      {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={`Review ${p.display_name}`}
          onPress={() => onSelect(p.id)}
          style={{ gap: 4, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.border }}
        >
          <Text style={ui.title}>{p.display_name}</Text>
          <Text style={ui.body}>{p.email}</Text>
          <Text style={ui.body}>{participantRoles[p.role]}</Text>
          <Text style={ui.body}>{p.programs.map((x) => VARSITY_PROGRAMS[x]).join(', ')}</Text>
        </Pressable>
      ))}
      {!filtered.length ? (
        <Text style={ui.body}>No varsity accounts match these filters.</Text>
      ) : null}
      <Text style={ui.body}>
        Page {currentPage + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}
      </Text>
      <ActionButton
        label="Previous participants"
        variant="secondary"
        disabled={currentPage === 0}
        onPress={() => setPage(currentPage - 1)}
      />
      <ActionButton
        label="Next participants"
        variant="secondary"
        disabled={(currentPage + 1) * 25 >= filtered.length}
        onPress={() => setPage(currentPage + 1)}
      />
    </Card>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  VARSITY_PROGRAMS,
  parseParticipation,
  type ParticipationRole,
  type VarsityProgram,
} from '@brock-fantasy/domain';
import { useRequireUser } from '@/hooks/use-route-access';
import { useAdminLeagueRead } from '@/hooks/use-admin-leagues';
import { useSession } from '@/providers/session-provider';
import { useThemeColors } from '@/providers/theme-provider';
import { AdminSelect, AdminToggle, adminMultiline } from '@/components/admin-ui';
import { ActionButton, Card, LoadingState, useUiStyles } from '@/components/ui';
import { participantRoles } from '@/components/participant-directory';
import type { ParticipantRequest } from '@/lib/participant-requests';
import { betaCommand } from '@/lib/web-api';
import { newCommandKey } from '@/lib/command-key';
import { adminDate } from '@/lib/admin-leagues';

function ConfirmationForm({
  request,
  onSubmitted,
}: {
  request: ParticipantRequest;
  onSubmitted: () => Promise<void>;
}) {
  const ui = useUiStyles();
  const [role, setRole] = useState<ParticipationRole>(request.suggested_role);
  const [programs, setPrograms] = useState<VarsityProgram[]>(request.suggested_programs);
  const [explanation, setExplanation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef<{ intent: string; key: string } | null>(null);
  const submit = async () => {
    if (busy || !parseParticipation(role, programs)) return;
    const intent = JSON.stringify([request.id, role, [...programs].sort(), explanation.trim()]);
    if (key.current?.intent !== intent) key.current = { intent, key: newCommandKey() };
    setBusy(true);
    try {
      const result = await betaCommand('submit_participant_confirmation', {
        p_request_id: request.id,
        p_role: role,
        p_programs: programs,
        p_explanation: explanation.trim(),
        p_idempotency_key: key.current.key,
      });
      if (result.error) {
        setMessage(result.error);
        if (result.status && result.status < 500) key.current = null;
        if (result.status === 409) await onSubmitted();
      } else await onSubmitted();
    } catch {
      setMessage('Submission outcome unavailable. Retry to retrieve the same response safely.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 16 }}>
      <Text style={ui.body}>
        Confirm or correct your varsity role and programs. An administrator will review your
        response before changing your participation status.
      </Text>
      <Text style={ui.body}>Request expires {adminDate(request.expires_at)}</Text>
      <AdminSelect
        label="Your varsity role"
        value={role}
        disabled={busy}
        options={Object.entries(participantRoles).map(([value, label]) => ({ value, label }))}
        onChange={(value) => {
          setRole(value as ParticipationRole);
          if (value === 'none') setPrograms([]);
        }}
      />
      {role !== 'none' ? (
        <View style={{ gap: 4 }}>
          <Text style={ui.label}>Your varsity programs</Text>
          {Object.entries(VARSITY_PROGRAMS).map(([program, label]) => (
            <AdminToggle
              key={program}
              label={label}
              selected={programs.includes(program as VarsityProgram)}
              onPress={() => {
                if (!busy)
                  setPrograms((current) =>
                    current.includes(program as VarsityProgram)
                      ? current.filter((value) => value !== program)
                      : [...current, program as VarsityProgram],
                  );
              }}
            />
          ))}
        </View>
      ) : null}
      <Text style={ui.label}>Optional explanation</Text>
      <TextInput
        accessibilityLabel="Optional participation explanation"
        multiline
        maxLength={1000}
        editable={!busy}
        value={explanation}
        onChangeText={setExplanation}
        style={[ui.input, adminMultiline]}
      />
      {message ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {message}
        </Text>
      ) : null}
      <ActionButton
        label="Submit for administrator review"
        disabled={!parseParticipation(role, programs)}
        loading={busy}
        onPress={() => void submit()}
      />
    </View>
  );
}

export default function ParticipantConfirmationScreen() {
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = 'Confirm varsity status | Brock Fantasy';
  }, []);
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = `/participation/confirm/${id}`;
  const access = useRequireUser(path);
  const { signOut } = useSession();
  const router = useRouter();
  const colors = useThemeColors();
  const ui = useUiStyles();
  const valid =
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id);
  const read = useAdminLeagueRead<ParticipantRequest>(
    'get_my_participant_request',
    { p_request_id: id },
    access.allowed && valid,
  );
  return (
    <View
      nativeID="bf-main"
      role="main"
      tabIndex={-1}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          alignItems: 'center',
          flexGrow: 1,
          justifyContent: 'center',
        }}
      >
        <View style={{ width: '100%', maxWidth: 660, gap: 20 }}>
          <Text accessibilityRole="header" style={ui.title}>
            BROCK FANTASY
          </Text>
          <Card style={{ gap: 18 }}>
            <Text accessibilityRole="header" style={[ui.title, { fontSize: 30 }]}>
              Confirm your varsity status
            </Text>
            {access.loading || read.loading ? (
              <LoadingState label="Loading your confirmation request" />
            ) : !valid || read.error || !read.data ? (
              <>
                <Text style={ui.body}>
                  This request is unavailable for the signed-in account. Sign in with the account
                  that received the email.
                </Text>
                <ActionButton
                  label="Use another account"
                  variant="secondary"
                  onPress={() =>
                    void signOut().then(() =>
                      router.replace({ pathname: '/auth', params: { next: path } }),
                    )
                  }
                />
              </>
            ) : read.data.status === 'pending' ? (
              <ConfirmationForm key={read.data.id} request={read.data} onSubmitted={read.refresh} />
            ) : (
              <>
                <Text style={ui.title}>
                  {read.data.status === 'responded'
                    ? 'Response submitted'
                    : read.data.status === 'approved'
                      ? 'Response approved'
                      : read.data.status === 'rejected'
                        ? 'Response reviewed'
                        : 'Request no longer active'}
                </Text>
                <Text style={ui.body}>
                  {read.data.status === 'responded'
                    ? 'An administrator will review your response. Your participation status remains unchanged until approval.'
                    : read.data.status === 'expired'
                      ? 'This request expired. An administrator can send a new request.'
                      : ['obsolete', 'superseded'].includes(read.data.status)
                        ? 'The account information or request changed. Use the most recent request from an administrator.'
                        : 'Your response has been reviewed. This page only handles varsity confirmation.'}
                </Text>
              </>
            )}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

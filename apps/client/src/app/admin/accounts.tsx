import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput } from 'react-native';
import { AppShell, ActionButton, Card, Pill, uiStyles } from '@/components/ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { betaCommand } from '@/lib/web-api';
import { webRequest } from '@/lib/web-request';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme';
import { AdminAccess } from '@/components/admin-access';

interface Account {
  found: boolean;
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  eligible: boolean;
  totpEnrolled: boolean;
  isAdmin: boolean;
  protectedOperator: boolean;
}

export default function AdminAccountsScreen() {
  const access = useRequireAdmin();
  const authorized = access.allowed;
  const [canManage, setCanManage] = useState(false);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!authorized) return;
    if (Platform.OS === 'web') {
      void webRequest<{ canManage: boolean }>('/api/admin/accounts').then(({ data, error }) => {
        setCanManage(data?.canManage === true);
        if (error) setMessage(error);
      });
    } else if (supabase) {
      void supabase.rpc('can_manage_admin_accounts').then(({ data, error }) => {
        setCanManage(data === true);
        if (error) setMessage('Operator access is required.');
      });
    }
  }, [authorized]);

  async function lookup() {
    setBusy(true);
    setAccount(null);
    setMessage(null);
    const result =
      Platform.OS === 'web'
        ? await webRequest<Account>(`/api/admin/accounts?email=${encodeURIComponent(email.trim())}`)
        : await betaCommand<Account>('admin_find_account', { p_email: email.trim() });
    setAccount(result.data?.found ? result.data : null);
    setMessage(
      result.error ??
        (result.data?.found
          ? null
          : 'No active account found. Ask the staff member to sign up first.'),
    );
    setBusy(false);
  }

  async function changeRole() {
    if (!account) return;
    setBusy(true);
    const enabled = !account.isAdmin;
    const { data, error } = await betaCommand<{ auditId: number }>('admin_set_account_role', {
      p_user_id: account.id,
      p_enabled: enabled,
      p_reason: reason.trim(),
      p_idempotency_key: `admin-role-${account.id}-${Date.now()}`,
    });
    if (data) {
      setAccount({ ...account, isAdmin: enabled });
      setReason('');
      setMessage(
        `Admin access ${enabled ? 'granted' : 'revoked'}. Audit reference ${data.auditId}.`,
      );
    } else
      setMessage(
        error ?? 'The change could not be confirmed. Look up the account again before retrying.',
      );
    setBusy(false);
  }
  const ready = account && account.emailVerified && account.eligible && account.totpEnrolled;
  if (!authorized) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Restricted" title="Staff accounts">
      <Card style={styles.card}>
        <Text style={uiStyles.body}>
          Staff must verify their email, confirm eligibility and enroll their own authenticator at
          Account → MFA before admin access can be granted. Operator access and MFA are required to
          change roles.
        </Text>
        {!canManage ? (
          <Text style={uiStyles.body}>
            Staff access changes are available to the operator only. Scorekeeping remains available
            through Operations.
          </Text>
        ) : null}
        <Text style={uiStyles.label}>Account email</Text>
        <TextInput
          accessibilityLabel="Staff account email"
          autoCapitalize="none"
          keyboardType="email-address"
          style={uiStyles.input}
          value={email}
          editable={canManage && !busy}
          onChangeText={(value) => {
            setEmail(value);
            setAccount(null);
            setMessage(null);
          }}
        />
        <ActionButton
          label="Find account"
          onPress={() => void lookup()}
          loading={busy}
          disabled={!canManage || !email.trim()}
        />
      </Card>
      {account ? (
        <Card style={styles.card}>
          <Text style={uiStyles.title}>{account.displayName}</Text>
          <Text style={uiStyles.body}>{account.email}</Text>
          <Pill label={account.isAdmin ? 'ADMIN' : 'MEMBER'} />
          <Text style={uiStyles.body}>
            Email {account.emailVerified ? 'verified' : 'pending'} · Eligibility{' '}
            {account.eligible ? 'confirmed' : 'pending'} · Authenticator{' '}
            {account.totpEnrolled ? 'enrolled' : 'pending'}
          </Text>
          {account.protectedOperator ? (
            <Text style={uiStyles.body}>
              Operator access is protected. Changes require the operator recovery procedure.
            </Text>
          ) : (
            <>
              <Text style={uiStyles.label}>Reason for access change</Text>
              <TextInput
                accessibilityLabel="Admin access change reason"
                multiline
                maxLength={500}
                value={reason}
                onChangeText={setReason}
                editable={!busy}
                style={uiStyles.input}
              />
              <ActionButton
                label={account.isAdmin ? 'Revoke admin access' : 'Grant admin access'}
                variant={account.isAdmin ? 'danger' : 'primary'}
                onPress={() => void changeRole()}
                disabled={
                  !canManage || busy || reason.trim().length < 8 || (!account.isAdmin && !ready)
                }
              />
            </>
          )}
        </Card>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <ActionButton label="Back to operations" href="/admin" variant="secondary" />
    </AppShell>
  );
}
const styles = StyleSheet.create({
  card: { gap: 12, marginBottom: 20 },
  message: { color: colors.text, marginBottom: 20, fontSize: 14 },
});

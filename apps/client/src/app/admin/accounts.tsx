import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput } from 'react-native';
import { AppShell, ActionButton, Card, Pill, uiStyles } from '@/components/ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { betaCommand } from '@/lib/web-api';
import { webRequest } from '@/lib/web-request';
import { colors } from '@/theme';
import { AdminAccess } from '@/components/admin-access';
import { inviteAdministrator } from '@/lib/admin-invitations';
import { useAdminAccountManager } from '@/hooks/use-admin-account-manager';

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
  invitationPending: boolean;
}

export default function AdminAccountsScreen() {
  const access = useRequireAdmin();
  const authorized = access.allowed;
  const canManage = useAdminAccountManager(authorized);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('Administrator invitation from Ty Mabee');
  const inviteKey = useRef<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function invite() {
    if (busy || !canManage) return;
    setBusy(true);
    setMessage(null);
    inviteKey.current ??= `admin-invite-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await inviteAdministrator(email.trim(), reason.trim(), inviteKey.current);
    if (result.data) {
      inviteKey.current = null;
      setMessage(
        'Invitation email sent. Admin access activates when they sign in and verify their authenticator.',
      );
      if (account) setAccount({ ...account, invitationPending: true });
    } else setMessage(result.error);
    setBusy(false);
  }

  async function lookup() {
    if (busy || !canManage) return;
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
    if (!account || busy || !canManage) return;
    setBusy(true);
    const { data, error } = await betaCommand<{ auditId: number }>('admin_set_account_role', {
      p_user_id: account.id,
      p_enabled: false,
      p_reason: reason.trim(),
      p_idempotency_key: `admin-role-${account.id}-${Date.now()}`,
    });
    if (data) {
      setAccount({ ...account, isAdmin: false, invitationPending: false });
      setMessage(
        `Admin access revoked and invitations cancelled. Audit reference ${data.auditId}.`,
      );
    } else
      setMessage(
        error ?? 'The change could not be confirmed. Look up the account again before retrying.',
      );
    setBusy(false);
  }
  if (!authorized) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Super administrator" title="Administrator invitations">
      <Card style={styles.card}>
        <Text style={uiStyles.body}>
          Ty Mabee (tymabee@proton.me) is the only super administrator. Enter a registered account's
          email to send an invitation. They will sign in and set up or verify their own
          authenticator using the email link. Their admin access activates after verification.
        </Text>
        {!canManage ? (
          <Text style={uiStyles.body}>
            Only Ty can invite or manage administrators. Standard admins have access to all other
            admin tools through Operations.
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
            inviteKey.current = null;
            setAccount(null);
            setMessage(null);
          }}
        />
        <Text style={uiStyles.label}>Access reason</Text>
        <TextInput
          accessibilityLabel="Admin access change reason"
          multiline
          maxLength={500}
          value={reason}
          onChangeText={(value) => {
            setReason(value);
            inviteKey.current = null;
          }}
          editable={canManage && !busy}
          style={uiStyles.input}
        />
        <ActionButton
          label={account?.invitationPending ? 'Send a new invitation' : 'Send admin invitation'}
          onPress={() => void invite()}
          loading={busy}
          disabled={
            !canManage || !email.trim() || reason.trim().length < 8 || Boolean(account?.isAdmin)
          }
        />
        <ActionButton
          label="Find account"
          onPress={() => void lookup()}
          loading={busy}
          disabled={!canManage || !email.trim()}
          variant="secondary"
        />
      </Card>
      {account ? (
        <Card style={styles.card}>
          <Text style={uiStyles.title}>{account.displayName}</Text>
          <Text style={uiStyles.body}>{account.email}</Text>
          <Pill
            label={
              account.protectedOperator
                ? 'SUPER ADMIN'
                : account.isAdmin
                  ? 'ADMIN'
                  : account.invitationPending
                    ? 'INVITED'
                    : 'MEMBER'
            }
          />
          <Text style={uiStyles.body}>
            Email {account.emailVerified ? 'verified' : 'pending'} · Eligibility{' '}
            {account.eligible ? 'confirmed' : 'pending'} · Authenticator{' '}
            {account.totpEnrolled ? 'enrolled' : 'pending'}
          </Text>
          {account.protectedOperator ? (
            <Text style={uiStyles.body}>Ty's super administrator access is protected.</Text>
          ) : account.isAdmin || account.invitationPending ? (
            <ActionButton
              label={account.isAdmin ? 'Revoke admin access' : 'Cancel invitation'}
              variant="danger"
              onPress={() => void changeRole()}
              disabled={!canManage || busy || reason.trim().length < 8}
            />
          ) : null}
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

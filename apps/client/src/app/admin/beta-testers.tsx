import { useEffect, useState } from 'react';
import { Platform, Text, TextInput } from 'react-native';
import { AppShell, ActionButton, Card, uiStyles } from '@/components/ui';
import { AdminAccess } from '@/components/admin-access';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { useAdminAccountManager } from '@/hooks/use-admin-account-manager';
import { webRequest } from '@/lib/web-request';
import { betaCommand } from '@/lib/web-api';
interface Approval {
  email: string;
  access_kind: string;
  user_id: string | null;
  revoked_at: string | null;
}
export default function BetaTestersScreen() {
  const access = useRequireAdmin();
  const canManage = useAdminAccountManager(access.allowed);
  const [rows, setRows] = useState<Approval[]>([]);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function load() {
    const result =
      Platform.OS === 'web'
        ? await webRequest<Approval[]>('/api/admin/beta-testers')
        : await betaCommand<Approval[]>('admin_beta_testers', {});
    if (result.data) setRows(result.data);
    setMessage(result.error);
  }
  useEffect(() => {
    if (canManage) void load();
  }, [canManage]);
  async function change(enabled: boolean) {
    if (busy || !canManage) return;
    setBusy(true);
    const result =
      Platform.OS === 'web'
        ? await webRequest<Approval[]>('/api/admin/beta-testers', {
            method: 'POST',
            body: { email, reason, enabled },
          })
        : await betaCommand<Approval[]>('admin_beta_testers', {
            p_email: email,
            p_reason: reason,
            p_enabled: enabled,
          });
    if (result.data) {
      setRows(result.data);
      setMessage(
        enabled
          ? 'Tester approved. Existing administrator roles are unchanged.'
          : 'Tester access revoked. Existing roles and data are retained.',
      );
    } else setMessage(result.error);
    setBusy(false);
  }
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Super administrator" title="Beta testers">
      {!canManage ? (
        <Text style={uiStyles.body}>Only Ty Mabee can approve and revoke beta testers.</Text>
      ) : (
        <>
          <Card>
            <Text style={uiStyles.label}>Tester email</Text>
            <TextInput
              accessibilityLabel="Tester email"
              style={uiStyles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={uiStyles.label}>Audit reason</Text>
            <TextInput
              accessibilityLabel="Tester approval audit reason"
              style={uiStyles.input}
              value={reason}
              onChangeText={setReason}
              maxLength={500}
            />
            <ActionButton
              label="Approve Tester"
              onPress={() => void change(true)}
              disabled={busy || !email || reason.trim().length < 8}
            />
            <ActionButton
              label="Revoke Tester"
              onPress={() => void change(false)}
              disabled={busy || !email || reason.trim().length < 8}
            />
            {message ? <Text style={uiStyles.body}>{message}</Text> : null}
          </Card>
          {rows.map((row) => (
            <Card key={row.email}>
              <Text style={uiStyles.label}>{row.email}</Text>
              <Text style={uiStyles.body}>
                {row.access_kind === 'operator'
                  ? 'Protected super administrator'
                  : row.revoked_at
                    ? 'Revoked tester'
                    : row.user_id
                      ? 'Approved tester'
                      : 'Approved, awaiting activation'}
              </Text>
            </Card>
          ))}
        </>
      )}
    </AppShell>
  );
}

import { Text, View } from 'react-native';

import { ActionButton, AppShell, Card, uiStyles } from '@/components/ui';
import { useSession } from '@/providers/session-provider';

export function AdminAccess({ loading, error }: { loading: boolean; error: string | null }) {
  const { user } = useSession();
  return (
    <AppShell
      eyebrow="Administrator access"
      title={loading ? 'Checking access' : 'Admin access required'}
    >
      <Card>
        <View style={{ gap: 16 }}>
          <Text accessibilityRole="alert" style={uiStyles.body}>
            {loading
              ? 'Checking your account and authenticator verification…'
              : (error ??
                'This account has not been granted administrator access. Ask the operator to review your staff account.')}
          </Text>
          {user?.email ? <Text style={uiStyles.body}>Signed in as {user.email}</Text> : null}
          {!loading ? (
            <ActionButton label="Your account" href="/account" variant="secondary" />
          ) : null}
        </View>
      </Card>
    </AppShell>
  );
}

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, uiStyles } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { adminReturnPath } from '@/lib/admin-navigation';
import { webRequest } from '@/lib/web-request';
import { useSession } from '@/providers/session-provider';
import { colors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

interface FactorSetup {
  id: string;
  qrCode: string | null;
  secret: string | null;
  verified: boolean;
}

interface WebMfaStatus {
  aal: 'aal1' | 'aal2';
  hasAdminRole: boolean;
  factor: { id: string; verified: boolean } | null;
  enrollmentPending: boolean;
}

export default function MfaScreen() {
  useRequireUser();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { user } = useSession();
  const [factor, setFactor] = useState<FactorSetup | null>(null);
  const [hasAdminRole, setHasAdminRole] = useState(false);
  const [pending, setPending] = useState(false);
  const [verifiedSession, setVerifiedSession] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      if (Platform.OS === 'web') {
        const result = await webRequest<WebMfaStatus>('/api/admin/mfa');
        if (cancelled) return;
        if (!result.data) setMessage(result.error ?? 'Authenticator status is unavailable.');
        else {
          setHasAdminRole(result.data.hasAdminRole);
          setVerifiedSession(result.data.aal === 'aal2');
          setPending(result.data.enrollmentPending);
          setFactor(
            result.data.factor ? { ...result.data.factor, qrCode: null, secret: null } : null,
          );
          if (result.data.aal === 'aal2' && result.data.hasAdminRole && next)
            router.replace(adminReturnPath(next));
        }
      } else if (supabase) {
        const [assurance, factors, role] = await Promise.all([
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
          supabase.auth.mfa.listFactors(),
          supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .eq('role', 'admin')
            .maybeSingle(),
        ]);
        if (cancelled) return;
        const error = assurance.error ?? factors.error ?? role.error;
        if (error) setMessage(error.message);
        else {
          const enrolled = factors.data?.totp.find((entry) => entry.status === 'verified');
          setFactor(
            enrolled ? { id: enrolled.id, qrCode: null, secret: null, verified: true } : null,
          );
          setPending(
            factors.data?.all.some(
              (entry) => entry.factor_type === 'totp' && entry.status === 'unverified',
            ) ?? false,
          );
          setHasAdminRole(Boolean(role.data));
          setVerifiedSession(assurance.data?.currentLevel === 'aal2');
          if (assurance.data?.currentLevel === 'aal2' && role.data && next)
            router.replace(adminReturnPath(next));
        }
      } else setMessage('Authenticator security is not configured.');
      setLoading(false);
    };
    void load().catch(() => {
      if (!cancelled) {
        setMessage('Unable to load authenticator status. Refresh to try again.');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [next, router, user]);

  const enroll = async () => {
    setLoading(true);
    setMessage(null);
    if (Platform.OS === 'web') {
      const result = await webRequest<{ factor: FactorSetup }>('/api/admin/mfa', {
        method: 'POST',
        body: { action: 'enroll' },
      });
      if (result.data) {
        setFactor(result.data.factor);
        setPending(false);
      } else setMessage(result.error);
    } else if (supabase) {
      const entries = await supabase.auth.mfa.listFactors();
      if (entries.error) {
        setMessage(entries.error.message);
        setLoading(false);
        return;
      }
      if (entries.data.totp.length) {
        setMessage('An authenticator is already enrolled. Refresh and verify it.');
        setLoading(false);
        return;
      }
      for (const entry of entries.data.all.filter(
        (item) => item.factor_type === 'totp' && item.status === 'unverified',
      )) {
        const result = await supabase.auth.mfa.unenroll({ factorId: entry.id });
        if (result.error) {
          setMessage(result.error.message);
          setLoading(false);
          return;
        }
      }
      const result = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Brock Fantasy administrator',
      });
      if (result.error) setMessage(result.error.message);
      else {
        setFactor({
          id: result.data.id,
          qrCode: result.data.totp.qr_code,
          secret: result.data.totp.secret,
          verified: false,
        });
        setPending(false);
      }
    }
    setLoading(false);
  };

  const verify = async () => {
    if (!factor || !/^\d{6}$/u.test(code.trim())) {
      setMessage('Enter the six-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setMessage(null);
    const error =
      Platform.OS === 'web'
        ? (
            await webRequest('/api/admin/mfa', {
              method: 'POST',
              body: { action: 'verify', factorId: factor.id, code: code.trim() },
            })
          ).error
        : supabase
          ? ((
              await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
            ).error?.message ?? null)
          : 'Authenticator security is not configured.';
    setLoading(false);
    if (error) {
      setMessage(error);
      return;
    }
    setCode('');
    setFactor({ id: factor.id, qrCode: null, secret: null, verified: true });
    setVerifiedSession(true);
    if (hasAdminRole) router.replace(adminReturnPath(next));
    else
      setMessage(
        'Authenticator verified. Ask the operator to grant your staff access, then open the admin panel.',
      );
  };

  return (
    <AppShell eyebrow="Account security" title="Authenticator security">
      <Card style={styles.card}>
        <Pill
          label={verifiedSession ? 'AUTHENTICATOR VERIFIED' : 'ADMIN MFA REQUIRED'}
          tone={verifiedSession ? 'positive' : 'warning'}
        />
        <Text style={uiStyles.body}>
          Set up your own authenticator before the operator grants staff access. Admin data and
          commands require both an admin role and a verified session.
        </Text>
        {verifiedSession ? (
          <ActionButton
            label={hasAdminRole ? 'Open admin panel' : 'Back to account'}
            href={hasAdminRole ? adminReturnPath(next) : '/account'}
          />
        ) : !factor ? (
          <>
            <Text style={uiStyles.body}>
              {pending
                ? 'A previous setup was not completed. Restart to generate a new QR code, and replace the incomplete entry in your authenticator.'
                : 'Use an authenticator app to generate the six-digit codes needed for staff access.'}
            </Text>
            <ActionButton
              label={pending ? 'Restart authenticator setup' : 'Set up authenticator'}
              onPress={() => void enroll()}
              loading={loading}
            />
          </>
        ) : (
          <>
            <SectionTitle
              title={factor.verified ? 'Verify your authenticator' : 'Enroll an authenticator'}
            />
            {!factor.verified ? (
              <Text style={uiStyles.body}>
                Scan the QR code, or enter the setup key manually. Keep the key private. Then enter
                the current six-digit code.
              </Text>
            ) : null}
            {factor.qrCode ? (
              <Image
                accessibilityLabel="Authenticator enrollment QR code"
                resizeMode="contain"
                source={{ uri: factor.qrCode }}
                style={styles.qr}
              />
            ) : null}
            {factor.secret ? (
              <Text accessibilityLabel="Authenticator setup key" selectable style={styles.secret}>
                {factor.secret}
              </Text>
            ) : null}
            <View style={styles.field}>
              <Text style={uiStyles.label}>Six-digit code</Text>
              <TextInput
                accessibilityLabel="Authenticator verification code"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChangeText={(value) => setCode(value.replace(/\D/gu, ''))}
                placeholder="000000"
                placeholderTextColor={colors.muted}
                style={uiStyles.input}
                value={code}
              />
            </View>
            <ActionButton
              label={hasAdminRole ? 'Verify and open admin panel' : 'Verify authenticator'}
              disabled={!/^\d{6}$/u.test(code)}
              loading={loading}
              onPress={() => void verify()}
            />
          </>
        )}
        {message ? (
          <Text accessibilityRole="alert" style={styles.message}>
            {message}
          </Text>
        ) : null}
        <ActionButton label="Back to account" href="/account" variant="ghost" />
      </Card>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 15 },
  qr: { width: 220, height: 220, alignSelf: 'center', backgroundColor: '#FFFFFF' },
  secret: {
    color: colors.text,
    backgroundColor: colors.canvasSoft,
    padding: 12,
    borderRadius: 8,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  field: { gap: 7 },
  message: { color: colors.brand, fontSize: 12, lineHeight: 18 },
});

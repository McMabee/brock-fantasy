import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, uiStyles } from '@/components/ui';
import { supabase } from '@/lib/supabase';
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
  factor: { id: string; verified: boolean } | null;
}

export default function MfaScreen() {
  useRequireUser();
  const router = useRouter();
  const { user } = useSession();
  const [factor, setFactor] = useState<FactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (Platform.OS === 'web') {
      const loadWeb = async () => {
        const status = await webRequest<WebMfaStatus>('/api/admin/mfa');
        if (status.error || !status.data) {
          setMessage(status.error ?? 'Authenticator status is unavailable.');
          setLoading(false);
          return;
        }
        if (status.data.aal === 'aal2') {
          router.replace('/admin');
          return;
        }
        if (status.data.factor) {
          setFactor({ ...status.data.factor, qrCode: null, secret: null });
          setLoading(false);
          return;
        }
        const enrollment = await webRequest<{ factor: FactorSetup }>('/api/admin/mfa', {
          method: 'POST',
          body: { action: 'enroll' },
        });
        if (enrollment.error || !enrollment.data?.factor) {
          setMessage(enrollment.error ?? 'Authenticator enrollment could not be started.');
        } else {
          setFactor(enrollment.data.factor);
        }
        setLoading(false);
      };
      void loadWeb();
      return;
    }
    if (!supabase) return;
    const client = supabase;
    const load = async () => {
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) {
        setMessage(assurance.error.message);
        setLoading(false);
        return;
      }
      if (assurance.data.currentLevel === 'aal2') {
        router.replace('/admin');
        return;
      }
      const factors = await client.auth.mfa.listFactors();
      if (factors.error) {
        setMessage(factors.error.message);
        setLoading(false);
        return;
      }
      const verified = factors.data.totp.find((item) => item.status === 'verified');
      if (verified) {
        setFactor({ id: verified.id, qrCode: null, secret: null, verified: true });
        setLoading(false);
        return;
      }
      const enrollment = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Brock Fantasy administrator',
      });
      if (enrollment.error) setMessage(enrollment.error.message);
      else
        setFactor({
          id: enrollment.data.id,
          qrCode: enrollment.data.totp.qr_code,
          secret: enrollment.data.totp.secret,
          verified: false,
        });
      setLoading(false);
    };
    void load();
  }, [router, user]);

  const verify = async () => {
    if (!factor || code.trim().length !== 6) {
      setMessage('Enter the six-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setMessage(null);
    if (Platform.OS === 'web') {
      const result = await webRequest<unknown>('/api/admin/mfa', {
        method: 'POST',
        body: { action: 'verify', factorId: factor.id, code: code.trim() },
      });
      if (result.error) {
        setMessage(result.error);
        setLoading(false);
        return;
      }
      router.replace('/admin');
      return;
    }
    if (!supabase) return;
    const result = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: code.trim(),
    });
    if (result.error) {
      setMessage(result.error.message);
      setLoading(false);
      return;
    }
    await supabase.auth.refreshSession();
    router.replace('/admin');
  };

  return (
    <AppShell eyebrow="Administrator security" title="Multi-factor authentication">
      <Card style={styles.card}>
        <Pill label="AAL2 REQUIRED" tone="warning" />
        <Text style={uiStyles.body}>
          Administrator data and commands remain locked until this session is verified with a TOTP
          authenticator. Standard league access does not require this extra step.
        </Text>
        {factor && !factor.verified ? (
          <>
            <SectionTitle title="Enroll an authenticator" />
            <Text style={uiStyles.body}>
              Scan the QR code with an authenticator app, or enter the secret manually. Then enter
              the current six-digit code below.
            </Text>
            {factor.qrCode ? (
              <Image
                accessibilityLabel="Authenticator enrollment QR code"
                resizeMode="contain"
                source={{ uri: factor.qrCode }}
                style={styles.qr}
              />
            ) : null}
            {factor.secret ? (
              <Text accessibilityLabel="Authenticator secret" selectable style={styles.secret}>
                {factor.secret}
              </Text>
            ) : null}
          </>
        ) : (
          <SectionTitle title="Verify your enrolled authenticator" />
        )}
        <View style={styles.field}>
          <Text style={uiStyles.label}>Six-digit code</Text>
          <TextInput
            accessibilityLabel="Authenticator verification code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            onChangeText={setCode}
            placeholder="000000"
            placeholderTextColor={colors.muted}
            style={uiStyles.input}
            value={code}
          />
        </View>
        <ActionButton
          label="Verify and open operations"
          disabled={!factor || code.length !== 6}
          loading={loading}
          onPress={() => void verify()}
        />
        {message ? (
          <Text accessibilityRole="alert" style={styles.message}>
            {message}
          </Text>
        ) : null}
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
  message: { color: colors.danger, fontSize: 12, lineHeight: 18 },
});

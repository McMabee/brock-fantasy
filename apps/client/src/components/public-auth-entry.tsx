import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { ActionButton, AppShell, LoadingState } from '@/components/ui';
import { authReturnPath } from '@/lib/admin-navigation';

export function PublicAuthEntry({
  mode,
  next,
}: {
  mode: 'sign-in' | 'sign-up';
  next?: string | undefined;
}) {
  const query = new URLSearchParams({ view: mode === 'sign-up' ? 'activate' : 'sign-in' });
  if (next) query.set('next', authReturnPath(next));
  const entry = `/api/auth/entry?${query.toString()}`;
  const open = () => {
    if (Platform.OS === 'web') window.location.replace(entry);
    else
      void Linking.openURL(
        `${process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'https://play.brockfantasy.ca'}/auth?mode=${mode}`,
      );
  };
  useEffect(() => {
    if (Platform.OS === 'web') window.location.replace(entry);
  }, [entry]);
  return (
    <AppShell>
      <LoadingState label="Opening your account page" rows={1} />
      <ActionButton label={mode === 'sign-up' ? 'Create an account' : 'Sign in'} onPress={open} />
    </AppShell>
  );
}

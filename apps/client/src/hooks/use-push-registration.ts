import Constants from 'expo-constants';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export function usePushRegistration() {
  const { user, demoMode } = useSession();

  useEffect(() => {
    if (Platform.OS === 'web' || !user || demoMode || !supabase) return;
    const client = supabase;
    const register = async () => {
      const Notifications = await import('expo-notifications');
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('fantasy-updates', {
          name: 'Fantasy updates',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const existing = await Notifications.getPermissionsAsync();
      const permission =
        existing.status === Notifications.PermissionStatus.GRANTED
          ? existing
          : await Notifications.requestPermissionsAsync();
      if (permission.status !== Notifications.PermissionStatus.GRANTED) return;
      const extra: unknown = Constants.expoConfig?.extra;
      const eas = isRecord(extra) ? extra.eas : undefined;
      const projectId =
        isRecord(eas) && typeof eas.projectId === 'string' ? eas.projectId : undefined;
      if (!projectId || projectId.startsWith('REPLACE_')) return;
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      await client.rpc('register_push_token', {
        p_expo_push_token: token.data,
        p_platform: Platform.OS,
      });
    };
    void register().catch(() => {
      // Permission denial and simulator limitations are non-fatal. Delivery
      // failures are surfaced by the server-side notification workflow.
    });
  }, [demoMode, user]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { notificationHref } from '@/lib/notification-route';
import { useSession } from '@/providers/session-provider';

export function usePushRegistration() {
  const { user, demoMode } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === 'web' || !user || demoMode || !supabase) return;
    const client = supabase;
    let active = true;
    let responseSubscription: { remove: () => void } | undefined;
    const setup = async () => {
      const Notifications = await import('expo-notifications');
      if (!active) return;
      Notifications.setNotificationHandler({
        handleNotification: () =>
          Promise.resolve({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
      });

      const openNotification = (data: unknown) => {
        const href = notificationHref(data);
        if (!href || !active) return false;
        router.push(href);
        return true;
      };
      responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
        if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
        openNotification(response.notification.request.content.data);
      });
      const lastResponse = Notifications.getLastNotificationResponse();
      if (
        lastResponse?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER &&
        openNotification(lastResponse.notification.request.content.data)
      ) {
        Notifications.clearLastNotificationResponse();
      }

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
    void setup().catch(() => {
      // Permission denial and simulator limitations are non-fatal. Delivery
      // failures are surfaced by the server-side notification workflow.
    });
    return () => {
      active = false;
      responseSubscription?.remove();
    };
  }, [demoMode, router, user]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

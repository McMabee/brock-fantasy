import type { ReactNode } from 'react';
import { NotificationsContext, useNotificationStore } from '@/hooks/use-notifications';

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotificationStore();
  return <NotificationsContext value={value}>{children}</NotificationsContext>;
}

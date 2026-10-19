import type { ReactNode } from 'react';
import { ActionFeedbackProvider } from './action-feedback-provider';
import { NotificationsContext, useNotificationStore } from '@/hooks/use-notifications';

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotificationStore();
  return (
    <NotificationsContext value={value}>
      <ActionFeedbackProvider>{children}</ActionFeedbackProvider>
    </NotificationsContext>
  );
}

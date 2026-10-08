import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { webRequest } from '@/lib/web-request';

export async function inviteAdministrator(email: string, reason: string, idempotencyKey: string) {
  const body = { email, reason, idempotencyKey };
  if (Platform.OS === 'web')
    return webRequest<{ sent: boolean }>('/api/admin/accounts', { method: 'POST', body });
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    const origin = process.env.EXPO_PUBLIC_APP_ORIGIN;
    if (!token || !origin)
      return { data: null, error: 'Administrator invitations are not configured.' };
    const response = await fetch(new URL('/api/admin/accounts', origin).toString(), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { sent?: boolean; error?: string };
    return response.ok && data.sent
      ? { data, error: null }
      : { data: null, error: data.error ?? 'Invitation could not be sent.' };
  } catch {
    return {
      data: null,
      error: 'Unable to send the invitation. Retry to send the same invitation.',
    };
  }
}

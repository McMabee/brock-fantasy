import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { webRequest } from '@/lib/web-request';

export async function betaCommand<T>(
  command: string,
  payload: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  if (Platform.OS === 'web') {
    return webRequest<T>(`/api/command/${command}`, { method: 'POST', body: payload });
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured.' };
  const result = await supabase.rpc(command, payload);
  return { data: (result.data as T | null) ?? null, error: result.error?.message ?? null };
}

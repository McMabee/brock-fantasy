import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'local';
export const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
export const isDemoMode = !url || !anonKey;

if (appEnvironment === 'production') {
  if (isDemoMode) {
    throw new Error(
      'Production requires EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  if (!supportEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(supportEmail)) {
    throw new Error('Production requires a valid EXPO_PUBLIC_SUPPORT_EMAIL.');
  }
}

const webStorage = {
  getItem: (key: string) => Promise.resolve(globalThis.localStorage?.getItem(key) ?? null),
  setItem: (key: string, value: string) => {
    globalThis.localStorage?.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    globalThis.localStorage?.removeItem(key);
    return Promise.resolve();
  },
};

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: Platform.OS === 'web',
        },
      })
    : null;

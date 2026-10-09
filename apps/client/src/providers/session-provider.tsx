import type { User } from '@supabase/supabase-js';
import { ELIGIBILITY_POLICY_VERSION, registrationYearAt } from '@brock-fantasy/domain';
import * as Linking from 'expo-linking';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { ensureCsrfToken, webAuth, type WebSessionUser } from '@/lib/web-auth';

interface SessionContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
    eligibilityAttested: boolean,
  ) => Promise<string | null>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'web') {
      void (async () => {
        try {
          await ensureCsrfToken();
          const result = await webAuth<{ user: WebSessionUser | null }>('session', {
            method: 'GET',
            csrf: false,
          });
          setUser(result.data?.user ? asSupabaseUser(result.data.user) : null);
        } finally {
          setLoading(false);
        }
      })();
      return;
    }
    if (!supabase) {
      setLoading(false);
      return;
    }
    const client = supabase;
    let active = true;
    let revision = 0;
    const restore = async (candidate: User | null) => {
      const current = ++revision;
      if (active) setLoading(true);
      let approved = false;
      try {
        if (candidate) {
          const access = await client.rpc('can_use_app');
          approved = !access.error && access.data === true;
        }
      } catch {
        approved = false;
      } finally {
        if (active && current === revision) {
          setUser(approved ? candidate : null);
          setLoading(false);
        }
      }
    };
    void client.auth
      .getSession()
      .then(({ data }) => restore(data.session?.user ?? null))
      .catch(() => restore(null));
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      // Defer network calls until Supabase releases the authentication callback lock.
      setTimeout(() => {
        if (active) void restore(nextSession?.user ?? null);
      }, 0);
    });
    return () => {
      active = false;
      revision++;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (Platform.OS === 'web') {
      await ensureCsrfToken();
      const result = await webAuth<{ user: WebSessionUser }>('sign-in', {
        body: { email, password },
        csrf: false,
      });
      if (result.data?.user) setUser(asSupabaseUser(result.data.user));
      return result.error;
    }
    if (!supabase) return 'Authentication is not configured for this environment.';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    const access = await supabase.rpc('can_use_app');
    if (access.error || access.data !== true) {
      await supabase.auth.signOut({ scope: 'local' });
      setUser(null);
      return 'Approved beta tester access is required.';
    }
    return null;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string, eligibilityAttested: boolean) => {
      if (!eligibilityAttested) return 'Confirm that you are 18 or turn 18 this calendar year.';
      if (Platform.OS === 'web') {
        await ensureCsrfToken();
        return (
          await webAuth('sign-up', {
            body: { email, password, displayName, eligibilityAttested },
            csrf: false,
          })
        ).error;
      }
      if (!supabase) return 'Account registration is not configured for this environment.';
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
            beta_age_eligible: true,
            beta_eligibility_year: registrationYearAt(),
            beta_eligibility_policy_version: ELIGIBILITY_POLICY_VERSION,
          },
        },
      });
      return error?.message ?? null;
    },
    [],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    if (Platform.OS === 'web') {
      await ensureCsrfToken();
      return (await webAuth('recover', { body: { email }, csrf: false })).error;
    }
    if (!supabase) return 'Password recovery is not configured for this environment.';
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: Linking.createURL('/reset-password'),
    });
    return error?.message ?? null;
  }, []);

  const signOut = useCallback(async () => {
    if (Platform.OS === 'web') {
      await webAuth('sign-out');
      setUser(null);
      return;
    }
    if (supabase) await supabase.auth.signOut();
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (Platform.OS === 'web')
      return (await webAuth('update-password', { body: { password } })).error;
    if (!supabase) return 'Password updates are not configured for this environment.';
    const { error } = await supabase.auth.updateUser({ password });
    return error?.message ?? null;
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      loading,
      signIn,
      signUp,
      requestPasswordReset,
      updatePassword,
      signOut,
    }),
    [loading, requestPasswordReset, signIn, signOut, signUp, updatePassword, user],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

function asSupabaseUser(user: WebSessionUser): User {
  return { id: user.id, email: user.email ?? undefined } as User;
}

export function useSession(): SessionContextValue {
  const context = use(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider.');
  return context;
}

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
import { onSessionRenewed, refreshWebSession, sessionNeedsRenewal } from '@/lib/web-session';

interface SessionContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: (
    email: string,
    password: string,
    eligibilityAttested?: boolean,
  ) => Promise<string | null>;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      let active = true;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const restore = async () => {
        try {
          await ensureCsrfToken();
          const result = await webAuth<{ user: WebSessionUser | null }>('session', {
            method: 'GET',
            csrf: false,
          });
          if (!active) return;
          if (result.status && result.status >= 500) {
            setError('Connection unavailable. Retrying…');
            retry = setTimeout(() => void restore(), 5000);
            return;
          }
          setError(null);
          setUser(result.data?.user ? asSupabaseUser(result.data.user) : null);
          setLoading(false);
        } catch {
          if (active) {
            setError('Connection unavailable. Retrying…');
            retry = setTimeout(() => void restore(), 5000);
          }
        }
      };
      void restore();
      const unsubscribe = onSessionRenewed((result) => {
        if (!active) return;
        if (result.data) {
          setUser(asSupabaseUser(result.data.user));
          setError(null);
        } else if ([401, 403].includes(result.status)) {
          setUser(null);
          setLoading(false);
        } else setError(result.error);
      });
      const timer = setInterval(() => {
        if (sessionNeedsRenewal()) void refreshWebSession();
      }, 30_000);
      return () => {
        active = false;
        if (retry) clearTimeout(retry);
        clearInterval(timer);
        unsubscribe();
      };
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

  const signIn = useCallback(
    async (email: string, password: string, eligibilityAttested = false) => {
      if (Platform.OS === 'web') {
        await ensureCsrfToken();
        const result = await webAuth<{ user: WebSessionUser }>('sign-in', {
          body: { email, password, eligibilityAttested },
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
        return 'A verified, eligible account is required.';
      }
      return null;
    },
    [],
  );

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
      const { error, data } = await supabase.auth.signUp({
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
      if (data.session) await supabase.auth.signOut({ scope: 'local' });
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
      error,
      signIn,
      signUp,
      requestPasswordReset,
      updatePassword,
      signOut,
    }),
    [error, loading, requestPasswordReset, signIn, signOut, signUp, updatePassword, user],
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

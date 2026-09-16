import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export function useRequireUser() {
  const router = useRouter();
  const { user, loading, demoMode } = useSession();
  useEffect(() => {
    if (!loading && !demoMode && !user) router.replace('/auth');
  }, [demoMode, loading, router, user]);
  return { allowed: demoMode || Boolean(user), loading };
}

export function useRequireAdmin() {
  const router = useRouter();
  const { user, loading, demoMode } = useSession();
  const [authorized, setAuthorized] = useState(demoMode);
  useEffect(() => {
    if (loading) return;
    if (demoMode) {
      setAuthorized(true);
      return;
    }
    if (!user || !supabase) {
      router.replace('/auth');
      return;
    }
    void supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) {
          router.replace('/dashboard');
          return;
        }
        const assurance = await supabase?.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assurance?.data?.currentLevel === 'aal2') setAuthorized(true);
        else router.replace('/mfa');
      });
  }, [demoMode, loading, router, user]);
  return { allowed: authorized, loading };
}

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useSession } from '@/providers/session-provider';
import { supabase } from '@/lib/supabase';
import { webRequest } from '@/lib/web-request';

export function useAdminRole() {
  const { user, readScope } = useSession();
  const [state, setState] = useState<{ scope: typeof readScope; allowed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    if (!user) return;
    const check = async () => {
      const allowed =
        Platform.OS === 'web'
          ? (await webRequest<{ hasAdminRole: boolean }>('/api/admin/status')).data
              ?.hasAdminRole === true
          : !!(
              await supabase
                ?.from('user_roles')
                .select('role')
                .eq('user_id', user.id)
                .eq('role', 'admin')
                .maybeSingle()
            )?.data;
      if (active) setState({ scope: readScope, allowed });
    };
    void check().catch(() => {
      if (active) setState({ scope: readScope, allowed: false });
    });
    return () => {
      active = false;
    };
  }, [user?.id, readScope]);
  return !!user && state?.scope === readScope && state.allowed;
}

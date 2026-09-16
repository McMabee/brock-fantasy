import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
  }
}

export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('Supabase server configuration is missing.');
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

export async function authenticatedUser(authorization: string | null) {
  if (!authorization) throw new AccessError('Authentication required.', 401);
  const client = serviceClient();
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new AccessError('Authentication required.', 401);
  return data.user;
}

export async function authenticatedAdmin(authorization: string | null) {
  const user = await authenticatedUser(authorization);
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const client = serviceClient();
  const [{ data: assurance, error: assuranceError }, { data: role, error: roleError }] =
    await Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(token),
      client
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle(),
    ]);
  if (roleError) throw roleError;
  if (!role) throw new AccessError('Administrator access required.', 403);
  if (assuranceError || assurance.currentLevel !== 'aal2') {
    throw new AccessError('Administrator multi-factor authentication required.', 403);
  }
  return user;
}

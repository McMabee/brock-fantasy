import { AccessError, authenticatedUser, serviceClient } from '../_shared/clients.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (request) => {
  const headers = corsHeaders(request.headers.get('origin'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST')
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  try {
    const user = await authenticatedUser(request.headers.get('authorization'));
    const db = serviceClient();
    const { error } = await db.rpc('erase_account', { p_user_id: user.id });
    if (error) throw error;
    return new Response(null, { status: 204, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account deletion failed';
    return Response.json(
      { error: message },
      { status: error instanceof AccessError ? error.status : 400, headers },
    );
  }
});

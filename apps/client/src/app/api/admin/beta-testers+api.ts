import type { RequestHandler } from 'expo-router/server';
import { actor, json, mutationError, readObject, text } from '../../../server/session';
import { adminRpc } from '../../../server/admin-invitations';
async function handle(request: Request, write: boolean): Promise<Response> {
  try {
    if (write) {
      const error = mutationError(request);
      if (error) return json({ error }, 403);
    }
    const current = await actor(request);
    if (!current || current.aal !== 'aal2')
      return json({ error: 'Protected operator MFA access is required.' }, 403);
    let input: Record<string, unknown> = {};
    if (write) {
      const body = readObject(await request.json());
      const email = text(body?.email, 320)?.trim();
      const reason = text(body?.reason, 500)?.trim();
      if (!email || !reason || reason.length < 8 || typeof body?.enabled !== 'boolean')
        return json({ error: 'Email, approval action, and an audit reason are required.' }, 400);
      input = { p_email: email, p_enabled: body.enabled, p_reason: reason };
    }
    const response = await adminRpc(current, 'admin_beta_testers', input);
    if (!response.ok)
      return json(
        {
          error:
            response.status === 403
              ? 'Only Ty Mabee can manage tester approvals.'
              : 'Tester approval could not be completed.',
        },
        response.status === 403 ? 403 : 400,
      );
    return json(await response.json());
  } catch {
    return json({ error: 'Tester management is temporarily unavailable.' }, 503);
  }
}
export const GET: RequestHandler = (request) => handle(request, false);
export const POST: RequestHandler = (request) => handle(request, true);

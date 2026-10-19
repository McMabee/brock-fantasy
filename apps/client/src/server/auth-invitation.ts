import { authReturnPath } from '../lib/admin-navigation';

export function invitationReturnPath(request: Request): string {
  const query = new URL(request.url).searchParams;
  const explicit = query.get('returnTo') ?? query.get('next');
  if (explicit) return authReturnPath(explicit);
  const value = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('bf_auth_next='));
  try {
    return value ? authReturnPath(decodeURIComponent(value.slice('bf_auth_next='.length))) : '';
  } catch {
    return '';
  }
}
export function invitationCookie(path: string): string | null {
  const safe = authReturnPath(path);
  if (!safe.startsWith('/leagues/join?code=')) return null;
  return `bf_auth_next=${encodeURIComponent(safe)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

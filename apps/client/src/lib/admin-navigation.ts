export const adminRoutes = ['/admin', '/admin/games', '/admin/import', '/admin/accounts'] as const;

export function adminReturnPath(value: unknown): (typeof adminRoutes)[number] {
  return adminRoutes.find((route) => route === value) ?? '/admin';
}

export function authReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/dashboard';
  if (
    [
      '/dashboard',
      '/players',
      '/account',
      '/notifications',
      '/leagues/new',
      '/leagues/join',
      ...adminRoutes,
    ].includes(value)
  )
    return value;
  if (
    /^\/(?:draft|league|commissioner|lineup-beta|lineup-multisport|lineup|transactions|players)\/[0-9a-f-]{36}$/iu.test(
      value,
    )
  )
    return value;
  if (typeof value === 'string' && /^\/mfa\?invitation=[0-9a-f-]{36}$/iu.test(value)) return value;
  return '/dashboard';
}

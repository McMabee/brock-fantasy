export const adminRoutes = ['/admin', '/admin/games', '/admin/import', '/admin/accounts'] as const;

export function adminReturnPath(value: unknown): (typeof adminRoutes)[number] {
  return adminRoutes.find((route) => route === value) ?? '/admin';
}

export function authReturnPath(value: unknown): string {
  if (typeof value === 'string' && /^\/mfa\?invitation=[0-9a-f-]{36}$/iu.test(value)) return value;
  return adminReturnPath(value);
}

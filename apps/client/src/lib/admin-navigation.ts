export const adminRoutes = ['/admin', '/admin/games', '/admin/import', '/admin/accounts'] as const;

export function adminReturnPath(value: unknown): (typeof adminRoutes)[number] {
  return adminRoutes.find((route) => route === value) ?? '/admin';
}

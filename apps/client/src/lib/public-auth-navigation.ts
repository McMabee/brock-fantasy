export function openPublicAuthEntry(href: unknown): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.location?.assign !== 'function' ||
    typeof href !== 'string' ||
    !/^\/(?:auth|signup|forgot-password|reset-password)(?:\?|$)/u.test(href)
  )
    return false;
  // - Load the server form so account entry keeps its HttpOnly cookie and CSRF flow
  window.location.assign(href);
  return true;
}

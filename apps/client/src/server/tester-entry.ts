const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export type TesterView = 'sign-in' | 'activate' | 'recover' | 'reset';
export function testerPage(
  view: TesterView,
  message = '',
  status = 200,
  cookies: string[] = [],
  csrf = '',
  returnTo = '',
): Response {
  const heading = {
    'sign-in': 'Administrator Sign In',
    activate: 'Create Your Account',
    recover: 'Reset Your Password',
    reset: 'Choose a New Password',
  }[view];
  const action =
    { 'sign-in': 'sign-in', activate: 'sign-up', recover: 'recover', reset: 'update-password' }[
      view
    ] + (returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${heading} | Brock Fantasy</title>
<link rel="stylesheet" href="/beta-auth/entry.css"></head><body>
<header><a href="https://www.brockfantasy.ca">BROCK FANTASY</a><span>PRIVATE BETA</span></header>
<main><p class="eyebrow">Brock Multi-Sport Fantasy</p><h1>${heading}</h1>
<p>${view === 'activate' ? 'Register for Brock Sports Fantasy. The fantasy app is currently available to administrators only. Creating an account does not grant beta access.' : 'Application sign-in is currently available to administrators only.'}</p>
${message ? `<p role="status" class="notice">${escape(message)}</p>` : ''}
<form method="post" action="/api/auth/${action}"><input type="hidden" name="csrf" value="${escape(csrf)}">
${view !== 'reset' ? '<label>Email<input name="email" type="email" autocomplete="email" maxlength="320" required></label>' : ''}
${view === 'activate' ? '<label>Display name<input name="displayName" maxlength="80" autocomplete="nickname" required></label><label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>' : ''}
${view !== 'recover' ? `<label>Password<input name="password" type="password" minlength="8" maxlength="512" autocomplete="${view === 'sign-in' ? 'current-password' : 'new-password'}" required></label>` : ''}
${view === 'activate' ? '<label class="check"><input type="checkbox" name="eligibilityAttested" value="true" required>I am 18 or turn 18 this calendar year.</label><p>Read the application <a href="/policies/terms-of-use.html">terms</a> and <a href="/policies/privacy-notice.html">privacy notice</a> before activation. These policy drafts remain pending operator approval.</p>' : ''}
<button type="submit">${view === 'sign-in' ? 'Sign In' : view === 'activate' ? 'Create Account' : view === 'recover' ? 'Send Reset Instructions' : 'Save Password'}</button></form>
<nav>${view === 'sign-in' ? '<a href="/forgot-password">Forgot password?</a>' : ''}<a href="${view === 'activate' ? '/auth' : '/signup'}">${view === 'activate' ? 'Administrator sign-in' : 'Create an account'}</a><a href="https://www.brockfantasy.ca">Return to Landing Page</a></nav></main></body></html>`;
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, private',
    vary: 'Cookie',
    'referrer-policy': 'strict-origin',
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  cookies.forEach((value) => headers.append('set-cookie', value));
  return new Response(html, { status, headers });
}

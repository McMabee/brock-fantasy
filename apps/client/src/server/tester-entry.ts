import { ASSOCIATION_INSTAGRAM_URL } from '../lib/association';

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
  theme: 'light' | 'dark' = 'dark',
): Response {
  const heading = {
    'sign-in': 'Sign In',
    activate: 'Create Your Account',
    recover: 'Reset Your Password',
    reset: 'Choose a New Password',
  }[view];
  const action =
    { 'sign-in': 'sign-in', activate: 'sign-up', recover: 'recover', reset: 'update-password' }[
      view
    ] + (returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '');
  const html = `<!doctype html>
<html lang="en" data-brock-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${heading} | Brock Fantasy</title>
<link rel="stylesheet" href="/beta-auth/entry.css"></head><body>
<header><a class="auth-brand" href="https://www.brockfantasy.ca"><img src="/ui/logo-${theme}.png" width="38" height="44" alt="">BROCK FANTASY</a><span>2026–27 SEASON</span></header>
<div class="auth-layout"><aside class="auth-intro"><p class="eyebrow">SIX PROGRAMS. ONE COMPETITION.</p><h2>Your season.<br>Your team.</h2><p>Draft Brock athletes. Build your lineup. Follow every point with your league.</p><div class="auth-sports"><span>HOCKEY</span><span>BASKETBALL</span><span>VOLLEYBALL</span></div></aside>
<main>${view === 'activate' || view === 'sign-in' ? `<nav class="auth-tabs" aria-label="Account access"><a href="/auth?mode=sign-in${returnTo ? `&amp;next=${encodeURIComponent(returnTo)}` : ''}"${view === 'sign-in' ? ' aria-current="page"' : ''}>Sign in</a><a href="/auth?mode=sign-up${returnTo ? `&amp;next=${encodeURIComponent(returnTo)}` : ''}"${view === 'activate' ? ' aria-current="page"' : ''}>Create an account</a></nav>` : ''}<p class="eyebrow">Brock Multi-Sport Fantasy</p><h1>${heading}</h1>
<p>${view === 'activate' ? 'Register for Brock Sports Fantasy, verify your email, and join your league.' : 'Sign in to join your leagues and manage your teams.'}</p>
${message ? `<p role="status" class="notice">${escape(message)}</p>` : ''}
<form method="post" action="/api/auth/${action}"><input type="hidden" name="csrf" value="${escape(csrf)}">
${view !== 'reset' ? '<label>Email<input name="email" type="email" autocomplete="email" maxlength="320" required></label>' : ''}
${view === 'activate' ? '<label>Display name<input name="displayName" maxlength="80" autocomplete="nickname" required></label><label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>' : ''}
${view !== 'recover' ? `<label>Password<input name="password" type="password" minlength="8" maxlength="512" autocomplete="${view === 'sign-in' ? 'current-password' : 'new-password'}" required></label>` : ''}
${view === 'activate' || view === 'sign-in' || view === 'reset' ? `<label class="check"><input type="checkbox" name="eligibilityAttested" value="true" ${view === 'activate' ? 'required' : ''}>I am 18 or turn 18 this calendar year.</label>${view !== 'activate' ? '<p>Existing accounts only need this confirmation if eligibility has not been recorded yet.</p>' : ''}` : ''}
${view === 'activate' ? '<p>Read the application <a href="/policies/terms-of-use.html">terms</a> and <a href="/policies/privacy-notice.html">privacy notice</a> before activation. These policy drafts remain pending operator approval.</p>' : ''}
<button type="submit">${view === 'sign-in' ? 'Sign In' : view === 'activate' ? 'Create Account' : view === 'recover' ? 'Send Reset Instructions' : 'Save Password'}</button></form>
<nav>${view === 'sign-in' ? '<a href="/forgot-password">Forgot password?</a>' : ''}${view === 'recover' || view === 'reset' ? '<a href="/auth?mode=sign-in">Sign in</a>' : ''}<a href="/feedback">Report Bugs/Suggestions</a><a href="https://www.brockfantasy.ca">Return to Landing Page</a><a href="${ASSOCIATION_INSTAGRAM_URL}" target="_blank" rel="noopener noreferrer" aria-label="Brock Fantasy Association on Instagram: @therealbrockfantasy">Association Instagram</a></nav></main></div></body></html>`;
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, private',
    vary: 'Cookie',
    'referrer-policy': 'strict-origin',
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  cookies.forEach((value) => headers.append('set-cookie', value));
  return new Response(html, { status, headers });
}

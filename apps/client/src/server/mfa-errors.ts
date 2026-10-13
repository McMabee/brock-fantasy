const messages = {
  mfa_verification_failed:
    'This code does not match your authenticator setup. Use the newest six-digit code from the Brock Fantasy entry and check that your phone uses automatic date and time. If you restarted setup, use the entry made with the latest setup key.',
  mfa_challenge_expired:
    'This verification request expired. Enter a new authenticator code and try again.',
  mfa_factor_not_found:
    'This authenticator setup is no longer current. Reload this page to continue with the current setup.',
  mfa_ip_address_mismatch:
    'Authenticator verification could not finish because the service detected a different connection. Try again. If this repeats, contact Ty.',
  mfa_verification_rejected:
    'Authenticator verification was declined. Contact Ty before trying again.',
  mfa_totp_verify_not_enabled:
    'Authenticator verification is unavailable. Contact Ty to check the service configuration.',
  over_request_rate_limit:
    'Too many verification attempts. Wait a moment, then enter a new authenticator code.',
} as const;

export function mfaFailure(
  payload: unknown,
  status: number,
  flow: 'staff_invitation' | 'admin',
  phase: 'challenge' | 'verify',
): string {
  const row =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const candidate = typeof row?.error_code === 'string' ? row.error_code : row?.code;
  const code =
    typeof candidate === 'string' && Object.hasOwn(messages, candidate)
      ? (candidate as keyof typeof messages)
      : 'unknown';
  // Never log submitted codes, factor IDs, tokens, setup keys or provider bodies.
  console.warn(
    JSON.stringify({
      event: 'brock_mfa_failed',
      flow,
      phase,
      httpStatus: status,
      providerCode: code,
    }),
  );
  return code === 'unknown'
    ? 'Authenticator verification could not be completed. Enter a new code and try again. If this repeats, contact Ty.'
    : messages[code];
}

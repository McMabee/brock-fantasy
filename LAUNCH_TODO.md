# Public launch follow-up

- [x] Verify main's public entry links open the production sign-in/sign-up page with the requested option selected
- [x] Verify `/signup` from a direct visit and from in-app navigation
- [x] Remove public beta labels and staging entry links from the main websites
- [x] Add footer access to the bug/suggestion form and verify both report types are included in FormSubmit posts to `tymabee@proton.me`
- [x] Use the recipient identifier supplied by FormSubmit in the action URL and remove the raw email from the report form
- [x] Restore the association's account-confirmation receipt handler and compiled Node runtime on main
- [ ] Verify the deployed Production authentication endpoint after the owner adds `SUPABASE_SECRET_KEY` and `AUTH_RATE_LIMIT_HMAC_SECRET` privately in Vercel and redeploys
- [ ] Verify a real new-account signup, email verification and association confirmation after both main branches deploy
- [ ] Confirm the FormSubmit destination is activated and a real owner-approved report reaches the inbox

The production sign-in endpoint returned HTTP 503 on October 15, 2026, including for an empty request with no account credentials. The connected Vercel account cannot inspect this project's runtime configuration because team access returns HTTP 403. The owner is adding the two Production secrets and redeploying. Do not record their values in this checklist.

Browser feedback checks intercept FormSubmit requests and do not send real emails. Local form and auth tests do not establish hosted email delivery or a successful real-account sign-in.

Local validation passed: clean-checkout production export without private inputs, 74 script tests, auth/admin boundary regressions, dark/light public-entry and feedback browser checks, feedback accessibility, the 96-screenshot application interaction suite, typechecking, linting, formatting and Android/iOS exports. Association validation is recorded in that repository's launch checklist.

See [LAUNCH_CONFIGURATION.md](LAUNCH_CONFIGURATION.md) for exact private environment variable setup. Internal staging identifiers, historical migrations and compatibility routes remain available for existing links and deployment tooling.

# AstraCore UI and login security review

Date: 2026-11-06

## Scope

Reviewed the browser workspace and authentication flow in:

- \`web/index.html\`
- \`web/app.js\`
- \`web/auth.js\`
- \`web/styles.css\`
- \`server/auth.js\`
- \`vercel.json\`

This is a source review plus regression-test addition. It is not a penetration test or a live production-browser certification.

## Findings and fixes in this change

| Severity | Finding | Change |
|---|---|---|
| High | A duplicate consecutive \`catch\` in \`sendMessage()\` made \`web/app.js\` syntactically invalid, preventing the main chat module from loading. | Removed the duplicate handler and retained one error handler plus cleanup in \`finally\`. |
| Medium | CSP allowed inline JavaScript through \`script-src 'unsafe-inline'\`. | Removed the inline-script allowance. Inline styles remain permitted because the existing UI injects auth/admin styles at runtime. |
| Medium | Successful login/verification used \`location.reload()\`; when opened through \`/login\`, this retained the login path instead of returning to the chat home. | Successful authentication now navigates to \`/\`, where the same workspace opens in Chat. |
| Low | The login overlay referenced a logo path that did not match the actual asset path. | Corrected to \`/web/assets/astracore-logo.svg\`. |
| Low | Login dialog and form controls lacked programmatic accessible labels. | Added dialog labelling and accessible names for name, email, password, and verification code fields. |
| Low | Session MAC verification used ordinary string comparison and malformed cookie encoding could throw. | Added constant-time MAC comparison and safe malformed-cookie rejection. |
| Low | A 401 from chat left the user in the composer with no automatic way to reopen the login overlay. | Chat now emits an auth-required event and the existing overlay reappears. |

## Existing protections confirmed in source

- Session cookie is \`HttpOnly\`, \`SameSite=Lax\`, and marked \`Secure\` in production.
- Production requires \`ASTRA_SESSION_SECRET\`; no development fallback is used when \`VERCEL=1\` or \`NODE_ENV=production\`.
- CSP blocks framing and plugins using \`frame-ancestors 'none'\` and \`object-src 'none'\`.
- \`Permissions-Policy\` denies camera and microphone access. This change does not enable voice capture, listening, or automatic message sending.
- Authenticated chat and account APIs use the session cookie and server-side user checks.

## Remaining work before public launch

1. New session cookies use AES-256-GCM authenticated encryption and a seven-day session lifetime. Existing signed cookies are temporarily accepted only for their original browser-cookie window; users will receive encrypted cookies after re-authentication or token refresh. Plan a future key-rotation mechanism before rotating ASTRA_SESSION_SECRET.
2. Verify Supabase Auth email-confirmation settings, password policy, CAPTCHA/bot protection, and rate limits in the actual Supabase project.
3. Test password login, signup/OTP, logout/revocation, session refresh-cookie rotation, and OAuth in a real browser against the production deployment.
4. Verify admin authorization independently on every admin API route; frontend hiding is not an authorization boundary.
5. Complete mobile viewport, keyboard-only, screen-reader, and slow-network testing.
6. Review third-party dependencies and run a separate authenticated security test.

## Validation status

- Regression tests were added in \`tests/ui-security.test.js\`.
- CI includes syntax checks for \`web/app.js\` and \`web/auth.js\`.
- The available GitHub Actions run was still installing Python dependencies at the last inspection; no passing result is claimed.
- Vercel preview checks are blocked by the account build-rate limit, so the live deployment was not verified.
- No production secrets, accounts, user data, or deployment settings were changed.


## Follow-up session hardening

- New cookies use AES-256-GCM; authentication tags are verified before payload parsing.
- Session lifetime is bounded to seven days, independently from the shorter Supabase access-token expiry, allowing expired access tokens to reach the refresh path.
- Rotated Supabase refresh tokens are written back to the HttpOnly cookie on authenticated requests and `/api/auth/me`.
- Logout attempts Supabase token revocation and always clears the browser cookie, even if remote revocation is unavailable.
- Legacy signed cookies remain temporarily readable for compatibility until their browser Max-Age window ends; they are not encrypted and should disappear after reauthentication/expiry.

# OAuth failure and session revocation

## Google OAuth failure

1. Confirm API liveness/readiness. Existing sessions can remain usable during a
   Google outage; do not log users out merely because new sign-in fails.
2. Use coded logs and status only. Distinguish:
   - `OAUTH_STATE_MISMATCH`: stale/missing callback cookies or a callback-flow
     mismatch;
   - `INVALID_GOOGLE_IDENTITY` or `UNVERIFIED_GOOGLE_EMAIL`: provider identity
     validation failed;
   - provider/network failure: check Google’s status and egress without logging
     the OAuth code or token response;
   - `AUTH_RATE_LIMITED`: wait for the bounded rate-limit window.
3. Compare exact configured public callback URL, callback allowlist, web URL,
   proxy scheme/host forwarding, OAuth client registration, and clock. Never
   weaken state/nonce checks or broaden origins as a workaround.
4. Roll back a configuration/image regression. For a provider outage, keep the
   deterministic application available to existing sessions and communicate
   that new sign-in is impaired.

## Session revocation

- A user revokes the current session with `POST /auth/logout`.
- Account deletion revokes all access by deleting the owning account and its
  sessions.
- For a confirmed session compromise, use an approved database operational job
  to set that session’s `revokedAt`; identify it by a safe internal session ID,
  never by printing token hashes or cookies.
- Revoking every active session is a high-impact incident action. It requires
  incident-lead approval, a user communication plan, and a verified OAuth path
  before execution.

Verify revocation with an authenticated endpoint returning `AUTH_REQUIRED`,
then confirm unaffected sessions still work when the action was scoped. Record
counts and timestamps only.

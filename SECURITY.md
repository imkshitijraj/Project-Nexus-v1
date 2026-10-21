# Security model and release controls

The connected API implements a production-oriented security baseline. It has not undergone an independent penetration test, security certification, or production infrastructure review. The GitHub Pages demo is a personal browser-local application and does not provide organizational security.

## Implemented controls

- bcrypt password hashing with cost 12; no plaintext password persistence.
- A minimum of 12 characters and maximum of 72 UTF-8 bytes for passwords. The concise local-demo password follows the same policy; demo profile selection only prefills the form and never grants access.
- Signed HS256 JWTs with fixed algorithm, issuer, audience, expiry, subject, organization, and session-family checks.
- Refresh tokens in HttpOnly cookies, Secure in production, with one-use rotation and family revocation on replay. Issuance, replacement and revocation serialize on the account row, so concurrent refresh/replay/logout cannot leave a surviving replacement. The session family has an absolute seven-day deadline; refresh does not extend it. Logout, password reset, account changes, and deactivation invalidate the relevant sessions.
- Password reset and invitation tokens use 256 bits of cryptographic randomness, are hashed at rest, expire, and are consumed transactionally. Completing a reset invalidates every outstanding reset link for that account. Reissuing an invitation invalidates the earlier invitation for that email and organization.
- Database-backed current role/activation checks on every protected request. No trust in frontend role labels.
- Organization predicates on database queries and scoped project access for members and viewers. Cross-tenant references are rejected.
- Parameterized SQL, relational project/member constraints, shared record validation, bounded payloads, and safe enum/date/reference checks.
- Transactional changes under an organization lock, current role rechecks inside writes, consistent locked workspace reads, and revision conflicts instead of last-writer-wins overwrites.
- Immutable server-generated audit events with stable actor IDs, canonical task history, authenticated comment authors, and authorized notification recipients. Account role/activation changes enter the audit feed. Display-name changes cannot expose another actor's events; legacy events without an actor ID are restricted to administrators/managers.
- Explicit CORS allowlist, JSON-only mutations, auth/API rate limits, Helmet headers, CSP, no inline script execution, no third-party runtime scripts, and escaped user content.
- File allowlist, size/quota bounds, basic content-type verification, authorized attachment access, and download-only handling.
- Public asset allowlist: backend source, database files, `.env`, and dependency directories are never served by the API.
- Dependency lockfile, SHA-pinned GitHub Actions, least-privilege CI permissions, and an audit gate.
- Generic internal-error responses and structured error codes/request IDs in server logs; database exception details are not returned to clients.

## Regression evidence

The API test suite exercises tenant isolation, role permissions, malformed input, attachment checks, database foreign keys, stale workspace revisions, stable audit identity, stale-role writes, one-use invitations, obsolete invitation invalidation, reset-link invalidation, concurrent refresh/replay/logout, absolute session expiry, cookie flags, CORS, JWT tampering, organization settings, task pagination, all five demo logins, safe legacy seed migration, identity collisions, roster bounds, and disabled production seeding. The suite uses an isolated in-memory PostgreSQL-compatible PGlite database. It does not replace testing on the production PostgreSQL provider or an independent penetration test.

The session and account-recovery controls were reviewed against the [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). This is implementation guidance, not a compliance certification.

## Trust boundaries

The API trusts its PostgreSQL provider, application host, environment configuration, and administrators. Managers can manage all projects in their organization. Members/viewers see approved project data; the organization roster and shared calendar are visible within the organization. This scope is documented rather than implied to be per-field confidential.

Static demo records live in localStorage. Browser-profile access, malicious same-origin scripts, browser extensions with sufficient privileges, and shared-origin GitHub repositories can access or tamper with that data. Client-side validation and disabled buttons are not access control.

The connected frontend keeps access tokens in memory and does not copy organization state into localStorage. Refresh cookies are owned by the API origin. Cookie policies across unrelated sites can still prevent session restoration. Use a dedicated HTTPS frontend/API origin arrangement with a trusted same-site boundary.

Client refreshes use a shared promise within a tab and Web Locks to serialize cookie-changing operations between tabs. Browsers without Web Locks retain within-tab protection; a cross-tab race can still invalidate a session safely. Logout clears local identity before requesting server revocation. If that request fails, the interface clears organization data and offers a retry; a server session is not considered revoked until that retry succeeds.

Appearance uses a separate, validated localStorage record containing only a mode and accent. It applies through HTML data attributes and an external script, keeping the existing CSP intact. The local server and Pages build use explicit public asset lists, and the build removes its previous generated output before copying approved files.

## Local demonstration accounts

`npm run start:demo` provisions Administrator, Professional, Student, Teammate, and Viewer profiles with the public password `NexusDemo!26`. Their `.test` addresses are account identifiers, not real inboxes. The Student is a member limited to assigned study projects; the Professional uses the manager role. These are demonstration identities, and their shared password must never protect real data.

The explicit demo command runs on localhost, ignores `.env`, clears inherited database/SMTP settings, uses a separate `.data/account-demo` database, and generates a signing secret each run. Accounts and workspace edits persist. Old access tokens stop verifying after restart, but valid refresh cookies can restore their sessions. Normal production startup never provisions demo accounts or exposes the profile picker.

An existing demo database is upgraded only when the original demo organization and administrator identity match. The upgrade changes a recognized seed user's password only if its current hash still matches the former public demo password; it preserves custom passwords and user edits. Password migration revokes that account's sessions. Conflicting identities are not claimed, and adding the Student respects roster limits and study-project membership.

The top-right account menu shows the signed-in email and actual role, permits only the current user's display-name edit, and provides password recovery and session actions. Switching accounts signs out before showing the login form. Static mode identifies its local storage boundary and does not present a fake password gate. Neither profile labels nor client-side menu visibility substitute for server authorization.

## Production release gates

Before accepting real data, configure and verify HTTPS, a strong stable JWT secret, a private least-privilege PostgreSQL connection with provider-required TLS, provider backups and a successful restore exercise, real SMTP delivery, actual frontend CORS/CSP origins, correct proxy trust, and external health/error monitoring. Disable demonstration seeding. Review logs/retention, dependencies, abuse controls, and hosting policy.

Use a shared rate-limit store and coordinated migrations before horizontal scaling. The current workspace API has explicit size/count limits and is not designed for large enterprise portfolios. Run load tests with the intended dataset. The three-second dashboard target is a PRD target, not a production SLA established by local browser tests.

For a public SaaS launch, add verified email ownership, MFA or a reviewed identity provider, account-level abuse detection, and a durable email delivery queue. Recovery responses use the same public message, but synchronous SMTP timing is not guaranteed to conceal account existence. Invitation acceptance enforces the 200-account workspace limit. Schedule retention cleanup for expired account tokens and expired/revoked session rows; those records are currently retained to support replay detection and have no automatic cleanup job.

Store high-volume files in managed object storage with signed access URLs and content scanning before increasing attachment quotas. Current bounded files are stored in PostgreSQL JSONB. Activity retention is 2,000 events; regulated audit retention needs a durable external sink. PDF output uses Latin fonts and must not be used as a substitute for source Unicode records.

GitHub Pages cannot provide the custom HTTP security headers or server-side authorization of the connected service. Its static demo is appropriate for a project demonstration; a commercial SaaS and sensitive team deployment should use suitable hosting and independently reviewed configuration.

Report security problems privately to the project owner. No public security contact has been invented or configured.

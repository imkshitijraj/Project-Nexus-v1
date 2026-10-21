# Operations and recovery

Use this runbook after following [DEPLOYMENT.md](../DEPLOYMENT.md). Record the real repository URL, frontend/API URLs, hosting project, PostgreSQL instance, email provider, deployment commit, backup policy, and responsible operator in your private operational records. Keep credentials in a secret manager, not in this document or Git.

## Before each release

1. Review the change and dependency lockfile. Run `npm ci`, `npm run verify`, and `npm run test:browser` against the isolated local test runner. Stop local servers on 4173/4174 before the browser suite.
2. Test on a staging environment with its own database and email settings. Never point automated fixture suites at the production API.
3. Confirm a recent database backup and a known-good deployment are available. Review schema changes for backward compatibility and restoration needs before starting the new API; schema SQL runs during startup.
4. Deploy one version, record its Git commit/image identifier, and repeat the hosted checks in the deployment guide. Avoid overlapping migrations across replicas.

For Pages, pushes to `main` invoke the supplied workflow. For the API, deploy the corresponding tested source or image through your host. Updating Pages does not update the API automatically.

## Backups and restore

For the connected edition, enable your PostgreSQL provider's automated backups and point-in-time recovery where available. Choose retention and recovery targets appropriate to your organization. Keep encrypted backups outside the running application's host and restrict access. Verify backups by restoring to a separate database and testing representative records, accounts, file attachments, and permissions there.

The browser JSON export is a workspace export, not a PostgreSQL or authentication backup: it omits account password hashes and session state. It does not replace database backups. Connected import also requires compatible roster IDs.

For the static Pages demonstration, use **Settings → Export backup** and retain the downloaded JSON in a safe place. Data is stored per browser/origin; clearing browser data or changing hostnames does not move it automatically.

For the local account demo, data lives in `.data/account-demo`; configured embedded development normally uses `.data/postgres`. Stop the corresponding server before taking a consistent copy of an embedded database folder. Keep these folders and backup copies outside Git. The dedicated demo command does not import a database from another project folder.

In a production restore, stop writes, preserve the current database for investigation, restore a selected backup into a separate instance, verify it, then change the API's `DATABASE_URL` and redeploy the matching application version. Avoid overwriting the only surviving copy. Coordinate user communication for any recovery window or lost writes.

Restoring a database can restore old refresh-session state. Revoke sessions when appropriate and require users to sign in again after recovery. Rotating `JWT_SECRET` alone invalidates access-token signatures but does not revoke valid refresh-token rows; refresh can mint a new access token. Account deactivation or password reset revokes that account's sessions. Organization-wide session revocation currently requires an operator-managed database procedure; there is no global sign-out UI.

## Rollback

For a Pages-only regression, revert the faulty commit in GitHub/GitHub Desktop and push the revert to `main`, or use the host's deployment rollback controls. Wait for the replacement workflow to succeed and confirm its published URL. Do not rewrite shared history merely to roll back the website.

For an API regression, redeploy the previous known-good image or source commit while preserving current database data. Confirm the old code is compatible with the current schema. If a migration is incompatible, use the reviewed database recovery plan; application rollback alone cannot undo database writes. Recheck health, login, access restrictions, and a save/reload workflow after recovery.

## Monitoring and maintenance

- Monitor `/api/health`, availability, response time, error rates, PostgreSQL capacity, and email delivery failures. A healthy database check does not prove that SMTP or the full login workflow works.
- Use `X-Request-Id` to correlate HTTP failures with server logs. Restrict access to logs and retain them according to your policy. Development account links contain recovery tokens and must not be copied into public reports.
- Keep Node and dependencies updated through reviewed changes and passing tests. `npm audit` reports known advisories at the time it runs; it is not a security certification.
- Review membership, deactivated accounts, data retention, and database growth. Expired account tokens and expired/revoked session rows currently have no automatic cleanup job; introduce and validate a retention policy before deleting them because session records support replay detection.
- Keep one API replica until shared rate limiting and coordinated schema migration are implemented. Validate load limits with the intended workload. See [SECURITY.md](../SECURITY.md) for remaining production requirements.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Pages deployment fails before upload | Read the failed `verify` job. A test/audit failure blocks deployment intentionally; fix it before retrying. |
| Pages says it is not configured | Select GitHub Actions in repository Settings → Pages, confirm plan/visibility eligibility, then rerun the workflow. |
| Page loads but hosted login is absent | Default Pages output is static. Set `NEXUS_API_URL` to the verified API origin and rebuild, or open the API's same-origin frontend. |
| API cannot start: missing `tsx` | Install with `npm ci --include=dev`; this release executes TypeScript through that dependency. |
| API rejects its production configuration | Provide a PostgreSQL `DATABASE_URL`, HTTPS `PUBLIC_URL`, and a stable `JWT_SECRET` of at least 48 characters. Check provider TLS settings. |
| HTTP 403 / origin not allowed | Match `ALLOWED_ORIGINS` to the frontend origin exactly, without a URL path or trailing slash. Rebuild the frontend if the API origin changed. |
| Login succeeds but reload loses it | Check HTTPS, cookie settings, proxy topology, and browser third-party-cookie policy. Prefer one origin or same-site custom domains. |
| Reset/invitation message does not arrive | Check SMTP credentials, verified sender, provider delivery logs, and the API's configured `PUBLIC_URL`. Reset responses are intentionally generic and do not prove delivery. |
| HTTP 409 during save | Another change won the revision check. Preserve unsaved input, reload the current workspace, and reapply the change. Do not bypass the conflict check. |
| HTTP 429 | Respect the rate limit, inspect unexpected traffic and proxy configuration, then retry after the allowed interval. Do not disable protections to hide abuse. |
| Local port is already occupied | Stop the existing Nexus server in its terminal, or use that running instance. Browser tests require both 4173 and 4174 free. |
| PDF characters show `?` | The current PDF font supports a Latin range; retain the original Unicode records and see the documented export limitation. |

No remote deployment, Docker runtime, production SMTP, or provider restore is implied by these instructions. Record actual successful hosted checks after deployment.

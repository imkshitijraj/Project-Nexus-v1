# Verification record

Verified locally on 20 October 2026 using Node.js 24.18.0, Chrome headless, PostgreSQL via PGlite, Playwright, and axe-core. This is local test evidence, not a production security certification or service-level guarantee.

| Check | Result |
| --- | --- |
| JavaScript syntax, seven application modules | Passed |
| TypeScript API type check | Passed |
| Domain, client session, appearance, and account UI unit tests | 35 passed |
| API / authorization tests | 23 passed |
| Deployment-package regression test | 1 passed, including stale-file removal, explicit asset allowlisting, and rejection of invalid API origins |
| Dependency audit | 0 known vulnerabilities reported by npm at verification time |
| Static Pages package build | Passed |
| GitHub Pages subpath smoke test | Passed: relative assets, styles, appearance, hash routing, creation, and reload persistence under `/student-planner/` |
| Local demo browser workflows | Passed |
| Connected browser workflows | Passed |
| Responsive page checks | 240 total: 48 local, 48 connected, 96 across light/dark, and 48 login/account surfaces; no body overflow |
| axe WCAG A/AA scans | 159 total: 12 connected screens, 96 theme/accent/page combinations, 3 modal/auth/settings checks, and 48 login/account surfaces; no reported violations |
| Login and account behavior | Five real API demo logins, correct roles and student scope, incorrect-password rejection, password visibility, profile editing, reset request, session switching, sign-out, and signed-in reset completion passed |
| Appearance behavior | Light/Dark/System, four accents, reload and cross-tab persistence, OS preference updates, keyboard controls, and blocked/corrupt storage passed |
| Failure recovery | Failed immediate saves restore controls; stale saves preserve drafts; unauthenticated/viewer shortcuts respect roles; interrupted sign-out clears local account labels and offers revocation retry |
| Local supported-limit rendering | 2,000 tasks rendered in 260 ms; filtering to one task took 25 ms in the final reliability run. Not a production benchmark or SLA |
| Browser runtime/console errors | None in the final workflow runs, apart from expected unauthenticated session checks excluded by the connected harness |
| PDF generation | Valid PDF bytes, two-page representative report rendered and visually inspected |
| JSON backup download | Browser download, saved file, and subsequent import passed in the complete browser run |

## Domain and security checks

Domain tests verify backup round trips, derived progress, combined task filters, cascade deletion, invalid/oversized backups, duplicate IDs, escaped untrusted text, date rollover, budget/exposure/workload calculations, dependency cycles and premature completion, budget allocation/membership invariants, and fractional-currency arithmetic.

The follow-up review added half-cent rounding, exact fractional workload, six distinct spending-history months across month-end/year boundaries, honest zero-budget utilization, attachment encoding/decoded-size/aggregate-quota checks, stable audit IDs, and escaped management views. Client tests cover parallel and late unauthorized responses, single-flight refresh, logout races, stale session responses, Web Locks across tabs, safe network/proxy errors, and revision preservation after rejected saves.

API tests exercise route protection, headers, CORS, invalid credentials/input, manager delivery/budget/milestone changes, consecutive saves without reloading, stale revision rejection, assigned-task field restrictions, viewer read-only access, tenant isolation, forged cross-tenant references, SQL foreign keys, mismatched file content, administrator-only invitations, one-use invite acceptance, last-admin protection, generic password reset responses, one-use reset tokens, session revocation, rotating refresh tokens/replay revocation, logout, SQL task pagination, and organization settings permissions/persistence.

New server regressions cover malformed scoped snapshots without data changes, display-name collisions in activity visibility, roles changed during an in-flight write, concurrent refresh/replay/logout, invalidation of every older reset link, invalidation of replaced invitations, JWT tampering, scoped cookie flags, and absolute session deadlines. Bugs found in those areas were fixed before the final passing run.

Demo-account regressions cover all five logins, Student membership and assigned study tasks, safe upgrades from older seed credentials, preservation of custom passwords and edited identities, roster limits, identity collisions, and disabled provisioning in production. Account UI unit tests verify escaped names/tokens, production demo-picker suppression, and the absence of a fake static password gate.

The static browser script covers project/task CRUD and edits, XSS text rendering, reload persistence, board movement, task completion/progress, search/empty states, archiving, calendar navigation, focus controls, profile edits, backup import/export generation, invalid-import rejection, dashboard due filtering, cascade deletion, corrupt-storage recovery, and 12 screens at four widths.

The connected browser script covers real sign-in/session restoration, rich projects and team assignments, assigned tasks/estimates/checklists, expenses/overspend alerts, scored risks/heat map, workload overloads, milestone completion, safe text attachment uploads, calendar meetings, PDF generation, notification read state, persistence/deletion, 48 responsive checks, and accessibility scans on all 12 screens.

Widths: 320, 768, 1024, and 1440 pixels. Automated accessibility checks do not replace assistive-technology or human usability testing.

The appearance matrix covers all 12 screens in Light and Dark with Forest, Ocean, Violet, and Amber accents. Native controls, expanded modal fields, the sign-in page, connected settings, keyboard selection/focus, and mobile navigation were exercised. Dark desktop/mobile screenshots and the appearance settings screen were also inspected visually.

The reliability browser suite verifies public-asset-only static serving, disk-quota errors, local drafts during another tab's save, an API revision conflict, role-aware shortcuts, and a failed logout followed by successful revocation retry. The complete browser runner uses a fresh in-memory seeded database, never loads `.env`, and shuts down its servers. Existing developer data is not used.

The account browser suite exercises login, registration, recovery, reset, invitation, account menu, security panel, and profile panel in light/dark themes at 320, 768, and 1440 pixels. It verifies all five actual API roles, Student scope, profile persistence and escaping, keyboard/focus behavior, account switching, and sign-out across reload. Recovery email requests are intercepted. The signed-in reset completion regression mocks the successful reset response while exercising real logout/cookie cleanup; API tests separately verify actual one-use reset tokens, password changes, and session revocation. This caught and fixed a stale-identity/dashboard issue after resetting while already signed in. Account, failure-recovery, and Pages tests were rerun after the fix.

## Verification limits

Earlier runs encountered browser download cancellation. The final complete run successfully downloaded the JSON backup and restored that saved file (`downloadVerified: true` in the evidence). The connected harness generated actual PDF bytes, saved them through the test process, and validated the PDF. PDF generation and rendered layout passed; the PDF browser download/save interaction was not separately confirmed.

Live cloud PostgreSQL, production HTTPS/cookies/CORS, provider backups/restores, real SMTP delivery, public deployment, production load, and external error monitoring were not provisioned or verified. API email tests use a captured test mailer. The Dockerfile and GitHub Actions workflow were prepared, but no Docker image or remote Actions run was executed locally.

The PDF smoke report uses representative seed/acceptance data and the supported Latin font range. Report layout was rendered to page images and reviewed for clipping, wrapping, and spacing.

Run `npm run verify` and then `npm run test:browser` to reproduce the applicable checks. Install Playwright Chromium or set `BROWSER_EXECUTABLE_PATH`; ports 4173 and 4174 must be free. Selected suites can run with `npm run test:browser -- reliability appearance pages`. See README for prerequisites.

The local source folder is not a Git repository and CodeRabbit CLI is absent, so no CodeRabbit review or remote PR check was run. The server and domain reviews were code inspections with executable regressions; they are not independent certification.

Recorded browser evidence is included in `docs/verification/`. Each report preserves the actual errors, overflow findings, accessibility findings, behavior checks, and applicable download result from its final run.

# Project Nexus PRD coverage

Source: the supplied `Project_Nexus_PRD.docx`, version 1.0, dated 22 July 2026. Implementation checked on 20 October 2026.

The document's product requirements were used as requirements for the application. Its recommended technology choices and roadmap were treated as design guidance, not as instructions authorizing account access, credential sharing, publication, or unrequested external actions.

## MVP acceptance criteria

| PRD criterion | Implementation | Evidence / dependency |
| --- | --- | --- |
| Register, sign in/out, and enforce roles | Customized login/registration/recovery/invitation UI; top-right profile/security/account menu; connected API with bcrypt, JWTs, rotating refresh sessions, DB-backed roles | API tests verify protection, reset, replay, logout, all five demo profiles, and role boundaries. Static demo intentionally has no accounts. |
| Admin creates invitations and assigns roles | Teams invitations and account-management controls | One-use acceptance, admin-only endpoints, active/deactivated accounts, last-admin protection tested. Production SMTP must be configured. |
| Manager creates, edits, archives, and views projects | Rich project forms and active/archive tabs | Browser workflows test create/edit/archive/unarchive/delete and persistence. |
| Manager adds members, tasks, milestones, expenses, risks | Project controls and corresponding management screens | Connected browser exercises assignments, estimates/checklists, costs, risk score, milestone completion, uploads, and calendar events. |
| Member updates permitted assigned-task fields | Scoped data and server-side field restrictions | API tests allow own progress, reject another person's task and project financial changes. UI controls reflect the role. |
| Portfolio KPIs derive from stored records | Shared portfolio calculations and dashboard filters/charts | Domain tests verify completion/progress, budget totals, exposure, and workload. |
| Budget totals and variance are correct | Integer-cent arithmetic; budget, spent, remaining, utilization, forecast variance | Domain tests include fractional-currency values; connected browser checks overspend. |
| Risk scores and heat map | Probability × impact, open-risk exposure, 25-cell grid | Score calculation tested; connected browser verifies a 25/25 risk. |
| In-app notifications for key workflow events | Server-generated authorized inbox, current deadline/budget/risk alerts, preferences | Connected browser checks read state; server restricts notification access. |
| Project status PDF | Generated locally from the authorized workspace snapshot | Generated PDF bytes checked and report pages rendered/visually reviewed. Automated browser file saving is restricted in this environment. |
| Desktop/mobile workflows | Responsive app and login/account screens, semantic forms, role-aware keyboard shortcuts, native dialogs, persistent Light/Dark/System and four accents | Automated responsive, axe WCAG A/AA, and keyboard checks cover workspace, appearance, and account flows. Current counts and evidence are in [VERIFICATION.md](VERIFICATION.md). |
| Deployed demo, documentation, demonstration account | Sample workspace, five local account profiles across four backend roles, source and Pages package, docs | Local demonstrations verified. Public deployment remains pending because no repository/hosting destination or credentials were provided. |

## Functional requirements

| PRD section | Coverage |
| --- | --- |
| 8.1 Authentication/access | Customized email/password signup, login/logout, password visibility, reset links, expiring JWT/refresh sessions, invitation acceptance, account activation/deactivation, top-right profile editing/security/account switching, five local demonstration profiles, and server-enforced roles. |
| 8.2 Portfolio dashboard | Active/completed/delayed/at-risk counts, completion, budget, exposure, overdue and blocked tasks; date/department/owner/priority/category/status filters; health/progress/workload charts, deadlines, milestones, and activity. Budget history provides spending trends. |
| 8.3 Projects | Requested planning/ownership/client/date/budget/status fields, team, success criteria, tags, health, archive/restore, project documents. |
| 8.4 Tasks | Assignee, priority, status, due date, estimate, labels, notes, attachments, subtasks, checklist, comments, dependencies, watchers, list/Kanban/calendar/timeline, drag/drop, overdue flags, completion history. |
| 8.5 Team/resources | Invitations, membership, role management, workload/capacity, available/overloaded indicators, equipment/licenses/rooms. Capacity is a basic comparison of open estimated work to declared capacity, not a timesheet or time-phased staffing optimizer. |
| 8.6 Budget/expense | Project/category allocations, amount/category/date/vendor/notes and linked expense attachments, remaining/utilization/forecast variance, trends, overspend alerts. Single currency: USD. |
| 8.7 Risks | Description/category/probability/impact/owner/mitigation/date/status, calculated severity/exposure, heat map, progress, overdue actions, linked risk attachments. |
| 8.8 Timeline/calendar | Project start/target dates, tasks/dependencies, milestones/completion/delay, shared meetings/leave/reminders. Basic timeline, not advanced Gantt or critical path. |
| 8.9 Notifications/activity | Assignment/task/project/cost/risk updates, authorized inbox, read state, preferences, deadline/threshold alerts, server-generated activity. Task comments support text mentions; updates notify authorized project recipients. There is no post-MVP email/push event delivery. |
| 8.10 Reports | Portfolio, project, budget, risk, workload PDFs with executive summary, KPIs, exceptions, costs/risks, milestones, and upcoming actions. Spreadsheet export remains post-MVP. |

## Architecture choices and non-functional status

The PRD recommends React/TypeScript/Vite/Tailwind, TanStack Query/Zustand, React Hook Form/Zod, Recharts, Express/TypeScript, Prisma/PostgreSQL, JWT/bcrypt, and managed object storage. This implementation retains the already-built native JavaScript/CSS frontend so it can run directly on Pages with no production frontend dependencies. It uses native form validation and shared model validation, native progress/chart elements, and browser-generated PDF reports. The backend follows the Express/TypeScript, Zod, PostgreSQL, JWT, and bcrypt direction; parameterized SQL and versioned SQL migrations replace Prisma. Bounded database attachments replace Cloudinary/S3 in this MVP. These are explicit deviations from the recommended stack, not claims that those packages were used.

| Area | Implemented | Remaining operational verification |
| --- | --- | --- |
| Performance | Deferred PDF import, no external fonts/scripts, SQL task pagination, indexed tenant queries, bounded snapshots | Production three-second target, real network/device performance, and expected-load testing. |
| Security | Password/session controls, authorization, tenant scoping, input/reference/file validation, CSP/headers/CORS/rate limits, secret separation | Production TLS, provider access policy, independent review, actual deployment configuration. |
| Reliability | Transactions, foreign keys, revision checks, predictable errors, backup export/import | Provider backups and a successful production restore exercise. |
| Scalability | Modular API, connection pool, indexes, request/count limits | Shared rate limiting, coordinated multi-replica migrations, object storage, large-tenant architecture. |
| Usability/accessibility | Responsive layouts, named fields, semantic navigation, keyboard focus, confirmations, empty/error states, Light/Dark/System and four accent choices; verified contrast | Human assistive-technology/usability review beyond automated scans. |
| Maintainability | Typed backend, shared model, modular frontend, API/setup/security docs, SQL migration, unit/API/browser tests, lockfile and CI | Frontend remains JavaScript rather than the recommended fully typed React implementation. |
| Observability | Structured request/error logs, request IDs, database-backed health check | Configure an external uptime/error monitor and organizational usage analytics in the chosen hosting environment. |

## Roadmap and success metrics

SSO/OAuth, WebSockets, AI, advanced Gantt, timesheets, portals, workflow customization, chat/versioning, push/email workflow notifications, and native mobile apps remain post-MVP as specified. Full accounting, payroll, ERP procurement, native desktop apps, offline synchronization, and enterprise SSO administration are excluded.

Activation, completeness, compliance, usefulness, and report-time targets are product evaluation goals. No real-user study was performed, so the target percentages are not presented as achieved. No production SLA or security certification is claimed.

## Release conclusion

The project provides a working Pages-compatible demonstration and a runnable connected MVP. Public deployment and production operational gates remain open. It should not be represented as a fully deployed, certified industrial SaaS simply because its local workflows and automated security tests pass.

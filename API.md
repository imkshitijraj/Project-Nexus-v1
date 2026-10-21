# Project Nexus API

All endpoints return JSON except public frontend assets. Send `Content-Type: application/json` for mutations. Authenticated requests require `Authorization: Bearer ACCESS_TOKEN`. Access tokens expire after ten minutes; refresh sessions last up to seven days and rotate on every use.

| Method and path | Access | Request / result |
| --- | --- | --- |
| `GET /api/health` | Public | Database-backed `{status:"ok",version:1}` |
| `POST /api/auth/register` | Public, rate limited | `{email,password,name,organization}` → new organization administrator and access token |
| `POST /api/auth/login` | Public, rate limited | `{email,password}` → `{accessToken,user}` and refresh cookie |
| `POST /api/auth/refresh` | Refresh cookie | `{}` → rotated cookie and new access token |
| `POST /api/auth/logout` | Refresh cookie | `{}` → revoke the session family; outstanding access tokens for it stop working |
| `POST /api/auth/forgot` | Public, rate limited | `{email}` → same generic response whether an account exists or not |
| `POST /api/auth/reset` | One-use token | `{token,password}` → invalidate existing sessions and replace password hash |
| `POST /api/auth/accept-invite` | One-use token | `{token,name,password}` → account in inviter's organization and session |
| `GET /api/workspace` | Signed in | `{revision,state}` scoped to role and project access |
| `PUT /api/workspace` | Role checked | `{revision,state}` → validated, transactional snapshot; `409` on stale revision |
| `GET /api/tasks?page=1&limit=50&project=ID` | Signed in | SQL-paginated `{items,total,page,limit}`, maximum limit 100 |
| `GET /api/organization` | Signed in | `{name,departments}` |
| `PATCH /api/organization` | Admin | `{name,departments:string[]}` |
| `POST /api/invitations` | Admin | `{email,role}` → send 72-hour invitation link |
| `PATCH /api/users/:id` | Admin in same org | `{role,active,department,capacity}` → account update; revokes existing sessions |

Password minimum: 12 characters. Maximum: 72 UTF-8 bytes, matching bcrypt's input boundary. Reset links expire after 30 minutes. Roles are `admin`, `manager`, `member`, and `viewer`.

The local demo provides five profiles through the same login endpoint: `admin@nexus.test` (`admin`), `manager@nexus.test` (`manager`), `student@nexus.test` and `member@nexus.test` (`member`), and `viewer@nexus.test` (`viewer`). Their shared demo password is `NexusDemo!26`. Run `npm run start:demo` for a dedicated localhost database. These addresses are not real inboxes, and production startup does not seed them. The login profile picker only fills credentials; it does not create a session.

Session families expire seven days after sign-in; refresh preserves that absolute deadline. Refresh, logout, and replay revocation serialize on the account row. Completing a password reset invalidates all prior reset links for the account. Reissuing an invitation invalidates previous invitations for the same email and organization.

## Permission boundaries

- Administrators manage their organization, user lifecycle, and all records.
- Managers manage project delivery, assignments, cost, resources, and risk across their organization. They cannot invite users, modify account roles, or change organization settings.
- Members read approved projects, update their assigned tasks' progress/notes/checklists/comments, attach files to those tasks, and update mitigation for risks they own. Other project/task fields remain protected.
- Viewers read approved project data and reports. Their only write actions are their own profile/preferences and notification read state.
- Approved projects are those where the member/viewer is the owner or appears in `project.members`. A role alone does not grant cross-organization access. An invitation alone does not grant project membership.

The server ignores client-supplied completion history in favor of canonical history, assigns comment authors from the authenticated account, and rejects edits to existing comments. Notifications are scoped to authorized project recipients. Audit records are generated server-side and cannot be replaced through a workspace save.

## Snapshot contract

`state.version` is `1`. Collections include `projects`, `tasks`, `members`, `milestones`, `expenses`, `risks`, `resources`, `events`, `files`, `notifications`, `activity`, and focus `sessions`. `profile` and notification `preferences` belong to the current user in connected mode. The top-right **My profile** form updates the current user's display name through `profile` in `PUT /api/workspace`. Administrator edits to roles, activation, department, and capacity must use the dedicated account endpoint, not `members` in a snapshot. The account menu cannot change email or role.

**Security & sign-in** sends the authenticated user's email to `POST /api/auth/forgot` and shows its generic response. **Switch account** calls logout before returning to sign-in; the next account must authenticate normally.

The client loads a bounded aggregate snapshot for the workspace UI. Each write compares current revision under an organization-row lock, validates record references and permissions, updates only changed records in a transaction, and returns the canonical state and incremented revision. This is intentionally a small-organization aggregate API, rather than an unbounded synchronization protocol.

Individual task listing uses tenant-aware SQL pagination. Project/user relationship constraints also exist in PostgreSQL. Foreign project IDs, missing users, invalid dates, dependency cycles, invalid attachments, and unsafe enum values are rejected.

Files are base64 payloads with MIME and magic-byte validation, at most 2 MB each. They reference an authorized project and optionally a task, risk, or expense in that project. They are returned only in authorized snapshots and downloaded as files; no HTML or executable attachments are accepted. The application does not claim to scan file contents for malware. A production object store and scanning pipeline are a separate operational upgrade.

## Errors and observability

Errors use `{error:string}` with `400` validation, `401` session, `403` permission/origin, `404` missing resource, `409` conflict, `413` body size, `415` content type, and `429` rate-limit statuses. Server errors return generic messages. Responses include `X-Request-Id`; server logs include method, path, status, and duration without logging request bodies or credentials.

Authentication is limited to 40 requests per IP per 15 minutes, with a general API limit of 300 requests per IP per minute. Defaults are appropriate for a single service instance; production multi-instance deployments require a shared store. Set proxy trust only to match the real deployment topology.

# System Overview

## Purpose

HYDRO is a Firebase-based reporting and task management system for campus water-related incidents. The application supports the full path from report submission through administrative review, maintenance execution, announcements, user management, and audit visibility.

This public repository is distributed as a configurable template with placeholder Firebase project values. Replace those placeholders and rebuild `dist/` before deployment.

## Primary Application Areas

| Area | Current responsibility |
| --- | --- |
| Student pages | Submit reports, view report history, read announcements, manage profile |
| Admin pages | Review reports, assign work, manage users, locations, announcements, analytics, and audit logs |
| Maintenance pages | View assigned work, update task lifecycle, track dashboard metrics, manage profile settings |
| Shared backend services | User profile updates, report media linking, system configuration, account activation, rate limiting, bootstrap, and audit logging |

## Current Runtime Model

- The frontend is a static application served by Firebase Hosting.
- Firebase Authentication handles sign-in, invited-account setup, password reset, and admin multi-factor authentication.
- Cloud Firestore stores operational data such as users, reports, tasks, announcements, locations, audit logs, and configuration.
- Firebase Storage stores report images, avatars, and announcement attachments.
- Cloud Functions handle privileged operations that are not written directly from the client.

## Source Of Truth

| Path | Role |
| --- | --- |
| `public/` | Frontend source |
| `functions/` | Backend source |
| `dist/` | Hosting build output |
| `scripts/build.mjs` | Hosting build pipeline |
| `firebase.json` | Deployment and emulator configuration |

`dist/` is deployment output rebuilt from `public/`, not a manual editing target.

## Main Flows At A Glance

### Authentication and routing

- Users sign in with email and password.
- Login attempts are checked against a lockout policy before credential submission.
- After sign-in, the app verifies the user document, active status, and role before routing to the correct dashboard.
- Admin users can complete a TOTP challenge when multi-factor authentication is required.

### Reporting and review

- Reports are created in Firestore from the client with validated location, issue, and description fields.
- Optional images are uploaded to Storage and then linked to the report through a callable function.
- Admin users review reports, update status or severity, and assign maintenance staff.

### Task execution

- Task assignment creates one task document per assignee.
- Maintenance staff accept, start, and complete tasks.
- Completing one task resolves the report and closes remaining active sibling tasks for the same team assignment.
- A scheduled function expires overdue unaccepted tasks.

### Announcements and visibility

- Announcements are created by admins and filtered by audience.
- Students, maintenance staff, and admins receive only the active announcements relevant to their role.
- Unread counts are tracked through a last-seen timestamp on the user document.

## Supporting Documents

- `docs/technical-documentation.md` for detailed technical reference
- `docs/setup-and-deployment.md` for setup, Firebase configuration, and deployment guidance

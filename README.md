# Procurement Watch

## New security and collaboration features

This version adds:
- Session-based authentication (no public registration)
- Admin user management
- Mandatory password change on first login/reset
- Entity-linked comments panel in the UI

## Required environment variables

Set these for first startup/bootstrap:

- `ADMIN_EMAIL` (required when no admin exists)
- `ADMIN_PASSWORD` (required when no admin exists)
- `ADMIN_NAME` (optional, default: `Admin`)

Optional:
- `COOKIE_SECURE` (`true` in HTTPS production, default `false`)
- `MONGO_URI`
- `MONGO_DB`
- `SYNC_SECRET`

## First-time admin login

1. Start backend with `ADMIN_EMAIL` and `ADMIN_PASSWORD` set.
2. If no admin exists, backend auto-creates one admin user.
3. Login using those credentials.
4. You will be forced to change password (`mustChangePassword=true`).

## Auth behavior

- No registration endpoint/UI.
- All `/api/*` routes require authentication except `/api/auth/login` and `/api/health`.
- Admin-only APIs are under `/api/admin/*`.
- Cookie session is used (`pw_session`), plus CSRF token for sensitive writes:
  - `/api/auth/*`
  - `/api/admin/*`
  - `/api/comments`

## Comments

Comments are attached to:
- `entityType`
- `entityId`

UI includes a left-side comments panel with:
- Open/close toggle
- All/Mine filter
- Create + Cancel
- Immediate refresh after submit

## Tests

Backend minimal tests are under `backend/tests/test_auth_comments.py`:
- admin bootstrap creation
- admin route blocked for non-admin
- must-change-password enforcement
- create/list comments for an entity

Run:

```bash
cd backend
pytest
```

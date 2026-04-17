# Procurement Watch

Procurement Watch is a SaaS-style internal intelligence dashboard for tracking procurement and tender opportunities, reviewing them with AI assistance, and managing analyst decisions in one workspace.

## Features

- Authentication and access control
  
  - Secure login with JWT-based API access.
  - Automatic bootstrap of the first admin user from environment variables.
  - Forced password change on first login or after an admin reset.
  - Admin-only management endpoints for privileged actions.

- Procurement Watch dashboard
  
  - Central table for reviewing opportunities from multiple procurement sources.
  - Search, filters, advanced boolean query mode, and bulk actions.
  - Right-side project inspector drawer for project details, decisions, metadata, and discussion.

- AI-assisted review
  
  - Newly scraped projects go through AI cybersecurity verification.
  - AI enrichment supports source analysis, document understanding, and metadata extraction where configured.

- Project decision workflow
  
  - Analysts can mark projects as `Go`, `No Go`, or leave them undecided.
  - Manual deadline override is supported, while keeping the original scraped deadline for traceability.

- Comments and attachments
  
  - Entity-linked discussion thread for projects.
  - File attachments in discussion.
  - Inline image preview and in-app PDF preview inside the discussion experience.

- Sync management
  
  - Manual sync modal with per-source selection.
  - Scheduled sync configuration with source toggles, timezone handling, and run history.
  - Live sync output streaming in the sync dialogs.
  - Notification sound when new projects are found while the user is active in the app.

- User administration
  
  - Create, edit, deactivate, and delete users.
  - Reset user passwords.
  - Role-based access with admin and user roles.

- Geography and filtering support
  
  - Normalized continent, country, and region data.
  - Continent and region-based filtering across projects.
  - Seeded geography data for regions and country mappings.

- Data export and persistence
  
  - MongoDB-backed project storage.
  - Excel export generation for project data.
  - Sync logs and scheduler history persisted in the backend.

## Current scraped sources

The platform currently supports these procurement sources:

- IADB
- World Bank
- Global Tenders
- GIZ
- DevelopmentAid
- DGMarket
- Africa Gateway
- IsDB
- BADEA

## Required environment variables

Set these for first startup/bootstrap:

- `ADMIN_EMAIL` required when no admin exists yet

- `ADMIN_PASSWORD` required when no admin exists yet

- `ADMIN_NAME` optional, default `Admin`

Optional:

- `MONGO_URI`
- `MONGO_DB`
- `SYNC_SECRET`
- `JWT_SECRET`
- `JWT_ACCESS_MINUTES`
- `JWT_REFRESH_DAYS`
- `DEEPSEEK_API_KEY` if DeepSeek-based enrichment is enabled

## First-time admin login

1. Start the backend with `ADMIN_EMAIL` and `ADMIN_PASSWORD` set.
2. If no admin exists, the backend auto-creates one admin user.
3. Log in using those credentials.
4. You will be forced to set a new password before continuing.

## Auth behavior

- No public registration flow exists.
- All `/api/*` routes require authentication except:
  - `/api/auth/login`
  - `/api/auth/refresh`
  - `/api/auth/bootstrap-status`
  - `/api/health`
- Admin-only APIs are under `/api/admin/*`.

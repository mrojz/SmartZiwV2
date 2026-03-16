# Architecture

## Overview

This application is a procurement intelligence platform with three main parts:

1. A React frontend used for authentication, project review, comments, admin tools, and sync controls.
2. A FastAPI backend used for APIs, authentication, file uploads, manual/scheduled sync orchestration, and notifications.
3. A scraping + AI pipeline that collects tenders from multiple sources, verifies relevance, enriches results, and persists them to MongoDB.

At a high level:

- Users interact with the frontend.
- The frontend calls the backend API.
- The backend reads/writes MongoDB and triggers sync jobs.
- Sync jobs run scrapers in a separate Python process.
- New projects are AI-verified and enriched before being saved.
- Results are streamed back to the UI through SSE for live sync logs and notifications.

## High-Level System Design

```text
Frontend (React)
  -> FastAPI API
    -> MongoDB
    -> File uploads
    -> APScheduler
    -> Sync subprocess (main.py)
         -> Scrapers
         -> AI filter
         -> AI enrichment
         -> Project normalization / dedupe / persistence
```

## Repository Layout

### Root

- `frontend/`
  - React application.
- `backend/`
  - FastAPI app, data layer, scheduler, scrapers, AI pipeline.
- `docker-compose.yml`
  - Full local stack with MongoDB, backend, and frontend.
- `README.md`
  - Product overview and feature list.
- `INSTALL.md`
  - Setup and run instructions.
- `ARCH.md`
  - This architecture document.

## Frontend Architecture

Frontend entry points live in:

- `frontend/src/main.jsx`
- `frontend/src/App.jsx`

### Main frontend responsibilities

- Authentication flow
- App shell and navigation
- Procurement Watch table and inspector
- User Management
- Profile and settings UI
- Manual sync modal
- Schedule modal
- Discussion/comments with attachments
- Live sync output rendering

### Important frontend folders

- `frontend/src/components/`
  - Reusable UI pieces and feature panels.
  - Notable files:
    - `ProjectTable.jsx`
    - `SyncPanel.jsx`
    - `SchedulePanel.jsx`
    - `ConfigPanel.jsx`
    - `SmartSearch.jsx`
- `frontend/src/styles/`
  - Shared styling system and feature-specific CSS.
  - Notable files:
    - `app-shell.css`
    - `table.css`
    - `toolbar.css`
    - `panels.css`
- `frontend/src/hooks/`
  - Small React hooks used by the UI.
- `frontend/src/utils/`
  - Frontend helpers and utilities.

### Frontend state model

Most app state currently lives in `App.jsx` and is passed into feature components as props. The app is organized more as a product shell plus feature panels than as a deeply nested route tree.

Key frontend patterns:

- `apiFetch(...)` is the shared authenticated request path.
- Live sync and notifications use SSE.
- Table filtering/sorting/pagination happen client-side on fetched project data.
- Modals such as Sync, Schedule, and Settings are isolated components with their own internal state.

## Backend Architecture

### Main backend files

- `backend/server.py`
  - FastAPI application entry point.
  - Authentication, API endpoints, scheduler, sync orchestration, SSE streams.
- `backend/main.py`
  - Scraper orchestrator process.
  - Runs selected sources, deduplicates results, calls AI, writes data.
- `backend/database.py`
  - MongoDB access and project/config/schedule/log persistence.
- `backend/ai_filter.py`
  - AI relevance verification.
- `backend/ai_enrichment.py`
  - AI enrichment for verified projects.
- `backend/geography.py`
  - Geography normalization and seeded region/country support.
- `backend/shared_excel.py`
  - Shared helpers for Excel export and keyword loading.

### Backend folders

- `backend/utils/`
  - Individual scraper implementations and scraper-related helpers.
- `backend/data/`
  - Seed data such as geography.
- `backend/scripts/`
  - Utility scripts like geography seeding.
- `backend/tests/`
  - Backend test files.
- `backend/uploads/`
  - Uploaded discussion attachments.

## Request and Data Flow

### Standard UI request flow

1. User acts in the React UI.
2. Frontend calls a backend endpoint using `apiFetch`.
3. Backend authenticates the request.
4. Backend reads/writes MongoDB through `database.py`.
5. Response returns to frontend.
6. Frontend updates local state and rerenders.

### Live events

Two major SSE streams exist:

- `/api/sync/stream`
  - Live sync console output.
- `/api/notifications/stream`
  - Events such as `new_projects` used for in-app notifications/sound.

## Sync Architecture

There are two sync entry points:

1. Manual sync
2. Scheduled sync

Both eventually run the same scraping pipeline in `backend/main.py`.

### Manual sync flow

1. User opens `SyncPanel.jsx`.
2. User selects sources and options.
3. Frontend posts to backend sync endpoint.
4. `server.py` starts a background thread.
5. The thread launches `main.py` as a subprocess with selected source flags.
6. Subprocess stdout is captured into shared `sync_state`.
7. Frontend subscribes to `/api/sync/stream` and shows live logs.
8. On completion, results are saved, sync logs are persisted, and notifications may be broadcast.

### Scheduled sync flow

1. Schedule config is stored in MongoDB.
2. `server.py` uses APScheduler to register the next execution.
3. The scheduler launches the same sync subprocess flow used by manual sync.
4. Logs are persisted to sync history.

### Why the scraper pipeline runs in `main.py`

Scrapers are isolated in a separate process because they are:

- long-running
- network heavy
- browser-automation heavy for some sources
- easier to stream/log as a subprocess

This also keeps the FastAPI request lifecycle responsive while sync runs in the background.

## Scraper Architecture

Each scraper in `backend/utils/` is responsible for collecting projects from one source and returning normalized records.

Current registered sources:

- IADB
- World Bank
- Global Tenders
- GIZ
- DevelopmentAid
- DGMarket
- Africa Gateway
- IsDB
- BADEA

### Scraper contract

Each scraper returns a list of project dictionaries with a common structure, typically including:

- project name
- project URL
- source
- sponsor/country/region text
- dates
- description if available
- metadata needed later by filters and AI

The exact fields vary by source, but they are normalized before persistence.

### How scrapers are registered

`backend/main.py` contains a `SCRAPERS` map. This is the central registry used by the sync orchestrator.

Adding a new scraper usually requires:

1. Create scraper file in `backend/utils/`
2. Add scraper function to `SCRAPERS` in `backend/main.py`
3. Add source flag/schema support in `backend/server.py`
4. Add defaults where needed in `backend/database.py`
5. Add source selector in:
   - `frontend/src/components/SyncPanel.jsx`
   - `frontend/src/components/SchedulePanel.jsx`

## Scraper + AI Pipeline

This is the most important product workflow.

### End-to-end flow

1. Selected scrapers run in parallel.
2. Raw projects are merged.
3. Duplicate projects are removed.
4. Existing projects are compared against stored data.
5. Only new projects go through AI verification.
6. Verified projects go through AI enrichment.
7. Final records are normalized and upserted to MongoDB.
8. Excel export is refreshed.
9. A sync summary is emitted for UI/history/notifications.

### Step 1: scraping

Each source scraper fetches its source pages and extracts projects. Some scrapers also visit detail pages to fetch:

- deadline
- description
- supporting metadata

### Step 2: deduplication

After scraping, `main.py` deduplicates records across sources and keywords using normalized project identity heuristics.

### Step 3: new project detection

The backend compares scraped projects against stored projects in MongoDB to detect which tenders are truly new.

Only new projects go through AI verification. This is important for:

- cost control
- speed
- avoiding repeated AI work on known records

### Step 4: AI verification

`backend/ai_filter.py` contains the relevance verification stage.

Its purpose is to answer:

- is this project actually relevant to the domain we care about?

Only projects that pass this stage move on as AI-verified results.

### Step 5: AI enrichment

`backend/ai_enrichment.py` enriches verified projects with additional intelligence, such as:

- extracted understanding of the tender
- richer document-derived context
- classification-style metadata
- additional helpful details for analysts

This stage can inspect uploaded or remote documents and expand the record beyond what the scraper alone extracted.

### Step 6: persistence

`backend/database.py` normalizes and upserts projects into MongoDB.

This includes:

- manual vs scraped deadline logic
- effective deadline computation
- geography normalization
- stable identifiers
- comment and attachment compatibility

## Geography and Region Model

The app includes normalized geography support so filtering is not based only on raw text.

Relevant files:

- `backend/geography.py`
- `backend/data/geography_seed.json`
- `backend/scripts/seed_geography.py`

This model supports:

- continents
- countries (English + French names, ISO codes)
- seeded region groups
- region-country mapping

This is used by:

- continent filtering
- region filtering
- config/settings region data
- normalization of scraped country text

## Authentication Architecture

Authentication is handled in `backend/server.py`.

Main parts:

- JWT-based auth
- login endpoint
- refresh support
- admin-only guards for sensitive actions
- forced-password-change flow supported by frontend

Frontend uses the shared authenticated request helper and persists access state client-side.

## Comments and Attachments

Discussion/comments are attached to projects and handled through the backend API plus frontend drawer UI.

### Backend responsibilities

- comment CRUD
- file upload storage in `backend/uploads/`
- serving uploaded files
- attachment metadata

### Frontend responsibilities

- show discussion thread in project inspector
- inline image previews
- in-app image lightbox
- in-app PDF viewer

## Sync Logs and Run History

Run history shown in the Schedule modal is backed by persisted sync logs in MongoDB.

Stored information includes:

- sync status
- started/finished timestamps
- duration
- new project count
- selected sources
- readable summary
- optional raw/scraper logs

This is used for:

- manual sync live status
- scheduled sync history
- recent output review

## Notifications

The app can broadcast live events when sync completes.

The main current example is:

- `new_projects`

Frontend listens to `/api/notifications/stream` and can trigger notification sounds only when the user is present and focused.

## Folder-Level Guide

### Backend folders in practice

- `backend/utils/`
  - Add or update scrapers here.
- `backend/scripts/`
  - Operational scripts, seeds, and maintenance helpers.
- `backend/data/`
  - Static seed/reference data.
- `backend/uploads/`
  - Runtime user-uploaded files.
- `backend/tests/`
  - Backend test coverage.

### Frontend folders in practice

- `frontend/src/components/`
  - Feature UI and reusable UI units.
- `frontend/src/styles/`
  - Shared visual system and feature-specific CSS.
- `frontend/src/hooks/`
  - Reusable React logic.
- `frontend/src/utils/`
  - Small helpers used across UI features.

## How to Add a New Scraper

Recommended checklist:

1. Create a new scraper file in `backend/utils/`.
2. Return normalized project dictionaries.
3. Register it in `backend/main.py`.
4. Add source selection support in:
   - `backend/server.py`
   - `backend/database.py` defaults if needed
   - `frontend/src/components/SyncPanel.jsx`
   - `frontend/src/components/SchedulePanel.jsx`
5. If the source supports detail-page enrichment, extract description/deadline/doc links there.
6. Run a manual sync and confirm:
   - source appears in UI
   - logs stream correctly
   - projects are deduped
   - AI verification/enrichment still works

## Operational Notes

- MongoDB is the source of truth for projects and app configuration.
- Excel export exists as a downstream artifact, not the primary datastore.
- Sync is intentionally asynchronous and subprocess-based.
- The frontend is optimized for analyst workflows: filtering, bulk actions, inspector review, comments, and attachments.

## Summary

This codebase is organized around one core workflow:

- scrape tenders
- verify relevance with AI
- enrich useful tenders
- persist them as analyst-ready records
- let users review, comment, schedule syncs, and manage decisions in a dashboard

The important boundary lines are:

- frontend UI in `frontend/`
- API and orchestration in `backend/server.py`
- scraping pipeline in `backend/main.py`
- persistence in `backend/database.py`
- source-specific extraction in `backend/utils/`
- AI processing in `backend/ai_filter.py` and `backend/ai_enrichment.py`

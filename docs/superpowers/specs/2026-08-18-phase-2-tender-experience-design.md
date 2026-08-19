# Phase 2 Tender Experience Overhaul — Design Spec

## Context

Smart-Ziw is a tender-monitoring SaaS. Phase 1 stabilized the app: fixed runtime errors in `App.jsx`, added loading/error/empty states to the tender list, removed dead code, deduplicated the scroll-lock helper, and green-lit the backend suite (202 tests). The UI is already a full shadcn redesign, but `App.jsx` remains ~5,000 lines with the tender list, inspector, comments, and global state tightly coupled.

## Goal

Deliver a polished, production-quality tender discovery and review experience. The work is user-facing and focused on the tender workflow; it does not redesign admin, settings, LLM config, auth, or analytics except to fix accidental regressions.

## Scope

In scope:
- Extract tender-specific UI into focused pages/components.
- Add a full-page tender detail view alongside the existing side-sheet inspector (hybrid model).
- Sync active filters to the URL so searches are shareable and bookmarkable.
- Restructure the inspector/detail body into tabs: Overview, Documents, Activity/Comments, Smart-Ziw.
- Add loading skeletons and not-found states for the detail page.
- Add a lightweight error boundary around the new pages.

Out of scope:
- New backend endpoints or data models (reuse existing endpoints).
- Admin/settings/user-management redesign.
- React Router migration; keep the existing custom hash router.
- Dark mode or theming changes.

## Architecture

### Routing

Keep the current custom `window.location.hash` router in `App.jsx`. Add one new route pattern:

| Hash route | Renders |
|---|---|
| `#tenders/:id` | `TenderDetailPage` |
| `#dashboard`, `#tenders`, empty hash | `TendersPage` |

The side sheet receives an **“Open full page”** action that sets `window.location.hash = #tenders/${dbId}`. The detail page has a back button returning to `#dashboard`.

### Component boundaries

```
App.jsx
├── TendersPage
│   ├── stats cards
│   ├── ProjectTable (existing, with new props)
│   ├── CommentsPanel / side sheet (existing, repurposed as quick-scan shell)
│   └── ProjectInspector (extracted content)
└── TenderDetailPage
    ├── back button + tender header
    ├── ProjectInspector (reused)
    └── TenderDetailSkeleton

shared:
├── utils/tenderRouting.js
└── components/TenderTabs.jsx
```

### New files

- `frontend/src/pages/TendersPage.jsx` — owns the list route.
- `frontend/src/pages/TenderDetailPage.jsx` — owns `#tenders/:id`.
- `frontend/src/components/ProjectInspector.jsx` — tabbed tender body shared by side sheet and full page.
- `frontend/src/components/TenderTabs.jsx` — tab switcher (Overview / Documents / Activity / Smart-Ziw).
- `frontend/src/utils/tenderRouting.js` — helpers for parsing/building hash routes and query params.

### Changed files

- `frontend/src/App.jsx`
  - Remove tender-list, inspector, and comments rendering into `TendersPage`.
  - Add route dispatch for `#tenders/:id` → `TenderDetailPage`.
  - Keep global auth, sidebar, notifications, command palette, and release notes.
- `frontend/src/components/ProjectTable.jsx`
  - Accept `newProjectIds` prop and apply a subtle highlight to newly-synced rows (already done in Phase 1; keep and extend if needed).
  - Add `onOpenFullPage` callback for an “Open full page” row action.
- `frontend/src/components/CommentsPanel.jsx` (or the existing sheet)
  - Delegate body rendering to `ProjectInspector`.

## State & data flow

- `App.jsx` keeps global state: `authUser`, `availableUsers`, `notifications`, `releaseNotes`, sidebar/command-palette state.
- `TendersPage` owns local state:
  - filter state (`chips`, `freeText`, `source`, `region`, etc.)
  - `projects`, `projectsLoading`, `projectsError`
  - `selectedProject`, `commentsOpen`
  - `newProjectIds` from sync completion
- `TenderDetailPage` owns local state:
  - `project`, `loading`, `error`
  - `comments`, `commentsLoading`
- Both pages use `apiFetch` passed from `App.jsx`.
- `ProjectInspector` is presentational: receives `project`, `comments`, loading flags, and callbacks (`onDecisionChange`, `onRunSmartZiw`, `onOpenFullPage`).

## URL-synced filters

When the user changes any filter on `TendersPage`, serialize the non-default values into the hash query string:

```
#dashboard?q=health&source=worldbank&decision=Go&expiringSoon=1&expiringDays=7
```

On mount, `TendersPage` parses the query string and hydrates filter state. Empty/default values are omitted to keep URLs clean. Serialization/deserialization lives in `utils/tenderRouting.js`.

## Inspector / detail tabs

`ProjectInspector` renders a tab bar and tab panels:

1. **Overview** — project metadata, sponsor/region/deadline, decision buttons, verification badge.
2. **Documents** — attachment list, document URL, preview where possible.
3. **Activity** — comments thread with mention support and file upload.
4. **Smart-Ziw** — agent run button, prior analysis output, @SmartZiw chat interface.

In the side sheet the tab bar is compact; on the full page it is larger and can show more metadata in the header.

## Loading & error states

- `TendersPage` loading/error: reuse Phase 1 states in `ProjectTable`.
- `TenderDetailPage` loading: show `TenderDetailSkeleton` (header skeleton + tab skeleton).
- `TenderDetailPage` error / unknown `dbId`: show a centered “Tender not found” card with a back button.
- Add a React error boundary around `TendersPage` and `TenderDetailPage` so a render crash in one does not blank the whole app.

## Accessibility & responsive

- Preserve keyboard navigation in `ProjectTable`.
- Full-page detail stacks vertically on mobile; tabs become a scrollable list or dropdown.
- Focus management: opening the side sheet focuses the sheet header; closing returns focus to the triggering row.

## Testing & verification

- `npm run build` must exit cleanly.
- `PYTHONPATH=backend python -m pytest backend/tests -q` must remain 202/202.
- Manual smoke checks:
  - `#dashboard` renders the tender list.
  - Clicking a row opens the side sheet with tabs.
  - “Open full page” navigates to `#tenders/:id`.
  - Filters update the URL and survive a page refresh.
  - Unknown tender ID shows the not-found state.
  - Backend sync still highlights new tenders.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Extracting from `App.jsx` breaks existing handlers | Move helpers to `utils/` unchanged; keep callback signatures stable. |
| URL filter sync conflicts with existing hash routing | Encode filters as query params inside the hash, leaving route parsing untouched. |
| Detail page fetches stale project after sync | `TenderDetailPage` fetches fresh data on mount and on `dbId` change. |
| Mobile tab UI becomes cramped | Use a responsive tabs component or collapse to a select on small viewports. |

## Success criteria

- `App.jsx` shrinks meaningfully and no longer contains tender-list or inspector markup.
- Users can share a filtered tender search via URL.
- Users can open any tender in a dedicated full-page view.
- The side sheet and full page share the same tabbed inspector component.
- Build and backend tests remain green.

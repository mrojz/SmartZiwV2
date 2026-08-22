# Phase 4 — Configuration Polish + Phase 5 — Design System & Theme

**Date:** 2026-08-21  
**Status:** design approved

## Context

Smart-Ziw frontend is already on shadcn/ui (radix-nova, neutral base, CSS variables). Admin settings are currently a flat tab bar inside `AdminPage` with inconsistent save feedback and minimal client-side validation. The app also ships light-only even though `index.css` already defines a complete `.dark` palette.

## Goals

### Phase 4

1. Reorganize admin settings into logical groups.
2. Add field-level validation and clear save/feedback behavior.
3. Keep all existing backend APIs intact.

### Phase 5

1. Add a dark-mode toggle with `system` as the default.
2. Fix `index.html` hardcoded light `color-scheme`.
3. Standardize spacing, typography, and component usage across pages.
4. Add subtle transitions.

## Out of scope

- No new backend endpoints or data model changes.
- No React Router migration.
- No new runtime dependencies (validation done with small helper functions; theme provider is a custom context).

## Global constraints

- `npm run build` must exit cleanly.
- `PYTHONPATH=backend python -m pytest backend/tests -q` must remain 205/205.
- All existing backend endpoints keep the same request/response shape.
- Light theme must remain fully functional; dark mode is additive.
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## Phase 4 — Configuration polish

### Admin grouping

Convert the flat `AdminPage` tab bar into grouped tabs (still rendered by the same component, same routes):

| Group | Tab | Content |
|---|---|---|
| Administration | Users | Existing user management table, drawer, dialogs |
| Smart-Ziw | Agent | Enable agent, local repo path, GitLab push toggle + URL/project/token/branch/author fields, web-research toggle + timeout |
| Smart-Ziw | LLM Provider | Provider select, base URL, API key, subscription key, server type, model select/manual, temperature, max tokens, test-before-save |
| Smart-Ziw | System Prompts | System / expertise / unwanted textareas |
| Smart-Ziw | Skills | Skill URL fetch, enable/disable/delete cards |
| Smart-Ziw | MCP Servers | Server list + test-before-save add/edit form |
| Content | Release Notes | Version selector + version/title/summary/items editor |

UI: a horizontal `Tabs` list where each tab label is prefixed with its group name, e.g. "Smart-Ziw › Agent". The grouping is visual only; no routing or API changes.

### Field-level validation

Validation is client-side and immediate on submit (not on every keystroke). No new library; use small pure helpers.

- **Required string**: trimmed value not empty.
- **Email**: matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- **URL**: matches `new URL(value)` without throwing, and uses `http://` or `https://` when a URL is expected (GitLab base URL, LightLLM base URL, MCP SSE URL).
- **Number ranges**:
  - research timeout ≥ 1
  - temperature 0–2
  - max tokens 1–128000
- **Password change**: new password ≥ 8 chars and matches confirm.
- **MCP save**: still gated by a passing test (existing behavior).

Validation errors render inline below the offending input using `text-destructive text-xs`.

### Save / feedback behavior

- Replace remaining inline `message` banners in admin tabs with `sonner` toast success/error.
- Per-section save buttons show `Saving…` disabled state and disable the form while the request is in flight.
- If validation fails, scroll the first invalid field into view and show toasts only for server-side failures.
- Keep existing test-before-save flows for LLM Provider and MCP Servers.

---

## Phase 5 — Design system & theme

### Dark mode

Add a custom `ThemeProvider` context (`frontend/src/components/ThemeProvider.jsx`):

- Stores preference in `localStorage` key `pw-theme` with values `light`, `dark`, or `system`.
- Default is `system`.
- On mount, resolves `system` to `window.matchMedia('(prefers-color-scheme: dark)').matches`.
- Applies `light` or `dark` class to `<html>`.
- Updates `<meta name="color-scheme">` to `light dark` in `index.html` so form controls respect the active scheme.
- Exposes `theme`, `setTheme`, and `resolvedTheme`.

Add a theme toggle:
- In the header avatar dropdown: "Appearance: Light / Dark / System".
- Optionally in the ⌘K palette as "Toggle theme".

### Standardization

- Extract `frontend/src/components/PageHeader.jsx` from the duplicated markup in `App.jsx` and `TendersPage.jsx`.
- Extract `frontend/src/components/SectionCard.jsx` for the common `rounded-lg border bg-card p-6` wrapper.
- Replace one-off success colors (`text-green-600`, `bg-green-600/10`) with new semantic tokens `--success` and `--success-foreground` added to `index.css`.
- Audit `TendersPage` sheet/inspector spacing and align to `gap-4`/`gap-6`/`p-6` standard where it does not affect functionality.

### Transitions

- Add `transition-colors duration-200` to custom interactive elements (filter chips, assignment buttons, custom toggle pills) that currently lack it.
- Keep shadcn component transitions unchanged.

---

## Testing

- Frontend build must pass: `cd frontend && npm run build`.
- Backend tests must pass: `PYTHONPATH=backend python -m pytest backend/tests -q`.
- Manual smoke checks:
  - Admin tabs render with group labels.
  - Invalid admin form fields show inline errors and block save.
  - Valid saves show toast feedback.
  - Theme toggles between light/dark/system and persists after reload.
  - System theme respects OS preference on first load.
  - No console errors on Tenders, Detail, Admin, Settings, Schedule, Profile pages.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Refactoring admin forms introduces regressions | Keep existing handlers and endpoint calls; only add validation layer and swap banner for toast. |
| Dark mode flashes wrong scheme on load | Set initial class in a small inline script in `index.html` or synchronously in `ThemeProvider` before first paint. |
| Ad-hoc spacing changes break layout | Keep changes limited to padding/gap tokenization; verify build and visual smoke tests. |

## Success criteria

- Admin settings are visually grouped and every form has field-level validation.
- Save feedback is consistent via `sonner` toast.
- Theme toggles work and persist.
- Build and backend tests remain green.

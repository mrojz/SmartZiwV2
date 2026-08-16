# Smart-Ziw shadcn/ui Redesign — Design Spec

**Date:** 2026-08-15
**Status:** approved design, awaiting spec review
**Reference:** https://layers.to/layers/cm0f5ap3g0008jn0dnu220uv3-sidebar-ui-component-of-dashbar-framer-personal-site-template (Dashbar sidebar, restyled as light theme)

## Goal

Replace the entire custom-CSS component layer of the Smart-Ziw frontend with shadcn/ui components (light professional theme), restructure the sidebar after the Dashbar reference (search + grouped collapsible nav + profile footer), and delete the legacy CSS — **with zero functional change**: routes, API calls, state, handlers, and business behavior stay identical.

## Architecture

- The frontend stays React 19 + Vite + Tailwind v4 with the existing `@/` path alias.
- shadcn/ui (new-york style, neutral base color) is installed via its CLI (`components.json` committed). Standard dependency set: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, plus the Radix packages shadcn components pull in. Icons migrate from `@untitledui/icons` to `lucide-react`.
- The monolith `App.jsx` keeps its logic; JSX is restyled onto shadcn primitives and extracted where a clear component boundary already exists. The custom wrappers retire: `components/base/dropdown/`, `components/base/tooltip/`, and the legacy CSS files (`app-shell.css`, `filters.css`, `header.css`, `modal.css`, etc.) are deleted by the end of Phase 3. When their last usage is gone, the react-aria deps (`react-aria`, `react-aria-components`, `tailwindcss-react-aria-components`) retire too — shadcn components are Radix-based.
- Theme: **light only** (no dark mode toggle). CSS variables in shadcn's `:root` form.

## Design tokens

- Palette: white surfaces, `#f8fafc` app background, slate-700/600 primary/secondary text, slate-500 muted, slate-200 borders; primary blue `hsl(221 83% 53%)`; success `#15803d`; danger `#b91c1c`.
- **Amber `#d97706` remains reserved for tender "opportunity" moments** (unchanged rule from the 2026-08-15 UI overhaul design).
- Font: Inter (as today). Radius 0.5rem. Soft shadows (shadcn defaults).

## Sidebar (Dashbar reference, light)

Structure, top to bottom:

1. **Brand row:** logo mark (existing Forvis Mazars mark) + "Procurement Watch" name, collapse toggle.
2. **Search input with ⌘K** — focused shortcut opens the unified search (Command palette / existing UnifiedSearchBar); typing filters nav + jump-to options.
3. **Grouped collapsible nav** (groups collapse via chevron, per shadcn sidebar groups):
   - Main: Dashboard, Tenders
   - Intelligence: Analytics
   - Management (admin-only): Admin, Schedule, Settings
   - Settings: Profile
   Items: icon + label, active item highlighted (subtle blue tint pill), hover states, badge counts where data exists. Schedule/Settings open their panels (same behavior as today's `navigate()` keys).
4. **Footer:** user profile row (avatar, name, role) + logout. **No extra card** (user decision).

Header: context title/subtitle, icon-only actions (sync, notifications), avatar dropdown (Profile/Admin/Settings/Schedule/Logout) — all shadcn (Tooltip, DropdownMenu, Badge).

## Phases

Each phase: implemented by the multi-agent workflow, frontend build green, backend suite (138) untouched/green, one commit (or one per logical chunk).

### Phase 1 — Shell
- shadcn CLI setup: `components.json`, `src/lib/utils.ts` (cn), CSS variables/theme replacing the design-token layer; install deps.
- Components in: button, input, label, select, textarea, checkbox, switch, table, tabs, card, badge, avatar, dialog, dropdown-menu, tooltip, separator, scroll-area, sheet, sonner, command, sidebar, skeleton, progress.
- Rewrite `components/Sidebar.jsx` per the sidebar spec above (shadcn `SidebarProvider`/`Sidebar`/groups + search + ⌘K wiring).
- Rewrite header (App.jsx header JSX) with shadcn tooltips/dropdowns/avatars; keep avatar menu items identical.
- Replace the toast system with sonner (same messages/triggers).
- Login page + force-password page restyled with shadcn Card/Input/Button.
- App fully usable; remaining pages still on legacy CSS (acceptable mid-phase).

### Phase 2 — Data surfaces
- Tenders: unified search bar, filter chips/selects, project table (shadcn Table), row actions, project inspector (Sheet) incl. action buttons, Smart-Ziw run UI, comments panel (shadcn Dialog + textarea + timeline styling), 7-day auto-filter toast/chips.
- Dashboard: stat cards (shadcn Card) with the existing lightweight CSS/SVG sparkline styling — no chart library is added.

### Phase 3 — Admin, panels, remainder
- Admin page: header + stat cards + tabs (Tabs) + user table + user drawer (Dialog with shadcn form controls) + password reset flow.
- Smart-Ziw settings card, LLM Provider card (source radio group, model discovery select, Advanced settings `<details>` → shadcn Collapsible/Accordion), schedule panel, settings/config panel, release notes page.
- Analytics placeholder, demo walkthrough (spotlight overlay restyled onto shadcn primitives).
- Delete legacy CSS files and custom base components; remove now-unused `@untitledui/icons` dependency.

## Global constraints

- Zero functional change: no route, API, state, or behavior changes. 138 backend tests must stay green (they don't cover frontend, but the suite is the regression gate for any accidental backend touch).
- Light theme only. Amber only for opportunity moments.
- No new runtime deps beyond the shadcn standard set + lucide-react; remove `@untitledui/icons` and the react-aria packages when their last usages are gone.
- `npm install` churn on `package-lock.json` (`"peer": true` metadata) must be reverted before commits, as in prior branches.
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Testing

- Per phase: `cd frontend && npm run build` must exit 0; `PYTHONPATH=$PWD:$PWD/backend python3 -m pytest backend/tests/ -q` must stay 138 passed.
- Final: build + full suite on the merged main; live smoke checklist after the user's docker rebuild (sidebar nav/⌘K/avatar menu, tenders table + filters + inspector, comments, admin user CRUD, LLM Provider save-test flow with Temperature=1, schedule/settings panels, login).

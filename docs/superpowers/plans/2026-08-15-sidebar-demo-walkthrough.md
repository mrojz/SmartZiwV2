# Sidebar Redesign + Demo Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Inline execution (superpowers:executing-plans) for this focused UI pass.

**Goal:** Replace the flat sidebar with grouped, collapsible navigation using Untitled UI icons and an amber active rail, and add a React+CSS spotlight demo walkthrough.

**Architecture:** Extract `Sidebar` and `DemoWalkthrough` into dedicated components, wire them into `App.jsx` with minimal changes, extend route normalization/hash handling for new sidebar targets, and add supporting CSS in `app-shell.css`.

**Tech Stack:** React 19, Vite, `@untitledui/icons`, existing CSS token system.

**Spec:** User request dated 2026-08-15.

## Global Constraints
- No new npm dependencies.
- Use existing design tokens (`--accent`, `--bg-*`, `--text-*`, `--border-*`, `--radius-md`, etc.).
- Amber rail for active state (`#f59e0b` / warning tone).
- Build must pass (`npm --prefix frontend run build` exits 0).
- Report result to `.superpowers/sdd/ui-overhaul-2026-08-15/phase-3-sidebar-demo.md`.

## Task 1: Create grouped collapsible Sidebar component

**Files:**
- Create: `frontend/src/components/Sidebar.jsx`
- Modify: `frontend/src/App.jsx` (remove inline `Sidebar` and `SidebarIcon`, import new component)

**Interfaces:**
- Consumes: `user`, `route`, `onNavigate(key)`, `collapsed`, `mobileOpen`, `onToggleCollapse()`, `onCloseMobile()`.
- Produces: Renders grouped nav; calls `onNavigate(item.route)` on click.

**Nav groups and items:**
1. Main: Dashboard (`HomeLine`, route `dashboard`), Tenders (`Briefcase01`, route `tenders`).
2. Intelligence: Smart-Ziw (`CpuChip01`, route `smart-ziw`), Analytics (`BarChart01`, route `analytics`).
3. Management: Admin (`Shield01`, route `admin`), Users (`Users01`, route `users`).
4. Settings: Profile (`User01`, route `profile`), LLM Config (`Settings01`, route `llm-config`), Release Notes (`Edit01`, route `release-notes`).
5. Bottom: avatar + name + Logout (`LogOut01`, route `logout`).

Each group is collapsible with a `ChevronDown`/`ChevronRight` button. Active item uses left amber rail and background highlight. Collapsed mode hides labels and group headers.

## Task 2: Add route normalization and rendering for new sidebar targets

**Files:**
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- `normalizeRoute` accepts `tenders`, `smart-ziw`, `analytics`, `users`, `llm-config`.
- `AdminPage` accepts optional `initialTab` prop (`users` | `release-notes` | `smart-ziw`).
- Render map:
  - `dashboard` / `tenders` -> dashboard view
  - `admin` -> `<AdminPage apiFetch={apiFetch} />`
  - `users` -> `<AdminPage apiFetch={apiFetch} initialTab="users" />`
  - `smart-ziw` / `llm-config` -> `<AdminPage apiFetch={apiFetch} initialTab="smart-ziw" />`
  - `analytics` -> new lightweight `AnalyticsPage` placeholder
  - `profile`, `release-notes`, `logout` unchanged

## Task 3: Add sidebar CSS for groups, chevrons, amber rail

**Files:**
- Modify: `frontend/src/styles/app-shell.css`

Add `.layout-nav-group`, `.layout-nav-group-header`, `.layout-nav-group-chevron`, `.layout-nav-group-items`, `.layout-nav-group.collapsed`, `.layout-nav-item.is-active` with amber `::before` rail.

## Task 4: Create DemoWalkthrough spotlight component

**Files:**
- Create: `frontend/src/components/DemoWalkthrough.jsx`
- Modify: `frontend/src/App.jsx` (import, render, state)
- Modify: `frontend/src/styles/app-shell.css` (walkthrough styles)

**Interfaces:**
- Props: `open`, `onClose`, `steps: [{ target, title, body, placement? }]`, `onStart?`.
- Steps (dashboard only):
  1. Filter bar (`.usb-root`)
  2. Sample tender row (`.app-table tbody tr:first-child`)
  3. Smart-Ziw trigger (button text containing "Smart-Ziw Agent" or `.project-inspector-actions button`)
- Navigation: Next / Back / Skip. Spotlight overlay dims the page, cuts a hole around the target, and shows a tooltip card.
- Dismissible via Escape, Skip, or clicking backdrop.

## Task 5: Add "Show me around" trigger

**Files:**
- Modify: `frontend/src/components/ProjectTable.jsx` empty state

Add a `Show me around` button in the empty state that calls `onStartDemo` prop. Wire prop through `App.jsx` -> `ProjectTable`.

## Task 6: Build and verify

Run `npm --prefix frontend run build`; ensure exit 0. Fix any lint/build errors.

## Task 7: Write report and commit

Write report to `.superpowers/sdd/ui-overhaul-2026-08-15/phase-3-sidebar-demo.md`, commit changes, return status + commit hash + summary.

# Smart-Ziw shadcn/ui Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the entire custom-CSS component layer of the Smart-Ziw frontend with shadcn/ui (light professional theme) and rebuild the sidebar after the Dashbar reference — zero functional change.

**Architecture:** shadcn/ui (new-york style, neutral base) installed into the existing Vite + React 19 + Tailwind v4 app with the existing `@/` alias. `App.jsx` keeps all logic (routes, state, handlers, API calls); JSX is restyled onto shadcn primitives. Legacy CSS files and custom wrappers (react-aria based dropdown/tooltip, `@untitledui/icons`) are deleted at the end.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui CLI (`npx shadcn@latest`), lucide-react icons, sonner toasts, Radix primitives (via shadcn components).

**Spec:** `docs/superpowers/specs/2026-08-15-shadcn-ui-redesign-design.md` (committed in this branch)

## Global Constraints

- **Zero functional change** — no route, API call, state, or handler behavior changes. Only the component/visual layer changes.
- **Light theme only** (no dark-mode toggle). Amber `#d97706` only for tender "opportunity" moments.
- Backend suite must stay green: `PYTHONPATH=$PWD:$PWD/backend python3 -m pytest backend/tests/ -q` → **138 passed** (run from worktree root).
- Frontend build must exit 0: `cd frontend && npm run build`.
- `npm install` churns `frontend/package-lock.json` (`"peer": true` metadata). **Always revert with `git checkout -- frontend/package-lock.json` after every install, before committing.**
- Work in worktree `/home/kali/smartZiw/eProcScraper/.worktrees/shadcn-redesign` (branch `shadcn-redesign`, base = main 7219923).
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- shadcn-generated components live in `frontend/src/components/ui/`; the `cn` helper is `frontend/src/utils/cn.ts` (new). The existing `frontend/src/utils/cx.ts` stays untouched until Task 12.
- Legacy CSS stays imported in `frontend/src/index.css` until Task 12 deletes the files; shadcn theme variables are added to `index.css` in Task 1 alongside (no removal in Task 1).
- Icons: every `@untitledui/icons` import maps to a lucide-react equivalent (mapping table in Task 2; same mappings reused app-wide).

---

### Task 1: shadcn/ui bootstrap + theme tokens

**Files:**
- Create: `frontend/components.json`, `frontend/jsconfig.json`, `frontend/src/utils/cn.ts`, `frontend/src/components/ui/*` (CLI-generated)
- Modify: `frontend/src/index.css` (add shadcn theme layer; keep legacy imports), `frontend/package.json` (deps added by CLI)
- Test: build + backend suite

**Interfaces:**
- Produces: `cn(...)` from `@/utils/cn`; shadcn primitives under `@/components/ui/*`: button, input, label, select, textarea, checkbox, switch, table, tabs, card, badge, avatar, dialog, dropdown-menu, tooltip, separator, scroll-area, sheet, sonner, command, sidebar, skeleton, progress, radio-group, accordion. CSS tokens `--background`, `--foreground`, `--primary` (blue), `--muted`, `--border`, `--card`, `--destructive` in `:root`.

- [ ] **Step 1: Create jsconfig.json for the CLI**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Step 2: Run shadcn init (new-york, neutral)**

```bash
cd frontend
npx shadcn@latest init -y -b neutral -d
```

Expected: writes `components.json`, adds `src/index.css` theme variables, creates `src/lib/utils.ts`. If the CLI errors on missing tsconfig, retry after Step 1 (jsconfig) — the CLI accepts jsconfig.

- [ ] **Step 3: Move the cn helper**

```bash
mkdir -p frontend/src/utils
mv frontend/src/lib/utils.ts frontend/src/utils/cn.ts   # from worktree root
```
Then edit `frontend/src/utils/cn.ts`: replace `import { clsx, type ClassValue } from "clsx"` stays; the only change is the file location — also update the one self-reference in `components.json` so the `aliases.utils` points to `@/utils/cn`.

- [ ] **Step 4: Add all components**

```bash
cd frontend && npx shadcn@latest add -y button input label select textarea checkbox switch table tabs card badge avatar dialog dropdown-menu tooltip separator scroll-area sheet sonner command sidebar skeleton progress radio-group accordion
```

- [ ] **Step 5: Theme polish in `frontend/src/index.css`**

Keep the generated `:root` token block; set these exact values (light professional):

```css
:root {
  --background: oklch(0.985 0 0);      /* #f8fafc */
  --foreground: oklch(0.27 0.02 250);   /* slate-800 */
  --card: oklch(1 0 0);                 /* #fff */
  --card-foreground: oklch(0.27 0.02 250);
  --primary: oklch(0.55 0.2 260);       /* blue hsl(221 83% 53%) */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.955 0.005 250);  /* slate-100 */
  --secondary-foreground: oklch(0.33 0.02 250);
  --muted: oklch(0.955 0.005 250);
  --muted-foreground: oklch(0.5 0.02 250); /* slate-500 */
  --border: oklch(0.92 0.005 250);      /* slate-200 */
  --input: oklch(0.92 0.005 250);
  --ring: oklch(0.55 0.2 260);
  --radius: 0.5rem;
  --destructive: oklch(0.55 0.2 25);    /* red #b91c1c */
}
```

Keep the generated `@import "tailwindcss";` line (Tailwind v4) and the generated `@theme inline` / `@layer base` blocks that reference the tokens. **Do not remove the existing legacy `@import './styles/...'` lines** — legacy pages still need them until Task 12.

- [ ] **Step 6: Revert lockfile churn and verify**

```bash
git checkout -- frontend/package-lock.json
cd frontend && npm run build
cd .. && PYTHONPATH=$PWD:$PWD/backend python3 -m pytest backend/tests/ -q | tail -1
```
Expected: build exit 0 (warnings about chunk size are pre-existing and fine); `138 passed`.

- [ ] **Step 7: Commit**

```bash
git add frontend/components.json frontend/jsconfig.json frontend/src/utils/cn.ts frontend/src/components/ui frontend/src/index.css frontend/package.json
git commit -m "feat(ui): bootstrap shadcn/ui with light professional theme tokens

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Sidebar rebuild (Dashbar reference, light)

**Files:**
- Rewrite: `frontend/src/components/Sidebar.jsx`
- Modify: `frontend/src/App.jsx` (wrap layout with `SidebarProvider`; pass `onNavigate` unchanged; wire ⌘K + sidebar search)
- Test: build + backend suite + visual checklist

**Interfaces:**
- Consumes: shadcn `sidebar` component (`@/components/ui/sidebar`), `cn` from Task 1, lucide-react.
- Produces: `Sidebar` default export with the SAME props as today: `{ user, route, onNavigate, collapsed, mobileOpen, onToggleCollapse, onCloseMobile }` — plus a new optional prop `onOpenCommand`. Also keep exporting `Avatar` (App.jsx header imports it) backed by shadcn `Avatar` primitives.
- Icon mapping (use everywhere in later tasks too): `HomeLine→House`, `Briefcase01→Briefcase`, `BarChart01→ChartColumn`, `Shield01→Shield`, `Settings01→Settings`, `User01→User`, `Clock→CalendarClock`, `LogOut01→LogOut`, `Menu02→PanelLeftClose` (toggle), `ChevronDown→ChevronDown`, `Users01→Users`, `CpuChip01→Cpu`, `Edit01→PenLine`, `RefreshCw01→RefreshCw`, `DotsVertical→MoreVertical`, `UserX01→UserX`, `UserCheck01→UserCheck`, `Key01→KeyRound`, `Bell01→Bell`, `X01→X`, `SearchMd→Search`, `Calendar→CalendarDays`, `ArrowLeft→ArrowLeft`, `Plus→Plus`, `Check→Check`, `AlertCircle→CircleAlert`, `TrendingUp→TrendingUp`, `FileText01→FileText`, `GitBranch01→GitBranch`, `Globe01→Globe`.

- [ ] **Step 1: Write the new Sidebar.jsx skeleton**

Structure (all shadcn `Sidebar*` parts), matching the spec:

```jsx
import { House, Briefcase, ChartColumn, Shield, Settings as SettingsIcon, User as UserIcon, CalendarClock, LogOut, ChevronDown, Search } from 'lucide-react';
import { Sidebar as SidebarBase, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar';
import { Avatar } from '@/components/ui/avatar';
import { AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const NAV_GROUPS = [
    { label: 'Main', items: [
        { key: 'dashboard', label: 'Dashboard', icon: House },
        { key: 'tenders', label: 'Tenders', icon: Briefcase },
    ]},
    { label: 'Intelligence', items: [
        { key: 'analytics', label: 'Analytics', icon: ChartColumn },
    ]},
    { label: 'Management', adminOnly: true, items: [
        { key: 'admin', label: 'Admin', icon: Shield },
        { key: 'schedule', label: 'Schedule', icon: CalendarClock },
        { key: 'settings', label: 'Settings', icon: SettingsIcon },
    ]},
    { label: 'Settings', items: [
        { key: 'profile', label: 'Profile', icon: UserIcon },
    ]},
];
```

- Header: brand row (existing `/forvis-mazars-logo.svg` img + "Procurement Watch" name) + a `SidebarInput` search field with a ⌘K badge on the right; clicking/focusing it calls `onOpenCommand()`.
- Body: `NAV_GROUPS.filter(g => !g.adminOnly || user?.role === 'admin')` mapped to collapsible `SidebarGroup`s (shadcn's built-in collapsible groups — no custom `collapsedGroups` state needed), items as `SidebarMenuButton isActive={route === item.key} onClick={() => { onNavigate(item.key); onCloseMobile(); }}` with icon + label.
- Footer: user row using shadcn `Avatar` (`AvatarImage` if `user.avatarUrl`, else `AvatarFallback` initials) + name + role + a LogOut `SidebarMenuButton` calling `onNavigate('logout')`.
- Keep the existing collapse/mobile behavior via `SidebarProvider` state (see Step 3) and `SidebarTrigger`.
- Delete the old `initials`/`colorFromSeed` helpers only if unused after the rewrite (Avatar fallback still needs initials — keep `initials`).

- [ ] **Step 2: Keep the `Avatar` export contract**

`export function Avatar({ user, size = 34 })` must still exist with the same props (App.jsx header uses it until Task 3). Implement it with shadcn `Avatar`/`AvatarImage`/`AvatarFallback` and inline `style={{ width: size, height: size }}`.

- [ ] **Step 3: Wire SidebarProvider + ⌘K in App.jsx**

- Import `{ SidebarProvider }` from `@/components/ui/sidebar` and wrap the app layout (the element containing `<Sidebar …>` and the content column) in `<SidebarProvider>`.
- Add a `commandOpen` state near the other UI state. Add a `useEffect` listening for `keydown` on `window`: when `(e.metaKey || e.ctrlKey) && e.key === 'k'` → `e.preventDefault(); setCommandOpen(true)`.
- Render a shadcn `Command` dialog (`Dialog` + `CommandInput` + `CommandList` + `CommandItem`): items = the sidebar nav keys with labels, plus a "Search tenders" item that closes the dialog, navigates to `tenders`, and focuses the unified search. Wire the sidebar's `onOpenCommand={() => setCommandOpen(true)}`.
- The existing `navigate(key)` function stays byte-identical (schedule/settings open panels, logout, route keys).

- [ ] **Step 4: Verify**

```bash
cd frontend && npm run build
cd .. && PYTHONPATH=$PWD:$PWD/backend python3 -m pytest backend/tests/ -q | tail -1
```
Expected: build exit 0, `138 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.jsx frontend/src/App.jsx
git commit -m "feat(ui): Dashbar-style shadcn sidebar with command palette

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Header + avatar menu + sonner toasts

**Files:** Modify `frontend/src/App.jsx` (header JSX + toast system), delete usage of `components/base/dropdown` and `components/base/tooltip` for the header (files themselves deleted in Task 12).

**Interfaces:** Consumes shadcn tooltip, dropdown-menu, badge, button, avatar, sonner; lucide icons per the Task 2 mapping.

- [ ] **Step 1: Replace the avatar dropdown** with shadcn `DropdownMenu`: `DropdownMenuTrigger` (button with `Avatar`), `DropdownMenuContent` with items Profile / Admin (admin only) / Settings / Schedule / Separator / Logout. `onSelect={(key) => handleHeaderMenuAction(key)}` — the existing handler is kept as-is.
- [ ] **Step 2: Replace icon action buttons** (sync, notifications) with shadcn `Tooltip` + `Button variant="ghost" size="icon"`; notification badge uses shadcn `Badge`. Keep the existing `onPress`/`onClick` handlers and `notificationsOpen` state logic identical.
- [ ] **Step 3: Migrate the toast system to sonner.** Find the current toast state/helpers in App.jsx (search `toast`) and the `toast`-rendering JSX; replace the rendering with the `Toaster` component (`@/components/ui/sonner`), and every `toast(...)` call site with `import { toast } from 'sonner'` using the same message strings and variant mapping (error → `toast.error`, info/success → `toast` / `toast.success`). No message text changes.
- [ ] **Step 4: PageHeader restyle** — the `PageHeader` component switches to shadcn-consistent classes (`text-2xl font-semibold tracking-tight` title, `text-sm text-muted-foreground` subtitle). Delete the now-unused `.layout-page-header*`-dependent admin overrides only if their elements changed (keep `.admin-users-page .layout-page-header` CSS until Task 9 restyles the admin page).
- [ ] **Step 5: Verify** — build exit 0 + `138 passed` (same commands as Task 1 Step 6).
- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): shadcn header, avatar menu, and sonner toasts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Auth screens (login + force-password)

**Files:** Modify `frontend/src/App.jsx` — `LoginPage` and `ForcePasswordPage` components.

- [ ] **Step 1:** Restyle both to shadcn `Card` (centered, `max-w-md`), `Label`, `Input` (with `type` preserved), `Button` (primary, full width, `disabled` states kept), and the existing error text as a `p` with `text-destructive text-sm`. Keep all `onLogin`/`onChange` handlers, `authError`/`mustChangeError` display logic, and `bootstrapStatus` states identical.
- [ ] **Step 2:** Replace `class` strings like `login-*`/`auth-*` with shadcn utility classes; leave the legacy CSS files in place (deleted in Task 12).
- [ ] **Step 3: Verify** — build exit 0 + `138 passed`.
- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): restyle auth screens with shadcn card and inputs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Tenders surfaces (search, filters, table)

**Files:**
- Modify: `frontend/src/components/UnifiedSearchBar.jsx`, `frontend/src/components/ProjectTable.jsx`, `frontend/src/App.jsx` (Tenders route: filter bar, table region, pagination, badges)

- [ ] **Step 1: UnifiedSearchBar** — outer container becomes a shadcn-styled bar (`rounded-lg border bg-card shadow-sm`), input → shadcn `Input` with a `Search` lucide icon inside, chips → shadcn `Badge` (variant outline) with X remove buttons, and the 7-day auto-filter toast text unchanged (sonner from Task 3).
- [ ] **Step 2: Filter bar** — selects/date inputs → shadcn `Select` (SelectTrigger/SelectValue/SelectContent/SelectItem) or `Input type="date"` as today; "Clear filters" → `Button variant="ghost"`. Keep every state setter identical.
- [ ] **Step 3: ProjectTable** — shadcn `Table` family (TableHeader/TableBody/TableRow/TableHead/TableCell); source/status/region badges → shadcn `Badge` with the existing status colors mapped to shadcn variants (`success` style via `bg-green-700 text-white` classes where the design uses green, opportunity moments keep `bg-amber-600 text-white`); row click → keep `onRowClick`; sort header clicks → keep handlers; pagination → shadcn `Button variant="outline" size="sm"` + plain page numbers.
- [ ] **Step 4: Verify** — build exit 0 + `138 passed`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/UnifiedSearchBar.jsx frontend/src/components/ProjectTable.jsx frontend/src/App.jsx
git commit -m "feat(ui): shadcn tenders search, filters, and table

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Project inspector + Smart-Ziw run UI

**Files:** Modify `frontend/src/App.jsx` (project inspector drawer region, Smart-Ziw run/enrichment region, action buttons).

- [ ] **Step 1:** The inspector drawer becomes shadcn `Sheet` (SheetContent side right, `SheetHeader`/`SheetTitle`/`SheetDescription`), body scrolls via `ScrollArea`; close handlers map to `SheetClose`/`onOpenChange`. All tabs/sections inside keep their content and handlers.
- [ ] **Step 2:** Action buttons → shadcn `Button` variants (primary/default, secondary/outline, destructive for delete-flows if any exist); Smart-Ziw run card → `Card` with `CardHeader/CardTitle/CardContent`; enrichment sections keep data renderers, restyled with `Badge`/`Separator`.
- [ ] **Step 3:** Replace any remaining `modal-*`/`drawer-*` classes in this region with shadcn utilities.
- [ ] **Step 4: Verify** — build exit 0 + `138 passed`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): shadcn project inspector sheet and Smart-Ziw run UI

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Comments panel + @SmartZiw chat

**Files:** Modify `frontend/src/App.jsx` (`CommentsPanel` component and its render sites).

- [ ] **Step 1:** Panel overlay → shadcn `Dialog`/`Sheet` (match current open/close API: `open`, `onClose` prop kept, wired to `onOpenChange`). Comment input → `Textarea` + `Button` (disabled logic identical). Threads/timeline → `Separator` + avatar via shadcn `Avatar`; "mine" highlight keeps its data logic, restyled.
- [ ] **Step 2:** The @SmartZiw mention/reply flow (chat section) keeps all state/handlers; only container/input/button visuals change.
- [ ] **Step 3: Verify** — build exit 0 + `138 passed`.
- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): shadcn comments panel and Smart-Ziw chat

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Dashboard

**Files:** Modify `frontend/src/App.jsx` (dashboard route region).

- [ ] **Step 1:** Stat cards → shadcn `Card` with the existing CSS/SVG sparklines kept (no chart lib). Recent-activity list → shadcn `Separator` + `Badge`s. Quick links/empty states → `Button`s + `Card`.
- [ ] **Step 2: Verify** — build exit 0 + `138 passed`.
- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): shadcn dashboard cards

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Admin page (tabs, user table, user drawer)

**Files:** Modify `frontend/src/App.jsx` (AdminPage: header actions, tabs, user table, user create/edit drawer, password reset, dots menu).

- [ ] **Step 1:** Segmented tabs → shadcn `Tabs` (TabsList/TabsTrigger/TabsContent) with `value={adminTab}` and `onValueChange={setAdminTab}`; tab labels unchanged (User Management / Release Notes / Smart-Ziw Settings / LLM Provider).
- [ ] **Step 2:** User table → shadcn `Table` family + `Badge` for roles/status; search/toolbar inputs → `Input`/`Select`; pagination → `Button`; per-row actions menu (`Dropdown.DotsButton` + `Dropdown.Menu`) → shadcn `DropdownMenu` with identical items and `onSelect` handler mapping (edit/reset/toggle).
- [ ] **Step 3:** User create/edit modal (`mode === 'create' ? 'Create User' : 'Edit User'`) → shadcn `Dialog` with `Label`/`Input`/`Select`/`Switch` (for active) and the same submit/saving logic; admin stats cards → `Card`; header "Create User" / "New Release Note" buttons → shadcn `Button`.
- [ ] **Step 4: Verify** — build exit 0 + `138 passed`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): shadcn admin page, tabs, user table and drawer

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Smart-Ziw + LLM Provider cards

**Files:** Modify `frontend/src/App.jsx` (Smart-Ziw config card + LLM Provider card regions).

- [ ] **Step 1:** Smart-Ziw config card: toggle rows → shadcn `Switch` + `Label`; text/password inputs → `Input`; research timeout number input → `Input type="number"` with the same coercion; Save button → `Button` (loading label unchanged).
- [ ] **Step 2:** LLM Provider card: source radio options → shadcn `RadioGroup` (`value={llmSource}`, `onValueChange` maps 'environment'→`smart_ziw_llm_provider: 'deepseek'` and 'lightllm'→`'lightllm'` — keep the existing `llmDiscoverySeq`/`setLlmModelsLoading` side effects in the handlers); LightLLM fields → `Input`/`Select`; "Refresh models" → `Button variant="outline"` with the same disabled logic; models status → `p` with `text-sm text-muted-foreground`.
- [ ] **Step 3:** "Advanced settings" `<details>` → shadcn `Collapsible` (CollapsibleTrigger styled like a muted link/button with chevron, CollapsibleContent) — the two number inputs (`llm_temperature` clamp 0–2, `llm_max_tokens` ≥1) keep their exact `onChange` coercion and helper text; the Save button keeps `testAndSaveLlmConfig` and its Testing…/Saving... labels.
- [ ] **Step 4: Verify** — build exit 0 + `138 passed`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): shadcn Smart-Ziw and LLM Provider settings cards

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Schedule, Config, Sync panels + Release Notes

**Files:** Modify `frontend/src/components/SchedulePanel.jsx`, `ConfigPanel.jsx`, `SyncPanel.jsx`, `ClockTimePicker.jsx`, `frontend/src/App.jsx` (`ReleaseNotesPage` + release-notes admin tab).

- [ ] **Step 1:** Each panel's overlay → shadcn `Sheet` or `Dialog` (keep `open`/`onClose` props); inner form controls → `Input`/`Select`/`Switch`/`Button`; `ClockTimePicker` keeps its time logic, restyled with shadcn `Button`/`Input` classes.
- [ ] **Step 2:** `ReleaseNotesPage` + the admin release-notes tab editor → `Card` + `Input`/`Textarea`/`Button`; timeline cards keep data order, restyled.
- [ ] **Step 3: Verify** — build exit 0 + `138 passed`.
- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SchedulePanel.jsx frontend/src/components/ConfigPanel.jsx frontend/src/components/SyncPanel.jsx frontend/src/components/ClockTimePicker.jsx frontend/src/App.jsx
git commit -m "feat(ui): shadcn schedule, config, sync panels and release notes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: Analytics, demo walkthrough, and legacy cleanup

**Files:**
- Modify: `frontend/src/components/AnalyticsPage.jsx`, `frontend/src/components/DemoWalkthrough.jsx`
- Delete: `frontend/src/styles/*.css` (all legacy modules: app-shell, filters, header, toolbar, table, table-cells, actions, badges-pagination, panels, base, demo-walkthrough, untitledui), `frontend/src/components/base/`, `frontend/src/components/foundations/` (if unused after sweep), `frontend/src/utils/cx.ts` and `is-react-component.ts` if unused
- Modify: `frontend/src/index.css` (remove legacy `@import` lines), `frontend/package.json` (remove `@untitledui/icons`, `untitledui`, `react-aria`, `react-aria-components`, `tailwindcss-react-aria-components`, `@react-stately/utils`), `frontend/src/App.jsx` (any leftover legacy classNames)

- [ ] **Step 1: AnalyticsPage** — placeholder cards → shadcn `Card`/`Badge`/`Button`; keep its placeholder copy.
- [ ] **Step 2: DemoWalkthrough** — spotlight overlay logic unchanged; restyle popovers with shadcn `Card` + `Button`; update the `target` class selectors in the DEMO_STEPS array only if the shadcn migration changed those exact class names (check `.usb-root`, `.app-table`, `.project-inspector-actions` — if they no longer exist, update to the new shadcn class hooks; if they were kept as stable hooks, leave them).
- [ ] **Step 3: Sweep for legacy class usage**

```bash
cd frontend && grep -rn "auth-input\|profile-btn\|table-wrapper\|modal-\|drawer-\|admin-users\|layout-sidebar\|layout-page-title\|llm-source\|release-notes-page" src --include="*.jsx" --include="*.tsx" | grep -v "components/ui" || true
```
Every hit must be migrated (replace with shadcn utilities/classes) before deletion. Repeat until empty.
- [ ] **Step 4: Delete legacy CSS and wrappers; strip index.css imports; drop deps; `npm install` then revert lockfile churn** (the revert keeps only the dependency removal diff).
- [ ] **Step 5: Final verify**

```bash
cd frontend && npm run build          # exit 0
cd .. && PYTHONPATH=$PWD:$PWD/backend python3 -m pytest backend/tests/ -q | tail -1   # 138 passed
git status --porcelain                 # only intended changes
```
- [ ] **Step 6: Commit**

```bash
git add -A frontend/src frontend/package.json frontend/package-lock.json
git commit -m "feat(ui): shadcn analytics and walkthrough; remove legacy CSS and deps

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: phases 1–3 map to Tasks 1–4 / 5–8 / 9–12. Sidebar structure (search+⌘K, groups, profile footer, no card) covered in Task 2. Amber-opportunity rule applied in Tasks 5/6/9 badge mappings. Zero-functional-change constraint is in every task's step text. Lockfile-revert and commit trailer are global constraints.
- Placeholder scan: no TBD/TODO. Icon mapping table centralizes the lucide swap.
- Type/name consistency: `onOpenCommand`, `commandOpen`, `navigate(key)` keys `dashboard|tenders|analytics|admin|schedule|settings|profile|logout` are consistent across Tasks 2/3/9/10. `cn` lives at `@/utils/cn` (Task 1) and is consumed from there in later tasks.

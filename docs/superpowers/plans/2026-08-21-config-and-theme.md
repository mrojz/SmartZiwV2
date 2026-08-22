# Phase 4 Configuration Polish + Phase 5 Design System & Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize admin settings with grouped tabs and field-level validation, unify save feedback to `sonner` toasts, and add a system-default dark-mode toggle plus design-system standardization.

**Architecture:** Keep existing backend APIs and frontend route structure. Add small pure validation helpers. Refactor admin `Tabs` labels into visual groups. Extract shared layout primitives. Add a custom `ThemeProvider` context that toggles a `.dark` class on `<html>` and persists preference in `localStorage`.

**Tech Stack:** React 19, Vite, Tailwind CSS v4, shadcn/ui (radix-nova), `sonner`, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-21-config-and-theme-design.md`

## Global Constraints

- No new runtime dependencies.
- No backend endpoint or payload changes.
- `npm run build` must exit cleanly.
- `PYTHONPATH=backend python -m pytest backend/tests -q` must remain 205/205.
- Every new pure helper must have a passing Node test before it is used in components.
- Light theme must remain functional; dark mode is additive.
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `frontend/src/utils/validation.js` | Pure validation helpers (`isRequired`, `isEmail`, `isUrl`, `isNumberInRange`, `matchesPassword`). |
| `frontend/src/utils/validation.test.js` | Node tests for validation helpers. |
| `frontend/src/components/PageHeader.jsx` | Shared page title + subtitle wrapper. |
| `frontend/src/components/SectionCard.jsx` | Shared `rounded-lg border bg-card p-6` card wrapper. |
| `frontend/src/components/ThemeProvider.jsx` | Theme context, localStorage persistence, system-preference resolution, html class toggling. |
| `frontend/src/index.css` | Add `--success`/`--success-foreground` tokens; ensure `.dark` variables are complete. |
| `frontend/index.html` | Remove hardcoded `color-scheme`; add inline script to avoid flash. |
| `frontend/src/App.jsx` | Use `PageHeader`, `ThemeProvider`, grouped admin tabs, theme toggle wiring, toast feedback. |
| `frontend/src/components/TendersPage.jsx` | Use shared `PageHeader`. |
| `frontend/src/components/SettingsPage.jsx` | Toast feedback, minor validation. |
| `frontend/src/components/SchedulePage.jsx` | Toast feedback, minor validation. |
| `frontend/src/components/ProfilePage.jsx` (in App.jsx) | Validation + toast feedback. |

---

### Task 1: Add validation helpers and tests

**Files:**
- Create: `frontend/src/utils/validation.js`
- Create: `frontend/src/utils/validation.test.js`

**Interfaces:**
- Produces: `isRequired(value)`, `isEmail(value)`, `isUrl(value)`, `isNumberInRange(value, min, max)`, `matchesPassword(a, b)`.
- Each returns `string | undefined` (error message or valid).

- [ ] **Step 1: Implement helpers**

```js
export function isRequired(value) {
    const str = typeof value === 'string' ? value : String(value ?? '');
    return str.trim() ? undefined : 'This field is required';
}

export function isEmail(value) {
    if (!value) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return 'Enter a valid email address';
    return undefined;
}

export function isUrl(value) {
    if (!value) return 'URL is required';
    try {
        const url = new URL(String(value));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'URL must use http or https';
        return undefined;
    } catch {
        return 'Enter a valid URL';
    }
}

export function isNumberInRange(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'Must be a number';
    if (min !== undefined && num < min) return `Must be at least ${min}`;
    if (max !== undefined && num > max) return `Must be at most ${max}`;
    return undefined;
}

export function matchesPassword(a, b) {
    if (!a) return 'Password is required';
    if (String(a).length < 8) return 'Password must be at least 8 characters';
    if (a !== b) return 'Passwords do not match';
    return undefined;
}
```

- [ ] **Step 2: Add tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isRequired, isEmail, isUrl, isNumberInRange, matchesPassword } from './validation.js';

describe('validation', () => {
    it('requires non-empty values', () => {
        assert.strictEqual(isRequired('hello'), undefined);
        assert.strictEqual(isRequired('  '), 'This field is required');
    });
    it('validates email', () => {
        assert.strictEqual(isEmail('a@b.com'), undefined);
        assert.strictEqual(isEmail('bad'), 'Enter a valid email address');
    });
    it('validates URL', () => {
        assert.strictEqual(isUrl('https://example.com'), undefined);
        assert.strictEqual(isUrl('ftp://example.com'), 'URL must use http or https');
        assert.strictEqual(isUrl('not a url'), 'Enter a valid URL');
    });
    it('validates number range', () => {
        assert.strictEqual(isNumberInRange(0.5, 0, 2), undefined);
        assert.strictEqual(isNumberInRange(3, 0, 2), 'Must be at most 2');
    });
    it('validates password match', () => {
        assert.strictEqual(matchesPassword('password123', 'password123'), undefined);
        assert.strictEqual(matchesPassword('short', 'short'), 'Password must be at least 8 characters');
        assert.strictEqual(matchesPassword('password123', 'other'), 'Passwords do not match');
    });
});
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && node --test src/utils/validation.test.js
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/validation.js frontend/src/utils/validation.test.js
git commit -m "feat(frontend): add validation helpers and tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Extract shared layout primitives

**Files:**
- Create: `frontend/src/components/PageHeader.jsx`
- Create: `frontend/src/components/SectionCard.jsx`
- Modify: `frontend/src/App.jsx` (replace duplicated header markup)
- Modify: `frontend/src/components/TendersPage.jsx` (replace duplicated header markup)

**Interfaces:**
- `PageHeader({ title, subtitle, children })`
- `SectionCard({ title, description, children, className })`

- [ ] **Step 1: Create PageHeader**

```jsx
export default function PageHeader({ title, subtitle, children }) {
    return (
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
                {subtitle ? <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            {children ? <div className="flex items-center gap-2">{children}</div> : null}
        </div>
    );
}
```

- [ ] **Step 2: Create SectionCard**

```jsx
import { cn } from '@/utils/cn';

export default function SectionCard({ title, description, children, className }) {
    return (
        <div className={cn('rounded-lg border bg-card p-6', className)}>
            {title ? <h2 className="text-base font-semibold text-foreground">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            {title || description ? <div className="mb-4" /> : null}
            {children}
        </div>
    );
}
```

- [ ] **Step 3: Update App.jsx and TendersPage.jsx**

Replace duplicated page header markup with `PageHeader`. Keep existing action buttons passed as children.

- [ ] **Step 4: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PageHeader.jsx frontend/src/components/SectionCard.jsx frontend/src/App.jsx frontend/src/components/TendersPage.jsx
git commit -m "refactor(frontend): extract PageHeader and SectionCard primitives

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Reorganize AdminPage tabs into logical groups

**Files:**
- Modify: `frontend/src/App.jsx` (AdminPage tabs list)

**Interfaces:**
- Tabs remain the same but are rendered with group labels in the trigger text.

- [ ] **Step 1: Update tab definitions**

Replace the flat `TABS` array with grouped labels:

```js
const ADMIN_TABS = [
    { id: 'users', group: 'Administration', label: 'Users' },
    { id: 'smart-ziw', group: 'Smart-Ziw', label: 'Agent' },
    { id: 'llm', group: 'Smart-Ziw', label: 'LLM Provider' },
    { id: 'system-prompts', group: 'Smart-Ziw', label: 'System Prompts' },
    { id: 'skills', group: 'Smart-Ziw', label: 'Skills' },
    { id: 'mcp-servers', group: 'Smart-Ziw', label: 'MCP Servers' },
    { id: 'release-notes', group: 'Content', label: 'Release Notes' },
];
```

Render tab trigger as:

```jsx
<span className="hidden sm:inline">{tab.group} › </span>{tab.label}
```

On small screens show only the label.

- [ ] **Step 2: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): group admin settings tabs logically

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Add validation + toast feedback to user forms

**Files:**
- Modify: `frontend/src/App.jsx` (AdminPage user drawer, reset modal, delete/toggle dialogs)
- Modify: `frontend/src/App.jsx` (ProfilePage change-password form)

**Interfaces:**
- Use validation helpers from Task 1.
- Replace `setMessage` with `toast.success`/`toast.error`.

- [ ] **Step 1: User create/edit drawer validation**

Before submit, validate:
- `name`: required
- `email`: required + email format
- `role`: required

Show inline errors under each field. Block submit if invalid.

- [ ] **Step 2: Reset password validation**

If a new password is provided, require ≥ 8 chars.

- [ ] **Step 3: Profile change-password validation**

Use `matchesPassword` for new/confirm; require current password if new password provided.

- [ ] **Step 4: Toast feedback**

Convert user create/save/reset/delete/toggle and profile save/change-password success/error messages from inline banners to `sonner` toast.

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): validate user forms and use toast feedback

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Add validation + toast feedback to Smart-Ziw and LLM Provider tabs

**Files:**
- Modify: `frontend/src/App.jsx` (Smart-Ziw settings, LLM Provider sections)

**Interfaces:**
- Validate Smart-Ziw: repo path required when agent enabled; GitLab URL required when GitLab push enabled; timeout ≥ 1.
- Validate LLM: base URL required + URL format for LightLLM; temperature 0–2; max tokens 1–128000.
- Toast feedback for save/test.

- [ ] **Step 1: Smart-Ziw validation**

Build an errors object keyed by field. Show inline errors. Block save if invalid.

- [ ] **Step 2: LLM Provider validation**

When provider is not `deepseek`/environment mode, validate base URL and numeric ranges.

- [ ] **Step 3: Toast feedback**

Replace `setMessage('Smart-Ziw config saved.')` and similar with `toast.success`/`toast.error`.

- [ ] **Step 4: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): validate Smart-Ziw and LLM Provider settings

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Add validation + toast feedback to remaining admin tabs

**Files:**
- Modify: `frontend/src/App.jsx` (Release Notes, Skills, MCP Servers, System Prompts)

**Interfaces:**
- Release Notes: version and title required.
- Skills: URL required and valid when fetching.
- MCP Servers: name required; command or URL required depending on transport; URL format if transport is SSE.
- System Prompts: no hard validation beyond toast feedback.

- [ ] **Step 1: Release Notes validation**

Inline errors for version/title. Toast on save.

- [ ] **Step 2: Skills validation**

Validate skill fetch URL. Toast on fetch/save errors.

- [ ] **Step 3: MCP validation**

Validate required fields and URL format. Keep test-before-save gate.

- [ ] **Step 4: System Prompts toast feedback**

Replace any remaining inline message with toast.

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): validate remaining admin tabs and use toast feedback

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Update SettingsPage and SchedulePage feedback

**Files:**
- Modify: `frontend/src/components/SettingsPage.jsx`
- Modify: `frontend/src/components/SchedulePage.jsx`

**Interfaces:**
- Replace inline status banners with `sonner` toast.
- Add minor validation (duplicate keywords/regions/countries already exist; keep that logic).

- [ ] **Step 1: SettingsPage toast feedback**

Convert `status` string to `toast.success`/`toast.error`.

- [ ] **Step 2: SchedulePage toast feedback**

Convert `saveResult` banner to toast.

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SettingsPage.jsx frontend/src/components/SchedulePage.jsx
git commit -m "feat(frontend): use toast feedback in Settings and Schedule pages

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Add success color tokens

**Files:**
- Modify: `frontend/src/index.css`

**Interfaces:**
- Add `--success` and `--success-foreground` to `:root` and `.dark`.

- [ ] **Step 1: Add tokens**

```css
:root {
    /* ...existing... */
    --success: oklch(0.55 0.15 145);
    --success-foreground: oklch(0.985 0 0);
}

.dark {
    /* ...existing... */
    --success: oklch(0.65 0.15 145);
    --success-foreground: oklch(0.145 0 0);
}
```

Add to `@theme inline`:

```css
--color-success: var(--success);
--color-success-foreground: var(--success-foreground);
```

- [ ] **Step 2: Replace hardcoded success colors**

Find `text-green-600` / `bg-green-600/10` / `bg-green-600` usages and swap to `text-success bg-success/10` etc.

- [ ] **Step 3: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css frontend/src/components/*.jsx frontend/src/App.jsx
git commit -m "feat(frontend): add semantic success tokens and replace hardcoded greens

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Implement ThemeProvider and theme toggle

**Files:**
- Create: `frontend/src/components/ThemeProvider.jsx`
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.jsx` (wrap app with ThemeProvider)
- Modify: `frontend/src/App.jsx` (add theme toggle in avatar dropdown and ⌘K palette)

**Interfaces:**
- `ThemeProvider` exposes `{ theme, setTheme, resolvedTheme }`.
- `theme` is `'light' | 'dark' | 'system'`; `resolvedTheme` is `'light' | 'dark'`.

- [ ] **Step 1: Create ThemeProvider**

```jsx
import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({ theme: 'system', setTheme: () => {}, resolvedTheme: 'light' });

const STORAGE_KEY = 'pw-theme';

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
    const [theme, setThemeState] = useState(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        return ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
    });
    const [resolvedTheme, setResolvedTheme] = useState(() => (theme === 'system' ? getSystemTheme() : theme));

    useEffect(() => {
        const resolved = theme === 'system' ? getSystemTheme() : theme;
        setResolvedTheme(resolved);
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(resolved);
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.setAttribute('content', 'light dark');
    }, [theme]);

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            if (theme === 'system') {
                const resolved = getSystemTheme();
                setResolvedTheme(resolved);
                const root = window.document.documentElement;
                root.classList.remove('light', 'dark');
                root.classList.add(resolved);
            }
        };
        media.addEventListener('change', handler);
        return () => media.removeEventListener('change', handler);
    }, [theme]);

    const setTheme = (next) => {
        localStorage.setItem(STORAGE_KEY, next);
        setThemeState(next);
    };

    return (
        <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export const useTheme = () => useContext(ThemeContext);
```

- [ ] **Step 2: Update index.html**

Remove the hardcoded `color-scheme` meta or change to `light dark`:

```html
<meta name="color-scheme" content="light dark" />
```

Add a small inline script before the app script to avoid flash:

```html
<script>
  (function () {
    const theme = localStorage.getItem('pw-theme') || 'system';
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.classList.add(resolved);
  })();
</script>
```

- [ ] **Step 3: Wrap main.jsx**

```jsx
import { ThemeProvider } from './components/ThemeProvider';

root.render(
    <ThemeProvider>
        <App />
    </ThemeProvider>
);
```

- [ ] **Step 4: Add toggle**

In the header avatar dropdown, add:

```jsx
<DropdownMenuSub>
    <DropdownMenuSubTrigger><SunMoon className="mr-2 h-4 w-4" />Appearance</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
        <DropdownMenuItem onSelect={() => setTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>Dark</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>System</DropdownMenuItem>
    </DropdownMenuSubContent>
</DropdownMenuSub>
```

Add a "Toggle theme" command item in the ⌘K palette that cycles light → dark → system.

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ThemeProvider.jsx frontend/index.html frontend/src/main.jsx frontend/src/App.jsx
git commit -m "feat(frontend): system-default dark mode with ThemeProvider and toggle

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Standardize spacing, typography, and transitions

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/TendersPage.jsx`
- Modify: `frontend/src/components/ProjectTable.jsx`
- Modify: `frontend/src/components/ProjectInspector.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Replace ad-hoc page headers with `PageHeader` where not already done.
- Use `SectionCard` for admin settings sections.
- Add `transition-colors duration-200` to custom interactive chips/buttons.

- [ ] **Step 1: Audit and standardize**

- Replace any remaining duplicated header markup with `PageHeader`.
- Wrap admin settings sections in `SectionCard`.
- Add transitions to custom interactive elements (filter chips, assignment pills, source toggles).

- [ ] **Step 2: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/TendersPage.jsx frontend/src/components/ProjectTable.jsx frontend/src/components/ProjectInspector.jsx frontend/src/index.css
git commit -m "style(frontend): standardize spacing, typography, and add subtle transitions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Final verification

**Files:** all of the above.

- [ ] **Step 1: Run backend tests**

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
```

Expected: 205 passed.

- [ ] **Step 2: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: clean build.

- [ ] **Step 3: Run helper tests**

```bash
cd frontend && node --test src/utils/validation.test.js src/utils/tenderRouting.test.js src/utils/projects.test.js src/utils/tenderDisplay.test.js
```

Expected: all pass.

- [ ] **Step 4: Manual smoke checks**

1. Admin tabs show group labels.
2. Empty required admin fields show inline errors and block save.
3. Valid saves show toast.
4. Theme toggles light/dark/system and persists after reload.
5. System theme follows OS on first load.
6. No console errors on Tenders, Detail, Admin, Settings, Schedule, Profile pages.

- [ ] **Step 5: Commit final fixes**

```bash
git commit -am "fix: final Phase 4/5 polish

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-review checklist

- [ ] Spec coverage: every Phase 4 and Phase 5 requirement maps to a task.
- [ ] No placeholders: no "TODO", "TBD", or vague instructions remain.
- [ ] Type consistency: prop names and helper signatures match across tasks.
- [ ] No backend endpoints changed.
- [ ] Build and backend test commands are included.

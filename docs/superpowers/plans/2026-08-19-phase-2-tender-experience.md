# Phase 2 Tender Experience Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the tender list and inspector from `App.jsx` into focused pages/components, add a hybrid side-sheet/full-page tender detail view, URL-synced filters, tabbed inspector content, and loading/error skeletons.

**Architecture:** Keep the existing custom hash router in `App.jsx`; add a `#tenders/:id` route rendered by `TenderDetailPage`. Move routing helpers and project row helpers into small `utils/` modules. Share the tabbed inspector body between the side sheet (`TendersPage`) and the full page (`TenderDetailPage`) via a new `ProjectInspector` component.

**Tech Stack:** React 19, Vite, Tailwind CSS v4, shadcn/ui (radix-nova), custom hash routing, Node built-in test runner for pure helper tests.

**Spec:** `docs/superpowers/specs/2026-08-18-phase-2-tender-experience-design.md`

## Global Constraints

- No new backend endpoints or data models; reuse existing endpoints.
- No React Router migration; keep the existing custom `window.location.hash` router.
- No admin/settings/user-management redesign.
- No dark mode or theming changes.
- `npm run build` must exit cleanly.
- `PYTHONPATH=backend python -m pytest backend/tests -q` must remain 202/202.
- Every new helper must have a passing Node test before components consume it.

---

## File map

| File | Responsibility |
|---|---|
| `frontend/src/utils/tenderRouting.js` | Parse/build hash routes, serialize/deserialize filter state in URL. |
| `frontend/src/utils/tenderRouting.test.js` | Node test runner tests for the above. |
| `frontend/src/utils/projects.js` | `getProjectSeedKey`, `attachProjectRowIds`. |
| `frontend/src/utils/projects.test.js` | Node test runner tests for the above. |
| `frontend/src/components/TenderTabs.jsx` | Tab bar for Overview / Documents / Activity / Smart-Ziw. |
| `frontend/src/components/ProjectInspector.jsx` | Tabbed tender body shared by side sheet and full page. |
| `frontend/src/components/TenderDetailSkeleton.jsx` | Skeleton placeholder for the full-page detail view. |
| `frontend/src/components/ErrorBoundary.jsx` | Lightweight React error boundary wrapper. |
| `frontend/src/pages/TendersPage.jsx` | List route: stats, filters, table, side-sheet inspector. |
| `frontend/src/pages/TenderDetailPage.jsx` | Full-page `#tenders/:id` route. |
| `frontend/src/App.jsx` | Global shell + route dispatch; delegate tender UI to pages. |
| `frontend/src/components/ProjectTable.jsx` | Add "Open full page" row action and `newProjectIds` highlight. |

---

### Task 1: Extract tender routing helpers

**Files:**
- Create: `frontend/src/utils/tenderRouting.js`
- Create: `frontend/src/utils/tenderRouting.test.js`
- Modify: `frontend/src/App.jsx` (remove the four functions below)

**Interfaces:**
- Produces: `getTenderIdFromHash(rawHash)`, `buildTenderHash(projectDbId)`, `buildTenderShareUrl(projectDbId)`, `serializeFilters(filters)`, `deserializeFilters(search)`, `buildDashboardHash(filters)`.

These functions currently live in `App.jsx` at approximately lines 202–221. Move them to the new module and add filter serialization.

- [ ] **Step 1: Create `frontend/src/utils/tenderRouting.js`**

```js
const API = '/api';

export function getTenderIdFromHash(rawHash = '') {
    const hash = String(rawHash || '').replace(/^#/, '').replace(/^\//, '');
    const match = hash.match(/^tenders\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

export function buildTenderHash(projectDbId = '') {
    return projectDbId ? `#/tenders/${encodeURIComponent(projectDbId)}` : '#dashboard';
}

export function buildTenderShareUrl(projectDbId = '') {
    if (!projectDbId || typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}${window.location.search}${buildTenderHash(projectDbId)}`;
}

const DEFAULT_FILTERS = {
    q: '',
    source: '',
    region: '',
    continent: '',
    verified: 'Yes',
    decision: '',
    deadlineFrom: '',
    deadlineTo: '',
    scrapedFrom: '',
    scrapedTo: '',
    expiringSoon: '0',
    expiringDays: '5',
};

export function serializeFilters(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(DEFAULT_FILTERS).forEach(([key, defaultValue]) => {
        const value = filters[key];
        if (value !== undefined && String(value) !== String(defaultValue) && String(value) !== '') {
            params.set(key, String(value));
        }
    });
    return params.toString();
}

export function deserializeFilters(search = '') {
    const params = new URLSearchParams(search);
    const result = { ...DEFAULT_FILTERS };
    Object.keys(DEFAULT_FILTERS).forEach((key) => {
        if (params.has(key)) result[key] = params.get(key);
    });
    return result;
}

export function buildDashboardHash(filters = {}) {
    const query = serializeFilters(filters);
    return query ? `#/dashboard?${query}` : '#dashboard';
}
```

- [ ] **Step 2: Create `frontend/src/utils/tenderRouting.test.js`**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    getTenderIdFromHash,
    buildTenderHash,
    serializeFilters,
    deserializeFilters,
    buildDashboardHash,
} from './tenderRouting.js';

describe('tenderRouting', () => {
    it('parses tender id from hash', () => {
        assert.strictEqual(getTenderIdFromHash('#/tenders/abc-123'), 'abc-123');
        assert.strictEqual(getTenderIdFromHash('#tenders/abc%20123'), 'abc 123');
        assert.strictEqual(getTenderIdFromHash('#dashboard'), '');
    });

    it('builds tender hash', () => {
        assert.strictEqual(buildTenderHash('abc-123'), '#/tenders/abc-123');
        assert.strictEqual(buildTenderHash(''), '#dashboard');
    });

    it('serializes only non-default filters', () => {
        assert.strictEqual(serializeFilters({ source: 'worldbank' }), 'source=worldbank');
        assert.strictEqual(serializeFilters({ verified: 'Yes' }), '');
        assert.strictEqual(serializeFilters({ q: 'health', source: 'worldbank' }), 'q=health&source=worldbank');
    });

    it('round-trips filters', () => {
        const filters = { q: 'health', source: 'worldbank', verified: 'Yes' };
        const restored = deserializeFilters(serializeFilters(filters));
        assert.strictEqual(restored.q, 'health');
        assert.strictEqual(restored.source, 'worldbank');
        assert.strictEqual(restored.verified, 'Yes');
    });

    it('builds dashboard hash with filters', () => {
        assert.strictEqual(buildDashboardHash({ source: 'worldbank' }), '#/dashboard?source=worldbank');
        assert.strictEqual(buildDashboardHash({}), '#dashboard');
    });
});
```

- [ ] **Step 3: Run the tests**

Run:
```bash
cd frontend && node --test src/utils/tenderRouting.test.js
```
Expected: all tests pass.

- [ ] **Step 4: Remove the duplicated functions from `App.jsx`**

Delete `getTenderIdFromHash`, `buildTenderHash`, and `buildTenderShareUrl` from `App.jsx` (keep `normalizeRoute` because it is global routing, not tender-specific). Add an import near the top:

```js
import {
    getTenderIdFromHash,
    buildTenderHash,
    buildTenderShareUrl,
    buildDashboardHash,
    deserializeFilters,
} from './utils/tenderRouting';
```

- [ ] **Step 5: Verify build**

Run `npm run build`. Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/tenderRouting.js frontend/src/utils/tenderRouting.test.js frontend/src/App.jsx
git commit -m "refactor: extract tender routing helpers and add filter URL serialization

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Extract project row helpers

**Files:**
- Create: `frontend/src/utils/projects.js`
- Create: `frontend/src/utils/projects.test.js`
- Modify: `frontend/src/App.jsx` (remove `getProjectSeedKey` and `attachProjectRowIds`)

**Interfaces:**
- Produces: `getProjectSeedKey(project)`, `attachProjectRowIds(items)`.

- [ ] **Step 1: Create `frontend/src/utils/projects.js`**

```js
export function getProjectSeedKey(project = {}) {
    return [
        project?.source || '',
        project?.project_id || '',
        project?.project_url || '',
        project?.document_url || '',
        project?.project_name || '',
        project?.project_description || '',
        project?.project_sponsor || '',
        project?.project_end_date || '',
    ].join('::');
}

export function attachProjectRowIds(items = []) {
    const seen = new Map();
    return items.map((project) => {
        if (project?.__rowId) return project;
        const seed = getProjectSeedKey(project);
        const occurrence = (seen.get(seed) || 0) + 1;
        seen.set(seed, occurrence);
        return { ...project, __rowId: `${seed}__${occurrence}` };
    });
}
```

- [ ] **Step 2: Create `frontend/src/utils/projects.test.js`**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getProjectSeedKey, attachProjectRowIds } from './projects.js';

describe('projects', () => {
    it('computes a stable seed key', () => {
        const p = { source: 'wb', project_id: '123', project_name: 'Road' };
        assert.strictEqual(getProjectSeedKey(p), getProjectSeedKey(p));
    });

    it('attaches unique row ids', () => {
        const items = [{ project_id: '1' }, { project_id: '1' }, { project_id: '2' }];
        const withIds = attachProjectRowIds(items);
        assert.strictEqual(withIds.length, 3);
        assert.notStrictEqual(withIds[0].__rowId, withIds[1].__rowId);
        assert.strictEqual(withIds[0].__rowId, items[0].__rowId);
    });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd frontend && node --test src/utils/projects.test.js
```
Expected: pass.

- [ ] **Step 4: Update `App.jsx`**

Remove `getProjectSeedKey` and `attachProjectRowIds` from `App.jsx` and add:

```js
import { attachProjectRowIds } from './utils/projects';
```

- [ ] **Step 5: Verify build**

Run `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/projects.js frontend/src/utils/projects.test.js frontend/src/App.jsx
git commit -m "refactor: extract project row id helpers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Create `TenderTabs` component

**Files:**
- Create: `frontend/src/components/TenderTabs.jsx`

**Interfaces:**
- Consumes: `activeTab: string`, `onChange: (tab) => void`, `compact?: boolean`.
- Produces: rendered tab bar with tabs `overview`, `documents`, `activity`, `smart-ziw`.

- [ ] **Step 1: Create the component**

```jsx
import { FileText, MessageSquare, Sparkles, LayoutList } from 'lucide-react';

const TABS = [
    { id: 'overview', label: 'Overview', icon: LayoutList },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'activity', label: 'Activity', icon: MessageSquare },
    { id: 'smart-ziw', label: 'Smart-Ziw', icon: Sparkles },
];

export default function TenderTabs({ activeTab, onChange, compact = false }) {
    return (
        <div className={`flex border-b ${compact ? 'gap-1' : 'gap-2'}`} role="tablist" aria-label="Tender sections">
            {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => onChange(tab.id)}
                        className={`flex items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors ${
                            compact ? 'py-2' : 'py-3'
                        } ${
                            isActive
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <Icon className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
                        <span className={compact ? 'hidden sm:inline' : ''}>{tab.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 2: Verify build**

Run `npm run build`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TenderTabs.jsx
git commit -m "feat: add TenderTabs component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Create `ProjectInspector` component

**Files:**
- Create: `frontend/src/components/ProjectInspector.jsx`

**Interfaces:**
- Consumes:
  - `project: object` (required)
  - `comments: array`
  - `commentsLoading: boolean`
  - `authUser: object`
  - `availableUsers: array`
  - `canManageDecision: boolean`
  - `onDecisionChange: (decision) => void`
  - `onOpenFullPage: () => void`
  - `onRunSmartZiw: () => void`
  - `compact: boolean` (true in side sheet)
- Produces: tabbed inspector body.

This component is presentational. Extract the existing inspector body from the sheet in `App.jsx` (around lines 1207–1450) and wrap it in tabs. The Overview tab contains the current metadata + decision buttons. The Activity tab contains the comments thread. The Documents tab lists attachments/links. The Smart-Ziw tab contains the run button and results.

- [ ] **Step 1: Scaffold the component**

```jsx
import { useState } from 'react';
import TenderTabs from './TenderTabs';

export default function ProjectInspector({
    project,
    comments,
    commentsLoading,
    authUser,
    availableUsers,
    canManageDecision,
    onDecisionChange,
    onOpenFullPage,
    onRunSmartZiw,
    compact = false,
}) {
    const [activeTab, setActiveTab] = useState('overview');

    return (
        <div className="flex h-full flex-col">
            <div className={`flex items-start justify-between gap-4 ${compact ? 'p-4 pb-2' : 'p-6 pb-4'}`}>
                <div>
                    <h2 className={`font-semibold text-foreground ${compact ? 'text-base' : 'text-xl'}`}>
                        {project.project_name || project.project_description || 'Untitled tender'}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{project.project_id || '-'}</p>
                </div>
                <button
                    type="button"
                    onClick={onOpenFullPage}
                    className="text-sm font-medium text-primary hover:underline"
                >
                    Open full page
                </button>
            </div>

            <TenderTabs activeTab={activeTab} onChange={setActiveTab} compact={compact} />

            <div className="min-h-0 flex-1 overflow-auto">
                {activeTab === 'overview' && (
                    <OverviewTab
                        project={project}
                        canManageDecision={canManageDecision}
                        onDecisionChange={onDecisionChange}
                        onRunSmartZiw={onRunSmartZiw}
                    />
                )}
                {activeTab === 'documents' && <DocumentsTab project={project} />}
                {activeTab === 'activity' && (
                    <ActivityTab comments={comments} loading={commentsLoading} authUser={authUser} availableUsers={availableUsers} />
                )}
                {activeTab === 'smart-ziw' && <SmartZiwTab project={project} onRun={onRunSmartZiw} />}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Inline the four tab components**

Create `OverviewTab`, `DocumentsTab`, `ActivityTab`, and `SmartZiwTab` as internal components in the same file. Populate them by copying the relevant markup from the existing inspector sheet in `App.jsx`:

- `OverviewTab`: copy the project metadata grid and decision buttons.
- `DocumentsTab`: copy the document/attachment links section.
- `ActivityTab`: copy the comments list (but keep the composer in `TendersPage` if it is currently outside the sheet body; otherwise include it here).
- `SmartZiwTab`: copy the Smart-Ziw run button and output area.

If a section does not exist yet, create a minimal placeholder card, e.g.:

```jsx
function DocumentsTab({ project }) {
    return (
        <div className="p-4">
            {project.document_url ? (
                <a href={project.document_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Open tender document
                </a>
            ) : (
                <p className="text-sm text-muted-foreground">No documents attached.</p>
            )}
        </div>
    );
}
```

- [ ] **Step 3: Verify build**

Run `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ProjectInspector.jsx
git commit -m "feat: add ProjectInspector with tabbed tender body

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Create `TenderDetailSkeleton` component

**Files:**
- Create: `frontend/src/components/TenderDetailSkeleton.jsx`

**Interfaces:**
- Consumes: none.
- Produces: skeleton placeholder.

- [ ] **Step 1: Create the component**

```jsx
import { Skeleton } from '@/components/ui/skeleton';

export default function TenderDetailSkeleton() {
    return (
        <div className="space-y-6 p-6">
            <div className="space-y-2">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="flex gap-2 border-b pb-2">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify build**

Run `npm run build`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TenderDetailSkeleton.jsx
git commit -m "feat: add TenderDetailSkeleton

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Create `TenderDetailPage`

**Files:**
- Create: `frontend/src/pages/TenderDetailPage.jsx`

**Interfaces:**
- Consumes: `dbId: string`, `apiFetch: function`, `authUser: object`, `availableUsers: array`.
- Produces: full-page tender detail or loading/error states.

- [ ] **Step 1: Create the page**

```jsx
import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProjectInspector from '../components/ProjectInspector';
import TenderDetailSkeleton from '../components/TenderDetailSkeleton';
import { buildTenderHash } from '../utils/tenderRouting';

const API = '/api';

export default function TenderDetailPage({ dbId, apiFetch, authUser, availableUsers }) {
    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [comments, setComments] = useState([]);
    const [commentsLoading, setCommentsLoading] = useState(false);

    const loadProject = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(dbId)}`);
            if (!res.ok) throw new Error(res.status === 404 ? 'Tender not found' : `Failed to load tender (${res.status})`);
            const data = await res.json();
            if (!data || !data.db_id) throw new Error('Tender not found');
            setProject(data);
        } catch (err) {
            setError(err?.message || 'Unable to load tender');
        } finally {
            setLoading(false);
        }
    }, [dbId, apiFetch]);

    const loadComments = useCallback(async () => {
        if (!dbId) return;
        setCommentsLoading(true);
        try {
            const res = await apiFetch(`${API}/comments?entityType=project&entityId=${encodeURIComponent(dbId)}&mine=false`);
            const data = await res.json();
            setComments(Array.isArray(data?.comments) ? data.comments : []);
        } finally {
            setCommentsLoading(false);
        }
    }, [dbId, apiFetch]);

    useEffect(() => {
        loadProject();
        loadComments();
    }, [loadProject, loadComments]);

    const handleDecisionChange = async (decision) => {
        if (!project) return;
        await apiFetch(`${API}/projects/${encodeURIComponent(project.db_id)}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision }),
        });
        loadProject();
    };

    const handleRunSmartZiw = async () => {
        if (!project) return;
        await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(project.db_id)}/smart-ziw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: false }),
        });
        loadProject();
    };

    const goBack = () => {
        window.location.hash = '#dashboard';
    };

    if (loading) return <TenderDetailSkeleton />;

    if (error || !project) {
        return (
            <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
                <h2 className="text-xl font-semibold text-foreground">{error || 'Tender not found'}</h2>
                <p className="mt-2 text-sm text-muted-foreground">This tender may have been removed or the link is incorrect.</p>
                <Button variant="outline" className="mt-6" onClick={goBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to tenders
                </Button>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b px-6 py-4">
                <Button variant="ghost" size="sm" onClick={goBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                </Button>
                <span className="text-sm text-muted-foreground">Tender detail</span>
            </div>
            <ProjectInspector
                project={project}
                comments={comments}
                commentsLoading={commentsLoading}
                authUser={authUser}
                availableUsers={availableUsers}
                canManageDecision={authUser?.role !== 'viewer'}
                onDecisionChange={handleDecisionChange}
                onOpenFullPage={() => { /* already full page */ }}
                onRunSmartZiw={handleRunSmartZiw}
                compact={false}
            />
        </div>
    );
}
```

- [ ] **Step 2: Verify build**

Run `npm run build`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/TenderDetailPage.jsx
git commit -m "feat: add full-page TenderDetailPage

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Create `TendersPage`

**Files:**
- Create: `frontend/src/pages/TendersPage.jsx`
- Modify: `frontend/src/App.jsx` (remove the dashboard/tenders rendering block)

**Interfaces:**
- Consumes: `apiFetch: function`, `authUser: object`, `availableUsers: array`, `regions: object`, `continents: array`, `sources: array`, `savedSearches: array`, `onSaveCurrentSearch`, `onApplySavedSearch`, `onDeleteSavedSearch`, `dashboardStats: object`, `onSyncStart`, `onSyncDone`.
- Produces: tender list route.

This is the largest extraction. Move the filter state, project loading, project selection, comments, and side-sheet rendering from `App.jsx` into this page. Keep the existing handlers (`handleDecisionChange`, `handleDelete`, `handleBulkDelete`, etc.) but move their definitions into the page.

- [ ] **Step 1: Scaffold `TendersPage.jsx`**

Start with the state declarations currently in `App.jsx` lines ~3599–3640 and the handler functions around lines 4297–4548. Copy the dashboard stats computation as well.

The file should export a default component:

```jsx
export default function TendersPage({
    apiFetch,
    authUser,
    availableUsers,
    regions,
    continents,
    sources,
    savedSearches,
    onSaveCurrentSearch,
    onApplySavedSearch,
    onDeleteSavedSearch,
    dashboardStats,
    onSyncStart,
    onSyncDone,
}) {
    // state, effects, handlers from App.jsx
    // ...
}
```

- [ ] **Step 2: Add URL-synced filters**

Inside `TendersPage`, after declaring filter state, add:

```js
useEffect(() => {
    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');
    const search = queryIndex >= 0 ? hash.slice(queryIndex + 1) : '';
    const parsed = deserializeFilters(search);
    setFreeText(parsed.q);
    setSource(parsed.source);
    setRegion(parsed.region);
    setContinent(parsed.continent);
    setVerified(parsed.verified);
    setDecision(parsed.decision);
    setEndDateFrom(parsed.deadlineFrom);
    setEndDateTo(parsed.deadlineTo);
    setScrapedFrom(parsed.scrapedFrom);
    setScrapedTo(parsed.scrapedTo);
    setExpiringSoonOnly(parsed.expiringSoon === '1');
    setExpiringSoonDays(Number(parsed.expiringDays) || 5);
}, []);

useEffect(() => {
    const filters = {
        q: freeText,
        source,
        region,
        continent,
        verified,
        decision,
        deadlineFrom: endDateFrom,
        deadlineTo: endDateTo,
        scrapedFrom,
        scrapedTo,
        expiringSoon: expiringSoonOnly ? '1' : '0',
        expiringDays: String(expiringSoonDays),
    };
    const nextHash = buildDashboardHash(filters);
    if (nextHash !== `#${window.location.hash.replace(/^#/, '')}`) {
        window.location.hash = nextHash;
    }
}, [
    freeText, source, region, continent, verified, decision,
    endDateFrom, endDateTo, scrapedFrom, scrapedTo,
    expiringSoonOnly, expiringSoonDays,
]);
```

- [ ] **Step 3: Render `ProjectInspector` in the side sheet**

Replace the existing inspector body in the sheet with:

```jsx
{selectedProject ? (
    <ProjectInspector
        project={selectedProject}
        comments={comments}
        commentsLoading={commentsLoading}
        authUser={authUser}
        availableUsers={availableUsers}
        canManageDecision={authUser?.role !== 'viewer'}
        onDecisionChange={(decision) => handleDecisionChange(selectedProjectIndex, decision)}
        onOpenFullPage={() => { window.location.hash = buildTenderHash(selectedProject.db_id); }}
        onRunSmartZiw={() => runSmartZiw(selectedProject)}
        compact
    />
) : null}
```

- [ ] **Step 4: Update `App.jsx`**

Remove the entire dashboard/tenders rendering block from `App.jsx` (the section that renders stats cards, filters, `ProjectTable`, and the comments sheet). Replace it with:

```jsx
{route === 'dashboard' ? (
    <TendersPage
        apiFetch={apiFetch}
        authUser={authUser}
        availableUsers={availableUsers}
        regions={regions}
        continents={continents}
        sources={sources}
        savedSearches={savedSearches}
        onSaveCurrentSearch={handleSaveCurrentSearch}
        onApplySavedSearch={handleApplySavedSearch}
        onDeleteSavedSearch={handleDeleteSavedSearch}
        dashboardStats={dashboardStats}
        onSyncStart={snapshotBeforeSync}
        onSyncDone={handleSyncDone}
    />
) : null}
```

- [ ] **Step 5: Verify build**

Run `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TendersPage.jsx frontend/src/App.jsx
git commit -m "refactor: extract TendersPage and add URL-synced filters

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Wire `#tenders/:id` route in `App.jsx`

**Files:**
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `getTenderIdFromHash`.
- Produces: renders `TenderDetailPage` when hash matches `#tenders/:id`.

- [ ] **Step 1: Compute tender detail route in `App.jsx`**

Near the existing `route` state, add:

```js
const tenderDetailId = getTenderIdFromHash(window.location.hash);
```

Inside the route-rendering section, before the dashboard/admin checks, add:

```jsx
{tenderDetailId ? (
    <TenderDetailPage
        dbId={tenderDetailId}
        apiFetch={apiFetch}
        authUser={authUser}
        availableUsers={availableUsers}
    />
) : null}
```

Also update `normalizeRoute` so it does not hide the detail route from the sidebar active state:

```js
function normalizeRoute(rawRoute = '') {
    const route = String(rawRoute || '').replace(/^#/, '').replace(/^\//, '');
    if (route === 'comments' || route.startsWith('tenders/')) return 'dashboard';
    return route || 'dashboard';
}
```

- [ ] **Step 2: Update `ProjectTable` "Open full page" action**

Add a row action in `ProjectTable` that calls `onOpenFullPage(project)`.

In `frontend/src/components/ProjectTable.jsx`:
- Add `onOpenFullPage` to props.
- In the row actions dropdown, add:

```jsx
<DropdownMenuItem onSelect={() => onOpenFullPage?.(p)}>
    <ExternalLink className="mr-2 h-4 w-4" />Open full page
</DropdownMenuItem>
```

Import `ExternalLink` from `lucide-react`.

- [ ] **Step 3: Verify build**

Run `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/ProjectTable.jsx
git commit -m "feat: wire #tenders/:id route and add open-full-page row action

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Add error boundary around pages

**Files:**
- Create: `frontend/src/components/ErrorBoundary.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `children`, `fallback`.
- Produces: error boundary wrapper.

- [ ] **Step 1: Create `ErrorBoundary.jsx`**

```jsx
import { Component } from 'react';

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        // eslint-disable-next-line no-console
        console.error('ErrorBoundary caught an error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
                    <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{this.state.error?.message || 'Please reload the page.'}</p>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Reload
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
```

- [ ] **Step 2: Wrap routes in `App.jsx`**

```jsx
<ErrorBoundary>
    {route === 'dashboard' ? <TendersPage ... /> : null}
    {tenderDetailId ? <TenderDetailPage ... /> : null}
</ErrorBoundary>
```

- [ ] **Step 3: Verify build**

Run `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ErrorBoundary.jsx frontend/src/App.jsx
git commit -m "feat: add ErrorBoundary wrapper around tender pages

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Final verification

**Files:**
- All of the above.

- [ ] **Step 1: Run backend tests**

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
```
Expected: 202 passed.

- [ ] **Step 2: Run frontend build**

```bash
cd frontend && npm run build
```
Expected: clean build.

- [ ] **Step 3: Run helper unit tests**

```bash
cd frontend && node --test src/utils/tenderRouting.test.js src/utils/projects.test.js
```
Expected: all pass.

- [ ] **Step 4: Manual smoke checks**

Open the app (via `npm run dev` or Docker) and verify:
1. `#dashboard` shows the tender list.
2. Changing filters updates the URL.
3. Refreshing the page restores filters.
4. Clicking a tender row opens the side sheet with tabs.
5. "Open full page" navigates to `#tenders/:id`.
6. The full page shows the same tabs and a working back button.
7. An unknown `#tenders/bad-id` shows the not-found state.
8. Bulk actions and sync still work.

- [ ] **Step 5: Commit any final fixes**

```bash
git commit -am "fix: final Phase 2 polish

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-review checklist

- [ ] Spec coverage: every in-scope item from the design spec maps to a task above.
- [ ] No placeholders: search the plan for "TODO", "TBD", "implement later", or vague instructions and fix them.
- [ ] Type consistency: prop names (`compact`, `dbId`, `apiFetch`, `authUser`, `availableUsers`) match across tasks.
- [ ] No new backend endpoints or data models are introduced.
- [ ] Build and backend test commands are included in the final verification task.

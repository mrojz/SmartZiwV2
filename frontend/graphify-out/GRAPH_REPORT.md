# Graph Report - frontend  (2026-08-23)

## Corpus Check
- Corpus is ~45,478 words - fits in a single context window. You may not need a graph.

## Summary
- 463 nodes · 1124 edges · 21 communities (18 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 50,467 input · 0 output

## Community Hubs (Navigation)
- shadcn UI primitives
- page containers and forms
- sidebar and layout shell
- package dependencies
- project table and display
- search and command palette
- app routing and navigation
- app helpers and admin
- components.json config
- comment composer inputs
- analytics and demo cards
- admin profile validation
- index.html metadata
- notifications and modals
- error boundary
- jsconfig paths
- image upload helpers
- resize observer hook
- projects utility
- brand logo
- vite config

## God Nodes (most connected - your core abstractions)
1. `cn()` - 146 edges
2. `Button()` - 24 edges
3. `usePageHeader()` - 14 edges
4. `TendersPage()` - 13 edges
5. `App()` - 12 edges
6. `Badge()` - 12 edges
7. `ScheduleForm()` - 11 edges
8. `getUnifiedStatus()` - 10 edges
9. `Input()` - 9 edges
10. `ProjectTable()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `CardDescription()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/card.jsx → src/utils/cn.ts
- `CardAction()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/card.jsx → src/utils/cn.ts
- `CommandSeparator()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/command.jsx → src/utils/cn.ts
- `CommandShortcut()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/command.jsx → src/utils/cn.ts
- `DialogOverlay()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/dialog.jsx → src/utils/cn.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Procurement Watch frontend entry** — eprocscraper_frontend_index_html, eprocscraper_frontend_index_procurementwatch, eprocscraper_frontend_index_rootmount, eprocscraper_frontend_index_src_mainjsx, eprocscraper_frontend_index_themeinitializer [INFERRED 0.85]

## Communities (21 total, 3 thin omitted)

### Community 0 - "shadcn UI primitives"
Cohesion: 0.06
Nodes (48): SectionCard(), Accordion(), AccordionContent(), AccordionItem(), AccordionTrigger(), Avatar(), AvatarBadge(), AvatarFallback() (+40 more)

### Community 1 - "page containers and forms"
Cohesion: 0.08
Nodes (38): ReleaseNotesPage(), ClockTimePicker(), PageHeaderContext, PageHeaderProvider(), usePageHeader(), ProjectInspector(), buildSyncStreamUrl(), computeTimeUntil() (+30 more)

### Community 2 - "sidebar and layout shell"
Cohesion: 0.07
Nodes (41): Avatar(), initials(), NAV_GROUPS, Sidebar(), TenderDetailSkeleton(), Collapsible(), CollapsibleContent(), CollapsibleTrigger() (+33 more)

### Community 3 - "package dependencies"
Cohesion: 0.04
Nodes (44): class-variance-authority, clsx, cmdk, lucide-react, dependencies, class-variance-authority, clsx, cmdk (+36 more)

### Community 4 - "project table and display"
Cohesion: 0.10
Nodes (33): ContextMenu(), ActivityTab(), OverviewTab(), SmartZiwResults(), formatDisplayDate(), formatPlaceLabel(), getProjectBaseKey(), getProjectRowId() (+25 more)

### Community 5 - "search and command palette"
Cohesion: 0.09
Nodes (26): buildSyncStreamUrl(), SOURCES, SyncPanel(), Badge(), badgeVariants, Command(), CommandDialog(), CommandEmpty() (+18 more)

### Community 6 - "app routing and navigation"
Cohesion: 0.14
Nodes (24): App(), buildNotificationStreamUrl(), normalizeRoute(), Sheet(), SheetClose(), SheetContent(), SheetDescription(), SheetFooter() (+16 more)

### Community 7 - "app helpers and admin"
Cohesion: 0.08
Nodes (16): ADMIN_ROUTES, buildGroupedNotifications(), DEFAULT_RELEASE_NOTES, DEMO_STEPS, formatActorList(), groupReleaseItems(), LLM_PROVIDER_COLORS, LLM_PROVIDER_LOGOS (+8 more)

### Community 8 - "components.json config"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 9 - "comment composer inputs"
Cohesion: 0.18
Nodes (16): colorFromSeed(), CommentComposer(), compressImageForCommentUpload(), initials(), isCompressibleImage(), loadImageFromFile(), prepareCommentUploadFile(), InputGroup() (+8 more)

### Community 10 - "analytics and demo cards"
Cohesion: 0.19
Nodes (11): AnalyticsPage(), DemoWalkthrough(), isVisible(), PageHeader(), Card(), CardAction(), CardContent(), CardDescription() (+3 more)

### Community 11 - "admin profile validation"
Cohesion: 0.30
Nodes (10): AdminPage(), compareVersionStrings(), formatAdminDateTime(), ProfilePage(), UserDrawer(), isEmail(), isNumberInRange(), isRequired() (+2 more)

### Community 12 - "index.html metadata"
Cohesion: 0.22
Nodes (8): Forvis Mazars logo, Global Tenders, IADB, Procurement Watch, root mount point, src/main.jsx, theme initializer script, World Bank

### Community 13 - "notifications and modals"
Cohesion: 0.33
Nodes (5): formatDisplayDate(), NotificationsPanel(), ReleaseNotesModal(), ResetPasswordModal(), setModalScrollLock()

### Community 15 - "jsconfig paths"
Cohesion: 0.50
Nodes (3): compilerOptions, baseUrl, paths

### Community 16 - "image upload helpers"
Cohesion: 0.67
Nodes (4): compressImageForCommentUpload(), isCompressibleImage(), loadImageFromFile(), prepareCommentUploadFile()

### Community 17 - "resize observer hook"
Cohesion: 0.67
Nodes (3): hasResizeObserver(), useResizeObserver(), useResizeObserverOptionsType

### Community 19 - "brand logo"
Cohesion: 0.67
Nodes (3): Forvis Mazars Brand Color Palette, Forvis Mazars, Forvis Mazars Logo SVG

## Knowledge Gaps
- **74 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+69 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `shadcn UI primitives` to `page containers and forms`, `sidebar and layout shell`, `project table and display`, `search and command palette`, `app routing and navigation`, `comment composer inputs`, `analytics and demo cards`?**
  _High betweenness centrality (0.186) - this node is a cross-community bridge._
- **Why does `Button()` connect `page containers and forms` to `shadcn UI primitives`, `sidebar and layout shell`, `project table and display`, `search and command palette`, `app routing and navigation`, `app helpers and admin`, `comment composer inputs`, `analytics and demo cards`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `Badge()` connect `search and command palette` to `shadcn UI primitives`, `page containers and forms`, `project table and display`, `app routing and navigation`, `app helpers and admin`, `comment composer inputs`, `analytics and demo cards`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _74 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `shadcn UI primitives` be split into smaller, more focused modules?**
  _Cohesion score 0.057539682539682536 - nodes in this community are weakly interconnected._
- **Should `page containers and forms` be split into smaller, more focused modules?**
  _Cohesion score 0.07764705882352942 - nodes in this community are weakly interconnected._
- **Should `sidebar and layout shell` be split into smaller, more focused modules?**
  _Cohesion score 0.06717687074829932 - nodes in this community are weakly interconnected._
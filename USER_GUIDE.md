# Procurement Watch — User Guide

> **Version 1.2** · Last updated April 2026

Procurement Watch is a SaaS-style internal intelligence platform for tracking procurement and tender opportunities across multiple international sources. It scrapes, verifies, and enriches opportunities using AI, then surfaces them in a unified dashboard for analyst review.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
   - [Prerequisites](#prerequisites)
   - [Installation (Docker)](#option-a--docker-compose-recommended)
   - [Installation (Manual)](#option-b--manual-setup)
   - [Environment Variables](#environment-variables)
2. [First-Time Login](#2-first-time-login)
3. [Dashboard Overview](#3-dashboard-overview)
   - [Project Table](#project-table)
   - [Toolbar & Search](#toolbar--search)
   - [Advanced Boolean Search](#advanced-boolean-search)
   - [Saved Searches](#saved-searches)
4. [Project Inspector](#4-project-inspector)
   - [Project Details](#project-details)
   - [Decision Workflow](#decision-workflow)
   - [Deadline Override](#deadline-override)
   - [Voting](#voting)
   - [User Assignment](#user-assignment)
   - [Deep Dive Research](#deep-dive-research)
5. [Discussion & Comments](#5-discussion--comments)
   - [Writing Comments](#writing-comments)
   - [File Attachments](#file-attachments)
   - [Mentions & Notifications](#mentions--notifications)
6. [Syncing Data](#6-syncing-data)
   - [Manual Sync](#manual-sync)
   - [Scheduled Sync](#scheduled-sync)
   - [Live Sync Output](#live-sync-output)
   - [Sync History & Logs](#sync-history--logs)
7. [Notifications](#7-notifications)
8. [Configuration](#8-configuration)
   - [Keywords](#keywords)
   - [Regions & Geography](#regions--geography)
9. [User Administration](#9-user-administration)
   - [Creating Users](#creating-users)
   - [Editing Users](#editing-users)
   - [Resetting Passwords](#resetting-passwords)
   - [Deactivating & Deleting Users](#deactivating--deleting-users)
10. [Data Export](#10-data-export)
11. [Supported Procurement Sources](#11-supported-procurement-sources)
12. [User Roles & Permissions](#12-user-roles--permissions)
13. [Release Notes Management](#13-release-notes-management)
14. [Troubleshooting](#14-troubleshooting)
15. [Architecture Overview](#15-architecture-overview)

---

## 1. Getting Started

### Prerequisites

| Requirement         | Recommended Version |
|---------------------|---------------------|
| Python              | 3.12+               |
| Node.js             | 22+                 |
| MongoDB             | 4.4+                |
| Docker *(optional)* | Latest stable        |

### Option A — Docker Compose *(recommended)*

The simplest way to run the full stack:

```bash
# 1. Clone the repository and cd into it
cd new_cdx_gpt_5.4

# 2. Copy and configure environment variables
cp backend/.env.example backend/.env
# Edit backend/.env with your real values

# 3. Start everything
docker compose up --build -d
```

This starts three containers:

| Service    | Port  | Description                    |
|------------|-------|--------------------------------|
| `mongo`    | 27017 | MongoDB database               |
| `backend`  | 8000  | FastAPI backend                 |
| `frontend` | 80    | React app served via Nginx      |

> **Access the app at [http://localhost](http://localhost)**

### Option B — Manual Setup

#### Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Copy and edit the environment file:

```bash
cp .env.example .env
# Edit .env with your credentials (see Environment Variables below)
```

Start the backend:

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

> **Access the app at [http://localhost:5173](http://localhost:5173)**

### Environment Variables

Configure these in `backend/.env`:

| Variable              | Required | Description                                            |
|-----------------------|----------|--------------------------------------------------------|
| `ADMIN_EMAIL`         | Yes*     | Bootstrap admin email (required on first startup)      |
| `ADMIN_PASSWORD`      | Yes*     | Bootstrap admin password (required on first startup)   |
| `ADMIN_NAME`          | No       | Admin display name (default: `Admin`)                  |
| `MONGO_URI`           | No       | MongoDB connection string (default: `localhost:27017`) |
| `MONGO_DB`            | No       | Database name (default: `procurement_watch`)           |
| `DEEPSEEK_API_KEY`    | No       | API key for DeepSeek-based AI features                 |
| `OPENAI_API_KEY`      | No       | API key for OpenAI-based AI features                   |
| `JWT_SECRET`          | No       | JWT signing secret (auto-generated if absent)          |
| `JWT_ACCESS_MINUTES`  | No       | Access token lifetime in minutes (default: `2160`)     |
| `JWT_REFRESH_DAYS`    | No       | Refresh token lifetime in days (default: `7`)          |
| `DGMARKET_SESSION_ID` | No       | Session ID for the DGMarket scraper                    |
| `SYNC_SECRET`         | No       | Shared secret for sync API authentication              |

> **\*** Only required when no admin user exists in the database yet.

---

## 2. First-Time Login

1. **Start the backend** with `ADMIN_EMAIL` and `ADMIN_PASSWORD` set in `.env`.
2. The backend automatically creates a bootstrap admin user if none exists.
3. Open the app and sign in with the configured admin credentials.
4. You will be **forced to choose a new password** before you can proceed. This is a one-time security step.

> [!NOTE]
> There is no public registration flow. All users must be created by an admin through the User Management page.

---

## 3. Dashboard Overview

After logging in, you land on the **Procurement Watch** dashboard — the central workspace for reviewing tender opportunities.

### Project Table

The main table displays all stored projects with the following columns:

| Column           | Description                                                        |
|------------------|--------------------------------------------------------------------|
| **Source**        | Where the project was scraped from (e.g. IADB, World Bank)        |
| **Project Name** | Title of the tender/opportunity                                    |
| **Sponsor**      | Sponsoring organization or country                                 |
| **Deadline**     | Submission deadline (manual override shown separately)             |
| **Decision**     | Go / No Go status set by managers                                  |
| **AI Verified**  | Whether the project passed AI cybersecurity relevance verification |
| **Votes**        | Upvote / downvote tally from team members                          |
| **Comments**     | Discussion comment count                                           |
| **Assigned**     | Users assigned to review this project                              |

- **Click any row** to open the project inspector drawer on the right.
- **Sort** by clicking column headers.
- **Paginate** through results at the bottom of the table.

### Toolbar & Search

The toolbar at the top of the table provides:

- **Text search** — Filter projects by typing keywords in the search box. Matches against project name, description, sponsor, source, and other text fields.
- **Filter dropdowns** — Quick filters for source, decision status, AI verification, continent, and region.
- **Bulk actions** — Select multiple projects via checkboxes and apply bulk operations (e.g. bulk delete).
- **Excel export** — Download current project data as `.xlsx`.

### Advanced Boolean Search

For power users, the search supports an **advanced boolean query mode** using structured field-value syntax:

```
source:"World Bank" AND decision:Go
continent:Africa OR region:"West Africa"
NOT verified:No AND source:IADB
keyword:Cybersecurity AND (source:GIZ OR source:IADB)
```

**Available query fields:**

| Field            | Description                        | Example                         |
|------------------|------------------------------------|---------------------------------|
| `source`         | Procurement source                 | `source:"World Bank"`          |
| `decision`       | Go / No Go status                  | `decision:Go`                  |
| `region`         | Geographic region                  | `region:"West Africa"`         |
| `continent`      | Continent                          | `continent:Africa`             |
| `verified` / `ai`| AI verification status             | `verified:Yes`                 |
| `country`        | Country name                       | `country:Senegal`              |
| `keyword`        | Matched keyword                    | `keyword:Cybersecurity`        |
| `signals`        | AI signal tags                     | `signals:VAPT`                 |
| `id`             | Project ID                         | `id:P-12345`                   |
| `published_date` | Published date                     | `published_date:2026-01`       |
| `deadline`       | Deadline date                      | `deadline:2026-06`             |
| `last_scraped`   | Last scraped date                  | `last_scraped:2026-03`         |

**Operators:** `AND`, `OR`, `NOT`, and parentheses `()` for grouping.

### Saved Searches

You can save frequently used search queries:

1. Set up your desired search and filter combination.
2. Click the **Save Search** button in the toolbar.
3. Give it a name and save.
4. Access saved searches from the dropdown to quickly re-apply them.

Each user can store up to 30 saved searches.

---

## 4. Project Inspector

Clicking a project row opens the **inspector drawer** on the right side of the screen. This is the primary workspace for reviewing individual tender details.

### Project Details

The inspector shows:

- **Project name** and link to the original source page
- **Source** and **project ID**
- **Sponsor / organization**
- **Country, region, and continent** information
- **Published date** and **deadline**
- **Matched keywords** that triggered the scraper to collect this project
- **AI verification status** and AI-generated analysis
- **Document links** (if any were found during enrichment)

### Decision Workflow

Managers can mark each project with a decision:

- **Go** — The project is worth pursuing
- **No Go** — The project is not relevant
- **Clear** — Reset the decision to undecided

> Only users with the **manager** role can set decisions.

### Deadline Override

Admins and managers can set a **manual deadline** that overrides the scraped deadline. The original scraped deadline is preserved for traceability.

1. In the inspector, locate the deadline section.
2. Click the edit icon to set a manual deadline.
3. Clear the manual deadline to revert to the original scraped value.

### Voting

All users can vote on projects:

- **Upvote** (👍) — Signal that the project looks promising
- **Downvote** (👎) — Signal that the project may not be relevant
- Click the same vote again to **remove** your vote

Vote tallies are visible directly in the table and in the inspector.

### User Assignment

Assign one or more team members to a project for review:

1. In the inspector, click the assignment section.
2. Select users from the dropdown.
3. Assigned users receive a **notification** about their new assignment.

### Deep Dive Research

For verified projects, you can trigger **Deep Dive** — an AI-powered research process that:

1. Searches the source for additional documents and links.
2. Summarizes the project context.
3. Posts the findings as a **bot comment** in the project's discussion thread.

To trigger: click the **Deep Dive** button in the inspector. The process runs in the background and you'll be notified when it completes.

---

## 5. Discussion & Comments

Each project has a built-in **discussion thread** for team collaboration, accessible from the project inspector.

### Writing Comments

1. Open a project in the inspector.
2. Scroll to the discussion section at the bottom.
3. Type your message (up to 4,000 characters) and press **Send**.

### File Attachments

You can attach files to comments:

- **Images** (PNG, JPG, WebP, GIF, etc.) — Display **inline** in the thread. Large images are automatically compressed.
- **PDFs** — Open in an **in-app PDF viewer** when clicked.
- **Other files** — Download when clicked.

Maximum file size: **20 MB** per file.

### Mentions & Notifications

Tag team members in comments using **@mentions**:

1. While writing a comment, type `@` followed by the user's name.
2. Select the user from the autocomplete dropdown.
3. When you send the comment, mentioned users receive a **notification**.

Mentioning a user also automatically **subscribes** them to the project's discussion thread, so they'll receive notifications for future comments on that project.

---

## 6. Syncing Data

Syncing is the process of fetching new tender opportunities from procurement sources.

### Manual Sync

1. Click the **Sync** button in the navigation bar.
2. In the sync panel, **select which sources** to scrape (or select all).
3. Configure options:
   - **Skip AI verification** — Bypass the cybersecurity relevance check
   - **Skip AI enrichment** — Bypass document analysis and enrichment
   - **Include expired** — Include tenders with past deadlines
4. Click **Start Sync**.
5. Watch the live console output as scrapers run.

### Scheduled Sync

Automate syncing on a recurring schedule:

1. Click the **Schedule** button in the navigation bar.
2. Toggle the schedule **on**.
3. Configure:
   - **Frequency** — Daily or weekly
   - **Day of week** (for weekly syncs)
   - **Time** — Hour and minute
   - **Timezone** — Your local timezone offset
   - **Sources** — Which scrapers to include
   - **Options** — Skip AI, include expired, etc.
4. Click **Save**.

The system uses APScheduler to trigger syncs at the configured time. The next scheduled run time is displayed in the schedule panel.

### Live Sync Output

During a sync (manual or scheduled), you can view **real-time console output**:

- The sync panel shows a live-updating log of scraper progress.
- Each scraper reports its status (`starting...`, `OK`, `failed`).
- A final summary shows total scraped, new projects, and AI verification stats.
- Per-scraper detailed logs are also available after completion.

### Sync History & Logs

The schedule panel displays **sync run history**, showing:

| Field              | Description                         |
|--------------------|-------------------------------------|
| Status             | Success / failure                   |
| Started at         | Timestamp when the sync began       |
| Finished at        | Timestamp when the sync completed   |
| Duration           | Total run time                      |
| New projects       | Number of new tenders found         |
| Sources            | Which scrapers were run             |
| Per-scraper logs   | Expandable detailed output per source |

---

## 7. Notifications

Procurement Watch has a real-time notification system. You receive notifications when:

| Event                | Description                                          |
|----------------------|------------------------------------------------------|
| **Mention**          | Someone tags you in a comment with `@mention`        |
| **Comment**          | Someone comments on a project you're assigned to or subscribed to |
| **Assignment**       | Someone assigns you to a project                     |
| **New projects**     | A sync finds new projects (browser notification)     |

**Notification features:**

- **Bell icon** in the navigation bar shows unread count.
- Click the bell to view the notification dropdown.
- Notifications are **grouped** by project, so multiple comments on the same project show as one item.
- **Mark as read** — Click a notification to mark it as read.
- **Mark all as read** — Clear all unread notifications.
- Click a notification to **jump directly** to the relevant project in the inspector.
- **Sound alert** — A notification sound plays when new projects are found during sync (only when the browser tab is active).

---

## 8. Configuration

### Keywords

Keywords define what the scrapers search for. They are cybersecurity-related terms used to filter procurement notices.

To manage keywords:

1. Navigate to the **Configuration** panel (gear icon).
2. View, add, or remove keywords.
3. Click **Save** to persist changes.

Default keywords include: `Cybersecurity`, `Penetration Testing`, `ISO 27001`, `VAPT`, `ISMS`, `PCI DSS`, `SWIFT CSP`, and more.

> [!TIP]
> Keywords support both English and French terms. Add industry-specific terms that match the tenders you're looking for.

### Regions & Geography

The app includes normalized geography data for filtering:

- **Continents** — Top-level geographic grouping
- **Regions** — Sub-continental groups (e.g. West Africa, Southeast Asia)
- **Countries** — Individual countries mapped to regions

Region data is used by:

- Dashboard filter dropdowns
- Project metadata normalization
- Advanced boolean search queries

To manage regions:

1. Go to the **Configuration** panel.
2. Edit the region-country mappings.
3. Save changes.

Default regions: West Africa, East Africa, Southern Africa, Central Africa, North Africa, Central Asia, South Asia, Southeast Asia, Latin America, Caribbean, Eastern Europe.

---

## 9. User Administration

> **Admin role required** for all user management actions.

### Creating Users

1. Navigate to the **User Management** page (user icon in the sidebar).
2. Click **Add User**.
3. Fill in:
   - **Name**
   - **Email**
   - **Role** — `admin`, `manager`, or `user`
   - **Password** *(optional)* — If not provided, a secure password is auto-generated
4. Click **Create**.
5. Share the temporary password with the new user. They will be forced to change it on first login.

### Editing Users

1. On the User Management page, click **Edit** on any user row.
2. Update the user's name, email, role, or active status.
3. Click **Save**.

> You cannot remove your own admin role.

### Resetting Passwords

1. Click **Reset Password** on a user row.
2. Optionally provide a specific new password, or let the system generate one.
3. The user will be forced to change the password on next login.

### Deactivating & Deleting Users

- **Deactivate** — Toggle the user's active status off. They can no longer log in but their data is preserved.
- **Delete** — Permanently remove the user account.

> You cannot delete your own account.

---

## 10. Data Export

Export project data as Excel spreadsheets:

- **Export All** — Download all projects as `projects.xlsx` from the toolbar.
- **Export Filtered** — Apply filters/search first, then export only the visible results.
- **Export Selected** — Select specific projects with checkboxes, then export the selection.

The Excel file includes all project fields: source, name, ID, sponsor, country, deadline, decision, AI verification status, matched keywords, and more.

> [!NOTE]
> An Excel file is also automatically regenerated after each sync and after project mutations (delete, decision change, etc.).

---

## 11. Supported Procurement Sources

| Source           | Key             | Description                                     |
|------------------|-----------------|-------------------------------------------------|
| **IADB**         | `iadb`          | Inter-American Development Bank                 |
| **World Bank**   | `worldbank`     | World Bank procurement opportunities            |
| **Global Tenders** | `globaltenders` | Global Tenders aggregator                     |
| **GIZ**          | `giz`           | German development agency                       |
| **DevelopmentAid** | `devaid`      | DevelopmentAid tenders portal                   |
| **DGMarket**     | `dgmarket`      | DGMarket procurement notices                    |
| **Africa Gateway** | `africagateway` | African Development Bank opportunities        |
| **IsDB**         | `isdb`          | Islamic Development Bank                        |
| **BADEA**        | `badea`         | Arab Bank for Economic Development in Africa    |
| **BCIE**         | `bcie`          | Central American Bank for Economic Integration  |
| **EABR**         | `eabr`          | Eurasian Development Bank                       |
| **OAS**          | `oas`           | Organization of American States                 |
| **African Union** | `africanunion` | African Union procurement                       |

Each scraper searches these sources using your configured keywords and returns normalized project records.

---

## 12. User Roles & Permissions

| Action                      | Admin | Manager | User |
|-----------------------------|:-----:|:-------:|:----:|
| View dashboard & projects   | ✅    | ✅      | ✅   |
| Search & filter             | ✅    | ✅      | ✅   |
| Vote on projects            | ✅    | ✅      | ✅   |
| Comment & attach files      | ✅    | ✅      | ✅   |
| Export data to Excel        | ✅    | ✅      | ✅   |
| Set project decisions       | ❌    | ✅      | ❌   |
| Override deadlines          | ✅    | ✅      | ❌   |
| Assign users to projects    | ✅    | ✅      | ✅   |
| Trigger manual sync         | ✅    | ✅      | ✅   |
| Manage schedule             | ✅    | ✅      | ✅   |
| Configure keywords/regions  | ✅    | ✅      | ✅   |
| Manage users (CRUD)         | ✅    | ❌      | ❌   |
| Reset user passwords        | ✅    | ❌      | ❌   |
| Manage release notes        | ✅    | ❌      | ❌   |
| Delete projects             | ✅    | ✅      | ✅   |

---

## 13. Release Notes Management

> **Admin role required.**

Admins can manage in-app release notes that inform users about platform updates:

1. Navigate to **Release Notes** in the admin section.
2. Add, edit, or remove release note entries.
3. Each release note has:
   - **Version** number (e.g. `1.2`)
   - **Title** — Brief headline
   - **Summary** — Short description
   - **Items** — Bullet list of changes

When a new version is deployed, users see the release notes modal on their next visit. They can also access full release notes history from the app menu.

---

## 14. Troubleshooting

### Common Issues

| Problem                              | Solution                                                                     |
|--------------------------------------|------------------------------------------------------------------------------|
| **"No admin exists"** on login page  | Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` and restart backend |
| **Cannot log in**                    | Check that the user account is active and credentials are correct            |
| **Sync fails for a source**          | Check the scraper logs for errors; the source website may be down            |
| **AI verification skipped**          | Ensure `DEEPSEEK_API_KEY` or `OPENAI_API_KEY` is set in `.env`              |
| **No projects found after sync**     | Check your keywords configuration; projects may not match any keywords       |
| **Excel export fails**               | Ensure `openpyxl` is installed and disk space is available                   |
| **Frontend can't connect to backend**| Verify backend is running on port 8000; check CORS settings                  |
| **DGMarket scraper fails**           | Update `DGMARKET_SESSION_ID` in `.env` with a fresh session ID              |

### Checking Backend Health

```bash
curl http://localhost:8000/api/health
# Expected: {"ok": true}
```

### Running Tests

```bash
cd backend
pytest
```

### Viewing Logs

- **Backend logs** — Check the terminal running `uvicorn` or Docker container logs.
- **Sync logs** — Available in the Schedule panel under run history.
- **Per-scraper logs** — Expandable detail in each sync history entry.

---

## 15. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React + Vite)                 │
│  Login │ Dashboard │ Inspector │ Sync │ Schedule │ Admin        │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API + SSE
┌────────────────────────────┴────────────────────────────────────┐
│                   Backend (FastAPI + Python)                    │
│  Auth │ Projects │ Comments │ Notifications │ Scheduler │ Sync  │
├─────────────┬──────────────────┬────────────────────────────────┤
│  MongoDB    │  File Uploads    │  Sync Subprocess (main.py)     │
│  (data)     │  (backend/       │  ┌─ Scrapers (13 sources)     │
│             │   uploads/)      │  ├─ AI Filter (relevance)     │
│             │                  │  ├─ AI Enrichment (docs)      │
│             │                  │  └─ Deduplication + Persistence│
└─────────────┴──────────────────┴────────────────────────────────┘
```

**Key data flows:**

1. **User → Frontend → API → MongoDB** — Standard CRUD operations
2. **Sync → Subprocess → Scrapers → AI → MongoDB** — Background data pipeline
3. **Backend → SSE → Frontend** — Real-time sync logs and notifications

**Technology stack:**

| Layer     | Technology                                                |
|-----------|-----------------------------------------------------------|
| Frontend  | React 19, Vite 7, React Aria, Untitled UI, CSS            |
| Backend   | Python 3.12, FastAPI, Pydantic, APScheduler               |
| Database  | MongoDB (via PyMongo)                                      |
| AI        | DeepSeek / OpenAI APIs                                    |
| Scraping  | Requests, BeautifulSoup, Selenium, mitmproxy              |
| Auth      | JWT (PyJWT), bcrypt                                       |
| Deploy    | Docker Compose, Nginx                                     |

---

*For developer documentation, see [ARCH.md](ARCH.md). For installation details, see [INSTALL.md](INSTALL.md).*

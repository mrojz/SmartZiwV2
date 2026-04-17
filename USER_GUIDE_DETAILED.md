# Procurement Watch User Guide

This guide gives a practical overview of the application, the main workflows, and the screens users interact with every day.

## 1. Purpose

Procurement Watch helps teams find cybersecurity-related tenders, review them with AI support, collaborate on decisions, and manage monitoring from one workspace.

## 2. Access and Roles

- Users sign in with their account and may be asked to change their password on first access.
- `User` can review tenders, comment, vote, assign users, save searches, run sync, and use Deep Dive Search.
- `Manager` can do everything a user can do and can also set `Go / No Go`.
- `Admin` manages users, release notes, settings, and platform configuration.

## 3. Dashboard Overview

![Dashboard overview](docs/user-guide-assets/dashboard-overview.png)

The dashboard is the main review workspace.

- Search tenders with the global search box.
- Apply quick filters for source, region, continent, decision, AI status, and deadline.
- Use the expiring filter with a custom number of days.
- Save a search and reuse it later from `Saved searches`.
- Open a tender directly from the row or inspect it in the drawer.
- See row signals for comments, attachments, and assigned users.

## 4. Search, Filters, and Saved Searches

![Dashboard overview](docs/user-guide-assets/dashboard-overview.png)

- `Hide filters` collapses the full search area to save space.
- `Advanced query` supports boolean logic such as `AND`, `OR`, `NOT`, and parentheses.
- Saved searches store the current search, filters, and advanced query state.
- The quick expiry control helps focus on AI-verified tenders closing soon.

## 5. Tender Drawer and Review Workflow

![Project drawer](docs/user-guide-assets/project-drawer.png)

The drawer is the main tender review panel.

- Review title, source, region, dates, and matched signals.
- Open the source page or supporting links.
- Update the deadline when your role allows it.
- Set `Go / No Go` if you are a manager.
- Use `Upvote` and `Downvote` to give team signal.
- Assign teammates to show who is working on the tender.
- Run `Deep Dive Search` to ask the AI to research the tender source and post a summary in comments.

## 6. Comments, Mentions, and Attachments

![Project drawer](docs/user-guide-assets/project-drawer.png)

- Add comments directly inside the tender drawer.
- Tag users with `@` to mention them.
- Images appear inline in the discussion thread.
- PDF files open inside the app instead of forcing a download.
- Bot comments and user comments appear in the same discussion history.
- Tagged users receive notifications and remain subscribed to future discussion on that tender.

## 7. Notifications

![Notifications panel](docs/user-guide-assets/notifications-panel.png)

- Notifications are grouped by tender and action.
- Unread and read items are visually distinct.
- Opening the panel marks notifications as viewed.
- Clicking a notification marks it as read and opens the related tender drawer.
- Notifications cover mentions, assignments, and new comments on followed tenders.

## 8. Manual Sync

![Manual sync](docs/user-guide-assets/manual-sync.png)

Manual sync lets users launch an on-demand collection run.

- Select one or more sources.
- Choose processing options such as skipping AI or including expired notices.
- Follow live status in the log panel while the sync is running.
- New tenders found during sync enter the normal AI review pipeline.

## 9. Scheduled Sync

![Scheduled sync](docs/user-guide-assets/schedule-sync.png)

Scheduled sync automates collection.

- Enable or disable the scheduler.
- Choose daily or weekly execution.
- Set local time and timezone.
- The application translates that time to server execution time.
- Select the sources to include in the schedule.
- Review run history, durations, new project counts, and scraper output.

## 10. Settings

![Settings](docs/user-guide-assets/settings-config.png)

Settings control the watch list used by the platform.

- Manage tracked keywords.
- Maintain region groups and geography mappings.
- Save changes so sync and filtering stay aligned with analyst needs.

## 11. Admin: User Management

![Admin users](docs/user-guide-assets/admin-users.png)

Admins can manage platform access from the `Admin` page.

- Create users.
- Set role: `user`, `manager`, or `admin`.
- Activate or deactivate accounts.
- Reset passwords.
- Review last app activity.

## 12. Admin: Release Notes

![Admin release notes](docs/user-guide-assets/admin-release-notes.png)

Admins can maintain in-app release notes.

- Create a new release note.
- Edit version, title, summary, and bullet points.
- Delete outdated notes.
- Publish updates so users see what changed after a release.

## 13. Profile

![Profile settings](docs/user-guide-assets/profile-settings.png)

Each user can manage their own account details.

- Update display name and email.
- Add or change avatar URL.
- Change password.
- Review account information in one place.

## 14. Release Notes

![Release notes page](docs/user-guide-assets/release-notes-page.png)

- Users can open release notes at any time from the sidebar.
- The app also shows the latest release note automatically after an upgrade.
- Full version history stays available from the release notes page.

## 15. Supported Sources

The platform currently supports these sources:

- IADB
- World Bank
- Global Tenders
- GIZ
- DevelopmentAid
- DGMarket
- Africa Gateway
- IsDB
- BADEA
- BCIE
- EABR
- OAS
- African Union

## 16. Typical Daily Workflow

1. Open the dashboard and load a saved search or apply quick filters.
2. Review AI-verified tenders and focus on expiring opportunities.
3. Open a tender in the drawer.
4. Assign teammates, vote, comment, and mention users where needed.
5. Use Deep Dive Search when more context is required.
6. Set the final decision if your role allows it.
7. Monitor notifications for mentions, assignments, and new comments.

## 17. Key AI Usage in Procurement Watch

AI is used in three main places:

- AI verification filters incoming tenders and keeps relevant cybersecurity opportunities.
- AI enrichment improves tender context and extracted metadata during sync.
- Deep Dive Search researches a selected tender, identifies the likely source, and posts a short structured summary in the discussion thread.

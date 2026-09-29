# Personal-Dashboard

A vibecoded personal productivity dashboard that pulls tasks, calendar events, notes, goals, progress, and study sessions into one organized space. It gives you a daily overview of what is due, how much you have focused, and how your goals are tracking — alongside a Pomodoro timer and quick notes.

The project is a work in progress, with features and design elements still being refined.

## Live Site

https://kennethgaytano.github.io/Personal-Dashboard/

## Features

**Home** — greeting, Today's Tasks (up to 3, checkable in place with a live overdue badge), Quick Notes, an overview stat strip, and a Pomodoro timer.

- **Tasks** — full CRUD with due dates/times, three priorities, a description, and To Do / In Progress / Completed columns. Open tasks past their due moment show an overdue warning, and tasks can carry optional links.
- **Today's Tasks** — max 3 tasks including completed ones, toggleable in place; the overdue badge updates immediately.
- **Pomodoro** — start/pause/reset across Focus and Break modes with a custom 1–120 minute input. A focus session is written to `dashboard_pomodoro_sessions` **only when a block actually completes** — pausing early does not log time.
- **Notes & Quick Notes** — full CRUD with a color picker, edit/delete, a shared store between the two pages, and toast notifications.
- **Calendar** — full CRUD for events in `dashboard_events`: dot markers on the grid, a selected-day panel, an Upcoming Events grouped list, an edit banner with cancel, focus management, accessible group roles, a responsive form, and HTML escaping.
- **Goals** — full CRUD in `dashboard_goals` with a milestone checklist. Toggling a milestone recalculates overall progress, and edit/delete run through a focus-trapped confirmation modal.
- **Progress** — derived weekly stats over a rolling 7-day window (tasks done, hours studied, pomodoros, day streak), computed from real task and focus-session data rather than hardcoded numbers, plus:
  - **Skills & Learning** and **Project Completion** (`dashboard_skills` / `dashboard_projects`) as add/delete lists, seeded with 5 skills and 3 projects.
  - Progress moves along a fixed 8-step ladder — `0, 25, 50, 60, 70, 80, 90, 100` — using ‹ › steppers with a "Step N of 8" readout. Values snap to the nearest rung at display time.
  - A read-only **Goals Progress** view with All / Active / Paused / Completed filters and an average-progress summary.

> **Note:** the delete-confirmation modal on the Progress page is present in the markup but not currently wired up — deleting a track takes effect immediately.

## Tech stack

Static HTML, CSS, and vanilla JavaScript. No framework, no build step, no backend. All data lives in the browser's `localStorage`, so it is per-device and does not sync.

## Data storage

| Key | Contents |
| --- | --- |
| `dashboard_tasks` | Task list |
| `dashboard_events` | Calendar events |
| `dashboard_notes` | Notes and quick notes (shared store) |
| `dashboard_goals` | Goals, with milestones and status |
| `dashboard_skills` | Skills & Learning tracks |
| `dashboard_projects` | Project Completion tracks |
| `dashboard_pomodoro_sessions` | Completed focus sessions: `{ id, mode, startedAt, completedAt, minutes }` |
| `pomodoro_state` | Live timer state, so a refresh does not lose the countdown |

To reset everything, clear site data for the origin in your browser.

## Project structure

- `index.html` — home page and deployed entry point.
- `pages/` — one HTML file per feature: `tasks`, `calendar`, `notes`, `progress`, `goals`.
- `scripts/` — one module per page (`tasks.js`, `calendar.js` + `calendar-events.js`, `notes.js` + `quick-notes.js`, `progress.js`, `goals.js`, `home.js`, `pomodoro.js`), plus the shared `nav.js` and `link-utils.js`.
- `styles/` — split stylesheets: `base.css` (tokens/reset), `layout.css` (sidebar and page scaffolding), `components.css` (buttons, forms, modal, toast), plus one file per page.
- `.claude/skills/run-personal-dashboard/` — local server, smoke test, and Playwright check scripts (`smoke.mjs`, `task-tests.mjs`, `progress-tests.mjs`, plus targeted checks).


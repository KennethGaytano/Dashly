# Personal-Dashboard

An AI-assisted personal productivity dashboard that brings tasks, calendar events, notes, goals, progress, and study sessions into one organized space. It provides a daily overview of what is due, focused study time, and goal progress, along with a Pomodoro timer and quick notes.

## Live Site

https://kennethgaytano.github.io/Personal-Dashboard/

## Features

**Home** — greeting, Today's Tasks (up to 3, checkable in place with a live overdue badge), Quick Notes, an overview stat strip, and a Pomodoro timer.

- **Tasks** — full CRUD with due dates/times, three priorities, a description, and To Do / In Progress / Completed columns. Open tasks past their due moment show an overdue warning, and tasks can carry optional links.
- **Today's Tasks** — max 3 tasks including completed ones, toggleable in place; the overdue badge updates immediately.
- **Pomodoro** — start/pause/reset across Focus and Break modes with a custom 1–120 minute input. A focus session is written to `dashboard_pomodoro_sessions` **only when a block actually completes** — pausing early does not log time.
- **Notes & Quick Notes** — full CRUD with a color picker, edit/delete, a shared store between the two pages, and toast notifications.
- **Calendar** — full CRUD for events in `dashboard_events`: dot markers on the grid, a selected-day panel, an Upcoming Events grouped list, an edit banner with cancel, focus management, accessible group roles, a responsive form, and HTML escaping.
- **Goals** — full CRUD in `dashboard_goals` with a milestone checklist. Toggling a milestone recalculates overall progress, and edit/delete run through a focus-trapped confirmation modal. Completing a goal works three ways — ticking every milestone, choosing **Completed** in the status dropdown, or setting progress to 100 with no milestones — and all of them are reflected in the status badge and in the Progress page's Completed filter. Un-completing a goal reverts it to Active, and a paused goal stays paused.
  - A read-only **Goals Progress** view on the Progress page lists every goal with All / Active / Paused / Completed filters and an average-progress summary. Status is re-derived from progress and milestones on read, so goals saved before this behaviour existed show under the right filter.
- **Progress** — derived weekly stats over a rolling 7-day window (tasks done, hours studied, pomodoros, day streak), computed from real task and focus-session data rather than hardcoded numbers, plus:
  - **Skills & Learning** and **Project Completion** (`dashboard_skills` / `dashboard_projects`) as add/delete lists, seeded with 5 skills and 3 projects.
  - Progress moves along a fixed 8-step ladder — `0, 25, 50, 60, 70, 80, 90, 100` — using ‹ › steppers with a "Step N of 8" readout. Values snap to the nearest rung at display time.

> **Note:** the delete-confirmation modal on the Progress page is present in the markup but not currently wired up — deleting a track takes effect immediately.

## Tech stack

Static HTML, CSS, and vanilla JavaScript. No framework, no build step, no backend. All data lives in the browser's `localStorage`, so it is per-device and does not sync.

## Design & accessibility

- **Dark theme** driven entirely by CSS custom properties in `base.css`, so the whole palette is defined in one place rather than sprinkled through the stylesheets.
- **Staggered page-load reveal** — navigation is a full document load, so instead of a blank flash each page fades and rises into place, 50ms apart, 0.25s per block. Defined once in `layout.css` and applied to every page.
- **`prefers-reduced-motion` honoured globally** — a single rule in `base.css` collapses every animation and transition to 0.01ms, so the reveal and all hover states disappear for anyone who has asked their OS for reduced motion. No per-feature opt-out needed.
- **Keyboard support** — a skip link on every page, visible focus rings, focus trapping in the mobile nav drawer and the Goals delete modal, `Escape` to dismiss, and focus returned to the trigger on close.
- **Semantics** — the active nav item carries `aria-current="page"`, toasts are `role="alert" aria-live="polite"`, and all dynamically rendered text is HTML-escaped before insertion.
- **Custom scrollbar** tinted to the accent colour across the app.

## Mobile

Below 768px the sidebar becomes an off-canvas drawer and the app gains two pieces of persistent chrome.

- **App bar** — a sticky header naming the current page. It replaced a floating hamburger button and the 4.5rem of page padding that existed only to leave room for that button.
- **Tab bar** — five destinations at thumb height: Home, Tasks, Calendar, Notes, and More. Progress and Goals are deliberately not tabs: six across 390px is about 65px each, which truncates every label, so both sit behind **More**, which opens the existing drawer. The active destination is marked by a rule above the icon and `aria-current="page"`; on Progress and Goals the **More** tab carries that state instead.
- **Only one control opens the drawer.** Two buttons for the same panel (a hamburger plus a More tab) was redundant, so the hamburger is gone. `nav.js` wires the More tab to the same open/close path, keeping the focus trap, `Escape` handling, and focus restoration.
- **Notch and home-indicator insets** are honoured via `env(safe-area-inset-*)`, which requires `viewport-fit=cover` in the viewport meta tag on every page. Both `env()` reads resolve to `0` elsewhere, so the maths stays valid on every other browser.
- **The drawer uses `100dvh`**, not `100vh`, so it tracks the shrinking viewport as a mobile browser's URL bar slides away.
- **Modals become bottom sheets**, anchored to the bottom edge with full-width stacked actions, because a centred dialog on a phone puts its buttons where a thumb covers them.
- **Compact stat cards** below 480px. Four full-width cards pushed the first real content off the screen; the overview is now roughly a third of its former height.
- **Touch targets** are held to 44px throughout. Where the visual design is smaller by intent — the 24px task checkbox, the 24px note colour swatch — a transparent overlay widens the tappable area without changing what is drawn.
- **The calendar form** stacks to one field per row on a phone and one column at tablet width, five-across only on desktop. Its old layout lived in inline `style` attributes, which no media query can override.

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
- `styles/` — split stylesheets: `base.css` (design tokens, reset, reduced-motion), `layout.css` (sidebar, app bar, tab bar, page scaffolding, and the page-load reveal), `components.css` (buttons, forms, modal, toast), plus one file per page.
- `.claude/skills/run-personal-dashboard/` — local server, smoke test, and Playwright check scripts (`smoke.mjs`, `task-tests.mjs`, `goals-tests.mjs`, `progress-tests.mjs`, `mobile-audit.mjs`, `mobile-nav-tests.mjs`, `layout-chain.mjs`, plus targeted checks).

### Running the checks

```bash
cd .claude/skills/run-personal-dashboard
node task-tests.mjs
```

Each script starts its own server and shuts it down afterwards, exiting non-zero on failure. They all bind port 3000, so **run them one at a time** — launching two in parallel makes the second fail with `ERR_CONNECTION_REFUSED`.

### Mobile checks

```bash
node mobile-audit.mjs        # geometry: 6 widths x 6 pages, seeded with data
node mobile-nav-tests.mjs    # app bar / tab bar / drawer behaviour at 390px
node layout-chain.mjs 320    # names whatever is forcing a horizontal scroll
```

`mobile-audit.mjs` reports horizontal overflow, interactive targets under 44px, and form controls under 16px (which make iOS zoom the viewport on focus). It seeds `localStorage` first, so unlike `mobile-shots.mjs` it exercises the content views rather than only empty states.

`layout-chain.mjs` exists because horizontal overflow is hard to attribute by eye. It hides one element at a time and watches `window.innerWidth`, which names the origin directly.


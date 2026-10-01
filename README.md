# Dashly

A personal productivity dashboard that puts tasks, calendar events, notes, goals,
focus sessions, and progress in one place. Sign in and your data follows you
across devices; sign out and nothing is left behind.

**Live site:** https://kennethgaytano.github.io/Personal-Dashboard/

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Data model](#data-model)
- [Project structure](#project-structure)
- [Design and accessibility](#design-and-accessibility)
- [Mobile](#mobile)
- [Forms are hidden until you ask](#forms-are-hidden-until-you-ask)
- [Running the checks](#running-the-checks)

---

## Features

**Home** — a greeting, Today's Tasks (up to three, checkable in place with a live
overdue badge), Quick Notes, a stat strip derived from your real data, and the
Pomodoro timer.

- **Tasks** — full CRUD with due dates and times, three priorities, a
  description, optional links, and To Do / In Progress / Completed columns. Open
  tasks past their due moment show an overdue warning.
- **Today's Tasks** — up to three tasks including completed ones, toggleable in
  place; the overdue badge updates immediately.
- **Pomodoro** — start, pause, and reset across Focus and Break modes with a
  custom 1–120 minute length. The completion sound repeats until you press
  **Stop alarm**, and stopping a completed Focus alarm switches the timer to
  Break. A focus session is recorded **only when a block actually completes** —
  pausing early logs no time.
- **Notes** — full CRUD with a colour picker, edit and delete, and toast
  notifications. Quick Notes on the home page shares the same store.
- **Calendar** — full CRUD for events: dot markers on the grid, a selected-day
  panel, an Upcoming Events list grouped by day, and an edit banner with cancel.
  Picking a day updates the event list; it does not summon the form.
- **Goals** — full CRUD with a milestone checklist. Ticking a milestone
  recalculates overall progress, and edit and delete run through a focus-trapped
  confirmation modal. A goal counts as Completed three ways — every milestone
  ticked, **Completed** chosen in the status dropdown, or progress set to 100
  with no milestones — and all three are reflected in the status badge and in the
  Progress page's Completed filter. Un-completing reverts a goal to Active, and
  a paused goal stays paused.
  - A read-only **Goals Progress** view on the Progress page lists every goal
    with All / Active / Paused / Completed filters and an average-progress
    summary. Status is re-derived from progress and milestones on read, so goals
    saved before this behaviour existed still show under the right filter.
- **Progress** — weekly stats over a rolling seven-day window (tasks done, hours
  studied, pomodoros, day streak), computed from real task and focus-session
  data rather than hardcoded numbers, plus **Skills & Learning** and **Project
  Completion** add/delete lists. Progress moves along a fixed eight-step ladder —
  `0, 25, 50, 60, 70, 80, 90, 100` — using steppers with a "Step N of 8"
  readout, and snaps to the nearest rung at display time.
- **Light and dark themes** — a toggle in the sidebar and app bar switches
  appearance and remembers the choice. The setting is applied before first paint
  so the page never flashes the wrong theme.

> **Known gap:** the delete-confirmation modal on the Progress page is present in
> the markup but not wired up — deleting a track takes effect immediately.

## Tech stack

Static HTML, CSS, and vanilla JavaScript. No framework, no build step, no
bundler. Supabase Auth and PostgreSQL handle signed-in, per-user cloud data.

The browser uses the Supabase **publishable** key, and Row Level Security
restricts every account to its own records. A `localStorage` cache keeps the
synchronous page modules responsive, while writes are persisted to Supabase and
realtime updates refresh your other devices.

## Design and accessibility

- **Theming from tokens** — every colour, radius, and shadow is a CSS custom
  property in `base.css`, with the light theme as a second token block under
  `:root[data-theme="light"]`. One file owns the palette.
- **Theme applied before first paint** — `theme.js` reads the saved preference in
  a blocking script in `<head>`, so there is no flash of the wrong appearance.
- **Staggered page-load reveal** — navigation is a full document load, so rather
  than a blank flash each page fades and rises into place, 50ms apart, 0.25s per
  block. Defined once in `layout.css`.
- **`prefers-reduced-motion` honoured globally** — a single rule in `base.css`
  collapses every animation and transition to 0.01ms. No per-feature opt-out.
- **Keyboard support** — a skip link on every page, visible focus rings, focus
  trapping in the mobile nav drawer and the Goals delete modal, `Escape` to
  dismiss, and focus returned to the trigger on close.
- **Semantics** — the active nav item carries `aria-current="page"`, toasts are
  `role="alert" aria-live="polite"`, and all dynamically rendered text is
  HTML-escaped before insertion.
- **Custom scrollbar** tinted to the accent colour throughout.

## Mobile

Below 768px the sidebar becomes an off-canvas drawer and the app gains two pieces
of persistent chrome.

- **App bar** — a sticky header naming the current page, replacing a floating
  hamburger and the 4.5rem of padding that existed only to clear it.
- **Tab bar** — five destinations at thumb height: Home, Tasks, Calendar, Notes,
  and More. Progress and Goals are deliberately not tabs: six across 390px is
  about 65px each, which truncates every label, so both sit behind **More**,
  which opens the existing drawer. On those two pages the **More** tab carries
  `aria-current="page"`.
- **Only one control opens the drawer.** Two buttons for one panel was
  redundant, so the hamburger is gone; `nav.js` wires the More tab to the same
  open/close path, keeping the focus trap, `Escape` handling, and focus
  restoration.
- **Notch and home-indicator insets** are honoured via `env(safe-area-inset-*)`,
  which requires `viewport-fit=cover` in the viewport meta tag on every page.
  Both reads resolve to `0` elsewhere, so the maths stays valid everywhere.
- **`100dvh`, not `100vh`**, so the drawer tracks the shrinking viewport as a
  mobile browser's URL bar slides away.
- **Modals become bottom sheets**, anchored to the bottom edge with full-width
  stacked actions, because a centred dialog on a phone puts its buttons under
  the thumb.
- **Compact stat cards** below 480px, where four full-width cards pushed real
  content off the screen.
- **Touch targets** are held to 44px. Where the design is deliberately smaller —
  the 24px task checkbox, the 24px note colour swatch — a transparent overlay
  widens the tappable area without changing what is drawn.
- **The calendar form** stacks to one field per row on a phone, one column at
  tablet width, and five across only on desktop.

## Forms are hidden until you ask

Opening a page shows the content, not a wall of input panels. All six add/edit forms start collapsed behind a button and open on click, on desktop and mobile alike.

- **One button per form** — Tasks `+ Add Task`, Calendar `+ Add event`, Notes
  `+ New Note`, Goals `+ New Goal`, Progress `+ Add Track`, home `+ Quick Note`.
  Each is a real `<button>` with `aria-expanded` and `aria-controls`, and each
  toggles — a second click puts the form away again.
- **Editing opens the form for you.** The pencil button on a task, event, note,
  or goal reveals the same panel, already filled in, with the heading and submit
  button switched to their edit wording.
- **Escape closes it**, as do Cancel and saving, and focus returns to the button
  that opened it.
- **Cancel is visible whenever the form is.** The other five forms used to hide
  Cancel until you started *editing*, which was correct while forms sat
  permanently on the page and wrong once they became disclosures — opening a form
  to add something left no way to back out. Collapsing the panel is now what takes
  Cancel away.
- **The panels use the `hidden` attribute**, not a CSS rule, so a collapsed form
  is genuinely out of the tab order and the accessibility tree rather than merely
  looking invisible.
- **The shared behaviour lives in `form-disclosure.js`.** Each page supplies only
  the trigger and the panel, so all six behave identically and one fix lands
  everywhere.
- **The calendar deliberately does not open the form when you pick a day**,
  because opening a calendar should not summon an input panel.

## Data model

Cloud records live in one table, `public.dashboard_records`, keyed by
`(user_id, collection, record_id)` with a `jsonb` payload and `updated_at`. The
`collection` value is constrained to the eight keys below. Realtime is enabled on
the table, so a change on one device lands on the others.

| Collection | Local cache key | Contents |
| --- | --- | --- |
| `tasks` | `dashboard_tasks` | Task list |
| `events` | `dashboard_events` | Calendar events |
| `notes` | `dashboard_notes` | Notes and quick notes (shared store) |
| `goals` | `dashboard_goals` | Goals, with milestones and status |
| `skills` | `dashboard_skills` | Skills & Learning tracks |
| `projects` | `dashboard_projects` | Project Completion tracks |
| `pomodoro_sessions` | `dashboard_pomodoro_sessions` | Completed focus sessions: `{ id, mode, startedAt, completedAt, minutes }` |
| `pomodoro_state` | `pomodoro_state` | Live timer state, so a refresh does not lose the countdown |

The browser also keeps `dashly_cloud_user_id` and `dashly_theme`.

To reset everything, clear site data for the origin in your browser.

## Project structure

```
index.html              home page and deployed entry point
pages/                  one HTML file per feature: tasks, calendar, notes, progress, goals
scripts/                feature modules plus shared nav, link-utils, form-disclosure
  cloud.js              authenticated persistence, localStorage cache, realtime sync
  supabase-config.js    project URL and publishable key
  theme.js              light/dark preference, applied before first paint
styles/                 base.css (tokens, reset, reduced motion), layout.css (sidebar,
                        app bar, tab bar, scaffolding), components.css, + one per page
assets/brand/           logo assets used by the page chrome and favicon
assets/audio/           pomodoro completion sound
supabase/schema.sql     table, indexes, RLS policies, Realtime publication
.claude/skills/         local server and Playwright check scripts
```

There is no build step. To run it locally, serve the repository root over HTTP —
opening `index.html` from the filesystem will not work, because the pages load
each other with relative paths and `file://` blocks those requests.

```bash
cd .claude/skills/run-personal-dashboard
node server.mjs        # http://localhost:3000/
```

## Running the checks

The suites live in `.claude/skills/run-personal-dashboard/` and drive the app with
Playwright. Each script starts its own server and shuts it down afterwards, and
exits non-zero on failure.

> **Run them one at a time.** They all bind port 3000, so launching two in
> parallel makes the second fail with `ERR_CONNECTION_REFUSED`.

```bash
cd .claude/skills/run-personal-dashboard

node smoke.mjs                    # all pages load, navigation, core interactions
node auth-tests.mjs               # sign-up, sign-in, confirmation redirects
node task-tests.mjs               # one behaviour suite per feature area
node goals-tests.mjs
node notes-tests.mjs
node progress-tests.mjs
node calendar-tests.mjs
node form-disclosure-tests.mjs    # the collapsed-form contract on all six pages
```

### Layout and mobile regression

```bash
node mobile-audit.mjs             # geometry: 6 widths x 6 pages, seeded with data
node mobile-nav-tests.mjs         # app bar / tab bar / drawer behaviour at 390px
node width-sweep.mjs              # 16 widths with hostile content
node layout-chain.mjs 320         # names whatever forces a horizontal scroll
```

`mobile-audit.mjs` reports horizontal overflow, interactive targets under 44px,
and form controls under 16px (which make iOS zoom the viewport on focus). It seeds
`localStorage` first, so it exercises content views rather than only empty states.

`width-sweep.mjs` seeds one long unbroken URL, because people paste URLs into
titles and a single token with no break opportunity is what actually breaks
layout. `layout-chain.mjs` exists because overflow is hard to attribute by eye: it
hides one element at a time and watches `window.innerWidth`, which names the
origin directly.

### Interactive driver

```bash
node driver.mjs launch
node driver.mjs navigate tasks
node driver.mjs click "text=Add Task"
node driver.mjs eval "document.querySelectorAll('.task-item').length"
node driver.mjs screenshot ./shot.png
node driver.mjs quit
```

Use the driver to poke around; use the suites to prove nothing broke.

### Other utilities

```bash
node scan-encoding.mjs     # flags replacement chars and mojibake in any product file
node disclosure-shots.mjs  # closed vs open form screenshots
```

Run `scan-encoding.mjs` after any bulk edit, and prefer writing shared markup into
a file or generating it from a template — see the gotchas in
`.claude/skills/run-personal-dashboard/SKILL.md` for why that matters here.

# Dashly

A personal productivity dashboard that puts tasks, calendar events, notes, goals,
focus sessions, and progress in one place. Sign in and your data follows you
across devices; sign out and nothing is left behind.

**Live site:** https://kennethgaytano.github.io/Personal-Dashboard/

---

## About

Dashly is a single-page productivity dashboard built as static HTML, CSS, and
vanilla JavaScript. There is no framework, no bundler, and no build step — what
ships is exactly what is in the repository. Data lives in the browser for
instant reads and is synchronised per account to Supabase, so the dashboard works
the same offline-first on a laptop and on a phone.

Authentication uses email and password. Users can create an account or sign in
from the dashboard. To make new accounts usable immediately without an email
verification step, disable **Confirm email** for the Email provider in the
Supabase project's Authentication settings. Existing accounts created through
the previous email-code flow may need a password set before password sign-in.

The interface is responsive down to 320px: below 768px the sidebar becomes an
off-canvas drawer with a sticky app bar and a five-destination tab bar, and
dialogs become bottom sheets. Light and dark themes are driven entirely by CSS
custom properties and applied before first paint, so the page never flashes the
wrong theme.

---

## Features

- **Tasks** — full CRUD with due dates and times, three priorities, a
  description, optional links, and To Do / In Progress / Completed columns. Open
  tasks past their due moment show an overdue warning.
- **Today's Tasks** — up to three tasks including completed ones, toggleable in
  place; the overdue badge updates immediately.
- **Pomodoro** — start, pause, and reset across Focus and Break modes with a
  custom 1–120 minute length. A session is recorded **only when a block actually
  completes** — pausing early logs no time. Timer state survives a refresh.
- **Notes** — full CRUD with a colour picker, shared with the Quick Notes panel
  on the home page.
- **Calendar** — full CRUD for events with dot markers on the grid, a
  selected-day panel, and an Upcoming Events list grouped by day.
- **Goals** — full CRUD with a milestone checklist. Ticking a milestone
  recalculates progress, and a goal counts as Completed when every milestone is
  ticked, when the status is set directly, or when progress hits 100 with no
  milestones.
- **Progress** — weekly stats over a rolling seven-day window (tasks done, hours
  studied, pomodoros, day streak) computed from real data, plus Skills &
  Learning and Project Completion lists. Progress moves along a fixed eight-step
  ladder.
- **Cross-device sync** — changes land on your other open tabs and devices via
  Supabase Realtime.
- **Light and dark themes** — first visits follow your device preference;
  the toggle saves your choice for future visits.

## Tech stack

| Layer | Choice |
| --- | --- |
| Markup & styles | Static HTML, modern CSS (custom properties, `dvh`, `env(safe-area-inset-*)`) |
| Logic | Vanilla JavaScript, no dependencies |
| Auth | Supabase Auth — email and password, publishable key in the browser |
| Database | Supabase / PostgreSQL, single `public.dashboard_records` table |
| Security | Row Level Security — every account sees only its own records |
| Sync | Supabase Realtime, plus a `localStorage` cache for synchronous reads |
| Testing | Playwright (Node) for smoke, auth, per-feature, and mobile-layout suites |
| Hosting | GitHub Pages, served as static files |

Cloud records live in one table keyed by `(user_id, collection, record_id)` with
a `jsonb` payload, where `collection` is one of eight fixed keys: `tasks`,
`events`, `notes`, `goals`, `skills`, `projects`, `pomodoro_sessions`, and
`pomodoro_state`. A `localStorage` cache keeps page modules responsive while
writes persist to Supabase in the background.

## Running the checks

The Playwright suites live in `.claude/skills/run-personal-dashboard/`. Each
starts its own server and exits non-zero on failure. **Run them one at a time** —
they all bind port 3000, so two in parallel make the second fail with
`ERR_CONNECTION_REFUSED`.

```bash
cd .claude/skills/run-personal-dashboard

node smoke.mjs              # all pages load, navigation, core interactions
node auth-tests.mjs         # password sign-up, sign-in, confirmation settings
node theme-tests.mjs        # system appearance default and saved theme choice
node task-tests.mjs         # one behaviour suite per feature area
node goals-tests.mjs
node notes-tests.mjs
node progress-tests.mjs
node calendar-tests.mjs
node mobile-audit.mjs       # overflow, tap targets, iOS zoom, across 6 widths
node scan-encoding.mjs      # flags mojibake; run after any bulk edit
```

To poke around interactively, use `driver.mjs` (`launch`, `navigate`, `click`,
`eval`, `screenshot`, `quit`). Use the suites to prove nothing broke.

### Running it locally

Because the pages load each other with relative paths, opening `index.html` from
the filesystem will not work. Serve the repository root over HTTP instead:

```bash
cd .claude/skills/run-personal-dashboard
node server.mjs        # http://localhost:3000/
```

### Deploying

Push to `main` and GitHub Pages serves the repository root. The Supabase schema
— table, indexes, RLS policies, and Realtime publication — is in
`supabase/schema.sql`. The project URL and publishable key are in
`scripts/supabase-config.js`.

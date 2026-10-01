# Personal-Dashboard

An AI-assisted personal productivity dashboard that brings tasks, calendar events, notes, goals, progress, and study sessions into one organized space. It provides a daily overview of what is due, focused study time, and goal progress, along with a Pomodoro timer and quick notes.

## Live Site

https://kennethgaytano.github.io/Personal-Dashboard/

## Features

**Home** — greeting, Today's Tasks (up to 3, checkable in place with a live overdue badge), Quick Notes, an overview stat strip, and a Pomodoro timer.

- **Tasks** — full CRUD with due dates/times, three priorities, a description, and To Do / In Progress / Completed columns. Open tasks past their due moment show an overdue warning, and tasks can carry optional links.
- **Today's Tasks** — max 3 tasks including completed ones, toggleable in place; the overdue badge updates immediately.
- **Pomodoro** — start/pause/reset across Focus and Break modes with a custom 1–120 minute input. The `assets/audio/pomodoro-alarm.wav` completion sound repeats until **Stop alarm** is pressed; stopping a completed Focus alarm switches the timer to Break. A focus session is written to `dashboard_pomodoro_sessions` **only when a block actually completes** — pausing early does not log time.
- **Notes & Quick Notes** — full CRUD with a color picker, edit/delete, a shared store between the two pages, and toast notifications.
- **Calendar** — full CRUD for events in `dashboard_events`: dot markers on the grid, a selected-day panel, an Upcoming Events grouped list, an edit banner with cancel, focus management, accessible group roles, a responsive form, and HTML escaping.
- **Goals** — full CRUD in `dashboard_goals` with a milestone checklist. Toggling a milestone recalculates overall progress, and edit/delete run through a focus-trapped confirmation modal. Completing a goal works three ways — ticking every milestone, choosing **Completed** in the status dropdown, or setting progress to 100 with no milestones — and all of them are reflected in the status badge and in the Progress page's Completed filter. Un-completing a goal reverts it to Active, and a paused goal stays paused.
  - A read-only **Goals Progress** view on the Progress page lists every goal with All / Active / Paused / Completed filters and an average-progress summary. Status is re-derived from progress and milestones on read, so goals saved before this behaviour existed show under the right filter.
- **Progress** — derived weekly stats over a rolling 7-day window (tasks done, hours studied, pomodoros, day streak), computed from real task and focus-session data rather than hardcoded numbers, plus:
  - **Skills & Learning** and **Project Completion** (`dashboard_skills` / `dashboard_projects`) as add/delete lists, seeded with 5 skills and 3 projects.
  - Progress moves along a fixed 8-step ladder — `0, 25, 50, 60, 70, 80, 90, 100` — using ‹ › steppers with a "Step N of 8" readout. Values snap to the nearest rung at display time.

> **Note:** the delete-confirmation modal on the Progress page is present in the markup but not currently wired up — deleting a track takes effect immediately.

## Tech stack

Static HTML, CSS, and vanilla JavaScript, with Supabase Auth and PostgreSQL for
signed-in, per-user cloud data. The Supabase publishable key is used in the
browser; Row Level Security restricts each account to its own records. A local
`localStorage` cache keeps the existing synchronous page modules responsive,
while changes are saved to Supabase and realtime updates refresh other devices.

### Supabase setup

1. Create a Supabase project and enable Email auth.
2. Run `supabase/schema.sql` in the SQL Editor. Re-run it after pulling updates
   to safely add any new setup, including the Realtime publication entry.
3. Set the Supabase project's Site URL to the deployed site and add its
   `Personal-Dashboard/**` path to the allowed redirect URLs for email
   confirmation.
4. Set the project URL and public publishable key in
   `scripts/supabase-config.js`. Never put a secret or service-role key in the
   website.

The app waits for sign-in and a successful cloud read before showing the
dashboard. On the first successful sign-in for an account in a browser, its
legacy local dashboard records are cleared and replaced with the account's
cloud records; there is no import or merge. If cloud loading fails, local
records are not cleared.

When email confirmation is required, the sign-up screen offers a direct inbox
link for common email providers. Users can return to sign in from that screen;
an “Email not confirmed” sign-in response also returns to the inbox guidance.
After any successful sign-in, Dashly opens Home. Email confirmation links also
return to Home, including when sign-up began from another page.

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

## Forms are hidden until you ask

Opening a page shows the content, not a wall of input panels. All six add/edit forms start collapsed behind a button and open on click, on desktop and mobile alike.

- **One button per form.** Tasks has `+ Add Task`, Calendar `+ Add event`, Notes `+ New Note`, Goals `+ New Goal`, Progress `+ Add Track`, and the home page `+ Quick Note`. Each is a real `<button>` with `aria-expanded` and `aria-controls`, and each toggles — a second click puts the form away again.
- **Editing an existing item opens the form for you.** The pencil button on a task, event, note or goal reveals the same panel, already filled in, with the heading and submit button switched to their edit wording. Nothing extra to click.
- **Escape closes it**, as do Cancel and saving. Focus returns to the button that opened it, so keyboard and screen reader users are never dropped at the top of the document.
- **Every form has a working Cancel, and it is visible whenever the form is.** The home composer gained one (`#cancelQuickNoteBtn`); the other five already had one but used to hide it until you started *editing*, which was correct while the forms sat permanently on the page and wrong once they became disclosures — opening a form to add something left no way to back out short of Escape. Cancel now shows whenever the form is on screen, and collapsing the panel is what takes it away. On a phone the actions stack full-width, so Cancel sits under the submit button rather than beside it.
- **The panels use the `hidden` attribute**, not a CSS rule, so a collapsed form is genuinely out of the tab order and out of the accessibility tree rather than merely looking invisible.
- **The shared behaviour lives in `form-disclosure.js`.** Each page supplies only the trigger and the panel, so all six behave identically and a fix lands everywhere at once.
- **The calendar deliberately does not open the form when you pick a day.** Selecting a day updates the event list; the form stays collapsed until you ask to add something, because opening a calendar should not summon an input panel.

`form-disclosure-tests.mjs` covers the contract on all six pages: collapsed on load, `aria-expanded` tracks state, a collapsed form is not focusable, the trigger toggles, Escape closes without closing something unopened, Edit opens the form, and saving and cancelling both collapse it.

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
- `scripts/` — feature modules plus shared `nav.js`, `link-utils.js`, and `form-disclosure.js`; `cloud.js` and `supabase-config.js` handle authenticated persistence.
- `styles/` — split stylesheets: `base.css` (design tokens, reset, reduced-motion), `layout.css` (sidebar, app bar, tab bar, page scaffolding, and the page-load reveal), `components.css` (buttons, forms, modal, toast), plus one file per page.
- `assets/brand/` — Dashly logo assets used by the page chrome and favicon.
- `supabase/` — database schema and access policies.
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
node form-disclosure-tests.mjs # collapsed-form contract on all six pages
```

`mobile-audit.mjs` reports horizontal overflow, interactive targets under 44px, and form controls under 16px (which make iOS zoom the viewport on focus). It seeds `localStorage` first, so unlike `mobile-shots.mjs` it exercises the content views rather than only empty states.

`layout-chain.mjs` exists because horizontal overflow is hard to attribute by eye. It hides one element at a time and watches `window.innerWidth`, which names the origin directly.

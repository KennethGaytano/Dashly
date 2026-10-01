---
name: run-personal-dashboard
description: Run, screenshot, and interact with the Personal Dashboard web app
tags: [run, start, launch, screenshot, dashboard, web]
---

# Run Personal Dashboard

Launch and interact with the Personal Dashboard - a static HTML/CSS web app for managing tasks, calendar, notes, progress tracking, and goals.

The app is driven by Playwright via Node.js scripts in this skill directory. The smoke test covers all pages and interactive elements.

**All paths in this document are relative to the project root** (`Personal_DashBoard/`).

---

## Prerequisites

- **Node.js** v18+ (tested with v24.21.0)
- **npm** v9+ (tested with v11.19.0)
- **Playwright** with Chromium (installed in skill directory)

Already installed in `.claude/skills/run-personal-dashboard/node_modules/`.

---

## Build

No build step required - this is a static HTML/CSS app.

---

## Run (Agent Path - Primary)

### Quick Smoke Test

Run the complete smoke test that navigates all pages, tests interactive elements, and captures screenshots:

```bash
cd .claude/skills/run-personal-dashboard
node smoke.mjs
```

**Output:** Screenshots saved to `$CLAUDE_JOB_DIR/tmp/` (or `./screenshots/` if `CLAUDE_JOB_DIR` not set):
- `home.png` - Dashboard home page with overview stats
- `tasks.png` - Task management page
- `calendar.png` - Calendar view
- `notes.png` - Notes page
- `progress.png` - Progress tracking page
- `goals.png` - Goals page
- `tasks-interacted.png` - Tasks page after adding a new task
- `home-timer.png` - Home page with Pomodoro timer started

**What it tests:**
- HTTP server starts successfully
- All 6 pages load with correct titles
- Navigation works across all pages
- Checkboxes can be toggled
- New tasks can be added with text and priority
- Pomodoro timer button responds to clicks

### Interactive Driver

For manual control, use the driver script:

```bash
cd .claude/skills/run-personal-dashboard

# Start server and open browser
node driver.mjs launch

# Navigate to different pages
node driver.mjs navigate tasks
node driver.mjs navigate calendar
node driver.mjs navigate notes

# Take screenshots
node driver.mjs screenshot /path/to/output.png

# Click elements
node driver.mjs click "text=Tasks"
node driver.mjs click ".btn-primary"

# Type into inputs
node driver.mjs type "input[type='text']" "My new task"

# Evaluate JavaScript
node driver.mjs eval "document.querySelectorAll('.task-item').length"

# Clean up
node driver.mjs quit
```

**Driver Commands:**
- `launch` - Start HTTP server on port 3000, launch headless Chromium
- `screenshot <path>` - Take full-page screenshot
- `navigate <page>` - Go to page (home, tasks, calendar, notes, progress, goals)
- `click <selector>` - Click element by CSS selector or text
- `type <selector> <text>` - Fill input field
- `eval <code>` - Run JavaScript in page context
- `quit` - Close browser and stop server

---

## Run (Human Path - Secondary)

### Manual Testing with a Live Browser

Start a local HTTP server:

```bash
# Using Node.js built-in http-server from skill directory
cd .claude/skills/run-personal-dashboard
node server.mjs
```

Server runs at `http://localhost:3000/`.

Open in your browser to interact manually. Press Ctrl-C to stop.

**Note:** This path is for human visual testing only. Agents should use the smoke test or driver script above.

---

## Direct Server Script

The HTTP server is a simple Node.js ES module that serves static files from the project root:

```bash
cd .claude/skills/run-personal-dashboard
node server.mjs
# Server running at http://localhost:3000/
```

Set `PORT` environment variable to change port:

```bash
PORT=8080 node server.mjs
```

---

## Project Structure

```
Personal_DashBoard/
├── index.html           # Home page and GitHub Pages entry point
├── pages/               # Dashboard feature pages
│   ├── tasks.html       # Task management
│   ├── calendar.html    # Calendar view
│   ├── notes.html       # Notes page
│   ├── progress.html    # Progress tracking
│   └── goals.html       # Goals page
├── assets/
│   └── brand/           # Dashly logo and favicon
├── scripts/             # Browser JavaScript
│   ├── home.js          # Home page task summary
│   └── nav.js            # Mobile drawer, tab bar, focus management
├── styles/
│   ├── base.css         # Reset, design tokens, a11y utilities
│   ├── layout.css       # Sidebar, app bar, tab bar, page scaffolding
│   ├── components.css   # Buttons, forms, modal, toast, stat cards
│   ├── home.css         # Pomodoro timer
│   ├── tasks.css        # Task list and task form
│   ├── calendar.css     # Month grid and day cells
│   ├── notes.css        # Note cards and composer
│   ├── progress.css     # Progress bars
│   └── goals.css        # Goal cards, badges, milestones
├── supabase/            # Database schema and access policies
└── .claude/skills/run-personal-dashboard/
    ├── SKILL.md            # This file
    ├── server.mjs          # HTTP server for serving static files
    ├── driver.mjs          # Interactive Playwright driver
    ├── smoke.mjs           # Cross-page smoke test
    ├── auth-tests.mjs      # Sign-up email confirmation and inbox link tests
    ├── task-tests.mjs      # Task management test suite
    ├── goals-tests.mjs     # Goals test suite
    ├── notes-tests.mjs     # Notes search, read view, edit, and empty-state tests
    ├── calendar-tests.mjs  # Calendar test suite (grid, CRUD, delete dialog)
    ├── form-disclosure-tests.mjs # Collapsed-form contract across all 6 pages
    ├── disclosure-shots.mjs # Screenshots: closed vs open, phone + desktop
    ├── progress-tests.mjs  # Progress page test suite
    ├── mobile-audit.mjs    # Mobile geometry sweep, 6 widths x 6 pages
    ├── mobile-nav-tests.mjs# App bar / tab bar / drawer behaviour
    ├── layout-chain.mjs    # Names the element forcing a horizontal scroll
    ├── width-sweep.mjs     # 16 widths x 6 pages, seeded with hostile content
    ├── scan-encoding.mjs   # Flags mojibake / lost emoji in product files
    ├── mobile-shots.mjs    # Quick mobile screenshots (no seeded data)
    ├── package.json        # Node dependencies
    └── node_modules/       # Playwright installed here
        └── playwright/
```

---

## Gotchas

### 1. Static App = No Backend Persistence

This is a **static HTML/CSS** app with no JavaScript state management or backend. All interactions (checking tasks, adding items, starting timers) are **visual only** and not persisted. Refreshing the page resets everything.

**Why this matters:** When testing changes, you're verifying UI appearance and interaction responsiveness, not data persistence. If a PR adds data storage (localStorage, backend API), you'll need to extend the smoke test to verify that.

### 2. Windows Path Handling

The project is on Windows (`C:\Users\kenne\OneDrive\...`). The server script uses `path.join()` and handles forward slashes in URLs correctly, but if you add file operations, remember:
- URLs always use forward slashes (`/pages/tasks.html`)
- Node.js `path` module handles OS differences automatically
- Don't hardcode `\` or `/` in path operations

### 3. Playwright on Windows

Chromium installs to `C:\Users\kenne\AppData\Local\ms-playwright\`. First run of Playwright may take time to download browser binaries. Already installed and tested working.

### 4. Port 3000 Conflicts

The server defaults to port 3000. If something else is using it:
- The driver/smoke scripts will fail silently or time out
- Set `PORT` env var: `PORT=3001 node server.mjs`
- Or kill the conflicting process: `netstat -ano | findstr :3000` then `taskkill /PID <pid> /F`

### 5. Local Storage and Test Data

The app uses JavaScript and `localStorage` for tasks, events, notes, goals,
progress tracks, and Pomodoro sessions. Browser tests should clear or set only
the keys they need, then restore any existing values they changed. Progress and
Goals intentionally do not generate example records for empty storage.

### 6. Screenshot Timing

The smoke test uses `fullPage: true` for screenshots, which captures everything including below-the-fold content. For very long pages, this can take 1-2 seconds. No issues observed with current page lengths.

---

## Troubleshooting

### Error: "Server not responding" or "Connection refused"

**Symptom:** Smoke test fails immediately, or driver can't connect.

**Cause:** Server didn't start, or port 3000 is already in use.

**Fix:**
```bash
# Check if port 3000 is in use
netstat -ano | findstr :3000

# If occupied, kill the process
taskkill /PID <pid> /F

# Or use a different port
PORT=3001 node server.mjs
```

### Error: "Cannot find module 'playwright'"

**Symptom:** `node driver.mjs` or `node smoke.mjs` fails with module not found.

**Cause:** Playwright not installed in skill directory.

**Fix:**
```bash
cd .claude/skills/run-personal-dashboard
npm install playwright
npx playwright install chromium
```

### Screenshots are blank or show error page

**Symptom:** PNG files generated but contain white screen or 404 error.

**Cause:** Server not running, or wrong base URL.

**Fix:**
- Verify server is running: `curl http://localhost:3000/`
- Check server logs for errors
- Ensure `driver.mjs` has correct `PORT` constant (default 3000)
- If using custom port, update both server and driver scripts

### Smoke test hangs or times out

**Symptom:** Script runs but never completes, no screenshots generated.

**Cause:** Playwright waiting for page element that doesn't exist, or network timeout.

**Fix:**
- Check page HTML structure hasn't changed (driver assumes specific selectors)
- Increase timeout in smoke script if network is slow
- Run `node driver.mjs launch` then `node driver.mjs screenshot test.png` manually to isolate issue

---

## Extending the Skill

### Adding New Pages

If you add a new HTML page (e.g., `settings.html`):

1. Add to navigation in all existing HTML files
2. Update `smoke.mjs` `pages` array:
   ```javascript
   { name: 'Settings', url: '/settings.html', file: 'settings.png' }
   ```
3. Run smoke test to verify

### Testing JavaScript Interactions

When JavaScript is added for real interactivity:

1. Update `smoke.mjs` to test actual behavior:
   ```javascript
   // Example: Test Pomodoro timer actually counts down
   await page.click('.pomodoro button.btn-primary');
   await page.waitForTimeout(1000);
   const timerText = await page.textContent('.timer-display');
   console.log('Timer after 1s:', timerText); // Should be "24:59" not "25:00"
   ```

2. Add assertions to verify state changes:
   ```javascript
   const tasksBefore = await page.locator('.task-item').count();
   await page.click('.task-add button');
   const tasksAfter = await page.locator('.task-item').count();
   if (tasksAfter !== tasksBefore + 1) {
     throw new Error('Task was not added');
   }
   ```

### Testing localStorage Persistence

If the app starts using localStorage:

```javascript
// Set some state
await page.click('.task-item input[type="checkbox"]');

// Reload page
await page.reload();

// Verify state persisted
const isChecked = await page.isChecked('.task-item input[type="checkbox"]');
console.log('Checkbox persisted:', isChecked);
```

---

## Notes for Future Agents

- **The app is fully functional.** It is a static site with no backend, but it has ten JavaScript modules driving real CRUD against `localStorage` — tasks, calendar events, notes, goals, progress tracks, and a Pomodoro timer. Any note here claiming there is "no JavaScript yet" is out of date.
- **Progress and Goals do not seed sample records.** Empty storage stays empty; their first-run states should not be treated as populated example data.
- **Screenshots are the ground truth:** When verifying a UI change, compare before/after screenshots. The PNG files in `$CLAUDE_JOB_DIR/tmp/` are your test output.
- **`mobile-audit.mjs` seeds data; `mobile-shots.mjs` does not.** The older screenshot script launches with empty `localStorage`, so every content view renders its empty state. Use the audit script for anything that depends on real content — it caught layout bugs the empty captures could never show.
- **A full-page screenshot cannot show a `position: fixed` element honestly.** Playwright renders beyond the viewport without resizing, so the tab bar lands mid-image and looks like an overlap bug. `mobile-audit.mjs` handles this by hiding the bar for full-page shots and taking a separate viewport-only shot (`audit-<width>-chrome.png`) of the real chrome.
- **The calendar has two scripts on one grid, so it had two selection handlers.** `calendar.js` and `calendar-events.js` each attached a click listener to `#calendarGrid` and each set the `selected` class plus its own ARIA state (`aria-pressed` vs `aria-selected`). Because both cleared `.selected` before the other could find the previously selected cell, `aria-selected` accumulated: after clicking three days the grid claimed three days were selected. `calendar-events.js` owns selection, since it also has to update the form, the day list and the dots; `calendar.js` now only renders and handles Prev/Next. `calendar-tests.mjs` asserts the state is expressed exactly once.
- **Every form has a working Cancel, visible whenever the form is open.** The home Quick Note composer was the only one with no Cancel at all (`#cancelQuickNoteBtn`, new). The other five had one but hid it until an *edit* began, which was right when the forms were permanently visible and wrong once they became disclosures: opening a form to add something left no way to back out short of Escape. Cancel is now always visible while the form is on screen, and collapsing the panel is what takes it out of view. The `display:none` / `hidden` juggling in `startEdit*` and `cancelEdit` is gone from all five.
- **Every add/edit form is a disclosure.** All six forms (task, event, note, goal, track, home quick note) start collapsed behind a button and open on click, on desktop and mobile. `scripts/form-disclosure.js` owns the behaviour; each page only supplies the trigger and the panel. The panel is hidden with the `hidden` attribute, not a CSS rule, so it leaves the tab order properly. Three things follow from that and are easy to get wrong:
  - **Editing an existing item has to call `open()`.** `startEditTask`, `startEditEvent`, `startEditNote` and `startEditGoal` each reveal the form, or a user clicks Edit and sees nothing.
  - **Saving has to call `close()` on the add path too.** `cancelEdit()` already ran on the edit path, so only guarding the add path with `if (!editingTaskId)` is correct. Goals, Notes, Tasks and Calendar each forgot this once.
  - **`restoreFocus` matters on Cancel.** Without it the Cancel button hides while holding focus, stranding the keyboard user.
- **Behaviours in a shared controller need one owner.** When two scripts both handled clicks on `#calendarGrid`, they competed over the same ARIA state and `aria-selected` accumulated on every previously selected day. `calendar-events.js` now owns selection outright.
- **`localStorage` is not a database, so verify what you parse.** `getTasks()` returned whatever `JSON.parse` produced. An object instead of an array made `renderTasks` call `.filter` on a non-array, and a `null` entry made the status grouping read `.status` of null; both threw an uncaught `TypeError` and left the page with no task list at all. It now checks `Array.isArray` and drops entries that are not objects with an id. Separately, a task with an unrecognised `status` matched none of the three `renderTasks` filters and vanished, which reads as data loss; unknown statuses now fall into To Do while the three known ones keep their own lists. `task-tests.mjs` covers five malformed shapes plus the unknown status.
- **A PowerShell write-back silently destroyed an emoji.** `pages/tasks.html` reached `main` with the Tasks tab icon as a literal `?` instead of `✅` — no test noticed, because the icon is `aria-hidden` and no assertion looked at it. Write files that contain non-ASCII from Node, and run `scan-encoding.mjs` (scans every product file for replacement chars, mojibake, and a bare `?` where an emoji belongs) after any bulk edit.
- **A failed assertion is not always a bug in the app.** Four of the seven failures the calendar suite produced on its first run were wrong expectations in the test: today legitimately still appears in an adjacent month's grid as a leading or trailing day; `#eventTitle` carries `required`, so the browser blocks the submit before `handleSubmit` can raise a toast; and a payload title is inserted with `textContent`, so `document.content()` contains the escaped `&lt;img …&gt;` and a naive substring search for `onerror=alert` matches the harmless escaped text. Probe the DOM for created elements instead of grepping the serialised HTML.
- **The driver is for poking; the test scripts are for regression.** Use `driver.mjs` to explore, and the `*-tests.mjs` scripts to prove nothing broke.
- **Port conflicts are common:** If tests fail mysteriously, check port 3000 first.
- **When a page overflows horizontally, do not guess at the cause.** `layout-chain.mjs` brute-forces the DOM: it hides one element at a time and watches `window.innerWidth`, which names the origin. Two real bugs here (a flex `<input>` without `min-width: 0`, and `body` being `display: flex` in a row with a fixed sidebar) were both invisible to static reading and to measuring only the element you suspected.
- **Never generate repeated markup with a PowerShell script.** The tab bars were built by interpolating a `$moreAct` variable into an HTML string, and the `class=" tab-more"` it emitted lost its leading space and had never included `tab` in the first place. The result was `class="tab-more"` on five pages while the hand-written home page had `class="tab tab-more"` — so the More button silently lost `.tab`'s flex sizing, column layout and `is-active` styling, and its label ran off the right edge on every page except the one that was typed by hand. A test that only counted `.tab` elements *on the home page* passed for days. Write shared markup into a file, or generate it from a template, and assert on every page.
- **Seed hostile content, not just plausible content.** Every element that renders user text needs `overflow-wrap: anywhere`, because people paste URLs into titles and a single unbroken token has no break opportunity. `mobile-audit.mjs`'s realistic seed data hid this completely — `width-sweep.mjs` seeds one long no-space URL and exposed every page overflowing at every width, with `main` rendering 683px wide on a 320px screen.

---

## Summary

- **Smoke test:** `cd .claude/skills/run-personal-dashboard && node smoke.mjs`
- **Auth confirmation:** `node auth-tests.mjs`
- **Behaviour suites:** `node task-tests.mjs`, `node goals-tests.mjs`, `node notes-tests.mjs`, `node progress-tests.mjs`, `node calendar-tests.mjs` — run one at a time, they all bind port 3000
- **Collapsed forms:** `node form-disclosure-tests.mjs` — the open/close contract across all six pages
- **Disclosure screenshots:** `node disclosure-shots.mjs` — closed vs open form at 390px and 1280px
- **Mobile regression:** `node mobile-audit.mjs` (geometry across 6 widths), `node mobile-nav-tests.mjs` (app bar / tab bar / drawer behaviour), `node width-sweep.mjs` (16 widths, hostile content — run `SHOT=1 node width-sweep.mjs` for PNGs)
- **Overflow diagnosis:** `node layout-chain.mjs [width]` — names the element forcing a horizontal scroll
- **Screenshots:** `$CLAUDE_JOB_DIR/tmp/*.png`
- **Interactive driver:** `node driver.mjs <command>`
- **Manual testing:** `node server.mjs` then open `http://localhost:3000/`
- **No build required:** Static HTML/CSS app
- **Gotchas:** port 3000 conflicts, Windows paths, per-device `localStorage`, empty-state captures from `mobile-shots.mjs`

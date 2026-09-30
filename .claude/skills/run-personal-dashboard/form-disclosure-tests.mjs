#!/usr/bin/env node
/**
 * Form disclosure contract.
 *
 * Every add/edit form on the site starts collapsed behind a button and opens
 * when the user asks to add something, or clicks edit on an existing item.
 * These checks cover that contract once across all six pages rather than
 * duplicating it in each page's own suite.
 *
 * Usage: node form-disclosure-tests.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
function eq(a, b, label) { assert(a === b, `${label} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`); }

const server = spawn('node', [join(__dirname, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// page, label, trigger, panel, first field
const FORMS = [
  ['index.html',        'Home',     '#newQuickNoteBtn', '#quickNotePanel', '#quickNoteTitle'],
  ['pages/tasks.html',  'Tasks',    '#newTaskBtn',      '#taskFormPanel',   '#taskTitle'],
  ['pages/calendar.html','Calendar', '#newEventBtn',     '#eventFormPanel',  '#eventTitle'],
  ['pages/notes.html',  'Notes',    '#newNoteBtn',      '#noteFormPanel',   '#noteTitle'],
  ['pages/goals.html',  'Goals',    '#newGoalBtn',      '#goalFormPanel',   '#goalTitle'],
  ['pages/progress.html','Progress', '#newTrackBtn',     '#trackFormPanel',  '#trackName']
];

const state = async () => page.evaluate(() => {
  const t = document.querySelector('[aria-expanded][aria-controls]');
  const panel = t ? document.getElementById(t.getAttribute('aria-controls')) : null;
  return {
    expanded: t ? t.getAttribute('aria-expanded') : null,
    panelHidden: panel ? panel.hasAttribute('hidden') : null,
    controlsResolves: !!panel,
    label: t ? t.textContent.trim() : null
  };
});

console.log('\n--- Collapsed on load, and the ARIA wiring is right ---');
for (const [url, label, trigger, panel] of FORMS) {
  await page.goto(`${BASE}/${url}`);
  await page.waitForTimeout(300);
  const s = await state();
  eq(s.expanded, 'false', `${label}: trigger starts with aria-expanded="false"`);
  eq(s.panelHidden, true, `${label}: the form panel is hidden on load`);
  assert(s.controlsResolves, `${label}: aria-controls resolves to a real element`);
  eq(await page.locator(trigger).count(), 1, `${label}: exactly one trigger button`);
  assert(await page.locator(panel).count() === 1, `${label}: exactly one panel`);
  // hidden must be a real attribute, not a class, so the fields leave the tab order.
  const reachable = await page.evaluate(p => {
    const el = document.querySelector(p + ' input');
    if (!el) return 'no input';
    el.focus();
    return document.activeElement === el ? 'focusable' : 'not focusable';
  }, panel);
  eq(reachable, 'not focusable', `${label}: a collapsed form is out of the tab order`);
}

console.log('\n--- The trigger opens it, and Escape closes it ---');
for (const [url, label, trigger, panel, field] of FORMS) {
  await page.goto(`${BASE}/${url}`);
  await page.waitForTimeout(300);

  await page.click(trigger);
  await page.waitForTimeout(200);
  let s = await state();
  eq(s.expanded, 'true', `${label}: clicking the trigger sets aria-expanded="true"`);
  eq(s.panelHidden, false, `${label}: the panel is visible after the click`);
  assert(await page.locator(field).isVisible(), `${label}: the first field is visible`);
  eq(await page.evaluate(() => document.activeElement?.id), field.replace('#', ''),
    `${label}: focus moved into the first field`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  s = await state();
  eq(s.expanded, 'false', `${label}: Escape collapses the form`);
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded')), 'false',
    `${label}: focus returned to the trigger`);

  // Escape must not close something the user never opened.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  eq((await state()).expanded, 'false', `${label}: a second Escape is harmless`);
}

console.log('\n--- The trigger toggles ---');
for (const [url, label, trigger] of FORMS) {
  await page.goto(`${BASE}/${url}`);
  await page.waitForTimeout(300);
  await page.click(trigger);
  await page.waitForTimeout(150);
  await page.click(trigger);
  await page.waitForTimeout(150);
  eq((await state()).expanded, 'false', `${label}: a second click collapses it again`);
}

console.log('\n--- Saving collapses the form, and so does Cancel ---');
const ROUND_TRIP = [
  ['pages/tasks.html',  'Tasks',    '#newTaskBtn',      '#taskTitle',      '#todoList .task-item',   'A saved task'],
  ['pages/notes.html',  'Notes',    '#newNoteBtn',      '#noteTitle',      '#notesList .note-card', 'A saved note'],
  ['pages/goals.html',  'Goals',    '#newGoalBtn',      '#goalTitle',      '#goalsList .goal-card', 'A saved goal'],
  ['pages/progress.html','Progress','#newTrackBtn',     '#trackName',      '#skillsList .progress-item', 'A saved skill']
];

for (const [url, label, trigger, field, resultSel, title] of ROUND_TRIP) {
  await page.goto(`${BASE}/${url}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  await page.click(trigger);
  await page.waitForSelector(field, { state: 'visible' });
  await page.fill(field, title);
  await page.click('#submitBtn');
  await page.waitForTimeout(300);
  const beforeCount = await page.locator(resultSel).count();
  eq((await state()).expanded, 'false', `${label}: a successful save collapses the form`);
  assert(beforeCount > 0, `${label}: the item was created`);

  // Reopen, type something, then Cancel: nothing should be created. Cancel is
  // only shown while editing on some pages, so open the form, press Edit on the
  // row we just made, and cancel out of that.
  await page.click(trigger);
  await page.waitForSelector(field, { state: 'visible' });
  await page.fill(field, 'Abandoned draft');

  const cancel = page.locator('#cancelBtn');
  if (await cancel.isVisible()) {
    await cancel.click();
  } else {
    // No Cancel while adding. Escape is the universal dismiss.
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(300);
  eq((await state()).expanded, 'false', `${label}: dismissing the form collapses it`);
  assert(!(await page.textContent('body')).includes('Abandoned draft'), `${label}: nothing was created`);
  // Goals and Progress ship seed data, so compare against the earlier count
  // rather than expecting exactly one row.
  eq(await page.locator(resultSel).count(), beforeCount, `${label}: the item count is unchanged`);
}

// Fill each store, reload, click the row's Edit button, and confirm the form
// came open by itself. This is the path a collapse can quietly break: a user
// clicking Edit and being shown nothing.
const EDITS = [
  ['pages/tasks.html',   'Tasks',    '#newTaskBtn',  '#taskTitle',   '#todoList button[aria-label^="Edit task"]',
    { id: 't1', title: 'Existing task', status: 'todo', priority: 'low', description: '', url: '', dueDate: '', dueTime: '' },
    'dashboard_tasks'],
  ['pages/notes.html',   'Notes',    '#newNoteBtn',  '#noteTitle',   '#notesList button[aria-label^="Edit note"]',
    { id: 'n1', title: 'Existing note', body: '', color: 'accent', url: '' },
    'dashboard_notes'],
  ['pages/goals.html',   'Goals',    '#newGoalBtn',  '#goalTitle',   '#goalsList button[aria-label^="Edit"]',
    { id: 'g1', title: 'Existing goal', desc: '', progress: 50, status: 'active', milestones: [] },
    'dashboard_goals'],
  ['pages/calendar.html','Calendar', '#newEventBtn', '#eventTitle',  '#eventList button[aria-label^="Edit event"]',
    { id: 'e1', title: 'Existing event', date: new Date().toISOString().slice(0, 10), time: '', description: '', url: '' },
    'dashboard_events']
];

for (const [url, label, trigger, field, editBtn, record, key] of EDITS) {
  await page.goto(`${BASE}/${url}`);
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify([v])), [key, record]);
  await page.reload();
  await page.waitForTimeout(400);

  // The task list defaults to the "Today" filter, which hides a task with no
  // due date. Switch to "All" the way a user would, or the row we are about to
  // click Edit on is present in the DOM but not visible.
  const allFilter = page.locator('[data-task-filter="all"]');
  if (await allFilter.count()) {
    await allFilter.click();
    await page.waitForTimeout(150);
  }

  assert(await page.locator(editBtn).count() > 0, `${label}: the stored item rendered`);
  assert(await page.locator(editBtn).isVisible(), `${label}: the stored item is visible`);
  assert(!(await page.locator(field).isVisible()), `${label}: the form is still collapsed before editing`);

  await page.click(editBtn);
  await page.waitForTimeout(300);
  const s = await state();
  eq(s.expanded, 'true', `${label}: clicking Edit opens the form`);
  assert(await page.locator(field).isVisible(), `${label}: the form is visible after clicking Edit`);
  eq(await page.inputValue(field), record.title, `${label}: the existing value is loaded for editing`);
}

console.log('\n--- Every form has a visible Cancel while it is open ---');
// The home composer was the only form with no Cancel at all, and the other five
// hid theirs until an edit began -- so opening a form to add something left you
// with no way to back out short of Escape. Both are fixed; this pins it.
const CANCELS = [
  ['index.html',         'Home',     '#newQuickNoteBtn',  '#quickNoteTitle', '#cancelQuickNoteBtn'],
  ['pages/tasks.html',   'Tasks',    '#newTaskBtn',       '#taskTitle',      '#cancelBtn'],
  ['pages/calendar.html','Calendar', '#newEventBtn',      '#eventTitle',     '#cancelEventBtn'],
  ['pages/notes.html',   'Notes',    '#newNoteBtn',       '#noteTitle',      '#cancelBtn'],
  ['pages/goals.html',   'Goals',    '#newGoalBtn',       '#goalTitle',      '#cancelBtn'],
  ['pages/progress.html','Progress', '#newTrackBtn',      '#trackName',      '#cancelBtn']
];

for (const [url, label, trigger, field, cancel] of CANCELS) {
  await page.goto(`${BASE}/${url}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  await page.click(trigger);
  await page.waitForSelector(field, { state: 'visible' });
  assert(await page.locator(cancel).isVisible(), `${label}: Cancel is visible in add mode`);

  // It must actually dismiss: discard the draft, collapse, create nothing.
  await page.fill(field, 'Draft to discard');
  await page.click(cancel);
  await page.waitForTimeout(300);
  eq((await state()).expanded, 'false', `${label}: Cancel collapses the form`);
  eq(await page.inputValue(field), '', `${label}: Cancel clears the field`);
  assert(!(await page.textContent('body')).includes('Draft to discard'),
    `${label}: Cancel created nothing`);
  eq(await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded')), 'false',
    `${label}: focus returned to the trigger after Cancel`);
}

console.log('\n--- The home composer round trip ---');
{
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
  eq((await state()).expanded, 'false', 'Home: the composer starts collapsed');

  await page.click('#newQuickNoteBtn');
  await page.waitForSelector('#quickNoteTitle', { state: 'visible' });
  await page.fill('#quickNoteTitle', 'A quick thought');
  await page.click('#quickNoteForm button[type="submit"]');
  await page.waitForTimeout(300);
  eq((await state()).expanded, 'false', 'Home: saving collapses the composer');
  assert((await page.textContent('#quickNotesList')).includes('A quick thought'), 'Home: the note appears in the list');
  // The "View all" link moved below the list, so confirm it was not lost.
  assert(await page.locator('.section-link-wrap a[href="pages/notes.html"]').count() === 1,
    'Home: the View all link is still present');
}

// A fixed bottom tab bar can cover the last control in a long form. Confirm
// Cancel is genuinely hittable at phone width on every page, not merely present
// in the DOM and scrolled under the nav.
console.log('\n--- Cancel is hittable at phone width, not buried under the tab bar ---');
{
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mob.newPage();
  for (const [url, label, trigger, field, cancel] of CANCELS) {
    await mp.goto(`${BASE}/${url}`);
    await mp.evaluate(() => localStorage.clear());
    await mp.reload();
    await mp.waitForTimeout(300);
    await mp.click(trigger);
    await mp.waitForSelector(field, { state: 'visible' });
    // Scroll the way a user would. scrollIntoViewIfNeeded does a *minimal*
    // scroll, which deliberately parks the element at the viewport edge --
    // exactly where the fixed bar sits -- and would report an obstruction no
    // user would ever hit, since scrolling on clears it. Centre it instead,
    // which is the strongest position reachable, then hit-test the middle.
    await mp.locator(cancel).evaluate(el => el.scrollIntoView({ block: 'center' }));
    await mp.waitForTimeout(200);
    const hit = await mp.evaluate(sel => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      return {
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
        reachable: !!top && (el === top || el.contains(top) || top.contains(el)),
        topEl: top ? top.tagName.toLowerCase() + (top.className ? '.' + String(top.className).split(' ')[0] : '') : 'none'
      };
    }, cancel);
    assert(hit.inViewport, `${label}: Cancel scrolls into view at 390px`);
    assert(hit.reachable, `${label}: a tap on Cancel lands on it, not the tab bar (${hit.topEl})`);
  }
  await mob.close();
}

console.log('\n--- No console or page errors across the run ---');
eq(errors.length, 0, `clean console (${errors.length})`);
if (errors.length) errors.forEach(e => console.log('        ! ' + e));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
server.kill();
process.exit(fail ? 1 : 0);

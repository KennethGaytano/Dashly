#!/usr/bin/env node
/**
 * Calendar behaviour checks.
 *
 * The calendar is the only page with two scripts touching the same grid, so
 * these drive it the way a user does: month navigation, day selection, and a
 * full create/edit/delete round trip through the confirm dialog.
 *
 * Usage: node calendar-tests.mjs
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
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Reset to an empty store so each block starts from a known state.
async function reset() {
  await page.goto(`${BASE}/pages/calendar.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
}
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard_events') || '[]'));

// Add an event straight to storage, offset in days from today.
function seed(offset, title, time = '') {
  return page.evaluate(([o, t, tm]) => {
    const d = new Date(); d.setDate(d.getDate() + o);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const list = JSON.parse(localStorage.getItem('dashboard_events') || '[]');
    list.push({ id: 's' + o + (tm || ''), title: t, date: key, time: tm, description: '', url: '' });
    localStorage.setItem('dashboard_events', JSON.stringify(list));
  }, [offset, title, time]);
}

const gridState = () => page.evaluate(() => {
  const grid = document.getElementById('calendarGrid');
  const days = [...grid.querySelectorAll('button.calendar-day')];
  return {
    month: document.getElementById('monthLabel').textContent.trim(),
    dayCount: days.length,
    labelCount: grid.querySelectorAll('.calendar-day-label').length,
    columnHeaders: grid.querySelectorAll('[role="columnheader"]').length,
    today: days.filter(d => d.classList.contains('today')).length,
    selected: days.filter(d => d.classList.contains('selected')).map(d => d.dataset.date),
    // The two selection states a screen reader could be given.
    pressed: days.filter(d => d.getAttribute('aria-pressed') === 'true').map(d => d.dataset.date),
    selectedAttr: days.filter(d => d.getAttribute('aria-selected') === 'true').map(d => d.dataset.date),
    withEvents: days.filter(d => d.classList.contains('has-event')).map(d => d.dataset.date),
    gridRole: grid.getAttribute('role'),
    dayRole: days[0]?.getAttribute('role')
  };
});
const dayDates = n => page.evaluate(k =>
  [...document.querySelectorAll('#calendarGrid button.calendar-day')].slice(0, k).map(b => b.dataset.date), n);

// The add form is collapsed on load. Open it the way a user does.
async function openEventForm() {
  if (await page.locator('#eventTitle').isVisible()) return;
  await page.click('#newEventBtn');
  await page.waitForSelector('#eventTitle', { state: 'visible' });
}


console.log('\n--- Day selection uses one ARIA state, not two ---');
await reset();
{
  const dates = await dayDates(5);
  await page.click(`#calendarGrid button[data-date="${dates[2]}"]`);
  await page.waitForTimeout(150);
  let g = await gridState();
  eq(g.selected.length, 1, 'clicking a day selects exactly one day');
  eq(g.selected[0], dates[2], 'the clicked day is the selected one');

  // calendar.js's selectDate sets aria-pressed; calendar-events.js's grid
  // handler sets aria-selected. Both listeners fire on the same click.
  console.log('        pressed:', JSON.stringify(g.pressed), ' aria-selected:', JSON.stringify(g.selectedAttr));
  assert(g.pressed.length === 0 && g.selectedAttr.length === 1,
    'selection is expressed once, via aria-selected only');

  await page.click(`#calendarGrid button[data-date="${dates[4]}"]`);
  await page.waitForTimeout(150);
  g = await gridState();
  eq(g.selectedAttr.length, 1, 'moving the selection leaves no stale aria-selected behind');
  eq(g.selectedAttr[0], dates[4], 'aria-selected follows the new day');
  eq(await page.inputValue('#eventDate'), dates[4], 'the form date follows the selected day');
  const selectedLabel = await page.locator(`#calendarGrid button[data-date="${dates[4]}"]`).getAttribute('aria-label');
  assert(selectedLabel.startsWith(await page.locator('#selectedDateLabel').textContent()),
    'full selected date heading matches the calendar day');
}

console.log('\n--- Month navigation ---');
await reset();
{
  const start = (await gridState()).month;
  await page.click('#nextMonth');
  await page.waitForTimeout(200);
  const after = await gridState();
  assert(after.month !== start, `Next advances the month (${start} -> ${after.month})`);
  eq(after.dayCount, 42, 'the grid is still 6x7 after navigating');
  // Today can legitimately still be on screen in an adjacent month, as a
  // leading or trailing day. What must not happen is a second today.
  assert(after.today <= 1, `at most one day is marked today (${after.today})`);
  eq(after.selected.length, 0, 'navigating months clears the day selection');

  await page.click('#prevMonth');
  await page.click('#prevMonth');
  await page.waitForTimeout(200);
  assert((await gridState()).month !== after.month, 'Prev goes back again');

  // Forward past December, which is the easy place to get the year wrong.
  for (let i = 0; i < 14; i++) await page.click('#nextMonth');
  await page.waitForTimeout(300);
  const rolled = (await gridState()).month;
  const [, yyyy] = rolled.split(' ');
  assert(Number(yyyy) >= new Date().getFullYear() + 1,
    `14 months forward rolls into the next year (${rolled})`);

  for (let i = 0; i < 14; i++) await page.click('#prevMonth');
  await page.waitForTimeout(300);
  const back = (await gridState()).month;
  assert(back !== rolled, `14 months back lands elsewhere (${back})`);
  eq((await gridState()).dayCount, 42, 'grid survives the year-boundary round trip');

  await page.click('#todayMonth');
  await page.waitForTimeout(200);
  const todayState = await gridState();
  eq(todayState.month, new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    'Today returns to the current month');
  eq(todayState.selected[0], await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }), 'Today selects the current date');
}

console.log('\n--- Selected-day event count and accessible event marker ---');
await reset();
{
  await seed(0, 'First today event', '09:00');
  await seed(0, 'Second today event', '11:00');
  await page.reload();
  await page.waitForTimeout(250);

  eq(await page.locator('#selectedEventCount').textContent(), '2 events scheduled',
    'selected-day heading shows the event count');
  const todayButtonLabel = await page.locator('#calendarGrid .calendar-day.today').getAttribute('aria-label');
  assert(todayButtonLabel.endsWith(', today, 2 events'),
    `calendar day announces its event count (${todayButtonLabel})`);
  const eventTimes = await page.locator('#eventList .event-item-meta').allTextContents();
  assert(eventTimes[0].includes('9:00 AM') && eventTimes[1].includes('11:00 AM'),
    'selected-day events are listed in time order');
}

console.log('\n--- Create ---');
await reset();
{
  await openEventForm();
  const today = await page.inputValue('#eventDate');
  await page.fill('#eventTitle', 'Design review');
  await page.fill('#eventTime', '14:30');
  await page.fill('#eventDesc', 'Walk through the queue redesign.');
  await page.fill('#eventUrl', 'example.com/queue');
  await page.click('#eventForm button[type="submit"]');
  await page.waitForTimeout(250);
  const evs = await store();
  eq(evs.length, 1, 'one event saved');
  eq(evs[0].title, 'Design review', 'title stored');
  eq(evs[0].date, today, 'stored on the selected day');
  eq(evs[0].time, '14:30', 'time stored');
  eq(evs[0].url, 'https://example.com/queue', 'a bare domain is normalised to https');
  assert((await page.textContent('#eventList')).includes('Design review'), 'the event shows in the day list');
  assert((await gridState()).withEvents.includes(today), 'the day gained an event dot');

  // The form collapsed on save, so a rejected submit needs it open again.
  await openEventForm();
  await page.fill('#eventTitle', '');
  await page.click('#eventForm button[type="submit"]');
  await page.waitForTimeout(200);
  eq((await store()).length, 1, 'an empty title is rejected');
  // #eventTitle carries required, so the browser's own validation stops the
  // submit before handleSubmit runs. Assert the flag rather than a toast.
  eq(await page.evaluate(() => document.getElementById('eventTitle').checkValidity()), false,
    'the empty title fails native validation');
  eq(await page.evaluate(() => document.getElementById('eventTitle').validationMessage.length > 0), true,
    'and the browser reports why');

  await page.fill('#eventTitle', 'Bad link');
  await page.fill('#eventUrl', 'javascript:alert(1)');
  await page.click('#eventForm button[type="submit"]');
  await page.waitForTimeout(200);
  eq((await store()).length, 1, 'a javascript: link is refused rather than saved');
  eq(await page.getAttribute('#eventUrl', 'aria-invalid'), 'true', 'the link field is marked invalid');
}

console.log('\n--- Edit ---');
await reset();
{
  await openEventForm();
  await page.fill('#eventTitle', 'Original title');
  await page.click('#eventForm button[type="submit"]');
  await page.waitForTimeout(250);
  await page.click('#eventList button[aria-label^="Edit event"]');
  await page.waitForTimeout(250);
  eq(await page.inputValue('#eventTitle'), 'Original title', 'edit loads the existing title');
  assert(await page.isVisible('#editBanner'), 'the edit banner is shown');
  eq(await page.textContent('#eventForm button[type="submit"]'), 'Save changes', 'the button switches to Save changes');

  await page.fill('#eventTitle', 'Renamed');
  await page.click('#eventForm button[type="submit"]');
  await page.waitForTimeout(250);
  const evs = await store();
  eq(evs.length, 1, 'editing does not create a second event');
  eq(evs[0].title, 'Renamed', 'the edit was saved');
  assert(!(await page.isVisible('#editBanner')), 'the banner is hidden after saving');
  eq(await page.textContent('#eventForm button[type="submit"]'), 'Add event', 'the button resets to Add event');

  // Selecting another day mid-edit must abandon the edit.
  await page.click('#eventList button[aria-label^="Edit event"]');
  await page.waitForTimeout(200);
  const other = await page.evaluate(() =>
    [...document.querySelectorAll('#calendarGrid button.calendar-day')].map(b => b.dataset.date)
      .find(d => d !== document.getElementById('eventDate').value));
  await page.click(`#calendarGrid button[data-date="${other}"]`);
  await page.waitForTimeout(200);
  assert(!(await page.isVisible('#editBanner')), 'selecting another day abandons the in-progress edit');
  eq(await page.textContent('#eventForm button[type="submit"]'), 'Add event', 'and the form returns to Add mode');
}

console.log('\n--- Delete through the confirm dialog ---');
await reset();
{
  await openEventForm();
  const today = await page.inputValue('#eventDate');
  await page.fill('#eventTitle', 'Doomed');
  await page.click('#eventForm button[type="submit"]');
  await page.waitForTimeout(250);
  await page.click('#eventList button[aria-label^="Delete event"]');
  await page.waitForTimeout(200);
  assert(await page.isVisible('#calendarDeleteModal'), 'the confirm dialog opens');
  eq(await page.evaluate(() => document.activeElement?.id), 'cancelDeleteModal',
    'Cancel takes focus, so Enter cannot delete');

  await page.click('#cancelDeleteModal');
  await page.waitForTimeout(200);
  eq((await store()).length, 1, 'cancelling deletes nothing');
  assert(!(await page.isVisible('#calendarDeleteModal')), 'the dialog closes on cancel');

  await page.click('#eventList button[aria-label^="Delete event"]');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  eq((await store()).length, 1, 'Escape deletes nothing');
  assert(!(await page.isVisible('#calendarDeleteModal')), 'Escape closes the dialog');

  await page.click('#eventList button[aria-label^="Delete event"]');
  await page.waitForTimeout(200);
  await page.click('#confirmDeleteBtn');
  await page.waitForTimeout(250);
  eq((await store()).length, 0, 'confirming deletes the event');
  assert((await page.textContent('#eventList')).includes('Nothing scheduled'), 'the day list returns to its empty state');
  assert(!(await gridState()).withEvents.includes(today), 'the event dot is cleared');
}

console.log('\n--- Delete past events ---');
await reset();
{
  await seed(-10, 'Old standup');
  await seed(-1, 'Yesterday retro');
  await seed(0, 'Today sync');
  await seed(3, 'Future review');
  await page.reload();
  await page.waitForTimeout(300);

  await page.click('#clearPastBtn');
  await page.waitForTimeout(250);
  assert(await page.isVisible('#calendarDeleteModal'), 'the bulk delete asks for confirmation first');
  eq((await store()).length, 4, 'nothing is deleted before confirming');
  await page.click('#confirmDeleteBtn');
  await page.waitForTimeout(250);
  const left = (await store()).map(e => e.title);
  eq(left.length, 2, 'only the past events are removed');
  assert(left.includes('Today sync'), "today's event is kept");
  assert(left.includes('Future review'), 'a future event is kept');

  await page.click('#clearPastBtn');
  await page.waitForTimeout(200);
  const toast2 = await page.textContent('#calendarToast');
  console.log('        second-press toast:', JSON.stringify(toast2));
  assert(/no past events/i.test(toast2), 'a second press says there is nothing to do');
  eq((await store()).length, 2, 'and still deletes nothing');
}

console.log('\n--- Upcoming list ---');
await reset();
{
  await seed(-5, 'Long gone');
  await seed(0, 'Today thing');
  await seed(2, 'Late meeting', '18:00');
  await seed(2, 'Early meeting', '09:00');
  await seed(1, 'Tomorrow thing');
  await page.reload();
  await page.waitForTimeout(300);

  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('#upcomingEventsList .event-item-title')].map(e => e.textContent));
  assert(!titles.includes('Long gone'), 'past events are excluded from Upcoming');
  eq(titles.length, 4, 'four future-or-present events listed');
  assert(titles.indexOf('Early meeting') < titles.indexOf('Late meeting'), 'same-day events sort by time');
  assert(titles.indexOf('Tomorrow thing') < titles.indexOf('Early meeting'), 'days sort before times');
  assert(titles.indexOf('Today thing') < titles.indexOf('Tomorrow thing'), "today's events come first");

  const headings = await page.evaluate(() =>
    [...document.querySelectorAll('#upcomingEventsList .event-group-heading')].map(e => e.textContent.trim()));
  assert(headings.length >= 2, `each day gets its own heading (${JSON.stringify(headings)})`);
  assert(headings.some(h => /today/i.test(h)), "today's group is labelled Today");
}

console.log('\n--- Stored junk does not break the page ---');
await reset();
{
  await page.evaluate(() => {
    const today = new Date();
    const key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    localStorage.setItem('dashboard_events', JSON.stringify([
      { id: 'x1', title: '<img src=x onerror=alert(1)>', date: 'not-a-date', time: '99:99', description: '', url: 'javascript:alert(1)' },
      { id: 'x2', title: 'Fine', date: key, time: '', description: '', url: '' }
    ]));
  });
  await page.reload();
  await page.waitForTimeout(300);
  // Where does the payload actually land, and is it parsed as markup?
  const landed = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.event-item-title')]
      .find(e => e.textContent.includes('img'));
    return el ? {
      parent: el.parentElement.className,
      ownTags: el.querySelectorAll('*').length,
      innerHTMLHead: el.innerHTML.slice(0, 60),
      text: el.textContent.slice(0, 40),
      // Did an <img> actually get created inside the title element?
      imgInside: el.querySelectorAll('img').length,
      imgsAnywhereInList: document.querySelectorAll('#upcomingEventsList img').length
    } : null;
  });
  console.log('        payload landed:', JSON.stringify(landed));
  assert(landed !== null, 'the payload title did render somewhere');
  assert(landed.ownTags === 0 && landed.imgInside === 0,
    'a script-shaped title is inserted as text, not parsed into elements');
  assert(landed.imgsAnywhereInList === 0, 'no <img> element was created from the title');
  assert(await page.evaluate(() => !window.__xss), 'no injected handler ran');
  eq(errors.length, 0, `no page errors from malformed records (${errors.length})`);

  await page.click('#clearPastBtn');
  await page.waitForTimeout(250);
  if (await page.isVisible('#calendarDeleteModal')) {
    await page.click('#confirmDeleteBtn');
    await page.waitForTimeout(250);
  }
  const titles = (await store()).map(e => e.title);
  assert(titles.includes('<img src=x onerror=alert(1)>'), 'a record with an unparseable date is not deleted as "past"');
  assert(titles.includes('Fine'), 'and neither is a valid one');
}

console.log('\n--- No console or page errors across the run ---');
eq(errors.length, 0, `clean console (${errors.length})`);
if (errors.length) errors.forEach(e => console.log('        ! ' + e));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
server.kill();
process.exit(fail ? 1 : 0);

console.log('\n--- Grid structure ---');
await reset();
{
  const g = await gridState();
  eq(g.month, new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), 'opens on the current month');
  eq(g.dayCount, 42, 'renders a complete 6x7 grid');
  eq(g.labelCount, 7, 'seven day-of-week labels, not fourteen');
  eq(g.columnHeaders, 7, 'seven column headers');
  eq(g.today, 1, 'exactly one day is marked today');
  eq(g.selected.length, 1, 'one day is selected on load');
  assert(g.gridRole === 'group', `grid announces itself as role="${g.gridRole}"`);
  assert(g.dayRole === null, `day cells are plain buttons (role=${g.dayRole})`);
  eq(await page.locator('#selectedDateHeading').count(), 1, 'selected date has a dedicated heading');
  eq(await page.locator('#selectedEventCount').textContent(), '0 events scheduled', 'selected-day event count starts at zero');
}

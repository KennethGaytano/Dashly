#!/usr/bin/env node
/**
 * Automated Tests for the Progress Tab
 * Covers the 8-step progress ladder, skill/project CRUD, stepper controls,
 * localStorage persistence, derived weekly stats, goals read-view + filter,
 * empty states, XSS escaping, and responsive rendering.
 *
 * Mirrors the conventions of task-tests.mjs: plain `playwright` import,
 * spawns its own server, manual assert() counter, exit 1 on any failure.
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_SCRIPT = join(__dirname, 'server.mjs');
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}/pages/progress.html`;

/** The ladder the Progress page snaps every value to. */
const STEPS = [0, 25, 50, 60, 70, 80, 90, 100];

let testCount = 0;
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  testCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function setStorage(page, obj) {
  await page.evaluate((o) => {
    Object.keys(o).forEach((k) => localStorage.setItem(k, JSON.stringify(o[k])));
  }, obj);
}

async function getStorage(page, key) {
  return page.evaluate((k) => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, key);
}

/** Resolve the data-id of a rendered track by its visible name. */
async function findTrackId(page, name) {
  return page.evaluate((n) => {
    const item = Array.from(document.querySelectorAll('#skillsList .progress-item')).find((el) => {
      const label = el.querySelector('.progress-label span');
      return label && label.textContent === n;
    });
    return item ? item.getAttribute('data-id') : null;
  }, name);
}

async function getPct(page, id) {
  return page.evaluate((i) => {
    const bar = document.querySelector(`#skillsList .progress-item[data-id="${i}"] .progress-bar`);
    return bar ? Number(bar.getAttribute('aria-valuenow')) : null;
  }, id);
}

async function addTrack(page, { name, pct, type }) {
  // The form is collapsed after every save, so open it each time.
  await page.click('#newTrackBtn');
  await page.waitForSelector('#trackName', { state: 'visible' });
  await page.fill('#trackName', name);
  await page.selectOption('#trackProgress', String(pct));
  if (type) await page.selectOption('#trackType', type);
  await page.click('#submitBtn');
  await page.waitForTimeout(120);
}

async function runTests() {
  console.log('=== Progress Tab Automated Test Suite ===\n');

  const server = spawn('node', [SERVER_SCRIPT], {
    env: { ...process.env, PORT: PORT.toString() },
    stdio: 'ignore'
  });
  await new Promise((r) => setTimeout(r, 1000));

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Surface any uncaught page errors instead of silently passing.
    // Resource 404s (e.g. favicon) are ignored -- only real JS faults count.
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) {
        pageErrors.push(`console: ${m.text()}`);
      }
    });

    // -------------------------------------------------------------
    // Test 1: Page Load & Clean Slate
    // -------------------------------------------------------------
    console.log('--- Test Group 1: Page Load & Initial State ---');
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    assert((await page.title()).includes('Progress'), 'Page title is correct');
    const goalsEmpty = await page.locator('#goalsProgressList .empty-state').textContent();
    assert(goalsEmpty.includes('No goals yet'), 'Goals read-view shows empty state');

    // -------------------------------------------------------------
    // Test 2: The Progress Ladder
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: Progress Ladder ---');
    const opts = await page.$$eval('#trackProgress option', (es) => es.map((o) => Number(o.value)));
    assert(
      JSON.stringify(opts) === JSON.stringify(STEPS),
      `Select options are exactly the ladder [${STEPS.join(', ')}]`
    );
    assert((await page.inputValue('#trackProgress')) === '0', 'Ladder select defaults to the first step (0%)');
    assert(
      (await page.locator('#trackName').getAttribute('required')) !== null,
      'Track name input has required attribute'
    );
    assert(
      (await page.locator('#trackProgress').getAttribute('required')) !== null,
      'Progress select has required attribute'
    );

    // -------------------------------------------------------------
    // Test 3: Seeding
    // -------------------------------------------------------------
    console.log('\n--- Test Group 3: Seeded Starting Values ---');
    const seededCount = await page.locator('#skillsList .progress-item').count();
    assert(seededCount === 8, `Empty storage re-seeds 8 tracks (got ${seededCount})`);
    const seededSkills = await getStorage(page, 'dashboard_skills');
    const seededProjects = await getStorage(page, 'dashboard_projects');
    assert(seededSkills.length === 5, 'Seeded 5 skills into dashboard_skills');
    assert(seededProjects.length === 3, 'Seeded 3 projects into dashboard_projects');
    const offLadder = await page.$$eval(
      '#skillsList .progress-bar',
      (bars, steps) => bars.map((b) => Number(b.getAttribute('aria-valuenow'))).filter((v) => !steps.includes(v)),
      STEPS
    );
    assert(offLadder.length === 0, 'Every seeded track sits on a ladder step');
    const readout = await page
      .locator('#skillsList .progress-item')
      .first()
      .locator('.ladder-readout')
      .textContent();
    assert(
      /^Step \d+ of 8 · \d+%$/.test(readout.trim()),
      `Ladder readout formatted ("${readout.trim()}")`
    );

    // -------------------------------------------------------------
    // Test 4: Add a Skill
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Add Skill ---');
    await addTrack(page, { name: 'TypeScript', pct: 70 });
    const skillId = await findTrackId(page, 'TypeScript');
    assert(skillId !== null, 'Skill appears in the rendered list');
    assert((await getPct(page, skillId)) === 70, 'Skill rendered at the chosen 70% step');
    const skillsAfterAdd = await getStorage(page, 'dashboard_skills');
    assert(
      skillsAfterAdd.some((s) => s.name === 'TypeScript' && s.progress === 70 && s.type === 'skill'),
      'Skill persisted to dashboard_skills with type=skill'
    );

    // -------------------------------------------------------------
    // Test 5: Add a Project
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Add Project ---');
    await addTrack(page, { name: 'CLI Tool', pct: 90, type: 'project' });
    const projId = await findTrackId(page, 'CLI Tool');
    assert(projId !== null, 'Project appears in the rendered list');
    const projectsAfterAdd = await getStorage(page, 'dashboard_projects');
    assert(
      projectsAfterAdd.some((p) => p.name === 'CLI Tool' && p.progress === 90),
      'Project persisted to dashboard_projects (not dashboard_skills)'
    );
    assert(
      (await page.locator('#skillsList .progress-item').count()) === 10,
      'List now renders 10 tracks (5+1 skills, 3+1 projects)'
    );

    // -------------------------------------------------------------
    // Test 6: Stepper Controls
    // -------------------------------------------------------------
    console.log('\n--- Test Group 6: Stepper Prev/Next ---');
    await page.click(`#skillsList .progress-item[data-id="${skillId}"] button[data-dir="next"]`);
    await page.waitForTimeout(120);
    assert((await getPct(page, skillId)) === 80, 'Next advances exactly one rung (70% -> 80%)');
    await page.click(`#skillsList .progress-item[data-id="${skillId}"] button[data-dir="prev"]`);
    await page.waitForTimeout(120);
    assert((await getPct(page, skillId)) === 70, 'Prev goes back exactly one rung (80% -> 70%)');

    const skillsAfterStep = await getStorage(page, 'dashboard_skills');
    assert(
      skillsAfterStep.find((s) => s.id === skillId).progress === 70,
      'Stepper change is persisted to storage'
    );

    // -------------------------------------------------------------
    // Test 7: Ladder Clamping at the Edges
    // -------------------------------------------------------------
    console.log('\n--- Test Group 7: Ladder Edge Clamping ---');
    await addTrack(page, { name: 'Edge Zero', pct: 0 });
    const zeroId = await findTrackId(page, 'Edge Zero');
    assert(
      await page.locator(`#skillsList .progress-item[data-id="${zeroId}"] button[data-dir="prev"]`).isDisabled(),
      'Prev button is disabled at 0%'
    );
    await addTrack(page, { name: 'Edge Full', pct: 100 });
    const fullId = await findTrackId(page, 'Edge Full');
    assert(
      await page.locator(`#skillsList .progress-item[data-id="${fullId}"] button[data-dir="next"]`).isDisabled(),
      'Next button is disabled at 100%'
    );
    assert(
      await page.locator(`#skillsList .progress-item[data-id="${fullId}"] .progress-bar.fill-complete, #skillsList .progress-item[data-id="${fullId}"] .progress-fill.fill-complete`).count() > 0,
      'Completed (100%) track gets the fill-complete class'
    );

    // -------------------------------------------------------------
    // Test 8: Persistence Across Reload
    // -------------------------------------------------------------
    console.log('\n--- Test Group 8: LocalStorage Persistence Across Reload ---');
    await page.reload();
    assert(await findTrackId(page, 'TypeScript') !== null, 'Added skill survives a reload');
    assert(await findTrackId(page, 'CLI Tool') !== null, 'Added project survives a reload');
    assert((await getPct(page, skillId)) === 70, 'Stepper progress survives a reload');

    // -------------------------------------------------------------
    // Test 9: Delete
    // -------------------------------------------------------------
    console.log('\n--- Test Group 9: Delete Track ---');
    await page.click(`#skillsList .progress-item[data-id="${projId}"] .stepper-delete`);
    await page.waitForTimeout(120);
    assert(await findTrackId(page, 'CLI Tool') === null, 'Deleted project is removed from the list');
    const projectsAfterDelete = await getStorage(page, 'dashboard_projects');
    assert(
      !projectsAfterDelete.some((p) => p.name === 'CLI Tool'),
      'Deleted project removed from dashboard_projects'
    );
    assert(projectsAfterDelete.length === 3, 'Project count drops back to the 3 seeded entries');
    // The delete handler filters by id in BOTH stores; ids are unique per store,
    // so deleting a project must leave every skill intact.
    const skillsAfterDelete = await getStorage(page, 'dashboard_skills');
    assert(
      ['TypeScript', 'Edge Zero', 'Edge Full'].every((n) => skillsAfterDelete.some((s) => s.name === n)),
      'Deleting a project does not remove skills from the other store'
    );
    assert(skillsAfterDelete.length === 8, 'All 8 skills still stored after a project delete');

    // -------------------------------------------------------------
    // Test 10: Derived Weekly Stats
    // -------------------------------------------------------------
    console.log('\n--- Test Group 10: Weekly Stats Derived From Real Data ---');
    const today = new Date().toISOString();
    await setStorage(page, {
      dashboard_tasks: [
        { id: 't1', title: 'Seed task', status: 'completed', createdAt: today, updatedAt: today }
      ],
      dashboard_pomodoro_sessions: [
        { id: 's1', mode: 'focus', startedAt: today, completedAt: today, minutes: 30 },
        { id: 's2', mode: 'focus', startedAt: today, completedAt: today, minutes: 30 }
      ]
    });
    await page.reload();

    assert((await page.textContent('#statTasksDone')).trim() === '1', 'Tasks Done counts completed tasks in window');
    assert((await page.textContent('#statPomodoros')).trim() === '2', 'Pomodoros counts focus sessions in window');
    assert((await page.textContent('#statHoursStudied')).trim() === '1.0', 'Hours Studied sums session minutes (60m -> 1.0)');
    assert((await page.textContent('#statStreak')).trim() === '1', 'Day Streak derives from today activity');

    // -------------------------------------------------------------
    // Test 11: Goals Read View & Filter
    // -------------------------------------------------------------
    console.log('\n--- Test Group 11: Goals Read View & Filter ---');
    await setStorage(page, {
      dashboard_goals: [
        { id: 'g1', title: 'Active Goal', desc: '', progress: 40, status: 'active', milestones: [], createdAt: '2026-01-01' },
        { id: 'g2', title: 'Paused Goal', desc: '', progress: 80, status: 'paused', milestones: [], createdAt: '2026-01-02' },
        { id: 'g3', title: 'Completed Goal', desc: '', progress: 100, status: 'completed', milestones: [], createdAt: '2026-01-03' }
      ]
    });
    await page.reload();

    assert((await page.locator('#goalsProgressList .goal-card').count()) === 3, 'All three goals render in the read view');
    const summary = await page.textContent('#goalsSummary');
    assert(
      summary.includes('3 of 3 goals') && summary.includes('73% average progress'),
      `Summary reports count and average ("${summary.trim()}")`
    );
    assert(
      (await page.locator('#goalsProgressList .goal-card').first().locator('h3').textContent()).trim() === 'Active Goal',
      'Goals are ordered active -> paused -> completed'
    );
    assert(
      (await page.getAttribute('#filterRow button[data-filter="all"]', 'aria-pressed')) === 'true',
      '"All" filter starts pressed'
    );

    await page.click('#filterRow button[data-filter="paused"]');
    await page.waitForTimeout(120);
    const pausedTitles = await page.$$eval('#goalsProgressList .goal-card h3', (hs) => hs.map((h) => h.textContent.trim()));
    assert(
      pausedTitles.length === 1 && pausedTitles[0] === 'Paused Goal',
      'Paused filter shows only paused goals'
    );
    assert(
      (await page.getAttribute('#filterRow button[data-filter="paused"]', 'aria-pressed')) === 'true',
      'aria-pressed moves to the active filter'
    );
    assert(
      (await page.textContent('#goalsSummary')).includes('3 of 3 goals'),
      'Summary still counts every goal regardless of the active filter'
    );
    await page.click('#filterRow button[data-filter="all"]');
    await page.waitForTimeout(120);

    // -------------------------------------------------------------
    // Test 12: Completed Is Derived, Not Just Trusted From Storage
    // -------------------------------------------------------------
    // Goals finished before this fix were written with status 'active' because
    // the save path never reconciled the badge, so they never appeared under
    // the Completed filter. effectiveStatus() must rescue them on read.
    console.log('\n--- Test Group 12: Completion Derived on Read ---');
    await setStorage(page, {
      dashboard_goals: [
        { id: 'h1', title: 'Finished But Not Flagged', desc: '', progress: 100, status: 'active', milestones: [], createdAt: '2026-01-01' },
        { id: 'h2', title: 'All Milestones Done', desc: '', progress: 100, status: 'active', milestones: [{ text: 'only step', done: true }], createdAt: '2026-01-02' },
        { id: 'h3', title: 'Still In Progress', desc: '', progress: 50, status: 'active', milestones: [{ text: 'step one', done: true }, { text: 'step two', done: false }], createdAt: '2026-01-03' }
      ]
    });
    await page.reload();

    await page.click('#filterRow button[data-filter="completed"]');
    await page.waitForTimeout(120);
    const completedTitles = await page.$$eval('#goalsProgressList .goal-card h3', (hs) => hs.map((h) => h.textContent.trim()));
    assert(
      completedTitles.length === 2 && completedTitles.includes('Finished But Not Flagged'),
      'A 100% goal stored as "active" still shows under Completed'
    );
    assert(completedTitles.includes('All Milestones Done'), 'A goal with every milestone done shows under Completed');
    assert(
      !completedTitles.includes('Still In Progress'),
      'A half-done goal is excluded from Completed'
    );
    const badges = await page.$$eval('#goalsProgressList .goal-card .goal-badge', (bs) => bs.map((b) => b.textContent.trim()));
    assert(badges.every((b) => b === 'Completed'), `Derived goals are badged Completed (${badges.join(', ')})`);

    await page.click('#filterRow button[data-filter="active"]');
    await page.waitForTimeout(120);
    const activeTitles = await page.$$eval('#goalsProgressList .goal-card h3', (hs) => hs.map((h) => h.textContent.trim()));
    assert(
      activeTitles.length === 1 && activeTitles[0] === 'Still In Progress',
      'Only the genuinely unfinished goal is left under Active'
    );
    await page.click('#filterRow button[data-filter="all"]');
    await page.waitForTimeout(120);

    // -------------------------------------------------------------
    // Test 14: XSS Escaping
    // -------------------------------------------------------------
    console.log('\n--- Test Group 14: Input Sanitization / Security ---');
    await addTrack(page, { name: '<img src=x onerror="window.__pwned=1">Evil', pct: 50 });
    const evilHtml = await page.innerHTML('#skillsList');
    assert(evilHtml.includes('&lt;img'), 'HTML tags escaped in track name');
    assert((await page.evaluate(() => window.__pwned)) === undefined, 'Injected script did not execute');
    const goalHtml = await page.innerHTML('#goalsProgressList');
    assert(goalHtml.includes('&lt;img') || !goalHtml.includes('<img src=x'), 'Goals read view escapes stored HTML');

    // -------------------------------------------------------------
    // Test 15: Empty State & Responsive Rendering
    // -------------------------------------------------------------
    console.log('\n--- Test Group 15: Empty State & Mobile Viewport ---');
    await setStorage(page, { dashboard_skills: [], dashboard_projects: [] });
    await page.reload();
    const tracksEmpty = await page.locator('#skillsList .empty-state').textContent();
    assert(tracksEmpty.includes('No tracks yet'), 'Empty state shown when every track is removed');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.click('#newTrackBtn');
    await page.waitForSelector('#trackForm', { state: 'visible' });
    assert(await page.locator('#trackForm').isVisible(), 'Track form is visible on a mobile viewport');
    assert(await page.locator('#filterRow').isVisible(), 'Goals filter row is visible on a mobile viewport');

    // -------------------------------------------------------------
    // Test 16: No Uncaught Page Errors
    // -------------------------------------------------------------
    console.log('\n--- Test Group 16: Runtime Error Check ---');
    assert(pageErrors.length === 0, `No uncaught page/console errors (${pageErrors.join(' | ') || 'clean'})`);

    await browser.close();
  } finally {
    server.kill();
  }

  console.log(`\n=== Test Results: ${passedCount}/${testCount} passed (${failedCount} failed) ===`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});


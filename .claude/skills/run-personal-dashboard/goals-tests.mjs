#!/usr/bin/env node
/**
 * Automated Tests for the Goals Tab
 *
 * Focus: a goal must appear under "Completed" on the Progress page no matter
 * how it was completed -- ticking every milestone, picking Completed in the
 * status dropdown, or setting Progress to 100. Also covers un-completing, which
 * used to be one-way, plus basic CRUD and the delete confirmation modal.
 *
 * Mirrors the conventions of task-tests.mjs / progress-tests.mjs: plain
 * `playwright` import, spawns its own server, manual assert() counter.
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_SCRIPT = join(__dirname, 'server.mjs');
const PORT = 3000;
const GOALS_URL = `http://localhost:${PORT}/pages/goals.html`;
const PROGRESS_URL = `http://localhost:${PORT}/pages/progress.html`;

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

async function getGoals(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('dashboard_goals');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
}

async function storedGoal(page, title) {
  return page.evaluate((t) => {
    const goals = JSON.parse(localStorage.getItem('dashboard_goals') || '[]');
    return goals.find((g) => g.title === t) || null;
  }, title);
}

/** Add a goal through the real form, optionally with milestone text rows. */
async function createGoal(page, { title, status, progress, milestones = [] }) {
  // The form is collapsed after every save, so open it each time.
  await page.click('#newGoalBtn');
  await page.waitForSelector('#goalTitle', { state: 'visible' });
  await page.fill('#goalTitle', title);
  if (status) await page.selectOption('#goalStatus', status);
  if (progress !== undefined) await page.fill('#goalProgress', String(progress));
  const rows = page.locator('#milestoneRows input[name="milestones[]"]');
  for (let i = 0; i < milestones.length; i++) {
    if (i > 0) await page.click('button:has-text("+ Add milestone")');
    await rows.nth(i).fill(milestones[i]);
  }
  if (milestones.length && !(await page.locator('#goalProgress').isDisabled())) {
    throw new Error('Manual progress stays enabled when milestone-based progress is active');
  }
  await page.click('#submitBtn');
  await page.waitForTimeout(150);
}

/** Tick (or untick) milestone rows on the goal card with this title. */
async function toggleMilestones(page, title, count) {
  const card = page.locator('#goalsList .goal-card').filter({ hasText: title }).first();
  const rows = card.locator('.milestone');
  const total = await rows.count();
  for (let i = 0; i < Math.min(count, total); i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(90);
  }
  return total;
}

/** Which goals the Progress page lists under a given status filter. */
async function goalsUnderFilter(page, filter) {
  await page.goto(PROGRESS_URL);
  await page.waitForSelector('#goalsProgressList');
  await page.click(`#filterRow button[data-filter="${filter}"]`);
  await page.waitForTimeout(150);
  return page.$$eval('#goalsProgressList .goal-card h3', (hs) => hs.map((h) => h.textContent.trim()));
}

async function runTests() {
  console.log('=== Goals Tab Automated Test Suite ===\n');

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

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) {
        pageErrors.push(`console: ${m.text()}`);
      }
    });

    // -------------------------------------------------------------
    // Test 1: Page Load & Honest Empty State
    // -------------------------------------------------------------
    console.log('--- Test Group 1: Page Load & Empty Goals ---');
    await page.goto(GOALS_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    assert((await page.title()).includes('Goals'), 'Page title is correct');
    assert((await page.locator('#goalsList .goal-card').count()) === 0, 'Empty storage does not create example goals');
    assert((await page.locator('#goalsList .empty-state').textContent()).includes('No goals yet'), 'Empty goal state invites the user to create a goal');
    assert(await getGoals(page) === null, 'Displaying the empty state does not write sample goals');
    assert(
      (await page.locator('#goalStatus option').count()) === 3,
      'Status dropdown offers active / paused / completed'
    );

    // -------------------------------------------------------------
    // Test 2: Create a Goal
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: Create Goal ---');
    await createGoal(page, {
      title: 'Milestone Goal',
      status: 'active',
      progress: 70,
      milestones: ['step one', 'step two']
    });
    const created = await storedGoal(page, 'Milestone Goal');
    assert(created !== null, 'Goal is persisted to dashboard_goals');
    assert(created.milestones.length === 2, 'Both milestone rows are stored');
    assert(created.progress === 0, 'Milestones determine goal progress even when a manual percentage is entered');
    assert(created.status === 'active', 'New goal starts active');
    assert(
      (await page.locator('#goalsList .goal-card').filter({ hasText: 'Milestone Goal' }).count()) === 1,
      'New goal renders on the page'
    );
    // -------------------------------------------------------------
    // Test 3: Complete by Ticking Every Milestone  (the reported bug)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 3: Complete Via Milestones ---');
    await toggleMilestones(page, 'Milestone Goal', 2);
    const ticked = await storedGoal(page, 'Milestone Goal');
    assert(ticked.progress === 100, 'Ticking every milestone recalculates progress to 100%');
    assert(ticked.status === 'completed', 'Ticking every milestone writes status=completed');
    assert(
      (await page.locator('#goalsList .goal-card').filter({ hasText: 'Milestone Goal' }).locator('.goal-badge').textContent()).trim() === 'Completed',
      'Goal card is badged Completed on the Goals page'
    );

    let onProgress = await goalsUnderFilter(page, 'completed');
    assert(onProgress.includes('Milestone Goal'), 'Completed goal shows under Completed on the Progress page');
    onProgress = await goalsUnderFilter(page, 'active');
    assert(!onProgress.includes('Milestone Goal'), 'Completed goal is not listed under Active');

    // -------------------------------------------------------------
    // Test 4: Un-completing Must Revert (used to be one-way)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Un-completing Reverts To Active ---');
    await page.goto(GOALS_URL);
    await page.waitForSelector('#goalsList .goal-card');
    await toggleMilestones(page, 'Milestone Goal', 1);
    const reverted = await storedGoal(page, 'Milestone Goal');
    assert(reverted.progress === 50, 'Unticking a milestone drops progress to 50%');
    assert(reverted.status === 'active', 'Unticking a milestone reverts status to active, not stuck Completed');

    onProgress = await goalsUnderFilter(page, 'active');
    assert(onProgress.includes('Milestone Goal'), 'Re-opened goal returns to the Active filter');
    onProgress = await goalsUnderFilter(page, 'completed');
    assert(!onProgress.includes('Milestone Goal'), 'Re-opened goal leaves the Completed filter');

    // -------------------------------------------------------------
    // Test 5: Complete via the Status Dropdown
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Complete Via Status Dropdown ---');
    await page.goto(GOALS_URL);
    await page.waitForSelector('#goalsList .goal-card');
    await createGoal(page, { title: 'Dropdown Goal', status: 'completed', progress: 40 });
    const viaDropdown = await storedGoal(page, 'Dropdown Goal');
    assert(viaDropdown.status === 'completed', 'Explicit Completed in the dropdown is honoured');
    assert(viaDropdown.progress === 100, 'A manually completed goal shows 100% progress');
    onProgress = await goalsUnderFilter(page, 'completed');
    assert(onProgress.includes('Dropdown Goal'), 'Dropdown-completed goal shows under Completed');

    // -------------------------------------------------------------
    // Test 6: Complete via Progress = 100 (no milestones)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 6: Complete Via 100% Progress ---');
    await page.goto(GOALS_URL);
    await page.waitForSelector('#goalsList .goal-card');
    await createGoal(page, { title: 'Hundred Goal', status: 'active', progress: 100 });
    const viaProgress = await storedGoal(page, 'Hundred Goal');
    assert(viaProgress.status === 'completed', 'A milestone-less goal at 100% is auto-completed on create');
    onProgress = await goalsUnderFilter(page, 'completed');
    assert(onProgress.includes('Hundred Goal'), '100% goal shows under Completed');

    // -------------------------------------------------------------
    // Test 7: Paused Is Preserved
    // -------------------------------------------------------------
    console.log('\n--- Test Group 7: Paused Goals Stay Paused ---');
    await page.goto(GOALS_URL);
    await page.waitForSelector('#goalsList .goal-card');
    await createGoal(page, { title: 'Paused Goal', status: 'paused', progress: 30 });
    const paused = await storedGoal(page, 'Paused Goal');
    assert(paused.status === 'paused', 'A paused goal is not force-completed');
    onProgress = await goalsUnderFilter(page, 'paused');
    assert(onProgress.includes('Paused Goal'), 'Paused goal shows under the Paused filter');
    onProgress = await goalsUnderFilter(page, 'completed');
    assert(!onProgress.includes('Paused Goal'), 'Paused goal does not leak into Completed');

    // -------------------------------------------------------------
    // Test 8: Edit a Goal
    // -------------------------------------------------------------
    console.log('\n--- Test Group 8: Edit Goal ---');
    await page.goto(GOALS_URL);
    await page.waitForSelector('#goalsList .goal-card');
    await page
      .locator('#goalsList .goal-card')
      .filter({ hasText: 'Paused Goal' })
      .locator('button[title="Edit"]')
      .click();
    await page.waitForTimeout(200);
    assert((await page.textContent('#formTitle')).includes('Edit'), 'Form switches into edit mode');
    await page.fill('#goalTitle', 'Paused Goal Renamed');
    await page.click('#submitBtn');
    await page.waitForTimeout(150);
    const renamed = await storedGoal(page, 'Paused Goal Renamed');
    assert(renamed !== null, 'Renamed goal is saved under the new title');
    assert(renamed.milestones.length === 0, 'Edit does not invent milestones');

    // -------------------------------------------------------------
    // Test 9: Delete With Confirmation
    // -------------------------------------------------------------
    console.log('\n--- Test Group 9: Delete With Confirmation Modal ---');
    await page.click('#goalsList .goal-card:has-text("Hundred Goal") button[title="Delete"]');
    await page.waitForTimeout(200);
    assert(await page.locator('#confirmModal').isVisible(), 'Delete opens the confirmation modal');
    await page.click('#cancelModal');
    await page.waitForTimeout(150);
    assert(
      (await getGoals(page)).some((g) => g.title === 'Hundred Goal'),
      'Cancelling the modal leaves the goal in place'
    );

    await page.click('#goalsList .goal-card:has-text("Hundred Goal") button[title="Delete"]');
    await page.waitForTimeout(200);
    await page.click('#confirmDelete');
    await page.waitForTimeout(200);
    assert(
      !(await getGoals(page)).some((g) => g.title === 'Hundred Goal'),
      'Confirming removes the goal from storage'
    );
    onProgress = await goalsUnderFilter(page, 'completed');
    assert(!onProgress.includes('Hundred Goal'), 'Deleted goal no longer appears on the Progress page');

    // -------------------------------------------------------------
    // Test 10: No Uncaught Page Errors
    // -------------------------------------------------------------
    console.log('\n--- Test Group 10: Runtime Error Check ---');
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

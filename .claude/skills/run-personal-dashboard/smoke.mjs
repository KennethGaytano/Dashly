#!/usr/bin/env node
/**
 * Smoke test for Personal Dashboard
 * Drives a complete user flow across all pages and takes screenshots.
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_SCRIPT = join(__dirname, 'server.mjs');
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const OUTPUT_DIR = process.env.CLAUDE_JOB_DIR
  ? join(process.env.CLAUDE_JOB_DIR, 'tmp')
  : join(__dirname, 'screenshots');

async function runSmokeTest() {
  console.log('--- Personal Dashboard Smoke Test ---');

  // 1. Start Server
  console.log('1. Starting HTTP server...');
  const server = spawn('node', [SERVER_SCRIPT], {
    env: { ...process.env, PORT: PORT.toString() },
    stdio: 'ignore'
  });

  // Give server time to start
  await new Promise(r => setTimeout(r, 1000));

  try {
    // 2. Launch Browser
    console.log('2. Launching Chromium...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const pages = [
      { name: 'Home', url: '/', file: 'home.png' },
      { name: 'Tasks', url: '/pages/tasks.html', file: 'tasks.png' },
      { name: 'Calendar', url: '/pages/calendar.html', file: 'calendar.png' },
      { name: 'Notes', url: '/pages/notes.html', file: 'notes.png' },
      { name: 'Progress', url: '/pages/progress.html', file: 'progress.png' },
      { name: 'Goals', url: '/pages/goals.html', file: 'goals.png' },
      { name: 'Account settings', url: '/pages/settings.html', file: 'settings.png' },
    ];

    // 3. Test Navigation & Screenshots
    for (const p of pages) {
      console.log(`3. Navigating to ${p.name}...`);
      await page.goto(`${BASE_URL}${p.url}`);

      const title = await page.title();
      console.log(`   Page Title: "${title}"`);

      const favicon = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
      if (!favicon || !new URL(favicon, page.url()).pathname.endsWith('/assets/icons/favicon.svg')) {
        throw new Error(`${p.name} page is not using the supplied SVG favicon.`);
      }
      const faviconResponse = await page.request.get(new URL(favicon, page.url()).href);
      if (!faviconResponse.ok()) {
        throw new Error(`${p.name} page favicon request failed with ${faviconResponse.status()}.`);
      }

      const screenshotPath = join(OUTPUT_DIR, p.file);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`   Screenshot: ${screenshotPath}`);
    }

    // 4. Test Interactive Elements
    console.log('4. Testing interactive elements on Tasks page...');
    await page.goto(`${BASE_URL}/pages/tasks.html`);
    await page.click('[data-task-filter="all"]');

    // The add form is collapsed on load, so open it before typing.
    await page.click('#newTaskBtn');
    await page.waitForSelector('#taskTitle', { state: 'visible' });

    // Type a new task
    await page.fill('#taskTitle', 'Complete skill generator');
    console.log('   Typed new task title');

    // Add description
    await page.fill('#taskDescription', 'Create and test interactive dashboard skills');
    console.log('   Typed task description');

    // Set due date and time
    await page.fill('#taskDueDate', '2026-10-15');
    await page.fill('#taskDueTime', '14:30');
    console.log('   Set task due date and time');

    // Select priority
    await page.selectOption('#taskPriority', 'high');
    console.log('   Selected high priority');

    // Click Add button
    await page.click('#submitBtn');
    console.log('   Clicked Add Task button');

    const createdTask = page.locator('#todoList .task-item').filter({ hasText: 'Complete skill generator' });
    await createdTask.locator('.task-due-time').waitFor();
    console.log('   Verified task due time was rendered');

    // Now check the newly created checkbox
    await page.waitForSelector('#todoList .task-item input[type="checkbox"]');
    const firstCheckbox = page.locator('#todoList .task-item input[type="checkbox"]').first();
    await firstCheckbox.click();
    console.log('   Toggled task checkbox');

    const taskInteractPath = join(OUTPUT_DIR, 'tasks-interacted.png');
    await page.screenshot({ path: taskInteractPath, fullPage: true });
    console.log(`   Screenshot: ${taskInteractPath}`);

    // 5. Test Pomodoro Timer on Home page
    console.log('5. Testing Pomodoro Timer on Home page...');
    await page.goto(`${BASE_URL}/index.html`);
    const taskDates = await page.evaluate(() => {
      const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return { today: key(today), tomorrow: key(tomorrow) };
    });
    await page.evaluate(({ today, tomorrow }) => {
      localStorage.setItem('dashboard_tasks', JSON.stringify([
        { id: 'home-later', title: 'Due later', status: 'todo', priority: 'medium', dueDate: today, dueTime: '17:00' },
        { id: 'home-soon', title: 'Due soon', status: 'in_progress', priority: 'high', dueDate: today, dueTime: '09:00' },
        { id: 'home-future', title: 'Due tomorrow', status: 'todo', priority: 'low', dueDate: tomorrow },
        { id: 'home-undated', title: 'No deadline', status: 'todo', priority: 'low' },
        { id: 'home-completed', title: 'Already done', status: 'completed', priority: 'low', dueDate: today }
      ]));
    }, taskDates);
    await page.reload();

    const homeTasks = await page.locator('#homeTaskList .task-text').allTextContents();
    if (homeTasks.length !== 2 || homeTasks[0] !== 'Due soon' || homeTasks[1] !== 'Due later') {
      throw new Error(`Today's task list included the wrong tasks: ${JSON.stringify(homeTasks)}`);
    }
    const taskCountText = await page.locator('.stat-card').filter({ hasText: 'Tasks' }).locator('.stat-value').textContent();
    if (taskCountText !== '1/5') throw new Error(`Task overview count should be 1/5, got ${taskCountText}`);

    await page.locator('#homeTaskList input[type="checkbox"]').first().click();
    const completedFromHome = await page.evaluate(() => {
      const task = JSON.parse(localStorage.getItem('dashboard_tasks')).find(item => item.id === 'home-soon');
      return { status: task.status, completedAt: task.completedAt };
    });
    if (completedFromHome.status !== 'completed' || !completedFromHome.completedAt) {
      throw new Error('Completing a home task did not record its completion time');
    }
    if ((await page.locator('#homeTaskList .task-item').count()) !== 1) {
      throw new Error('Completed task remained in Today’s open task list');
    }
    await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('dashboard_tasks'));
      localStorage.setItem('dashboard_tasks', JSON.stringify(tasks.filter(task => task.id !== 'home-later')));
    });
    await page.reload();
    if ((await page.locator('#homeTaskList .task-item').count()) !== 0 ||
        !(await page.locator('#homeTaskList .empty-state').textContent()).includes('Nothing due today')) {
      throw new Error('The empty due-today state did not render correctly');
    }
    console.log('   Verified only open tasks due today are shown');

    await page.click('.pomodoro button.btn-primary');
    console.log('   Clicked Start on Pomodoro timer');

    const timerPath = join(OUTPUT_DIR, 'home-timer.png');
    await page.screenshot({ path: timerPath, fullPage: true });
    console.log(`   Screenshot: ${timerPath}`);

    // Clean up
    console.log('6. Cleaning up...');
    await browser.close();
    console.log('   Browser closed');

    console.log('--- Smoke Test PASSED! ---');
  } finally {
    server.kill();
    console.log('   Server stopped');
  }
}

runSmokeTest().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});

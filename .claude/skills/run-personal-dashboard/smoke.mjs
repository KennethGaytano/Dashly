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
    ];

    // 3. Test Navigation & Screenshots
    for (const p of pages) {
      console.log(`3. Navigating to ${p.name}...`);
      await page.goto(`${BASE_URL}${p.url}`);

      const title = await page.title();
      console.log(`   Page Title: "${title}"`);

      const screenshotPath = join(OUTPUT_DIR, p.file);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`   Screenshot: ${screenshotPath}`);
    }

    // 4. Test Interactive Elements
    console.log('4. Testing interactive elements on Tasks page...');
    await page.goto(`${BASE_URL}/pages/tasks.html`);

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

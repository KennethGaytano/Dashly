#!/usr/bin/env node
/**
 * Capture mobile (390x844) screenshots of all dashboard pages.
 * Usage: node mobile-shots.mjs
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
// __dirname is <project>/.claude/skills/run-personal-dashboard
const SHOTS_DIR = join(__dirname, 'screenshots');

const pages = [
  { name: 'home', url: 'index.html' },
  { name: 'tasks', url: 'pages/tasks.html' },
  { name: 'calendar', url: 'pages/calendar.html' },
  { name: 'notes', url: 'pages/notes.html' },
  { name: 'progress', url: 'pages/progress.html' },
  { name: 'goals', url: 'pages/goals.html' }
];

const server = spawn('node', [SERVER_SCRIPT], {
  env: { ...process.env, PORT: PORT.toString() },
  stdio: ['ignore', 'pipe', 'pipe']
});

await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();

for (const p of pages) {
  await page.goto(`${BASE_URL}/${p.url}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS_DIR, `mobile-${p.name}.png`), fullPage: true });
  console.log(`Mobile screenshot saved: mobile-${p.name}.png`);
}

await browser.close();
server.kill();
console.log('Done');

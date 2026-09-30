#!/usr/bin/env node
/**
 * Automated tests for note search, reading, editing, and empty states.
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_SCRIPT = join(__dirname, 'server.mjs');
const PORT = 3000;
const NOTES_URL = `http://localhost:${PORT}/pages/notes.html`;

async function runTests() {
  const server = spawn('node', [SERVER_SCRIPT], {
    env: { ...process.env, PORT: PORT.toString() },
    stdio: 'ignore'
  });
  await new Promise(resolve => setTimeout(resolve, 1000));

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(NOTES_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    if (!(await page.locator('#notesList .empty-state').textContent()).includes('Create your first note')) {
      throw new Error('Empty note state does not offer a create action');
    }
    await page.locator('#notesList .empty-state a').click();
    await page.waitForSelector('#noteTitle', { state: 'visible' });
    await page.fill('#noteTitle', 'Meeting plan');
    const body = 'First line\nSecond line <img src=x onerror="window.__pwned=1">';
    await page.fill('#noteBody', body);
    await page.fill('#noteUrl', 'example.com/notes');
    await page.click('#submitBtn');

    if ((await page.locator('#notesList .note-card').count()) !== 1) {
      throw new Error('Created note is missing from the list');
    }
    await page.locator('#notesList .note-card button').filter({ hasText: 'Read' }).click();
    if (!(await page.locator('#noteViewer').isVisible())) throw new Error('Read action did not open note viewer');
    if ((await page.textContent('#noteReaderBody')) !== body) throw new Error('Reader did not display the full note body');
    if ((await page.locator('#noteReaderBody img').count()) !== 0) throw new Error('Note body was interpreted as markup');
    if ((await page.locator('#noteReaderLink').getAttribute('href')) !== 'https://example.com/notes') {
      throw new Error('Reader link was not normalized safely');
    }
    if (await page.evaluate(() => window.__pwned) !== undefined) throw new Error('Note body script executed');

    await page.click('#editViewedNote');
    await page.waitForSelector('#noteTitle', { state: 'visible' });
    if ((await page.inputValue('#noteTitle')) !== 'Meeting plan') throw new Error('Reader Edit did not populate the existing note');
    if (await page.evaluate(() => document.activeElement.id) !== 'noteTitle') throw new Error('Reader Edit did not move focus into the edit form');
    await page.fill('#noteTitle', 'Roadmap update');
    await page.click('#submitBtn');
    if (!(await page.locator('#notesList h3').textContent()).includes('Roadmap update')) {
      throw new Error('Edited note was not refreshed in the list');
    }

    await page.fill('#noteSearch', 'roadmap');
    if ((await page.locator('#notesList .note-card').count()) !== 1) throw new Error('Search did not find a title match');
    await page.fill('#noteSearch', 'missing term');
    if (!(await page.locator('#notesList .empty-state').textContent()).includes('No notes match')) {
      throw new Error('No-results search state was not rendered');
    }
    await page.locator('#notesList .empty-state button').click();
    if ((await page.locator('#notesList .note-card').count()) !== 1) throw new Error('Clear search did not restore the full list');

    await page.setViewportSize({ width: 375, height: 667 });
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflows) throw new Error('Notes page overflows horizontally on mobile');
    if (pageErrors.length) throw new Error(`Uncaught page errors: ${pageErrors.join(' | ')}`);

    console.log('Notes tests passed: empty state, create, safe read view, edit, search, and mobile layout.');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

runTests().catch(error => {
  console.error('Notes tests failed:', error);
  process.exit(1);
});

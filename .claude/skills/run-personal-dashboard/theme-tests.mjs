import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const port = 3018;
const server = spawn('node', [join(directory, 'server.mjs')], {
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore'
});

const supabaseStub = `
window.supabase = {
  createClient() {
    return {
      auth: {
        // A signed-in session, so the dashboard unlocks instead of staying
        // behind the cloud-locked sign-in overlay.
        async getSession() {
          return {
            data: { session: { user: { id: 'theme-test-user', email: 'theme@example.com' } } },
            error: null
          };
        },
        onAuthStateChange() {},
        async signOut() { return { error: null }; }
      },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          then(resolve) { return Promise.resolve(resolve({ data: [], error: null })); }
        };
      },
      channel() { return { on() { return this; }, subscribe() { return this; } }; },
      async removeChannel() {}
    };
  }
};
`;

let browser;

try {
  let serverReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}/`);
      serverReady = response.ok;
      if (serverReady) break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  assert.equal(serverReady, true, 'dashboard test server should start');

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: supabaseStub
    })
  );

  // Two toggles exist — one in the mobile app bar, one in the sidebar. Only
  // the sidebar one is visible at desktop width, so target it explicitly
  // rather than taking whichever happens to come first in the DOM.
  const toggle = page.locator('.theme-toggle--sidebar');

  await page.goto(`http://localhost:${port}/`);
  await toggle.waitFor({ state: 'visible' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light',
    'a first visit follows the system light preference');
  assert.equal(await toggle.getAttribute('aria-label'), 'Switch to dark mode',
    'the toggle label reflects the system-selected theme');

  await toggle.click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark',
    'the theme toggle selects the opposite of the current theme');
  assert.equal(await page.evaluate(() => localStorage.getItem('dashly-theme')), 'dark',
    'a manual selection is saved');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark',
    'a manual selection persists across page reloads');

  await page.evaluate(() => localStorage.removeItem('dashly-theme'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark',
    'a new visit without a saved selection follows system dark mode');

  console.log('Theme tests passed: system light/dark defaults and saved preference.');
} finally {
  if (browser) await browser.close();
  server.kill();
}

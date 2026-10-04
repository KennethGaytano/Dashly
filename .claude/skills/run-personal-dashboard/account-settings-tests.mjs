import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const port = 3021;
const server = spawn('node', [join(directory, 'server.mjs')], {
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore'
});

const supabaseStub = `
window.supabase = {
  createClient() {
    let authStateChange;
    return {
      auth: {
        async getSession() {
          return {
            data: { session: JSON.parse(localStorage.getItem('__account_session') || 'null') },
            error: null
          };
        },
        onAuthStateChange(callback) {
          authStateChange = callback;
        },
        async updateUser({ data }) {
          const session = JSON.parse(localStorage.getItem('__account_session'));
          session.user.user_metadata = { ...session.user.user_metadata, ...data };
          localStorage.setItem('__account_session', JSON.stringify(session));
          localStorage.setItem('__account_profile_update', JSON.stringify(data));
          return { data: { user: session.user }, error: null };
        },
        async signOut() {
          localStorage.removeItem('__account_session');
          if (authStateChange) authStateChange('SIGNED_OUT', null);
          return { error: null };
        }
      },
      functions: {
        async invoke(name, options) {
          localStorage.setItem('__account_delete_call', JSON.stringify({ name, options }));
          return { data: { deleted: 'true' }, error: null };
        }
      },
      from() {
        return {
          select() { return this; },
          update() { return this; },
          eq() { return this; },
          is() { return this; },
          then(resolve, reject) {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
        };
      },
      channel() {
        return { on() { return this; }, subscribe() { return this; } };
      },
      async removeChannel() {}
    };
  }
};
`;

const session = {
  user: {
    id: 'account-settings-user',
    email: 'ada@example.com',
    user_metadata: {
      first_name: 'Ada',
      last_name: 'Lovelace',
      full_name: 'Ada Lovelace',
      username: 'ada_codes'
    }
  }
};

let browser;

try {
  let serverReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}/`);
      serverReady = response.ok;
      if (serverReady) break;
    } catch (_) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  assert.equal(serverReady, true, 'dashboard test server should start');

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  await context.addInitScript(({ initialSession }) => {
    if (sessionStorage.getItem('__account_seeded')) return;
    localStorage.setItem('__account_session', JSON.stringify(initialSession));
    localStorage.setItem('dashly_cloud_user_id', initialSession.user.id);
    sessionStorage.setItem('__account_seeded', 'true');
  }, { initialSession: session });
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: supabaseStub
    })
  );

  const profilePage = await context.newPage();
  await profilePage.goto(`http://localhost:${port}/pages/tasks.html`);
  await profilePage.locator('#cloud-account-control').waitFor();
  await profilePage.setViewportSize({ width: 320, height: 568 });
  await profilePage.locator('.tab-more').click();
  // The drawer slides in over a 0.3s transform transition. Measuring before it
  // settles catches the button mid-flight, still off-canvas at translateX(-100%).
  await profilePage.waitForTimeout(400);
  await profilePage.locator('.cloud-settings-open').waitFor({ state: 'visible' });
  const settingsButtonBounds = await profilePage.locator('.cloud-settings-open').evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
  });
  assert.ok(
    settingsButtonBounds.left >= 0 && settingsButtonBounds.right <= 320 &&
    settingsButtonBounds.top >= 0 && settingsButtonBounds.bottom <= 568,
    'Settings should be visible inside the drawer on a 320x568 mobile viewport'
  );
  await profilePage.locator('.cloud-settings-open').click();
  await profilePage.locator('.cloud-settings-dialog').waitFor();
  await profilePage.setViewportSize({ width: 375, height: 812 });
  const dialogBounds = await profilePage.locator('.cloud-settings-dialog').evaluate(dialog => {
    const bounds = dialog.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, viewportWidth: window.innerWidth };
  });
  assert.ok(dialogBounds.left >= 0 && dialogBounds.right <= dialogBounds.viewportWidth,
    'account settings should fit a narrow mobile viewport');
  assert.equal(await profilePage.locator('#cloud-settings-first-name').inputValue(), 'Ada');
  assert.equal(await profilePage.locator('#cloud-settings-last-name').inputValue(), 'Lovelace');
  assert.equal(await profilePage.locator('#cloud-settings-username').inputValue(), 'ada_codes');
  await profilePage.locator('#cloud-settings-first-name').fill('Grace');
  await profilePage.locator('#cloud-settings-last-name').fill('Hopper');
  await profilePage.locator('#cloud-settings-username').fill('grace_codes');
  await profilePage.locator('.cloud-profile-form').locator('button[type="submit"]').click();
  await profilePage.getByText('Name saved.').waitFor();
  const savedProfile = await profilePage.evaluate(() =>
    JSON.parse(localStorage.getItem('__account_profile_update'))
  );
  assert.deepEqual(savedProfile, {
    first_name: 'Grace',
    last_name: 'Hopper',
    full_name: 'Grace Hopper',
    username: 'grace_codes'
  }, 'profile updates should save names and preserve other user metadata');

  await profilePage.locator('.cloud-settings-switch').click();
  await profilePage.locator('#cloud-auth-form').waitFor();
  assert.equal(await profilePage.locator('#cloud-account-control').count(), 0,
    'switching accounts should sign out and return to the account form');
  const loginScroll = await profilePage.evaluate(() => ({
    locked: document.documentElement.classList.contains('cloud-locked'),
    overflowY: getComputedStyle(document.documentElement).overflowY,
    scrollbarWidth: getComputedStyle(document.documentElement).scrollbarWidth
  }));
  assert.equal(loginScroll.locked, true, 'the login screen should lock document scrolling');
  assert.equal(loginScroll.overflowY, 'hidden', 'the login screen should hide the document scrollbar');
  assert.equal(loginScroll.scrollbarWidth, 'none', 'the login screen should suppress scrollbar rendering');

  const deletePage = await context.newPage();
  await deletePage.goto(`http://localhost:${port}/pages/tasks.html`);
  await deletePage.locator('#cloud-account-control').waitFor();
  await deletePage.locator('.cloud-settings-open').click();
  await deletePage.locator('#cloud-settings-delete-confirm').fill('wrong');
  await deletePage.locator('.cloud-settings-delete-button').click();
  await deletePage.getByText('Type DELETE exactly to confirm account deletion.').waitFor();
  assert.equal(await deletePage.evaluate(() => localStorage.getItem('__account_delete_call')), null,
    'the delete endpoint should not be called until the confirmation text matches');

  await deletePage.locator('#cloud-settings-delete-confirm').fill('DELETE');
  await deletePage.locator('.cloud-settings-delete-button').click();
  await deletePage.locator('#cloud-auth-form').waitFor();
  const deleteCall = await deletePage.evaluate(() =>
    JSON.parse(localStorage.getItem('__account_delete_call'))
  );
  assert.equal(deleteCall.name, 'delete-account');
  assert.deepEqual(deleteCall.options, { body: {} });
  assert.equal(await deletePage.evaluate(() => localStorage.getItem('dashly_cloud_user_id')), null,
    'deleting the account should clear the signed-in user marker');

  console.log('Account settings tests passed: profile update, account switching, deletion confirmation and local sign-out.');
} finally {
  if (browser) await browser.close();
  server.kill();
}

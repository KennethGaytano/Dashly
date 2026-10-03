import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const port = 3017;
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
            data: { session: JSON.parse(localStorage.getItem('__auth_test_session') || 'null') },
            error: null
          };
        },
        onAuthStateChange(callback) {
          authStateChange = callback;
        },
        async signOut() {
          localStorage.removeItem('__auth_test_session');
          if (authStateChange) authStateChange('SIGNED_OUT', null);
          return { error: null };
        },
        async signUp({ email, password }) {
          localStorage.setItem('__auth_test_signup', JSON.stringify({ email, password }));
          if (localStorage.getItem('__auth_test_require_confirmation') === 'true') {
            return { data: { user: { id: 'password-user', email }, session: null }, error: null };
          }
          const session = { user: { id: 'password-user', email } };
          localStorage.setItem('__auth_test_session', JSON.stringify(session));
          return { data: { session }, error: null };
        },
        async signInWithPassword({ email, password }) {
          localStorage.setItem('__auth_test_signin', JSON.stringify({ email, password }));
          if (password !== 'password123') {
            return { data: { session: null }, error: { message: 'Invalid login credentials' } };
          }
          const session = { user: { id: 'password-user', email } };
          localStorage.setItem('__auth_test_session', JSON.stringify(session));
          return { data: { session }, error: null };
        }
      },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          then(resolve, reject) {
            const delay = Number(localStorage.getItem('__auth_test_delay') || 0);
            return new Promise(done => setTimeout(done, delay))
              .then(() => resolve({ data: [], error: null }), reject);
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
  const page = await browser.newPage();
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: supabaseStub
    })
  );
  await page.goto(`http://localhost:${port}/pages/tasks.html`);

  assert.equal(await page.locator('#cloud-password').count(), 1, 'password auth should show a password field');
  assert.equal(await page.locator('#cloud-otp-form').count(), 0, 'password auth should not show an OTP form');
  await page.locator('#cloud-email').fill('person@gmail.com');
  await page.locator('#cloud-password').fill('password123');
  await page.evaluate(() => localStorage.setItem('__auth_test_require_confirmation', 'true'));
  await page.locator('#cloud-signup').click();
  await page.getByText(/Account creation still requires email confirmation/).waitFor();
  assert.equal(await page.locator('#cloud-otp-form').count(), 0, 'confirmation notice should not redirect users to OTP');
  await page.evaluate(() => localStorage.removeItem('__auth_test_require_confirmation'));
  await page.locator('#cloud-signup').click();
  await page.waitForURL('**/index.html');
  assert.equal(await page.title(), 'Dashboard — Home', 'successful signup from a feature page should land on Home');
  assert.equal(await page.locator('#cloud-auth-root').count(), 0, 'successful signup should close the auth screen');
  const signup = await page.evaluate(() => JSON.parse(localStorage.getItem('__auth_test_signup')));
  assert.equal(signup.email, 'person@gmail.com');
  assert.equal(signup.password, 'password123');

  await page.locator('#cloud-account-control .cloud-signout').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#cloud-auth-form').count(), 1, 'sign-out should return to the password form');
  await page.locator('#cloud-email').fill('person@gmail.com');
  await page.locator('#cloud-password').fill('wrongpass');
  await page.locator('#cloud-auth-form').locator('button[type="submit"]').click();
  await page.getByText('Invalid login credentials').waitFor();
  await page.locator('#cloud-password').fill('password123');
  await page.locator('#cloud-auth-form').locator('button[type="submit"]').click();
  await page.locator('#cloud-account-control').waitFor();
  const signin = await page.evaluate(() => JSON.parse(localStorage.getItem('__auth_test_signin')));
  assert.equal(signin.email, 'person@gmail.com');
  assert.equal(signin.password, 'password123');

  await page.evaluate(() => localStorage.setItem('__auth_test_delay', '700'));
  await page.goto(`http://localhost:${port}/pages/tasks.html`);
  assert.equal(
    await page.locator('html').evaluate(element => element.classList.contains('cloud-locked')),
    true,
    'known signed-in users should keep the page hidden while cloud data restores'
  );
  assert.equal(
    await page.locator('.cloud-loading-card').count(),
    1,
    'returning users should see a neutral restore indicator rather than the sign-in form'
  );
  assert.equal(await page.locator('#cloud-auth-form').count(), 0, 'restore should not flash the sign-in form');
  await page.locator('#cloud-auth-root').waitFor({ state: 'detached' });
  assert.equal(
    await page.locator('html').evaluate(element => element.classList.contains('cloud-locked')),
    false,
    'the dashboard should unlock after its cloud data is restored'
  );
  await page.locator('#cloud-account-control').waitFor();
  await page.evaluate(() => localStorage.removeItem('__auth_test_delay'));

  await page.locator('#cloud-account-control .cloud-signout').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#cloud-auth-root').count(), 1, 'signing out should return to the password screen');
  assert.equal(await page.locator('#cloud-signin').count(), 1);

  console.log('Auth tests passed: password signup, email-confirmation guidance, invalid-password feedback, sign-in, Home landing, and returning-user navigation.');
} finally {
  if (browser) await browser.close();
  server.kill();
}

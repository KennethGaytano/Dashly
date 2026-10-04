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
        async setSession(session) {
          localStorage.setItem('__auth_test_session', JSON.stringify(session));
          if (authStateChange) authStateChange('SIGNED_IN', session);
          return { data: { session }, error: null };
        },
        async signUp({ email, password, options }) {
          localStorage.setItem('__auth_test_signup', JSON.stringify({ email, password, options }));
          if (localStorage.getItem('__auth_test_require_confirmation') === 'true') {
            return { data: { user: { id: 'password-user', email }, session: null }, error: null };
          }
          const session = { user: { id: 'password-user', email } };
          localStorage.setItem('__auth_test_session', JSON.stringify(session));
          return { data: { session }, error: null };
        }
      },
      functions: {
        async invoke(name, { body }) {
          localStorage.setItem('__auth_test_signin', JSON.stringify({ name, ...body }));
          const signup = JSON.parse(localStorage.getItem('__auth_test_signup') || 'null');
          const validUsername = signup?.options?.data?.username;
          if (!signup || (body.username !== validUsername && body.username !== signup.email) ||
              body.password !== signup.password) {
            return { data: null, error: { message: 'Invalid username or password.' } };
          }
          return {
            data: {
              session: {
                user: {
                  id: 'password-user',
                  email: signup.email,
                  user_metadata: signup.options.data
                },
                access_token: 'mock-access-token',
                refresh_token: 'mock-refresh-token'
              }
            },
            error: null
          };
        }
      },
      from() {
        return {
          select() { return this; },
          update() { return this; },
          eq() { return this; },
          is() { return this; },
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
  assert.equal(await page.locator('#cloud-login-username').count(), 1, 'sign-in should show a username field');
  assert.equal(await page.locator('#cloud-email').count(), 0, 'sign-in should not require an email field');
  assert.equal(await page.locator('#cloud-otp-form').count(), 0, 'password auth should not show an OTP form');
  assert.equal(await page.locator('#cloud-signup').textContent(), 'Sign up', 'signup action should be clearly labelled');
  assert.match(await page.locator('.cloud-auth-description').textContent(), /sign in with your username and password/i);
  await page.locator('#cloud-signup').click();
  assert.match(await page.locator('.cloud-auth-description').textContent(),
    /first name, last name, username, email, and password/i);
  for (const field of ['#cloud-first-name', '#cloud-last-name', '#cloud-username']) {
    assert.equal(await page.locator(field).isVisible(), true, `${field} should be shown during signup`);
    assert.equal(await page.locator(field).getAttribute('required'), '', `${field} should be required`);
  }
  assert.equal(await page.locator('#cloud-create-account').textContent(), 'Create account');
  assert.equal(await page.locator('#cloud-back-to-signin').isVisible(), true, 'signup mode should offer a way back to sign in');
  await page.locator('#cloud-first-name').fill('Ada');
  await page.locator('#cloud-last-name').fill('Lovelace');
  await page.locator('#cloud-username').fill('ada_codes');
  await page.locator('#cloud-email').fill('person@gmail.com');
  await page.locator('#cloud-password').fill('password123');
  await page.locator('#cloud-back-to-signin').click();
  assert.equal(await page.locator('#cloud-login-username').inputValue(), 'person@gmail.com',
    'switching to sign-in should preserve the previous login identifier');
  assert.equal(await page.locator('#cloud-password').inputValue(), 'password123',
    'switching to sign-in should preserve password');
  await page.locator('#cloud-signup').click();
  assert.equal(await page.locator('#cloud-first-name').inputValue(), 'Ada',
    'switching back to signup should preserve first name');
  assert.equal(await page.locator('#cloud-last-name').inputValue(), 'Lovelace',
    'switching back to signup should preserve last name');
  assert.equal(await page.locator('#cloud-username').inputValue(), 'ada_codes',
    'switching back to signup should preserve username');
  await page.evaluate(() => localStorage.setItem('__auth_test_require_confirmation', 'true'));
  await page.locator('#cloud-create-account').click();
  await page.getByText(/Account creation still requires email confirmation/).waitFor();
  assert.equal(await page.locator('#cloud-otp-form').count(), 0, 'confirmation notice should not redirect users to OTP');
  assert.equal(await page.locator('#cloud-first-name').inputValue(), 'Ada', 'signup error should preserve first name');
  assert.equal(await page.locator('#cloud-last-name').inputValue(), 'Lovelace', 'signup error should preserve last name');
  assert.equal(await page.locator('#cloud-username').inputValue(), 'ada_codes', 'signup error should preserve username');
  await page.evaluate(() => localStorage.removeItem('__auth_test_require_confirmation'));
  await page.locator('#cloud-create-account').click();
  await page.waitForURL('**/index.html');
  assert.equal(await page.title(), 'Dashboard — Home', 'successful signup from a feature page should land on Home');
  assert.equal(await page.locator('#cloud-auth-root').count(), 0, 'successful signup should close the auth screen');
  const signup = await page.evaluate(() => JSON.parse(localStorage.getItem('__auth_test_signup')));
  assert.equal(signup.email, 'person@gmail.com');
  assert.equal(signup.password, 'password123');
  assert.deepEqual(signup.options.data, {
    first_name: 'Ada',
    last_name: 'Lovelace',
    full_name: 'Ada Lovelace',
    username: 'ada_codes'
  }, 'signup should store the name and username as Supabase user metadata');

  await page.locator('#cloud-account-control .cloud-signout').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#cloud-auth-form').count(), 1, 'sign-out should return to the password form');
  await page.locator('#cloud-login-username').fill('ada_codes');
  await page.locator('#cloud-password').fill('wrongpass');
  await page.locator('#cloud-auth-form').locator('button[type="submit"]').click();
  await page.getByText('Invalid username or password.').waitFor();
  assert.equal(await page.locator('#cloud-login-username').inputValue(), 'ada_codes',
    'failed username sign-in should preserve the entered username');
  await page.locator('#cloud-password').fill('password123');
  await page.locator('#cloud-auth-form').locator('button[type="submit"]').click();
  await page.locator('#cloud-account-control').waitFor();
  const signin = await page.evaluate(() => JSON.parse(localStorage.getItem('__auth_test_signin')));
  assert.equal(signin.name, 'sign-in-with-username');
  assert.equal(signin.username, 'ada_codes');
  assert.equal(signin.password, 'password123');

  await page.locator('#cloud-account-control .cloud-signout').click();
  await page.locator('#cloud-login-username').waitFor();
  await page.locator('#cloud-login-username').fill('person@gmail.com');
  await page.locator('#cloud-password').fill('password123');
  await page.locator('#cloud-auth-form').locator('button[type="submit"]').click();
  await page.locator('#cloud-account-control').waitFor();
  const legacySignin = await page.evaluate(() => JSON.parse(localStorage.getItem('__auth_test_signin')));
  assert.equal(legacySignin.username, 'person@gmail.com',
    'existing accounts should be able to use their email to sign in and add a username');

  await page.evaluate(() => localStorage.setItem('__auth_test_delay', '700'));
  await page.goto(`http://localhost:${port}/pages/tasks.html`);
  assert.equal(
    await page.locator('html').evaluate(element => element.classList.contains('cloud-locked')),
    false,
    'a returning user with a local cache should not have the page locked during cloud sync'
  );
  assert.equal(
    await page.locator('.cloud-loading-card').count(),
    0,
    'returning users should not see a restore overlay while switching pages'
  );
  assert.equal(await page.locator('#cloud-auth-root').count(), 0, 'cached navigation should not show an auth or restore screen');
  await page.locator('#cloud-account-control').waitFor();
  await page.evaluate(() => localStorage.removeItem('__auth_test_delay'));

  await page.locator('#cloud-account-control .cloud-signout').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#cloud-auth-root').count(), 1, 'signing out should return to the password screen');
  assert.equal(await page.locator('#cloud-signin').count(), 1);

  await page.goto(`http://localhost:${port}/pages/notes.html?new=1`);
  await page.locator('#cloud-login-username').fill('ada_codes');
  await page.locator('#cloud-password').fill('password123');
  await page.locator('#cloud-auth-form').locator('button[type="submit"]').click();
  await page.locator('#noteFormPanel.is-visible').waitFor();
  assert.equal(await page.title(), 'Dashboard — Notes', 'sign-in from the Home Quick Note flow should return to Notes');
  assert.equal(await page.locator('#noteTitle').isVisible(), true, 'sign-in should reveal the requested new note form');

  console.log('Auth tests passed: password signup, email-confirmation guidance, username sign-in, invalid-credential feedback, Home landing, returning-user navigation, and the new-note return route.');
} finally {
  if (browser) await browser.close();
  server.kill();
}

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
        async signInWithOtp({ email, options }) {
          localStorage.setItem('__auth_test_otp_request', JSON.stringify({ email, options }));
          const count = Number(localStorage.getItem('__auth_test_otp_count') || 0) + 1;
          localStorage.setItem('__auth_test_otp_count', String(count));
          return { data: { user: null, session: null }, error: null };
        },
        async verifyOtp({ email, token, type }) {
          localStorage.setItem('__auth_test_otp_verify', JSON.stringify({ email, token, type }));
          if (token !== '123456') {
            return { data: { session: null }, error: { message: 'Invalid OTP' } };
          }
          const session = { user: { id: 'otp-user', email } };
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

  assert.equal(await page.locator('#cloud-password').count(), 0, 'OTP sign-in should not ask for a password');
  await page.locator('#cloud-email').fill('person@gmail.com');
  await page.locator('#cloud-send-code').click();
  await page.getByRole('heading', { name: 'Enter your code' }).waitFor();
  const request = await page.evaluate(() => JSON.parse(localStorage.getItem('__auth_test_otp_request')));
  assert.equal(request.email, 'person@gmail.com');
  assert.equal(request.options.shouldCreateUser, true, 'OTP sign-in should support new and existing accounts');
  assert.equal(await page.locator('#cloud-otp').getAttribute('autocomplete'), 'one-time-code');
  assert.equal(await page.locator('.cloud-inbox-link').count(), 0, 'OTP flow should not direct users to an email link');

  await page.locator('#cloud-otp').fill('12x345678');
  assert.equal(await page.locator('#cloud-otp').inputValue(), '123456', 'OTP input should keep six numeric digits');
  await page.locator('#cloud-otp').fill('000000');
  await page.locator('#cloud-verify-code').click();
  await page.getByText('Invalid OTP').waitFor();
  assert.equal(await page.locator('#cloud-otp-form').count(), 1, 'invalid OTP should leave the user on the code screen');

  await page.locator('#cloud-resend-code').click();
  await page.getByText('A new code was sent. Check your inbox and spam folder.').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('__auth_test_otp_count')), '2');

  await page.locator('#cloud-otp').fill('123456');
  await page.locator('#cloud-verify-code').click();
  await page.waitForURL('**/index.html');
  assert.equal(await page.title(), 'Dashboard — Home', 'successful OTP verification from a feature page should land on Home');
  assert.equal(await page.locator('#cloud-auth-root').count(), 0, 'successful OTP verification should close the auth screen');
  const verification = await page.evaluate(() => JSON.parse(localStorage.getItem('__auth_test_otp_verify')));
  assert.equal(verification.email, 'person@gmail.com');
  assert.equal(verification.token, '123456');
  assert.equal(verification.type, 'email');

  await page.evaluate(() => localStorage.setItem('__auth_test_delay', '700'));
  await page.goto(`http://localhost:${port}/pages/tasks.html`);
  assert.equal(
    await page.locator('html').evaluate(element => element.classList.contains('cloud-locked')),
    false,
    'known signed-in users should not have the page hidden while cloud sync restores'
  );
  assert.equal(
    await page.locator('#cloud-auth-root').count(),
    0,
    'known signed-in users should not see the connecting/login overlay during page navigation'
  );
  await page.locator('#cloud-account-control').waitFor();
  await page.evaluate(() => localStorage.removeItem('__auth_test_delay'));

  await page.locator('#cloud-account-control .cloud-signout').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#cloud-auth-root').count(), 1, 'signing out should return to the email code screen');
  assert.equal(await page.locator('#cloud-send-code').count(), 1);

  console.log('Auth tests passed: OTP request, resend, invalid-code feedback, verification, new-account option, Home landing, and returning-user navigation.');
} finally {
  if (browser) await browser.close();
  server.kill();
}

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
    return {
      auth: {
        async getSession() {
          return {
            data: { session: JSON.parse(localStorage.getItem('__auth_test_session') || 'null') },
            error: null
          };
        },
        onAuthStateChange() {},
        async signUp({ options }) {
          localStorage.setItem('__auth_test_redirect', options.emailRedirectTo);
          return { data: { session: null }, error: null };
        },
        async signInWithPassword({ email }) {
          if (email === 'confirmed@gmail.com') {
            const session = { user: { id: 'confirmed-user', email } };
            localStorage.setItem('__auth_test_session', JSON.stringify(session));
            return {
              data: { session },
              error: null
            };
          }
          return { data: { session: null }, error: { message: 'Email not confirmed' } };
        }
      },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
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

  await page.locator('#cloud-email').fill('test@gmail.com');
  await page.locator('#cloud-password').fill('test-password-123');
  await page.locator('#cloud-signup').click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('__auth_test_redirect')),
    `http://localhost:${port}/index.html`,
    'email confirmation should return to Home'
  );

  const signupLink = await page.locator('.cloud-inbox-link').evaluate(anchor => ({
    href: anchor.href,
    text: anchor.textContent,
    target: anchor.target,
    rel: anchor.rel
  }));
  assert.equal(signupLink.href, 'https://mail.google.com/');
  assert.equal(signupLink.text, 'Open Gmail');
  assert.equal(signupLink.target, '_blank');
  assert.match(signupLink.rel, /noopener/);

  await page.locator('#cloud-back-to-signin').click();
  assert.equal(await page.locator('#cloud-email').inputValue(), 'test@gmail.com');
  await page.locator('#cloud-signin').click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  assert.match(await page.locator('.cloud-auth-message').textContent(), /still needs email confirmation/i);
  assert.equal(await page.locator('.cloud-inbox-link').getAttribute('href'), 'https://mail.google.com/');

  await page.locator('#cloud-back-to-signin').click();
  const providerCases = [
    ['person@outlook.com', 'https://outlook.live.com/mail/'],
    ['person@yahoo.com', 'https://mail.yahoo.com/'],
    ['person@icloud.com', 'https://www.icloud.com/mail/'],
    ['person@proton.me', 'https://mail.proton.me/']
  ];
  for (const [email, expectedUrl] of providerCases) {
    await page.locator('#cloud-email').fill(email);
    await page.locator('#cloud-password').fill('test-password-123');
    await page.locator('#cloud-signup').click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    assert.equal(await page.locator('.cloud-inbox-link').getAttribute('href'), expectedUrl);
    await page.locator('#cloud-back-to-signin').click();
  }

  await page.locator('#cloud-email').fill('person@company.example');
  await page.locator('#cloud-signup').click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  assert.equal(await page.locator('.cloud-inbox-help').count(), 1);
  assert.equal(await page.locator('.cloud-inbox-link').count(), 0, 'unknown providers must not receive a guessed link');

  await page.locator('#cloud-back-to-signin').click();
  await page.locator('#cloud-email').fill('confirmed@gmail.com');
  await page.locator('#cloud-password').fill('test-password-123');
  await page.locator('#cloud-signin').click();
  await page.waitForURL('**/index.html');
  assert.equal(await page.title(), 'Dashboard — Home', 'successful sign-in from a feature page should land on Home');
  assert.equal(await page.locator('#cloud-auth-root').count(), 0, 'authenticated Home should not show the login screen');

  console.log('Auth tests passed: confirmation inbox links, unconfirmed sign-in, remembered email, provider fallback, and Home landing after sign-in.');
} finally {
  if (browser) await browser.close();
  server.kill();
}

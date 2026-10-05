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
        async updateUser(attributes) {
          // Supabase takes a plain "password" key for a credential change and a
          // "data" key for user_metadata. cloud.js uses both shapes, so the stub
          // must read attributes.password rather than attributes.data.password.
          if (attributes && typeof attributes.password === 'string') {
            localStorage.setItem('__account_password', attributes.password);
            localStorage.setItem('__account_password_update_count',
              String(Number(localStorage.getItem('__account_password_update_count') || 0) + 1));
            const session = JSON.parse(localStorage.getItem('__account_session'));
            return { data: { user: session.user }, error: null };
          }
          const data = attributes && attributes.data;
          const session = JSON.parse(localStorage.getItem('__account_session'));
          session.user.user_metadata = { ...session.user.user_metadata, ...data };
          localStorage.setItem('__account_session', JSON.stringify(session));
          localStorage.setItem('__account_profile_update', JSON.stringify(data));
          return { data: { user: session.user }, error: null };
        },
        async setSession(nextSession) {
          localStorage.setItem('__account_session', JSON.stringify(nextSession));
          return { data: { session: nextSession }, error: null };
        },
        async signOut() {
          localStorage.removeItem('__account_session');
          if (authStateChange) authStateChange('SIGNED_OUT', null);
          return { error: null };
        }
      },
      functions: {
        async invoke(name, options) {
          if (name === 'sign-in-with-username') {
            const session = JSON.parse(localStorage.getItem('__account_session'));
            const validPassword = localStorage.getItem('__account_password') || 'old-password1';
            if (options.body.password !== validPassword) {
              return { data: null, error: { message: 'Invalid username or password.' } };
            }
            return {
              data: { session: { ...session, access_token: 'verified-access', refresh_token: 'verified-refresh' } },
              error: null
            };
          }
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

  // ---- Regression: the account row must never blink out on page switches ----
  // addAccountControl() used to run only after the record fetch resolved, so the
  // sidebar showed an empty slot for a second or two on every navigation.
  //
  // The invariant is "painted before the fetch resolves", so the stub flags when
  // the slow fetch is in flight and the assertion runs at that moment. An earlier
  // version slept a fixed 120ms after navigation and asserted; that raced script
  // execution and failed roughly one run in four on a loaded machine.
  const slowContext = await browser.newContext();
  await slowContext.addInitScript(({ initialSession }) => {
    localStorage.setItem('__account_session', JSON.stringify(initialSession));
    localStorage.setItem('dashly_cloud_user_id', initialSession.user.id);
    localStorage.setItem('dashly-theme', 'light');
  }, { initialSession: session });
  await slowContext.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: supabaseStub.replace('const SLOW_FETCH', 'true').replace(
        "then(resolve, reject) {",
        "then(resolve, reject) { window.__fetchPending = true; return new Promise(r => setTimeout(r, 1200)).then(() => { window.__fetchPending = false; return resolve({ data: [], error: null }); });"
      )
    })
  );
  const slowPage = await slowContext.newPage();
  await slowPage.setViewportSize({ width: 1280, height: 800 });
  for (const slowPath of ['/index.html', '/pages/tasks.html', '/pages/goals.html']) {
    await slowPage.goto(`http://localhost:${port}${slowPath}`, { waitUntil: 'commit' });
    // Wait until the record fetch is genuinely in flight. That is the only moment
    // where "the row is already on screen" is a meaningful claim.
    await slowPage.waitForFunction(() => window.__fetchPending === true, null, { timeout: 15000 });
    const early = await slowPage.evaluate(() => {
      const control = document.getElementById('cloud-account-control');
      const button = control && control.querySelector('.cloud-signout');
      const bounds = control ? control.getBoundingClientRect() : null;
      return {
        present: !!control,
        visible: !!(bounds && bounds.height > 0),
        signoutDisabled: button ? button.disabled : null
      };
    });
    assert.ok(early.present && early.visible,
      `the account row should already be painted while the fetch is in flight on ${slowPath} (got ${JSON.stringify(early)})`);
    assert.equal(early.signoutDisabled, true,
      'the cached-paint sign-out button must be disabled until the session is confirmed');
  }
  await slowPage.waitForSelector('#cloud-account-control .cloud-account-username:text("ada_codes")', { timeout: 15000 });
  await slowPage.waitForSelector('#cloud-account-control .cloud-signout:not([disabled])', { timeout: 15000 });
  await slowContext.close();

  const context = await browser.newContext();
  await context.addInitScript(({ initialSession }) => {
    if (sessionStorage.getItem('__account_seeded')) return;
    localStorage.setItem('__account_session', JSON.stringify(initialSession));
    localStorage.setItem('dashly_cloud_user_id', initialSession.user.id);
    localStorage.setItem('dashly-theme', 'light');
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
  // The row is painted from cache first and replaced once the session resolves,
  // so waiting on visibility alone can catch the placeholder. Wait for the live
  // username, and for sign-out to be enabled, before asserting on either.
  await profilePage.locator('#cloud-account-control .cloud-account-username')
    .filter({ hasText: 'ada_codes' }).waitFor();
  await profilePage.locator('#cloud-account-control .cloud-signout:not([disabled])').waitFor();
  await profilePage.setViewportSize({ width: 320, height: 568 });
  await profilePage.locator('.tab-more').click();
  // The drawer slides in over a 0.3s transform transition. Measuring before it
  // settles catches the button mid-flight, still off-canvas at translateX(-100%).
  await profilePage.waitForTimeout(400);
  assert.equal(await profilePage.locator('#cloud-account-control .cloud-settings-open').count(), 0,
    'the account panel should not show a Settings hyperlink');
  assert.equal(await profilePage.locator('#cloud-account-control a').count(), 0,
    'the account panel should contain no links; Settings lives in the sidebar nav');
  assert.equal(await profilePage.locator('#cloud-account-control .cloud-account-username').textContent(), 'ada_codes',
    'the account username should be displayed beside the avatar');
  await profilePage.locator('.sidebar-nav a[href="settings.html"]').waitFor({ state: 'visible' });
  await profilePage.setViewportSize({ width: 320, height: 360 });
  await profilePage.locator('.sidebar-nav').evaluate(nav => {
    for (let index = 0; index < 12; index++) {
      const link = document.createElement('a');
      link.href = '#overflow-test-' + index;
      link.textContent = 'Extra navigation item ' + (index + 1);
      nav.appendChild(link);
    }
  });
  const nav = profilePage.locator('.sidebar-nav');
  const accountControl = profilePage.locator('#cloud-account-control');
  const accountPositionBeforeScroll = await accountControl.evaluate(control => {
    const bounds = control.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, scrollHeight: control.scrollHeight };
  });
  const navScrollMetrics = await nav.evaluate(element => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    sidebarOverflow: getComputedStyle(element.parentElement).overflow
  }));
  assert.ok(navScrollMetrics.scrollHeight > navScrollMetrics.clientHeight,
    'the sidebar navigation should have its own scrollable area when content is long');
  assert.equal(navScrollMetrics.sidebarOverflow, 'hidden',
    'the sidebar shell should not become a scrolling container');
  await nav.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const accountPositionAfterScroll = await accountControl.evaluate(control => {
    const bounds = control.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  });
  assert.deepEqual(accountPositionAfterScroll, {
    top: accountPositionBeforeScroll.top,
    bottom: accountPositionBeforeScroll.bottom
  }, 'the account icon and sign-out control should remain fixed while navigation scrolls');
  assert.equal(await nav.evaluate(element => element.scrollTop > 0), true,
    'the navigation list should scroll independently of the account controls');

  // A short viewport is where "fixed" is actually load-bearing: the logo, theme
  // toggle and account control are all non-shrinking rows in one 100dvh column,
  // so past a certain height the account control is the row that gets pushed off
  // the bottom and clipped by the sidebar's overflow:hidden. Assert it survives.
  for (const height of [300, 240, 180, 140]) {
    await profilePage.setViewportSize({ width: 320, height });
    await profilePage.locator('.sidebar-nav').evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    const visible = await accountControl.evaluate(control => {
      const bounds = control.getBoundingClientRect();
      const icon = control.querySelector('.cloud-account-icon').getBoundingClientRect();
      const button = control.querySelector('.cloud-signout').getBoundingClientRect();
      return {
        fits: bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1,
        iconVisible: icon.height > 0 && icon.top >= 0 && icon.bottom <= window.innerHeight + 1,
        buttonVisible: button.height > 0 && button.top >= 0 && button.bottom <= window.innerHeight + 1
      };
    });
    assert.ok(visible.fits && visible.iconVisible && visible.buttonVisible,
      `the account icon and sign-out should stay visible at ${height}px tall (got ${JSON.stringify(visible)})`);
  }

  // The drawer ends at 100dvh and the tab bar is fixed across the bottom, so the
  // account row — the drawer's last row — used to sit underneath the tab bar and
  // get clipped. Worst on a notched phone, where env(safe-area-inset-bottom) makes
  // the bar taller and eats 55px of a 62px row. Force the inset, because desktop
  // emulation reports 0 and would hide the bug.
  for (const [width, height] of [[390, 844], [375, 812], [320, 568]]) {
    await profilePage.setViewportSize({ width, height });
    await profilePage.evaluate(() => {
      document.documentElement.style.setProperty('--app-safe-bottom', '34px');
    });
    const drawer = await accountControl.evaluate(row => {
      const control = row.getBoundingClientRect();
      const tab = document.querySelector('.tab-bar').getBoundingClientRect();
      const button = row.querySelector('.cloud-signout').getBoundingClientRect();
      const icon = row.querySelector('.cloud-account-icon').getBoundingClientRect();
      // Hit-test the bottom edge of the button, where a user's thumb lands.
      const hit = document.elementFromPoint(button.left + button.width / 2, button.bottom - 4);
      return {
        overlap: Math.round(Math.max(0, control.bottom - tab.top)),
        iconClear: icon.bottom <= tab.top + 1,
        buttonReachable: !!(hit && hit.closest('.cloud-signout'))
      };
    });
    assert.equal(drawer.overlap, 0,
      `the account row must clear the tab bar at ${width}x${height} (overlap ${drawer.overlap}px)`);
    assert.ok(drawer.iconClear && drawer.buttonReachable,
      `the avatar and Sign out must be fully usable at ${width}x${height} (got ${JSON.stringify(drawer)})`);
  }
  await profilePage.evaluate(() => {
    document.documentElement.style.removeProperty('--app-safe-bottom');
  });

  await nav.evaluate(element => { element.scrollTop = 0; });
  await profilePage.setViewportSize({ width: 320, height: 568 });
  const signOutButtonStyle = await profilePage.locator('.cloud-signout').evaluate(button => {
    const bounds = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      width: bounds.width,
      height: bounds.height,
      borderStyle: style.borderTopStyle,
      background: style.backgroundColor
    };
  });
  assert.ok(signOutButtonStyle.width >= 44 && signOutButtonStyle.height >= 44,
    'mobile sign-out action should have a button-sized touch target');
  assert.equal(signOutButtonStyle.borderStyle, 'solid',
    'sidebar sign-out action should have a visible button border');
  const accountSummary = profilePage.locator('#cloud-account-control .cloud-account-summary');
  // The email moved to the Account settings page. Assert it is gone from the
  // sidebar entirely rather than merely hidden, so a stray tooltip cannot
  // reappear later.
  assert.equal(await profilePage.locator('#cloud-account-control .cloud-account-email').count(), 0,
    'the account email should no longer exist in the sidebar control');

  // The avatar row is display-only. Assert on every way it could have become a
  // target: an anchor, a tabindex stop, or a fake-button role. Any of those
  // would put a dead control in front of the user.
  assert.equal(await accountSummary.evaluate(node => node.tagName), 'SPAN',
    'the account icon row should be a plain span, not a link');
  assert.equal(await accountSummary.getAttribute('href'), null,
    'the account icon row must not carry an href');
  assert.equal(await accountSummary.getAttribute('tabindex'), null,
    'the account icon row must stay out of the tab order');
  assert.equal(await accountSummary.evaluate(node => node.getAttribute('role')), null,
    'the account icon row must not be given a link or button role');
  assert.equal(await profilePage.locator('#cloud-account-control a').count(), 0,
    'the account panel should contain no links at all');
  assert.equal(await profilePage.locator('#cloud-account-control .cloud-signout').count(), 1,
    'sign-out should remain the only interactive control in the panel');

  // Clicking the row must do nothing: no navigation, no drawer dismissal.
  const urlBefore = profilePage.url();
  await accountSummary.click({ force: true });
  await profilePage.waitForTimeout(300);
  assert.equal(profilePage.url(), urlBefore,
    'clicking the account icon must not navigate anywhere');

  // Settings is still reachable, via the sidebar nav rather than the avatar. The
  // drawer is open at this point, so the nav link is on canvas.
  await profilePage.locator('.sidebar-nav a[href="settings.html"]').click();
  await profilePage.waitForURL('**/pages/settings.html');
  await profilePage.locator('#cloud-account-settings').waitFor();
  assert.equal(await profilePage.locator('.cloud-settings-email').textContent(), 'ada@example.com',
    'the account email should be shown on the settings page');

  // The panel must stay link-free on the root page too, not just inside /pages/.
  await profilePage.goto(`http://localhost:${port}/index.html`);
  await profilePage.locator('#cloud-account-control').waitFor();
  await profilePage.setViewportSize({ width: 320, height: 568 });
  assert.equal(await profilePage.locator('#cloud-account-control a').count(), 0,
    'the account panel should contain no links on the home page either');
  // The theme toggle is hidden in the drawer at this width, so the rest of the
  // suite flips themes from the app bar's toggle instead. The goto above
  // reloaded the page, which also closed the drawer, so the app bar is clickable.
  const themeToggle = profilePage.locator('.theme-toggle--mobile');
  const sidebarAccountIcon = profilePage.locator('#cloud-account-control .cloud-account-icon');
  assert.match(await sidebarAccountIcon.getAttribute('src'), /account-icon\.svg$/,
    'the sidebar account panel should use the light-mode account icon');
  await sidebarAccountIcon.evaluate(icon => icon.decode());
  await themeToggle.click();
  assert.match(await sidebarAccountIcon.getAttribute('src'), /account-icon-dark\.svg$/,
    'the sidebar account icon should switch immediately when dark mode is selected');
  await sidebarAccountIcon.evaluate(icon => icon.decode());
  await themeToggle.click();
  assert.match(await sidebarAccountIcon.getAttribute('src'), /account-icon\.svg$/,
    'the sidebar account icon should switch immediately when light mode is selected');

  // Reach the settings page from the nav. Matched with $= because this runs on
  // the home page, where the href is "pages/settings.html", while the same link
  // inside /pages/ is just "settings.html".
  await profilePage.locator('.tab-more').click();
  await profilePage.waitForTimeout(400);
  await profilePage.locator('.sidebar-nav a[href$="settings.html"]').click();
  await profilePage.waitForURL('**/pages/settings.html');
  await profilePage.locator('#cloud-account-settings').waitFor();
  await profilePage.setViewportSize({ width: 375, height: 812 });
  const settingsAccountIcon = profilePage.locator('#cloud-settings-title').locator('xpath=../..').locator('.cloud-account-icon');
  assert.match(await settingsAccountIcon.getAttribute('src'), /account-icon\.svg$/,
    'the Settings page should use the light-mode account icon');
  await settingsAccountIcon.evaluate(icon => icon.decode());
  await themeToggle.click();
  assert.match(await settingsAccountIcon.getAttribute('src'), /account-icon-dark\.svg$/,
    'the Settings page account icon should switch immediately when dark mode is selected');
  await settingsAccountIcon.evaluate(icon => icon.decode());
  await themeToggle.click();
  assert.match(await settingsAccountIcon.getAttribute('src'), /account-icon\.svg$/,
    'the Settings page account icon should switch immediately when light mode is selected');
  const settingsBounds = await profilePage.locator('.cloud-settings-page').evaluate(settings => {
    const bounds = settings.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, viewportWidth: window.innerWidth };
  });
  assert.ok(settingsBounds.left >= 0 && settingsBounds.right <= settingsBounds.viewportWidth,
    'account settings page should fit a narrow mobile viewport');
  assert.equal(await profilePage.title(), 'Dashboard — Account settings');
  // "Spans the available width" means the width of its container's content box,
  // not the viewport. Measuring against the viewport counts the page padding and
  // the section's own padding, which no child button can ever occupy.
  const settingsSignOutBounds = await profilePage.locator('.cloud-settings-switch').evaluate(button => {
    const bounds = button.getBoundingClientRect();
    const parent = button.parentElement.getBoundingClientRect();
    const parentStyle = getComputedStyle(button.parentElement);
    // getBoundingClientRect is border-box, and the button can only ever occupy
    // the container's content box, so borders must come off as well as padding.
    const available = parent.width
      - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight)
      - parseFloat(parentStyle.borderLeftWidth) - parseFloat(parentStyle.borderRightWidth);
    return { width: bounds.width, height: bounds.height, available };
  });
  assert.ok(settingsSignOutBounds.width >= settingsSignOutBounds.available - 1,
    `the Settings-page sign-out button should span its container (${settingsSignOutBounds.width} vs ${settingsSignOutBounds.available})`);
  assert.ok(settingsSignOutBounds.height >= 44,
    'the Settings-page sign-out button should meet the mobile touch-target size');
  assert.equal(await profilePage.locator('#cloud-settings-first-name').inputValue(), 'Ada');
  assert.equal(await profilePage.locator('#cloud-settings-last-name').inputValue(), 'Lovelace');
  assert.equal(await profilePage.locator('#cloud-settings-username').inputValue(), 'ada_codes');
  await profilePage.locator('#cloud-settings-first-name').fill('Grace');
  await profilePage.locator('#cloud-settings-last-name').fill('Hopper');
  await profilePage.locator('#cloud-settings-username').fill('grace_codes');
  await profilePage.locator('.cloud-profile-form').locator('button[type="submit"]').click();
  await profilePage.getByText('Name saved.').waitFor();
  assert.equal(await profilePage.locator('#cloud-account-control .cloud-account-username').textContent(), 'grace_codes',
    'the sidebar username should update after saving a profile change');
  const savedProfile = await profilePage.evaluate(() =>
    JSON.parse(localStorage.getItem('__account_profile_update'))
  );
  assert.deepEqual(savedProfile, {
    first_name: 'Grace',
    last_name: 'Hopper',
    full_name: 'Grace Hopper',
    username: 'grace_codes'
  }, 'profile updates should save names and preserve other user metadata');

  await profilePage.locator('#cloud-current-password').fill('incorrect-password');
  await profilePage.locator('#cloud-new-password').fill('new-password123');
  await profilePage.locator('#cloud-confirm-password').fill('new-password123');
  await profilePage.locator('.cloud-password-form').locator('button[type="submit"]').click();
  await profilePage.getByText('Invalid username or password.').waitFor();
  assert.equal(await profilePage.evaluate(() => localStorage.getItem('__account_password_update_count')), null,
  'an incorrect current password must not update the account password');

  await profilePage.locator('#cloud-current-password').fill('old-password1');
  await profilePage.locator('.cloud-password-form').locator('button[type="submit"]').click();
  await profilePage.getByText('Password changed.').waitFor();
  assert.equal(await profilePage.evaluate(() => localStorage.getItem('__account_password')), 'new-password123',
  'a verified current password should allow changing the account password');
  assert.equal(await profilePage.locator('#cloud-current-password').inputValue(), '',
  'password fields should clear after a successful password change');

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
  await deletePage.goto(`http://localhost:${port}/pages/settings.html`);
  await deletePage.locator('#cloud-account-control').waitFor();
  await deletePage.locator('#cloud-account-settings').waitFor();
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

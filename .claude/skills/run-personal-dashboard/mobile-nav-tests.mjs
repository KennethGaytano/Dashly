#!/usr/bin/env node
/**
 * Mobile navigation behaviour checks for the app bar / tab bar / drawer.
 *
 * The audit scripts only measure geometry. This drives the new chrome the way
 * a thumb would: open the drawer from More, dismiss it three different ways,
 * confirm Escape and focus restore still behave, and check the active tab and
 * aria-current agree on every page.
 *
 * Usage: node mobile-nav-tests.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const BASE = `http://localhost:${PORT}`;
const SHOTS = join(__dirname, 'screenshots');

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const server = spawn('node', [join(__dirname, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const isOpen = () => page.evaluate(() => document.body.classList.contains('nav-open'));

// --- The tab bar exists and is the right height ---
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(400);

console.log('\n--- Tab bar ---');
const bar = await page.evaluate(() => {
  const b = document.querySelector('.tab-bar');
  const r = b.getBoundingClientRect();
  const cs = getComputedStyle(b);
  return {
    display: cs.display,
    height: Math.round(r.height),
    bottom: Math.round(r.bottom),
    viewportH: window.innerHeight,
    tabs: b.querySelectorAll('.tab').length,
    activeCount: b.querySelectorAll('.tab.is-active').length,
    currentCount: b.querySelectorAll('[aria-current="page"]').length
  };
});
assert(bar.display === 'flex', `tab bar is displayed on mobile (${bar.display})`);
assert(bar.tabs === 5, `tab bar has 5 tabs (${bar.tabs})`);
assert(bar.height >= 44, `tab bar is at least 44px tall (${bar.height}px)`);
assert(Math.abs(bar.bottom - bar.viewportH) <= 1, `tab bar sits flush to the bottom edge (${bar.bottom} vs ${bar.viewportH})`);
assert(bar.activeCount === 1, `exactly one tab is marked active (${bar.activeCount})`);
assert(bar.currentCount === 1, `exactly one element carries aria-current (${bar.currentCount})`);

console.log('\n--- App bar ---');
const appBar = await page.evaluate(() => {
  const b = document.querySelector('.app-bar');
  const r = b.getBoundingClientRect();
  return { display: getComputedStyle(b).display, height: Math.round(r.height), title: b.querySelector('.app-bar-title').textContent.trim() };
});
assert(appBar.display === 'flex', `app bar is displayed (${appBar.display})`);
assert(appBar.title === 'Home', `app bar names the current page ("${appBar.title}")`);
assert(appBar.height >= 44, `app bar is at least 44px tall (${appBar.height}px)`);

console.log('\n--- Drawer opens from More ---');
await page.click('.tab-more');
await page.waitForTimeout(400);
assert(await isOpen(), 'body.nav-open is set after tapping More');
assert(await page.getAttribute('.tab-more', 'aria-expanded') === 'true', 'More reports aria-expanded="true"');
const focusInDrawer = await page.evaluate(() => !!document.activeElement.closest('aside'));
assert(focusInDrawer, 'focus moved into the drawer');
await page.screenshot({ path: join(SHOTS, 'nav-drawer-open.png') });

console.log('\n--- Escape closes and restores focus ---');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
assert(!(await isOpen()), 'Escape closes the drawer');
assert(await page.getAttribute('.tab-more', 'aria-expanded') === 'false', 'More reports aria-expanded="false" after close');
const restored = await page.evaluate(() => document.activeElement.classList.contains('tab-more'));
assert(restored, 'focus returned to the More tab');

console.log('\n--- Scrim click closes ---');
await page.click('.tab-more');
await page.waitForTimeout(350);
await page.click('.nav-scrim', { position: { x: 370, y: 400 } });
await page.waitForTimeout(400);
assert(!(await isOpen()), 'tapping the scrim closes the drawer');

console.log('\n--- Tapping a drawer link navigates and closes ---');
await page.click('.tab-more');
await page.waitForTimeout(350);
// Suffix match: from index.html the sidebar href is "pages/goals.html",
// but from pages/*.html it is "goals.html".
await page.click('.sidebar-nav a[href$="goals.html"]');
await page.waitForTimeout(600);
assert(page.url().endsWith('goals.html'), 'drawer link navigates to Goals');
assert(!(await isOpen()), 'drawer is closed after navigating');

console.log('\n--- Goals marks More as the active tab ---');
const goalsTab = await page.evaluate(() => {
  const active = document.querySelector('.tab-bar .is-active');
  return { label: active?.querySelector('.tab-label')?.textContent.trim(), hasCurrent: active?.getAttribute('aria-current') === 'page' };
});
assert(goalsTab.label === 'More', `active tab on Goals is More ("${goalsTab.label}")`);
assert(goalsTab.hasCurrent, 'More carries aria-current="page" on Goals');

console.log('\n--- Every page marks exactly one destination ---');
for (const p of ['index.html', 'pages/tasks.html', 'pages/calendar.html', 'pages/notes.html', 'pages/progress.html', 'pages/goals.html', 'pages/settings.html']) {
  await page.goto(`${BASE}/${p}`);
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const bar = document.querySelector('.tab-bar');
    const tabs = [...bar.querySelectorAll('.tab')];
    const active = bar.querySelector('.is-active');
    const last = tabs[tabs.length - 1]?.getBoundingClientRect();
    return {
      // Regression guard: the More button must carry the .tab class too, or it
      // loses .tab's flex sizing and its label is pushed off the right edge.
      tabCount: tabs.length,
      moreHasTabClass: !!bar.querySelector('.tab-more.tab'),
      moreLast: !!last,
      moreRight: last ? Math.round(last.right) : null,
      client: document.documentElement.clientWidth,
      activeIsTab: !!active && active.classList.contains('tab'),
      count: bar.querySelectorAll('.is-active').length,
      current: bar.querySelectorAll('[aria-current="page"]').length,
      sidebarCurrent: document.querySelectorAll('.sidebar-nav [aria-current="page"]').length,
      label: active?.querySelector('.tab-label')?.textContent.trim()
    };
  });
  assert(state.tabCount === 5, `${p}: 5 tabs (${state.tabCount})`);
  assert(state.moreHasTabClass, `${p}: More button carries the .tab class`);
  assert(state.moreLast && state.moreRight <= state.client, `${p}: More tab sits inside the viewport (${state.moreRight} <= ${state.client})`);
  assert(state.activeIsTab, `${p}: the active destination is a .tab`);
  assert(state.count === 1 && state.current === 1 && state.sidebarCurrent === 1,
    `${p}: one active tab ("${state.label}"), tab+sidebar aria-current agree`);
}

console.log('\n--- Desktop hides the mobile chrome ---');
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(300);
const desktop = await page.evaluate(() => ({
  appBar: getComputedStyle(document.querySelector('.app-bar')).display,
  tabBar: getComputedStyle(document.querySelector('.tab-bar')).display,
  bodyDir: getComputedStyle(document.body).flexDirection
}));
assert(desktop.appBar === 'none', `app bar hidden on desktop (${desktop.appBar})`);
assert(desktop.tabBar === 'none', `tab bar hidden on desktop (${desktop.tabBar})`);
assert(desktop.bodyDir === 'row', `body is a row on desktop, not stacked (${desktop.bodyDir})`);

console.log('\n--- Scrollbar appears only during scroll activity ---');
await page.evaluate(() => {
  document.body.style.minHeight = '200vh';
  window.scrollTo(0, 0);
  document.documentElement.classList.remove('is-scrolling');
});
await page.waitForTimeout(100);
const scrollbarIdle = await page.evaluate(() => ({
  active: document.documentElement.classList.contains('is-scrolling'),
  color: getComputedStyle(document.documentElement).scrollbarColor,
  thumb: getComputedStyle(document.documentElement, '::-webkit-scrollbar-thumb').backgroundColor
}));
assert(!scrollbarIdle.active, 'scrollbar starts hidden at rest');
assert(scrollbarIdle.color.includes('rgba(0, 0, 0, 0)') || scrollbarIdle.color.includes('transparent'),
  `standards scrollbar thumb is transparent at rest (${scrollbarIdle.color})`);
assert(scrollbarIdle.thumb === 'rgba(0, 0, 0, 0)',
  `WebKit scrollbar thumb is transparent at rest (${scrollbarIdle.thumb})`);
await page.evaluate(() => window.scrollTo(0, 100));
await page.waitForFunction(() => document.documentElement.classList.contains('is-scrolling'));
const scrollbarActive = await page.evaluate(() => ({
  color: getComputedStyle(document.documentElement).scrollbarColor,
  thumb: getComputedStyle(document.documentElement, '::-webkit-scrollbar-thumb').backgroundColor
}));
assert(scrollbarActive.color.includes('rgb('), `standards scrollbar appears during scrolling (${scrollbarActive.color})`);
assert(scrollbarActive.thumb !== 'rgba(0, 0, 0, 0)',
  `WebKit scrollbar appears during scrolling (${scrollbarActive.thumb})`);
await page.waitForFunction(() => !document.documentElement.classList.contains('is-scrolling'), { timeout: 2500 });
assert(true, 'scrollbar fades back to hidden after scrolling stops');

assert(errors.length === 0, `no page errors (${errors.length ? errors.join('; ') : 'none'})`);

await browser.close();
server.kill();
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);

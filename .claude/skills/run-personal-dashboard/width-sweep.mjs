#!/usr/bin/env node
/**
 * Tab bar width sweep.
 *
 * A `position: fixed` bar sizes to the LAYOUT viewport, not the visual one, so
 * whenever a page overflows horizontally the tab bar is stretched to the wider
 * box and its last tab runs off the right edge of the screen. mobile-audit.mjs
 * catches this at six widths; this sweeps many more, including the common
 * phone widths it skipped, and reports which page/width pairs are broken.
 *
 * Usage: node width-sweep.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const WIDTHS = [320, 360, 375, 390, 393, 412, 414, 430, 480, 540, 600, 640, 667, 700, 740, 768];
const PAGES = [
  ['home', 'index.html'],
  ['tasks', 'pages/tasks.html'],
  ['cal', 'pages/calendar.html'],
  ['notes', 'pages/notes.html'],
  ['prog', 'pages/progress.html'],
  ['goals', 'pages/goals.html']
];

// Set SHOT=1 to also capture the widest-content states as viewport PNGs.
const SHOT = process.env.SHOT === '1';
const SHOTS = join(__dirname, 'screenshots');

const server = spawn('node', [join(__dirname, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

// Seed pathological content: long UNBROKEN tokens with no spaces. Real data
// gets URLs and references pasted into titles, and none of the title elements
// carry overflow-wrap, so a single long token can force a page wide.
await page.addInitScript(() => {
  const iso = new Date().toISOString();
  const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const LONG = 'https://internal.example.com/very/deep/path/to/a/document/that/keeps/going?token=abcdefghijklmnopqrstuvwxyz0123456789';
  localStorage.setItem('dashboard_notes', JSON.stringify([
    { id: 'n1', title: LONG, body: LONG, color: 'accent', url: LONG, createdAt: iso, updatedAt: iso }
  ]));
  localStorage.setItem('dashboard_tasks', JSON.stringify([
    { id: 't1', title: LONG, description: LONG, dueDate: d(-2), dueTime: '09:00', status: 'in_progress', priority: 'high', url: LONG, createdAt: iso, updatedAt: iso }
  ]));
  localStorage.setItem('dashboard_events', JSON.stringify([
    { id: 'e1', title: LONG, date: d(0), time: '10:00', description: LONG, url: LONG }
  ]));
  localStorage.setItem('dashboard_goals', JSON.stringify([
    { id: 'g1', title: LONG, desc: LONG, progress: 50, status: 'active', createdAt: iso, milestones: [{ text: LONG, done: false }] }
  ]));
});

let bad = 0;
const broken = [];

console.log('        ' + PAGES.map(p => p[0].padEnd(11)).join(''));
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 844 });
  const cells = [];
  for (const [label, url] of PAGES) {
    await page.goto(`http://localhost:${PORT}/${url}`);
    await page.waitForTimeout(220);
    const r = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      const bar = document.querySelector('.tab-bar');
      const br = bar.getBoundingClientRect();
      // Any element actually sticking out past the client width.
      const wide = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.closest('aside')) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right > cw + 1) {
          wide.push({
            el: el.tagName.toLowerCase() +
              (typeof el.className === 'string' && el.className.trim()
                ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
            right: Math.round(b.right),
            w: Math.round(b.width)
          });
        }
      }
      return {
        iw: window.innerWidth,
        cw,
        docScroll: document.documentElement.scrollWidth,
        bodyScroll: document.body.scrollWidth,
        barW: Math.round(br.width),
        barRight: Math.round(br.right),
        wide: wide.slice(0, 4)
      };
    });
    // Broken means either the layout viewport widened, or something is drawn
    // past the right edge, or the document itself scrolls horizontally.
    const isBad = r.iw > r.cw + 1 || r.docScroll > r.cw + 1 || r.wide.length > 0;
    if (isBad) { bad++; broken.push({ width, page: label, ...r }); }
    if (SHOT && width === 390) {
      // The pathological content is the case that used to push the tab bar
      // off screen, so it is worth a look rather than just a number.
      await page.screenshot({ path: join(SHOTS, `longcontent-390-${label}.png`) });
    }
    cells.push((isBad ? 'BAD' : 'ok').padEnd(11));
  }
  console.log(`${String(width).padStart(4)}px  ${cells.join('')}`);
}

console.log(`\nbroken page/width combinations: ${bad}`);

if (broken.length) {
  console.log('\n--- first 3 in detail ---');
  console.log(JSON.stringify(broken.slice(0, 3), null, 2));
}

await browser.close();
server.kill();
process.exit(bad ? 1 : 0);

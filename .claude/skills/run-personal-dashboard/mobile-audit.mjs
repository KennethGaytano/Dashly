#!/usr/bin/env node
/**
 * Mobile audit — Phase 0 baseline.
 *
 * Unlike mobile-shots.mjs this seeds localStorage, so the content views
 * (task rows, goal cards, note cards, event rows) actually render instead of
 * the empty states every earlier mobile capture showed.
 *
 * Sweeps several widths and reports, per page:
 *   - horizontal overflow (scrollWidth > clientWidth) and the widest culprits
 *   - interactive elements under the 44px touch target
 *   - form controls under 16px, which make iOS zoom the viewport on focus
 *
 * Usage: node mobile-audit.mjs
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_SCRIPT = join(__dirname, 'server.mjs');
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const SHOTS_DIR = join(__dirname, 'screenshots');

const PAGES = [
  { name: 'home', url: 'index.html' },
  { name: 'tasks', url: 'pages/tasks.html' },
  { name: 'calendar', url: 'pages/calendar.html' },
  { name: 'notes', url: 'pages/notes.html' },
  { name: 'progress', url: 'pages/progress.html' },
  { name: 'goals', url: 'pages/goals.html' }
];

// 320 is the narrowest phone still in use; 700 sits inside the 640-768 band
// where the calendar form-row rules overlap.
const WIDTHS = [320, 375, 390, 430, 700, 768];

/* ---------- Seed data ---------- */

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const iso = (n, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

// Long titles + descriptions on purpose: they are what breaks narrow layouts.
const TASKS = [
  { id: 't1', title: 'Finish the Q4 financial report and send it to the board', description: 'Needs the revenue spreadsheet reconciled against last quarter first.', dueDate: dayOffset(-2), dueTime: '09:00', status: 'in_progress', priority: 'high', url: 'https://example.com/reports/q4', createdAt: iso(-9), updatedAt: iso(-2) },
  { id: 't2', title: 'Overdue item with no time set', description: '', dueDate: dayOffset(-1), dueTime: '', status: 'todo', priority: 'high', url: '', createdAt: iso(-6), updatedAt: iso(-1) },
  { id: 't3', title: 'Book the venue for the autumn conference', description: 'Roughly 120 attendees. Needs AV and a quiet room.', dueDate: dayOffset(0), dueTime: '16:30', status: 'todo', priority: 'medium', url: '', createdAt: iso(-4), updatedAt: iso(0) },
  { id: 't4', title: 'Short one', description: '', dueDate: '', dueTime: '', status: 'in_progress', priority: 'low', url: '', createdAt: iso(-2), updatedAt: iso(-2) },
  { id: 't5', title: 'Refactor the authentication module to use the new session API', description: 'Removes duplicated refresh logic.', dueDate: dayOffset(3), dueTime: '11:00', status: 'todo', priority: 'medium', url: 'https://example.com/very/long/path/that/keeps/going/until/it/wraps', createdAt: iso(-1), updatedAt: iso(0) },
  { id: 't6', title: 'Weekly review', description: '', dueDate: dayOffset(-1), dueTime: '17:00', status: 'completed', priority: 'low', url: '', createdAt: iso(-8), updatedAt: iso(-1) }
];

const NOTES = [
  { id: 'n1', title: 'Interview questions for the platform role', body: 'Walk through the incident where the queue backed up. What did you change afterwards, and would you change it again?', color: 'accent', url: 'https://example.com/interview-bank', createdAt: iso(-3), updatedAt: iso(-1) },
  { id: 'n2', title: 'Reading list', body: 'Designing Data-Intensive Applications, ch. 5 and 6.', color: 'success', url: '', createdAt: iso(-5), updatedAt: iso(-3) },
  { id: 'n3', title: 'Fix the calendar overflow on mobile', body: 'The day panel wraps awkwardly below 400px.', color: 'warning', url: '', createdAt: iso(-6), updatedAt: iso(-5) },
  { id: 'n4', title: 'Groceries', body: 'Coffee, oat milk, something green.', color: 'cyan', url: '', createdAt: iso(-1), updatedAt: iso(0) },
  { id: 'n5', title: 'A note with a deliberately very long title that will certainly wrap on a phone', body: 'Short body.', color: 'pink', url: '', createdAt: iso(-2), updatedAt: iso(-2) },
  { id: 'n6', title: 'Archive', body: 'Old but still here.', color: 'danger', url: '', createdAt: iso(-30), updatedAt: iso(-30) }
];

const EVENTS = [
  { id: 'e1', title: 'Design review with the platform team', date: dayOffset(0), time: '10:00', description: 'Walk through the queue redesign.', url: '' },
  { id: 'e2', title: 'Lunch', date: dayOffset(0), time: '12:30', description: '', url: '' },
  { id: 'e3', title: 'Dentist', date: dayOffset(2), time: '15:45', description: '', url: '' },
  { id: 'e4', title: 'Quarterly planning offsite', date: dayOffset(9), time: '09:00', description: 'Full day.', url: 'https://example.com/planning' }
];

const GOALS = [
  { id: 'g1', title: 'Launch Portfolio Website', desc: 'Ship a polished personal portfolio with project showcases, blog, and contact form.', progress: 75, status: 'active', createdAt: iso(-40), milestones: [
    { text: 'Design wireframes', done: true }, { text: 'Build responsive layout', done: true },
    { text: 'Add project showcase section', done: true }, { text: 'Write blog posts', done: false },
    { text: 'Deploy to production', done: false }] },
  { id: 'g2', title: 'Master Data Structures and Algorithms', desc: 'Complete a full study cycle, solving 100 LeetCode problems.', progress: 45, status: 'active', createdAt: iso(-35), milestones: [
    { text: 'Arrays & strings (20 problems)', done: true }, { text: 'Linked lists & stacks (15 problems)', done: true },
    { text: 'Trees & graphs (20 problems)', done: false }, { text: 'Dynamic programming (25 problems)', done: false },
    { text: 'Mock interview practice (20 problems)', done: false }] },
  { id: 'g3', title: 'Fitness Consistency', desc: 'Exercise at least 4 times per week for 30 consecutive days.', progress: 100, status: 'completed', createdAt: iso(-90), milestones: [
    { text: 'Week 1 — 4 workouts', done: true }, { text: 'Week 2 — 5 workouts', done: true },
    { text: 'Week 3 — 4 workouts', done: true }, { text: 'Week 4 — 5 workouts', done: true }] },
  { id: 'g4', title: 'Learn Rust', desc: 'Work through The Rust Book and build a CLI capstone.', progress: 15, status: 'paused', createdAt: iso(-20), milestones: [
    { text: 'Read chapters 1–4', done: true }, { text: 'Read chapters 5–10', done: false },
    { text: 'Build CLI project', done: false }] }
];

const SKILLS = [
  { id: 'sk1', name: 'JavaScript', progress: 70, type: 'skill' },
  { id: 'sk2', name: 'Python', progress: 50, type: 'skill' },
  { id: 'sk3', name: 'Data Structures & Algorithms', progress: 50, type: 'skill' },
  { id: 'sk4', name: 'System Design', progress: 25, type: 'skill' },
  { id: 'sk5', name: 'CSS & Design', progress: 90, type: 'skill' }
];

const PROJECTS = [
  { id: 'pj1', name: 'Personal Dashboard', progress: 50, type: 'project' },
  { id: 'pj2', name: 'Portfolio Website', progress: 90, type: 'project' },
  { id: 'pj3', name: 'API Integration', progress: 60, type: 'project' }
];

// Completed focus sessions feed the study-time and streak stats.
const SESSIONS = [1, 1, 2, 2, 2, 3, 4].map((d, i) => ({
  id: 'ps' + i, mode: 'focus', startedAt: iso(-d, 9), completedAt: iso(-d, 9), minutes: 25
}));

const SEED = {
  dashboard_tasks: TASKS,
  dashboard_notes: NOTES,
  dashboard_goals: GOALS,
  dashboard_events: EVENTS,
  dashboard_skills: SKILLS,
  dashboard_projects: PROJECTS,
  dashboard_pomodoro_sessions: SESSIONS
};

/* ---------- In-page measurement ---------- */

const PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const describe = el => {
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return el.tagName.toLowerCase() + cls;
  };

  // Anything painted wider than the viewport, ignoring the off-canvas drawer.
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('aside')) continue; // drawer sits at translateX(-100%)
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      overflowing.push({ el: describe(el), left: Math.round(r.left), right: Math.round(r.right) });
    }
  }

  // Interactive targets below 44px. The drawer is excluded (off-canvas at this
  // width) as is the skip link, which is off-screen until focused.
  //
  // Some targets reach 44px through a transparent ::before/::after overlay
  // rather than their own box -- the task checkbox and the note colour
  // swatches both do. Those count as passing, so measure the pseudo-element
  // too instead of reporting a false positive.
  const hitBox = el => {
    const r = el.getBoundingClientRect();
    let w = r.width, h = r.height;
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (!cs || cs.content === 'none' || cs.position !== 'absolute') continue;
      const pw = parseFloat(cs.width), ph = parseFloat(cs.height);
      if (pw > w) w = pw;
      if (ph > h) h = ph;
    }
    return { w, h };
  };

  const smallTargets = [];
  for (const el of document.querySelectorAll('button, a, input, select, textarea, [role="button"]')) {
    if (el.closest('aside') || el.classList.contains('skip-link')) continue;
    if (el.classList.contains('nav-scrim')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const hit = hitBox(el);
    if (hit.h < 44) smallTargets.push({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height) });
  }

  // iOS zooms the viewport when a focused control renders under 16px.
  const smallFonts = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size && size < 16) smallFonts.push({ el: describe(el), px: size });
  }

  const box = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };

  const grid = document.querySelector('.stats-grid');
  return {
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: overflowing.slice(0, 6),
    smallTargets: smallTargets.slice(0, 10),
    smallFonts,
    overviewHeight: grid ? Math.round(grid.getBoundingClientRect().height) : 0,
    calendarDay: box('.calendar-day'),
    milestone: box('.milestone'),
    swatch: box('.color-swatch'),
    monthLabel: box('#monthLabel'),
    dueTime: box('#taskDueTime, #eventTime')
  };
};

/* ---------- Run ---------- */

const server = spawn('node', [SERVER_SCRIPT], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

const findings = [];
let shots = 0;

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: width < 768,
    hasTouch: width < 768
  });
  await context.addInitScript(seed => {
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
  }, SEED);

  const page = await context.newPage();
  page.on('pageerror', e => console.log(`  !! page error: ${e.message}`));

  for (const p of PAGES) {
    await page.goto(`${BASE_URL}/${p.url}`);
    await page.waitForTimeout(450);

    const m = await page.evaluate(PROBE);
    const overflows = m.scrollWidth > m.vw + 1;
    if (overflows || m.smallTargets.length || m.smallFonts.length) {
      findings.push({ width, page: p.name, ...m });
    }

    // Only capture the primary phone width and the suspect tablet band,
    // otherwise this writes 36 near-identical full-page images.
    if (width === 390 || width === 700) {
      // A position:fixed bar cannot be repositioned for a fullPage capture:
      // Playwright renders beyond the viewport without resizing, so both
      // `fixed` and an `absolute; bottom:0` override still resolve against the
      // viewport and land the bar in the middle of the image. Rather than ship
      // a screenshot that looks like an overlap bug, hide the bar for the
      // full-page shot and take a separate viewport-only shot of the real
      // chrome. The geometry probe above still measures the live fixed bar.
      await page.addStyleTag({ content: '.tab-bar{visibility:hidden !important;}' });
      await page.screenshot({ path: join(SHOTS_DIR, `audit-${width}-${p.name}.png`), fullPage: true });
      shots++;

      if (p.name === 'home') {
        await page.addStyleTag({ content: '.tab-bar{visibility:visible !important;}' });
        await page.screenshot({ path: join(SHOTS_DIR, `audit-${width}-chrome.png`) });
      }
    }

    const flags = [];
    if (overflows) flags.push(`OVERFLOW ${m.scrollWidth}>${m.vw}`);
    if (m.smallTargets.length) flags.push(`${m.smallTargets.length} small targets`);
    if (m.smallFonts.length) flags.push(`${m.smallFonts.length} small-font inputs`);
    if (m.overviewHeight) flags.push(`overview ${m.overviewHeight}px`);
    console.log(`${String(width).padStart(3)}px ${p.name.padEnd(9)} ${flags.join(' | ') || 'ok'}`);
  }

  await context.close();
}

await browser.close();
server.kill();

console.log(`\n${'-'.repeat(60)}`);
console.log(`Screenshots written: ${shots}`);
console.log(`Pages needing attention: ${findings.length}`);
console.log(`${'-'.repeat(60)}\n`);
console.log(JSON.stringify(findings, null, 2));

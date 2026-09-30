#!/usr/bin/env node
/**
 * Shots: the collapsed state (how every page now opens) and one opened form
 * per page, at phone and desktop widths.
 *
 * Usage: node disclosure-shots.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'screenshots');
const PORT = 3000;

const PAGES = [
  ['index.html',         '#newQuickNoteBtn', '#quickNotePanel'],
  ['pages/tasks.html',   '#newTaskBtn',      '#taskFormPanel'],
  ['pages/calendar.html','#newEventBtn',     '#eventFormPanel'],
  ['pages/notes.html',   '#newNoteBtn',      '#noteFormPanel'],
  ['pages/goals.html',   '#newGoalBtn',      '#goalFormPanel'],
  ['pages/progress.html','#newTrackBtn',     '#trackFormPanel']
];

const server = spawn('node', [join(__dirname, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch();

// Seed one item per page so the collapsed state shows content, not empty states.
const SEED = `(() => {
  const iso = new Date().toISOString();
  localStorage.setItem('dashboard_tasks', JSON.stringify([
    { id:'t1', title:'Finish the Q4 financial report', status:'todo', priority:'high',
      description:'Reconcile the revenue spreadsheet first.', url:'',
      dueDate: new Date().toISOString().slice(0,10), dueTime:'14:30', createdAt:iso, updatedAt:iso },
    { id:'t2', title:'Book the venue', status:'in_progress', priority:'medium',
      description:'', url:'', dueDate:'', dueTime:'', createdAt:iso, updatedAt:iso }
  ]));
  localStorage.setItem('dashboard_notes', JSON.stringify([
    { id:'n1', title:'Interview questions', body:'Walk through the incident where the queue backed up.',
      color:'accent', url:'', createdAt:iso, updatedAt:iso }
  ]));
  const d = new Date(); d.setDate(d.getDate() + 2);
  const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  localStorage.setItem('dashboard_events', JSON.stringify([
    { id:'e1', title:'Design review with the platform team', date:key, time:'10:00', description:'', url:'' }
  ]));
  localStorage.setItem('dashboard_goals', JSON.stringify([
    { id:'g1', title:'Ship the redesign', desc:'Get it in front of users.', progress:50,
      status:'active', milestones:[{text:'Wireframes', done:true},{text:'Build', done:false}] }
  ]));
})();`;

for (const [w, h, tag] of [[390, 844, 'phone'], [1280, 900, 'desktop']]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    isMobile: w < 700, hasTouch: w < 700
  });
  await ctx.addInitScript(SEED);
  const page = await ctx.newPage();

  for (const [url, trigger, panel] of PAGES) {
    const name = url.replace(/[\/.]/g, '_');

    // Collapsed: the state every page now opens in.
    await page.goto(`http://localhost:${PORT}/${url}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `disclosure-${tag}-${name}-closed.png`) });

    // Opened: the form revealed.
    await page.click(trigger);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `disclosure-${tag}-${name}-open.png`) });
  }
  await ctx.close();
  console.log(`captured ${tag}`);
}

await browser.close();
server.kill();

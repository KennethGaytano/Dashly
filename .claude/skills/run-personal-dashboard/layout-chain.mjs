#!/usr/bin/env node
/**
 * Layout chain diagnostic.
 *
 * The mobile audit reports a page-level scrollWidth but skips fixed elements,
 * so it cannot say which box is establishing the width. This walks the chain
 * from <html> down to the widest offending descendant and prints every
 * ancestor's content-box width, so the first box that is too wide is obvious.
 *
 * Usage: node layout-chain.mjs [width]
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const BASE = `http://localhost:${PORT}`;
const WIDTH = Number(process.argv[2] || 390);

const PAGES = ['index.html', 'pages/tasks.html', 'pages/calendar.html', 'pages/notes.html', 'pages/progress.html', 'pages/goals.html'];

const server = spawn('node', [join(__dirname, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  localStorage.setItem('dashboard_tasks', JSON.stringify([
    { id: 't1', title: 'Finish the Q4 financial report and send it to the board', description: 'Needs the revenue spreadsheet reconciled against last quarter first.', dueDate: d(-2), dueTime: '09:00', status: 'in_progress', priority: 'high', url: 'https://example.com/reports/q4', createdAt: '', updatedAt: '' },
    { id: 't2', title: 'Overdue item with no time set', description: '', dueDate: d(-1), dueTime: '', status: 'todo', priority: 'high', url: '', createdAt: '', updatedAt: '' }
  ]));
  localStorage.setItem('dashboard_events', JSON.stringify([
    { id: 'e1', title: 'Design review with the platform team', date: d(0), time: '10:00', description: 'Walk through the queue redesign.', url: '' }
  ]));
});
const page = await ctx.newPage();

// Focused probe of the tab bar: five flex items sharing a fixed-width row
// should each get 1/5 of the viewport. Print what they actually get.
page.goto(`${BASE}/index.html`);
await page.waitForTimeout(400);

// Brute force: hide every element in turn and watch the layout viewport.
// Whatever single element restores it to the viewport is the origin.
for (const url of PAGES) {
  await page.goto(`${BASE}/${url}`);
  await page.waitForTimeout(400);
  const start = await page.evaluate(() => ({ iw: window.innerWidth, cw: document.documentElement.clientWidth }));
  if (start.iw <= start.cw + 1) continue;

  console.log(`\n=== ${url} @${WIDTH}: layout viewport ${start.iw} vs ${start.cw} ===`);

  const hits = await page.evaluate(cw => {
    const label = el => el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '') +
      (el.id ? '#' + el.id : '');
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const prev = el.style.display;
      el.style.display = 'none';
      void document.body.offsetWidth;
      if (window.innerWidth <= cw + 1) out.push(label(el));
      el.style.display = prev;
    }
    void document.body.offsetWidth;
    return out;
  }, start.cw);

  if (!hits.length) console.log('  no single element restores it (cumulative)');
  else {
    console.log(`  ${hits.length} element(s) restore the viewport:`);
    // The deepest hits are the real origins; ancestors appear because hiding
    // an ancestor also hides the culprit.
    for (const h of hits.slice(0, 14)) console.log(`    - ${h}`);
  }
}
const tabs = await page.evaluate(() => {
  const bar = document.querySelector('.tab-bar');
  const br = bar.getBoundingClientRect();
  return {
    viewport: document.documentElement.clientWidth,
    icb: window.innerWidth,
    bar: { rect: Math.round(br.width), cs: getComputedStyle(bar).width, pos: getComputedStyle(bar).position, display: getComputedStyle(bar).display },
    tabs: [...bar.children].map(t => {
      const r = t.getBoundingClientRect();
      const cs = getComputedStyle(t);
      const label = t.querySelector('.tab-label');
      return {
        cls: t.className,
        rect: Math.round(r.width),
        flex: cs.flex,
        minW: cs.minWidth,
        scrollW: t.scrollWidth,
        labelRect: label ? Math.round(label.getBoundingClientRect().width) : null,
        labelMinContent: label ? getComputedStyle(label).width : null,
        labelFont: label ? getComputedStyle(label).fontSize : null
      };
    })
  };
});
console.log('\n=== TAB BAR PROBE @390 ===');
console.log(`viewport=${tabs.viewport} innerWidth=${tabs.icb} bar.rect=${tabs.bar.rect} bar.width=${tabs.bar.cs} ${tabs.bar.pos}/${tabs.bar.display}`);
for (const t of tabs.tabs) {
  console.log(`  ${String(t.cls).padEnd(14)} rect=${String(t.rect).padStart(4)} flex=${t.flex.padEnd(6)} minW=${t.minW.padEnd(6)} scrollW=${String(t.scrollW).padStart(4)} label=${String(t.labelRect).padStart(4)} ${t.labelFont}`);
}

for (const url of PAGES) {
  await page.goto(`${BASE}/${url}`);
  await page.waitForTimeout(400);

  const out = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const label = el => el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');

    // Deepest element that actually exceeds the viewport.
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1) offenders.push({ el, r, depth: 0 });
    }
    if (!offenders.length) return { vw, scrollWidth: document.documentElement.scrollWidth, chain: [] };

    // Prefer the offender with no offending child, i.e. the true origin.
    const withKids = offenders.map(o => ({
      ...o,
      hasOffendingChild: offenders.some(c => c !== o && o.el.contains(c.el))
    }));
    const origin = withKids.find(o => !o.hasOffendingChild) || withKids[0];

    // Walk up to <html> printing each ancestor's width and box metrics.
    const chain = [];
    for (let el = origin.el; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      chain.push({
        el: label(el),
        rect: Math.round(r.width),
        scroll: el.scrollWidth,
        display: cs.display,
        minWidth: cs.minWidth,
        width: cs.width,
        padding: cs.paddingLeft + '/' + cs.paddingRight,
        flex: cs.flex || '-',
        gridCols: cs.gridTemplateColumns === 'none' ? '-' : cs.gridTemplateColumns.slice(0, 60)
      });
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, origin: label(origin.el), originWidth: Math.round(origin.r.width), chain, kids: dumpChildren() };

    // Every descendant of body, with its own width, so the box that first
    // exceeds the viewport is visible even when the chain above it is fine.
    function dumpChildren() {
      const rows = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= vw + 1) continue;
        rows.push({
          el: label(el),
          rect: Math.round(r.width),
          left: Math.round(r.left),
          scroll: el.scrollWidth,
          minW: cs.minWidth,
          flexBasis: cs.flexBasis,
          width: cs.width,
          text: (el.textContent || '').trim().slice(0, 28)
        });
      }
      return rows.slice(0, 25);
    }
  });

  console.log(`\n=== ${url} @ ${out.vw}px (scrollWidth ${out.scrollWidth}) ===`);
  if (out.origin) console.log(`origin: ${out.origin} = ${out.originWidth}px`);
  for (const c of out.chain) {
    console.log(`  ${c.el.padEnd(34)} rect=${String(c.rect).padStart(4)} scroll=${String(c.scroll).padStart(4)} ${c.display.padEnd(6)} w=${c.width.padEnd(10)} minW=${c.minWidth.padEnd(6)} pad=${c.padding.padEnd(12)} cols=${c.gridCols}`);
  }
  for (const k of (out.kids || [])) {
    console.log(`    > ${k.el.padEnd(32)} rect=${String(k.rect).padStart(4)} left=${String(k.left).padStart(4)} w=${k.width.padEnd(10)} minW=${k.minW.padEnd(6)} basis=${k.flexBasis.padEnd(8)} "${k.text}"`);
  }
}

await browser.close();
server.kill();

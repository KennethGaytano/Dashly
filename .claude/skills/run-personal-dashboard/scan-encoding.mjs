// Look for encoding damage: replacement chars, literal '?' in place of an
// emoji, and mojibake sequences, across every product file.
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const ROOT = 'c:/Users/kenne/OneDrive/Documents/BORING_PROJECTS/Personal_DashBoard';
const files = ['index.html', 'README.md',
  ...(await readdir(join(ROOT, 'pages'))).map(f => 'pages/' + f),
  ...(await readdir(join(ROOT, 'scripts'))).filter(f => f.endsWith('.js')).map(f => 'scripts/' + f),
  ...(await readdir(join(ROOT, 'styles'))).filter(f => f.endsWith('.css')).map(f => 'styles/' + f)];

const SUSPECT = /(\uFFFD|Ã|â€|Â|ï¿½|\?\s*<\/span>)/;

let total = 0;
for (const f of files) {
  const text = await readFile(join(ROOT, f), 'utf8');
  const lines = text.split(/\r?\n/);
  const bad = [];
  lines.forEach((l, i) => {
    if (SUSPECT.test(l)) bad.push(`${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  if (bad.length) {
    console.log(`\n${f}`);
    bad.forEach(b => console.log('   ' + b));
    total += bad.length;
  }
}
console.log(`\nsuspect lines: ${total}`);

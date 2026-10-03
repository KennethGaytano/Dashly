#!/usr/bin/env node
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..', '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  // req.url carries the query string and fragment, which are not part of the
  // file path. Strip them before resolving, or a request for
  // /pages/notes.html?new=1 looks for a file literally named "notes.html?new=1"
  // and 404s. decodeURIComponent turns %20 and friends back into real names.
  let requestPath;
  try {
    requestPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  let filePath = requestPath === '/' ? '/index.html' : requestPath;
  filePath = join(ROOT, filePath);

  // Keep requests inside the repository root.
  if (!resolve(filePath).startsWith(resolve(ROOT))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(500);
      res.end('Server error');
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});

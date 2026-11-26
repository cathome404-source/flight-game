// Garuda Skies — tiny static server for play-testing (Node stdlib only).
// Serves ./game on http://localhost:8080. No directory listing: a path
// that is not a file is a 404, and any path escaping game/ is a 403.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./game', import.meta.url));
const port = 8080;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = join(root, normalize(path).replace(/^(\.\.(\/|\\|$))+/, ''));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('403 Forbidden\n');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404 Not Found\n');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 Not Found\n');
  }
});

server.listen(port, () => {
  console.log(`Garuda Skies: serving game/ at http://localhost:${port}/`);
});

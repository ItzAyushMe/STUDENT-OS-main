// Tiny static server for the exported web build (dist/) with SPA
// fallback — used for quick local/preview hosting.
//   npx expo export --platform web && node scripts/serve-web.mjs
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 8000);
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath = path.normalize(path.join(DIST, url.pathname));
    if (!filePath.startsWith(DIST)) filePath = path.join(DIST, 'index.html');
    let stat = await fs.stat(filePath).catch(() => null);
    if (!stat || stat.isDirectory()) {
      filePath = path.join(DIST, 'index.html'); // SPA fallback
      stat = await fs.stat(filePath);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(await fs.readFile(filePath));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error — did you run `npx expo export --platform web` first?');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`StudentOS web build serving at http://${HOST}:${PORT} (from ${DIST})`);
});

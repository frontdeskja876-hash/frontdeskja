// FrontDesk JA — minimal production server. Serves the static site and the two API
// routes. No dependencies; Node 18+.
//
//   OPENAI_API_KEY=sk-... LEAD_WEBHOOK_URL=https://... node server.mjs
//
// Environment:
//   PORT              default 8000
//   OPENAI_API_KEY    required for the Ask FrontDesk Assistant
//   OPENAI_MODEL      default gpt-4.1-mini
//   OPENAI_BASE_URL   default https://api.openai.com/v1
//   LEAD_WEBHOOK_URL  where leads are POSTed as JSON (otherwise logged only)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatHandler, leadHandler } from './server/handlers.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 8000;

// Only these top-level paths are public; server code and content sources are not served.
const PUBLIC = /^\/(index\.html|pricing\.html|about\.html|ask-frontdesk\.html|ask\/[\w-]+\.html|assets\/[\w./-]+)?$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon'
};

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/' || path === '') path = '/index.html';
  if (!PUBLIC.test(path) || path.includes('..')) return notFound(res);
  const file = normalize(join(root, path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return notFound(res);
  try {
    const s = await stat(file);
    if (!s.isFile()) return notFound(res);
    const ext = extname(file);
    res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { notFound(res); }
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/api/chat') return chatHandler(req, res);
  if (pathname === '/api/lead') return leadHandler(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
  return serveStatic(req, res);
}).listen(port, () => {
  console.log(`FrontDesk JA on http://localhost:${port}`);
  if (!process.env.OPENAI_API_KEY) console.warn('OPENAI_API_KEY is not set: Ask FrontDesk will say it is not connected.');
  if (!process.env.LEAD_WEBHOOK_URL) console.warn('LEAD_WEBHOOK_URL is not set: leads are written to this log only.');
});

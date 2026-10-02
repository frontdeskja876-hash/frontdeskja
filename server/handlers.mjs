// HTTP handlers for the Ask FrontDesk Assistant (/api/chat) and the website intake
// (/api/lead). Plain Node (req, res) handlers: used only by server.mjs, for local dev
// and any traditional Node host. The deployed site runs on Cloudflare Pages instead,
// which uses its own handler shape — see functions/api/chat.js and functions/api/lead.js,
// which share this same conversation logic via server/chat.mjs, just wired to
// Cloudflare's Request/Response/env instead of Node's (req, res)/process.env.
//
// The OpenAI API key lives only in the server environment (OPENAI_API_KEY) and is never
// sent to the browser.
import { normaliseLead, isValidEmail, deliverLead } from './leads.mjs';
import { runChat, cleanMessages } from './chat.mjs';

const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
// gpt-6.1-sol: explicit choice (overrides spec §4's gpt-5-mini cost/competence pick —
// see the spec's model note: quality over cost, deliberately — Ask FrontDesk is the
// first live demo of the Assistant product prospective clients interact with). Only the
// model is overridden; reasoning_effort stays 'medium' below per explicit direction.
const MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const MAX_BODY = 32 * 1024;

/* ---------- small utilities ---------- */

function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body); // pre-parsed (Vercel)
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

// Fixed-window limit per client IP. In-memory: per server instance, which is enough to
// stop casual abuse; put a shared limiter in front for multi-instance deployments.
const hits = new Map();
function rateLimited(req, limit, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > windowMs) { hits.set(ip, { start: now, n: 1 }); return false; }
  h.n += 1;
  if (hits.size > 5000) hits.clear();
  return h.n > limit;
}

export async function chatHandler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { error: 'POST only' }); }
  if (rateLimited(req, 30, 5 * 60 * 1000)) return sendJson(res, 429, { error: 'Too many messages. Please wait a few minutes.' });

  let body;
  try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: 'Invalid request' }); }
  const history = cleanMessages(body.messages);
  if (!history) return sendJson(res, 400, { error: 'Send at least one message.' });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  if (!process.env.OPENAI_API_KEY) {
    send({ type: 'error', code: 'unconfigured', message: 'The Assistant isn’t connected yet.' });
    return res.end();
  }

  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  for await (const event of runChat({
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: OPENAI_BASE,
    model: MODEL,
    // gpt-6.1-sol via Chat Completions only supports function/tool calling (the
    // capture_lead tool) when reasoning_effort is 'none' — confirmed in OpenAI's own
    // model docs. The capture_lead tool has to be offered on every turn (the model
    // decides on its own when a visitor is ready to be contacted), so this applies to
    // every reply, not just the moment someone shares their info. Explicit tradeoff,
    // confirmed with the user: reliable lead capture over deeper per-reply reasoning.
    reasoningEffort: 'none',
    maxCompletionTokens: 1200,
    webhookUrl: process.env.LEAD_WEBHOOK_URL,
    history,
    signal: abort.signal
  })) {
    send(event);
  }
  res.end();
}

export async function leadHandler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { error: 'POST only' }); }
  if (rateLimited(req, 10, 10 * 60 * 1000)) return sendJson(res, 429, { error: 'Too many submissions.' });
  let body;
  try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: 'Invalid request' }); }
  const lead = normaliseLead(body, 'website-intake');
  if (!lead.name || !isValidEmail(lead.email)) return sendJson(res, 400, { error: 'Name and a valid email are required.' });
  try {
    const r = await deliverLead(lead, process.env.LEAD_WEBHOOK_URL);
    return sendJson(res, 200, { ok: true, delivered: r.delivered });
  } catch (e) {
    console.error('[lead] delivery failed:', e.message);
    return sendJson(res, 502, { error: 'Could not send right now.' });
  }
}

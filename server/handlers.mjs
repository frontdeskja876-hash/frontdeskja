// HTTP handlers for the Ask FrontDesk Assistant (/api/chat) and the website intake
// (/api/lead). Plain Node (req, res) handlers: used by server.mjs and by the
// Vercel-style wrappers in /api.
//
// The OpenAI API key lives only in the server environment (OPENAI_API_KEY) and is never
// sent to the browser.
import { systemPrompt } from './knowledge.mjs';
import { normaliseLead, isValidEmail, deliverLead } from './leads.mjs';

const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
// gpt-6.1-sol: explicit choice (overrides spec §4's gpt-5-mini cost/competence pick —
// see the spec's model note: quality over cost, deliberately — Ask FrontDesk is the
// first live demo of the Assistant product prospective clients interact with.
// reasoning_effort is 'high' below for the same reason; expect higher per-reply latency
// as the real tradeoff that buys, not just a higher bill.
const MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const MAX_BODY = 32 * 1024;
const MAX_TURNS = 16;
const MAX_CHARS = 2000;

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

function cleanMessages(list) {
  if (!Array.isArray(list)) return null;
  const out = list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_TURNS);
  if (!out.length || out[out.length - 1].role !== 'user' || !out[out.length - 1].content.trim()) return null;
  return out;
}

/* ---------- the Assistant's one tool ---------- */

const tools = [{
  type: 'function',
  function: {
    name: 'capture_lead',
    description: 'Send a visitor\'s contact details to the FrontDesk team so a person follows up. Call once, only after the visitor has given at least their name and email.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string', description: 'Optional' },
        business: { type: 'string', description: 'Business name, if given' },
        package: { type: 'string', description: 'AEO, Assistant, Receptionist, or unsure' },
        need: { type: 'string', description: 'One-line summary of what they need' }
      },
      required: ['name', 'email', 'need']
    }
  }
}];

async function runTool(call) {
  if (call.name !== 'capture_lead') return { ok: false, error: 'unknown tool' };
  let args = {};
  try { args = JSON.parse(call.arguments || '{}'); } catch { return { ok: false, error: 'invalid arguments' }; }
  if (!isValidEmail(args.email)) return { ok: false, error: 'The email address looks incomplete. Ask the visitor to check it.' };
  try {
    await deliverLead(normaliseLead(args, 'ask-frontdesk-chat'));
    return { ok: true };
  } catch (e) {
    console.error('[lead] delivery failed:', e.message);
    return { ok: false, error: 'Could not send right now. Apologise briefly and suggest using Get Started on the pricing page.' };
  }
}

/* ---------- OpenAI streaming ---------- */

async function* streamCompletion(messages, signal) {
  const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, tools, stream: true, max_completion_tokens: 1800, reasoning_effort: 'high' })
  });
  if (!r.ok || !r.body) {
    const detail = await r.text().catch(() => '');
    throw new Error(`OpenAI ${r.status}: ${detail.slice(0, 300)}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try { yield JSON.parse(data); } catch { /* ignore keep-alives / partial noise */ }
    }
  }
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

  const messages = [{ role: 'system', content: systemPrompt() }, ...history];
  try {
    for (let round = 0; round < 3; round++) {
      const calls = [];
      let text = '';
      let finish = null;
      for await (const chunk of streamCompletion(messages, abort.signal)) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const d = choice.delta || {};
        if (d.content) { text += d.content; send({ type: 'delta', text: d.content }); }
        for (const tc of d.tool_calls || []) {
          const c = calls[tc.index] || (calls[tc.index] = { id: '', name: '', arguments: '' });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.arguments += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (finish !== 'tool_calls' || !calls.length) break;

      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
      });
      for (const c of calls) {
        const result = await runTool(c);
        if (c.name === 'capture_lead' && result.ok) send({ type: 'lead', ok: true });
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
      }
    }
    send({ type: 'done' });
  } catch (e) {
    if (!abort.signal.aborted) {
      console.error('[chat]', e.message);
      send({ type: 'error', code: 'upstream', message: 'Something went wrong on our side. Please try again.' });
    }
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
    const r = await deliverLead(lead);
    return sendJson(res, 200, { ok: true, delivered: r.delivered });
  } catch (e) {
    console.error('[lead] delivery failed:', e.message);
    return sendJson(res, 502, { error: 'Could not send right now.' });
  }
}

// Cloudflare Pages Function for POST /api/lead — the Pricing page's signup intake.
// See functions/api/chat.js for why this is structured the way it is (Workers runtime,
// env instead of process.env, shared logic with the Node path via server/leads.mjs).
import { normaliseLead, isValidEmail, deliverLead } from '../../server/leads.mjs';
import { createRateLimiter } from '../../server/ratelimit.mjs';

const rateLimited = createRateLimiter();

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  if (rateLimited(request.headers.get('cf-connecting-ip'), 10, 10 * 60 * 1000)) {
    return json(429, { error: 'Too many submissions.' });
  }
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid request' }); }
  const lead = normaliseLead(body, 'website-intake');
  if (!lead.name || !isValidEmail(lead.email)) return json(400, { error: 'Name and a valid email are required.' });
  try {
    const r = await deliverLead(lead, env.LEAD_WEBHOOK_URL);
    return json(200, { ok: true, delivered: r.delivered });
  } catch (e) {
    console.error('[lead] delivery failed:', e.message);
    return json(502, { error: 'Could not send right now.' });
  }
}

export async function onRequestGet() {
  return json(405, { error: 'POST only' });
}

// Throwaway local test: calls the Cloudflare Pages Functions directly using Node's
// native Request/Response/ReadableStream (same Web APIs Workers provides), to verify
// they work without needing wrangler or a real Cloudflare deploy.
import { onRequestPost as chatPost, onRequestGet as chatGet } from '../functions/api/chat.js';
import { onRequestPost as leadPost } from '../functions/api/lead.js';

const env = {}; // no OPENAI_API_KEY on purpose — same "not connected" path as the Node test

async function run() {
  console.log('--- GET /api/chat (should be 405) ---');
  const r0 = await chatGet();
  console.log(r0.status, await r0.text());

  console.log('--- POST /api/chat, no OPENAI_API_KEY (should stream "unconfigured") ---');
  const req1 = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
  });
  const r1 = await chatPost({ request: req1, env });
  console.log('status', r1.status, r1.headers.get('content-type'));
  console.log('body:', await r1.text());

  console.log('--- POST /api/chat, empty messages (should 400 before streaming) ---');
  const req2 = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] })
  });
  const r2 = await chatPost({ request: req2, env });
  console.log(r2.status, await r2.text());

  console.log('--- POST /api/lead, invalid email (should 400) ---');
  const req3 = new Request('https://example.com/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', email: 'nope' })
  });
  const r3 = await leadPost({ request: req3, env });
  console.log(r3.status, await r3.text());

  console.log('--- POST /api/lead, valid, no LEAD_WEBHOOK_URL (should 200, delivered:false) ---');
  const req4 = new Request('https://example.com/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', email: 'test@example.com', need: 'curious' })
  });
  const r4 = await leadPost({ request: req4, env });
  console.log(r4.status, await r4.text());

  console.log('\nAll Cloudflare-style function calls completed without throwing.');
}

run().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });

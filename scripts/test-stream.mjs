// Verifies the actual streaming path (fetch -> ReadableStream -> SSE out) works under
// the Cloudflare-style function, using a local mock OpenAI endpoint instead of a real
// API key. This is the part most likely to break silently (stream plumbing), so it's
// worth a real network round-trip, not just a unit check.
import { createServer } from 'node:http';
import { onRequestPost as chatPost } from '../functions/api/chat.js';

// Minimal mock of OpenAI's streaming chat/completions response: two content deltas,
// then a finish_reason 'stop'.
const mock = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunks = [
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { content: ' there.' }, finish_reason: 'stop' }] }
  ];
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
});

await new Promise((resolve) => mock.listen(0, resolve));
const port = mock.address().port;

const env = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://localhost:${port}/v1` };
const req = new Request('https://example.com/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
});

const res = await chatPost({ request: req, env });
const text = await res.text();
console.log('status:', res.status);
console.log('body:\n' + text);

mock.close();

const expectDelta1 = text.includes('"type":"delta","text":"Hello"');
const expectDelta2 = text.includes('"type":"delta","text":" there."');
const expectDone = text.includes('"type":"done"');
if (expectDelta1 && expectDelta2 && expectDone) {
  console.log('\nPASS: streamed deltas + done event all present.');
} else {
  console.error('\nFAIL: missing expected SSE events.', { expectDelta1, expectDelta2, expectDone });
  process.exit(1);
}

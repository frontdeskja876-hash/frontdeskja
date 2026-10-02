// Verifies the Agents API path (AGENT_ID set) end to end against a local mock of the
// OpenAI Agents API: session create + SSE stream, the capture_lead function round-trip
// (requires_action -> tool_result), failure handling, and session cleanup. No real API
// key needed. The mock follows OpenAI's published event shapes; it can't prove the real
// service behaves identically, so do one real smoke test after deploying.
import { createServer } from 'node:http';
import { onRequestPost as chatPost } from '../functions/api/chat.js';

const calls = { create: [], toolResults: [], cancels: 0, deleted: [] };
let scenario = 'plain';
const waiting = new Map(); // session id -> resume function

const sse = (res, ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b ? JSON.parse(b) : {}));
});
const finish = (res, sid, text) => {
  sse(res, { type: 'agent.session.turn.output_text.done', turn_id: 't1', item_id: 'm1', text });
  sse(res, { type: 'agent.session.turn.item.done', item: { type: 'message', phase: 'final_answer', turn_id: 't1', content: [{ type: 'output_text', text }] } });
  sse(res, { type: 'agent.session.turn.completed', turn: { id: 't1', subagent_id: null } });
  res.end();
};

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/v1\/agents\/sessions(?:\/([\w-]+)(\/events)?)?$/);
  if (!m) { res.writeHead(404); return res.end(); }
  const [, sid, isEvents] = m;

  if (req.method === 'POST' && !sid) {
    const body = await readBody(req);
    calls.create.push({ body, beta: req.headers['openai-beta'], auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const id = `sess_${scenario}`;
    sse(res, { type: 'agent.session.created', session: { id } });
    sse(res, { type: 'agent.session.turn.created', turn_id: 't1', turn: { id: 't1', subagent_id: null } });
    if (scenario === 'plain') return finish(res, id, 'Hi! Happy to help with AEO, the Assistant or the Receptionist.');
    if (scenario === 'failure') {
      sse(res, { type: 'agent.session.turn.failed', turn: { id: 't1', subagent_id: null, error: { message: 'boom' } } });
      return res.end();
    }
    // lead: pause for the visitor's function result
    sse(res, { type: 'agent.session.requires_action', session: { id, required_actions: [
      { type: 'function_call', turn_id: 't1', call_id: 'c1', name: 'capture_lead',
        arguments: { name: 'Pat', email: 'pat@example.com', need: 'quote for the Receptionist' } }
    ] } });
    waiting.set(id, () => finish(res, id, 'Thanks Pat, someone from FrontDesk will follow up.'));
    return;
  }
  if (req.method === 'POST' && isEvents) {
    const body = await readBody(req);
    for (const e of body.events) {
      if (e.type === 'agent.session.input.tool_result') calls.toolResults.push(e);
      if (e.type === 'agent.session.input.cancel') calls.cancels++;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
    if (body.events.some((e) => e.type === 'agent.session.input.tool_result')) waiting.get(sid)?.();
    return;
  }
  if (req.method === 'DELETE' && sid) {
    calls.deleted.push(sid);
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}');
  }
  res.writeHead(405); res.end();
});

await new Promise((resolve) => mock.listen(0, resolve));
const port = mock.address().port;
const env = { OPENAI_API_KEY: 'test-key', AGENT_ID: 'agent_test123', OPENAI_BASE_URL: `http://localhost:${port}/v1` };

async function chat(text) {
  const req = new Request('https://example.com/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: text }] })
  });
  const res = await chatPost({ request: req, env, waitUntil: undefined });
  const raw = await res.text();
  const events = raw.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data:\s*/, '')));
  return { status: res.status, events, reply: events.filter((e) => e.type === 'delta').map((e) => e.text).join('') };
}

const failures = [];
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (!ok) failures.push(name); };

// 1. Plain answer
scenario = 'plain';
let r = await chat('What does AEO do?');
const c1 = calls.create[0];
check('plain: streams the final answer then done', r.reply.startsWith('Hi! Happy to help') && r.events.at(-1).type === 'done');
check('plain: uses saved agent_id, no sandbox', c1.body.agent_id === 'agent_test123' && c1.body.environment.type === 'none' && c1.body.stream === true);
check('plain: Agents beta header + bearer key sent', c1.beta === 'agents=v1' && c1.auth === 'Bearer test-key');
check('plain: tools = web_search + flat capture_lead', c1.body.agent.tools[0].type === 'web_search'
  && c1.body.agent.tools[1].type === 'function' && c1.body.agent.tools[1].name === 'capture_lead' && !c1.body.agent.tools[1].function);
check('plain: input carries knowledge + the visitor message', /APPROVED FRONTDESK KNOWLEDGE/.test(c1.body.input) && /Visitor: What does AEO do\?/.test(c1.body.input));
check('plain: session deleted afterwards', calls.deleted.includes('sess_plain'));

// 2. capture_lead round-trip
scenario = 'lead';
r = await chat('I want a quote. Pat, pat@example.com');
check('lead: widget gets a lead event', r.events.some((e) => e.type === 'lead' && e.ok));
check('lead: tool_result returned with the same turn/call ids', calls.toolResults.length === 1
  && calls.toolResults[0].turn_id === 't1' && calls.toolResults[0].call_id === 'c1' && calls.toolResults[0].success === true);
check('lead: final reply streamed after the tool result', /follow up/.test(r.reply) && r.events.at(-1).type === 'done');
check('lead: session deleted afterwards', calls.deleted.includes('sess_lead'));

// 3. failed turn
scenario = 'failure';
r = await chat('hello');
check('failure: widget gets an upstream error, no reply text', r.events.some((e) => e.type === 'error' && e.code === 'upstream') && !r.reply);
check('failure: session still cleaned up', calls.deleted.includes('sess_failure'));

mock.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log('\nAll Agents API checks passed.');

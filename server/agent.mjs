// Ask FrontDesk via the OpenAI Agents API (the saved "Ask FrontDesk" agent).
//
// Same contract as the Chat Completions loop in server/chat.mjs: an async generator
// yielding the events the browser widget already understands:
//   { type: 'delta', text }   — a chunk of the reply to append
//   { type: 'lead', ok }      — capture_lead succeeded
//   { type: 'error', code, message }
//   { type: 'done' }
//
// Runtime-agnostic (plain fetch), so the Node server and the Cloudflare Pages Function
// share it. Each browser request creates one short-lived session on the saved agent
// (environment: none, so no sandbox), runs one turn, and deletes the session. The
// widget already sends the whole conversation each time, so no session state has to be
// kept between requests.
//
// What comes from where:
//   - model, reasoning, verbosity, persona instructions: the saved agent (AGENT_ID),
//     edited in the OpenAI dashboard.
//   - approved FrontDesk knowledge + articles: sent with every request as reference
//     material (the Agents API has no knowledge-base upload).
//   - tools: set per session here, because overriding `tools` replaces the saved list.
//     That's web search (mirroring the saved agent) plus capture_lead.
import { referenceBlock } from './knowledge.mjs';
import { agentLeadTool, runTool } from './tools.mjs';

const BETA = { 'OpenAI-Beta': 'agents=v1' };
const TURN_TIMEOUT_MS = 90_000;

const PREAMBLE = [
  'Reference material and rules for this conversation, maintained by FrontDesk JA.',
  '- Treat the reference below as the source of truth for facts about FrontDesk JA (what it sells, pricing, limits). If anything conflicts with it, follow the reference.',
  '- Use web search only for current outside information; never present a search result as FrontDesk JA fact.',
  '- If the visitor wants to sign up, get a quote, book a call or talk to a person, collect their name and email (phone optional) plus a one-line summary of what they need, then call capture_lead once and confirm in words that a person from FrontDesk will follow up. Ask for nothing else.',
  '- Plain text only: no markdown headings, tables, bold or bullet symbols.'
].join('\n');

export function buildInput(history) {
  const turns = history
    .map((m) => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  return `${PREAMBLE}\n\n${referenceBlock()}\n\n=== CONVERSATION SO FAR ===\n${turns}\n\nReply to the visitor's latest message.`;
}

function headers(apiKey, extra = {}) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...BETA, ...extra };
}

async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep).replace(/^\r?\n\r?\n/, '');
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      try { yield JSON.parse(data); } catch { /* keep-alive or partial noise */ }
    }
  }
}

function chunkText(text, size = 28) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

async function sendToolResults({ apiKey, baseUrl, sessionId, results, signal }) {
  const r = await fetch(`${baseUrl}/agents/sessions/${sessionId}/events`, {
    method: 'POST', signal, headers: headers(apiKey), body: JSON.stringify({ events: results })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status} sending tool results: ${(await r.text().catch(() => '')).slice(0, 300)}`);
}

async function requiredActions({ apiKey, baseUrl, session, signal }) {
  if (Array.isArray(session?.required_actions)) return session.required_actions;
  const r = await fetch(`${baseUrl}/agents/sessions/${session.id}`, { signal, headers: headers(apiKey) });
  if (!r.ok) throw new Error(`OpenAI ${r.status} retrieving session`);
  return (await r.json()).required_actions || [];
}

async function cleanup({ apiKey, baseUrl, sessionId }) {
  if (!sessionId) return;
  const opts = { headers: headers(apiKey), signal: AbortSignal.timeout(8000) };
  try {
    // A turn that is still running (visitor closed the tab) is cancelled first.
    await fetch(`${baseUrl}/agents/sessions/${sessionId}/events`, {
      ...opts, method: 'POST', body: JSON.stringify({ events: [{ type: 'agent.session.input.cancel' }] })
    }).catch(() => {});
    await fetch(`${baseUrl}/agents/sessions/${sessionId}`, { ...opts, method: 'DELETE' });
  } catch { /* best effort: the session is scratch space */ }
}

export async function* runAgentChat({ apiKey, baseUrl, agentId, webhookUrl, history, signal, allowedDomains, waitUntil }) {
  const timeout = AbortSignal.timeout(TURN_TIMEOUT_MS);
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  timeout.addEventListener('abort', stop);
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop); }

  let sessionId = null;
  let finalText = '';
  let lastDoneText = '';
  const subagentTurns = new Set();

  try {
    const webSearch = { type: 'web_search', mode: 'live', context_size: 'medium' };
    if (allowedDomains?.length) webSearch.allowed_domains = allowedDomains;

    const r = await fetch(`${baseUrl}/agents/sessions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: headers(apiKey, { Accept: 'text/event-stream' }),
      body: JSON.stringify({
        agent_id: agentId,
        agent: { tools: [webSearch, agentLeadTool] },
        environment: { type: 'none' },
        metadata: { source: 'website-ask-frontdesk' },
        input: buildInput(history),
        stream: true
      })
    });
    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => '');
      throw new Error(`OpenAI ${r.status}: ${detail.slice(0, 400)}`);
    }

    let completed = false;
    for await (const ev of sseEvents(r)) {
      switch (ev.type) {
        case 'agent.session.created':
          sessionId = ev.session?.id || sessionId;
          break;

        case 'agent.session.turn.created':
          if (ev.turn?.subagent_id) subagentTurns.add(ev.turn_id || ev.turn.id);
          break;

        case 'agent.session.turn.output_text.done':
          if (!subagentTurns.has(ev.turn_id)) lastDoneText = ev.text || lastDoneText;
          break;

        case 'agent.session.turn.item.done': {
          const item = ev.item;
          if (item?.type === 'message' && item.phase === 'final_answer' && !subagentTurns.has(item.turn_id)) {
            finalText = (item.content || []).map((p) => p.text || '').join('');
          }
          break;
        }

        case 'agent.session.requires_action': {
          const session = ev.session || { id: sessionId };
          sessionId = session.id || sessionId;
          const actions = await requiredActions({ apiKey, baseUrl, session, signal: ctl.signal });
          const results = [];
          for (const a of actions) {
            if (a.type !== 'function_call') continue;
            const ids = { turn_id: a.turn_id, call_id: a.call_id };
            const args = typeof a.arguments === 'string' ? a.arguments : JSON.stringify(a.arguments || {});
            const result = await runTool({ name: a.name, arguments: args }, webhookUrl);
            if (a.name === 'capture_lead' && result.ok) yield { type: 'lead', ok: true };
            results.push(result.ok
              ? { type: 'agent.session.input.tool_result', ...ids, success: true, output: JSON.stringify(result) }
              : { type: 'agent.session.input.tool_result', ...ids, success: false, error: result.error || 'failed' });
          }
          if (results.length) await sendToolResults({ apiKey, baseUrl, sessionId, results, signal: ctl.signal });
          break;
        }

        case 'error':
          throw new Error(ev.error?.message || 'agent error');
        case 'agent.session.failed':
        case 'agent.session.environment.failed':
          throw new Error(`session stopped: ${ev.type}`);
        case 'agent.session.turn.failed':
        case 'agent.session.turn.cancelled':
          if (!ev.turn?.subagent_id) throw new Error(`${ev.type}: ${ev.turn?.error?.message || 'no details'}`);
          break;

        case 'agent.session.turn.completed':
          if (!ev.turn?.subagent_id) completed = true;
          break;
      }
      if (completed) break;
    }
    if (!completed) throw new Error('stream closed before the turn ended');

    const text = (finalText || lastDoneText).trim();
    if (!text) throw new Error('turn completed with no reply text');
    for (const piece of chunkText(text)) yield { type: 'delta', text: piece };
    yield { type: 'done' };
  } catch (e) {
    if (!(signal && signal.aborted)) {
      console.error('[agent]', e.message);
      yield { type: 'error', code: 'upstream', message: 'Something went wrong on our side. Please try again.' };
    }
  } finally {
    ctl.abort();
    const job = cleanup({ apiKey, baseUrl, sessionId });
    if (waitUntil) waitUntil(job); else await job;
  }
}

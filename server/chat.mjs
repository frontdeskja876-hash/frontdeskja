// The actual Ask FrontDesk conversation loop — talks to OpenAI, handles the
// capture_lead tool-calling round-trip, yields events to send to the browser as SSE.
// Fully runtime-agnostic (plain fetch/ReadableStream, no Node-only or Workers-only
// APIs), so both server/handlers.mjs (Node) and functions/api/chat.js (Cloudflare
// Pages Functions) share this one implementation instead of two copies that could
// drift apart.
import { systemPrompt } from './knowledge.mjs';
import { tools, runTool } from './tools.mjs';

export const MAX_TURNS = 16;
export const MAX_CHARS = 2000;

export function cleanMessages(list) {
  if (!Array.isArray(list)) return null;
  const out = list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_TURNS);
  if (!out.length || out[out.length - 1].role !== 'user' || !out[out.length - 1].content.trim()) return null;
  return out;
}

async function* streamCompletion({ apiKey, baseUrl, model, reasoningEffort, maxCompletionTokens, messages, signal }) {
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, messages, tools, stream: true,
      max_completion_tokens: maxCompletionTokens,
      reasoning_effort: reasoningEffort
    })
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

// Yields the same event shapes the browser widget expects:
//   { type: 'delta', text }   — a chunk of the reply to append
//   { type: 'lead', ok }      — capture_lead succeeded
//   { type: 'error', code, message }
//   { type: 'done' }
export async function* runChat({ apiKey, baseUrl, model, reasoningEffort, maxCompletionTokens, webhookUrl, history, signal }) {
  const messages = [{ role: 'system', content: systemPrompt() }, ...history];
  try {
    for (let round = 0; round < 3; round++) {
      const calls = [];
      let text = '';
      let finish = null;
      for await (const chunk of streamCompletion({ apiKey, baseUrl, model, reasoningEffort, maxCompletionTokens, messages, signal })) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const d = choice.delta || {};
        if (d.content) { text += d.content; yield { type: 'delta', text: d.content }; }
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
        const result = await runTool(c, webhookUrl);
        if (c.name === 'capture_lead' && result.ok) yield { type: 'lead', ok: true };
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
      }
    }
    yield { type: 'done' };
  } catch (e) {
    if (!(signal && signal.aborted)) {
      console.error('[chat]', e.message);
      yield { type: 'error', code: 'upstream', message: 'Something went wrong on our side. Please try again.' };
    }
  }
}

// Cloudflare Pages Function for POST /api/chat — the Ask FrontDesk Assistant.
// Runs in the Workers runtime (not Node): config comes from `env` (Cloudflare's
// environment variables/secrets), not process.env; there's no filesystem, so the
// knowledge base is imported from content/generated-knowledge.js (see
// scripts/build-knowledge.mjs), not read from content/knowledge.md at request time.
//
// Shares its actual conversation/streaming logic with the Node path (server.mjs) via
// server/chat.mjs — this file is just the Cloudflare-shaped entry point around it.
import { runChat, cleanMessages } from '../../server/chat.mjs';
import { createRateLimiter } from '../../server/ratelimit.mjs';

const MAX_BODY = 32 * 1024;
const encoder = new TextEncoder();

// Per-isolate limiter: Cloudflare may run many isolates, so this is a best-effort
// per-instance limit, same caveat as the Node path — not a hard global limit.
const rateLimited = createRateLimiter();

function sseLine(obj) {
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function onRequestPost({ request, env }) {
  if (rateLimited(request.headers.get('cf-connecting-ip'), 30, 5 * 60 * 1000)) {
    return new Response(JSON.stringify({ error: 'Too many messages. Please wait a few minutes.' }), {
      status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 413, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  const history = cleanMessages(body.messages);
  if (!history) {
    return new Response(JSON.stringify({ error: 'Send at least one message.' }), {
      status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      if (!env.OPENAI_API_KEY) {
        controller.enqueue(sseLine({ type: 'error', code: 'unconfigured', message: 'The Assistant isn’t connected yet.' }));
        controller.close();
        return;
      }
      try {
        for await (const event of runChat({
          apiKey: env.OPENAI_API_KEY,
          baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
          model: env.OPENAI_MODEL || 'gpt-6.1-sol',
          // See server/handlers.mjs for why this is 'none': gpt-6.1-sol via Chat
          // Completions only supports the capture_lead tool when reasoning_effort is
          // 'none' (OpenAI's own model docs), and the tool must be offered every turn.
          reasoningEffort: 'none',
          maxCompletionTokens: 1200,
          webhookUrl: env.LEAD_WEBHOOK_URL,
          history,
          signal: request.signal
        })) {
          controller.enqueue(sseLine(event));
        }
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no'
    }
  });
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ error: 'POST only' }), {
    status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST' }
  });
}

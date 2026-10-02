// Fixed-window per-IP rate limiter, shared logic for both runtimes. Each runtime
// (server.mjs's Node process, or a Cloudflare Functions isolate) creates its own
// limiter instance — state is in-memory and per-process/per-isolate, not shared
// between them or across multiple instances of either. That's enough to stop casual
// abuse; a real shared limit across instances would need Cloudflare KV/Durable Objects
// or an external store, not done here.
export function createRateLimiter() {
  const hits = new Map();
  return function rateLimited(ip, limit, windowMs) {
    const key = ip || '?';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) { hits.set(key, { start: now, n: 1 }); return false; }
    h.n += 1;
    if (hits.size > 5000) hits.clear();
    return h.n > limit;
  };
}

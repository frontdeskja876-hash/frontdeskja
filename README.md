# FrontDesk JA — website

A slide-paged marketing site with a live AI Assistant.

- **Home (`index.html`):** a six-page story: Hero, The Solution, AEO, Assistant, Receptionist, Payoff, plus a closing slide.
- **Pricing (`pricing.html`):** three packages, plus the sign-up intake.
- **Ask FrontDesk hub (`ask-frontdesk.html`, `ask/*.html`):** knowledge articles by pillar.
- **About (`about.html`):** final copy from spec §13.
- **Ask FrontDesk chat:** on every page, a live instance of the FrontDesk Assistant. It runs on the OpenAI API through a small server.

The front end is plain HTML, CSS and JS with no framework. The server is plain Node 18+ with no dependencies.

## Run it

```sh
cp .env.example .env          # then fill in OPENAI_API_KEY (and LEAD_WEBHOOK_URL)
set -a; . ./.env; set +a
npm start                     # → http://localhost:8000
```

Without `OPENAI_API_KEY`, the site still works. The chat then tells visitors it isn't connected yet.

### Deploy

- **Cloudflare Pages (how this site is actually deployed):** `functions/api/chat.js` and `functions/api/lead.js` are Cloudflare Pages Functions — Cloudflare's own serverless format, not a traditional Node server. No build command needed; the whole repo root is both the static site and the Functions source. Set the environment variables (table below) in the Pages project's Settings → Environment variables, for both Production and Preview if you use preview deploys, then redeploy.
- **Any traditional Node host** (Render, Railway, Fly.io, a VPS) is also supported as an alternative: run `npm start` and set the same environment variables in that host's dashboard. `server.mjs` serves the site and both API routes itself — this path is independent of Cloudflare and mainly useful for local development (`npm start` → http://localhost:8000).
- **Static-only hosting** (no Functions/server support at all) won't run the chat or `/api/lead` — only the static pages.
- Both deploy paths share the same underlying logic (`server/chat.mjs`, `server/leads.mjs`, `server/tools.mjs`, `server/knowledge.mjs`) so they can't silently drift apart. `npm test` exercises both the Cloudflare-shaped functions and the real SSE streaming path locally, without needing a live API key — run it after touching anything under `server/` or `functions/`.

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required for the Assistant. Server-side only, never sent to the browser. Must belong to the same OpenAI project as the agent; a restricted key needs `api.agents.read`, `api.agents.write` and `api.responses.write`. |
| `AGENT_ID` | The saved "Ask FrontDesk" agent (`agent_...`, shown in its page URL at platform.openai.com/agents). When set, `/api/chat` answers from that agent through the Agents API. Empty = the Chat Completions fallback below. |
| `AGENT_ALLOWED_DOMAINS` | Optional, comma-separated. Restricts the agent's web search to these domains. Empty = any site. |
| `OPENAI_MODEL` | Chat Completions fallback only (default `gpt-6.1-sol`). With `AGENT_ID` set, the model is the agent's own setting. |
| `OPENAI_BASE_URL` | Default `https://api.openai.com/v1`. |
| `LEAD_WEBHOOK_URL` | Leads from the chat and the intake are POSTed here as JSON (CRM, Zapier, Make, Google Apps Script…). Unset means leads go only to the server log. |

To send the Pricing intake through the same route, set `leadEndpoint: '/api/lead'` in `assets/js/config.js`.

## The Ask FrontDesk Assistant

- **Knowledge:** the server builds the instructions only from approved public content: `content/knowledge.md` (company, products, pricing) and `content/articles.json` (published articles). The browser sends only the conversation. A `system` message sent from the browser is dropped.
- **Behavior:**
  - It answers conversationally from that knowledge and paraphrases articles, linking to them only as an extra.
  - It never claims guaranteed AI rankings, and it never mentions models or APIs.
  - It qualifies visitors and escalates by collecting name and email through a `capture_lead` tool call.
- **Safeguards:** a per-IP rate limit, a message-length cap, a 16-turn history window and a 32 KB body limit. The rate limit is in-memory, so it applies per instance.
- **Streaming:** OpenAI Chat Completions stream to the server (Cloudflare Function or Node process), which relays them to the widget as server-sent events.
- **OpenAI agent (`AGENT_ID`):** with `AGENT_ID` set, `server/agent.mjs` runs each message as a one-turn session on the saved agent (Agents API, no sandbox) and deletes the session afterwards. Persona instructions, model and reasoning come from the agent in the OpenAI dashboard. The approved knowledge and articles are sent with every request, because the Agents API has no knowledge-base upload. Tools are set per session in code (web search plus `capture_lead`), so they override whatever tools the dashboard lists. The reply is relayed to the widget once the turn finishes, not token by token. The widget contract is unchanged.
- **Disclosure:** the chat header says "You're talking to FrontDesk's own Assistant". Spec §4 left that open; I chose to say it.

To change what it knows, edit `content/knowledge.md` or `content/articles.json`, then run `npm run build:knowledge` before redeploying — the Assistant reads from `content/generated-knowledge.js` at request time (a plain-JS build of those two source files), not the source files directly, since the deployed Cloudflare Functions have no filesystem to read them from live.

## Generated pages

Articles live in `content/articles.json`, grouped by pillar (AEO, Assistant, Receptionist, General). The About copy lives in `scripts/build-pages.mjs`. After editing either, regenerate:

```sh
npm run build:pages
```

The hub, article and About pages are generated files; don't edit them by hand. The same articles JSON feeds the Assistant, so the site and the chat stay in sync.

## Motion model

- **Stage, not scroll (home page):** the pages are slides on a fixed stage. One wheel tick, trackpad swipe, arrow key or touch swipe cuts *instantly* to the next or previous page. The outgoing page plays its exit on top while the new page builds itself in underneath. The viewport never travels, nothing tracks a scroll offset, and there is no progress indicator.
- **Input lock:** input is ignored until a switch settles (1.3s) and the wheel has been quiet, so a long swipe or a double flick moves exactly one page.
- **Navigation:** menu links, `#aeo`-style deep links and Home/End all cut straight to a page.
- **Entrance (on arrival, every arrival):** depth layers settle on their own beats:
  1. The photo, which develops from washed-out and, on pillar pages, slides in from the side.
  2. The headline, sharpening from blur word by word. The supporting text follows.
  3. The pillar card, last.
- **Images are decoded before a page can appear:** every story image loads eagerly and is decoded up front, and a cut waits for the target page's images (3s ceiling), so a half-loaded image box never flashes on screen. Image containers are sized by CSS, not by the image.
- **Pillar card:** it swings in from a 3D tilt at 0.84 scale. Once settled, it tilts slightly toward the mouse.
- **Idle:** a slow drift on photos, plus one living detail per pillar: the blinking cursor, the typing dots, the waveform and the page 6 cycle.
- **Exit:** cards lift toward the viewer and fade, photos recede, and on page 1 the mousetrap lifts and rotates away.
- **Fallbacks:** with reduced motion, or on a screen too short for every page to fit (for example 320×568), the story becomes a normal scrolling document. Every page stays legible and image and text still touch.

### About page motion (spec §13)

Only three passages move; everything else on the About page is static type. Each plays once when it scrolls into view, from `assets/js/about.js`:

- **"The modern front desk" (interactive):** a simple desk-and-phone outline dissolves. Four floating shapes, one per verb in the sentence (discovered, available, respond, real work), drift in at different depths and keep floating. Each follows the cursor with a small shift and tilt, and outlines lime on hover.
- **"Our first layer…":** a stack of planes rises beside the text and drifts slowly, each plane at its own speed.
- **"Less time…":** the three "less time" lines float in one after another. (The "More time…" line was cut from the final copy.)

All of this is monochrome apart from the lime hover. With reduced motion, everything shows in its final state.

## Color: a signal layer (spec §6a)

Black and white is the site. Color appears only when something specific is true, as solid color, never more than one accent at a time, and never on body text or as a wash. The tokens are at the top of `styles.css`.

| Color | Meaning | Where it appears |
|---|---|---|
| Lime `#C8FF00` | FrontDesk interaction | Button, chip and nav hover/focus states, Ask FrontDesk article cards on hover/focus (lime edge ring and title underline, same for every pillar), and the eyebrow rule, which draws in lime on each page change and settles to black |
| Cyan `#57E6FF` | AI working | Typing dots in the Assistant demo, and the live chat's typing dots and avatar pulse while it is replying |
| Amber `#FFB547` | Needs action / confirmed | The "Booked" confirmation in the Assistant demo |
| Coral `#FF6B5E` | Escalation / failure | Receptionist "1 passed to staff" flash, the chat's "Passed to the FrontDesk team" note, chat and intake error messages |

AEO and Payoff have no color of their own.

## Layout rule: no dead space

On desktop, each page is a two-column composition that fits within one screen. Checked at 1024×768, 1280×720, 1440×900 and 1920×1080. On phones, the photo runs full-bleed from the top and the copy sits on it with a short paper scrim, so image and text always touch. Checked at 360×740, 390×844 and 414×896.

## Open items

- **Leads:** set `LEAD_WEBHOOK_URL`. Until then, leads from the chat and `/api/lead` only reach the server log. The Pricing intake still sends nothing unless `leadEndpoint` is set.
- **Assistant model:** `gpt-6.1-sol` (explicit choice — quality over cost, since Ask FrontDesk is the first live demo of the Assistant product prospective clients interact with; see the spec's model note), set via `OPENAI_MODEL`. `reasoning_effort` is `'none'`, not a cost choice: this model only supports the `capture_lead` tool through Chat Completions when reasoning_effort is `none` (OpenAI's own model docs), and that tool has to be offered on every turn. Still untested against the **real** OpenAI API — no `OPENAI_API_KEY` is available in the build environment. What's tested: the full streaming + tool-calling plumbing against a local mock OpenAI server (`npm test`), and that both the Node and Cloudflare entry points produce identical behavior. Not tested: an actual reply from the real model, and whether `gpt-6.1-sol` specifically calls `capture_lead` reliably in practice. Do a real smoke test (plain reply + getting it to actually call `capture_lead`) before relying on this for real leads.
- **Ask FrontDesk system prompt:** broadened to match spec §4's full duties (general AI/AEO/automation education, HVAC/plumbing/electrical-primary trade framing, fact-vs-speculation discipline) — previously it only carried the narrower client-Assistant persona. It has no live web-search tool wired in; it's instructed to say plainly when a question needs current external information it can't check, per spec §4's build-implications note. Wiring a real research tool in is a separate, bigger decision — not done here.
- **Hosting:** this site runs on Cloudflare Pages (`functions/api/*.js`). An earlier build had also left behind Vercel-specific files (`vercel.json`, `api/*.mjs`) that would never have actually run on Cloudflare — removed, since they only caused confusion about where this is deployed.
- **Ask FrontDesk:** the five articles are spec §12's first batch, mapped to pillars: AEO ← 1 and 5, Assistant ← 2, Receptionist ← 3 and 4. Article 4's "per the previous article" now reads "as with any missed call" because the articles are separate pages. Who writes future articles, and whether a CMS is needed, is still open.
- **Receptionist:** described as phone only on Pricing and in the Assistant's knowledge. The 15-minute call threshold is internal and appears nowhere public.
- **Amber on Get Started:** spec §6a lists both lime ("CTA states") and amber ("Get Started interaction"). I kept every button's interaction state lime, so there is one brand signal, and used amber only for booking confirmation.
- **Bundles:** whether packages are sold as a bundle is undecided. Pricing shows three standalone prices with no tier flagged.
- **Assets:** the scene images are cropped from the 1456×819 mockups and look soft on large screens. The logo mark is a redrawn vector that should be checked against the master file.

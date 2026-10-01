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

- **Any Node host** (Render, Railway, Fly.io, a VPS): run `npm start` and set the environment variables in the host's dashboard. `server.mjs` serves the site and both API routes.
- **Vercel:** `api/chat.mjs` and `api/lead.mjs` are serverless routes using the same handlers. Static files are served as-is. Set the environment variables in the project settings.
- **Static-only hosting** won't run the chat or `/api/lead`.

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required for the Assistant. Server-side only, never sent to the browser. |
| `OPENAI_MODEL` | Default `gpt-4.1-mini`. |
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
- **Streaming:** OpenAI Chat Completions stream to the server, which relays them to the widget as server-sent events.
- **Disclosure:** the chat header says "You're talking to FrontDesk's own Assistant". Spec §4 left that open; I chose to say it.

To change what it knows, edit `content/knowledge.md` or `content/articles.json` and redeploy.

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
- **"Less time… / More time…":** the three "less time" lines float in one after another. "More time" lands last, with a bigger, slower settle.

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
- **Assistant model:** `gpt-4.1-mini` is a default; pick the model you want in `OPENAI_MODEL`. The Assistant was tested against a mock of the OpenAI streaming API, not the real API.
- **Ask FrontDesk:** the five articles are spec §12's first batch, mapped to pillars: AEO ← 1 and 5, Assistant ← 2, Receptionist ← 3 and 4. Article 4's "per the previous article" now reads "as with any missed call" because the articles are separate pages. Who writes future articles, and whether a CMS is needed, is still open.
- **Receptionist:** described as phone only on Pricing and in the Assistant's knowledge. The 15-minute call threshold is internal and appears nowhere public.
- **Amber on Get Started:** spec §6a lists both lime ("CTA states") and amber ("Get Started interaction"). I kept every button's interaction state lime, so there is one brand signal, and used amber only for booking confirmation.
- **Bundles:** whether packages are sold as a bundle is undecided. Pricing shows three standalone prices with no tier flagged.
- **Assets:** the scene images are cropped from the 1456×819 mockups and look soft on large screens. The logo mark is a redrawn vector that should be checked against the master file.

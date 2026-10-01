# FrontDesk JA — website

A scroll-paged marketing site with a live AI Assistant.

- **Home (`index.html`):** a six-page story: Hero, The Solution, AEO, Assistant, Receptionist, Payoff.
- **Pricing (`pricing.html`):** three packages, plus the sign-up intake.
- **Ask FrontDesk hub (`ask-frontdesk.html`, `ask/*.html`):** knowledge articles by pillar.
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

## Ask FrontDesk articles

Articles live in `content/articles.json`, grouped by pillar (AEO, Assistant, Receptionist, General). After editing, regenerate the pages:

```sh
npm run build:ask
```

The hub and article pages are generated files; don't edit them by hand. The same JSON feeds the Assistant, so the site and the chat stay in sync.

## Motion model

- **Paging (home page):** one wheel tick, trackpad swipe or arrow key moves exactly one page. `main.js` pages on wheel and keys, waiting out trackpad inertia, and `scroll-snap-type: y mandatory` holds pages in place and handles touch. Nothing on screen tracks the scroll offset. The progress line moves one step per page.
- **Entrance:** fires once at about 60% visibility and plays on a timer after the page arrives. Three depth layers settle in turn:
  1. The grey back plate, from furthest away.
  2. The photo, which starts washed out and develops to full contrast. On the pillar pages it slides in from the side.
  3. The headline, sharpening from blur word by word. The supporting text follows.
- **Pillar card:** the record, the chat, the call bar and the page 6 piece each swing in from a 3D tilt at 0.84 scale, and their accent color arrives with them. Once settled, the card tilts slightly toward the mouse.
- **Accents:**
  - AEO `#2F6FED`, Assistant `#7C5CFC`, Receptionist `#FF5A4E`, Less Admin `#F5A623`.
  - Solid colors only, used on demo UI, rules and hover states.
  - Never on the Hero or Solution pages, never on body text.
  - The tokens are at the top of `styles.css`.
- **Idle:** a slow drift on photos, plus one living detail per pillar: the cursor, the typing dots, the waveform and the page 6 cycle.
- **Exit:** cards lift toward the viewer and fade, photos recede, and on page 1 the mousetrap lifts and rotates away.
- **Reduced motion:** everything is visible at rest, with no paging or snap and normal scrolling.

## Layout rule: no dead space

On desktop, each page is a two-column composition that fits within one screen. Checked at 1024×768, 1280×720, 1440×900 and 1920×1080. On phones, the photo runs full-bleed from the top and the copy sits on it with a short paper scrim, so image and text always touch. Checked at 360×740, 390×844 and 414×896.

## Open items

- **Leads:** set `LEAD_WEBHOOK_URL`. Until then, leads from the chat and `/api/lead` only reach the server log. The Pricing intake still sends nothing unless `leadEndpoint` is set.
- **Assistant model:** `gpt-4.1-mini` is a default; pick the model you want in `OPENAI_MODEL`. The Assistant was tested against a mock of the OpenAI streaming API, not the real API.
- **About:** still "Next" in the menu with no page.
- **Ask FrontDesk:** the five articles are spec §12's first batch, mapped to pillars: AEO ← 1 and 5, Assistant ← 2, Receptionist ← 3 and 4. Article 4's "per the previous article" now reads "as with any missed call" because the articles are separate pages. Who writes future articles, and whether a CMS is needed, is still open.
- **Bundles:** whether packages are sold as a bundle is undecided. Pricing shows three standalone prices with no tier flagged.
- **Assets:** the scene images are cropped from the 1456×819 mockups and look soft on large screens. The logo mark is a redrawn vector that should be checked against the master file.

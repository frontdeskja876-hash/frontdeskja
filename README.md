# FrontDesk JA — website

A static, scroll-driven marketing site with six full-screen pages: Hero, The Solution, AEO, Assistant, Receptionist and Payoff/footer. It needs no build step and no framework.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To deploy, upload the folder to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages).

## Structure

```
index.html              all six pages, menu, footer, intake dialog
assets/css/styles.css   layout, type, motion states, responsive rules
assets/js/main.js       IntersectionObserver page states, menu, live details
assets/js/intake.js     conversational Get Started intake
assets/js/config.js     ⚠️ lead endpoint (not configured yet)
assets/img/             scene crops from the approved mockups, mark.svg
assets/fonts/           self-hosted Archivo + Montserrat (variable, latin, OFL)
```

## Motion model

Each `[data-page]` moves through discrete states. None of them are tied to scroll position frame by frame:

- `.is-in` is the entrance. It fires once, when about 40% of the page is in view. The headline lines rise, the image scales and fades in, and the copy follows a beat behind.
- `.is-idle` is the ambient state after the entrance: a slow Ken Burns drift on the scene. Each page also has its own detail. The AEO steps light up in order. The Assistant chat plays through to a booking. The Receptionist call count moves while hold stays at 0. The Payoff gains appear one after another.
- `.is-past` is the exit, toggled while a page is scrolled past. On the hero, the mousetrap lifts, rotates and fades. The other scenes push forward and fade.

Desktop uses `scroll-snap-type: y proximity`. `prefers-reduced-motion` gets a static, fully legible layout with no snapping or animation.

## Open items

- **Leads go nowhere yet.** Set `leadEndpoint` in `assets/js/config.js`. The payload shape is documented there. Until then, the intake completes for the visitor but only logs a console warning.
- **Pricing, Ask FrontDesk and About** appear in the menu with a "Next" tag and no links. They need content.
- **Page 6 image.** `office.jpg` was not provided, so the "quiet office" is built in CSS: a wall with the mark, a floor and a light sweep. Swap in the photo when it's available.
- **Source assets.** The scene images are cropped from the 1456×819 mockups, so they look soft on large or retina screens. Replace them with full-resolution renders (`trap`, `atrium`, `aeo`, `assistant`, `receptionist`) at the same framing. The logo mark is redrawn as a vector (`assets/img/mark.svg`) from the mockup and should be checked against the master logo file.
- **Glass vs flat.** This build follows the mockups. The glass lives in the scene imagery plus two small frosted "live" cards. All UI chrome stays flat black and white. To go fully flat, change `--glass` in `styles.css` to solid white and remove the `backdrop-filter`.

# FrontDesk JA — website

A static, scroll-driven marketing site. The home page is a six-screen story: Hero, The Solution, AEO, Assistant, Receptionist, Payoff. A separate Pricing page sits behind it. There is no build step and no framework.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To deploy, upload the folder to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages).

## Structure

```
index.html              the six-page story, menu, footer
pricing.html            packages + conversational intake (every Get Started lands here)
assets/css/styles.css   layout, type, motion states, pricing, intake, responsive rules
assets/js/main.js       IntersectionObserver page states, headline word split,
                        scroll progress, menu, chat demo, page-6 "desk clears" piece
assets/js/intake.js     conversational intake, opened from a package
assets/js/config.js     ⚠️ lead endpoint (not configured yet)
assets/img/             scene crops from the approved mockups, mark.svg
assets/fonts/           self-hosted Archivo + Montserrat (variable, latin, OFL)
```

## Motion model

Each `[data-page]` moves through discrete states. None of them are tied to scroll position frame by frame:

- **`.is-in` (entrance, once).** The headline sharpens from blur to solid black, word by word. The eyebrow, supporting text and CTA rise and fade in a beat behind it. The photo or panel starts washed out and develops to full contrast. On AEO, Assistant and Receptionist, the panel slides in from the right while the copy holds still.
- **`.is-idle` (while resting).** A slow drift plays on the photography. Each capability page has one living detail: a blinking cursor in the AEO record, the typing indicator in the Assistant chat (the chat plays through to a booking), and the call waveform on Receptionist.
- **`.is-past` (exit).** The page lifts, fades and recedes while the next page enters. On page 1, the mousetrap lifts, rotates and fades.

Supporting motion: a scroll-progress line runs under the floating pill nav, cards lift slightly on hover, and the three gains on page 6 enter left to right. Everything animates `transform` and `opacity` only, except the headline blur. With `prefers-reduced-motion`, every element is visible at rest and nothing moves.

### Page 6: "The desk clears"

The page 6 piece is my proposal for the open item in spec §10. Five open admin items sit in a loose pile: a missed call, an unread message, a booking request, a quote follow-up and an after-hours enquiry. A status line counts "5 waiting". The items are handled one at a time: each gets a black tick and falls into a neat column. Then the column lifts away, leaving open space, the FrontDesk mark breathing slowly and "All caught up". The cycle repeats every ~16s. It is drawn in black, white and grey with soft shadows, and uses no footage.

## Open items

- **Leads go nowhere yet.** Set `leadEndpoint` in `assets/js/config.js`; the payload shape is documented there. Until then, the intake completes for the visitor but only logs a console warning.
- **Pricing is draft copy from spec §11 and needs review.** Only the Assistant ($149.99/month) has a price. AEO and Receptionist show "Pricing coming soon" with a Contact us button. The currency isn't stated anywhere. Pricing is linked in the menu because every Get Started button leads there.
- **Ask FrontDesk and About** still show "Next" in the menu and have no pages.
- **Source assets.** The scene images are cropped from the 1456×819 mockups, so they look soft on large or retina screens. Replace them with full-resolution renders at the same framing. The logo mark is redrawn as a vector (`assets/img/mark.svg`) and should be checked against the master file.
- **Glass vs flat.** The UI is now flat, following spec §6: solid white cards, soft shadows, no blur, glow or gradients. The glass stays only inside the mockup photography.

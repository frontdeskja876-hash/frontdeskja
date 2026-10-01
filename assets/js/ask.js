/*
 * Ask FrontDesk — the floating live Assistant, present on every page.
 * This is FrontDesk JA's own instance of the Assistant product. Replies stream from
 * /api/chat (server/handlers.mjs), which holds the OpenAI key server-side.
 *
 * Any element with [data-ask] opens the chat; add data-ask-question="..." to send a
 * question straight away (used by the Ask FrontDesk article pages).
 */
(function () {
  'use strict';

  var cfg = window.FRONTDESK_CONFIG || {};
  var scriptSrc = (document.currentScript && document.currentScript.src) || location.href;
  var siteBase = new URL('../../', scriptSrc); // assets/js/ask.js → site root
  var endpoint = cfg.chatEndpoint || new URL('api/chat', siteBase).href;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var STORE = 'fd-ask-v1';
  var GREETING = 'Hi, I’m FrontDesk’s own Assistant, the same one businesses get on the Assistant plan. Ask me anything about AEO, the Assistant, the Receptionist or pricing.';
  var SUGGESTIONS = ['What does AEO actually do?', 'How much is the Receptionist?', 'Chatbot vs digital front desk?'];

  /* ---------- markup ---------- */
  var mark = '<svg viewBox="0 0 61 43" aria-hidden="true"><path fill="currentColor" d="M1 2h42a16.5 19.25 0 0 1 0 38.5H22v-8h21a8 11.25 0 0 0 0-22.5H1z"/><path fill="currentColor" d="M1 17.5h33v8H9.5v15H1z"/></svg>';
  var wrap = document.createElement('div');
  wrap.className = 'ask';
  wrap.innerHTML =
    '<button class="ask__fab" type="button" aria-expanded="false" aria-controls="ask-panel">' +
      '<span class="ask__fab-icon">' + mark + '</span><span class="ask__fab-label">Ask FrontDesk</span>' +
    '</button>' +
    '<section class="ask__panel" id="ask-panel" role="dialog" aria-modal="false" aria-labelledby="ask-title" hidden>' +
      '<header class="ask__head">' +
        '<span class="ask__avatar">' + mark + '</span>' +
        '<div class="ask__who"><p class="ask__title" id="ask-title">Ask FrontDesk</p>' +
        '<p class="ask__sub">You’re talking to FrontDesk’s own Assistant</p></div>' +
        '<button class="ask__close" type="button" aria-label="Close chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>' +
      '</header>' +
      '<div class="ask__log" aria-live="polite"></div>' +
      '<div class="ask__suggest" role="group" aria-label="Suggested questions"></div>' +
      '<form class="ask__form">' +
        '<label class="sr" for="ask-input">Message</label>' +
        '<textarea id="ask-input" class="ask__input" rows="1" maxlength="2000" placeholder="Ask a question…" autocomplete="off"></textarea>' +
        '<button class="ask__send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4 12h15m-6-6 6 6-6 6"/></svg></button>' +
      '</form>' +
    '</section>';
  document.body.appendChild(wrap);

  var fab = wrap.querySelector('.ask__fab');
  var panel = wrap.querySelector('.ask__panel');
  var log = wrap.querySelector('.ask__log');
  var suggest = wrap.querySelector('.ask__suggest');
  var form = wrap.querySelector('.ask__form');
  var input = wrap.querySelector('.ask__input');
  var sendBtn = wrap.querySelector('.ask__send');
  var closeBtn = wrap.querySelector('.ask__close');

  var history = load();
  var busy = false;

  /* ---------- persistence (this tab only) ---------- */
  function load() {
    try { var h = JSON.parse(sessionStorage.getItem(STORE) || '[]'); return Array.isArray(h) ? h : []; }
    catch (e) { return []; }
  }
  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-30))); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- rendering ---------- */
  // Plain text in; links to site pages and https URLs become anchors. Never innerHTML user text.
  function renderText(el, text) {
    el.textContent = '';
    var re = /(https?:\/\/[^\s)]+|\/(?:ask\/[\w-]+\.html|pricing\.html|about\.html|ask-frontdesk\.html))/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      var raw = m[0].replace(/[.,]$/, '');
      a.href = raw.charAt(0) === '/' ? new URL(raw.slice(1), siteBase).href : raw;
      a.textContent = raw.charAt(0) === '/' ? linkLabel(raw) : raw;
      if (raw.charAt(0) !== '/') { a.target = '_blank'; a.rel = 'noopener'; }
      el.appendChild(a);
      last = m.index + raw.length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }
  function linkLabel(path) {
    if (path === '/pricing.html') return 'Pricing';
    if (path === '/ask-frontdesk.html') return 'Ask FrontDesk articles';
    if (path === '/about.html') return 'About FrontDesk JA';
    return 'Read the article';
  }

  function bubble(role, text) {
    var el = document.createElement('div');
    el.className = 'ask__msg ask__msg--' + role;
    if (text) renderText(el, text);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function typing() {
    var el = document.createElement('div');
    el.className = 'ask__msg ask__msg--bot ask__msg--typing';
    el.setAttribute('aria-label', 'FrontDesk is typing');
    el.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function note(text, kind) {
    var el = document.createElement('p');
    el.className = 'ask__note' + (kind ? ' ask__note--' + kind : '');
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function renderAll() {
    log.innerHTML = '';
    bubble('bot', GREETING);
    history.forEach(function (m) { bubble(m.role === 'user' ? 'user' : 'bot', m.content); });
    suggest.innerHTML = '';
    if (!history.length) {
      SUGGESTIONS.forEach(function (q) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ask__chip';
        b.textContent = q;
        b.addEventListener('click', function () { ask(q); });
        suggest.appendChild(b);
      });
    }
  }

  /* ---------- talking to the server ---------- */
  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    suggest.innerHTML = '';
    input.value = '';
    autosize();
    history.push({ role: 'user', content: text });
    save();
    bubble('user', text);
    var dots = typing();
    var out = null, reply = '';

    function fail(message) {
      dots.remove();
      if (out && reply) { history.push({ role: 'assistant', content: reply }); save(); }
      bubble('bot', message).classList.add('ask__msg--error'); // coral: a failed action
      finish();
    }
    function finish() { busy = false; sendBtn.disabled = false; wrap.classList.remove('is-thinking'); if (!panel.hidden) input.focus({ preventScroll: true }); }
    wrap.classList.add('is-thinking'); // cyan pulse while the Assistant is working

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ messages: history })
    }).then(function (r) {
      if (r.status === 429) return fail('You’ve sent a lot of messages in a short time. Please wait a few minutes and try again.');
      if (!r.ok || !r.body) return fail('I’m not connected on this version of the site yet. To reach the team, use Get Started on the pricing page.');

      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return end();
          buf += decoder.decode(chunk.value, { stream: true });
          var parts = buf.split('\n\n');
          buf = parts.pop();
          for (var i = 0; i < parts.length; i++) {
            var line = parts[i].trim();
            if (line.indexOf('data:') !== 0) continue;
            var ev;
            try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
            if (ev.type === 'delta') {
              if (!out) { dots.remove(); out = bubble('bot', ''); }
              reply += ev.text;
              renderText(out, reply);
              log.scrollTop = log.scrollHeight;
            } else if (ev.type === 'lead') {
              note('Passed to the FrontDesk team. A person will follow up.', 'escalate'); // coral: human handoff
            } else if (ev.type === 'error') {
              return fail(ev.code === 'unconfigured'
                ? 'I’m not connected on this version of the site yet. To reach the team, use Get Started on the pricing page.'
                : 'Something went wrong on our side. Please try again in a moment.');
            }
          }
          return pump();
        });
      }
      function end() {
        if (!out) return fail('I didn’t catch that. Could you try asking again?');
        history.push({ role: 'assistant', content: reply });
        save();
        finish();
      }
      return pump();
    }).catch(function () {
      fail('I can’t reach the server right now. Check your connection and try again.');
    });
  }

  /* ---------- open / close ---------- */
  function open(question) {
    if (panel.hidden) {
      panel.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      renderAll();
    }
    if (question) ask(question);
    else input.focus({ preventScroll: true });
  }
  function close() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('is-open');
    fab.focus({ preventScroll: true });
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  fab.addEventListener('click', function () { panel.hidden ? open() : close(); });
  closeBtn.addEventListener('click', close);
  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); }
  });
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-ask]');
    if (!t) return;
    e.preventDefault();
    open(t.getAttribute('data-ask-question') || '');
  });

  if (reduceMotion.matches) wrap.classList.add('is-still');
})();

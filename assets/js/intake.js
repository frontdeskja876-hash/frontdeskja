/*
 * FrontDesk JA — conversational intake, opened from a package on the Pricing page.
 * One question at a time; ends with a summary of what was collected.
 * Submission target is window.FRONTDESK_CONFIG.leadEndpoint (see config.js).
 */
(function () {
  'use strict';

  var root = document.getElementById('intake');
  if (!root) return;

  var log = root.querySelector('.intake__log');
  var chipsEl = root.querySelector('.intake__chips');
  var form = root.querySelector('.intake__form');
  var input = root.querySelector('.intake__input');
  var send = root.querySelector('.intake__send');
  var skip = root.querySelector('.intake__skip');
  var errorEl = root.querySelector('.intake__error');
  var progress = root.querySelector('.intake__progress span');
  var closeBtn = root.querySelector('.intake__close');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var questions = [
    { key: 'name', label: 'Name',
      ask: function () {
        var name = pkg.split(' — ')[0];
        return pkg && pkg !== GENERAL
          ? 'Hi, I’m FrontDesk. Let’s get you set up with ' + name + '. What’s your name?'
          : 'Hi, I’m FrontDesk. Let’s get you set up. What’s your name?';
      },
      placeholder: 'Your name', autocomplete: 'name' },
    { key: 'business', label: 'Business',
      ask: function (a) { return 'Nice to meet you, ' + firstName(a.name) + '. What’s the name of your business?'; },
      placeholder: 'Business name', autocomplete: 'organization' },
    { key: 'businessType', label: 'Type',
      ask: function (a) { return 'What kind of business is ' + a.business + '?'; },
      chips: ['Services & trades', 'Clinic or wellness', 'Restaurant or bar', 'Retail or shop', 'Professional services'],
      placeholder: 'Or describe it in your own words' },
    { key: 'location', label: 'Location',
      ask: function () { return 'Where are you located?'; },
      placeholder: 'e.g. Kingston, St. Andrew', autocomplete: 'address-level2' },
    { key: 'problem', label: 'Biggest cost',
      ask: function () { return 'Which of these is costing you the most right now?'; },
      chips: ['Customers can’t find us', 'Messages go unanswered', 'Calls get missed', 'Too much admin'],
      placeholder: 'Or tell me in your own words' },
    { key: 'email', label: 'Email',
      ask: function () { return 'Got it. What’s the best email to reach you?'; },
      placeholder: 'you@business.com', type: 'email', autocomplete: 'email',
      validate: function (v) { return EMAIL.test(v) ? '' : 'That doesn’t look like a complete email address — mind checking it?'; } },
    { key: 'phone', label: 'Phone', optional: true,
      ask: function () { return 'And a phone number, if you’d like a call? This one’s optional.'; },
      placeholder: 'Phone (optional)', type: 'tel', autocomplete: 'tel',
      validate: function (v) { return /^[+()\d\s.-]{7,}$/.test(v) ? '' : 'That number looks incomplete — add it again, or skip this one.'; } }
  ];

  var GENERAL = 'General enquiry';
  var answers, index, busy, lastFocus, pkg = GENERAL;

  function firstName(n) { return String(n || '').trim().split(/\s+/)[0]; }

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function addMsg(kind, text) {
    var el = document.createElement('div');
    el.className = 'msg msg--' + kind;
    el.textContent = text;
    log.appendChild(el);
    scrollDown();
    return el;
  }

  function botSay(text, then) {
    if (reduceMotion.matches) { addMsg('bot', text); if (then) then(); return; }
    var t = document.createElement('div');
    t.className = 'msg msg--bot msg--typing';
    t.setAttribute('aria-label', 'FrontDesk is typing');
    t.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(t);
    scrollDown();
    setTimeout(function () {
      t.remove();
      addMsg('bot', text);
      if (then) then();
    }, Math.min(1200, 450 + text.length * 12));
  }

  function setProgress() {
    progress.style.transform = 'scaleX(' + (index / questions.length).toFixed(3) + ')';
  }

  function renderChips(list) {
    chipsEl.innerHTML = '';
    (list || []).forEach(function (label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.addEventListener('click', function () { answer(label); });
      chipsEl.appendChild(b);
    });
  }

  function ask() {
    var q = questions[index];
    busy = true;
    setProgress();
    renderChips(null);
    form.hidden = false;
    input.value = '';
    input.disabled = true;
    send.disabled = true;
    skip.hidden = true;
    errorEl.textContent = '';
    botSay(q.ask(answers), function () {
      busy = false;
      renderChips(q.chips);
      input.type = q.type || 'text';
      input.placeholder = q.placeholder || '';
      input.setAttribute('autocomplete', q.autocomplete || 'off');
      input.setAttribute('inputmode', q.type === 'email' ? 'email' : q.type === 'tel' ? 'tel' : 'text');
      input.disabled = false;
      send.disabled = false;
      skip.hidden = !q.optional;
      input.focus({ preventScroll: true });
    });
  }

  function answer(value) {
    if (busy) return;
    var q = questions[index];
    value = String(value).trim();

    if (!value) {
      errorEl.textContent = q.optional ? 'Type a number, or tap Skip.' : 'Just need an answer here to keep going.';
      input.focus();
      return;
    }
    var problem = q.validate ? q.validate(value) : '';
    if (problem) {
      errorEl.textContent = problem;
      input.focus();
      return;
    }
    errorEl.textContent = '';
    answers[q.key] = value;
    addMsg('user', value);
    next();
  }

  function next() {
    index++;
    if (index < questions.length) ask();
    else finish();
  }

  function finish() {
    busy = true;
    setProgress();
    renderChips(null);
    form.hidden = true;
    skip.hidden = true;

    botSay('Thanks, ' + firstName(answers.name) + '. Here’s what I have:', function () {
      var card = document.createElement('div');
      card.className = 'msg summary';
      var dl = document.createElement('dl');
      [{ key: 'package', label: 'Interested in' }].concat(questions).forEach(function (q) {
        var dt = document.createElement('dt');
        var dd = document.createElement('dd');
        dt.textContent = q.label;
        dd.textContent = answers[q.key] || '—';
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      card.appendChild(dl);
      log.appendChild(card);
      scrollDown();

      submit(answers).then(function (ok) {
        botSay(ok
          ? 'A person from FrontDesk will follow up with you shortly. Talk soon.'
          : 'Something went wrong sending this over. Please try again in a moment.', function () {
          showDone(ok);
        });
      });
    });
  }

  function showDone(ok) {
    var wrap = document.createElement('div');
    wrap.className = 'intake__done';
    var primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'btn';
    if (ok) {
      primary.textContent = 'Back to pricing';
      primary.addEventListener('click', close);
    } else {
      primary.textContent = 'Try again';
      primary.addEventListener('click', function () {
        wrap.remove();
        submit(answers).then(function (ok2) {
          botSay(ok2 ? 'Sent. A person from FrontDesk will follow up with you shortly.' : 'Still not getting through — please try again later.', function () { showDone(ok2); });
        });
      });
    }
    var restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'btn btn--ghost';
    restart.textContent = 'Start over';
    restart.addEventListener('click', start);
    wrap.appendChild(primary);
    wrap.appendChild(restart);
    form.parentNode.insertBefore(wrap, form);
    scrollDown();
    primary.focus({ preventScroll: true });
  }

  function submit(data) {
    var cfg = window.FRONTDESK_CONFIG || {};
    var payload = Object.assign({}, data, { source: 'website-intake', submittedAt: new Date().toISOString() });

    if (!cfg.leadEndpoint) {
      // Not wired to a destination yet — see assets/js/config.js.
      if (window.console) console.warn('[FrontDesk intake] leadEndpoint is not configured; lead was not sent.', payload);
      return Promise.resolve(true);
    }
    return fetch(cfg.leadEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  function start() {
    answers = { package: pkg };
    index = 0;
    log.innerHTML = '';
    var done = root.querySelector('.intake__done');
    if (done) done.remove();
    ask();
  }

  function open(chosen) {
    lastFocus = document.activeElement;
    root.hidden = false;
    document.body.classList.add('is-locked');
    var changed = (chosen || GENERAL) !== pkg;
    pkg = chosen || GENERAL;
    if (!answers || changed || root.querySelector('.intake__done')) start();
    else if (!busy) input.focus();
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove('is-locked');
    if (root.querySelector('.intake__done')) answers = null; // finished: next open starts fresh
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); answer(input.value); });
  skip.addEventListener('click', function () {
    if (busy) return;
    addMsg('user', 'Skip');
    errorEl.textContent = '';
    next();
  });
  closeBtn.addEventListener('click', close);
  root.addEventListener('click', function (e) { if (e.target === root) close(); });

  document.addEventListener('keydown', function (e) {
    if (root.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') { // keep focus inside the dialog
      var f = root.querySelectorAll('button:not([hidden]):not(:disabled), input:not(:disabled)');
      f = Array.prototype.filter.call(f, function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-intake]');
    if (!trigger) return;
    e.preventDefault();
    open(trigger.getAttribute('data-intake'));
  });
})();

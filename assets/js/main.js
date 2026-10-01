/*
 * FrontDesk JA — page stage, page motion, navigation and the small "living" details.
 *
 * Story page: the pages are slides on a fixed stage, never a scrolling document.
 * One gesture (wheel tick, trackpad swipe, arrow key, touch swipe) cuts instantly to
 * the next/previous page: the outgoing page plays its exit on top while the new page
 * builds itself in underneath. The viewport never travels between pages, nothing
 * tracks a scroll offset, and input is locked until the switch has settled.
 *
 * Each page then moves through discrete, time-based states:
 *   .is-current  the page on stage
 *   .is-in       entrance: plays on arrival
 *   .is-idle     ambient loop after the entrance settles
 *   .is-leaving  exit: the outgoing page, briefly, on top
 *
 * Fallback: with reduced motion, or a screen too short for any page to fit, the
 * story becomes a normal stacked document and entrances fire as pages scroll in.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var isStory = root.classList.contains('story');
  var pages = Array.prototype.slice.call(document.querySelectorAll('[data-page]'));
  var stops = isStory ? Array.prototype.slice.call(document.querySelectorAll('[data-stop]')) : [];
  var idle = {};    // page id → function(page) that starts its living detail and returns a stop()
  var stoppers = {};

  var SWITCH_LOCK = 1300; // ms: input ignored while a switch settles
  var EXIT_MS = 900;
  var IDLE_AFTER = 1500;

  /* ---------- Headlines: wrap each word so it can sharpen in on its own beat ---------- */
  document.querySelectorAll('.headline').forEach(function (h) {
    var i = 0;
    h.querySelectorAll('.ln > span').forEach(function (line) {
      var words = line.textContent.trim().split(/\s+/);
      line.textContent = '';
      words.forEach(function (w, n) {
        var s = document.createElement('span');
        s.className = 'w';
        s.style.setProperty('--i', i++);
        s.textContent = w;
        line.appendChild(s);
        if (n < words.length - 1) line.appendChild(document.createTextNode(' '));
      });
    });
  });

  /* ---------- Entrance / idle / reset ---------- */
  var idleTimers = new Map();

  function enter(page) {
    if (page.classList.contains('is-in')) return;
    page.classList.add('is-in');
    clearTimeout(idleTimers.get(page));
    idleTimers.set(page, setTimeout(function () {
      page.classList.add('is-idle');
      if (idle[page.id] && !stoppers[page.id]) stoppers[page.id] = idle[page.id](page) || null;
    }, reduceMotion.matches ? 0 : IDLE_AFTER));
  }

  // Put a page back to its pre-entrance state without animating, so it can play again.
  function reset(page) {
    clearTimeout(idleTimers.get(page));
    if (stoppers[page.id]) { stoppers[page.id](); stoppers[page.id] = null; }
    page.classList.add('no-anim');
    page.classList.remove('is-in', 'is-idle', 'is-leaving');
    void page.offsetWidth;
    page.classList.remove('no-anim');
  }

  /* ---------- Images: decoded before their page can appear ----------
     Every story image starts loading and decoding up front. A page only becomes
     current once its images are fully decoded, so the cut never shows an empty or
     half-painted image box. (A 3s ceiling keeps a failed image from freezing the deck.) */
  var DECODE_TIMEOUT = 3000;
  var decoded = stops.map(function () { return false; });
  var ready = stops.map(function (s, i) {
    var imgs = Array.prototype.slice.call(s.querySelectorAll('img'));
    return Promise.all(imgs.map(function (img) {
      img.loading = 'eager';
      if (img.decode) return img.decode().catch(function () {});
      return new Promise(function (res) { if (img.complete) res(); else { img.onload = img.onerror = res; } });
    })).then(function () { decoded[i] = true; });
  });
  function whenReady(i, fn) {
    if (decoded[i]) { fn(); return; }
    var done = false;
    var run = function () { if (!done) { done = true; fn(); } };
    ready[i].then(run);
    setTimeout(run, DECODE_TIMEOUT);
  }

  /* ---------- Stage (story page) ---------- */
  var staged = false;
  var current = 0;
  var locked = false;
  var lockUntil = 0;
  var lastInput = 0;
  var acc = 0;

  // Layout boxes only (offsets ignore the entrance transforms, which overhang on purpose).
  function allFit() {
    return stops.every(function (s) {
      var h = s.clientHeight;
      return Array.prototype.every.call(s.children, function (c) {
        return c.offsetParent !== s || c.offsetTop + c.offsetHeight <= h + 2;
      });
    });
  }

  function setupStage() {
    if (!isStory) return;
    var want = !reduceMotion.matches;
    if (want) {
      root.classList.add('staged');
      if (!allFit()) want = false; // a page doesn't fit this screen: read it as a document
    }
    if (want === staged && staged) return;
    staged = want;
    root.classList.toggle('staged', staged);

    if (staged) {
      var fromHash = stops.findIndex(function (s) { return '#' + s.id === location.hash; });
      current = fromHash >= 0 ? fromHash : current;
      stops.forEach(function (s, i) {
        s.classList.toggle('is-current', i === current);
        s.setAttribute('aria-hidden', i === current ? 'false' : 'true');
        if (i !== current) reset(s);
      });
      window.scrollTo(0, 0);
      var first = current;
      whenReady(first, function () { requestAnimationFrame(function () { if (current === first) enter(stops[first]); }); });
      document.body.classList.toggle('is-scrolled', current > 0);
    } else {
      stops.forEach(function (s) { s.classList.remove('is-current', 'is-leaving'); s.removeAttribute('aria-hidden'); });
      observe();
    }
  }

  function go(index, opts) {
    index = Math.max(0, Math.min(stops.length - 1, index));
    if (!staged || index === current) return;
    if (locked && !(opts && opts.force)) return;
    locked = true;
    lockUntil = Date.now() + SWITCH_LOCK;
    var target = index;
    // never cut to a page whose image hasn't finished decoding
    whenReady(target, function () { cut(target, opts); });
  }

  function cut(index, opts) {
    if (index === current) { release(); return; }
    var from = stops[current];
    var to = stops[index];
    locked = true;
    lockUntil = Date.now() + SWITCH_LOCK;

    // outgoing page: stays visible on top for its exit, then resets
    from.classList.remove('is-current');
    from.classList.add('is-leaving');
    from.setAttribute('aria-hidden', 'true');
    if (stoppers[from.id]) { stoppers[from.id](); stoppers[from.id] = null; }
    setTimeout(function () { if (!from.classList.contains('is-current')) reset(from); }, EXIT_MS);

    // incoming page: the cut is instant; only its content animates
    reset(to);
    to.classList.add('is-current');
    to.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { requestAnimationFrame(function () { enter(to); }); });

    current = index;
    document.body.classList.toggle('is-scrolled', current > 0);
    if (history.replaceState) history.replaceState(null, '', index === 0 ? location.pathname + location.search : '#' + to.id);
    var focusTarget = to.querySelector('h1, h2, .footer__line');
    if (focusTarget && opts && opts.focus) { focusTarget.setAttribute('tabindex', '-1'); focusTarget.focus({ preventScroll: true }); }
    release();
  }

  // Unlock only after the switch has settled AND the wheel has gone quiet, so a
  // trackpad's inertia tail can't trigger a second page.
  function release() {
    var now = Date.now();
    var wait = Math.max(lockUntil - now, 260 - (now - lastInput));
    if (wait > 0) { setTimeout(release, wait); return; }
    locked = false; acc = 0;
  }

  function overlayOpen(target) {
    if (document.body.classList.contains('is-locked')) return true; // menu or intake
    return !!(target && target.closest && target.closest('.ask__panel, .menu, .intake'));
  }

  if (isStory) {
    window.addEventListener('wheel', function (e) {
      if (!staged || e.ctrlKey || overlayOpen(e.target)) return;
      e.preventDefault();
      var now = Date.now();
      if (now - lastInput > 300) acc = 0;
      lastInput = now;
      if (locked) return;
      acc += e.deltaY;
      if (Math.abs(acc) >= 24) go(current + (acc > 0 ? 1 : -1));
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (!staged || overlayOpen(e.target) || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      var dir = 0;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey && !/^(BUTTON|A)$/.test(t.tagName))) dir = 1;
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) dir = -1;
      else if (e.key === 'Home') { e.preventDefault(); lastInput = Date.now(); return go(0, { focus: true }); }
      else if (e.key === 'End') { e.preventDefault(); lastInput = Date.now(); return go(stops.length - 1, { focus: true }); }
      if (!dir) return;
      e.preventDefault();
      lastInput = Date.now();
      go(current + dir, { focus: true });
    });

    var touchY = null;
    window.addEventListener('touchstart', function (e) {
      touchY = (!staged || overlayOpen(e.target)) ? null : e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (touchY !== null && staged) e.preventDefault(); // no native scroll glide
    }, { passive: false });
    window.addEventListener('touchend', function (e) {
      if (touchY === null) return;
      var dy = touchY - e.changedTouches[0].clientY;
      touchY = null;
      if (Math.abs(dy) < 40) return;
      lastInput = Date.now();
      go(current + (dy > 0 ? 1 : -1));
    });

    // In-page links (#aeo etc.) cut straight to that page
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a || !staged) return;
      var idx = stops.indexOf(document.getElementById(a.getAttribute('href').slice(1)));
      if (idx < 0) return;
      e.preventDefault();
      setTimeout(function () { go(idx, { force: true, focus: true }); }, 0);
    });
    window.addEventListener('hashchange', function () {
      var idx = stops.findIndex(function (s) { return '#' + s.id === location.hash; });
      if (idx >= 0) go(idx, { force: true });
    });

    var resizeT;
    window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(setupStage, 200); });
    reduceMotion.addEventListener && reduceMotion.addEventListener('change', setupStage);
  }

  /* ---------- Document mode (other pages, and the story's fallback) ---------- */
  var io = null;
  function observe() {
    if (io || !('IntersectionObserver' in window)) { if (!io) pages.forEach(enter); return; }
    io = new IntersectionObserver(function (entries) {
      if (staged) return;
      entries.forEach(function (e) {
        var vh = e.rootBounds ? e.rootBounds.height : window.innerHeight;
        var cover = e.intersectionRect.height / Math.min(vh, e.boundingClientRect.height);
        if (cover >= 0.6) enter(e.target);
      });
    }, { threshold: [0, 0.3, 0.6, 0.9] });
    pages.forEach(function (p) { io.observe(p); });
  }

  if (isStory) setupStage(); else observe();
  if (!staged) {
    var onScroll = function () { document.body.classList.toggle('is-scrolled', window.scrollY > 24); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Menu ---------- */
  var burger = document.querySelector('.burger');
  var menu = document.getElementById('menu');
  var lastFocus = null;
  function setMenu(open) {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.hidden = !open;
    document.body.classList.toggle('is-locked', open);
    if (open) {
      lastFocus = document.activeElement;
      var first = menu.querySelector('a');
      if (first) first.focus();
    } else if (lastFocus) {
      lastFocus.focus({ preventScroll: true });
    }
  }
  if (burger && menu) {
    burger.addEventListener('click', function () { setMenu(menu.hidden); });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a[href]') || e.target.closest('[data-intake]')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) setMenu(false);
    });
  }

  /* ---------- Mouse-aware tilt on the one pillar card per page ---------- */
  if (finePointer.matches && !reduceMotion.matches) {
    pages.forEach(function (page) {
      var card = page.querySelector('[data-tilt]');
      if (!card) return;
      var raf = 0;
      page.addEventListener('pointermove', function (e) {
        if (!page.classList.contains('is-idle') || raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = card.getBoundingClientRect();
          var x = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
          var y = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
          card.style.setProperty('--ry', (x * 10).toFixed(2) + 'deg');
          card.style.setProperty('--rx', (-y * 8).toFixed(2) + 'deg');
        });
      });
      page.addEventListener('pointerleave', function () {
        card.style.setProperty('--ry', '0deg');
        card.style.setProperty('--rx', '0deg');
      });
    });
  }

  /* ---------- Page 4: a conversation that ends in a booking ----------
     Cyan appears only while the Assistant is "thinking" (the typing pulse);
     amber only on the booking confirmation. */
  var script = [
    ['them', 'Hi, my AC isn’t cooling. Can someone take a look?'],
    ['us', 'I can help with that. What’s the service address?'],
    ['them', '14 Hope Road, Kingston 10'],
    ['us', 'Thanks. A technician is free tomorrow at 10:00 AM or 2:00 PM. Which works?'],
    ['them', '10 works'],
    ['booked', 'Booked: AC repair, tomorrow 10:00 AM']
  ];

  idle.assistant = function (page) {
    var body = page.querySelector('.live-chat__body');
    if (!body) return null;
    var timers = [];
    var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    function bubble(kind, text) {
      var el = document.createElement('div');
      el.className = 'bubble bubble--' + kind;
      if (text) el.textContent = text;
      return el;
    }
    body.innerHTML = '';
    if (reduceMotion.matches) {
      script.slice(-4).forEach(function (s) { body.appendChild(bubble(s[0], s[1])); });
      return null;
    }
    var i = 0;
    function step() {
      if (i === script.length) { later(function () { body.innerHTML = ''; i = 0; step(); }, 4500); return; }
      var s = script[i++];
      var typingEl = null;
      if (s[0] === 'us') {
        typingEl = bubble('us bubble--typing');
        typingEl.innerHTML = '<i></i><i></i><i></i>';
        body.appendChild(typingEl);
      }
      later(function () {
        if (typingEl) typingEl.remove();
        body.appendChild(bubble(s[0], s[1]));
        while (body.children.length > 4) body.removeChild(body.firstChild);
        later(step, s[0] === 'them' ? 700 : 1600);
      }, typingEl ? 1400 : 0);
    }
    step();
    return function () { timers.forEach(clearTimeout); };
  };

  /* ---------- Page 5: every so often one call needs a person ----------
     The waveform is the living detail; coral flashes only for the moment a call
     escalates to staff, then recedes. */
  idle.receptionist = function (page) {
    var bar = page.querySelector('.live-calls');
    if (!bar || reduceMotion.matches) return null;
    var t1, t2;
    function cycle() {
      t1 = setTimeout(function () {
        bar.classList.add('is-escalating');
        t2 = setTimeout(function () { bar.classList.remove('is-escalating'); cycle(); }, 2600);
      }, 4200);
    }
    cycle();
    return function () { clearTimeout(t1); clearTimeout(t2); bar.classList.remove('is-escalating'); };
  };

  /* ---------- Page 6: the desk clears ----------
     Open admin items sit in a loose pile. One by one they're handled (tick, then they
     fall into a neat column). Then the column lifts away, leaving open space and the
     mark. Loops slowly. */
  idle.payoff = function (page) {
    var settle = page.querySelector('.settle');
    if (!settle) return null;
    // only the tiles this layout shows (phones show three)
    var tiles = Array.prototype.filter.call(settle.querySelectorAll('.settle__tiles li'), function (t) {
      return getComputedStyle(t).display !== 'none';
    });
    var status = settle.querySelector('[data-settle-status]');
    var total = tiles.length;
    function setStatus(text) { if (status) status.textContent = text; }
    function clear() {
      settle.classList.remove('is-clear');
      tiles.forEach(function (t) { t.classList.remove('is-done'); });
      setStatus(total + ' waiting');
    }

    if (reduceMotion.matches) {
      tiles.forEach(function (t) { t.classList.add('is-done'); });
      setStatus(total + ' handled · 0 waiting');
      return null;
    }
    var timers = [];
    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function cycle() {
      timers.forEach(clearTimeout); timers = [];
      clear();
      var t0 = 1600;
      tiles.forEach(function (tile, n) {
        at(t0 + n * 1100, function () {
          tile.classList.add('is-done');
          setStatus((n + 1) + ' handled · ' + (total - n - 1) + ' waiting');
        });
      });
      var tEnd = t0 + total * 1100 + 2400;
      at(tEnd, function () { settle.classList.add('is-clear'); setStatus('All caught up'); });
      at(tEnd + 6000, cycle);
    }
    cycle();
    return function () { timers.forEach(clearTimeout); clear(); };
  };

  /* ---------- misc ---------- */
  document.querySelectorAll('[data-year]').forEach(function (y) { y.textContent = new Date().getFullYear(); });
})();

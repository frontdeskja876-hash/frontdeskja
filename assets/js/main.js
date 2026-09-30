/*
 * FrontDesk JA — page motion, navigation and the small "living" details.
 *
 * Each page moves through discrete states, never tied frame-by-frame to scroll:
 *   .is-in   entrance — added once when the page is mostly in view
 *   .is-idle ambient loops — added after the entrance has settled
 *   .is-past exit — toggled while the page has been scrolled past
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var pages = Array.prototype.slice.call(document.querySelectorAll('[data-page]'));
  var onIdle = {};

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
    h.style.setProperty('--words', i);
  });

  /* ---------- Page states ---------- */
  function enter(page) {
    if (page.classList.contains('is-in') && page.classList.contains('is-idle')) return;
    page.classList.add('is-in');
    setTimeout(function () {
      if (page.classList.contains('is-idle')) return;
      page.classList.add('is-idle');
      if (onIdle[page.id]) onIdle[page.id](page);
    }, reduceMotion.matches ? 0 : 1100);
  }

  if ('IntersectionObserver' in window) {
    var thresholds = [];
    for (var t = 0; t <= 1.0001; t += 0.05) thresholds.push(+t.toFixed(2));

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var page = e.target;
        var vh = e.rootBounds ? e.rootBounds.height : window.innerHeight;
        var rect = e.boundingClientRect;
        // How much of the viewport this page fills (tall pages never reach ratio 1).
        var cover = e.intersectionRect.height / Math.min(vh, rect.height);

        if (cover >= 0.4) enter(page);
        // Past = the page's bottom has risen into the top ~62% of the screen.
        page.classList.toggle('is-past', page.classList.contains('is-in') && rect.bottom < vh * 0.62);
      });
    }, { threshold: thresholds });

    pages.forEach(function (p) { io.observe(p); });
  } else {
    pages.forEach(enter);
  }

  /* ---------- Scroll progress line under the nav ---------- */
  var bar = document.querySelector('.progress span');
  var ticking = false;
  function paintProgress() {
    ticking = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (bar) bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    document.body.classList.toggle('is-scrolled', window.scrollY > 24);
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(paintProgress); }
  }, { passive: true });
  window.addEventListener('resize', paintProgress);
  paintProgress();

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
      lastFocus.focus();
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

  /* ---------- Page 4: a conversation that ends in a booking ---------- */
  var script = [
    ['them', 'Hi, my AC isn’t cooling. Can someone take a look?'],
    ['us', 'I can help with that. What’s the service address?'],
    ['them', '14 Hope Road, Kingston 10'],
    ['us', 'Thanks. A technician is free tomorrow at 10:00 AM or 2:00 PM. Which works?'],
    ['them', '10 works'],
    ['booked', 'Booked: AC repair, tomorrow 10:00 AM']
  ];

  onIdle.assistant = function (page) {
    var body = page.querySelector('.live-chat__body');
    if (!body) return;

    function bubble(kind, text) {
      var el = document.createElement('div');
      el.className = 'bubble bubble--' + kind;
      if (text) el.textContent = text;
      return el;
    }

    if (reduceMotion.matches) {
      script.slice(-4).forEach(function (s) { body.appendChild(bubble(s[0], s[1])); });
      return;
    }

    var i = 0;
    function step() {
      if (i === script.length) {
        setTimeout(function () { body.innerHTML = ''; i = 0; step(); }, 4500);
        return;
      }
      var s = script[i++];
      var typing = null;
      if (s[0] === 'us') {
        typing = bubble('us bubble--typing');
        typing.innerHTML = '<i></i><i></i><i></i>';
        body.appendChild(typing);
      }
      setTimeout(function () {
        if (typing) typing.remove();
        body.appendChild(bubble(s[0], s[1]));
        while (body.children.length > 4) body.removeChild(body.firstChild);
        setTimeout(step, s[0] === 'them' ? 700 : 1600);
      }, typing ? 1400 : 0);
    }
    step();
  };

  /* ---------- Page 6: the desk clears ----------
     Five open admin items sit in a loose pile. One by one they are handled
     (tick, then they fall into a neat column). Then the column lifts away,
     leaving open space and the mark. Loops slowly. */
  onIdle.payoff = function (page) {
    var settle = page.querySelector('.settle');
    if (!settle) return;
    var tiles = settle.querySelectorAll('.settle__tiles li');
    var status = settle.querySelector('[data-settle-status]');
    var total = tiles.length;

    function setStatus(text) { if (status) status.textContent = text; }

    if (reduceMotion.matches) {
      settle.classList.add('is-neat');
      tiles.forEach(function (t) { t.classList.add('is-done'); });
      setStatus(total + ' handled · 0 waiting');
      return;
    }

    var timers = [];
    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

    function cycle() {
      timers.forEach(clearTimeout); timers = [];
      settle.classList.remove('is-neat', 'is-clear');
      tiles.forEach(function (t) { t.classList.remove('is-done'); });
      settle.classList.add('is-pile');
      setStatus(total + ' waiting');

      var t0 = 1800;
      tiles.forEach(function (tile, n) {
        at(t0 + n * 1100, function () {
          tile.classList.add('is-done');
          setStatus((n + 1) + ' handled · ' + (total - n - 1) + ' waiting');
        });
      });
      var tNeat = t0 + total * 1100 + 300;
      at(tNeat, function () { settle.classList.remove('is-pile'); settle.classList.add('is-neat'); });
      at(tNeat + 2600, function () { settle.classList.add('is-clear'); setStatus('All caught up'); });
      at(tNeat + 2600 + 6000, cycle);
    }
    cycle();
  };

  /* ---------- misc ---------- */
  document.querySelectorAll('[data-year]').forEach(function (y) { y.textContent = new Date().getFullYear(); });
})();

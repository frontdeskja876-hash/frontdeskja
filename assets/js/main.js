/*
 * FrontDesk JA — page motion, menu and small "live" details.
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
  var ENTRANCE_MS = 1900;

  /* ---------- Page states ---------- */
  var onEnter = {};

  function enter(page) {
    if (page.classList.contains('is-in')) return;
    page.classList.add('is-in');
    setTimeout(function () {
      page.classList.add('is-idle');
      if (onEnter[page.id]) onEnter[page.id](page);
    }, reduceMotion.matches ? 0 : ENTRANCE_MS - 900);
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

  /* ---------- Top bar: solid backdrop once scrolled ---------- */
  var topbar = document.querySelector('.topbar');
  function onScroll() { topbar.classList.toggle('is-solid', window.scrollY > 40); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

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
  burger.addEventListener('click', function () { setMenu(menu.hidden); });
  menu.addEventListener('click', function (e) {
    if (e.target.closest('a[href^="#"]') || e.target.closest('[data-intake]')) setMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) setMenu(false);
  });

  /* ---------- Page 3: steps light up in order ---------- */
  onEnter.aeo = function (page) {
    var steps = page.querySelectorAll('.steps li');
    steps.forEach(function (li, i) {
      setTimeout(function () { li.classList.add('is-lit'); }, reduceMotion.matches ? 0 : 500 + i * 700);
    });
  };

  /* ---------- Page 4: a live-feeling conversation that ends in a booking ---------- */
  var script = [
    ['them', 'Hi, my AC isn’t cooling. Can someone take a look?'],
    ['us', 'I can help with that. What’s the service address?'],
    ['them', '14 Hope Road, Kingston 10'],
    ['us', 'Thanks. We have a technician free tomorrow at 10:00 AM or 2:00 PM. Which works?'],
    ['them', '10 works'],
    ['booked', '✓ Booked — AC repair, tomorrow 10:00 AM']
  ];

  onEnter.assistant = function (page) {
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
      if (!document.body.contains(body)) return;
      if (i === script.length) {
        setTimeout(function () { body.innerHTML = ''; i = 0; step(); }, 4200);
        return;
      }
      var s = script[i++];
      var wait = s[0] === 'us' ? 900 : 0;
      var typing = null;
      if (wait) { typing = bubble('us bubble--typing'); typing.innerHTML = '<i></i><i></i><i></i>'; body.appendChild(typing); }
      setTimeout(function () {
        if (typing) typing.remove();
        body.appendChild(bubble(s[0], s[1]));
        while (body.children.length > 5) body.removeChild(body.firstChild);
        setTimeout(step, s[0] === 'them' ? 700 : 1500);
      }, wait);
    }
    step();
  };

  /* ---------- Page 5: call count breathes, hold count never moves ---------- */
  onEnter.receptionist = function (page) {
    var el = page.querySelector('[data-calls]');
    if (!el || reduceMotion.matches) return;
    var n = 6;
    setInterval(function () {
      n += Math.random() < 0.5 ? -1 : 1;
      n = Math.max(4, Math.min(9, n));
      el.textContent = n;
    }, 2600);
  };

  /* ---------- misc ---------- */
  var year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
})();

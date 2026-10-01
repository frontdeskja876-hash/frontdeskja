/*
 * FrontDesk JA — paging, page motion, navigation and the small "living" details.
 *
 * Scroll model (story page only): one gesture = one page. A wheel tick, trackpad swipe
 * or arrow key moves to the next/previous page; CSS scroll-snap (mandatory) holds pages
 * in place and handles touch. Nothing on screen follows the scroll offset.
 *
 * Each page then moves through discrete, time-based states:
 *   .is-in   entrance — once, when ~60% of the page is in view
 *   .is-idle ambient loop — after the entrance has settled
 *   .is-past exit — while the page is above the viewport
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var isStory = document.documentElement.classList.contains('story');
  var pages = Array.prototype.slice.call(document.querySelectorAll('[data-page]'));
  var stops = isStory ? pages.concat(Array.prototype.slice.call(document.querySelectorAll('.footer'))) : [];
  var onIdle = {};
  var bar = document.querySelector('.progress span');

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

  /* ---------- Page states ---------- */
  function enter(page) {
    if (page.classList.contains('is-in')) return;
    page.classList.add('is-in');
    setTimeout(function () {
      page.classList.add('is-idle');
      if (onIdle[page.id]) onIdle[page.id](page);
    }, reduceMotion.matches ? 0 : 1500);
  }

  function setProgress(index) {
    if (!bar || !stops.length) return;
    bar.style.transform = 'scaleX(' + (stops.length > 1 ? index / (stops.length - 1) : 1).toFixed(4) + ')';
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var page = e.target;
        var vh = e.rootBounds ? e.rootBounds.height : window.innerHeight;
        var rect = e.boundingClientRect;
        var cover = e.intersectionRect.height / Math.min(vh, rect.height);
        if (cover >= 0.6) {
          enter(page);
          var idx = stops.indexOf(page);
          if (idx >= 0) { current = idx; setProgress(idx); }
        }
        if (page.classList.contains('footer') && cover >= 0.6) setProgress(stops.length - 1);
        if (page.hasAttribute('data-page')) {
          page.classList.toggle('is-past', page.classList.contains('is-in') && rect.bottom < vh * 0.5);
        }
      });
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    pages.forEach(function (p) { io.observe(p); });
    if (isStory) document.querySelectorAll('.footer').forEach(function (f) { io.observe(f); });
  } else {
    pages.forEach(enter);
  }

  /* ---------- Paging: one gesture, one page ---------- */
  var current = 0;
  var locked = false;
  var lastWheel = 0;
  var acc = 0;

  function overlayOpen() {
    return document.body.classList.contains('is-locked') || (document.querySelector('.ask.is-open') && document.activeElement && document.activeElement.closest('.ask'));
  }
  function nearestStop() {
    var y = window.scrollY, best = 0, bestD = Infinity;
    stops.forEach(function (s, i) { var d = Math.abs(stopTop(s) - y); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  function stopTop(el) {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return Math.min(el.offsetTop, max);
  }
  function go(index) {
    index = Math.max(0, Math.min(stops.length - 1, index));
    if (index === current && Math.abs(window.scrollY - stopTop(stops[index])) < 2) return;
    current = index;
    locked = true;
    setProgress(index);
    window.scrollTo({ top: stopTop(stops[index]), behavior: 'smooth' });
    // Unlock only once the wheel has been quiet for a moment, so a trackpad's inertia
    // tail from this gesture can't trigger the next page.
    var release = function () {
      var quiet = Date.now() - lastWheel;
      if (quiet < 260) { setTimeout(release, 260 - quiet); return; }
      locked = false; acc = 0;
    };
    var done = false;
    var finish = function () { if (done) return; done = true; window.removeEventListener('scrollend', finish); release(); };
    window.addEventListener('scrollend', finish);
    setTimeout(finish, 1100);
  }

  // A tall page (only possible on very short screens) scrolls normally until its edge.
  function canScrollInside(dir) {
    var s = stops[current];
    if (!s) return false;
    var top = stopTop(s), bottom = s.offsetTop + s.offsetHeight - window.innerHeight;
    if (bottom <= top + 4) return false;
    return dir > 0 ? window.scrollY < bottom - 2 : window.scrollY > top + 2;
  }

  if (isStory && !reduceMotion.matches) {
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || overlayOpen() || e.target.closest('.ask__panel, .menu, .intake')) return;
      var dir = e.deltaY > 0 ? 1 : -1;
      if (canScrollInside(dir) && !locked) return;
      e.preventDefault();
      var now = Date.now();
      var gap = now - lastWheel;
      lastWheel = now;
      if (locked) return;
      if (gap > 300) acc = 0;
      acc += e.deltaY;
      if (Math.abs(acc) >= 24) { current = nearestStop(); go(current + (acc > 0 ? 1 : -1)); }
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (overlayOpen() || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) && e.key === ' ')) return;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      var dir = 0;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) dir = 1;
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) dir = -1;
      else if (e.key === 'Home') { e.preventDefault(); return go(0); }
      else if (e.key === 'End') { e.preventDefault(); return go(stops.length - 1); }
      if (!dir) return;
      if (canScrollInside(dir)) return;
      e.preventDefault();
      if (!locked) { current = nearestStop(); go(current + dir); }
    });

    // In-page links (#aeo etc.) page there too
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var target = document.getElementById(a.getAttribute('href').slice(1));
      var idx = stops.indexOf(target);
      if (idx < 0) return;
      e.preventDefault();
      setTimeout(function () { go(idx); }, 0);
      if (history.replaceState) history.replaceState(null, '', a.getAttribute('href'));
    });
  }

  /* ---------- Nav state ---------- */
  function onScroll() { document.body.classList.toggle('is-scrolled', window.scrollY > 24); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (!isStory && bar) { // document pages: plain reading progress
    var paint = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0).toFixed(4) + ')';
    };
    window.addEventListener('scroll', function () { requestAnimationFrame(paint); }, { passive: true });
    paint();
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

  /* ---------- Mouse-aware tilt on the one pillar card per page ---------- */
  if (finePointer.matches && !reduceMotion.matches) {
    document.querySelectorAll('[data-page]').forEach(function (page) {
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
      var typingEl = null;
      if (s[0] === 'us') {
        typingEl = bubble('us bubble--typing');
        typingEl.innerHTML = '<i></i><i></i><i></i>';
        body.appendChild(typingEl);
      }
      setTimeout(function () {
        if (typingEl) typingEl.remove();
        body.appendChild(bubble(s[0], s[1]));
        while (body.children.length > 4) body.removeChild(body.firstChild);
        setTimeout(step, s[0] === 'them' ? 700 : 1600);
      }, typingEl ? 1400 : 0);
    }
    step();
  };

  /* ---------- Page 6: the desk clears ----------
     Five open admin items sit in a loose pile. One by one they're handled (tick, then
     they fall into a neat column). Then the column lifts away, leaving open space and
     the mark. Loops slowly. */
  onIdle.payoff = function (page) {
    var settle = page.querySelector('.settle');
    if (!settle) return;
    // only the tiles this layout shows (phones show three)
    var tiles = Array.prototype.filter.call(settle.querySelectorAll('.settle__tiles li'), function (t) {
      return getComputedStyle(t).display !== 'none';
    });
    var status = settle.querySelector('[data-settle-status]');
    var total = tiles.length;
    function setStatus(text) { if (status) status.textContent = text; }

    if (reduceMotion.matches) {
      tiles.forEach(function (t) { t.classList.add('is-done'); });
      setStatus(total + ' handled · 0 waiting');
      return;
    }
    var timers = [];
    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function cycle() {
      timers.forEach(clearTimeout); timers = [];
      settle.classList.remove('is-clear');
      tiles.forEach(function (t) { t.classList.remove('is-done'); });
      setStatus(total + ' waiting');
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
  };

  /* ---------- misc ---------- */
  document.querySelectorAll('[data-year]').forEach(function (y) { y.textContent = new Date().getFullYear(); });
})();

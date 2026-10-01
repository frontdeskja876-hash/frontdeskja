/*
 * About page — motion for the three passages the spec calls out (§13). Everything
 * else on the page is static type.
 *
 *  [data-reveal]   plays its entrance once, when it comes into view (.is-in)
 *  [data-scene]    "the modern front desk": the old desk motif dissolves (.is-shift),
 *                  then four floating shapes drift in; each follows the cursor at its
 *                  own depth. Lime outline on hover comes from CSS.
 *
 * Reduced motion: every block shows its final state at rest, no tracking.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var blocks = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  var SHIFT_AFTER = 1300; // ms the old desk holds before it gives way to the system

  function play(block) {
    if (block.classList.contains('is-in')) return;
    block.classList.add('is-in');
    var scene = block.querySelector('[data-scene]');
    if (scene) setTimeout(function () { scene.classList.add('is-shift'); }, reduceMotion ? 0 : SHIFT_AFTER);
  }

  if (reduceMotion || !('IntersectionObserver' in window)) {
    blocks.forEach(play);
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { play(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.35 });
    blocks.forEach(function (b) { io.observe(b); });
  }

  /* Mouse-aware depth: each shape drifts toward the cursor and tilts a few degrees,
     scaled by its depth (--d), so the four read as separate layers of one system. */
  var scene = document.querySelector('[data-scene]');
  if (!scene || reduceMotion || !finePointer) return;
  var nodes = Array.prototype.slice.call(scene.querySelectorAll('.belief-node'));
  var area = scene.closest('.about__belief') || scene;
  var raf = 0;

  area.addEventListener('pointermove', function (e) {
    if (raf || !scene.classList.contains('is-shift')) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var r = scene.getBoundingClientRect();
      var x = (e.clientX - (r.left + r.width / 2)) / r.width;   // about -0.5 … 0.5
      var y = (e.clientY - (r.top + r.height / 2)) / r.height;
      x = Math.max(-1, Math.min(1, x)); y = Math.max(-1, Math.min(1, y));
      nodes.forEach(function (n) {
        var d = parseFloat(getComputedStyle(n).getPropertyValue('--d')) || 1;
        n.style.setProperty('--px', (x * 22 * d).toFixed(1) + 'px');
        n.style.setProperty('--py', (y * 16 * d).toFixed(1) + 'px');
        n.style.setProperty('--ry', (x * 14).toFixed(2) + 'deg');
        n.style.setProperty('--rx', (-y * 12).toFixed(2) + 'deg');
      });
    });
  });
  area.addEventListener('pointerleave', function () {
    nodes.forEach(function (n) {
      ['--px', '--py', '--rx', '--ry'].forEach(function (k) { n.style.removeProperty(k); });
    });
  });
})();

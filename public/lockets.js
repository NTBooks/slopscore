/* The cast lockets on /balcony, tilted and lit. Progressive enhancement over four static <img>s: without
 * this file they are simply the pictures, framed and named, which is all they have to be.
 *
 * On hover it sets four custom properties on the locket — --rx/--ry for a pseudo-3D tilt away from the
 * pointer, --mx/--my for the foil bands and the glare (public/style.css) — and moves the point light inside
 * the shared #locketRelief filter (src/views/balcony.tsx) to the same spot, so the frame's relief lights from
 * wherever the cursor is. One light serves all four: only one can be hovered at a time.
 *
 * The light's coordinates are user-space, which for a CSS filter means the element's own CSS pixels, so they
 * come from the bounding rect rather than the image's intrinsic 600x900. The relief filter is expensive, so
 * CSS only applies it while .lit is on, and every pointer move is coalesced into one animation frame.
 *
 * Nothing runs under prefers-reduced-motion or without a fine pointer: a tilt that follows a finger it cannot
 * see is worse than no tilt. */
(function () {
  'use strict';
  var mq = window.matchMedia;
  if (!mq || mq('(prefers-reduced-motion: reduce)').matches) return;
  if (!mq('(hover: hover) and (pointer: fine)').matches) return;

  var lockets = Array.prototype.slice.call(document.querySelectorAll('.cast .locket'));
  if (!lockets.length) return;
  var light = document.getElementById('locketLight');

  var TILT = 7;    // degrees at the far edge: a lean, not a card trick. Past ~12 the oval reads as a plate.
  var frame = null;

  function paint(el, e) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    px = px < 0 ? 0 : px > 1 ? 1 : px;
    py = py < 0 ? 0 : py > 1 ? 1 : py;
    var st = el.style;
    st.setProperty('--mx', (px * 100).toFixed(1) + '%');
    st.setProperty('--my', (py * 100).toFixed(1) + '%');
    st.setProperty('--ry', ((px - 0.5) * 2 * TILT).toFixed(2) + 'deg');
    st.setProperty('--rx', ((0.5 - py) * 2 * TILT * 0.72).toFixed(2) + 'deg');
    if (light) {
      light.setAttribute('x', Math.round(px * r.width));
      light.setAttribute('y', Math.round(py * r.height));
      light.setAttribute('z', Math.round(r.width * 0.42));
    }
  }

  lockets.forEach(function (el) {
    el.addEventListener('pointerenter', function (e) { el.classList.add('lit'); paint(el, e); });
    el.addEventListener('pointerleave', function () {
      el.classList.remove('lit');
      // Back to flat, and let the transition carry it: the effect should settle, not snap.
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
    el.addEventListener('pointermove', function (e) {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () { frame = null; paint(el, e); });
    });
  });
})();

/* Is anybody there? One answer for every moving part on the page.
 *
 * The pig's springs, the boat's clock, the chat's countdown and the two CSS loops in the rail are all
 * decoration, and decoration nobody is watching is a fan spinning up for no one. A tab in the background
 * already gets no animation frames from the browser, but a window sat behind another one on the same
 * screen gets every frame, and so does a page whose reader wandered off to make tea. This file decides
 * "awake" (tab in front, window focused, some input in the last little while) and the others follow it:
 * scripts subscribe through window.ssAwake, the stylesheet keys off html.ss-idle.
 *
 * Loaded first and with defer, so the subscribers below it in the layout always find it. Should it fail
 * to arrive they each fall back to what they did before it existed, which is to keep running. */
(function () {
  'use strict';
  var IDLE_MS = 20000;                                // no input for this long and the reader has left
  var SETTLE_MS = 2500;                               // subscribers may take this long to come to rest

  var root = document.documentElement;
  var subs = [];
  var last = Date.now();
  var focused = !document.hasFocus || document.hasFocus();
  var awake = true, timer = null;

  function here() { return !document.hidden && focused && Date.now() - last < IDLE_MS; }
  function set(v) {
    if (v === awake) return;
    awake = v;
    if (root.classList) root.classList.toggle('ss-idle', !v);
    for (var i = 0; i < subs.length; i++) { try { subs[i](v); } catch (e) { /* one bad listener must not stop the rest */ } }
  }
  // The idle timer is armed once and re-aimed when it fires, never re-armed per event: a mousemove
  // handler that touched a timer would cost more than the animation it is protecting.
  function check() {
    timer = null;
    var left = last + IDLE_MS - Date.now();
    if (left > 0) timer = setTimeout(check, left);
    else set(here());
  }
  function sync() {
    set(here());
    if (awake && !timer) timer = setTimeout(check, IDLE_MS);
  }
  function poke() { last = Date.now(); if (!awake) sync(); }

  ['mousemove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, poke, { passive: true }); });
  document.addEventListener('scroll', poke, { passive: true, capture: true });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) last = Date.now(); sync(); });
  window.addEventListener('focus', function () { focused = true; last = Date.now(); sync(); });
  window.addEventListener('blur', function () { focused = false; sync(); });

  window.ssAwake = {
    /** True while someone is plausibly looking at the page. */
    is: function () { return awake; },
    /** Called with true on waking and false on dozing off; never on subscribe. */
    on: function (fn) { subs.push(fn); },
    /** How long a subscriber may keep stepping after false, to settle into a still pose. */
    settle: SETTLE_MS
  };
  sync();
})();

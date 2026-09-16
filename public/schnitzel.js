/* Schnitzel, animated. Desktop-only progressive enhancement over the static <img src="/mascot.svg">.
 * Swaps the rail mascot <img> (the captioned one; the hero pig stays still) for the same SVG inlined and drives its layer groups
 * with damped springs: the head turns to face the cursor in pseudo-3D (ears lag behind, snout leads),
 * the jaw chews, the ears flick every so often, and hovering anything edible (a repo link) makes him
 * hungry: big eyes, blush, and a strand of drool that stretches and swings. Hovering an upvote makes him
 * bounce with happy closed eyes; hovering a downvote slumps him: drooped ears, worried brows, a tear.
 * The login button gets a curious head-tilt with perked ears; the nav tabs make him lift his snout and sniff.
 * At rest every layer sits at identity, so it renders exactly like the static image.
 * Without a fine pointer (phones, narrow layouts) there is nothing to follow, so a director plays a
 * randomized idle show instead: glancing about, spotting food, hopping, sniffing, the odd sulk.
 * Nothing runs under prefers-reduced-motion, and nothing runs while the pig is scrolled out of view, the
 * tab is at the back, the window is behind another, or the reader has not touched anything for a while
 * (awake.js decides that last one; the pig settles to rest and the frame loop stops). */
(function () {
  'use strict';
  var mq = window.matchMedia;
  if (!mq || mq('(prefers-reduced-motion: reduce)').matches) return;
  var desktop = mq('(min-width: 881px) and (hover: hover) and (pointer: fine)').matches;
  var imgs = Array.prototype.slice.call(document.querySelectorAll('figure.mascot img.mascot-img'));
  if (!imgs.length || !window.fetch || !window.DOMParser) return;

  var FOOD = 'a[href^="/r/"], a[href^="https://github.com/"], .row .title a, .row .thumb, .strip a';
  var UP = '.votebox button.up', DOWN = '.votebox button.down', LOGIN = '.login', TABS = '.tabs a';
  var TAU = Math.PI * 2;
  var mouse = null, hungryT = 0, happyT = 0, sadT = 0, curiousT = 0, sniffT = 0;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function tanh(x) { var e = Math.exp(2 * x); return (e - 1) / (e + 1); }
  // Damped spring, semi-implicit Euler with substeps so stiff springs stay stable at low frame rates.
  function spring(s, target, k, zeta, dt) {
    var c = 2 * Math.sqrt(k) * zeta, n = Math.ceil(dt / 0.008), h = dt / n;
    for (var i = 0; i < n; i++) { s.v += (k * (target - s.x) - c * s.v) * h; s.x += s.v * h; }
    return s.x;
  }
  function S() { return { x: 0, v: 0 }; }
  // CSS transform in SVG user units about a pivot (transform-origin defaults to 0 0 on SVG elements).
  function xf(el, px, py, tx, ty, rot, sx, sy) {
    el.style.transform = 'translate(' + (tx + px).toFixed(2) + 'px,' + (ty + py).toFixed(2) + 'px) rotate(' + rot.toFixed(2) + 'deg) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ') translate(' + (-px) + 'px,' + (-py) + 'px)';
  }
  function setOpacity(el, v) { v = clamp(v, 0, 1).toFixed(3); if (el.__o !== v) { el.__o = v; el.setAttribute('opacity', v); } }
  // Tapered strand along a quadratic curve (same construction as art/svgkit taper()).
  function taper(x1, y1, cx, cy, x2, y2, w1, w2) {
    var L = [], R = [], n = 10;
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      var x = u * u * x1 + 2 * u * t * cx + t * t * x2, y = u * u * y1 + 2 * u * t * cy + t * t * y2;
      var dx = 2 * u * (cx - x1) + 2 * t * (x2 - cx), dy = 2 * u * (cy - y1) + 2 * t * (y2 - cy);
      var l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w = (w1 + (w2 - w1) * t) / 2;
      L.push((x + nx * w).toFixed(1) + ' ' + (y + ny * w).toFixed(1));
      R.push((x - nx * w).toFixed(1) + ' ' + (y - ny * w).toFixed(1));
    }
    return 'M ' + L.concat(R.reverse()).join(' L ') + ' Z';
  }

  function Pig(svg, p) {
    var q = function (id) { return svg.querySelector('#' + p + id); };
    this.svg = svg;
    this.g = { all: q('s-all'), earL: q('s-earL'), earR: q('s-earR'), head: q('s-head'), blush: q('s-blush'), snout: q('s-snout'),
      eyeL: q('s-eyeL'), eyeR: q('s-eyeR'), pupilL: q('s-pupilL'), pupilR: q('s-pupilR'), scleraL: q('s-scleraL'), scleraR: q('s-scleraR'),
      mud: q('s-mud'), drool: q('s-drool'), droolp: q('s-droolp'), droolh: q('s-droolh'), tear: q('s-tear') };
    this.sparks = svg.querySelectorAll('.s-spark'); this.happyEyes = svg.querySelectorAll('.s-happy'); this.brows = svg.querySelectorAll('.s-brow');
    ['all', 'earL', 'earR', 'head', 'snout', 'eyeL', 'eyeR', 'pupilL', 'pupilR', 'scleraL', 'scleraR', 'mud'].forEach(function (k) { this.g[k].style.willChange = 'transform'; }, this);
    this.look = [S(), S()]; this.lookT = [0, 0];
    this.hunger = S(); this.happy = S(); this.sad = S(); this.curious = S(); this.sniff = S(); this.ears = [S(), S()]; this.droolL = S(); this.droolS = S();
    this.hop = 0; this.sadSince = 0;
    this.phase = Math.random() * TAU; this.nextTwitch = 1 + Math.random() * 3; this.nextBlink = 2 + Math.random() * 4; this.blinkAt = -1;
    this.visible = true; this.wasHungry = false;
    this.idleLook = null; this.beat = null; this.beatEnd = 0; this.glanceAt = 0;
  }
  // Idle show for touch screens: weighted random beats with random lengths. mood sets the global mood
  // targets; look fixes the gaze; glance re-aims the gaze every so often (with an optional vertical bias).
  var BEATS = [
    { n: 'rest', w: 3, d: [2.5, 5], glance: [1.2, 2.6] },
    { n: 'stare', w: 2, d: [2, 3.2], look: [0, 0.25] },
    { n: 'hungry', w: 3, d: [2.5, 4.5], mood: 'hungry', glance: [0.9, 1.8], gy: 0.3 },
    { n: 'happy', w: 2, d: [1.6, 2.8], mood: 'happy', look: [0, 0] },
    { n: 'sniff', w: 2, d: [2, 3.4], mood: 'sniff', glance: [0.6, 1.3], gy: -0.55 },
    { n: 'curious', w: 2, d: [2, 3.2], mood: 'curious', side: true },
    { n: 'sad', w: 1, d: [3, 4.4], mood: 'sad', look: [0, 0.45] }
  ];
  function rnd(a, b) { return a + Math.random() * (b - a); }
  Pig.prototype.direct = function (now) {
    var b = this.beat;
    if (!b || now > this.beatEnd) {
      // After a mood beat, usually settle first; never play the same beat twice running.
      var pool = b && b.mood && Math.random() < 0.5 ? [BEATS[0]] : BEATS.filter(function (x) { return x !== b; });
      var total = pool.reduce(function (a, x) { return a + x.w; }, 0), pick = Math.random() * total;
      for (var i = 0; i < pool.length; i++) { pick -= pool[i].w; if (pick <= 0) { b = pool[i]; break; } }
      this.beat = b; this.beatEnd = now + rnd(b.d[0], b.d[1]); this.glanceAt = 0;
      hungryT = happyT = sadT = curiousT = sniffT = 0;
      if (b.mood === 'hungry') hungryT = 1; else if (b.mood === 'happy') happyT = 1; else if (b.mood === 'sad') sadT = 1;
      else if (b.mood === 'curious') curiousT = 1; else if (b.mood === 'sniff') sniffT = 1;
      if (b.look) this.idleLook = b.look; else if (b.side) this.idleLook = [Math.random() < 0.5 ? -0.7 : 0.7, rnd(-0.2, 0.3)];
    }
    if (b.glance && now > this.glanceAt) { this.idleLook = [rnd(-0.9, 0.9), rnd(-0.6, 0.6) + (b.gy || 0)]; this.glanceAt = now + rnd(b.glance[0], b.glance[1]); }
  };
  Pig.prototype.step = function (dt, now) {
    var g = this.g;
    // Where is the cursor relative to the face? Saturates smoothly so far-away cursors still read as a glance.
    if (!desktop) this.direct(now);
    if (mouse) {
      var r = this.svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * 0.5;
      this.lookT[0] = tanh((mouse.x - cx) / 340); this.lookT[1] = tanh((mouse.y - cy) / 300);
    } else if (this.idleLook) { this.lookT[0] = this.idleLook[0]; this.lookT[1] = this.idleLook[1]; }
    else { this.lookT[0] = this.lookT[1] = 0; }
    var lx = spring(this.look[0], this.lookT[0], 90, 0.32, dt), ly = spring(this.look[1], this.lookT[1], 90, 0.32, dt);
    var h = spring(this.hunger, hungryT, 60, 0.38, dt), hc = clamp(h, 0, 1.4), h1 = clamp(h, 0, 1);
    if (hungryT && !this.wasHungry) { this.ears[0].v -= 420; this.ears[1].v += 420; this.blinkAt = -1; } // ears perk when food shows up
    this.wasHungry = !!hungryT;
    var hp = clamp(spring(this.happy, happyT, 80, 0.4, dt), 0, 1), sp = clamp(spring(this.sad, sadT, 40, 0.65, dt), 0, 1);
    var cp = clamp(spring(this.curious, curiousT, 70, 0.42, dt), 0, 1), sn = clamp(spring(this.sniff, sniffT, 70, 0.5, dt), 0, 1);
    var puls = Math.sin(now * TAU * 7) * sn; // sniff pulse
    if (sadT) { if (!this.sadSince) this.sadSince = now; } else this.sadSince = 0;
    // Happy hop: a phase that only advances while happy, so he lands and stops rather than freezing mid-air.
    this.hop += dt * TAU * 2.2 * hp;
    var hs = Math.abs(Math.sin(this.hop)), hop = -26 * hs * hp, land = (1 - hs) * hp; // land = 1 at touchdown
    var wag = Math.sin(this.hop * 2) * hp, sway2 = Math.sin(this.hop * 0.5) * hp;
    var shake = Math.sin(now * TAU * 0.8) * 3 * sp, tremble = Math.sin(now * TAU * 9) * 1.2 * sp;

    // Chewing: slow munch when idle, a fast eager quiver when hungry. j = jaw open 0..1, grind = sideways slide.
    this.phase += dt * TAU * lerp(1.35, 3.4, h1);
    var still = (1 - sp) * (1 - sn); // no chewing while sad or sniffing
    var j = (1 - Math.cos(this.phase)) / 2 * lerp(1, 0.5, h1) * still, grind = Math.sin(this.phase) * 3 * lerp(1, 0.45, h1) * still + tremble;
    var br = Math.sin(now * TAU * 0.33) * 1.5; // breathing

    // Ear flicks: a velocity kick into a bouncy spring, one ear or both, every few seconds.
    if (now > this.nextTwitch) {
      var which = Math.random(), kick = (Math.random() < 0.5 ? -1 : 1) * (330 + Math.random() * 160);
      if (which < 0.4) this.ears[0].v += kick; else if (which < 0.8) this.ears[1].v += kick; else { this.ears[0].v += kick; this.ears[1].v -= kick; }
      this.nextTwitch = now + 1.6 + Math.random() * 4.4;
    }
    var eL = spring(this.ears[0], 0, 700, 0.16, dt), eR = spring(this.ears[1], 0, 700, 0.16, dt);

    // Blink (never while hungry: those eyes stay wide).
    var bl = 1;
    if (h1 < 0.25 && hp < 0.2 && sp < 0.2 && cp < 0.2 && sn < 0.2 && now > this.nextBlink) { this.blinkAt = now; this.nextBlink = now + 2.5 + Math.random() * 5; }
    if (this.blinkAt >= 0) { var bt = (now - this.blinkAt) / 0.22; if (bt < 1) bl = 1 - Math.sin(Math.PI * bt) * 0.92; else this.blinkAt = -1; }

    // Drool: length is a loose spring toward how hungry he is; the strand swings against the jaw's sideways motion.
    var L = Math.max(0, spring(this.droolL, 82 * hc, 35, 0.22, dt));
    var sway = clamp(spring(this.droolS, -this.look[0].v * 9 - grind * 1.5, 50, 0.18, dt), -45, 45);

    var lean = 1 + h1 * 0.25; // hungry: leans in harder toward the cursor
    // Whole pig: hops on the spot when happy (squashing on landing), slumps a little when sad.
    // Curious: the whole pig tilts (pivot low so the head leans). Sniff: head lifts, nose in the air.
    xf(g.all, 300, 492, 0, hop - sn * 4, sway2 * 4 + cp * 9, 1 + h1 * 0.04 + land * 0.06 - sp * 0.02, 1 + h1 * 0.04 - land * 0.07 - sp * 0.04);
    var droop = sp * 34, flap = wag * 14, perkL = cp * 12 - sn * 8, perkR = cp * 20 - sn * 8; // curious: one ear higher than the other
    xf(g.earL, 205, 165, lx * 5, ly * 3 + br + sp * 10, -lx * 7 + eL - h1 * 7 - droop - flap - perkL, 1, 1);
    xf(g.earR, 395, 165, lx * 5, ly * 3 + br + sp * 10, -lx * 7 + eR + h1 * 7 + droop + flap + perkR, 1, 1);
    xf(g.head, 300, 300, lx * 14, ly * 9 + br + j * 1.2 + h1 * 6 + sp * 18 - sn * 5, lx * 3 + shake, 1, 1);
    var ex = lx * 30 * lean, ey = ly * 20 * lean + br + h1 * 4 + sp * 30 - sn * 4, ps = (1 + 0.65 * h1 + 0.15 * cp) * (1 - 0.25 * sp), ss = 1 + 0.95 * h1;
    var lid = bl * (1 - 0.35 * sn); // sniffing narrows the eyes a little
    xf(g.eyeL, 228, 258, ex + sp * 4, ey, 0, 1, lid); xf(g.eyeR, 372, 258, ex - sp * 4, ey, 0, 1, lid);
    xf(g.pupilL, 228, 258, 0, 0, 0, ps, ps * lerp(1, 0.06, hp)); xf(g.pupilR, 372, 258, 0, 0, 0, ps, ps * lerp(1, 0.06, hp));
    xf(g.scleraL, 228, 258, 0, 0, 0, ss, ss); xf(g.scleraR, 372, 258, 0, 0, 0, ss, ss);
    setOpacity(g.scleraL, h1 * 1.2); setOpacity(g.scleraR, h1 * 1.2);
    var i;
    for (i = 0; i < this.sparks.length; i++) setOpacity(this.sparks[i], Math.max(h1, cp * 0.9));
    for (i = 0; i < this.happyEyes.length; i++) setOpacity(this.happyEyes[i], hp * 1.5 - 0.3);
    for (i = 0; i < this.brows.length; i++) setOpacity(this.brows[i], sp);
    setOpacity(g.blush, Math.max(h1, hp, cp * 0.5));
    // A tear wells up after a moment of sadness and rolls down the cheek, then another.
    var tear = 0, tearY = 0;
    if (this.sadSince && now - this.sadSince > 0.7) { var tt = ((now - this.sadSince - 0.7) % 1.6) / 1.6; tearY = tt * tt * 70; tear = sp * (tt < 0.15 ? tt / 0.15 : 1 - tt * 0.6); }
    xf(g.tear, 242, 284, -sp * 4, tearY, 0, 1, 1 + tearY * 0.02); setOpacity(g.tear, tear);
    xf(g.snout, 300, 346, lx * 38 * lean, ly * 24 * lean + br + j * 2.5 + h1 * 5 + sp * 26 - sn * 9 - puls * 2.5, lx * 1.5 + wag * 3, 1 + j * 0.03 + h1 * 0.06 + puls * 0.06, 1 - j * 0.06 + h1 * 0.06 - sp * 0.05 - puls * 0.05);
    xf(g.mud, 305, 404, lx * 42 * lean + grind, ly * 26 * lean + br + j * 8 + h1 * 5 + sp * 26 - sn * 8, grind * 0.8, 1, 1);
    if (L > 0.5) {
      var ax = 318, ay = 468, tx = ax + sway, ty = ay + L, rr = 3.5 + L * 0.07;
      g.droolp.setAttribute('d', taper(ax, ay, ax + sway * 0.35, ay + L * 0.55, tx, ty, 6.5, 2.5) +
        ' M ' + (tx - rr).toFixed(1) + ' ' + (ty + rr * 0.6).toFixed(1) + ' a ' + rr.toFixed(1) + ' ' + (rr * 1.15).toFixed(1) + ' 0 1 0 ' + (rr * 2).toFixed(1) + ' 0 a ' + rr.toFixed(1) + ' ' + (rr * 1.15).toFixed(1) + ' 0 1 0 ' + (-rr * 2).toFixed(1) + ' 0 Z');
      g.droolh.setAttribute('cx', (tx - rr * 0.35).toFixed(1)); g.droolh.setAttribute('cy', (ty + rr * 0.25).toFixed(1));
      g.droolh.setAttribute('rx', (rr * 0.38).toFixed(1)); g.droolh.setAttribute('ry', (rr * 0.26).toFixed(1));
    }
    setOpacity(g.drool, L / 14);
  };

  function setup(text) {
    var pigs = [];
    imgs.forEach(function (img, i) {
      var p = 'sz' + i + '-';
      var src = text.replace(/id="([^"]+)"/g, 'id="' + p + '$1"').replace(/href="#([^"]+)"/g, 'href="#' + p + '$1"').replace(/url\(#([^)]+)\)/g, 'url(#' + p + '$1)');
      var doc = new DOMParser().parseFromString(src, 'image/svg+xml');
      var svg = doc.documentElement;
      if (!svg || svg.nodeName !== 'svg' || !doc.getElementById(p + 's-all')) return;
      svg = document.importNode(svg, true);
      svg.setAttribute('class', img.getAttribute('class') || 'mascot-img');
      svg.setAttribute('width', img.getAttribute('width') || '200'); svg.setAttribute('height', img.getAttribute('height') || '200');
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', img.getAttribute('alt') || 'Schnitzel the pig');
      svg.style.overflow = 'visible';
      img.parentNode.replaceChild(svg, img);
      pigs.push(new Pig(svg, p));
    });
    if (!pigs.length) return;

    if (desktop) {
      document.addEventListener('mousemove', function (e) { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
      document.documentElement.addEventListener('mouseleave', function () { mouse = null; hungryT = happyT = sadT = curiousT = sniffT = 0; });
      document.addEventListener('mouseover', function (e) {
        var t = e.target, over = function (sel) { return t && t.closest && t.closest(sel) ? 1 : 0; };
        happyT = over(UP); sadT = happyT ? 0 : over(DOWN); curiousT = happyT || sadT ? 0 : over(LOGIN);
        sniffT = happyT || sadT || curiousT ? 0 : over(TABS); hungryT = happyT || sadT || curiousT || sniffT ? 0 : over(FOOD);
      });
    }
    // The loop runs only while there is something to show and someone to show it to. When either goes
    // away the pig is given a moment to settle to rest (springs, drool, hop all wind down), then no
    // more frames are asked for; whichever of the two comes back starts it again.
    var aw = window.ssAwake;
    var last = performance.now(), running = false, restUntil = 0;
    function anyVisible() { for (var i = 0; i < pigs.length; i++) if (pigs[i].visible) return true; return false; }
    function wanted() { return (!aw || aw.is()) && anyVisible(); }
    function frame(t) {
      var dt = clamp((t - last) / 1000, 0, 0.05); last = t;
      for (var i = 0; i < pigs.length; i++) if (pigs[i].visible) pigs[i].step(dt, t / 1000);
      if (wanted() || t < restUntil) requestAnimationFrame(frame); else running = false;
    }
    function run() { if (running) return; running = true; last = performance.now(); requestAnimationFrame(frame); }
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { pigs.forEach(function (pg) { if (pg.svg === en.target) pg.visible = en.isIntersecting; }); });
        if (anyVisible()) run();
      });
      pigs.forEach(function (pg) { io.observe(pg.svg); });
    }
    if (aw) aw.on(function (up) {
      if (up) { run(); return; }
      mouse = null; hungryT = happyT = sadT = curiousT = sniffT = 0;   // nothing to look at: come to rest
      restUntil = performance.now() + aw.settle;
      run();                                                            // in case the pig was mid-pose with the loop stopped
    });
    run();
  }

  fetch('/mascot.svg').then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) { if (t) setup(t); }).catch(function () {});
})();

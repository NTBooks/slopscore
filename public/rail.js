/* The rail's two atmosphere boxes, brought to life. Progressive enhancement over two things that are
 * already true without it: a thread of real verdicts with real timestamps, and a chart with the
 * Sloptrawler at her mooring. Nothing here is load-bearing; if this file never arrives the reader loses
 * a boat that moves and a countdown that ticks, and loses no information at all.
 *
 * The chat: reveals its bubbles one after another the first time the box is scrolled into view, and
 * counts down to whoever reads next. The reveal is of the thread loading, never of messages arriving —
 * these verdicts were written hours ago and say so, and animating them as though they were landing now
 * would be a lie the timestamps immediately contradict. A reader who has reached the bottom of the
 * archive and is being shown the newest again (data-caught) gets no reveal at all, because there the
 * motion would be claiming a novelty that is not there.
 *
 * The chart: works out where she is from when she last sailed (one voyage an hour), and walks her along the course the
 * reader can actually see, sampling the drawn path rather than recomputing its curve. The maths lives
 * in src/lib/sea.ts where it is tested; the only thing duplicated here is the four leg boundaries.
 *
 * Unlike schnitzel.js this does not bail wholesale under prefers-reduced-motion, and does not want a
 * fine pointer: a countdown is information rather than decoration, and neither box follows a cursor.
 * Both timers stop when their box leaves the screen or the tab goes to the back. */
(function () {
  'use strict';

  var chat = document.getElementById('balconychat');
  var chart = document.getElementById('seachart');
  if (!chat && !chart) return;                        // most pages have no rail

  var mq = window.matchMedia;
  var still = mq && mq('(prefers-reduced-motion: reduce)').matches;
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };

  // ---- clock ----
  // Every box carries the server's own second, so a reader whose clock is wrong still sees the right
  // countdown. Same trick as the crawler clock on /queue.
  function offsetOf(box) { return num(box.dataset.now) - Date.now() / 1000; }

  function agoText(s) {
    if (s < 45) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 48) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  }

  function untilText(s) {
    if (s <= 0) return 'now';
    if (s < 60) return 'in ' + Math.round(s) + 's';
    var m = Math.ceil(s / 60);
    return m < 120 ? 'in ' + m + ' min' : 'in ' + Math.round(m / 60) + ' h';
  }

  /* Runs fn on an interval, but only while el is on screen and the tab is in front. A box that sits on
   * every page of the site has no business holding a timer in a tab nobody is looking at. */
  function whileVisible(el, ms, fn) {
    var timer = null;
    var onScreen = true;
    function sync() {
      var want = onScreen && !document.hidden;
      if (want && !timer) { fn(); timer = setInterval(fn, ms); }
      else if (!want && timer) { clearInterval(timer); timer = null; }
    }
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; sync(); }).observe(el);
    }
    document.addEventListener('visibilitychange', sync);
    fn();
    sync();
  }

  // ---- the balcony chat ----
  if (chat) (function () {
    var off = offsetOf(chat);
    var every = num(chat.dataset.every) || 900;
    var roster = (chat.dataset.roster || '').split(',').filter(Boolean);
    var msgs = [].slice.call(chat.querySelectorAll('.msg'));
    var typing = chat.querySelector('#ss-typing');

    // The reader's place in the archive. The server rendered this window from the cookie it found and put
    // the cursor it would advance to on the box; it is stored only once the box has actually been on
    // screen, so a reader who never scrolls down keeps their place and the server never has to Set-Cookie
    // on a page. Without an observer there is no way to know, so it is stored on load.
    var seen = false;
    function markSeen() {
      if (seen || !chat.dataset.cookie || !chat.dataset.cursor) return;
      seen = true;
      try {
        document.cookie = chat.dataset.cookie + '=' + chat.dataset.cursor + '; path=/; max-age=31536000; samesite=lax' +
          (location.protocol === 'https:' ? '; secure' : '');
      } catch (e) { /* cookies off: the box shows the newest window every time, which is fine */ }
    }
    if (window.IntersectionObserver) {
      var seenIo = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        seenIo.disconnect();
        markSeen();
      }, { rootMargin: '0px 0px -40px 0px' });
      seenIo.observe(chat);
    } else markSeen();

    // The reveal. Hidden from script, never from the stylesheet: a rule that hid these would hide the
    // whole thread on any browser where this file failed to load.
    if (!still && msgs.length && !chat.dataset.caught) {
      msgs.forEach(function (m) { m.style.opacity = '0'; m.style.transform = 'translateY(4px)'; });
      var show = function () {
        msgs.forEach(function (m, i) {
          setTimeout(function () { m.style.opacity = ''; m.style.transform = ''; }, i * 160);
        });
      };
      // The safety net is not optional. An observer does not fire while the tab is in the background,
      // so a bubble hidden until it does is a bubble that can stay hidden for ever -- content lost to a
      // decoration. Whichever comes first wins, and show() is idempotent.
      var timer = setTimeout(show, 1500);
      var reveal = function () { clearTimeout(timer); show(); };
      if (window.IntersectionObserver) {
        var io = new IntersectionObserver(function (es) {
          if (!es[0].isIntersecting) return;
          io.disconnect();
          reveal();
        }, { rootMargin: '0px 0px -40px 0px' });
        io.observe(chat);
      } else reveal();
    }

    if (!typing) return;
    var at = num(typing.dataset.at);
    var until = typing.querySelector('.ss-until');
    var label = typing.querySelector('span');

    whileVisible(chat, 1000, function () {
      var t = Date.now() / 1000 + off;

      chat.querySelectorAll('.when[data-at]').forEach(function (el) {
        el.textContent = agoText(Math.max(0, t - num(el.dataset.at)));
      });

      if (!until) return;
      var left = at - t;
      // Past the turn: hold on "is reading" for a minute and a half, then roll to the next one. The
      // rota is deterministic, so the name after a rollover is worked out rather than guessed.
      if (left < -90) {
        while (at - t < -90) at += every;
        typing.dataset.at = at;
        left = at - t;
      }
      if (left <= 0) {
        until.textContent = '';
        if (label && roster.length) label.textContent = 'Reading now…';
        return;
      }
      until.textContent = untilText(left);
      until.setAttribute('datetime', new Date(at * 1000).toISOString());
    });
  })();

  // ---- the Sloptrawler's chart ----
  if (chart) (function () {
    var ship = chart.querySelector('#ss-ship');
    var hull = chart.querySelector('.hull');
    var last = num(chart.dataset.last);
    if (!ship || !last) return;                        // she has never sailed: leave her at the Trough
    var probe = chart.querySelector('#ss-track-0');
    if (!probe || !probe.getPointAtLength) return;     // no path sampling, no voyage

    var off = offsetOf(chart);
    var cursor = num(chart.dataset.cursor);
    // The cursor indexes searches; this maps each one to the ground it belongs to. Several searches share
    // a ground now that the net covers a dozen tools, so the two cannot be the same number any more.
    var groundOf = (chart.dataset.groundof || '').split(',').map(Number).filter(function (n) { return n >= 0; });
    if (!groundOf.length) return;
    // Mirrors VOYAGE_PERIOD and LEGS in src/lib/sea.ts, which is the copy under test. One voyage an hour.
    var PERIOD = 3600;
    var OUT = 0.15, GROUNDS_END = 0.6, HOME = 0.8;

    function at(path, u) {
      var len = path.getTotalLength();
      return path.getPointAtLength(Math.max(0, Math.min(1, u)) * len);
    }

    whileVisible(chart, 15000, function () {
      var t = Date.now() / 1000 + off;
      var since = t - last;
      if (since < 0) since = 0;
      var rolled = Math.floor(since / PERIOD);
      var phase = (since % PERIOD) / PERIOD;

      var n = groundOf.length;
      var q = groundOf[((Math.floor(cursor + rolled) % n) + n) % n];
      var path = chart.querySelector('#ss-track-' + q);
      if (!path) return;

      // Move the highlight if the counter has moved on since this page was rendered.
      chart.querySelectorAll('.ground, .track').forEach(function (el) { el.classList.remove('on'); });
      var lit = chart.querySelector('#ss-ground-' + q);
      if (lit) lit.classList.add('on');
      path.classList.add('on');

      // She is laid up once two sailings have been missed; the chart should not sail a ghost.
      var u = rolled >= 2 ? 0
        : phase < OUT ? phase / OUT
        : phase < GROUNDS_END ? 1
        : phase < HOME ? 1 - (phase - GROUNDS_END) / (HOME - GROUNDS_END)
        : 0;

      var p = at(path, u);
      var ahead = at(path, u + (u > 0.5 ? -0.02 : 0.02));
      ship.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')');

      // Face the way she is going. Homeward the course runs back down the same line, so the sign flips.
      var goingRight = (u > 0.5 ? p.x - ahead.x : ahead.x - p.x) >= 0;
      if (hull) hull.setAttribute('transform', goingRight ? '' : 'scale(-1 1)');

      var net = chart.querySelector('.net');
      if (net) net.setAttribute('opacity', rolled < 2 && phase >= OUT && phase < GROUNDS_END ? '1' : '0');

      chart.querySelectorAll('.ss-ago[data-at]').forEach(function (el) {
        el.textContent = agoText(Math.max(0, t - num(el.dataset.at)));
      });
    });
  })();
})();

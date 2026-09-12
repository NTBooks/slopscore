/* One question at a time on /but-is-it-slop. Progressive enhancement over a plain GET form: without this
 * file the page is seven fieldsets of radios and a submit button, which is all it has to be.
 *
 * Nothing here scores anything. The weights, the tiers and the draft file live in src/lib/slopquiz.ts and
 * are rendered by the server, so the enhanced path and the no-JS path can never disagree about a verdict.
 *
 * Two details worth keeping:
 *   - Auto-advance fires on `change`, not on a click, because a click forwarded from a <label> arrives with
 *     detail 0 and is indistinguishable from a keypress. Arrow and space keys are filtered by timestamp
 *     instead, so arrowing through the options does not skip past them.
 *   - `required` comes off every radio as soon as this runs. A required control inside a hidden fieldset
 *     cannot be focused, and the browser refuses the submit with a console error and no visible reason.
 *     The submit handler below enforces the same rule by hand: an incomplete form jumps to the gap.
 */
(function () {
  'use strict';
  var form = document.querySelector('form.quizform');
  if (!form) return;
  var steps = [].slice.call(form.querySelectorAll('fieldset.q'));
  if (steps.length < 2) return;

  var mq = window.matchMedia;
  var reduce = mq && mq('(prefers-reduced-motion: reduce)').matches;
  var DELAY = reduce ? 0 : 200;

  [].forEach.call(form.querySelectorAll('input[type=radio]'), function (r) { r.required = false; });

  // The progress rail is built here rather than in the markup, so it never shows up without the script
  // that moves it.
  var bar = document.createElement('div');
  bar.className = 'quizbar';
  var back = document.createElement('button');
  back.type = 'button';
  back.className = 'back';
  back.textContent = '‹ back';
  var rail = document.createElement('span');
  rail.className = 'rail';
  var fill = document.createElement('span');
  rail.appendChild(fill);
  var count = document.createElement('span');
  count.className = 'count';
  bar.appendChild(back);
  bar.appendChild(rail);
  bar.appendChild(count);
  form.insertBefore(bar, form.firstChild);
  form.classList.add('stepped');

  var at = 0, timer = null, lastKey = 0, moved = false;

  function answered(fs) { return !!fs.querySelector('input:checked'); }
  function firstGap() {
    for (var i = 0; i < steps.length; i++) if (!answered(steps[i])) return i;
    return steps.length - 1;
  }

  function show(i) {
    at = Math.max(0, Math.min(steps.length - 1, i));
    for (var j = 0; j < steps.length; j++) steps[j].hidden = j !== at;
    fill.style.width = Math.round((at / steps.length) * 100) + '%';
    count.textContent = (at + 1) + ' of ' + steps.length;
    back.hidden = at === 0;
    // Only once the reader has actually moved: stealing focus on load would scroll the page out from under them.
    if (moved) {
      var pick = steps[at].querySelector('input:checked') || steps[at].querySelector('input');
      if (pick) pick.focus({ preventScroll: true });
    }
  }

  function go(i) { moved = true; show(i); }

  // Resuming a half-finished submission: open on the first question nobody has answered.
  show(firstGap());

  back.addEventListener('click', function () { clearTimeout(timer); go(at - 1); });

  form.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Spacebar' || (e.key && e.key.indexOf('Arrow') === 0)) lastKey = Date.now();
  });

  form.addEventListener('change', function (e) {
    if (!e.target || e.target.type !== 'radio') return;
    if (Date.now() - lastKey < 400) return; // still arrowing through the options
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (at >= steps.length - 1) {
        fill.style.width = '100%';
        if (form.requestSubmit) form.requestSubmit(); else form.submit();
      } else {
        go(at + 1);
      }
    }, DELAY);
  });

  form.addEventListener('submit', function (e) {
    var gap = firstGap();
    if (answered(steps[gap])) return; // all seven are in, let it go
    e.preventDefault();
    clearTimeout(timer);
    go(gap);
  });
})();

/* panels_ui.js: every panel border of the Reel Editor is a drag separator, like Premiere / DaVinci (his words, LEDGER L454:
   "the canvas here is fixed ... I want it to be on the whole editor wherever it will be needed").
   - preview <-> right panel (the panel's left edge)
   - tabs area <-> NOTES (the line above NOTES)
   - preview <-> timeline (the timeline's top edge; the editor already had it, now it shows)
   - row names <-> timeline blocks (the right edge of the row names)
   Sizes are remembered on this device; double-click a separator = back to normal. Loaded after notes_ui.js. */
(function () {
  const root = document.documentElement, store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const css = document.createElement('style');
  css.textContent = `.psep{position:absolute;z-index:40;touch-action:none}.psep::after{content:'';position:absolute;background:transparent;transition:background .12s}
.psep:hover::after,.psep.on::after{background:#ff6b5a}
.psep.v{top:0;bottom:0;width:10px;cursor:ew-resize}.psep.v::after{left:4px;width:2px;top:0;bottom:0}
.psep.h{left:0;right:0;height:10px;cursor:ns-resize}.psep.h::after{top:4px;height:2px;left:0;right:0}
#side{position:relative}#notes{position:relative}#notes.sized:not(.shut){height:var(--nhp);max-height:none}
#tlgrip{height:10px!important;top:-5px!important}#tlgrip::after{content:'';position:absolute;left:0;right:0;top:4px;height:2px;transition:background .12s}#tlgrip:hover::after,#tlgrip.on::after{background:#ff6b5a}
#tlin>.psep.v{z-index:12}
body.dragging,body.dragging *{user-select:none!important}body.dragging iframe{pointer-events:none}`;
  document.head.append(css);

  /* one drag helper for every separator */
  function sep(el, axis, onMove, onReset, key) {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId);
      el.classList.add('on'); document.body.classList.add('dragging');
      const x0 = e.clientX, y0 = e.clientY, st = onMove(null);
      const mv = ev => onMove(st, axis === 'v' ? ev.clientX - x0 : ev.clientY - y0);
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.classList.remove('on'); document.body.classList.remove('dragging'); after(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); onReset(); store(key, null); after(); toast('Back to the normal size'); });
  }
  function after() { try { fit(); } catch (e) {} try { if (fitMode) renderTL(); else paint(); } catch (e) {} }

  /* 1. right panel width */
  const side = $('#side'), sv = document.createElement('div'); sv.className = 'psep v'; sv.style.left = '-5px'; sv.title = 'Drag: wider / narrower panel · double-click: normal'; side.append(sv);
  const setSide = w => { w = Math.max(280, Math.min(innerWidth - 360, w)); root.style.setProperty('--sidew', w + 'px'); store('sideW', w); };
  sep(sv, 'v', (s, d) => { if (!s) return { w: side.offsetWidth }; setSide(s.w - d); fit(); }, () => root.style.removeProperty('--sidew'), 'sideW');
  const sw = +read('sideW'); if (sw) setSide(sw);

  /* 2. tabs area <-> NOTES */
  const notes = $('#notes');
  if (notes) {
    const nv = document.createElement('div'); nv.className = 'psep h'; nv.style.top = '-6px'; nv.title = 'Drag: more room for notes / for the tab above · double-click: normal'; notes.append(nv);
    const setN = h => { h = Math.max(70, Math.min(side.clientHeight - 120, h)); notes.classList.add('sized'); notes.style.setProperty('--nhp', h + 'px'); store('notesH', h); };
    sep(nv, 'h', (s, d) => { if (!s) { if (notes.classList.contains('shut')) notes.querySelector('.nh').click(); return { h: notes.offsetHeight }; } setN(s.h - d); },
      () => { notes.classList.remove('sized'); notes.style.removeProperty('--nhp'); }, 'notesH');
    const nh = +read('notesH'); if (nh) setTimeout(() => setN(nh), 0);
  }

  /* 3. preview <-> timeline: the editor's own grip, now visible, plus double-click = normal */
  const g = $('#tlgrip');
  if (g) {
    g.title = 'Drag: taller / shorter timeline · double-click: normal';
    g.addEventListener('dblclick', () => { root.style.removeProperty('--tlh'); store('tlh', null); after(); toast('Back to the normal size'); });
    g.addEventListener('pointerdown', () => { g.classList.add('on'); addEventListener('pointerup', () => g.classList.remove('on'), { once: true }); });
  }

  /* 4. row names <-> blocks: the right edge of the row-name column (put back after every timeline redraw).
     While dragging only the CSS width changes (the blocks follow it); the timeline redraws on release. */
  const setHead = w => { w = Math.max(90, Math.min(420, Math.round(w))); HEADW = w; root.style.setProperty('--headw', w + 'px'); store('headW', w); };
  const hw = +read('headW'); if (hw) setHead(hw);
  const hs = document.createElement('div'); hs.className = 'psep v'; hs.title = 'Drag: wider / narrower row names · double-click: normal';
  const place = () => { hs.style.left = (tsc().scrollLeft + HEADW - 5) + 'px'; };
  tsc().addEventListener('scroll', place, { passive: true });
  sep(hs, 'v', (s, d) => { if (!s) return { w: HEADW }; setHead(s.w + d); place(); }, () => { HEADW = 156; root.style.removeProperty('--headw'); place(); }, 'headW');
  const _rn = renderNow;
  renderNow = function () { _rn(); const tl = $('#tlin'); if (tl && hs.parentNode !== tl) tl.append(hs); place(); };
  try { renderTL(); fit(); } catch (e) {}
})();

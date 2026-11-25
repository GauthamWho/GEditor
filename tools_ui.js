/* tools_ui.js: GEditor's new working tools (chat 8 plan, his OK L519): Filters, Adjust, Effects, Transitions, Voiceover,
   and for his own videos the picked clip's tabs Video / Audio / Speed / Look. Everything goes into the video file:
   kit reels = the export films the page (fx_runtime.js draws it); his own videos = fx_ffmpeg.py, same numbers.
   Data: his own video -> take.json "fx" (undo with the take); kit reels -> projects/<kit>__<reel>.fx.json (undo with the editor). */
(function () {
  if (!window.GE || !GE.register) return;
  const IST = () => !!(M && M.type === 'take');
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const css = el('style');
  css.textContent = `
.fxg{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin:6px 0 10px}
.fxt{display:flex;flex-direction:column;align-items:center;gap:5px;background:#2a2622;border:1px solid var(--line);border-radius:10px;padding:6px 4px 7px;cursor:pointer;color:var(--ink);font-size:12px}
.fxt:hover{border-color:#d9a038}.fxt.on{border-color:#ffd27a;background:#3a301c;color:#ffe7b0}
.fxt .sw{width:100%;height:44px;border-radius:7px;background:#111 center/cover}.fxt .ic{font-size:22px;line-height:44px;height:44px}
.scope{display:flex;gap:0;margin:2px 0 10px}.scope button{flex:1;border-radius:0}.scope button:first-child{border-radius:8px 0 0 8px}.scope button:last-child{border-radius:0 8px 8px 0}.scope button.on{background:#5a4a1e;border-color:#d9a038;color:#ffe7b0}
.sl{display:flex;align-items:center;gap:8px;margin:5px 0}.sl label{width:86px;flex:none;font-size:13px}.sl input{flex:1;accent-color:var(--red)}.sl span{width:38px;text-align:right;font:12px Consolas,monospace;color:var(--soft)}
.fxi{background:#2a2622;border:1px solid var(--line);border-radius:9px;padding:7px 9px;margin:6px 0}.fxi.sel{border-color:#ffd27a}
.fxi .top{display:flex;align-items:center;gap:6px}.fxi .top b{flex:1}.fxi input[type=number]{width:62px;background:#1c1916;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:3px 5px}
.rec{width:84px;height:84px;border-radius:50%;background:#c4251a;border:4px solid #3a1210;color:#fff;font:700 15px system-ui;margin:10px auto;display:flex;align-items:center;justify-content:center;cursor:pointer}
.rec.on{animation:recp 1s infinite;background:#ff3b3b}@keyframes recp{50%{box-shadow:0 0 0 10px #ff3b3b33}}
.ctabs{display:flex;gap:4px;margin:0 0 10px;flex-wrap:wrap}.ctabs button{padding:5px 10px;border-radius:16px}.ctabs button.on{background:#ffd27a;color:#111;border-color:#ffd27a}
.blk.fxb{background:#4a2f63;border:1px solid #b98ae6;cursor:grab}.blk.fxb.tr{background:#6b2a24;border-color:#ff8a7a}.blk.fxb .hl,.blk.fxb .hr{position:absolute;top:0;bottom:0;width:7px;cursor:ew-resize;background:#0004;z-index:2}.blk.fxb .hl{left:0}.blk.fxb .hr{right:0}
`;
  document.head.append(css);
  const MATH = () => { try { return cw().GEFX_MATH; } catch (e) { return null; } };

  /* ---------- the fx data ---------- */
  let KFX = {}, FXSEL = null, sv = null;
  const fx = () => { if (IST()) { const T = TAKE.TK; if (!T) return {}; return T.fx || (T.fx = {}); } return KFX; };
  function push() { try { cw().GEFX && cw().GEFX.set(IST() ? (TAKE.TK && TAKE.TK.fx) : KFX); } catch (e) {} }
  function save(live) {
    if (IST()) { if (live) TAKE.live2(); else TAKE.changed(); return; }
    push(); if (!live) hist(); clearTimeout(sv); sv = setTimeout(() => post('/api/fx', KFX), 400);
  }
  GE.fxGet = () => IST() ? null : JSON.parse(JSON.stringify(KFX));
  GE.fxSet = d => { if (IST()) return; KFX = d || {}; push(); post('/api/fx', KFX); renderTL(); GE.renderLib && GE.renderLib(); };
  if (!IST()) api('/api/fx').then(d => { KFX = d || {}; push(); renderTL(); }).catch(() => {});
  pv.addEventListener('load', () => setTimeout(push, 300));
  const clipsPicked = () => IST() && TAKE.TK ? TAKE.TK.blocks.filter(b => TAKE.TSEL.has(b)) : [];
  let SCOPE = 'all';   // 'all' = whole reel, 'clip' = the picked clip(s) of his own video
  function lookOf(create) {
    const F = fx(), cp = clipsPicked();
    if (SCOPE === 'clip' && cp.length) { F.clips = F.clips || {}; if (create) cp.forEach(b => F.clips[b.id] = F.clips[b.id] || {}); return F.clips[cp[0].id] || {}; }
    if (create && !F.look) F.look = {}; return F.look || {};
  }
  function setLook(fn, live) {
    const F = fx(), cp = clipsPicked();
    if (SCOPE === 'clip' && cp.length) { F.clips = F.clips || {}; cp.forEach(b => { F.clips[b.id] = F.clips[b.id] || {}; fn(F.clips[b.id]); clean(F.clips, b.id); }); }
    else { F.look = F.look || {}; fn(F.look); if (!F.look.filter && !Object.keys(F.look.adj || {}).length) delete F.look; }
    save(live);
  }
  function clean(o, k) { const v = o[k]; if (v && !v.filter && !Object.keys(v.adj || {}).length) delete o[k]; }
  function scopeBar(b, redraw) {
    if (!IST()) return;
    const cp = clipsPicked(); if (!cp.length && SCOPE === 'clip') SCOPE = 'all';
    const s = el('div', 'scope');
    [['all', 'Whole video'], ['clip', cp.length ? `Picked clip${cp.length > 1 ? 's (' + cp.length + ')' : ''}` : 'Pick a clip first']].forEach(([v, n]) => { const x = btn(n, () => { SCOPE = v; redraw(); }); x.className = SCOPE === v ? 'on' : ''; if (v === 'clip' && !cp.length) x.disabled = true; s.append(x); });
    b.append(s);
  }

  /* ---------- Filters ---------- */
  const FNAMES = { warm: 'Warm', cool: 'Cool', film: 'Film', bw: 'B&W', punchy: 'Punchy', fade: 'Faded', teal: 'Teal + orange', night: 'Night', vivid: 'Vivid', vintage: 'Vintage', golden: 'Golden hour', moody: 'Moody' };
  function swatch(name) {   // a small picture of the filter: skin, sky, shadow colours through the same maths
    const m = MATH(); if (!m) return '#333';
    const o = m.mix(name ? { filter: name, amt: 1 } : null), M = m.matrix(o), cols = [[214, 160, 122], [86, 140, 196], [40, 36, 34], [236, 228, 214]];
    const tc = ch => m.curve(o, ch), C = [tc(0), tc(1), tc(2)];
    const lut = (v, ch) => { const x = Math.min(Math.max(v, 0), 1) * 8, i = Math.min(7, Math.floor(x)), f = x - i; return C[ch][i] + (C[ch][i + 1] - C[ch][i]) * f; };
    const out = cols.map(([r, g, b]) => { r /= 255; g /= 255; b /= 255; const R = M[0] * r + M[1] * g + M[2] * b, G = M[3] * r + M[4] * g + M[5] * b, B = M[6] * r + M[7] * g + M[8] * b; return `rgb(${Math.round(lut(R, 0) * 255)},${Math.round(lut(G, 1) * 255)},${Math.round(lut(B, 2) * 255)})`; });
    return `linear-gradient(135deg,${out[3]} 0 25%,${out[0]} 25% 55%,${out[1]} 55% 80%,${out[2]} 80%)`;
  }
  GE.register({ id: 'filters', order: 80, icon: '◐', label: 'Filters', tip: 'one look for the whole video or one clip', live: true, render(b) {
    const redraw = () => GE.renderLib(); scopeBar(b, redraw);
    const L = lookOf(false), g = el('div', 'fxg');
    [['', 'None'], ...Object.entries(FNAMES)].forEach(([k, n]) => {
      const t = el('div', 'fxt' + ((L.filter || '') === k ? ' on' : ''), `<div class="sw" style="background:${swatch(k)}"></div>${n}`);
      t.onclick = () => { setLook(x => { if (k) { x.filter = k; if (x.amt == null) x.amt = 1; } else { delete x.filter; delete x.amt; } }); toast(k ? n + ' on ' + (SCOPE === 'clip' ? 'the picked clip' : 'the whole video') : 'Filter off'); };
      g.append(t);
    });
    b.append(g);
    if (L.filter) {
      const s = el('div', 'sl', `<label>Strength</label><input type="range" min="0" max="1.5" step="0.05" value="${L.amt ?? 1}"><span>${Math.round((L.amt ?? 1) * 100)}%</span>`);
      const r = s.querySelector('input'); r.oninput = () => { s.querySelector('span').textContent = Math.round(r.value * 100) + '%'; setLook(x => x.amt = +r.value, true); }; r.onchange = () => setLook(x => x.amt = +r.value);
      b.append(s);
    }
    b.append(para('Shows on the video at once and goes into the exported file the same way.' + (IST() ? ' A clip\'s own filter adds on top of the whole-video one.' : '')));
  } });

  /* ---------- Adjust ---------- */
  const ADJ = [['bright', 'Brightness', -1, 1], ['contrast', 'Contrast', -0.8, 1], ['sat', 'Saturation', -1, 1], ['warm', 'Warmth', -1, 1], ['tint', 'Tint', -1, 1], ['hi', 'Highlights', -1, 1], ['sh', 'Shadows', -1, 1], ['fade', 'Fade', 0, 1], ['sharp', 'Sharpen', 0, 1], ['vig', 'Vignette', 0, 1], ['grain', 'Grain', 0, 1]];
  GE.register({ id: 'adjust', order: 90, icon: '±', label: 'Adjust', tip: 'brightness, contrast, colour, sharpen, vignette', live: true, render(b) {
    const redraw = () => GE.renderLib(); scopeBar(b, redraw);
    const A = lookOf(false).adj || {};
    ADJ.forEach(([k, n, mn, mx]) => {
      const v = A[k] || 0, s = el('div', 'sl', `<label>${n}</label><input type="range" min="${mn}" max="${mx}" step="0.01" value="${v}"><span>${Math.round(v * 100)}</span>`);
      const r = s.querySelector('input'), set = (live) => setLook(x => { x.adj = x.adj || {}; if (Math.abs(+r.value) < 0.005) delete x.adj[k]; else x.adj[k] = +r.value; if (!Object.keys(x.adj).length) delete x.adj; }, live);
      r.oninput = () => { s.querySelector('span').textContent = Math.round(r.value * 100); set(true); }; r.onchange = () => set(false);
      r.ondblclick = () => { r.value = 0; s.querySelector('span').textContent = 0; set(false); };
      b.append(s);
    });
    const row = el('div', 'btnrow'); row.append(btn('↺ Reset all', () => setLook(x => delete x.adj))); b.append(row);
    b.append(para('Double-click a slider = back to 0. In the video file too.'));
  } });

  /* ---------- Effects + Transitions: data, timeline row, panels ---------- */
  const EFX = { flash: ['⚡', 'Flash', 0.4], shake: ['〰', 'Shake', 0.6], zoom: ['🔍', 'Zoom punch', 0.5], blurin: ['◌', 'Blur in', 0.8], rgb: ['▤', 'RGB split', 0.5], leak: ['☀', 'Light leak', 1.5], grain: ['░', 'Film grain', 3], bw: ['◑', 'Black & white', 2], vig: ['◉', 'Vignette', 3] };
  const TRX = { fade: ['◐', 'Fade (dip to black)'], white: ['○', 'Dip to white'], flash: ['⚡', 'Flash cut'], zoom: ['🔍', 'Zoom through'], blur: ['◌', 'Blur'], whip: ['➶', 'Whip pan'], glitch: ['▤', 'Glitch'], leak: ['☀', 'Light leak'] };
  const fid = () => 'f' + Date.now().toString(36) + Math.floor(Math.random() * 99);
  function cuts() {   // where one clip / line meets the next: his own video = clip edges; a kit reel = its line changes
    if (IST() && TAKE.TK) return TAKE.TK.blocks.slice(1).map(b => ({ t: b._s, before: b.id }));
    return (beats || []).slice(1).map(x => ({ t: x.t0 }));
  }
  function transT(x) { if (x.before != null && IST() && TAKE.TK) { const b = TAKE.TK.blocks.find(c => c.id === x.before); return b ? b._s : null; } return x.at; }
  function addEffect(kind) {
    const F = fx(); F.effects = F.effects || []; const d = EFX[kind][2];
    const e = { id: fid(), kind, t0: +t.toFixed(3), t1: +Math.min(total, t + d).toFixed(3), amt: 1 }; F.effects.push(e); FXSEL = e.id;
    save(); renderTL(); GE.renderLib(); toast(EFX[kind][1] + ' at ' + fmtT(t) + ' · drag it on the EFFECTS row, pull its edges');
  }
  function addTrans(kind) {
    const C = cuts(); if (!C.length) return toast(IST() ? 'Split the video first (B): a transition goes between two clips' : 'This reel has no cuts to put a transition on');
    const c = C.reduce((a, x) => Math.abs(x.t - t) < Math.abs(a.t - t) ? x : a);
    const F = fx(); F.trans = (F.trans || []).filter(x => !(x.before != null ? x.before === c.before : Math.abs(x.at - c.t) < 0.02));
    const x = { id: fid(), kind, dur: 0.5 }; if (c.before != null) x.before = c.before; else x.at = +c.t.toFixed(3);
    F.trans.push(x); FXSEL = x.id; save(); renderTL(); GE.renderLib(); seek(Math.max(0, c.t - 0.6)); follow();
    toast(TRX[kind][1] + ' at the cut at ' + fmtT(c.t) + ' · press Space to watch it');
  }
  function delFx(id) { const F = fx(); F.effects = (F.effects || []).filter(e => e.id !== id); F.trans = (F.trans || []).filter(e => e.id !== id); if (FXSEL === id) FXSEL = null; save(); renderTL(); GE.renderLib(); }
  GE.delFx = delFx;
  function fxItem(e, isT) {
    const d = el('div', 'fxi' + (FXSEL === e.id ? ' sel' : '')), info = isT ? TRX[e.kind] : EFX[e.kind]; if (!info) return d;
    const tt = isT ? transT(e) : e.t0;
    d.innerHTML = `<div class="top"><span>${info[0]}</span><b>${info[1]}</b><small>${tt == null ? '' : fmtT(tt)}</small></div>`;
    const top = d.querySelector('.top');
    const x = btn('✕', () => delFx(e.id)); x.title = 'Remove'; top.append(x);
    d.onclick = ev => { if (ev.target.closest('button,input')) return; FXSEL = e.id; if (tt != null) { seek(Math.max(0, tt - (isT ? 0.6 : 0))); follow(); } renderTL(); GE.renderLib(); };
    if (FXSEL === e.id) {
      if (isT) {
        const s = el('div', 'sl', `<label>Length</label><input type="range" min="0.2" max="2" step="0.05" value="${e.dur || 0.5}"><span>${(e.dur || 0.5).toFixed(2)}s</span>`), r = s.querySelector('input');
        r.oninput = () => { e.dur = +r.value; s.querySelector('span').textContent = e.dur.toFixed(2) + 's'; save(true); renderTL(); }; r.onchange = () => save(); d.append(s);
        const k = el('select'); k.innerHTML = Object.entries(TRX).map(([v, n]) => `<option value="${v}" ${v === e.kind ? 'selected' : ''}>${n[1]}</option>`).join(''); k.onchange = () => { e.kind = k.value; save(); renderTL(); GE.renderLib(); }; d.append(k);
      } else {
        const s = el('div', 'sl', `<label>Strength</label><input type="range" min="0.1" max="2" step="0.05" value="${e.amt ?? 1}"><span>${Math.round((e.amt ?? 1) * 100)}%</span>`), r = s.querySelector('input');
        r.oninput = () => { e.amt = +r.value; s.querySelector('span').textContent = Math.round(e.amt * 100) + '%'; save(true); }; r.onchange = () => save(); d.append(s);
        const tm = el('div', 'sl', `<label>From / to (s)</label><input type="number" step="0.05" min="0" value="${e.t0}"><input type="number" step="0.05" min="0" value="${e.t1}">`), [a, z] = tm.querySelectorAll('input');
        a.onchange = () => { e.t0 = Math.max(0, Math.min(+a.value, e.t1 - 0.05)); save(); renderTL(); }; z.onchange = () => { e.t1 = Math.min(total, Math.max(+z.value, e.t0 + 0.05)); save(); renderTL(); };
        [a, z].forEach(i => i.onkeydown = ev => ev.stopPropagation()); d.append(tm);
        d.append(btn('▶ Play it', () => playRange(Math.max(0, e.t0 - 0.4), Math.min(total, e.t1 + 0.4))));
      }
    }
    return d;
  }
  GE.register({ id: 'effects', order: 60, icon: '✦', label: 'Effects', tip: 'flash, shake, zoom punch, blur, glitch, light leak…', live: true, render(b) {
    const g = el('div', 'fxg');
    Object.entries(EFX).forEach(([k, [ic, n]]) => { const x = el('div', 'fxt', `<span class="ic">${ic}</span>${n}`); x.title = 'Add at the red line'; x.onclick = () => addEffect(k); g.append(x); });
    b.append(para('Click one: it lands at the red line on the EFFECTS row. Drag it, pull its edges, Delete removes it.'), g);
    const L = fx().effects || []; b.append(h3(`In this reel (${L.length})`)); if (!L.length) b.append(para('No effects yet.'));
    L.slice().sort((a, c) => a.t0 - c.t0).forEach(e => b.append(fxItem(e, false)));
  } });
  GE.register({ id: 'transitions', order: 70, icon: '⋈', label: 'Transitions', tip: 'between two clips', live: true, render(b) {
    const g = el('div', 'fxg');
    Object.entries(TRX).forEach(([k, [ic, n]]) => { const x = el('div', 'fxt', `<span class="ic">${ic}</span>${n}`); x.title = 'Put it on the cut nearest the red line'; x.onclick = () => addTrans(k); g.append(x); });
    b.append(para(IST() ? 'Goes on the cut between two clips nearest the red line. No cuts yet? Split the video with B.' : 'Goes on the line change nearest the red line.'), g);
    const L = fx().trans || []; b.append(h3(`In this reel (${L.length})`)); if (!L.length) b.append(para('No transitions yet.'));
    L.forEach(e => b.append(fxItem(e, true)));
  } });

  // the EFFECTS row on the timeline (effects = blocks; transitions = short red blocks on the cut)
  const _mk = makeRows;
  makeRows = function () {
    const R = _mk(), F = fx(); if (!(F.effects && F.effects.length) && !(F.trans && F.trans.length)) return R;
    const row = { id: 'fx:row', name: 'EFFECTS', sub: 'effects + transitions · drag', group: 'v', h: rowH['fx:row'] ? Math.max(26, rowH['fx:row']) : 32, packed: [], n: 1 };
    const i = R.findIndex(r => r.group === 'a'); R.splice(i < 0 ? R.length : i, 0, row); return R;
  };
  const _rn = renderNow;
  renderNow = function () {
    _rn(); const rc = document.querySelector('#tlin .row[data-row="fx:row"] .rc'); if (!rc) return; const F = fx(), H = (rc.parentElement.offsetHeight || 32) - 6;
    (F.effects || []).forEach(e => {
      const info = EFX[e.kind] || ['?', e.kind]; const d = blk('fxb' + (FXSEL === e.id ? ' sel' : ''), X(e.t0), Math.max(4, X(e.t1 - e.t0)), 3, H, `<i class="hl"></i><span class="lb">${info[0]} ${info[1]}</span><i class="hr"></i>`);
      d.title = info[1] + ` · ${e.t0.toFixed(2)}–${e.t1.toFixed(2)} s\ndrag = move · pull an edge = longer / shorter · Delete = remove · double-click = play it`;
      d.onpointerdown = ev => fxDrag(ev, d, e); d.ondblclick = () => playRange(Math.max(0, e.t0 - 0.4), Math.min(total, e.t1 + 0.4));
      d.oncontextmenu = ev => { ev.preventDefault(); ev.stopPropagation(); FXSEL = e.id; menuAt(ev.clientX, ev.clientY, [['▶  Play it', () => playRange(Math.max(0, e.t0 - 0.4), Math.min(total, e.t1 + 0.4))], ['⧉  Copy at the red line', () => { const c = Object.assign({}, e, { id: fid(), t0: +t.toFixed(3), t1: +Math.min(total, t + e.t1 - e.t0).toFixed(3) }); fx().effects.push(c); save(); renderTL(); }], [], ['🗑  Remove', () => delFx(e.id)]]); };
      rc.append(d);
    });
    (F.trans || []).forEach(x => {
      const T = transT(x); if (T == null) return; const info = TRX[x.kind] || ['?', x.kind], dur = x.dur || 0.5;
      const d = blk('fxb tr' + (FXSEL === x.id ? ' sel' : ''), X(T - dur / 2), Math.max(6, X(dur)), 3, H, `<span class="lb">${info[0]}</span>`);
      d.title = info[1] + ' · double-click = play it · Delete = remove'; d.onpointerdown = ev => { if (ev.button === 2) return; ev.stopPropagation(); FXSEL = x.id; SEL.clear(); renderTL(); GE.openTool('transitions', true); };
      d.ondblclick = () => playRange(Math.max(0, T - 0.8), Math.min(total, T + 0.8));
      d.oncontextmenu = ev => { ev.preventDefault(); ev.stopPropagation(); FXSEL = x.id; menuAt(ev.clientX, ev.clientY, [['▶  Play it', () => playRange(Math.max(0, T - 0.8), Math.min(total, T + 0.8))], [], ['🗑  Remove', () => delFx(x.id)]]); };
      rc.append(d);
    });
  };
  function fxDrag(ev, d, e) {
    if (ev.button === 2) return; ev.stopPropagation(); ev.preventDefault();
    FXSEL = e.id; SEL.clear(); if (IST()) TAKE.TSEL.clear();
    const side = ev.target.classList.contains('hl') ? 'a' : ev.target.classList.contains('hr') ? 'z' : 'm', x0 = ev.clientX, a0 = e.t0, z0 = e.t1; let moved = false;
    const mv = m => { const dt = (m.clientX - x0) / pps; moved = true;
      if (side === 'm') { const L = z0 - a0; e.t0 = Math.round(Math.max(0, Math.min(total - L, a0 + dt)) * FPS) / FPS; e.t1 = +(e.t0 + L).toFixed(4); }
      if (side === 'a') e.t0 = Math.round(Math.max(0, Math.min(e.t1 - 2 / FPS, a0 + dt)) * FPS) / FPS;
      if (side === 'z') e.t1 = Math.round(Math.min(total, Math.max(e.t0 + 2 / FPS, z0 + dt)) * FPS) / FPS;
      renderTL(); save(true); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved) save(); else { seek(e.t0); } renderTL(); GE.openTool('effects', true); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  addEventListener('keydown', e => {
    if (!FXSEL || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); delFx(FXSEL); toast('Removed · Ctrl+Z brings it back'); }
    if (e.key === 'Escape') { FXSEL = null; renderTL(); }
  }, true);
  addEventListener('pointerdown', e => { if (FXSEL && e.target.closest && e.target.closest('#tlin') && !e.target.closest('.fxb')) { FXSEL = null; } }, true);

  /* ---------- Voiceover ---------- */
  let REC = null;
  GE.register({ id: 'voiceover', order: 50, icon: '🎙', label: 'Voiceover', tip: 'talk over the reel while it plays', render(b) {
    b.append(para('Put the red line where you want to start, press the button, talk while the reel plays, press again to stop. Your voice lands on the VOICEOVER row at that spot.'));
    const r = el('div', 'rec' + (REC ? ' on' : ''), REC ? 'Stop' : 'Record'); r.onclick = () => REC ? stopRec() : startRec(); b.append(r);
    const m = el('label', '', `<input type="checkbox" id="vomute" ${localStorage.getItem('voMute') === '0' ? '' : 'checked'}> Mute the reel while I record (no echo from the speakers)`); m.style.cssText = 'display:block;margin:8px 0;color:var(--soft);font-size:13px';
    m.querySelector('input').onchange = ev => { try { localStorage.setItem('voMute', ev.target.checked ? '1' : '0'); } catch (er) {} }; b.append(m);
    if (!window.isSecureContext) b.append(para('⚠ This page is open over the Wi-Fi link, and the browser blocks the microphone there. Record on the PC (localhost link).'));
    const L = sounds.filter(s => s.role === 'voiceover'); b.append(h3(`Your voiceovers (${L.length})`)); if (!L.length) b.append(para('None yet.'));
    L.forEach(s => { const d = el('div', 'tile', `<span class="nm">🎙 at ${s.t.toFixed(2)} s<br><small>${stem(s.file)}</small></span>`); d.onclick = () => { pickSound(s); seek(s.t); follow(); }; b.append(d); });
  } });
  async function startRec() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('This browser cannot record here (open GEditor on the PC: localhost link)', 6000);
    let st; try { st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { return toast('Microphone blocked: allow it in the browser bar and try again', 6000); }
    const mt = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(x => window.MediaRecorder && MediaRecorder.isTypeSupported(x)) || '';
    const mr = new MediaRecorder(st, mt ? { mimeType: mt } : undefined), chunks = [], t0 = t, mute = localStorage.getItem('voMute') !== '0';
    REC = { mr, st, t0, mute }; mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      st.getTracks().forEach(x => x.stop()); const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      if (blob.size < 2000) { toast('Nothing was recorded'); return; }
      toast('Saving your voiceover…');
      const r = await fetch('/api/upload?name=voiceover_' + Date.now() + '.webm', { method: 'POST', body: blob }).then(x => x.json()).catch(() => ({ error: 'upload failed' }));
      if (r.error) return toast(r.error, 5000);
      const c = { id: 's' + Date.now(), t: +t0.toFixed(2), role: 'voiceover', file: r.file, gain: 0 }; sounds.push(c); selSnd = c; saveSounds(); buildSounds(); try { await loadWaves(); } catch (e) {} renderTL(); GE.renderLib();
      toast('Voiceover added at ' + fmtT(t0) + ' · drag it, or pull its edges to trim');
    };
    if (mute) { try { cw().document.querySelectorAll('video,audio').forEach(v => { v.dataset.vm = v.muted ? '1' : '0'; v.muted = true; }); } catch (e) {} }
    mr.start(250); if (mute) { const g = AC; if (g) g.suspend().catch(() => {}); } play(true); GE.renderLib(); toast('Recording… press Record again (or Esc) to stop', 3000);
  }
  function stopRec() {
    if (!REC) return; const R = REC; REC = null; play(false); try { R.mr.stop(); } catch (e) {}
    if (R.mute) { try { cw().document.querySelectorAll('video,audio').forEach(v => v.muted = v.dataset.vm === '1'); } catch (e) {} if (AC) AC.resume().catch(() => {}); }
    GE.renderLib();
  }
  addEventListener('keydown', e => { if (REC && e.key === 'Escape') { e.preventDefault(); stopRec(); } }, true);

  /* ---------- his own video: the picked clip's tabs (CapCut: Video · Audio · Speed · Look) ---------- */
  let CTAB = 'Video';
  GE.clipPanel = function (p, picked, base) {
    const tb = el('div', 'ctabs');
    ['Video', 'Audio', 'Speed', 'Look'].forEach(n => { const x = btn(n, () => { CTAB = n; draw(); }); x.className = CTAB === n ? 'on' : ''; tb.append(x); });
    p.append(tb);
    const H = TAKE.H, b0 = picked[0];
    if (CTAB === 'Video') return base();
    if (CTAB === 'Audio') {
      p.append(h3(picked.length > 1 ? picked.length + ' clips' : 'Clip sound'));
      p.append(H.row('Its sound', H.sw(!picked.every(x => x.mute), v => { picked.forEach(x => x.mute = !v); TAKE.changed(); }, '🔊 On', '🔇 Muted')));
      const g = b0.gain || 0, s = el('div', 'sl', `<label>Loudness</label><input type="range" min="-30" max="0" step="0.5" value="${g}"><span>${g} dB</span>`), r = s.querySelector('input');
      r.oninput = () => { picked.forEach(x => x.gain = +r.value || undefined); s.querySelector('span').textContent = r.value + ' dB'; TAKE.live2(); }; r.onchange = () => TAKE.changed();
      p.append(s, para('0 dB = as filmed. The whole video is levelled to -14 LUFS in the file after this.'));
      return;
    }
    if (CTAB === 'Speed') {
      const sp = b0.speed || 1; p.append(h3('Speed'));
      const w = el('div', 'btnrow'); [0.5, 0.75, 1, 1.25, 1.5, 2, 3].forEach(v => { const x = btn(v + '×', () => setSpeed(picked, v)); if (Math.abs(sp - v) < 0.001) x.className = 'on pri'; w.append(x); }); p.append(w);
      const s = el('div', 'sl', `<label>Exact</label><input type="range" min="0.25" max="4" step="0.05" value="${sp}"><span>${sp}×</span>`), r = s.querySelector('input');
      r.oninput = () => s.querySelector('span').textContent = (+r.value).toFixed(2) + '×'; r.onchange = () => setSpeed(picked, +r.value); p.append(s);
      p.append(para(`Clip length now ${TAKE.q((b0.out - b0.in) / sp).toFixed(2)} s. Your voice keeps its pitch (no chipmunk). Captions follow the speed.`));
      return;
    }
    if (CTAB === 'Look') { SCOPE = 'clip'; p.append(para('Filter + Adjust for the picked clip only: open <b>Filters</b> or <b>Adjust</b> on the left (they switch to "Picked clip").')); const x = btn('◐ Open Filters for this clip', () => { SCOPE = 'clip'; GE.openTool('filters', true); }); const y = btn('± Open Adjust for this clip', () => { SCOPE = 'clip'; GE.openTool('adjust', true); }); const w = el('div', 'btnrow'); w.append(x, y); p.append(w); const c = (fx().clips || {})[b0.id]; p.append(para(c ? `This clip: ${c.filter ? FNAMES[c.filter] + ' ' + Math.round((c.amt ?? 1) * 100) + '%' : 'no filter'}${c.adj ? ' · ' + Object.keys(c.adj).length + ' adjustments' : ''}` : 'This clip has no look of its own yet.')); return; }
  };
  function setSpeed(picked, v) { v = Math.min(4, Math.max(0.25, v)); picked.forEach(b => { if (Math.abs(v - 1) < 0.001) delete b.speed; else b.speed = +v.toFixed(3); }); TAKE.changed(); toast(`Speed ${v}×`); }
})();

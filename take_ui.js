/* take_ui.js: GEditor's side of his own take (Reel Editor LEDGER L468, L470, L492, L493). Loaded after editor.html's script.
   - Header button "🎬 Auto Edit a take": pick a take (GauthamWho/Inbox or any path) -> auto.py cuts + zooms -> blocks.
   - Timeline rows VIDEO (his blocks, both edges drag like CapCut, the sound follows = linked), VOICE, CAPTIONS.
   - Take tab: 9:16 / 16:9, Eye-Lock on/off, captions (GauthamWho / Blueprint / SKY looks + colour, size, font, saved looks),
     safe-zone layer, picked block (zoom, split, delete), save project.
   - Video tab: export at any size + fps, SDR or HDR (take_api.export).
   Uses editor globals: M, total, t, beats, SEL, X, blk, esc, seek, cw, pv, api, post, toast, tab, tabs, draw, renderTL, play,
   playing, makeRows, renderNow, para, h3, btn, frame, FPS. */
(function () {
  if (typeof makeRows !== 'function') return;
  const IS = () => M && M.type === 'take';
  const q = x => Math.round(x * FPS) / FPS;
  let TK = null, CSEL = '', TSEL = new Set(), UNDO = [], REDO = [], LOOKS = [], JOBT = null;
  const clone = o => JSON.parse(JSON.stringify(o));
  window.takeGet = () => TK;
  const css = document.createElement('style');
  css.textContent = '.rh em.tkrb{top:3px}.rh em.tkrb button{font:15px/1.2 "Segoe UI Emoji",system-ui;padding:1px 6px;border-radius:5px}.rh em.tkrb button.off{background:#7a2a22;border-color:#ff6b5a}'
    + '.tkc.sel{outline:2px solid #ffd27a;outline-offset:1px;z-index:3}';
  document.head.append(css);

  /* ---------- header: open a take from anywhere ---------- */
  const hb = document.createElement('button'); hb.id = 'takebtn'; hb.textContent = '🎬 Auto Edit a take'; hb.title = 'Put in your own video: cuts + zooms are made for you as blocks you can change';
  const home = document.getElementById('home'); if (home) home.after(hb);
  hb.onclick = () => openPicker();
  async function openPicker() {
    const list = await api('/api/take/inbox'); closeDlg();
    const d = document.createElement('div'); d.id = 'takedlg';
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99;display:flex;align-items:center;justify-content:center';
    d.innerHTML = `<div style="background:#221f1c;color:#eee;border:1px solid #4a433c;border-radius:12px;padding:22px;width:min(560px,92vw);max-height:80vh;overflow:auto;font:14px system-ui">
      <h2 style="margin:0 0 6px;font-size:18px">Auto Edit a take</h2>
      <div style="color:#bbb;margin-bottom:12px">Pick your video. GEditor cuts the pauses and adds the zooms (your auto.py), then shows every piece as a block you can change.</div>
      ${list.map(f => `<button data-p="${esc(f.path)}" style="display:block;width:100%;text-align:left;margin:4px 0;padding:9px 12px">${esc(f.name)} <span style="color:#999">· ${f.mb} MB</span></button>`).join('') || '<div>No videos in GauthamWho/Inbox.</div>'}
      <div style="margin-top:12px;color:#bbb">Or paste the full path of any video:</div>
      <input id="takepath" style="width:100%;box-sizing:border-box;margin:6px 0;padding:8px" placeholder="D:\\...\\IMG_1234.mov">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button id="takego" class="pri">Auto Edit</button><button id="takeno">Close</button></div></div>`;
    document.body.append(d);
    d.querySelectorAll('[data-p]').forEach(b => b.onclick = () => startTake(b.dataset.p));
    d.querySelector('#takego').onclick = () => { const v = d.querySelector('#takepath').value.trim().replace(/^"|"$/g, ''); if (v) startTake(v); };
    d.querySelector('#takeno').onclick = closeDlg; d.onclick = e => { if (e.target === d) closeDlg(); };
  }
  const closeDlg = () => { const x = document.getElementById('takedlg'); if (x) x.remove(); };
  async function startTake(path) {
    const r = await post('/api/take/new', { path }); if (r.error) return toast('Could not start: ' + r.error, 6000);
    closeDlg(); location.href = '/?kit=take&reel=' + encodeURIComponent(r.reel);
  }

  /* ---------- the take ---------- */
  async function loadTake() {
    TK = await api('/api/take/info');
    try { LOOKS = await api('/api/take/looks'); } catch (e) { LOOKS = []; }
    if (TK && TK.blocks) { sizeFrame(); recalc(); }
  }
  const dur = b => q((b.out - b.in) / (b.speed || 1));   // speed (chat 8)
  function recalc() { let a = 0; TK.blocks.forEach(b => { b._s = a; a += dur(b); }); total = Math.max(a, 1 / FPS); }
  let sv = null, live = null;
  function changed(opts = {}) {      // every change: preview now, file saved shortly after, undo point
    if (!opts.noUndo) { UNDO.push(JSON.stringify(stripped(PREV))); if (UNDO.length > 200) UNDO.shift(); REDO = []; }
    PREV = clone(stripped(TK)); recalc();
    clearTimeout(live); live = setTimeout(() => { try { cw().takeSet(stripped(TK)); beats = (cw().BEATS && cw().BEATS.beats) || []; } catch (e) {} renderTL(); }, opts.fast ? 0 : 30);
    renderTL(); if (tab === 'Take') draw();
    clearTimeout(sv); sv = setTimeout(() => post('/api/take/save', { take: stripped(TK) }), 700);
  }
  let PREV = null;
  const stripped = o => { const c = clone(o); (c.blocks || []).forEach(b => delete b._s); return c; };
  const _undo = undo, _redo = redo;
  undo = function () { if (IS() && UNDO.length) { REDO.push(JSON.stringify(stripped(TK))); TK = JSON.parse(UNDO.pop()); TSEL.clear(); changed({ noUndo: true }); return toast('Undone'); } _undo(); };
  redo = function () { if (IS() && REDO.length) { UNDO.push(JSON.stringify(stripped(TK))); TK = JSON.parse(REDO.pop()); changed({ noUndo: true }); return toast('Redone'); } _redo(); };

  /* ---------- preview size (9:16 or 16:9) ---------- */
  function sizeFrame() {
    if (!IS() || !TK) return;
    const wide = TK.settings.aspect === '16:9', W = wide ? 1920 : 1080, H = wide ? 1080 : 1920;
    pv.style.width = W + 'px'; pv.style.height = H + 'px';
    const st = document.getElementById('stage'), h = st.clientHeight - 28, w = st.clientWidth - 28, s = Math.min(h / H, w / W);
    frame.style.width = W * s + 'px'; frame.style.height = H * s + 'px'; pv.style.transform = `scale(${s})`;
  }
  const _fit = fit; fit = function () { if (IS() && TK) sizeFrame(); else _fit(); };
  addEventListener('resize', () => { if (IS()) setTimeout(sizeFrame, 0); });

  /* ---------- timeline rows ---------- */
  const _mk = makeRows;
  makeRows = function () {
    const R = _mk(); if (!IS() || !TK) return R;
    const keep = R.filter(r => r.id !== 'lines' && r.id !== 'pieces' && r.id !== 'snd:none');
    const mine = [
      { id: 'tk:video', name: 'VIDEO', sub: `${TK.blocks.length} blocks · drag an edge`, group: 'v', h: 48, packed: [], n: 1 },
      { id: 'tk:caps', name: 'CAPTIONS', sub: TK.words && TK.words.length ? lookName(TK.settings.caption) : (jobMsg || 'words not ready yet'), group: 'v', h: 30, packed: [], n: 1 },
    ];
    const snd = keep.filter(r => r.group === 'a'), rest = keep.filter(r => r.group !== 'a');
    const voice = { id: 'tk:voice', name: 'VOICE', sub: 'your sound · follows the video', group: 'a', h: 40, role: 'none', packed: [], n: 1 };
    mine.forEach(r => { if (rowH[r.id]) r.h = Math.max(26, rowH[r.id]); });
    return [...mine, ...rest, voice, ...snd];
  };
  const _rn = renderNow;
  renderNow = function () {
    _rn(); if (!IS() || !TK) return;
    const rc = id => document.querySelector(`#tlin .row[data-row="${id}"] .rc`);
    const v = rc('tk:video'), a = rc('tk:voice'), c = rc('tk:caps');
    TK.blocks.forEach((b, i) => {
      const L = dur(b), tight = (b.zoom || 1) > 1.01;
      [[v, 'tkv' + (tight ? ' tight' : ''), 46], [a, 'tka', 38]].forEach(([row, cls, hh]) => {
        if (!row) return;
        const d = blk(cls, X(b._s), X(L), 3, (row.parentElement.offsetHeight || hh) - 6,
          `<i class="hl" title="Pull: start this piece earlier / later"></i><span class="lb">${row === v ? (tight ? '◉ ' : '') + (i + 1) : ''}</span><i class="hr" title="Pull: end this piece earlier / later"></i>`);
        d.title = `Block ${i + 1}: ${L.toFixed(2)} s (from ${b.in.toFixed(2)} to ${b.out.toFixed(2)} s of your take)${tight ? ' · zoomed in' : ''}\nclick = pick · drag an edge = longer / shorter · Delete = remove · Ctrl+B = split at the red line`;
        d.dataset.k = 'tb:' + b.id; d._o = b; d.classList.toggle('sel', TSEL.has(b));
        d.style.cssText += row === v ? `;background:${tight ? '#3c5f8f' : '#35506e'};border-color:#6f9bd1` : ';background:#2d5a46;border-color:#5fae8a';
        if (row === v && b.hide) d.style.cssText += ';background:repeating-linear-gradient(45deg,#1c2530 0 6px,#26313f 6px 12px);opacity:.7';
        if (row === a && b.mute) d.style.cssText += ';background:repeating-linear-gradient(45deg,#1d2b25 0 6px,#28392f 6px 12px);opacity:.7';
        if (row === v && b.hide) d.querySelector('.lb').textContent = '🙈 ' + (i + 1);
        if (row === a && b.mute) d.querySelector('.lb').textContent = '🔇';
        d.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); if (!TSEL.has(b)) { TSEL.clear(); TSEL.add(b); renderTL(); } blockMenu(e); };
        row.append(d); edgeDrag(d, b);
      });
    });
    if (c) (beats || []).forEach((g, j) => {
      const d = blk('tkc' + (CSEL === g.key ? ' sel' : ''), X(g.t0), X(g.dur), 3, (c.parentElement.offsetHeight || 30) - 6, `<span class="lb">${g.hide ? '🚫 ' : g.edited ? '✎ ' : ''}${esc(g.line)}</span>`);
      d.title = g.line + '\nclick = pick it (change words, colour, size, font) · double-click = change the words · Delete = hide it · right-click = more';
      d.style.cssText += `;background:${g.hide ? '#2c2733' : '#4b3d5e'};border-color:${g.hide ? '#5a4d6b' : '#8a72b0'}${g.hide ? ';opacity:.55;border-style:dashed' : ''}`; d.dataset.k = 'tc:' + j;
      d.onpointerdown = e => { if (e.button === 2) return; e.stopPropagation(); pickCap(g.key, true); };
      d.ondblclick = e => { e.stopPropagation(); pickCap(g.key, true); setTimeout(() => { const i = document.getElementById('capwords'); if (i) { i.focus(); i.select(); } }, 50); };
      d.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); pickCap(g.key, true); capMenu(e, g.key); };
      c.append(d);
    });
    rowButtons();
  };

  /* ---------- hide / mute buttons on the rows (L506: "i cant mute or hide videos and audios") ---------- */
  function rowButtons() {
    const S = TK.settings, C = S.caption;
    const put = (id, list) => {
      const rh = document.querySelector(`#tlin .row[data-row="${id}"] .rh`); if (!rh) return;
      const em = document.createElement('em'); em.className = 'tkrb';
      list.forEach(([icon, on, tip, fn]) => { const b = document.createElement('button'); b.textContent = icon; b.className = on ? 'off' : ''; b.title = tip; b.onclick = e => { e.stopPropagation(); fn(); }; b.onpointerdown = e => e.stopPropagation(); em.append(b); });
      const g = rh.querySelector('.grow'); g ? rh.insertBefore(em, g) : rh.append(em);
    };
    put('tk:video', [[S.hideVideo ? '🙈' : '👁', S.hideVideo, S.hideVideo ? 'Video is hidden (black, also in the video file): click to show' : 'Hide the video (black, also in the video file)', () => { S.hideVideo = !S.hideVideo; changed(); toast(S.hideVideo ? 'Video hidden' : 'Video shown'); }]]);
    put('tk:caps', [[C.on ? '👁' : '🙈', !C.on, C.on ? 'Hide all captions (also in the video file)' : 'Captions are hidden: click to show', () => { C.on = !C.on; changed(); toast(C.on ? 'Captions shown' : 'Captions hidden'); }]]);
    put('tk:voice', [[S.muteVoice ? '🔇' : '🔊', S.muteVoice, S.muteVoice ? 'Your voice is muted (also in the video file): click to hear it' : 'Mute your voice (also in the video file)', () => { S.muteVoice = !S.muteVoice; changed(); toast(S.muteVoice ? 'Voice muted' : 'Voice on'); }]]);
    // the added-sound rows: their M / S buttons now count in the video file too
    document.querySelectorAll('#tlin .row.a [data-ms=m]').forEach(b => b.title = 'Mute this row (also in the video file)');
    document.querySelectorAll('#tlin .row.a [data-ms=s]').forEach(b => b.title = 'Hear only this row (the video file then has only this row + your voice)');
  }

  /* ---------- picking one caption ---------- */
  function pickCap(key, seekTo) {
    CSEL = key || ''; TSEL.clear(); if (typeof SEL !== 'undefined') SEL.clear();
    const g = (beats || []).find(x => x.key === CSEL);
    if (g && seekTo) { play(false); if (t < g.t0 || t >= g.t0 + g.dur) seek(g.t0 + Math.min(0.5, g.dur / 2)); }
    try { cw().takeCapPicked(CSEL); } catch (e) {}
    tab = 'Take'; tabs(); draw(); renderTL();
  }
  window.takeCapPick = k => pickCap(k, false);   // click on a caption in the video picture
  const capOv = k => { TK.capEdits = TK.capEdits || {}; return TK.capEdits[k] = TK.capEdits[k] || {}; };
  function capSet(k, f, v, end) {
    const o = capOv(k); if (v === '' || v == null || v === false) delete o[f]; else o[f] = v;
    if (!Object.keys(o).length) delete TK.capEdits[k];
    end === false ? live2() : changed();
  }
  function capMenu(e, k) {
    const o = (TK.capEdits || {})[k] || {};
    menuAt(e.clientX, e.clientY, [
      ['✎  Change the words', () => { const i = document.getElementById('capwords'); if (i) { i.focus(); i.select(); } }],
      [o.hide ? '👁  Show this caption' : '🙈  Hide this caption (Delete)', () => capSet(k, 'hide', !o.hide)],
      ['↺  Back to the original', () => { if (TK.capEdits) delete TK.capEdits[k]; changed(); }],
      ['⧉  Use this caption\'s style on ALL captions', () => copyStyleToAll(k)],
    ]);
  }
  const STY = ['look', 'color', 'stress', 'size', 'font', 'y'];
  function copyStyleToAll(k) {
    const o = (TK.capEdits || {})[k] || {}, C = TK.settings.caption;
    STY.forEach(f => { if (o[f] != null) C[f] = o[f]; });
    Object.keys(TK.capEdits || {}).forEach(x => { STY.forEach(f => delete TK.capEdits[x][f]); if (!Object.keys(TK.capEdits[x]).length) delete TK.capEdits[x]; });
    changed(); toast('Every caption now has this style');
  }
  // a click on empty timeline un-picks the caption
  document.addEventListener('pointerdown', e => {
    if (!IS() || !CSEL || !e.target.closest) return;
    if (e.target.closest('.tkc') || e.target.closest('#pane') || e.target.closest('.menu') || e.target.closest('#stage') || e.target.closest('.tkrb')) return;
    if (e.target.closest('#tlin')) { CSEL = ''; try { cw().takeCapPicked(''); } catch (er) {} if (tab === 'Take') draw(); }
  }, true);

  /* drag a block's edge (CapCut): the sound edge moves with it; later blocks slide (no gaps) */
  function edgeDrag(d, b) {
    d.onpointerdown = e => {
      if (e.button === 2) { e.stopPropagation(); return; }   // right-click: the menu (oncontextmenu) picks it
      e.stopPropagation(); e.preventDefault();
      const side = e.target.classList.contains('hl') ? 'in' : e.target.classList.contains('hr') ? 'out' : null;
      if (!side) {   // a click picks it (Shift = add)
        if (!e.shiftKey) TSEL.clear(); selSnd = null; selAdd = null; TSEL.has(b) && e.shiftKey ? TSEL.delete(b) : TSEL.add(b); if (CSEL) { CSEL = ''; try { cw().takeCapPicked(''); } catch (er) {} }
        SEL.clear(); play(false); seek(b._s + 0.01); tab = 'Take'; tabs(); draw(); renderTL(); return;
      }
      const x0 = e.clientX, v0 = b[side], before = JSON.stringify(stripped(TK)); let moved = false;
      const mv = ev => {
        const dt = (ev.clientX - x0) / pps; moved = true;
        if (side === 'in') b.in = q(Math.min(Math.max(0, v0 + dt), b.out - 2 / FPS));
        else b.out = q(Math.max(Math.min(TK.info.dur, v0 + dt), b.in + 2 / FPS));
        recalc(); renderTL(); try { cw().takeSet(stripped(TK)); } catch (er) {}
        seek(side === 'in' ? b._s + 0.01 : b._s + dur(b) - 1 / FPS);
      };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
        if (moved) { UNDO.push(before); REDO = []; PREV = clone(stripped(TK)); changed({ noUndo: true }); toast(`Clip ${TK.blocks.indexOf(b) + 1}: ${dur(b).toFixed(2)} s`); } };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };
  }
  function blockMenu(e) {
    const P = TK.blocks.filter(x => TSEL.has(x)); if (!P.length) return; const n = P.length > 1 ? ` (${P.length} blocks)` : '';
    const allM = P.every(x => x.mute), allH = P.every(x => x.hide);
    menuAt(e.clientX, e.clientY, [
      [allM ? '🔊  Un-mute its sound' + n : '🔇  Mute its sound' + n, () => { P.forEach(x => x.mute = !allM); changed(); }],
      [allH ? '👁  Show its picture' + n : '🙈  Hide its picture (black)' + n, () => { P.forEach(x => x.hide = !allH); changed(); }],
      ['✂  Split at the red line (Ctrl+B)', splitAt], [],
      ['🗑  Remove' + n + ' (Delete)', delBlocks]]);
  }
  function splitAt() {
    const i = TK.blocks.findIndex(b => t >= b._s && t < b._s + dur(b)); if (i < 0) return;
    const b = TK.blocks[i], cut = q(b.in + (t - b._s) * (b.speed || 1)); if (cut - b.in < 2 / FPS || b.out - cut < 2 / FPS) return toast('Too close to the edge to split');
    const nb = Object.assign(clone(stripped({ blocks: [b] }).blocks[0]), { id: 'b' + Date.now().toString(36), in: cut });
    b.out = cut; TK.blocks.splice(i + 1, 0, nb); changed(); toast('Split into two blocks');
  }
  function delBlocks() {
    if (!TSEL.size) return false; if (TSEL.size >= TK.blocks.length) { toast('Keep at least one block'); return true; }
    TK.blocks = TK.blocks.filter(b => !TSEL.has(b)); const n = TSEL.size; TSEL.clear(); changed(); toast(`Removed ${n} block${n > 1 ? 's' : ''} (Ctrl+Z brings ${n > 1 ? 'them' : 'it'} back)`); return true;
  }
  addEventListener('keydown', e => {
    if (!IS() || !TK || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const c = e.ctrlKey || e.metaKey;
    if ((e.key === 'Delete' || e.key === 'Backspace') && TSEL.size) { e.preventDefault(); e.stopImmediatePropagation(); delBlocks(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && CSEL) { e.preventDefault(); e.stopImmediatePropagation(); capSet(CSEL, 'hide', true); toast('Caption hidden (Ctrl+Z brings it back)'); }
    else if (e.key === 'Escape' && CSEL) { pickCap('', false); }
    else if (c && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); e.stopImmediatePropagation(); splitAt(); }
  }, true);

  /* ---------- side panel ---------- */
  const LOOKS0 = [['gw-signal', 'GauthamWho · Signal Blue (Word build)'], ['gw-paper', 'GauthamWho · Grey Paper (Word build)'], ['gw-mono', 'GauthamWho · Blue on Black (Word build)'], ['bp', 'Blueprint (word by word, red underline)'], ['sky', 'SKY Kit (blur-in, 1-3 words)']];
  const lookName = c => (LOOKS0.find(l => l[0] === c.look) || ['', c.look])[1].split(' (')[0] + (c.on ? '' : ' · off');
  const FONTS = ['', 'Inter', 'Inter Tight', 'Montserrat', 'Poppins', 'Anton', 'Bebas Neue', 'DM Serif Display', 'Instrument Serif', 'Caveat'];
  const _tabs = tabs;
  tabs = function () {
    if (!IS()) return _tabs();
    const T = document.getElementById('tabs'); T.innerHTML = '';
    if (!['Take', 'Add', 'Sounds', 'Video', 'TakeCaps'].includes(tab)) tab = 'Take';
    ['Take', 'Add', 'Sounds', 'Video'].forEach(n => { const b = document.createElement('button'); b.textContent = n; b.className = n === tab ? 'on' : ''; b.onclick = () => { tab = n; tabs(); draw(); }; T.append(b); });
  };
  const _draw = draw;
  /* chat 8 layout: the old Take tab is split in parts. Right panel 'Take' = the picked clip / caption, or the project when
     nothing is picked; left Captions tool = 'TakeCaps' (all captions). layout_ui.js puts them in place. */
  const H = {};
  H.row = (lab, el) => { const f = document.createElement('div'); f.className = 'field'; f.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0'; const l = document.createElement('label'); l.textContent = lab; l.style.minWidth = '92px'; f.append(l, el); return f; };
  H.sw = (on, fn, a = 'On', b = 'Off') => { const w = document.createElement('span'); w.className = 'seg'; [[true, a], [false, b]].forEach(([v, n]) => { const x = btn(n, () => fn(v)); x.className = on === v ? 'on pri' : ''; w.append(x); }); return w; };
  H.slider = (v, mn, mx, st, fn) => { const r = document.createElement('input'); r.type = 'range'; r.min = mn; r.max = mx; r.step = st; r.value = v; r.style.flex = '1'; r.oninput = () => fn(+r.value, false); r.onchange = () => fn(+r.value, true); return r; };
  H.col = (v, def, fn) => { const w = document.createElement('span'); const i = document.createElement('input'); i.type = 'color'; i.value = v || def; i.oninput = () => fn(i.value, false); i.onchange = () => fn(i.value, true); const r = btn('↺', () => fn('', true)); r.title = 'Back to the look\'s colour'; w.append(i, r); return w; };
  const pane = () => { const p = document.getElementById('pane'); p.innerHTML = ''; return p; };
  function capBox(p) {   // L506: pick one caption and change it
    const S = TK.settings, { row, sw, slider, col } = H;
    const g = CSEL && (beats || []).find(x => x.key === CSEL); if (!g) return false;
    const k = CSEL, o = (TK.capEdits || {})[k] || {}, C0 = S.caption, look = o.look || C0.look;
    const box = document.createElement('div'); box.id = 'capbox';
    box.append(h3('Picked caption'));
    const ti = document.createElement('input'); ti.id = 'capwords'; ti.value = o.text || g.line; ti.style.cssText = 'flex:1;padding:6px;font:600 14px system-ui';
    ti.onchange = () => { const v = ti.value.trim(); capSet(k, 'text', v === g.line && !o.text ? '' : v); };
    ti.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') ti.blur(); };
    box.append(row('Words', ti));
    box.append(row('Show', sw(!o.hide, v => capSet(k, 'hide', !v), 'Shown', 'Hidden')));
    const ls = document.createElement('select'); ls.style.flex = '1'; ls.innerHTML = `<option value="">Same as all captions</option>` + LOOKS0.map(([v, n]) => `<option value="${v}" ${o.look === v ? 'selected' : ''}>${n}</option>`).join(''); ls.onchange = () => capSet(k, 'look', ls.value);
    box.append(row('Look', ls));
    box.append(row('Words colour', col(o.color || C0.color, look === 'gw-paper' ? '#0b0b0c' : '#ffffff', (v, end) => capSet(k, 'color', v, end))));
    box.append(row('Big word colour', col(o.stress || C0.stress, look === 'bp' ? '#f3e6cf' : look === 'sky' ? '#3b9cf6' : '#ffd400', (v, end) => capSet(k, 'stress', v, end))));
    box.append(row('Size', slider(o.size ?? C0.size ?? 1, 0.5, 2.2, 0.05, (v, end) => capSet(k, 'size', v, end))));
    box.append(row('Height', slider(o.y ?? C0.y ?? (S.aspect === '16:9' ? 0.8 : 0.703), 0.1, 0.95, 0.005, (v, end) => capSet(k, 'y', v, end))));
    const fs1 = document.createElement('select'); fs1.style.flex = '1'; fs1.innerHTML = `<option value="">Same as all captions</option>` + FONTS.filter(Boolean).map(f => `<option value="${f}" ${o.font === f ? 'selected' : ''}>${f}</option>`).join(''); fs1.onchange = () => capSet(k, 'font', fs1.value);
    box.append(row('Font', fs1));
    box.append(btn('↺ Back to the original', () => { if (TK.capEdits) delete TK.capEdits[k]; changed(); }));
    box.append(btn('⧉ Use this style on ALL captions', () => copyStyleToAll(k)));
    box.append(para('Only this caption changes. Delete key = hide it. Esc = un-pick. All of it goes into the video file too.'));
    p.append(box); return true;
  }
  function capsSection(p) {   // left tool: Captions (all captions)
    const S = TK.settings, C = S.caption, { row, sw, slider, col } = H;
    p.append(h3('All captions'));
    if (!TK.words || !TK.words.length) {
      p.append(para(jobMsg ? '⏳ ' + jobMsg : 'No caption words yet. GEditor listens to your voice and writes them (about 5-10 min; keep editing meanwhile).'));
      if (!jobMsg) { const b = btn('🎙 Make captions from my voice', async () => { const r = await post('/api/take/words'); if (r.error) return toast(r.error); toast('Listening to your words…'); watchJob(false); }); b.className = 'pri'; p.append(b); }
    }
    p.append(para('To change just one caption: click it on the timeline or on the video.'));
    p.append(row('Captions', sw(!!C.on, v => { C.on = v; changed(); })));
    const sel = document.createElement('select'); sel.style.flex = '1';
    sel.innerHTML = LOOKS0.map(([k, n]) => `<option value="${k}" ${C.look === k && !C.saved ? 'selected' : ''}>${n}</option>`).join('') + LOOKS.map((l, i) => `<option value="my:${i}" ${C.saved === l.name ? 'selected' : ''}>★ ${esc(l.name)}</option>`).join('');
    sel.onchange = () => { const v = sel.value; if (v.startsWith('my:')) { const l = LOOKS[+v.slice(3)]; S.caption = Object.assign(clone(l.caption), { on: true, saved: l.name }); } else Object.assign(C, { look: v, color: '', stress: '', font: '', saved: '' }); changed(); };
    p.append(row('Look', sel));
    p.append(row('Words colour', col(C.color, C.look === 'gw-paper' ? '#0b0b0c' : '#ffffff', (v, end) => { C.color = v; end ? changed() : live2(); })));
    p.append(row('Big word colour', col(C.stress, C.look === 'bp' ? '#f3e6cf' : C.look === 'sky' ? '#3b9cf6' : '#ffd400', (v, end) => { C.stress = v; end ? changed() : live2(); })));
    p.append(row('Size', slider(C.size || 1, 0.5, 1.8, 0.05, (v, end) => { C.size = v; end ? changed() : live2(); })));
    p.append(row('Height', slider(C.y ?? (S.aspect === '16:9' ? 0.8 : 0.703), 0.15, 0.92, 0.005, (v, end) => { C.y = v; end ? changed() : live2(); })));
    const fs = document.createElement('select'); fs.style.flex = '1'; fs.innerHTML = FONTS.map(f => `<option value="${f}" ${C.font === f ? 'selected' : ''}>${f || 'The look\'s own font'}</option>`).join(''); fs.onchange = () => { C.font = fs.value; changed(); };
    p.append(row('Font', fs));
    p.append(btn('★ Save this as my caption look', async () => { const n = (prompt('Name for this caption look:') || '').trim(); if (!n) return; LOOKS = LOOKS.filter(l => l.name !== n); LOOKS.push({ name: n, caption: Object.assign(clone(C), { saved: '' }) }); await post('/api/take/looks', LOOKS); C.saved = n; changed(); toast('Saved: ' + n + ' (in the Look menu of every take)'); }));
  }
  function clipSection(p, picked) {   // right panel, a clip is picked (more tabs: layout_ui.js / tools_ui.js)
    const { row, sw, slider } = H, b = picked[0], i = TK.blocks.indexOf(b);
    p.append(h3(picked.length > 1 ? `${picked.length} clips picked` : `Clip ${i + 1}`));
    if (picked.length === 1) p.append(para(`${dur(b).toFixed(2)} s${b.speed ? ' (' + b.speed + '×)' : ''} · from ${b.in.toFixed(2)} to ${b.out.toFixed(2)} s of your video`));
    // zoom on THIS clip only (chat 9, L533): works even when the project's auto zooms are off (set by hand = always shown)
    const off = TK.settings.zooms === false && b.zoomBy !== 'hand';
    p.append(h3('Zoom on this clip'));
    if (off) p.append(para('Auto zooms are off for this project, so this clip shows wide. Any zoom you set here stays on, just for this clip.'));
    const effZ = c => { const o = TK.settings.zooms === false && c.zoomBy !== 'hand', a = o ? 1 : +(c.zoom || 1); return [a, o ? 1 : (c.zoomTo == null ? a : +c.zoomTo)]; };
    const hand = (fn) => { picked.forEach(x => { if (x.zoomBy !== 'hand' && !x.autoZ) x.autoZ = { zoom: x.zoom, zoomTo: x.zoomTo, ease: x.ease };
      const [a, e] = effZ(x); x.zoom = a; if (Math.abs(e - a) > 1e-4) x.zoomTo = e; else delete x.zoomTo; x.zoomBy = 'hand'; fn(x); }); };
    const z0 = off ? 1 : +(b.zoom || 1), z1 = off ? 1 : (b.zoomTo == null ? z0 : +b.zoomTo);
    const mv = Math.abs(z1 - z0) < 0.005 ? 'hold' : z1 > z0 ? 'in' : 'out';
    const zr = document.createElement('div'); zr.className = 'btnrow';
    [['hold', '■ Still', 'The same zoom the whole clip'], ['in', '↗ Zoom in', 'Starts wider, slowly moves closer to your face during the clip'], ['out', '↙ Zoom out', 'Starts close, slowly moves back during the clip']].forEach(([k, n, tip]) => {
      const x = btn(n, () => { hand(c => { const a = Math.max(1, Math.min(+(c.zoom || 1), +(c.zoomTo ?? c.zoom ?? 1))), big = Math.max(a + 0.15, +(c.zoom || 1), +(c.zoomTo ?? 0));
        if (k === 'hold') { delete c.zoomTo; delete c.ease; }
        else if (k === 'in') { c.zoom = a; c.zoomTo = Math.min(1.8, big); c.ease = 0; }
        else { c.zoom = Math.min(1.8, big); c.zoomTo = a; c.ease = 0; } }); changed(); });
      x.title = tip; if (k === mv) x.className = 'on pri'; zr.append(x); });
    p.append(zr);
    p.append(row(mv === 'hold' ? 'Zoom' : 'Start zoom', slider(z0, 1, 1.8, 0.01, (v, end) => { hand(x => { if (mv === 'hold') delete x.zoomTo; x.zoom = v; }); end ? changed() : live2(); })));
    if (mv !== 'hold') {
      p.append(row('End zoom', slider(z1, 1, 1.8, 0.01, (v, end) => { hand(x => { x.zoomTo = v; x.ease = 0; }); end ? changed() : live2(); })));
    }
    p.append(para('<span class="hint">1 = wide, 1.25 = a punch-in, 1.8 = very close. Zoom in / out moves slowly over the whole clip.</span>'));
    if (picked.some(x => x.zoomBy === 'hand')) p.append(btn('↺ Back to the Auto Edit zoom', () => { picked.forEach(x => { delete x.zoomBy; if (x.autoZ) { ['zoom', 'zoomTo', 'ease'].forEach(k => x.autoZ[k] == null ? delete x[k] : x[k] = x.autoZ[k]); delete x.autoZ; } }); changed(); }));
    coClip(p, picked);
    p.append(h3('This clip'));
    p.append(row('Its picture', sw(!picked.every(x => x.hide), v => { picked.forEach(x => x.hide = !v); changed(); }, '👁 Shown', '🙈 Hidden')));
    const w = document.createElement('div'); w.className = 'btnrow';
    w.append(btn('✂ Split at the red line (B)', splitAt), btn('🗑 Remove (Delete)', delBlocks));
    const ae = btn('✨ Auto Edit this clip', () => autoClip(b)); ae.title = 'Your auto.py cuts the pauses and adds zooms inside this clip only (L519)'; if (picked.length > 1) ae.disabled = true;
    w.append(ae); p.append(w);
  }
  function setPauses(cut) {   // Pauses: Cut <-> Kept (chat 9). Kept: each clip starts where the one before ended (in its own video time); cutIn / cutOut remember the cut
    const S = TK.settings, B = TK.blocks;
    if (!cut) {
      let prev = 0;
      B.forEach((b, i) => { const nb = B[i + 1]; if (b.cutIn == null) b.cutIn = b.in; if (b.cutOut == null) b.cutOut = b.out;
        if (b.in > prev && b.in - prev < 30) b.in = q(prev);   // never pulls in more than 30 s (a clip he moved far away stays as it is)
        if (!nb) b.out = Math.max(b.out, q(TK.info.dur - 0.5 / 30));
        prev = b.out; });
    } else B.forEach(b => { if (b.cutIn != null) b.in = Math.max(b.in, b.cutIn); if (b.cutOut != null) b.out = Math.min(b.out, b.cutOut); if (b.out - b.in < 2 / 30) b.out = q(b.in + 2 / 30); delete b.cutIn; delete b.cutOut; });   // max / min: a clip he split in two keeps its split point
    S.pauses = cut ? 'cut' : 'kept'; changed(); toast(cut ? 'Pauses cut again' : 'Pauses kept: nothing is cut out now', 3000);
  }
  /* ---------- Cut me out (chat 9, L534 / L536): him + what he holds, away from the background, on this PC ---------- */
  let CO = { ranges: [] }, COJ = null, COT = null, COWAS = '', COENG = (() => { try { return localStorage.getItem('ge_coeng') || 'fast'; } catch (e) { return 'fast'; } })();
  const cover = b => { let got = 0; (CO.ranges || []).forEach(([a, z]) => { got += Math.max(0, Math.min(z, b.out) - Math.max(a, b.in)); }); return got / Math.max(1e-3, b.out - b.in); };
  async function coLoad() { try { CO = (await api('/api/cutout/info')) || { ranges: [] }; } catch (e) {} }
  async function coRun(ranges) {
    const r = await post('/api/cutout/run', { ranges, engine: COENG }); if (r.error) return toast(r.error, 6000);
    toast('Cutting you out… you can keep editing meanwhile', 4000); COWAS = 'running'; coWatch();
  }
  async function coWatch() {
    clearTimeout(COT); const j = await api('/api/cutout/job'); COJ = j;
    if (j.state === 'running') { COWAS = 'running'; COT = setTimeout(coWatch, 2000); if (tab === 'Take') draw(); return; }
    if (j.state === 'done' && COWAS === 'running') { await coLoad(); try { await cw().takeMaskReload(); } catch (e) {} toast('Cut-out ready. Now switch Background to Hidden on those clips.', 6000); }
    COWAS = j.state; renderTL(); if (tab === 'Take') draw();
  }
  function coEngine(p) {
    const w = document.createElement('div'); w.className = 'btnrow';
    [['fast', '⚡ Fast', 'Quick. Edges a little soft around hair. Good for most reels.'], ['best', '💎 Best', 'Cleaner hair and fingers. Several times slower on this PC.']].forEach(([k, n, tip]) => {
      const x = btn(n, () => { COENG = k; try { localStorage.setItem('ge_coeng', k); } catch (e) {} draw(); }); x.title = tip; if (COENG === k) x.className = 'on pri'; w.append(x); });
    p.append(w); p.append(para('<span class="hint">' + (COENG === 'best' ? 'Best: cleaner hair and fingers, several times slower.' : 'Fast: quick, edges a little soft around hair.') + ' Anything in your hand (mug, phone, pen) stays with you.</span>'));
  }
  function coBusy(p) {
    if (!COJ || COJ.state !== 'running') { if (COJ && (COJ.state === 'error' || COJ.state === 'stopped')) p.append(para('⚠ ' + esc(COJ.msg))); return false; }
    p.append(para(`⏳ ${COJ.pct}% · ${esc(COJ.msg)}`)); p.append(btn('■ Stop the cut-out', async () => { await post('/api/cutout/stop'); toast('Stopping… frames already done are kept'); })); return true;
  }
  function coClip(p, picked) {
    const { row, sw } = H;
    p.append(h3('Cut me out'));
    const cv = Math.min(...picked.map(cover));
    p.append(para(cv > 0.98 ? '✅ Cut out: you are separated from the background in ' + (picked.length > 1 ? 'these clips' : 'this clip') + '.' :
      cv > 0.02 ? `Partly cut out (${Math.round(cv * 100)}%). Press the button to finish it.` :
      'Separates you (and whatever you hold) from the background, on this PC. Then you can hide the background, put things behind you in your kits, or export yourself alone.'));
    if (!coBusy(p)) {
      coEngine(p);
      const secs = picked.reduce((a, b) => a + b.out - b.in, 0);
      const go = btn(cv > 0.98 ? '↻ Cut out again (' + (COENG === 'best' ? 'Best' : 'Fast') + ')' : `✂ Cut me out (${picked.length > 1 ? picked.length + ' clips' : 'this clip'})`, () => coRun(picked.map(b => [b.in, b.out])));
      if (cv <= 0.98) go.className = 'pri';
      go.title = 'Only this part of your video is processed. To do a smaller part: split the clip first (B).'; p.append(go);
      p.append(para(`<span class="hint">${secs.toFixed(1)} s of video · about ${Math.max(1, Math.round(secs * (COENG === 'best' ? 2.5 : 0.8)))} min on this PC</span>`));
    }
    const bg = sw(!picked.every(x => x.bg === 'hide'), v => { picked.forEach(x => { if (v) delete x.bg; else x.bg = 'hide'; }); changed(); }, 'Shown', 'Hidden');
    if (cv <= 0.98) bg.querySelectorAll('button').forEach(x => { x.disabled = true; x.title = 'Cut yourself out first (button above)'; });
    p.append(row('Background', bg));
    p.append(para('<span class="hint">Hidden = only you are left. Its colour: click an empty spot (nothing picked) → Cut me out.</span>'));
  }
  function coProject(p) {
    const { row, sw } = H;
    const S = TK.settings; p.append(h3('Cut me out'));
    const tot = TK.blocks.reduce((a, b) => a + (b.out - b.in), 0), got = TK.blocks.reduce((a, b) => a + cover(b) * (b.out - b.in), 0), fr = got / Math.max(tot, 1e-3);
    p.append(para(fr > 0.98 ? '✅ The whole video is cut out.' : `Cut out so far: ${Math.round(100 * fr)}% of your clips. To do one clip: click it, then Cut me out.`));
    if (!coBusy(p) && fr <= 0.98) { coEngine(p); const go = btn('✂ Cut me out: every clip', () => coRun(TK.blocks.map(b => [b.in, b.out]))); go.className = 'pri'; p.append(go);
      p.append(para(`<span class="hint">${tot.toFixed(0)} s of video · about ${Math.max(1, Math.round(tot * (COENG === 'best' ? 2.5 : 0.8)))} min on this PC. You can keep editing; Stop keeps what is done.</span>`)); }
    const hid = TK.blocks.filter(b => b.bg === 'hide').length;
    if (got > 0) p.append(row('All backgrounds', sw(hid === 0, v => { TK.blocks.forEach(b => { if (v) delete b.bg; else if (cover(b) > 0.98) b.bg = 'hide'; }); changed(); }, 'Shown', 'Hidden')));
    const sel = document.createElement('select'); sel.style.flex = '1';
    sel.innerHTML = [['clear', 'See-through (no background)'], ['#000000', 'Black'], ['#00ff00', 'Green screen'], ['#ffffff', 'White'], ['#f3e6cf', 'Cream']].map(([v, n]) => `<option value="${v}" ${(S.bgColor || 'clear') === v ? 'selected' : ''}>${n}</option>`).join('');
    sel.onchange = () => { S.bgColor = sel.value; changed(); }; p.append(row('Hidden background', sel));
    p.append(para('<span class="hint">See-through shows as a grey check here. A normal MP4 cannot be see-through, so there it turns black; the "Without background" export (Export window) gives real see-through files.</span>'));
  }
  window.GE_CO = { load: coLoad, watch: coWatch, cover, get info() { return CO; } };
  async function autoClip(b) {
    if (!confirm('Auto Edit this clip? Its pauses are cut and zooms added, inside this clip only. To keep the old clip too, press "Make a copy" on the Projects page first.')) return;
    const r = await post('/api/take/new', { path: TK.src, redo: true, clip: b.id }); if (r.error) return toast(r.error, 6000);
    toast('Auto Edit is working on this clip (about 2-4 min)…', 5000); watchJob(true);
  }
  function projectSection(p) {   // right panel, nothing picked
    const S = TK.settings, { row, sw, slider } = H;
    p.append(h3('Project'));
    const kept = TK.blocks.reduce((a, b) => a + dur(b), 0);
    p.append(para(`<b>${esc(TK.name)}</b> · ${TK.info.w}×${TK.info.h} · ${TK.info.hdr ? 'HDR (iPhone light kept)' : 'normal colour (SDR)'}<br>${TK.blocks.length} clips · ${kept.toFixed(1)} s kept of ${TK.info.dur.toFixed(1)} s`));
    p.append(row('Shape', sw(S.aspect === '9:16', v => { S.aspect = v ? '9:16' : '16:9'; changed(); setTimeout(sizeFrame, 60); }, '9:16 tall', '16:9 wide')));
    p.append(h3('Eye-Lock'));
    p.append(para('On = your eyes stay at the same spot on the screen the whole video, even when you move.' + (TK.noEyes ? ' Needs Auto Edit first (it finds your eyes): pick a clip and press ✨ Auto Edit this clip.' : '')));
    const el = sw(!!S.eyelock, v => { S.eyelock = v; changed(); }); if (TK.noEyes) el.querySelectorAll('button').forEach(x => x.disabled = true);
    p.append(row('Eye-Lock', el));
    if (S.eyelock) {
      let ay = 0.36; try { ay = cw().takeAutoY(); } catch (e) {}
      p.append(row('Eyes height', slider(S.lockY ?? ay, 0.2, 0.6, 0.01, (v, end) => { S.lockY = v; end ? changed() : live2(); })));
      if (S.lockY != null) p.append(btn('Eyes height: back to auto', () => { S.lockY = null; changed(); }));
      p.append(row('Room to move', slider(S.lockZoom ?? 1.12, 1, 1.5, 0.01, (v, end) => { S.lockZoom = v; end ? changed() : live2(); })));
    }
    coProject(p);
    p.append(h3('Safe-zone layer'));
    p.append(para('Shows where Instagram puts its buttons and text. Only in the editor, never in the video file.'));
    p.append(row('Safe zone', sw(!!S.safe, v => { S.safe = v; changed(); })));
    p.append(h3('Auto Edit switches'));
    p.append(para('Each part of Auto Edit on its own. Switching one off never deletes anything: switch it on again and it comes back.'));
    p.append(row('Auto zooms', sw(S.zooms !== false, v => { S.zooms = v; changed(); }, 'On', 'Off')));
    p.append(para('<span class="hint">Off = every clip wide. A zoom you set by hand on one clip stays (pick the clip, then Zoom on this clip).</span>'));
    const canPause = TK.blocks.some(x => x.cutIn != null || x.cutOut != null) || TK.auto;
    const ps = sw(S.pauses !== 'kept', v => { setPauses(v); }, 'Cut', 'Kept');
    if (!canPause) ps.querySelectorAll('button').forEach(x => x.disabled = true);
    p.append(row('Pauses', ps));
    p.append(para('<span class="hint">Kept = the silent gaps come back, each clip runs on to the next. Cut = gaps out again.</span>'));
    p.append(para('<span class="hint">Captions on/off: Captions tab. Eye-Lock: above.</span>'));
    p.append(h3('Auto Edit again'));
    const AO = Object.assign({ cuts: true, zooms: true, stammers: false, captions: true, eyelock: false }, TK.autoOpts || {}, { zooms: S.zooms !== false, cuts: S.pauses !== 'kept', eyelock: !!S.eyelock, captions: !!(S.caption || {}).on });
    const tk2 = (k, lab, tip) => { const l = document.createElement('label'); l.className = 'tickrow'; l.innerHTML = `<input type="checkbox" ${AO[k] ? 'checked' : ''}> <b>${lab}</b> <span class="hint">${tip}</span>`; l.querySelector('input').onchange = e => AO[k] = e.target.checked; p.append(l); };
    tk2('cuts', 'Cut the pauses', ''); tk2('zooms', 'Zoom in and out', ''); tk2('stammers', 'Cut repeated words', '(+5-10 min)'); tk2('captions', 'Captions', '');
    p.append(btn(TK.auto ? '✨ Auto Edit the whole video again' : '✨ Auto Edit the whole video', async () => { if (!confirm('Make fresh cuts and zooms for the whole video with these ticks? Your clip changes are replaced (captions and other settings stay). Ctrl+Z will not bring them back, so press "Make a copy" on the Projects page first if you want to keep them.')) return; const r = await post('/api/take/new', { path: TK.src, redo: true, opts: AO }); if (r.error) return toast(r.error); watchJob(true); }));
    p.append(h3('Project file'));
    p.append(para(`Saved by itself after every change.<br><span style="user-select:all">Common\\tools\\reel_editor\\projects\\take\\${esc(TK.name)}\\take.json</span>`));
    p.append(btn('Save now (Ctrl+S)', async () => { await post('/api/take/save', { take: stripped(TK) }); toast('Project saved'); }));
  }
  draw = function () {
    if (!IS()) return _draw();
    if (tab === 'Video') return videoPanel();
    if (tab === 'TakeCaps') { const p = pane(); if (TK && TK.blocks) capsSection(p); return; }
    if (tab !== 'Take') return _draw();
    const p = pane();
    if (!TK || !TK.blocks) { p.append(para(jobMsg || 'Preparing your video…')); return; }
    if (jobMsg) p.append(para('⏳ ' + jobMsg));
    if (capBox(p)) return;
    const picked = TK.blocks.filter(b => TSEL.has(b));
    if (picked.length) {
      if (window.GE && GE.clipPanel) return GE.clipPanel(p, picked, () => clipSection(p, picked));
      return clipSection(p, picked);
    }
    projectSection(p);
  };
  window.TAKE = { get TK() { return TK; }, set TK(v) { TK = v; }, get TSEL() { return TSEL; }, get CSEL() { return CSEL; }, H, changed, live2: () => live2(), dur, splitAt, delBlocks, recalc, sizeFrame, stripped, q, pickCap, autoClip, watchJob: x => watchJob(x), get jobMsg() { return jobMsg; } };
  let lv = null; function live2() { clearTimeout(lv); lv = setTimeout(() => { try { cw().takeSet(stripped(TK)); } catch (e) {} }, 16); }

  /* ---------- export ---------- */
  const SIZES = { '9:16': [[1080, 1920, 'Full HD 1080×1920'], [720, 1280, 'Small 720×1280'], [1440, 2560, '2K 1440×2560'], [2160, 3840, '4K 2160×3840']], '16:9': [[1920, 1080, 'Full HD 1920×1080'], [1280, 720, 'Small 1280×720'], [2560, 1440, '2K 2560×1440'], [3840, 2160, '4K 3840×2160']] };
  let EXO = { size: null, fps: 30, range: null };
  function videoPanel() {
    const p = document.getElementById('pane'); p.innerHTML = ''; if (!TK) return;
    const S = SIZES[TK.settings.aspect]; if (!EXO.size || !S.some(s => s[0] === EXO.size[0] && s[1] === EXO.size[1]) && !EXO.custom) EXO.size = S[0].slice(0, 2);
    EXO.range = EXO.range || (TK.info.hdr ? 'HDR' : 'SDR');
    p.append(h3('Make the video file'));
    p.append(para('Made straight from your original take (full quality), with your cuts, zooms, Eye-Lock and captions. The safe-zone layer is never in the file.'));
    const pick = (lab, opts, cur, fn) => { const f = document.createElement('div'); f.style.margin = '8px 0'; f.innerHTML = `<div style="color:#bbb;margin-bottom:4px">${lab}</div>`; opts.forEach(([v, n, dis, tip]) => { const b = btn(n, () => { fn(v); if (window.GE && GE.openExport) GE.openExport(); else videoPanel(); }); b.className = JSON.stringify(v) === JSON.stringify(cur) ? 'on pri' : ''; if (dis) { b.disabled = true; b.title = tip || ''; } f.append(b); }); p.append(f); };
    pick('Size', [...S.map(s => [s.slice(0, 2), s[2]]), ['custom', 'Custom…']], EXO.custom ? 'custom' : EXO.size, v => {
      if (v === 'custom') { const a = (prompt('Width x height in pixels, e.g. 1080x1350', EXO.size.join('x')) || '').match(/(\d+)\s*[x×*]\s*(\d+)/); if (!a) return; EXO.size = [+a[1], +a[2]]; EXO.custom = true; } else { EXO.size = v; EXO.custom = false; } });
    if (EXO.custom) p.append(para(`Custom: ${EXO.size[0]}×${EXO.size[1]}`));
    pick('Frames per second', [24, 25, 30, 50, 60].map(f => [f, f + ' fps']), EXO.fps, v => EXO.fps = v);
    pick('Colour', [['SDR', 'SDR (posts everywhere)'], ['HDR', 'HDR (iPhone light)', !TK.info.hdr, 'This take was filmed in normal colour, so HDR is not possible']], EXO.range, v => EXO.range = v);
    p.append(para(EXO.range === 'HDR' ? 'HDR keeps the light and colour exactly as your iPhone filmed it (Dolby Vision).' : TK.info.hdr ? 'SDR is made from the HDR with your clip\'s own Dolby Vision mapping, so the iPhone light stays (not the dim grey tonemap).' : 'Normal colour, as filmed.'));
    const go = (s, mode) => takeExport(s, mode);
    const b1 = btn('Make the video file', () => go(0)); b1.className = 'pri'; const b2 = btn('Test video (8 s)', () => go(8)); p.append(b1, b2);
    p.append(h3('Me without background'));
    p.append(para('Needs Cut me out first. Makes ONE folder: you alone on green (any app with green screen), you see-through (MOV for CapCut desktop / Premiere / DaVinci, WEBM for web + kits), the black-and-white mask, the clean edit with background, your words and a note for Claude. Tell Claude "use this GEditor folder" and your kits skip the cutting and the cut-out. No captions in these files.'));
    const b3 = btn('📦 Make the folder', () => go(0, 'folder')); const b4 = btn('Test folder (8 s)', () => go(8, 'folder'));
    if (!(window.GE_CO && GE_CO.info && (GE_CO.info.ranges || []).length)) [b3, b4].forEach(x => { x.disabled = true; x.title = 'Cut yourself out first: pick a clip, then Cut me out'; });
    p.append(b3, b4);
    const bar = document.createElement('div'); bar.id = 'bar'; bar.innerHTML = '<i></i>'; p.append(bar);
    const m = document.createElement('div'); m.id = 'em'; m.className = 'hint'; p.append(m);
  }
  async function takeExport(seconds, mode) {
    if (!IS()) return; tab = 'Video'; tabs(); draw(); play(false);
    await post('/api/take/save', { take: stripped(TK) });
    const body = { name: 'edit' + (seconds ? '_test' : ''), mode: mode || '', seconds, take: stripped(TK), size: EXO.size, fps: EXO.fps, range: EXO.range, sounds: sounds.filter(s => { if (s.kit || s.mute) return false; const solo = Object.keys(rowState).filter(k => rowState[k].s), rk = 'snd:' + roleOf(s); return !((rowState[rk] || {}).m || (solo.length && !solo.includes(rk))); }) };
    const r = await fetch('/api/export', { method: 'POST', body: JSON.stringify(body) }); if (r.status === 409) return toast('A video is already being made');
    const poll = async () => {
      const s = await api('/api/export'), bar = document.querySelector('#bar i'), em = document.getElementById('em');
      if (bar) bar.style.width = s.pct + '%'; if (em) em.innerHTML = s.state === 'done' ? '<b>Done.</b> ' + esc(s.msg) + '<br><span style="user-select:all">' + esc(s.folder || s.mp4) + '</span>' : s.state === 'error' ? 'Stopped: ' + esc(s.msg) : s.pct + '% · ' + esc(s.msg);
      if (s.state === 'running') setTimeout(poll, 1500); else if (s.state === 'done') toast('Video is ready', 4000);
    };
    setTimeout(poll, 400);
  }
  const _play = play; play = function (on) { _play(on); if (IS()) try { cw().takePlaying(on); } catch (e) {} };
  const _mv = makeVideo; makeVideo = function (s) { if (IS()) return takeExport(s); return _mv(s); };

  /* ---------- the preparing job (proxy, Auto Edit, words) ---------- */
  let jobMsg = '';
  async function watchJob(reloadWhenBlocks) {
    const j = await api('/api/take/job');
    if (j.state === 'running') {
      jobMsg = `${j.pct}% · ${j.msg}`;
      if (!TK || !TK.blocks) { const tk = await api('/api/take/info'); if (tk && tk.blocks) { location.reload(); return; } }
      renderTL(); if (tab === 'Take') draw(); JOBT = setTimeout(() => watchJob(reloadWhenBlocks), 2500); return;
    }
    const had = jobMsg; jobMsg = j.state === 'error' ? 'Stopped: ' + j.msg : '';
    if (had && j.state === 'done') { const tk = await api('/api/take/info'); if (tk && JSON.stringify(tk.words) !== JSON.stringify(TK && TK.words)) { if (reloadWhenBlocks) return location.reload(); TK.words = tk.words; changed({ noUndo: true }); toast('Captions are ready'); } }
    renderTL(); if (tab === 'Take') draw();
  }

  /* ---------- start ---------- */
  (async function boot() {
    for (let i = 0; i < 200 && !(M && M.name); i++) await new Promise(r => setTimeout(r, 50));
    setTimeout(async () => { if (!IS()) return; await coLoad(); const j = await api('/api/cutout/job'); if (j.state === 'running') coWatch(); }, 800);
    const u = new URLSearchParams(location.search);
    if (u.get('kit') === 'take' && u.get('reel') && (!M || M.type !== 'take' || document.title.indexOf(u.get('reel')) < 0)) {
      const st = await api('/api/state'); if (st.kit !== 'take' || st.reel !== u.get('reel')) { await post('/api/open', { kit: 'take', reel: u.get('reel') }); location.replace('/?kit=take&reel=' + encodeURIComponent(u.get('reel'))); return; }
    }
    if (!IS()) return;
    hb.textContent = '🎬 Another take';
    await loadTake(); PREV = TK && TK.blocks ? clone(stripped(TK)) : null; tab = 'Take'; tabs(); draw(); renderTL();
    pv.addEventListener('load', () => setTimeout(() => { sizeFrame(); try { beats = (cw().BEATS && cw().BEATS.beats) || []; } catch (e) {} renderTL(); }, 600));
    watchJob(!TK || !TK.blocks);
  })();
})();

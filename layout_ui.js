/* layout_ui.js: GEditor's new layout (Reel Editor LEDGER L513-L519, chat 8), shaped like Instagram Edits + CapCut,
   in GEditor's own colours (black, gold, red). Loaded after every other editor script; nothing old is removed, it moves:
   - top bar: ← Projects, project name, Brand, Look ▾, ⋯ More, Test 8 s, Export (a window with size / fps / SDR-HDR)
   - left tool list (rail) + its panel (lib): Media, Audio, Text, Captions, Voiceover, Effects, Transitions, Filters,
     Adjust, Sound FX, Kit, Notes. A tool is either drawn by its own render() or shows one of the old tabs (tab: 'Colours').
   - right panel = the picked thing (Picked / Animation / Audio / Added for kit reels; Clip|Caption|Project / Added / Audio
     for his own videos), NOTES dock under it as before.
   - tool bar above the timeline: select, hand, split, delete, copy, paste + the old buttons; new keys (B, V, H, Q, W,
     Ctrl+S, Ctrl+E, Alt+N, 1-9, ?).
   Other scripts add tools with GE.register({ id, order, icon, label, render(el) | tab, live }). */
(function () {
  if (typeof draw !== 'function') return;
  const root = document.documentElement;
  const IST = () => !!(M && M.type === 'take');
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem('ge_' + k); if (v === null) localStorage.removeItem('ge_' + k); else localStorage.setItem('ge_' + k, v); } catch (e) { return null; } };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const GE = window.GE = Object.assign(window.GE || {}, { tools: [], tool: null, hand: false });

  /* ---------- look ---------- */
  const css = el('style');
  css.textContent = `
:root{--gold:#ffd27a;--gold2:#d9a038;--p2:#2a2622;--p3:#35302a}
header{gap:8px;padding:0 12px}
header h1{font-size:19px;margin-right:2px}
header .ttl{display:flex;flex-direction:column;line-height:1.15;min-width:0;max-width:300px;margin-left:4px}
header .ttl b{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}header .ttl small{color:var(--soft);font-size:11px}
header #home{background:none;border-color:transparent;color:var(--soft)}header #home:hover{color:var(--ink);background:#2c2824}
header #export{padding:7px 18px;border-radius:9px}
.pop{position:relative;display:inline-block}
.popm{display:none;position:fixed;z-index:9000;background:#201d1a;border:1px solid var(--line);border-radius:12px;padding:10px;box-shadow:0 18px 50px #000c;min-width:250px;white-space:normal}
.popm.on{display:block}.popm .prow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.popm h4{margin:4px 0 6px;font:600 11px Consolas,monospace;letter-spacing:.12em;color:#ff8a7a}
.popm select{max-width:none;flex:1}.popm button{white-space:nowrap}
#rail{grid-column:1;grid-row:2;background:var(--panel);border-right:1px solid var(--line);overflow-y:auto;overflow-x:hidden;padding:6px 0;display:flex;flex-direction:column;gap:2px;scrollbar-width:none}
#rail button{display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;border-radius:0;color:var(--soft);padding:8px 2px 7px;font-size:11px;border-left:3px solid transparent;position:relative}
#rail button i{font-style:normal;font-size:18px;line-height:1;filter:grayscale(.2)}
#rail button:hover{color:var(--ink);background:#2a2622}
#rail button.on{color:var(--gold);background:#2c261c;border-left-color:var(--gold)}
#rail button sup{position:absolute;top:4px;right:10px;font-size:9px;color:#111;background:var(--gold);border-radius:6px;padding:0 4px}
#lib{grid-column:2;grid-row:2;background:#1a1815;border-right:1px solid var(--line);display:none;flex-direction:column;min-height:0;min-width:0;position:relative}
#lib.on{display:flex}
#lib .lh{display:flex;align-items:center;gap:8px;padding:10px 12px 8px;border-bottom:1px solid var(--line)}
#lib .lh b{font-size:15px;flex:1}#lib .lh button{padding:2px 8px}
#libbody{overflow:auto;padding:12px 12px 30px;flex:1}
#libsep{position:absolute;top:0;bottom:0;right:-4px;width:8px;cursor:ew-resize;z-index:9}
#libsep:hover,#libsep.on{background:#ffd27a33}
.tile{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:var(--p2);border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin:5px 0;cursor:pointer;color:var(--ink)}
.tile:hover{border-color:var(--gold2)}.tile .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tile small{color:var(--soft)}
.tile .pl{flex:none;width:28px;height:28px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;font-size:11px}
.tile .ad{flex:none;padding:3px 9px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.big2{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:64px;background:var(--p2);border:1px solid var(--line);border-radius:10px;cursor:pointer;color:var(--ink);padding:8px;text-align:center}
.big2:hover{border-color:var(--gold2);background:#302a22}.big2 i{font-style:normal;font-size:20px}.big2 small{color:var(--soft);font-size:11px}
.lsearch{width:100%;background:var(--p2);color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:7px 10px;margin-bottom:8px}
#libbody h3,#pane h3{margin-top:16px}#libbody h3:first-child{margin-top:2px}
#side .tabs button{font-size:13px;padding:11px 4px}
.seg{display:inline-flex}.seg button{border-radius:0;margin:0}.seg button:first-child{border-radius:8px 0 0 8px}.seg button:last-child{border-radius:0 8px 8px 0}
.btnrow{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.tickrow{display:flex;gap:7px;align-items:center;margin:5px 0;cursor:pointer}.tickrow input{width:16px;height:16px;accent-color:#ffd27a}
#capbox{border:1px solid #8a72b0;border-radius:10px;padding:8px 10px;margin:4px 0 12px;background:#2a2433}
#xdlg{position:fixed;inset:0;background:#000a;z-index:9500;display:none;align-items:center;justify-content:center;padding:16px}
#xdlg.on{display:flex}
#xdlg .xb{background:var(--panel);border:1px solid var(--line);border-radius:16px;width:min(560px,100%);max-height:90vh;overflow:auto;box-shadow:0 30px 80px #000}
#xdlg .xh{display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)}#xdlg .xh b{flex:1;font-size:17px}
#xbody{padding:14px 18px 20px}#xbody button{margin:3px 4px 3px 0}
#tlbar .tg{display:inline-flex;gap:2px;padding:0 6px;border-left:1px solid var(--line);border-right:1px solid var(--line)}
#tlbar .tg button{min-width:34px;padding:4px 7px}
#tlscroll.hand,#tlscroll.hand *{cursor:grab!important}#tlscroll.hand.grab,#tlscroll.hand.grab *{cursor:grabbing!important}
@media (max-width:900px){#app{--railw:58px}#rail button span{display:none}header .ttl{max-width:120px}}
`;
  document.head.append(css);

  /* ---------- top bar ---------- */
  const hd = document.querySelector('header'), sp = hd.querySelector('.sp');
  const back = $('#home'); back.textContent = '← Projects'; back.title = 'All your projects (and New project)';
  const ttl = el('div', 'ttl', '<b id="ptitle">…</b><small id="pkit"></small>');
  back.after(ttl);
  function popover(label, title) {
    const w = el('span', 'pop'), b = el('button', '', label), m = el('div', 'popm'); b.title = title || ''; w.append(b); document.body.append(m);
    b.onclick = e => { e.stopPropagation(); const on = !m.classList.contains('on'); document.querySelectorAll('.popm.on').forEach(x => x.classList.remove('on')); if (on) { m.classList.add('on'); const r = b.getBoundingClientRect(); m.style.top = (r.bottom + 6) + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px'; } };
    return { w, b, m };
  }
  addEventListener('pointerdown', e => { if (!e.target.closest('.popm') && !e.target.closest('.pop')) document.querySelectorAll('.popm.on').forEach(x => x.classList.remove('on')); });
  const look = popover('Look ▾', 'Kit looks: Default is locked, save your own copies');
  look.m.append(el('h4', '', 'LOOK'));
  const lr1 = el('div', 'prow'); lr1.append($('#sel'), $('#state')); look.m.append(lr1);
  const lr2 = el('div', 'prow'); lr2.append($('#save'), $('#saveas'), $('#del')); look.m.append(lr2);
  const lr3 = el('div', 'prow'); lr3.append($('#reset'), $('#hold')); look.m.append(lr3);
  const more = popover('⋯', 'More');
  more.m.append(el('h4', '', 'SWITCH REEL'));
  const mr1 = el('div', 'prow'); mr1.append($('#kit'), $('#reel')); more.m.append(mr1);
  more.m.append(el('h4', '', 'MORE'));
  const mr2 = el('div', 'prow'); const np = el('button', '', '＋ New project'); np.onclick = () => location.href = '/home?new=1';
  mr2.append(np, $('#devices'), $('#kf')); more.m.append(mr2);
  const tb = $('#takebtn'); if (tb) tb.remove();   // the old "Auto Edit a take" door: New project on the Projects page does this now (L517)
  sp.after($('#brand'), look.w, more.w, $('#test'), $('#export'));
  (function share() { const s = document.createElement('script'); s.src = '/edit/share_ui.js'; s.onload = () => GShare.make(b => $('#export').after(b)); document.head.append(s); })();   // Share button, top right (L543)
  $('#test').textContent = 'Test 8 s'; $('#export').textContent = 'Export';
  $('#export').onclick = () => openExport();
  (async function title() {
    for (let i = 0; i < 200 && !(M && M.name); i++) await new Promise(r => setTimeout(r, 50));
    const r = $('#reel'), k = $('#kit');
    $('#ptitle').textContent = (r && r.value) || ''; $('#pkit').textContent = IST() ? 'My video' : ((k && k.selectedOptions[0] && k.selectedOptions[0].text) || '');
    if (IST()) look.w.style.display = 'none';   // his own videos have no kit look; captions + colours live in the left tools
    rail();
    const want = store('tool:' + (IST() ? 'take' : 'kit'));
    if (want && GE.tools.some(t => t.id === want && (!t.when || t.when()))) openTool(want, true);
    fit();
  })();

  /* ---------- export window ---------- */
  const xd = el('div', '', '<div class="xb"><div class="xh"><b>Export</b><button id="xclose">✕</button></div><div id="xbody"></div></div>'); xd.id = 'xdlg'; document.body.append(xd);
  xd.querySelector('#xclose').onclick = () => xd.classList.remove('on');
  xd.onclick = e => { if (e.target === xd) xd.classList.remove('on'); };
  function openExport() {
    xd.classList.add('on'); const b = $('#xbody'); b.innerHTML = '';
    if (!IST()) {
      const r = el('div', 'btnrow'); const m1 = btn('Make the video file', () => makeVideo(0)); m1.className = 'pri'; r.append(m1, btn('Test video (8 s)', () => makeVideo(8))); b.append(r);
      const inner = el('div'); b.append(inner); renderTab(inner, 'Video');
    } else renderTab(b, 'Video');
  }
  GE.openExport = openExport;

  /* ---------- an old tab drawn somewhere else (left panel, export window) ---------- */
  let inLib = false;
  function renderTab(box, name) {
    const P = document.getElementById('pane'), T = tab; P.id = 'pane_r'; const oid = box.id; box.id = 'pane'; tab = name; inLib = true;
    try { draw(); } catch (e) { console.error(e); box.append(para('Could not draw this panel: ' + e.message)); }
    finally { box.id = oid; P.id = 'pane'; tab = T; inLib = false; }
  }
  GE.renderTab = renderTab;

  /* ---------- left tool list + panel ---------- */
  const R = $('#rail'), L = $('#lib');
  L.innerHTML = '<div class="lh"><b id="libttl"></b><button id="libx" title="Close this panel (the video gets more room)">✕</button></div><div id="libbody"></div><div id="libsep" title="Drag: wider / narrower · double-click: normal"></div>';
  $('#libx').onclick = () => closeTool();
  GE.register = t => { GE.tools = GE.tools.filter(x => x.id !== t.id); GE.tools.push(t); GE.tools.sort((a, b) => a.order - b.order); rail(); if (GE.tool && GE.tool.id === t.id) { GE.tool = t; renderLib(); } };
  const visible = () => GE.tools.filter(t => !t.when || t.when());
  function rail() {
    R.innerHTML = '';
    visible().forEach((t, i) => {
      const b = el('button', GE.tool && GE.tool.id === t.id && L.classList.contains('on') ? 'on' : '', `<i>${t.icon}</i><span>${t.label}</span>`);
      b.title = `${t.label}${i < 9 ? ' (' + (i + 1) + ')' : ''}${t.tip ? ': ' + t.tip : ''}`; b.dataset.tool = t.id;
      b.onclick = () => openTool(t.id); R.append(b);
    });
  }
  function libW() { return +(store('libw') || 300); }
  function openTool(id, stay) {
    const t = GE.tools.find(x => x.id === id); if (!t) return;
    if (!stay && GE.tool && GE.tool.id === id && L.classList.contains('on')) return closeTool();
    GE.tool = t; L.classList.add('on'); root.style.setProperty('--libw', libW() + 'px'); store('tool:' + (IST() ? 'take' : 'kit'), id);
    rail(); renderLib(); setTimeout(fit, 0); if (t.open) t.open();
  }
  function closeTool() { L.classList.remove('on'); root.style.setProperty('--libw', '0px'); GE.tool = null; store('tool:' + (IST() ? 'take' : 'kit'), null); rail(); setTimeout(fit, 0); }
  function renderLib() {
    if (!GE.tool || !L.classList.contains('on')) return;
    const b = $('#libbody'), st = b.scrollTop; $('#libttl').textContent = GE.tool.label;
    b.innerHTML = '';
    const tb = typeof GE.tool.tab === 'function' ? GE.tool.tab() : GE.tool.tab;
    if (tb) renderTab(b, tb); else { try { GE.tool.render(b); } catch (e) { console.error(e); b.append(para('Could not draw this tool: ' + e.message)); } }
    b.scrollTop = st;
  }
  GE.openTool = openTool; GE.closeTool = closeTool; GE.renderLib = renderLib;
  // drag the panel's right edge (L454: every panel border drags)
  (() => {
    const s = $('#libsep'); let x0 = 0, w0 = 0;
    s.onpointerdown = e => { e.preventDefault(); x0 = e.clientX; w0 = L.offsetWidth; s.classList.add('on'); s.setPointerCapture(e.pointerId); };
    s.onpointermove = e => { if (!s.classList.contains('on')) return; const w = Math.max(220, Math.min(innerWidth * 0.45, w0 + e.clientX - x0)); root.style.setProperty('--libw', w + 'px'); store('libw', Math.round(w)); fit(); };
    s.onpointerup = () => s.classList.remove('on');
    s.ondblclick = () => { store('libw', null); root.style.setProperty('--libw', '300px'); fit(); };
  })();

  /* ---------- right panel: the picked thing ---------- */
  const LEFT_TABS = { Colours: 'kit', Captions: 'captions', TakeCaps: 'captions' };
  const takeLbl = () => { const T = window.TAKE; if (!T) return 'Clip'; return T.CSEL ? 'Caption' : T.TSEL && T.TSEL.size ? 'Clip' : 'Project'; };
  const RT = () => IST() ? [['Take', takeLbl()], ['Add', 'Added'], ['Sounds', 'Audio']] : [['Objects', 'Picked'], ['Keys', 'Animation'], ['Sounds', 'Audio'], ['Add', 'Added']];
  let lastRight = null;
  tabs = function () {
    if (inLib) return;
    if (tab === 'Video') { tab = lastRight || RT()[0][0]; openExport(); }
    else if (LEFT_TABS[tab]) { const id = LEFT_TABS[tab]; tab = lastRight || RT()[0][0]; openTool(id, true); }
    const list = RT(); if (!list.some(x => x[0] === tab)) tab = list[0][0]; lastRight = tab;
    const T = $('#tabs'); T.innerHTML = '';
    list.forEach(([n, lab]) => { const b = el('button', n === tab ? 'on' : '', lab); b.onclick = () => { tab = n; tabs(); draw(); }; T.append(b); });
  };
  const _draw = draw;
  draw = function () {
    if (inLib) return _draw();
    if (LEFT_TABS[tab] || tab === 'Video' || IST()) tabs();   // his video: the first tab's name follows the pick (Clip / Caption / Project)
    _draw();
    if (GE.tool && (GE.tool.tab || GE.tool.live)) renderLib();
  };
  tabs(); draw();

  /* ---------- tool bar above the timeline ---------- */
  const tg = el('span', 'tg');
  const tbtn = (id, label, tip, fn) => { const b = el('button', '', label); b.id = id; b.title = tip; b.onclick = fn; tg.append(b); return b; };
  tbtn('tsel', '↖', 'Select tool (V): click to pick, drag a box to pick many', () => setHand(false)).classList.add('on');
  tbtn('thand', '✋', 'Hand tool (H): drag the timeline to move around', () => setHand(!GE.hand));
  tbtn('tsplit', '✂', 'Split at the red line (B)', () => split());
  tbtn('ttrimq', '⇤', 'Trim the start to the red line (Q)', () => trim('q'));
  tbtn('ttrimw', '⇥', 'Trim the end to the red line (W)', () => trim('w'));
  tbtn('tdel', '🗑', 'Delete the picked (Delete)', () => del());
  tbtn('tcopy', '⎘', 'Copy (Ctrl+C)', () => { if (IST() && TAKE.TSEL.size) return toast('Clips: use Split + drag edges; copy works on sounds and added things'); copySel(); });
  tbtn('tpaste', '📋', 'Paste at the red line (Ctrl+V)', () => pasteClip());
  $('#clock').after(tg);
  function setHand(on) { GE.hand = on; $('#thand').classList.toggle('on', on); $('#tsel').classList.toggle('on', !on); tsc().classList.toggle('hand', on); toast(on ? 'Hand tool: drag to move around the timeline (V = back to select)' : 'Select tool'); }
  tsc().addEventListener('pointerdown', e => {
    if (!GE.hand || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const s = tsc(), x0 = e.clientX, y0 = e.clientY, l0 = s.scrollLeft, t0 = s.scrollTop; s.classList.add('grab');
    const mv = ev => { s.scrollLeft = l0 - (ev.clientX - x0); s.scrollTop = t0 - (ev.clientY - y0); };
    const up = () => { s.classList.remove('grab'); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }, true);

  // split, trim, delete for every kind of block
  function underLine(list) { return list.filter(o => o.type ? (t > o.t0 + 0.04 && t < o.t1 - 0.04) : (t > o.t + 0.04 && t < o.t + sndLen(o) - 0.04)); }
  function edList() { const g = [...SEL].filter(isEd); return g.length ? g : null; }
  function split() {
    if (IST() && window.TAKE && TAKE.TK && (TAKE.TSEL.size || !SEL.size)) return TAKE.splitAt();
    const list = underLine(edList() || [...sounds.filter(s => !s.kit), ...added]); if (!list.length) return toast('Put the red line over a block to split it');
    hist(); let n = 0;
    list.forEach(o => {
      if (o.type) { const c = clone(o); delete c._b; c.id = 'a' + Date.now().toString(36) + n; c.t0 = +t.toFixed(3); o.t1 = +t.toFixed(3); added.push(c); }
      else { const Ln = sndLen(o), d = t - o.t, c = clone(o); c.id = 's' + Date.now() + n; c.t = +t.toFixed(3); c.cut = +((o.cut || 0) + d).toFixed(3); c.len = +(Ln - d).toFixed(3); o.len = +d.toFixed(3); sounds.push(c); }
      n++;
    });
    saveSounds(); saveAdded(); pushAdded(); renderTL(); toast(n === 1 ? 'Split in two' : n + ' blocks split');
  }
  function trim(w) {
    if (IST() && window.TAKE && TAKE.TK && !SEL.size) {
      const TK = TAKE.TK, b = TK.blocks.find(x => t >= x._s && t < x._s + TAKE.dur(x)); if (!b) return;
      const at = TAKE.q(b.in + (t - b._s) * (b.speed || 1));
      if (w === 'q') { if (at - b.in < 1 / FPS) return; b.in = at; } else { if (b.out - at < 1 / FPS) return; b.out = at; }
      TAKE.changed(); if (w === 'q') seek(b._s + 0.01); toast(w === 'q' ? 'Start trimmed to the red line' : 'End trimmed to the red line'); return;
    }
    const list = underLine(edList() || []); if (!list.length) return toast('Pick a block and put the red line inside it');
    hist();
    list.forEach(o => {
      if (o.type) { if (w === 'q') o.t0 = +t.toFixed(3); else o.t1 = +t.toFixed(3); }
      else { const Ln = sndLen(o), d = t - o.t; if (w === 'q') { o.cut = +((o.cut || 0) + d).toFixed(3); o.len = +(Ln - d).toFixed(3); o.t = +t.toFixed(3); } else o.len = +d.toFixed(3); }
    });
    saveSounds(); saveAdded(); pushAdded(); renderTL(); toast('Trimmed');
  }
  function del() {
    if (KSEL.size) return delKeys();
    if (IST() && window.TAKE && TAKE.TSEL.size) return TAKE.delBlocks();
    if (SEL.size) return delSel();
    toast('Pick something first');
  }
  GE.split = split; GE.trim = trim; GE.del = del;

  /* ---------- keys (on top of the old ones) ---------- */
  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) {
      if (e.key === 'Escape') document.activeElement.blur(); return;
    }
    const k = e.key, c = e.ctrlKey || e.metaKey, lk = k.length === 1 ? k.toLowerCase() : k;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (c && lk === 's') { stop(); if (IST() && TAKE.TK) { post('/api/take/save', { take: TAKE.stripped(TAKE.TK) }).then(() => toast('Project saved')); } else if (name !== 'default') $('#save').click(); else toast('Your edits save by themselves. A kit look: Look ▾ → Save look as…'); return; }
    if (c && lk === 'e') { stop(); openExport(); return; }
    if (c && lk === 'b' && !IST()) { stop(); split(); return; }
    if (e.altKey && lk === 'n') { stop(); location.href = '/home?new=1'; return; }
    if (c || e.altKey) return;
    if (k === 'Escape') { if (xd.classList.contains('on')) { xd.classList.remove('on'); stop(); return; } document.querySelectorAll('.popm.on').forEach(x => x.classList.remove('on')); if (GE.hand) setHand(false); return; }
    if (lk === 'b') { stop(); split(); return; }
    if (lk === 'v') { stop(); setHand(false); return; }
    if (lk === 'h') { stop(); setHand(!GE.hand); return; }
    if (lk === 'q' || lk === 'w') { stop(); trim(lk); return; }
    if (k === '?') { stop(); $('#keys').click(); return; }
    if (/^[1-9]$/.test(k)) { const t = visible()[+k - 1]; if (t) { stop(); openTool(t.id); } }
  }, true);
  const kh = $('#keyhelp');
  kh.insertAdjacentHTML('beforeend', `<br><b>New layout:</b> <kbd>B</kbd> split · <kbd>Q</kbd> / <kbd>W</kbd> trim start / end to the red line · <kbd>V</kbd> select · <kbd>H</kbd> hand (drag the timeline) ·
    <kbd>1</kbd>…<kbd>9</kbd> left tools · <kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>E</kbd> export · <kbd>Alt</kbd>+<kbd>N</kbd> new project · <kbd>?</kbd> this list · <kbd>N</kbd> note at the red line`);

  /* ---------- the built-in tools ---------- */
  const tile = (name, sub, onAdd, onPlay) => {
    const d = el('div', 'tile');
    if (onPlay) { const p = el('button', 'pl', '▶'); p.title = 'Listen'; p.onclick = e => { e.stopPropagation(); onPlay(p); }; d.append(p); }
    d.append(el('span', 'nm', `${esc(name)}${sub ? `<br><small>${esc(sub)}</small>` : ''}`));
    if (onAdd) { const a = el('button', 'ad', '+ Add'); a.title = 'Put it at the red line'; a.onclick = e => { e.stopPropagation(); onAdd(); }; d.append(a); d.onclick = () => onAdd(); }
    return d;
  };
  let prevSrc = null, prevBtn = null;
  async function listen(file, b) {
    try { if (prevSrc) { prevSrc.stop(); if (prevBtn) prevBtn.textContent = '▶'; } } catch (e) {}
    if (prevBtn === b && prevSrc) { prevSrc = null; prevBtn = null; return; }
    AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume();
    const bb = await buf(file); if (!bb) return toast('Could not play that sound');
    const s = AC.createBufferSource(); s.buffer = bb; const g = AC.createGain(); g.gain.value = 0.7; s.connect(g).connect(AC.destination); s.start();
    prevSrc = s; prevBtn = b; b.textContent = '■'; s.onended = () => { if (prevBtn === b) { b.textContent = '▶'; prevSrc = null; prevBtn = null; } };
  }
  GE.listen = listen;
  function addSound(file, role, gain) {
    const c = { id: 's' + Date.now(), t: +t.toFixed(2), role: role || stem(file), file, gain: gain ?? -6 };
    sounds.push(c); selSnd = c; SEL.clear(); SEL.add(c); saveSounds(); buildSounds(); try { loadWaves(); } catch (e) {} tab = 'Sounds'; tabs(); draw();
    toast('Added at ' + fmtT(t) + ': ' + stem(file) + ' · drag it on the timeline');
  }
  GE.addSound = addSound;
  const searchBox = (ph, fn) => { const i = el('input', 'lsearch'); i.placeholder = ph; i.oninput = () => fn(i.value.trim().toLowerCase()); i.onkeydown = e => e.stopPropagation(); return i; };

  GE.register({ id: 'media', order: 10, icon: '🖼', label: 'Media', tip: 'photos, memes, news cards', live: true, render(b) {
    if (IST() && TAKE.TK) b.append(para(`<b>Your video</b><br>${esc(String(TAKE.TK.src).split(/[\\/]/).pop())} · ${TAKE.TK.info.w}×${TAKE.TK.info.h} · ${TAKE.TK.info.dur.toFixed(1)} s`));
    const g = el('div', 'grid2');
    const up = uploadBtn('', '.png,.jpg,.jpeg,.webp,.gif,.svg', r => newAdd('photo', { src: r.src, w: 640 }));
    const ub = up.querySelector('button'); ub.className = 'big2'; ub.innerHTML = '<i>＋</i>Photo / meme<small>from this device</small>'; ub.onclick = () => up.querySelector('input').click();
    g.append(up);
    const card = el('button', 'big2', '<i>▭</i>News card<small>headline + paper name</small>'); card.onclick = () => newAdd('card'); g.append(card);
    b.append(g);
    b.append(h3('In this reel'));
    const list = added.filter(a => a.type === 'photo' || a.type === 'card');
    if (!list.length) b.append(para('Nothing yet. Anything you add lands at the red line; drag it on the video to place it.'));
    list.forEach(a => b.append(tile(addName(a), `${a.t0}–${a.t1} s`, null, null))); [...b.querySelectorAll('.tile')].forEach((d, i) => d.onclick = () => { selectAdded(list[i].id); seek(list[i].t0 + 0.05); });
  } });

  GE.register({ id: 'audio', order: 20, icon: '🎵', label: 'Audio', tip: 'music + the reel\'s sounds', render(b) {
    b.append(uploadBtn('＋ My music / sound from this device…', '.mp3,.wav,.m4a,.ogg', async r => { await refreshFiles(); addSound(r.file, r.name.replace(/^\d+_/, '').replace(/\.[a-z0-9]+$/i, ''), -10); }));
    b.append(para('Music is just a long sound: after adding it, lower its loudness in the right panel (Audio).'));
    const box = el('div'); const show = q => { box.innerHTML = ''; (files || []).filter(f => !q || f.toLowerCase().includes(q)).forEach(f => box.append(tile(stem(f), f.split('/').slice(0, -1).join('/'), () => addSound(f), p => listen(f, p)))); if (!box.children.length) box.append(para('No sound matches.')); };
    b.append(h3('Sound library'), searchBox('Search sounds…', show), box); show('');
    b.append(h3('In this reel')); const mine = sounds.filter(s => !s.kit);
    if (!mine.length) b.append(para('No added sounds yet.')); mine.forEach(s => { const d = tile(sndName(s), `at ${s.t.toFixed(2)} s · ${s.gain} dB`, null, p => listen(s.file, p)); d.onclick = () => { pickSound(s); seek(s.t); follow(); }; b.append(d); });
  } });

  GE.register({ id: 'text', order: 30, icon: 'Aa', label: 'Text', tip: 'titles, labels, captions you type', live: true, render(b) {
    const g = el('div', 'grid2');
    [['text', 'T', 'Text', 'a label you place'], ['caption', 'Aa', 'Caption', '6 looks, word by word'], ['title', '𝐓', 'Title', 'big words on top']].forEach(([ty, ic, n, s]) => {
      const x = el('button', 'big2', `<i>${ic}</i>${n}<small>${s}</small>`);
      x.onclick = () => ty === 'title' ? newAdd('text', { text: 'BIG TITLE', fs: 150, y: 520, font: 'Anton', color: '#ffffff' }) : newAdd(ty); g.append(x);
    });
    b.append(g);
    b.append(h3('In this reel'));
    const list = added.filter(a => a.type === 'text' || a.type === 'caption');
    if (!list.length) b.append(para('Nothing yet. Click one above: it lands at the red line; type your words in the right panel; drag it on the video.'));
    list.forEach(a => { const d = tile(addName(a), `${a.t0}–${a.t1} s`); d.onclick = () => { selectAdded(a.id); seek(a.t0 + 0.05); }; b.append(d); });
    if (BRAND) b.append(para(`Brand on: new text uses ${esc(BRAND.name)}'s look.`));
  } });

  GE.register({ id: 'captions', order: 40, icon: 'CC', label: 'Captions', tip: 'caption look, colour, size, font', tab: () => IST() ? 'TakeCaps' : (M.themeScript ? 'Captions' : null), render(b) {
    b.append(para('This kit draws its own captions. To put words on top, add a caption here.'));
    const x = btn('＋ Add a caption at the red line', () => newAdd('caption')); x.className = 'pri'; b.append(x);
  } });

  GE.register({ id: 'sfx', order: 100, icon: '✷', label: 'Sound FX', tip: 'whooshes, pops, hits: your approved sounds first', render(b) {
    const box = el('div'); b.append(searchBox('Search sound FX (whoosh, pop, hit…)', q => show(q)), box);
    let LIBR = null;
    const show = q => {
      box.innerHTML = ''; if (!LIBR) return box.append(para('Loading…'));
      LIBR.forEach(g => {
        const fs = g.files.filter(f => !q || (g.group + ' ' + f.name).toLowerCase().includes(q)); if (!fs.length) return;
        box.append(h3(g.group + (g.approved ? ' ✓' : '')));
        fs.forEach(f => box.append(tile(f.name, null, () => addSound(f.file, g.group.replace(/^Approved: /, '').split(/[ /]/)[0].toLowerCase()), p => listen(f.file, p))));
      });
      if (!box.children.length) box.append(para('No sound matches.'));
    };
    show(''); api('/api/sfxlib').then(l => { LIBR = l; show(''); }).catch(() => { box.innerHTML = ''; box.append(para('Could not load the sound library.')); });
    b.append(para('✓ = sounds you approved by ear. Sounds you banned never show up here.'));
  } });

  GE.register({ id: 'kit', order: 110, icon: '◆', label: 'Kit', tip: 'the kit\'s own colours', when: () => !!(M && M.themeScript), tab: 'Colours' });

  GE.register({ id: 'notes', order: 120, icon: '✎', label: 'Notes', tip: 'your notes (also under the right panel)', live: true, open() { const d = $('#notes'); if (d && d.classList.contains('shut')) d.querySelector('.fold').click(); }, render(b) {
    const nb = btn('＋ Note at the red line (N)', () => { const a = document.querySelector('#notes .add'); if (a) a.click(); }); nb.className = 'pri'; b.append(nb);
    b.append(para('Notes stay in the NOTES box under the right panel too. Any Claude chat can read them ("do my notes").'));
    const box = el('div'); b.append(box);
    api('/api/notes').then(l => { box.innerHTML = ''; const open = l.filter(n => n.state !== 'done'); box.append(h3(`Open (${open.length})`)); if (!open.length) box.append(para('No open notes.'));
      open.forEach(n => { const d = tile(n.text, n.t0 != null ? `${(+n.t0).toFixed(1)}${n.t1 != null ? '–' + (+n.t1).toFixed(1) : ''} s` : ''); d.onclick = () => { if (n.t0 != null) { seek(+n.t0); follow(); } }; box.append(d); });
      const dn = l.filter(n => n.state === 'done'); if (dn.length) { box.append(h3(`Done (${dn.length})`)); dn.slice(-8).forEach(n => box.append(tile('✓ ' + n.text, null))); }
    }).catch(() => {});
  } });
})();

/* flow_ui.js: the Reel Editor side of the Gautham Studio flow (his answers, Studio ledger L9-L14). Loaded by editor.html after
   its own script; it adds to the timeline without changing how the editor works:
   - rows CAMERA (each line's camera move + its keys), CAPTIONS (each caption group; drag = say it earlier / later), FACE (full-face cuts)
   - Captions: Tanglish / English switch (his "Both, switch in editor")
   - the Studio step bar (percent + step, from runner/flow.py) and the "Ask Claude" button: select a part -> type -> Save ->
     he says "go" in the chat -> the versions appear here side by side -> "Use this" puts one into the reel.
   Uses the editor's own globals (beats, total, X, HEADW, blk, esc, clickable, seek, cw, pv, api, post, toast, loopA/loopB, SEL). */
(function () {
  if (typeof makeRows !== 'function' || typeof renderNow !== 'function') return;
  let CAPS = { mode: 'ta', shift: {}, eye: { full: true, split: true } }, FLOW = null, ASK = {}, REEL = '', hasFlow = false;
  window.flowCaps = {           // for undo (editor.html snapState) and live AI changes (notes_ui.js)
    get: () => (REEL ? JSON.parse(JSON.stringify(CAPS)) : null),
    set: async c => { CAPS = JSON.parse(JSON.stringify(c)); CAPS.shift = CAPS.shift || {}; await post('/api/caps', CAPS); reloadReel(); drawBar(); },
    reload: async () => { CAPS = await api('/api/caps'); CAPS.shift = CAPS.shift || {}; drawBar(); },
  };
  const has = k => beats.some(b => b && b[k] && (Array.isArray(b[k]) ? b[k].length : true));
  const capOn = () => beats.some(b => (b.cap || []).length);
  const bilingual = () => beats.some(b => b.cap_en && b.cap_ta);

  /* ---------- rows ---------- */
  const _mk = makeRows;
  makeRows = function () {
    const R = _mk(), at = R.findIndex(r => r.id === 'added'), mine = [];
    if (has('cam')) mine.push({ id: 'camera', name: 'CAMERA', sub: 'move per line · ◆ = camera key', group: 'v', h: 34, packed: [], n: 1 });
    if (capOn()) mine.push({ id: 'captions', name: 'CAPTIONS', sub: bilingual() ? (CAPS.mode === 'en' ? 'English script line' : 'your Tanglish words') + ' · drag = earlier / later' : 'drag = earlier / later', group: 'v', h: 34, packed: [], n: 1 });
    if (beats.some(b => b.cutin)) mine.push({ id: 'face', name: 'FACE', sub: 'your full face on screen', group: 'v', h: 28, packed: [], n: 1 });
    mine.forEach(r => { if (typeof rowH === 'object' && rowH[r.id]) r.h = Math.max(26, rowH[r.id]); });
    R.splice(at < 0 ? R.length : at, 0, ...mine);
    return R;
  };
  const _rn = renderNow;
  renderNow = function () {
    _rn();
    const rc = id => document.querySelector(`#tlin .row[data-row="${id}"] .rc`);
    const cam = rc('camera'), cap = rc('captions'), face = rc('face');
    beats.forEach((b, i) => {
      if (cam && b.cam) {
        const d = blk('bk flowcam', X(b.t0), X(b.dur), 3, 26, `<span class="lb">${esc(b.move_name || b.move || 'camera')}${b.fx ? ' · ' + esc(b.fx) : ''}</span>`);
        d.dataset.k = 'c:' + i; d.title = `Line ${i + 1} camera: ${b.move_name || ''} (${b.cam.length} keys)`; d._o = b; clickable(d, () => { SEL.clear(); SEL.add(b); markSel(); seek(b.t0 + 0.01); if (typeof focusKF === 'function' && DEFS.camera) focusKF('camera'); }, () => playRange(b.t0, b.t0 + b.dur)); cam.append(d);
        if (typeof kitKeyEl === 'function') b.cam.forEach((k, j) => kitKeyEl(cam, b, i, k, j)); else b.cam.forEach(k => { const m = document.createElement('i'); m.className = 'flowkey'; m.style.left = X(b.t0 + (k.u || 0)) - 4 + 'px'; m.title = `zoom x${(k.s || 1).toFixed(2)} at ${(b.t0 + (k.u || 0)).toFixed(2)} s`; cam.append(m); });
      }
      if (face && b.cutin) {
        const a = b.t0 + b.cutin.u, d = blk('bk flowface', X(a), X(b.cutin.dur), 3, 20, '<span class="lb">full face</span>'); d.dataset.k = 'f:' + i;
        clickable(d, () => seek(a + 0.01), () => {}); face.append(d);
      }
      if (cap) (b.cap || []).forEach((g, gi) => {
        const a = b.t0 + g.u, z = b.t0 + (g.end || g.u + 1), key = i + '.' + gi, words = g.w.map(w => w[1]).join(' ');
        const d = blk('bk flowcap' + (CAPS.shift[key] ? ' moved' : ''), X(a), X(z - a), 3, 26, `<span class="lb">${esc(words)}</span>`);
        d.dataset.k = 'k:' + key; d.title = `"${words}"  ${a.toFixed(2)}–${z.toFixed(2)} s${CAPS.shift[key] ? `  (you moved it ${CAPS.shift[key] > 0 ? '+' : ''}${CAPS.shift[key]} s)` : ''}`;
        d.onpointerdown = e => {
          e.stopPropagation(); const x0 = e.clientX, l0 = parseFloat(d.style.left); let moved = 0; d.setPointerCapture(e.pointerId);
          d.onpointermove = ev => { moved = (ev.clientX - x0) / (X(1) || 1); d.style.left = l0 + (ev.clientX - x0) + 'px'; };
          d.onpointerup = async () => {
            d.onpointermove = d.onpointerup = null;
            if (Math.abs(moved) < 0.04) return seek(a + 0.01);
            CAPS.shift[key] = +(((CAPS.shift[key] || 0) + moved).toFixed(2)); if (Math.abs(CAPS.shift[key]) < 0.04) delete CAPS.shift[key];
            await post('/api/caps', CAPS); if (typeof hist === 'function') hist(); reloadReel(`caption moved ${moved > 0 ? 'later' : 'earlier'} by ${Math.abs(moved).toFixed(1)} s`);
          };
        };
        cap.append(d);
      });
    });
  };

  function reloadReel(msg) {
    if (msg) toast(msg); const keep = t; pv.src = '/reel/reel.html?at=' + Math.round(keep * 1000) + '&edit=1&r=' + Date.now();
    setTimeout(() => { try { seek(keep); } catch (e) {} }, 1500);
  }

  /* ---------- the bar: step bar + caption switch + Ask Claude ---------- */
  const css = document.createElement('style');
  css.textContent = `#flowbar{position:fixed;left:14px;top:50px;z-index:900;background:#1d1a17ee;border:1px solid #4a433b;border-radius:10px;padding:8px 10px;font:12px system-ui;color:#e8dfcf;display:flex;gap:8px;align-items:center;max-width:620px;flex-wrap:wrap}
#flowbar button{padding:5px 10px}#flowbar .pct{font:600 13px Consolas,monospace;color:#ffd27a}#flowbar .st{color:#b9ad98;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#flowbar .seg button.on{background:#c4251a;color:#fff}#flowbar .fb{height:6px;width:120px;background:#14120f;border-radius:3px;overflow:hidden}#flowbar .fb i{display:block;height:100%;background:#c4251a}
.blk.flowcam{background:linear-gradient(#2d3a4a,#25303c)!important}.blk.flowface{background:linear-gradient(#5a3a2a,#4a2f22)!important}.blk.flowcap{background:linear-gradient(#3a3a26,#2f2f1f)!important;cursor:ew-resize;pointer-events:auto}.blk.flowcap.moved{outline:1px solid #ffd27a}
i.flowkey{position:absolute;top:22px;width:8px;height:8px;background:#7fb2e8;transform:rotate(45deg);pointer-events:none;z-index:2}
#askbox{position:fixed;inset:0;background:#000a;z-index:2000;display:none;align-items:center;justify-content:center}#askbox>div{background:#221f1b;border:1px solid #4a433b;border-radius:12px;padding:16px;width:min(980px,94vw);max-height:92vh;overflow:auto;color:#e8dfcf;font:14px system-ui}
#askbox textarea{width:100%;height:80px;background:#2c2824;color:#e8dfcf;border:1px solid #4a433b;border-radius:8px;padding:8px;font:14px system-ui}#askbox .vers{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
#askbox .ver{width:200px}#askbox .ver iframe{width:1080px;height:1920px;transform:scale(.185);transform-origin:0 0;border:0}#askbox .ver .fr{width:200px;height:356px;overflow:hidden;border-radius:8px;border:1px solid #4a433b}`;
  document.head.append(css);
  const bar = document.createElement('div'); bar.id = 'flowbar'; bar.style.display = 'none'; document.body.append(bar);
  const box = document.createElement('div'); box.id = 'askbox'; box.innerHTML = '<div></div>'; document.body.append(box);
  box.onclick = e => { if (e.target === box) box.style.display = 'none'; };

  const eyeOn = k => !(CAPS.eye && CAPS.eye[k] === false);
  const hasEye = () => { try { return !!pv.contentWindow.EYELOCK; } catch (e) { return false; } };
  function drawBar() {
    const show = hasFlow || bilingual() || hasEye(); bar.style.display = show ? 'flex' : 'none'; if (!show) return;
    const f = FLOW || {}, pk = f.pick || {};
    const running = f.state === 'running' || pk.state === 'running';
    bar.innerHTML = (hasFlow ? `<span class="pct">${f.pct ?? ''}%</span><span class="fb"><i style="width:${f.pct || 0}%"></i></span><span class="st" title="${esc((f.log || []).slice(-6).join('\n'))}">${esc(pk.state === 'running' ? pk.msg : (f.state === 'done' ? 'built: edit anything' : (f.state || '') + ' · ' + (f.step || '') + ' · ' + (f.msg || '')))}</span>` : '')
      + (bilingual() ? `<span class="seg">Captions <button data-m="ta" class="${CAPS.mode !== 'en' ? 'on' : ''}" title="Your Tanglish words, at the times you say them">Tanglish</button><button data-m="en" class="${CAPS.mode === 'en' ? 'on' : ''}" title="The English script line">English</button></span>` : '')
      + (hasEye() ? `<span class="seg">Eye-Lock <button data-e="full" class="${eyeOn('full') ? 'on' : ''}" title="Your eyes stay on one spot while you move, in full screen">Full ${eyeOn('full') ? 'on' : 'off'}</button><button data-e="split" class="${eyeOn('split') ? 'on' : ''}" title="Same, in the split screen. Turn it off if the split looks too zoomed in">Split ${eyeOn('split') ? 'on' : 'off'}</button></span>` : '')
      + (hasFlow ? `<button id="askbtn" ${running ? 'disabled' : ''} title="Select a part (a block, or a loop range), then ask for a change or 4-5 versions">Ask Claude</button>` : '')
      + (ASK.state === 'waiting for go' ? '<span class="st">waiting: say “go” in the chat</span>' : '') + (ASK.state === 'ready' ? '<button id="vbtn" class="pri">Versions ready</button>' : '');
    bar.querySelectorAll('[data-m]').forEach(b => b.onclick = async () => { if (CAPS.mode === b.dataset.m) return; CAPS.mode = b.dataset.m; await post('/api/caps', CAPS); if (typeof hist === 'function') hist(); reloadReel(CAPS.mode === 'en' ? 'Captions: English script line' : 'Captions: your Tanglish words'); });
    bar.querySelectorAll('[data-e]').forEach(b => b.onclick = async () => {   // Eye-Lock Full / Split: shows at once in the preview, saved for the video file
      const k = b.dataset.e; CAPS.eye = CAPS.eye || { full: true, split: true }; CAPS.eye[k] = !eyeOn(k);
      try { pv.contentWindow['EYE_' + k.toUpperCase()] = CAPS.eye[k]; } catch (e) {}
      await post('/api/caps', CAPS); if (typeof hist === 'function') hist(); drawBar(); toast('Eye-Lock ' + k + (CAPS.eye[k] ? ' on' : ' off'));
    });
    const ab = bar.querySelector('#askbtn'); if (ab) ab.onclick = () => openAsk();
    const vb = bar.querySelector('#vbtn'); if (vb) vb.onclick = openVersions;
  }

  function part() {            // what he selected: a loop range, selected blocks, else the line under the playhead
    let a = null, z = null; const lines = new Set(), pieces = [];
    if (typeof loopA === 'number' && typeof loopB === 'number' && loopB > loopA) { a = loopA; z = loopB; }
    document.querySelectorAll('#tlin .blk.sel').forEach(d => {
      const k = d.dataset.k || ''; if (k.startsWith('b:')) lines.add(+k.slice(2) + 1); if (k.startsWith('p:')) pieces.push(k.slice(2));
      const l = parseFloat(d.style.left) / (X(1) || 1), w = parseFloat(d.style.width) / (X(1) || 1); a = a == null ? l : Math.min(a, l); z = z == null ? l + w : Math.max(z, l + w);
    });
    if (a == null) { const b = beats.find(b => t >= b.t0 && t < b.t0 + b.dur) || beats[0]; a = b.t0; z = b.t0 + b.dur; }
    beats.forEach(b => { if (b.t0 < z - 0.05 && b.t0 + b.dur > a + 0.05) lines.add(b.i + 1); });
    return { t0: +a.toFixed(2), t1: +z.toFixed(2), lines: [...lines].sort((x, y) => x - y), pieces };
  }

  /* right-click any block (his words: "whether I like it or I wanna change it" / "I need audio for this"): adds to the editor's menu */
  const blkPart = d => {
    const a = parseFloat(d.style.left) / (X(1) || 1), z = a + parseFloat(d.style.width) / (X(1) || 1), lines = [];
    beats.forEach(b => { if (b.t0 < z - 0.05 && b.t0 + b.dur > a + 0.05) lines.push(b.i + 1); });
    return { t0: +a.toFixed(2), t1: +z.toFixed(2), lines, pieces: (d.dataset.k || '').startsWith('p:') ? [d.dataset.k.slice(2)] : [] };
  };
  document.addEventListener('contextmenu', e => {
    const d = e.target.closest('#tlin .blk'); if (!d || !hasFlow) return; e.preventDefault();
    const k = d.dataset.k || '', what = (d.querySelector('.lb') || d).textContent.trim().slice(0, 80), p = blkPart(d), snd = k.startsWith('s:');
    const mine = [['', null],
      ['👍 I like this', async () => { await post('/api/note', { verdict: 'like', key: k, what, t0: p.t0, t1: p.t1 }); toast('Noted: you like ' + (snd ? 'this sound' : 'this') + '.'); }],
      ['✎ Change this… (tell Claude)', () => openAsk(p, '', 'change', k, what)]];
    if (!snd) mine.push(['♪ I need a sound for this…', () => openAsk(p, 'I need a sound here: ', 'need-audio', k, what)]);
    setTimeout(() => {                       // after the editor's own menu is built (or make one if it has none for this block)
      let m = document.getElementById('ctx');
      if (!m) { menuAt(e.clientX, e.clientY, mine.slice(1)); return; }
      mine.forEach(([l, fn]) => { if (!l) { m.append(document.createElement('hr')); return; } const b = document.createElement('button'); b.textContent = l; b.onclick = () => { closeMenu(); fn(); }; m.append(b); });
      const r = m.getBoundingClientRect(); if (r.bottom > innerHeight - 6) m.style.top = Math.max(6, innerHeight - r.height - 6) + 'px';
    }, 0);
  });

  function openAsk(pre, preset, verdict, key, what) {
    const p = pre || part(), inner = box.firstChild;
    inner.innerHTML = `<h3 style="margin:0 0 6px">Ask Claude to change this part</h3>
      <p style="color:#b9ad98;margin:0 0 10px">Part: ${p.t0.toFixed(1)}–${p.t1.toFixed(1)} s · line${p.lines.length > 1 ? 's' : ''} ${p.lines.join(', ')}${p.pieces.length ? ' · ' + p.pieces.length + ' piece(s)' : ''}. Only these lines are made again; the lines before and after stay exactly the same, and the join stays smooth.</p>
      <textarea id="asktxt" placeholder="e.g. a funnier meme here / zoom into the headline / make 4 versions with different news"></textarea>
      <p>How many versions? <label><input type="radio" name="n" value="1" checked> 1</label> <label><input type="radio" name="n" value="4"> 4</label> <label><input type="radio" name="n" value="5"> 5</label></p>
      <button id="asksave" class="pri">Save</button> <button id="askno">Cancel</button>`;
    box.style.display = 'flex'; const ta = inner.querySelector('#asktxt'); if (preset) ta.value = preset; if (what) inner.querySelector('h3').textContent = (verdict === 'need-audio' ? 'Ask Claude for a sound for: ' : 'Ask Claude to change: ') + what; ta.focus();
    inner.querySelector('#askno').onclick = () => box.style.display = 'none';
    inner.querySelector('#asksave').onclick = async () => {
      const text = inner.querySelector('#asktxt').value.trim(); if (!text) return toast('Type what to change first');
      const n = +inner.querySelector('input[name=n]:checked').value;
      if (verdict) await post('/api/note', { verdict, key, what, t0: p.t0, t1: p.t1, text });
      ASK = await post('/api/ask', Object.assign(p, { text: (verdict === 'need-audio' ? '[NEEDS A SOUND] ' : '') + text + (what ? ` (on: ${what}${key ? ', ' + key : ''})` : ''), n })); box.style.display = 'none'; drawBar();
      toast('Saved. Now say “go” in the chat.', 6000);
    };
  }

  function openVersions() {
    const inner = box.firstChild, vs = ASK.versions || [], li = (ASK.lines && ASK.lines[0] ? ASK.lines[0] : (vs[0] && vs[0].lines[0]) || 1) - 1;
    inner.innerHTML = `<h3 style="margin:0 0 6px">Versions for: “${esc(ASK.text || '')}”</h3><p style="color:#b9ad98;margin:0">Each one loops line ${li + 1}. Pick one: it goes into the reel and the rest stays as it is.</p><div class="vers"></div><p><button id="vno">Close</button></p>`;
    const row = inner.querySelector('.vers');
    vs.forEach(v => {
      const c = document.createElement('div'); c.className = 'ver';
      c.innerHTML = `<div class="fr"><iframe src="/vreel/${encodeURIComponent(v.reel)}/reel.html?beat=${li}" loading="lazy"></iframe></div><p style="margin:6px 0">${v.k}. ${esc(v.note || '')}</p><button class="pri">Use this</button>`;
      c.querySelector('button').onclick = async () => {
        const r = await post('/api/pick', { k: v.k }); if (r.error) return toast(r.error);
        box.style.display = 'none'; toast(`Putting version ${v.k} into the reel…`, 5000); waitPick();
      };
      row.append(c);
    });
    inner.querySelector('#vno').onclick = () => box.style.display = 'none'; box.style.display = 'flex';
  }

  async function waitPick() {
    for (let i = 0; i < 400; i++) {
      await new Promise(r => setTimeout(r, 3000)); FLOW = await api('/api/flow'); drawBar();
      const pk = FLOW.pick || {}; if (pk.state === 'done') { toast('Done: your pick is in the reel.'); return location.reload(); }
      if (pk.state === 'error') return toast('The pick did not finish: ' + (pk.msg || ''), 9000);
    }
  }

  async function poll() {
    try {
      const st = await api('/api/state'); if (st.reel !== REEL) { CAPS = await api('/api/caps'); CAPS.shift = CAPS.shift || {}; REEL = st.reel;
        if (typeof HIS === 'object') {   // the undo list was made before the captions loaded: give every step these captions, so loading them is not an undo step
          const c = JSON.stringify(flowCaps.get()), fix = x => (x && x.endsWith(',"CAPS":null}') ? x.slice(0, -5) + c + '}' : x);
          HIS.cur = fix(HIS.cur); HIS.undo = HIS.undo.map(fix); HIS.redo = HIS.redo.map(fix);
        } }
      FLOW = await api('/api/flow'); hasFlow = !!(FLOW && FLOW.name); ASK = await api('/api/ask'); drawBar();
    } catch (e) {}
    setTimeout(poll, FLOW && FLOW.state === 'running' ? 3000 : 8000);
  }
  pv.addEventListener('load', () => setTimeout(() => { renderTL(); drawBar(); }, 400));
  poll();
})();

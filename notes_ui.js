/* notes_ui.js: his NOTES in the Reel Editor + live changes from any AI (LEDGER L441, L447). Loaded after flow_ui.js.
   - NOTES dock at the bottom of the right panel, always there: type a note with from / to seconds; open + done lists; the AI's reply
   - right-click ANYTHING (a block, a ◆ key, empty timeline space, a row name, the ruler, the preview) = "📝 Note about this…",
     the time (or his I/O loop) and the thing filled in; N = a note at the red line
   - note flags on the ruler (click = open the note)
   - an AI change (a Claude chat through mcp_server.py, opencode, DeepSeek, a local model through notes_api.py) shows up within
     ~1.5 s with "Claude changed: …"; Ctrl+Z puts it back (his answer: "Change it, I can undo")
   - tells the server what the editor sees (lines + what keyframes can move), so an AI can read the reel without opening it
   Uses the editor's globals (sounds, added, items, beats, total, t, KITK, KBASE, loopA/loopB, X, HEADW, pps, esc, toast, api, post,
   menuAt, closeMenu, seek, playRange, renderTL, draw, hist, HIS, timeAt, fromTheatre, applyKeys, reloadPreview, ...). */
(function () {
  if (typeof renderNow !== 'function' || typeof menuAt !== 'function') return;
  let NOTES = [], seenChg = null, openId = null, showDone = false, lastJSON = '';
  const KIND = { note: ['📝', 'Note'], change: ['✎', 'Change this'], like: ['👍', 'I like this'], 'need-audio': ['♪', 'Needs a sound'] };
  const f1 = v => (+v || 0).toFixed(1);
  const range = n => (Math.abs(n.t1 - n.t0) < 0.05 ? f1(n.t0) + ' s' : f1(n.t0) + '–' + f1(n.t1) + ' s');

  /* ---------- look ---------- */
  const css = document.createElement('style');
  css.textContent = `#notes{flex:none;border-top:2px solid #3a352f;background:#1c1916;display:flex;flex-direction:column;max-height:var(--nh,58%);min-height:40px}
#notes .quick .tt{display:none}#notes .quick.typing .tt{display:flex}#notes .quick textarea{min-height:34px;height:34px}#notes .quick.typing textarea{height:64px}
#notes .nh{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;flex:none}
#notes .nh b{font:600 12px Consolas,monospace;letter-spacing:.12em;color:#ffd27a}#notes .nh .cnt{color:#a79c89;font-size:12px}
#notes .nh .sp{flex:1}#notes .nh button{padding:3px 9px;font-size:12px}
#notes.shut .nb{display:none}#notes .nb{overflow:auto;padding:0 12px 10px;min-height:0}
#notes .quick textarea,#notebox textarea{width:100%;min-height:52px;resize:vertical;background:#2c2824;color:#f3e6cf;border:1px solid #3a352f;border-radius:8px;padding:7px 9px;font:13px system-ui}
#notes .tt,#notebox .tt{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:12px;color:#a79c89;flex-wrap:wrap}
#notes .tt input,#notebox .tt input{width:66px;background:#2c2824;color:#f3e6cf;border:1px solid #3a352f;border-radius:6px;padding:4px 6px;font:12px Consolas,monospace}
#notes .tt button,#notebox .tt button{padding:3px 8px;font-size:12px}
.nt{border:1px solid #3a352f;border-radius:9px;padding:8px 9px;margin:7px 0;background:#24201c;cursor:pointer}.nt:hover{border-color:#5a5148}
.nt.done{opacity:.6}.nt.on{border-color:#ffd27a;box-shadow:0 0 0 1px #ffd27a55}
.nt .top{display:flex;gap:7px;align-items:baseline;font-size:12px;color:#a79c89}.nt .top .tm{font:600 12px Consolas,monospace;color:#ffd27a}
.nt .top .st{margin-left:auto;font:600 10px Consolas,monospace;padding:1px 6px;border-radius:9px;background:#5a4a1e;color:#ffe7b0}.nt.done .st{background:#24452c;color:#bff0c8}
.nt .tx{margin:4px 0 2px;white-space:pre-wrap;word-break:break-word}.nt .nab{font-size:12px;color:#a79c89}
.nt .rp{margin-top:6px;padding:6px 8px;border:1px solid #2f4a36;background:#1a2a1e;border-radius:6px;font-size:13px;white-space:pre-wrap}
.nt .rp i{font-style:normal;color:#7bd389;font:600 11px Consolas,monospace}
.nt .acts{display:none;gap:6px;margin-top:6px;flex-wrap:wrap}.nt.on .acts{display:flex}.nt .acts button{padding:3px 8px;font-size:12px}
#notes .dh{color:#a79c89;font-size:12px;margin:10px 0 2px;cursor:pointer}
#notebox{position:fixed;inset:0;background:#000a;z-index:3000;display:none;align-items:center;justify-content:center}
#notebox>div{background:#221f1b;border:1px solid #4a433b;border-radius:12px;padding:16px;width:min(520px,94vw);color:#f3e6cf;font:14px system-ui}
#notebox .chip{display:inline-block;background:#2c2824;border:1px solid #3a352f;border-radius:8px;padding:3px 8px;font-size:12px;color:#a79c89;margin:2px 0 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#notebox .kinds{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}#notebox .kinds button.on{background:#c4251a;border-color:#c4251a;color:#fff}
.nflag{position:absolute;bottom:1px;height:6px;border-radius:3px;background:#ffd27a;opacity:.85;cursor:pointer;z-index:3;min-width:6px}.nflag.done{background:#7bd389;opacity:.5}
.nflag:hover{opacity:1;height:9px}`;
  document.head.append(css);

  /* ---------- the dock ---------- */
  const dock = document.createElement('div'); dock.id = 'notes';
  try { if (localStorage.getItem('notesShut') === '1') dock.classList.add('shut'); } catch (e) {}
  dock.innerHTML = `<div class="nh"><b>NOTES</b><span class="cnt"></span><span class="sp"></span><button class="cpall" title="Copy all open notes of this reel, with where the reel is and how to change it: paste into any AI chat (Claude, opencode, DeepSeek, a local model)">⧉ Copy all for Claude</button><button class="add" title="A note at the red line (N)">+ Note</button><span class="fold">▾</span></div>
   <div class="nb"><div class="quick"><textarea placeholder="Type a note for Claude… e.g. this news page is boring, show the Reuters one"></textarea>
   <div class="tt">From <input data-k="t0" type="number" step="0.1" min="0"> to <input data-k="t1" type="number" step="0.1" min="0"> s
   <button data-k="here" title="From = the red line">⇤ red line</button><button data-k="loop" title="Use your I / O loop part">⟲ loop</button><span class="sp" style="flex:1"></span><button class="pri" data-k="save">Save note</button></div></div>
   <div class="list"></div></div>`;
  $('#side').append(dock);
  const nh = dock.querySelector('.nh'), quick = dock.querySelector('.quick'), qta = quick.querySelector('textarea');
  const qin = k => quick.querySelector(`[data-k=${k}]`);
  const fold = () => { dock.classList.toggle('shut'); dock.querySelector('.fold').textContent = dock.classList.contains('shut') ? '▸' : '▾'; try { localStorage.setItem('notesShut', dock.classList.contains('shut') ? '1' : '0'); } catch (e) {} };
  nh.onclick = e => { if (e.target.closest('button')) return; fold(); };
  dock.querySelector('.fold').textContent = dock.classList.contains('shut') ? '▸' : '▾';
  dock.querySelector('.cpall').onclick = () => copyAll();
  function copyAll() {               // his ask (LEDGER L451): one click = every open note + which reel, where it lives, how an AI changes it
    const open = NOTES.filter(n => n.state !== 'done').sort((a, b) => a.t0 - b.t0);
    if (!open.length) return toast('No open notes on this reel');
    const n0 = open[0], ed = location.origin;
    const s = [`Reel Editor notes: please do these ${open.length} change${open.length > 1 ? 's' : ''} on my reel.`, '',
      `Kit: ${n0.kit}   Reel: ${n0.reel}   (${total.toFixed(1)} s long)`, `Reel folder: ${n0.folder}`, `Open in the editor: ${n0.link.replace(/&t=[^&]*/, '')}`, '',
      'My notes (time on the reel, what I right-clicked, what I want):',
      ...open.map((n, i) => `${i + 1}. [${range(n)}] ${(KIND[n.kind] || KIND.note)[1]}${n.what ? ' · on: ' + n.what : ''}\n   "${n.text || (KIND[n.kind] || KIND.note)[1]}"   (note id ${n.id})`), '',
      'How to change it:',
      '- Claude chat: use the reel-editor tools (list_notes, get_reel, see_frame, set_sound / add_sound / set_keyframe / set_camera_keys ..., then resolve_note with a plain-words reply).',
      `- Any other AI: read AI-GUIDE.md in the GEditor folder, then use the web calls at ${ed} (send header X-Src with your name).`,
      '- My open editor shows each change at once; I can undo it. Change only what the notes ask. Tick each note done with a short reply.'].join('\n');
    const ok = () => toast(`Copied ${open.length} note${open.length > 1 ? 's' : ''}: paste into any AI chat`, 4000);
    try { navigator.clipboard.writeText(s).then(ok, () => prompt('Copy this:', s)); } catch (e) { prompt('Copy this:', s); }
    return s;
  }
  window.notesCopyAll = copyAll;
  dock.querySelector('.add').onclick = () => { if (dock.classList.contains('shut')) fold(); setQuick(t, t + 2); qta.focus(); };
  function setQuick(a, z) { qin('t0').value = f1(a); qin('t1').value = f1(Math.min(total, Math.max(a, z))); }
  qta.onfocus = () => { quick.classList.add('typing'); if (qin('t0').value === '') setQuick(t, t + 2); };
  quick.addEventListener('focusout', () => setTimeout(() => { if (!quick.contains(document.activeElement) && !qta.value.trim()) quick.classList.remove('typing'); }, 150));
  qin('here').onclick = () => { const l = +qin('t1').value - +qin('t0').value; setQuick(t, t + Math.max(0, l || 2)); };
  qin('loop').onclick = () => { if (loopA == null || loopB == null) return toast('Press I at the start and O at the end of the part first'); setQuick(loopA, loopB); };
  qin('save').onclick = async () => {
    const text = qta.value.trim(); if (!text) return toast('Type the note first');
    const r = await addNote({ text, t0: +qin('t0').value || 0, t1: +qin('t1').value || 0, kind: 'note', what: 'this part of the reel' });
    if (r) { qta.value = ''; qin('t0').value = ''; qin('t1').value = ''; quick.classList.remove('typing'); }
  };
  qta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) qin('save').click(); };

  async function addNote(b) {
    const r = await fetch('/api/notes/add', { method: 'POST', headers: { 'X-Src': 'editor' }, body: JSON.stringify(b) }).then(r => r.json()).catch(() => ({ error: 'the editor server did not answer' }));
    if (r.error) { toast(r.error); return null; }
    openId = r.id; await loadNotes(); toast('Note saved · any Claude chat can read it now', 3500); return r;
  }
  async function upd(b) { const r = await fetch('/api/notes/update', { method: 'POST', headers: { 'X-Src': 'editor' }, body: JSON.stringify(b) }).then(r => r.json()); if (r.error) toast(r.error); await loadNotes(); }
  async function delNote(id) { if (!confirm('Delete this note?')) return; await fetch('/api/notes/delete', { method: 'POST', headers: { 'X-Src': 'editor' }, body: JSON.stringify({ id }) }); await loadNotes(); }

  async function loadNotes() {
    try { NOTES = await api('/api/notes'); } catch (e) { return; }
    const j = JSON.stringify(NOTES); if (j === lastJSON) return; lastJSON = j; drawNotes(); renderTL();
  }
  function drawNotes() {
    const open = NOTES.filter(n => n.state !== 'done').sort((a, b) => a.t0 - b.t0), done = NOTES.filter(n => n.state === 'done').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    nh.querySelector('.cnt').textContent = `${open.length} open${done.length ? ' · ' + done.length + ' done' : ''}`;
    const L = dock.querySelector('.list'); L.innerHTML = '';
    if (!NOTES.length) L.innerHTML = '<div class="hint">No notes yet. Right-click anything (a sound, a news page, empty space, the preview) → <b>📝 Note about this…</b>, or press <b>N</b>.</div>';
    open.forEach(n => L.append(card(n)));
    if (done.length) {
      const h = document.createElement('div'); h.className = 'dh'; h.textContent = (showDone ? '▾ ' : '▸ ') + `Done (${done.length})`; h.onclick = () => { showDone = !showDone; drawNotes(); }; L.append(h);
      if (showDone) done.forEach(n => L.append(card(n)));
    }
  }
  function card(n) {
    const c = document.createElement('div'); c.className = 'nt' + (n.state === 'done' ? ' done' : '') + (n.id === openId ? ' on' : ''); c.dataset.id = n.id;
    const [ic, kn] = KIND[n.kind] || KIND.note;
    c.innerHTML = `<div class="top"><span class="tm">${range(n)}</span><span>${ic} ${kn}</span><span class="st">${n.state === 'done' ? 'DONE' : 'OPEN'}</span></div>
      ${n.text ? `<div class="tx">${esc(n.text)}</div>` : ''}${n.what ? `<div class="nab">on: ${esc(n.what)}</div>` : ''}
      ${n.reply ? `<div class="rp"><i>${esc(n.replyBy || 'Claude')}:</i> ${esc(n.reply)}</div>` : ''}
      <div class="acts"><button data-a="play">▶ Play this part</button><button data-a="state">${n.state === 'done' ? '↺ Open again' : '✓ Done'}</button><button data-a="copy" title="Copy the note with its reel, time and link, to paste into any AI chat">⧉ Copy for a chat</button><button data-a="del">🗑</button></div>`;
    c.onclick = e => {
      const a = e.target.closest('button') && e.target.closest('button').dataset.a;
      if (!a) { openId = openId === n.id ? null : n.id; drawNotes(); play(false); seek(n.t0 + 0.01); follow && follow(); return; }
      if (a === 'play') playRange(n.t0, Math.max(n.t1, n.t0 + 1));
      if (a === 'state') upd({ id: n.id, state: n.state === 'done' ? 'open' : 'done' });
      if (a === 'del') delNote(n.id);
      if (a === 'copy') { const s = `Reel Editor note ${n.id} (${n.kit} / ${n.reel}, ${range(n)}): ${n.text || kn}${n.what ? ' [on: ' + n.what + ']' : ''}\nFolder: ${n.folder}\nEditor: ${n.link}`; try { navigator.clipboard.writeText(s); toast('Copied: paste it into any AI chat'); } catch (er) { prompt('Copy this:', s); } }
    };
    return c;
  }
  function showNote(id) { openId = id; if (dock.classList.contains('shut')) fold(); const n = NOTES.find(x => x.id === id); if (n && n.state === 'done') showDone = true; drawNotes(); const el = dock.querySelector(`.nt[data-id="${id}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }

  /* ---------- note flags on the ruler ---------- */
  const _rn = renderNow;
  renderNow = function () {
    _rn();
    const rc = document.querySelector('#tlin .row.ruler .rc'); if (!rc) return;
    NOTES.forEach(n => {
      const f = document.createElement('div'); f.className = 'nflag' + (n.state === 'done' ? ' done' : ''); f.style.left = X(n.t0) + 'px'; f.style.width = Math.max(6, X(n.t1 - n.t0)) + 'px';
      f.title = `${range(n)}  ${(KIND[n.kind] || KIND.note)[1]}: ${n.text || ''}${n.reply ? '\n' + (n.replyBy || 'Claude') + ': ' + n.reply : ''}`;
      f.onpointerdown = e => { e.stopPropagation(); showNote(n.id); seek(n.t0 + 0.01); }; rc.append(f);
    });
  };

  /* ---------- the note box (from a right-click) ---------- */
  const box = document.createElement('div'); box.id = 'notebox'; box.innerHTML = '<div></div>'; document.body.append(box);
  box.onclick = e => { if (e.target === box) box.style.display = 'none'; };
  function openBox(o) {
    const inner = box.firstChild; let kind = o.kind || 'change';
    inner.innerHTML = `<h3 style="margin:0 0 4px">📝 Note about this</h3><div class="chip" title="${esc(o.what || '')}">${esc(o.what || 'this part of the reel')}</div>
      <div class="kinds">${Object.entries(KIND).map(([k, [ic, n]]) => `<button data-kind="${k}" class="${k === kind ? 'on' : ''}">${ic} ${n}</button>`).join('')}</div>
      <textarea placeholder="What should happen here? e.g. from here the camera should zoom into the headline"></textarea>
      <div class="tt">From <input data-k="t0" type="number" step="0.1" min="0" value="${f1(o.t0)}"> to <input data-k="t1" type="number" step="0.1" min="0" value="${f1(o.t1)}"> s
      ${loopA != null && loopB != null ? '<button data-k="loop">⟲ use my loop</button>' : ''}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button data-k="no">Cancel</button><button class="pri" data-k="ok">Save note</button></div>`;
    box.style.display = 'flex'; const ta = inner.querySelector('textarea'); ta.focus();
    inner.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { kind = b.dataset.kind; inner.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x === b)); if (kind === 'need-audio' && !ta.value) ta.value = 'I need a sound here: '; ta.focus(); });
    const lb = inner.querySelector('[data-k=loop]'); if (lb) lb.onclick = () => { inner.querySelector('[data-k=t0]').value = f1(loopA); inner.querySelector('[data-k=t1]').value = f1(loopB); };
    inner.querySelector('[data-k=no]').onclick = () => box.style.display = 'none';
    const save = async () => {
      const text = ta.value.trim(); if (!text && kind !== 'like') return toast('Type what you want first');
      const r = await addNote({ text, kind, key: o.key || '', what: o.what || '', t0: +inner.querySelector('[data-k=t0]').value || 0, t1: +inner.querySelector('[data-k=t1]').value || 0 });
      if (r) { box.style.display = 'none'; showNote(r.id); }
    };
    inner.querySelector('[data-k=ok]').onclick = save; ta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); if (e.key === 'Escape') box.style.display = 'none'; };
  }

  /* ---------- right-click anything ---------- */
  const ROWKIND = { 's:': 'sound', 'a:': 'added', 'p:': 'piece', 'b:': 'line', 'c:': 'camera', 'k:': 'caption', 'f:': 'face' };
  function aboutBlock(d) {
    const k = d.dataset.k || '', a = parseFloat(d.style.left) / (pps || 1), z = a + parseFloat(d.style.width) / (pps || 1);
    const lb = (d.querySelector('.lb') || d).textContent.trim().replace(/\s+/g, ' ').slice(0, 90), kind = ROWKIND[k.slice(0, 2)] || 'block';
    let what = `${kind}: ${lb}`;
    if (k.startsWith('s:') && d._o) what = `sound: ${typeof sndName === 'function' ? sndName(d._o) : lb} (id ${d._o.id})`;
    if (k.startsWith('b:')) what = `line ${+k.slice(2) + 1}: ${lb}`;
    if (k.startsWith('c:')) what = `camera of line ${+k.slice(2) + 1}: ${lb}`;
    if (k.startsWith('p:')) what = `on screen (${k.slice(2)}): ${lb}`;
    return { key: k, what, t0: a, t1: z };
  }
  function aboutEmpty(e) {
    const row = e.target.closest('#tlin .row'), rn = row ? ((row.querySelector('.rh b') || {}).textContent || row.dataset.row || '') : '';
    const tt = row && e.target.closest('.rh') ? t : timeAt(e.clientX);
    if (loopA != null && loopB != null && loopB > loopA && tt >= loopA - 0.01 && tt <= loopB + 0.01) return { key: 'loop', what: `the loop part${rn ? ' (' + rn.toLowerCase() + ' row)' : ''}`, t0: loopA, t1: loopB };
    return { key: row ? 'row:' + (row.dataset.row || rn) : 'time', what: rn ? `the ${rn.toLowerCase()} row at ${f1(tt)} s` : `the reel at ${f1(tt)} s`, t0: tt, t1: Math.min(total, tt + 2) };
  }
  let marksBefore = 0;
  document.addEventListener('contextmenu', () => { marksBefore = marks.length; }, true);
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('#notebox, #askbox, input, textarea, select')) return;
    const inTL = e.target.closest('#tlin'), inSide = e.target.closest('#side'), inStage = e.target.closest('#stage');
    if (!inTL && !inStage && !inSide) return;
    e.preventDefault();
    let o; const kd = e.target.closest('#tlin .kd'), d = e.target.closest('#tlin .blk');
    if (kd) { const [n, p] = (kd.dataset.ks || '').split('|'); const tk = timeAt(kd.getBoundingClientRect().left + 6); o = { key: 'key:' + kd.dataset.ks, what: `the ${(typeof PROP_NAMES === 'object' && PROP_NAMES[p]) || p} key of ${n} at ${f1(tk)} s`, t0: tk, t1: tk }; }
    else if (d) o = aboutBlock(d);
    else if (inStage) o = { key: 'preview', what: `the picture at ${f1(t)} s`, t0: t, t1: Math.min(total, t + 2) };
    else if (inSide) o = { key: 'time', what: `the reel at ${f1(t)} s`, t0: t, t1: Math.min(total, t + 2) };
    else o = aboutEmpty(e);
    setTimeout(() => {                  // after the editor's and the Studio's own menus are made
      if (e.target.closest('#tlin .ruler') && marks.length < marksBefore) return;        // he just removed a marker
      const item = ['📝  Note about this…', () => openBox(o)];
      let m = document.getElementById('ctx');
      if (!m) return menuAt(e.clientX, e.clientY, [item, ...(loopA != null && loopB > loopA && o.key !== 'loop' ? [['📝  Note for my loop part ' + f1(loopA) + '–' + f1(loopB) + ' s…', () => openBox({ key: 'loop', what: 'the loop part', t0: loopA, t1: loopB })]] : [])]);
      m.append(document.createElement('hr')); const b = document.createElement('button'); b.textContent = item[0]; b.onclick = () => { closeMenu(); item[1](); }; m.append(b);
      const r = m.getBoundingClientRect(); if (r.bottom > innerHeight - 6) m.style.top = Math.max(6, innerHeight - r.height - 6) + 'px';
    }, 0);
  });
  pv.addEventListener('load', () => {             // right-click inside the preview picture too
    try { cw().document.addEventListener('contextmenu', e => { e.preventDefault(); const r = pv.getBoundingClientRect(), s = r.width / 1080; menuAt(r.left + e.clientX * s, r.top + e.clientY * s, [['📝  Note about this picture…', () => openBox({ key: 'preview', what: `the picture at ${f1(t)} s` + (e.target && e.target.textContent ? ` (near “${e.target.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)}”)` : ''), t0: t, t1: Math.min(total, t + 2) })]]); }); } catch (er) {}
  });
  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || document.activeElement.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); const lp = loopA != null && loopB > loopA && t >= loopA && t <= loopB; openBox(lp ? { key: 'loop', what: 'the loop part', t0: loopA, t1: loopB } : { key: 'time', what: `the reel at ${f1(t)} s`, t0: t, t1: Math.min(total, t + 2), kind: 'note' }); }
  });

  /* ---------- an AI changed the reel: show it at once, Ctrl+Z puts it back ---------- */
  async function applyRemote(c) {
    if (c.what === 'notes') { await loadNotes(); return toast(`${c.by} ${c.msg}`, 5000); }
    hist(); const oldK = JSON.stringify(KITK);
    HIS.quiet = true;
    try {
      sounds = await api('/api/sounds'); try { files = await api('/api/soundfiles'); } catch (e) {}
      items = await api('/api/edits'); try { cw().setItems(items); } catch (e) {}
      added = await api('/api/added'); pushAdded(); await loadMarks(); await loadKitKeys();
      KBASE = await api('/api/timeline'); fromTheatre(KBASE); applyKeys();
      if (window.flowCaps) await flowCaps.reload();
      SEL.clear(); selSnd = null; if (!added.some(a => a.id === selAdd)) selAdd = null;
    } finally { HIS.quiet = false; }
    HIS.tm = 0; hist(); undoBtns(); renderTL(); draw(); loadWaves(); if (playing) audioStart();
    if (c.what === 'camkey' || (!c.reload && JSON.stringify(KITK) !== oldK)) liveKit(); else if (c.reload) reloadPreview();   // camera keys: no re-open (L462)
    await loadNotes();
    toast(`${c.by} changed: ${c.msg} · Ctrl+Z puts it back`, 6000);
  }
  async function watch() {
    try {
      const c = await api('/api/ai/changes');
      if (!watch.reel) watch.reel = c.kit + '/' + c.reel;
      else if (watch.reel !== c.kit + '/' + c.reel) { toast('Another reel was opened (' + c.kit + ' / ' + c.reel + '): switching to it…', 4000); return setTimeout(() => location.reload(), 1500); }   // never save this reel's edits into another reel
      if (seenChg === null) seenChg = c.n; else if (c.n !== seenChg) { seenChg = c.n; await applyRemote(c); }
    } catch (e) {}
    setTimeout(watch, 1500);
  }

  /* ---------- tell the server what the editor sees (for an AI reading the reel) ---------- */
  const _it = initTheatre;
  initTheatre = async function () {
    await _it();
    try {
      const lines = beats.map((b, i) => ({ i, n: i + 1, t0: +(+b.t0).toFixed(2), dur: +(+b.dur).toFixed(2), line: b.line || b.text || b.say || '', move: b.move_name || b.move || '', main: b.main || '', kind: b.kind || '' }));
      const objects = Object.entries(DEFS).map(([k, d]) => ({ key: k, object: d.name, kind: d.kind, props: Object.keys(PROPS[k] || {}) }));
      post('/api/ai/seen', { total, lines, objects });
    } catch (e) {}
  };

  /* ---------- a link with ?kit=&reel=&t= opens that reel at that second (the link in every note) ---------- */
  (async function () {
    const q = new URLSearchParams(location.search);
    if (q.get('kit') && q.get('reel')) {
      const st = await api('/api/state');
      if (st.kit !== q.get('kit') || st.reel !== q.get('reel')) { await post('/api/open', { kit: q.get('kit'), reel: q.get('reel') }); location.replace('/?t=' + (q.get('t') || 0)); return; }
    }
    const at = +q.get('t') || 0;
    if (at) { let done = false; pv.addEventListener('load', () => { if (done) return; done = true; setTimeout(() => { seek(at); try { follow(); } catch (e) {} }, 900); }); }
  })();

  loadNotes(); watch(); setInterval(loadNotes, 5000);
})();

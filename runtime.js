/* Reel Editor runtime: lives INSIDE the reel page (live preview AND the exported video use this same file).
   It is kit-neutral. A kit plugs in with a manifest (adapters/<kit>.json) and, if it has a look to edit, a theme script.
   Reel page contract (all a kit needs):  window.at(ms) freezes a frame,  window.TOTAL = seconds,
   and the editable things are found by the manifest's pieceSelector (or any element with data-edit).
     window.applyEdit(theme)   repaints the look + the fixed moves at once (no render)
     window.paintTL()          repaints the keyframed change coming from the timeline (translate / rotate / scale, never touches the kit's own transform)
     edit mode (?edit=1)       click a piece and drag it, tells the editor page what was picked */
(function () {
  'use strict';
  const M = window.EDIT_MANIFEST || {};
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const Q = new URLSearchParams(location.search);
  const PIECE = M.pieceSelector || '[data-edit]';
  const CAMERA = M.cameraSelectors || [];
  // small things inside a piece that are their own objects (Blueprint: the pin), LEDGER L456. A kit can also mark them itself:
  // data-layer="<kind>" data-lid="<kind>:<card id>" (Blueprint kit/layers.py, LEDGER L480); those are parts too, with their own timeline row
  const PART_SEL = M.partSelectors || [];
  const PARTS = PART_SEL.concat('[data-lid]').join(',');
  const CAPTION = M.captionSelectors || [];
  window.TL = {};          // timeline values: { key: {dx,dy,scale,rot} }, 'camera': {dx,dy,zoom}, 'captions': {dy,scale}
  let current = null;

  /* ---------- pieces: a stable key for each, remember where it started ---------- */
  function pieces() {
    const els = $$(PIECE);
    els.forEach((el, i) => {
      if (!el.dataset.ek) { el.dataset.ek = 'p' + i; el.dataset.ox = parseFloat(el.style.left) || 0; el.dataset.oy = parseFloat(el.style.top) || 0; el.dataset.ow = parseFloat(el.style.width) || 0; }
    });
    return els;
  }
  function label(el) {   // a readable name for the timeline panel
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22);
    const c = (el.className && String(el.className).split(' ')[0]) || el.tagName.toLowerCase();
    return t ? `${el.dataset.ek} ${c}: ${t}` : `${el.dataset.ek} ${c}`;
  }
  /* layers: every part gets a stable id. A kit that marks them (data-lid) wins; an older reel gets the same id the kit would give:
     "<part name>:<its card's data-id>" (a second one on the same card gets ".2") */
  function layerEls() {
    if (PART_SEL.length) {
      const seen = {};
      $$(PART_SEL.join(',')).forEach((el, i) => {
        if (el.dataset.lid) return;
        const kind = ((M.partNames && M.partNames[0]) || 'part').toLowerCase(), card = el.closest('[data-id]');
        const base = `${kind}:${card ? card.dataset.id : 'c' + i}`, n = seen[base] = (seen[base] || 0) + 1;
        el.dataset.layer = el.dataset.layer || kind; el.dataset.lid = base + (n > 1 ? '.' + n : '');
      });
    }
    return $$('[data-lid]').filter(el => !isUI(el));
  }
  const layerName = el => { const k = el.dataset.layer || 'part'; return k.charAt(0).toUpperCase() + k.slice(1); };
  window.editLayers = () => layerEls().map(el => ({ key: el.dataset.lid, kind: el.dataset.layer || 'part', name: layerName(el) + ' · ' + el.dataset.lid.split(':').slice(1).join(':') }));
  window.editKeys = () => pieces().map(e => e.dataset.ek);
  window.editLabels = () => Object.fromEntries(pieces().map(e => [e.dataset.ek, label(e)]));

  /* ---------- fixed moves (set by dragging / sliders, same for the whole reel) ---------- */
  function paintMoves(t) {
    const Mv = t.moves || {};
    pieces().forEach(el => {
      const m = Mv[el.dataset.ek] || {};
      el.style.left = (+el.dataset.ox + (m.dx || 0)) + 'px';
      el.style.top = (+el.dataset.oy + (m.dy || 0)) + 'px';
      if (el.dataset.ow) el.style.width = (+el.dataset.ow * (m.scale || 1)) + 'px';
    });
  }
  /* ---------- keyframed change from the timeline: only the separate CSS properties, so the kit's own animation is untouched ---------- */
  function paintTL() {
    const T = window.TL;
    pieces().forEach(el => {
      const d = T[el.dataset.ek]; if (!d) return;
      el.style.translate = d.dx || d.dy ? `${d.dx || 0}px ${d.dy || 0}px` : '';
      el.style.rotate = d.rot ? d.rot + 'deg' : '';
      el.style.scale = d.scale !== undefined && d.scale !== 1 ? String(d.scale) : '';
    });
    const c = T.camera;
    if (c) CAMERA.forEach(sel => $$(sel).forEach(el => { el.style.translate = c.dx || c.dy ? `${c.dx || 0}px ${c.dy || 0}px` : ''; el.style.scale = c.zoom && c.zoom !== 1 ? String(c.zoom) : ''; }));
    const k = T.captions;
    if (k) CAPTION.forEach(sel => $$(sel).forEach(el => { el.style.translate = k.dy ? `0px ${k.dy}px` : ''; el.style.scale = k.scale && k.scale !== 1 ? String(k.scale) : ''; }));
  }
  window.paintTL = paintTL;

  window.applyEdit = function (t) {
    current = t;
    if (typeof window.EDIT_THEME_HOOK === 'function') window.EDIT_THEME_HOOK(t);
    paintMoves(t); paintTL();
  };
  window.getEdit = () => current;

  window.EDIT_PROPS = (types, kind) => kind === 'camera' ? { dx: types.number(0, { range: [-600, 600] }), dy: types.number(0, { range: [-600, 600] }), zoom: types.number(1, { range: [0.5, 2.5] }) }
    : kind === 'captions' ? { dy: types.number(0, { range: [-400, 400] }), scale: types.number(1, { range: [0.4, 2] }) }
    : { dx: types.number(0, { range: [-600, 600] }), dy: types.number(0, { range: [-600, 600] }), scale: types.number(1, { range: [0.2, 2.5] }), rot: types.number(0, { range: [-180, 180] }) };
  /* ---------- the same animation file drives the exported video: read it with Theatre's core and follow window.at ---------- */
  let tick = null;
  if (window.EDIT_TIMELINE && window.THC && Object.keys(window.EDIT_TIMELINE).length) try {
    const { getProject, types } = window.THC;
    const project = getProject('Reel', { state: window.EDIT_TIMELINE });
    const sheet = project.sheet('Main');
    const defs = window.EDIT_OBJECTS || {};
    const objs = {};
    pieces(); Object.keys(defs).forEach(k => { objs[k] = sheet.object(defs[k].name, window.EDIT_PROPS(types, defs[k].kind)); });
    tick = ms => { sheet.sequence.position = ms / 1000; Object.keys(objs).forEach(k => { window.TL[k] = objs[k].value; }); };
  } catch (e) { console.warn('keyframes skipped:', e.message); }   // a broken animation file must not stop the rest of his edits
  /* after every frame: keyframes, then his clicked-and-changed things (the kit may have redrawn them) */
  const finish = () => { paintTL(); applyItems(); paintAdded(); drawBox(); };
  if (!window.REMOTION_BRIDGE && typeof window.at === 'function') {          // page kits: at() exists now
    const origAt = window.at;
    window.at = function (ms) { curMs = ms; if (tick) tick(ms); const r = origAt(ms); if (r && r.then) return r.then(v => { finish(); return v; }); finish(); return r; };
  } else {                                        // Remotion kits: the bridge calls this after each frame is drawn
    window.__editAfterAt = ms => { curMs = ms; pieces(); if (tick) tick(ms); finish(); };
  }

  /* ---------- click anything: a changed text / picture is found again on every frame by its words + where it sits ---------- */
  window.EDIT_ITEMS = window.EDIT_ITEMS || [];
  const own = el => { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim(); };
  const desc = el => el.tagName.toLowerCase() + (el.classList && el.classList[0] ? '.' + el.classList[0] : '');
  const chain = el => { const c = []; let n = el; for (let i = 0; i < 6 && n && n !== document.body; i++, n = n.parentElement) c.push(desc(n)); return c; };
  const isUI = el => el.closest && el.closest('#edit-layer, #add-layer');
  const ORIG = new WeakMap();   // what the kit had before we changed it, so "put it back" is exact
  let touched = [];
  const textNode = el => [...el.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
  function sigOf(el) {
    if (el.dataset && el.dataset.lid) return { lid: el.dataset.lid, text: '', chain: chain(el), n: 0, tag: el.tagName };   // a layer: found by its id, never by position
    const text = own(el), ch = chain(el);
    const same = $$('body *').filter(x => !isUI(x) && (text ? own(x) === text : !own(x) && x.tagName === el.tagName) && chain(x).join('>') === ch.join('>'));
    return { text, chain: ch, n: Math.max(0, same.indexOf(el)), tag: el.tagName };
  }
  function findSig(sig, alt) {
    if (sig.lid) { const hit = document.querySelector(`[data-lid="${CSS.escape(sig.lid)}"]`); if (hit) return hit; layerEls(); return document.querySelector(`[data-lid="${CSS.escape(sig.lid)}"]`); }
    const texts = [sig.text, alt].filter(x => x !== undefined && x !== null);
    const key = sig.chain.join('>');
    const c = $$('body *').filter(x => !isUI(x) && (sig.text ? texts.includes(own(x)) : (x.tagName === sig.tag && !own(x))));
    const exact = c.filter(x => chain(x).join('>') === key);
    if (exact.length) return exact[Math.min(sig.n, exact.length - 1)];
    if (!sig.text) return null;
    let best = null, bs = 0;
    c.forEach(x => { const ch = chain(x); let s = 0; for (let i = 0; i < ch.length; i++) if (ch[i] === sig.chain[i]) s++; if (s > bs) { bs = s; best = x; } });
    return bs >= 2 ? best : null;
  }
  window.findSig = findSig;
  const PROPS = ['color', 'fontFamily', 'fontWeight', 'translate', 'scale', 'visibility', 'background'];
  // a part's own colour (a pin): same round shine as the kit's pin, in his colour
  const fillOf = c => `radial-gradient(circle at 35% 35%, color-mix(in srgb, ${c} 45%, white), ${c} 70%)`;
  function restore(el) {
    const o = ORIG.get(el); if (!o) return;
    PROPS.forEach(k => el.style[k] = o.style[k]);
    if (o.texts) { const tns = [...el.childNodes].filter(n => n.nodeType === 3); if (tns.length === o.texts.length) tns.forEach((n, i) => { if (n.nodeValue !== o.texts[i]) n.nodeValue = o.texts[i]; }); }
    ORIG.delete(el); delete el.dataset.eid;
  }
  function applyItems() {
    const now = [];
    (window.EDIT_ITEMS || []).forEach(it => {
      const el = it._el && it._el.isConnected && it._el.dataset.eid === it.id ? it._el : findSig(it.sig, it.text); if (!el) return;
      try { Object.defineProperty(it, '_el', { value: el, writable: true, configurable: true, enumerable: false }); } catch (e) {}   // found once, reused every frame (never saved)
      if (!ORIG.has(el)) { const st = {}; PROPS.forEach(k => st[k] = el.style[k]); const tns = [...el.childNodes].filter(n => n.nodeType === 3); ORIG.set(el, { style: st, texts: tns.map(n => n.nodeValue), text: tns.map(n => n.nodeValue).join('') }); }
      const o = ORIG.get(el); now.push(el); el.dataset.eid = it.id;
      if (it.text !== undefined && it.text !== null) {
        // his words go in the first piece of text; the kit's other loose text bits in the same element are emptied
        const tns = [...el.childNodes].filter(n => n.nodeType === 3), first = tns.find(n => n.nodeValue.trim());
        if (first) { const lead = (first.nodeValue.match(/^\s*/) || [''])[0], v = lead + it.text; if (first.nodeValue !== v) first.nodeValue = v; tns.forEach(n => { if (n !== first && n.nodeValue.trim()) n.nodeValue = ' '; }); }
      }
      el.style.color = it.color || o.style.color;
      el.style.fontFamily = it.font ? `"${it.font}"` : o.style.fontFamily;
      el.style.fontWeight = it.weight || o.style.fontWeight;
      el.style.translate = it.dx || it.dy ? `${it.dx || 0}px ${it.dy || 0}px` : o.style.translate;
      el.style.scale = it.size && it.size !== 1 ? String(it.size) : o.style.scale;
      el.style.visibility = it.hide ? 'hidden' : o.style.visibility;
      el.style.background = it.fill ? fillOf(it.fill) : o.style.background;
    });
    touched.filter(el => !now.includes(el)).forEach(restore);
    touched = now;
  }
  window.applyItems = applyItems;
  // the kit can redraw a piece at any moment (Remotion re-mounts parts between frames): put his changes back before the next paint
  let busyApply = false;
  new MutationObserver(() => {
    if (busyApply || !(window.EDIT_ITEMS || []).length) return;
    busyApply = true; try { applyItems(); } finally { busyApply = false; }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  /* ---------- things he ADDS (captions, text, photos / memes, news cards): drawn on top of any kit's reel, same code for the preview and the video ---------- */
  window.EDIT_ADDED = window.EDIT_ADDED || [];
  let curMs = 0, addLayerEl = null; const addSig = new WeakMap();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kitColor = (k, d) => (current && current.colors && current.colors[k]) || (window.EDIT_THEME && window.EDIT_THEME.colors && window.EDIT_THEME.colors[k]) || d;
  const ease = x => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
  const back = x => { x = Math.max(0, Math.min(1, x)); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  function addLayer() {
    if (addLayerEl && addLayerEl.isConnected) return addLayerEl;
    addLayerEl = document.createElement('div'); addLayerEl.id = 'add-layer';
    addLayerEl.style.cssText = 'position:fixed;left:0;top:0;width:1080px;height:1920px;pointer-events:none;z-index:2147480000;overflow:hidden';
    document.body.append(addLayerEl); return addLayerEl;
  }
  // caption looks: plain HTML + inline style, so the video shows exactly what the preview shows
  const CAP_STYLES = {
    headline: { name: 'Headline + handwriting', f: 'DM Serif Display, Georgia, serif', f2: 'Caveat, Segoe Script, cursive', w: 400 },
    marker:   { name: 'Marker highlight', f: 'Impact, Anton, Arial Black, sans-serif', f2: 'Impact, Anton, Arial Black, sans-serif', w: 400 },
    type:     { name: 'Typewriter label', f: 'IBM Plex Mono, Consolas, Courier New, monospace', f2: 'IBM Plex Mono, Consolas, Courier New, monospace', w: 700 },
    sticker:  { name: 'Sticker', f: 'Arial Black, Segoe UI, sans-serif', f2: 'Arial Black, Segoe UI, sans-serif', w: 900 },
    outline:  { name: 'Outline pop', f: 'Arial Black, Segoe UI, sans-serif', f2: 'Arial Black, Segoe UI, sans-serif', w: 900 },
    clean:    { name: 'Clean bold', f: 'Inter, Segoe UI, Arial, sans-serif', f2: 'Inter, Segoe UI, Arial, sans-serif', w: 800 },
  };
  window.CAP_STYLES = CAP_STYLES;

  /* ---------- BRAND (LEDGER L481, his pick: GauthamWho, "Captions + text look"): the kit's own captions + everything he adds
     switch to the brand's fonts and colours. Same code in the preview and the video file. ---------- */
  let BRAND = window.EDIT_BRAND || null;
  function brandCSS() {
    let st = document.getElementById('brand-style');
    if (!BRAND) { if (st) st.remove(); return; }
    if (BRAND.fontsCss && !document.getElementById('brand-fonts')) { const l = document.createElement('link'); l.id = 'brand-fonts'; l.rel = 'stylesheet'; l.href = BRAND.fontsCss; document.head.append(l); }
    if (!st) { st = document.createElement('style'); st.id = 'brand-style'; document.head.append(st); }
    const c = BRAND.caption || {}, hi = ':not(#_b1):not(#_b2)';   // stronger than the kit's own caption rules
    const sels = CAPTION.flatMap(s => [s + hi, s + ' *' + hi]).join(',');
    const stress = M.captionStress ? CAPTION.map(s => `${s} ${M.captionStress}${hi}`).join(',') : '';
    st.textContent = !sels ? '' : `${sels}{font-family:'${c.font}',Inter,'Segoe UI',sans-serif!important;font-weight:${c.weight || 900}!important;${c.upper ? 'text-transform:uppercase!important;' : ''}letter-spacing:${c.track || 0}em!important;color:${c.color}!important;font-style:normal!important;${c.shadow ? `text-shadow:${c.shadow}!important;` : ''}}`
      + (stress ? `${stress}{color:${c.stress}!important}` : '');
  }
  window.setBrand = b => { BRAND = b || null; brandCSS(); paintAdded(); };
  const brandFont = () => BRAND && BRAND.caption ? `'${BRAND.caption.font}', Inter, 'Segoe UI', sans-serif` : null;
  function words(a) {      // [{w, s}] ; *star* marks the stress word, else the last word for looks that use one
    const out = String(a.text || '').trim().split(/\s+/).filter(Boolean).map(w => ({ w: w.replace(/\*/g, ''), s: w.includes('*') }));
    if (out.length && !out.some(x => x.s) && ['headline', 'marker', 'type'].includes(a.style)) out[out.length - 1].s = true;
    return out;
  }
  function capHTML(a) {
    const S = CAP_STYLES[a.style] || CAP_STYLES.headline, col = a.color || '#ffffff', st = a.stress || kitColor('stress', '#ff4a3a'), fs = a.fs || 84;
    const ws = words(a), n = ws.length || 1;
    if (a.style === 'brand' && BRAND && BRAND.caption) {        // his brand's caption: heavy UPPERCASE, accent word in the brand colour
      const c = BRAND.caption, cc = a.color || c.color, sc = a.stress || c.stress;
      return ws.map((x, i) => `<span class="add-w" data-i="${i}" data-n="${n}" style="display:inline-block;margin:.04em .14em;white-space:nowrap;font-family:${brandFont()};font-weight:${c.weight || 900};font-size:${fs}px;line-height:1.02;letter-spacing:${c.track || 0}em;${c.upper ? 'text-transform:uppercase;' : ''}color:${x.s ? sc : cc};text-shadow:${c.shadow || 'none'}">${esc(x.w)}</span>`).join(' ');
    }
    return ws.map((x, i) => {
      let css = `display:inline-block;margin:.06em .16em;white-space:nowrap;font-family:${S.f};font-weight:${S.w};font-size:${fs}px;line-height:1.05;color:${col};`;
      if (a.style === 'headline') { css += 'text-shadow:0 4px 18px rgba(0,0,0,.55);'; if (x.s) css += `font-family:${S.f2};font-size:${fs * 1.35}px;color:${st};font-weight:700;border-bottom:7px solid ${st};transform:rotate(-3deg);`; }
      else if (a.style === 'marker') { css += 'text-transform:uppercase;text-shadow:0 4px 14px rgba(0,0,0,.5);'; if (x.s) css += `background:${st};color:#fff;padding:0 .2em;transform:rotate(-2deg);`; }
      else if (a.style === 'type') { css += 'background:#000a;padding:.05em .25em;'; if (x.s) css += `background:${st};color:#fff;`; }
      else if (a.style === 'sticker') { css += `background:${a.bg || '#fff'};color:#111;padding:.08em .3em;border-radius:.25em;box-shadow:0 6px 0 #0006;transform:rotate(${i % 2 ? 2 : -2}deg);`; if (x.s) css += `background:${st};color:#fff;`; }
      else if (a.style === 'outline') { css += `color:transparent;-webkit-text-stroke:5px ${col};text-shadow:0 6px 18px rgba(0,0,0,.45);`; if (x.s) css += `color:${st};-webkit-text-stroke:0;`; }
      else css += 'text-shadow:0 5px 16px rgba(0,0,0,.6);' + (x.s ? `color:${st};` : '');
      return `<span class="add-w" data-i="${i}" data-n="${n}" style="${css}">${esc(x.w)}</span>`;
    }).join(' ');
  }
  function cardHTML(a) {
    const bc = BRAND && BRAND.card || {};
    const paper = a.bg || bc.bg || kitColor('card', '#f4ecd8'), ink = a.color || bc.ink || kitColor('inkLight', '#1c1a17'), pin = bc.pin || kitColor('pin', '#c4251a');
    return `<div style="position:relative;width:${a.w || 760}px;background:${paper};color:${ink};padding:44px 46px 40px;box-shadow:0 22px 50px rgba(0,0,0,.45),0 3px 0 rgba(0,0,0,.12);border-radius:3px">
      <div style="position:absolute;left:50%;top:-18px;width:38px;height:38px;margin-left:-19px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff9 0,${pin} 40%,#000a 130%);box-shadow:0 6px 10px #0007"></div>
      ${a.source ? `<div style="font:700 26px/1 'IBM Plex Mono',Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:16px">${esc(a.source)}</div>` : ''}
      <div style="font:400 ${a.fs || 66}px/1.08 'DM Serif Display',Georgia,serif">${esc(a.text)}</div>
      ${a.body ? `<div style="font:400 32px/1.35 Georgia,serif;margin-top:20px;opacity:.82">${esc(a.body)}</div>` : ''}</div>`;
  }
  function photoHTML(a) {
    const w = a.w || 640, frame = a.frame !== false;
    return `<div style="width:${w}px;background:${frame ? (a.bg || kitColor('card', '#f4ecd8')) : 'transparent'};padding:${frame ? '22px 22px 26px' : 0};box-shadow:${frame ? '0 22px 50px rgba(0,0,0,.45)' : 'none'};border-radius:3px">
      <img src="${esc(a.src)}" style="display:block;width:100%;height:auto;max-height:1500px;object-fit:contain"></div>`;
  }
  function textHTML(a) {
    const bt = BRAND && BRAND.text || null, bgc = a.bg || (bt && bt.bg), up = bt && BRAND.caption && BRAND.caption.upper ? 'text-transform:uppercase;letter-spacing:' + (BRAND.caption.track || 0) + 'em;' : '';
    const bg = bgc ? `background:${bgc};padding:.15em .4em;border-radius:.2em;` : '';
    return `<div style="max-width:${a.w || 900}px;text-align:${a.align || 'center'};font-family:${a.font ? esc(a.font) : bt ? brandFont() : 'Inter, Segoe UI, Arial, sans-serif'};font-weight:${a.weight || (bt && bt.weight) || 800};font-size:${a.fs || 80}px;line-height:1.1;color:${a.color || (bt && bt.color) || '#fff'};${up}${bg}text-shadow:${bgc ? 'none' : '0 5px 16px rgba(0,0,0,.6)'}">${esc(a.text).replace(/\n/g, '<br>')}</div>`;
  }
  function addBody(a) { return a.type === 'caption' ? `<div style="text-align:center;max-width:${a.w || 940}px">${capHTML(a)}</div>` : a.type === 'card' ? cardHTML(a) : a.type === 'photo' ? photoHTML(a) : textHTML(a); }
  function paintAdded() {
    const sec = curMs / 1000, L = addLayer(), list = window.EDIT_ADDED || [], ids = new Set(list.map(a => a.id));
    [...L.children].forEach(c => { if (!ids.has(c.dataset.id)) c.remove(); });
    list.forEach(a => {
      let el = L.querySelector(`[data-id="${a.id}"]`);
      if (!el) { el = document.createElement('div'); el.className = 'add-it'; el.dataset.id = a.id; el.innerHTML = '<div class="add-in"></div>'; L.append(el); }
      const inner = el.firstChild, sig = JSON.stringify([a.type, a.text, a.body, a.source, a.style, a.color, a.stress, a.bg, a.fs, a.w, a.src, a.font, a.weight, a.align, a.frame, kitColor('card', ''), kitColor('pin', ''), BRAND ? BRAND.id + '/' + BRAND.look : '']);
      if (addSig.get(el) !== sig) { inner.innerHTML = addBody(a); addSig.set(el, sig); }
      const a0 = +a.t0 || 0, a1 = +a.t1 || a0 + 3, on = sec >= a0 && sec < a1;
      el.style.cssText = `position:absolute;left:${a.x == null ? 540 : a.x}px;top:${a.y == null ? 960 : a.y}px;transform:translate(-50%,-50%) scale(${a.size || 1}) rotate(${a.rot || 0}deg);display:${on ? 'block' : 'none'};`;
      if (!on) return;
      const dur = Math.max(0.05, +a.inDur || 0.45), p = (sec - a0) / dur, out = Math.max(0, Math.min(1, (a1 - sec) / 0.2)), an = a.anim || 'pop';
      let op = out, tr = '', fl = '';
      const e = ease(p), bk = back(p);
      if (an === 'fade') op *= e; else if (an === 'pop') { op *= Math.min(1, p * 4); tr = `scale(${0.4 + 0.6 * bk})`; }
      else if (an === 'rise') { op *= e; tr = `translateY(${(1 - e) * 120}px)`; }
      else if (an === 'drop') { op *= Math.min(1, p * 3); tr = `translateY(${-(1 - e) * 220}px) scale(${1 + (1 - e) * 0.14})`; }
      else if (an === 'blur') { op *= e; tr = `translateX(${-(1 - e) * 260}px)`; fl = `blur(${(1 - e) * 22}px)`; }
      else if (an === 'placed') { op *= Math.min(1, p * 3); tr = `rotate(${(1 - bk) * -9}deg) scale(${1 + (1 - bk) * 0.18})`; }
      inner.style.cssText = `opacity:${op};transform:${tr};filter:${fl}`;
      if (a.type === 'caption' && a.wbw) {     // word by word over the first part of the time on screen
        const ws = inner.querySelectorAll('.add-w'), n = ws.length, span = Math.max(0.3, (a1 - a0) * 0.7);
        ws.forEach((w, i) => { const q = Math.max(0, Math.min(1, (sec - a0 - (i / n) * span) / 0.18)); w.style.opacity = String(q); w.style.translate = `0 ${(1 - q) * 30}px`; });
      } else inner.querySelectorAll('.add-w').forEach(w => { w.style.opacity = ''; w.style.translate = ''; });
    });
  }
  window.setAdded = list => { window.EDIT_ADDED = list || []; paintAdded(); };
  window.paintAdded = paintAdded;
  const addHit = (x, y) => [...addLayer().children].reverse().find(c => { if (c.style.display === 'none') return false; const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });

  window.setItems = items => { window.EDIT_ITEMS = items || []; applyItems(); drawBox(); };

  /* selection box (only in the editor, never in the video) */
  let boxEl = null, selItem = null, selRaw = null;
  function drawBox() {
    if (!Q.has('edit')) return;
    if (!boxEl) { const l = document.createElement('div'); l.id = 'edit-layer'; l.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'; boxEl = document.createElement('div'); boxEl.style.cssText = 'position:absolute;border:4px solid #ff3b6b;box-shadow:0 0 0 2px #fff8,0 0 18px #ff3b6b88;border-radius:6px;display:none'; l.append(boxEl); document.body.append(l); }
    let el = null;
    if (selItem) { const it = (window.EDIT_ITEMS || []).find(x => x.id === selItem); el = it ? findSig(it.sig, it.text) : null; }
    else if (selRaw && selRaw.isConnected) el = selRaw;
    if (!el) { boxEl.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(boxEl.style, { display: 'block', left: r.left - 8 + 'px', top: r.top - 8 + 'px', width: r.width + 16 + 'px', height: r.height + 16 + 'px' });
  }
  window.selectAdded = id => { selItem = null; selRaw = id ? addLayer().querySelector('[data-id="' + id + '"]') : null; drawBox(); };
  window.selectItem = id => { selItem = id; selRaw = null; drawBox(); };
  window.editFonts = () => [...new Set([...document.fonts].map(f => f.family.replace(/["']/g, '')))].sort();

  /* which timeline objects exist in this reel (the editor and the export both ask) */
  window.editObjects = () => {
    const o = {}, L = window.editLabels(); window.editKeys().forEach(k => o[k] = { name: 'Pieces / ' + L[k], kind: 'piece' });
    if (CAMERA.length) o.camera = { name: 'Camera', kind: 'camera' };
    if (CAPTION.length && CAPTION.some(s => $$(s).length)) o.captions = { name: 'Captions', kind: 'captions' };
    return o;
  };

  /* ---------- edit mode: pick + drag a piece (works through the camera's zoom) ---------- */
  if (Q.has('edit')) {
    let sel = null, drag = null;
    const mark = document.createElement('style');
    mark.textContent = '.edit-sel{outline:4px dashed #ff3b6b!important;outline-offset:6px}' + PIECE.split(',').map(s => s.trim() + '{cursor:grab}').join('');
    document.head.appendChild(mark);
    const say = (type, extra) => { try { parent.postMessage(Object.assign({ reelEdit: type }, extra || {}), '*'); } catch (e) {} };
    const op = el => { let n = el, o = 1; while (n && n.nodeType === 1) { o *= +getComputedStyle(n).opacity; n = n.parentElement; } return o; };
    function pick(el) {
      if (sel) sel.classList.remove('edit-sel');
      sel = el; if (el) el.classList.add('edit-sel');
      const m = el && current && current.moves && current.moves[el.dataset.ek] || {};
      say('pick', el ? { key: el.dataset.ek, dx: m.dx || 0, dy: m.dy || 0, scale: m.scale || 1 } : { key: null });
    }
    let idrag = null;
    function thingAt(x, y) {       // the smallest visible thing at that spot: words first, then a picture / box
      // by position, not by the browser's hit test: kits often switch mouse hits off on their layers
      const inside = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
      const shown = el => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && op(el) > 0.3; };
      const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
      const smallest = list => list.sort((a, b) => area(a) - area(b))[0];
      const all = $$('body *').filter(el => !isUI(el) && inside(el));
      layerEls();
      { const part = smallest(all.filter(el => el.matches(PARTS) && shown(el))); if (part) return { el: part, kind: 'part', name: layerName(part) }; }
      const txt = smallest(all.filter(el => own(el) && shown(el))); if (txt) return { el: txt, kind: 'text' };
      const pic = smallest(all.filter(el => /^(IMG|VIDEO|CANVAS|svg)$/.test(el.tagName) && shown(el) && area(el) < innerWidth * innerHeight * 0.6));
      if (pic) return { el: pic, kind: 'picture' };
      const box = smallest(all.filter(el => shown(el) && area(el) < innerWidth * innerHeight * 0.6));
      return box ? { el: box, kind: 'box' } : null;
    }
    function pickThing(th) {
      if (sel) sel.classList.remove('edit-sel'); sel = null;
      const it = (window.EDIT_ITEMS || []).find(x => x.id === th.el.dataset.eid);
      const cs = getComputedStyle(th.el), r = th.el.getBoundingClientRect();
      const o = ORIG.get(th.el);
      selItem = it ? it.id : null; selRaw = th.el; drawBox();
      const card = th.el.closest(PIECE);
      say('thing', { kind: th.kind, part: th.name || '', id: it ? it.id : null, sig: it ? it.sig : sigOf(th.el), text: own(th.el), orig: o && o.text !== undefined ? o.text.replace(/\s+/g, ' ').trim() : own(th.el),
        font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), color: cs.color, size: parseFloat(cs.fontSize), weight: cs.fontWeight,
        w: Math.round(r.width), h: Math.round(r.height), card: card ? card.dataset.ek : null,
        lid: th.el.dataset.lid || null, fill: th.kind === 'part' ? kitColor('pin', '#c4251a') : null });
    }
    // the timeline's PINS row: click a pin block = pick that pin, same as clicking it in the preview
    window.pickLayer = lid => { layerEls(); const el = document.querySelector(`[data-lid="${CSS.escape(lid)}"]`); if (!el) return false; pickThing({ el, kind: 'part', name: layerName(el) }); return true; };
    window.__thingAt = (x, y) => { const t = thingAt(x, y); return t && { kind: t.kind, text: own(t.el), tag: t.el.tagName, card: !!t.el.closest(PIECE) }; };
    window.pickCard = key => { selItem = null; selRaw = null; drawBox(); pick(pieces().find(e => e.dataset.ek === key) || null); };
    let adrag = null;
    addEventListener('pointerdown', e => {
      pieces();
      const ah = addHit(e.clientX, e.clientY);
      if (ah) { const r = ah.getBoundingClientRect(), sc = r.width / (ah.offsetWidth || r.width) || 1; adrag = { x: e.clientX, y: e.clientY, s: sc, moved: false }; say('addpick', { id: ah.dataset.id }); selRaw = ah; selItem = null; drawBox(); e.preventDefault(); return; }
      const th = thingAt(e.clientX, e.clientY);
      if (th && (th.kind === 'text' || th.kind === 'part' || !th.el.closest(PIECE))) {
        pickThing(th);
        const r = th.el.getBoundingClientRect(), s = r.width / (th.el.offsetWidth || r.width) || 1;
        idrag = { x: e.clientX, y: e.clientY, s, moved: false };
        e.preventDefault(); return;
      }
      selItem = null; selRaw = null; drawBox();
      const el = document.elementsFromPoint(e.clientX, e.clientY).map(n => n.closest && n.closest(PIECE)).find(x => x && op(x) > 0.3);
      if (!el) { pick(null); say('thing', { kind: null }); return; }
      say('thing', { kind: 'card', key: el.dataset.ek });
      pick(el);
      const r = el.getBoundingClientRect(), s = r.width / (el.offsetWidth || r.width) || 1;
      const m = (current.moves = current.moves || {})[el.dataset.ek] || { dx: 0, dy: 0 };
      drag = { x: e.clientX, y: e.clientY, s, dx: m.dx || 0, dy: m.dy || 0 };
      el.setPointerCapture(e.pointerId); e.preventDefault();
    }, true);
    addEventListener('pointermove', e => {
      if (adrag) { if (!adrag.moved && Math.abs(e.clientX - adrag.x) + Math.abs(e.clientY - adrag.y) < 5) return; adrag.moved = true; say('adddrag', { dx: (e.clientX - adrag.x) / adrag.s, dy: (e.clientY - adrag.y) / adrag.s }); return; }
      if (idrag) {
        if (!idrag.moved && Math.abs(e.clientX - idrag.x) + Math.abs(e.clientY - idrag.y) < 5) return;
        idrag.moved = true;
        say('thingdrag', { dx: (e.clientX - idrag.x) / idrag.s, dy: (e.clientY - idrag.y) / idrag.s });   // the editor owns the list and sends it back
        return;
      }
      if (!drag || !sel) return;
      const m = current.moves[sel.dataset.ek] = Object.assign(current.moves[sel.dataset.ek] || {}, { dx: Math.round(drag.dx + (e.clientX - drag.x) / drag.s), dy: Math.round(drag.dy + (e.clientY - drag.y) / drag.s) });
      paintMoves(current); say('move', { key: sel.dataset.ek, dx: m.dx, dy: m.dy, scale: m.scale || 1 });
    });
    addEventListener('pointerup', () => { if (adrag) { if (adrag.moved) say('adddrop', {}); adrag = null; return; } if (idrag) { if (idrag.moved) say('thingdrop', {}); idrag = null; return; } if (drag) { drag = null; say('drop', { moves: current.moves }); } });
    window.editPick = key => pick(pieces().find(e => e.dataset.ek === key) || null);
  }

  if (window.EDIT_THEME) window.applyEdit(window.EDIT_THEME);
  if (BRAND) brandCSS();
  if (Q.has('edit')) setInterval(() => { applyItems(); drawBox(); }, 400);   // the kit can redraw between frames (videos loading): keep his changes on
  try { parent.postMessage({ reelEdit: 'ready' }, '*'); } catch (e) {}
})();

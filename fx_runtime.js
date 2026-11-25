/* fx_runtime.js: GEditor's look + effects layer inside every reel page (chat 8 tools: Filters, Adjust, Effects, Transitions).
   One maths for the live preview AND the video file:
   - kit reels (Blueprint, SKY ...): the export films this page, so everything here is in the file.
   - his own videos (take): the picture is cut by ffmpeg (take_api.py uses the SAME numbers from fx_math), and the
     overlay part (flash, dips, light leak, grain, vignette) is drawn here on the transparent caption frames (?caponly=1).
   fx = { look: {filter, amt, adj}, clips: {blockId: {filter, amt, adj}}, effects: [{kind, t0, t1, amt}],
          trans: [{kind, at | before, dur}] }   (before = the clip id the transition leads into, his own videos) */
(function () {
  if (window.GEFX) return;
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  /* ---------- colour: 3x3 matrix + per-channel tone table (same numbers in take_api.fx_color) ---------- */
  const FILTERS = {
    warm:    { warm: 0.55, sat: 0.08, contrast: 0.04 },
    cool:    { warm: -0.5, tint: -0.1, sat: -0.05 },
    film:    { contrast: 0.12, sat: -0.18, fade: 0.12, warm: 0.15, sh: 0.1 },
    bw:      { sat: -1, contrast: 0.15 },
    punchy:  { contrast: 0.22, sat: 0.3, hi: -0.08 },
    fade:    { fade: 0.25, contrast: -0.12, sat: -0.15 },
    teal:    { teal: 0.6, contrast: 0.1, sat: 0.05 },
    night:   { bright: -0.18, warm: -0.6, sat: -0.25, contrast: 0.1 },
    vivid:   { sat: 0.45, contrast: 0.08, bright: 0.04 },
    vintage: { warm: 0.35, fade: 0.18, sat: -0.3, tint: 0.08 },
    golden:  { warm: 0.7, bright: 0.05, hi: 0.1, sat: 0.12 },
    moody:   { bright: -0.1, contrast: 0.2, sat: -0.25, sh: -0.15, warm: -0.15 },
  };
  const KEYS = ['bright', 'contrast', 'sat', 'warm', 'tint', 'hi', 'sh', 'fade', 'teal', 'sharp', 'vig', 'grain'];
  function mix(look) {   // filter preset * strength + his own Adjust sliders -> one set of numbers
    const o = {}; KEYS.forEach(k => o[k] = 0); if (!look) return o;
    const f = FILTERS[look.filter], a = look.amt == null ? 1 : look.amt;
    if (f) Object.keys(f).forEach(k => o[k] += f[k] * a);
    const adj = look.adj || {}; KEYS.forEach(k => o[k] += +adj[k] || 0);
    return o;
  }
  function addMix(a, b) { const o = {}; KEYS.forEach(k => o[k] = (a[k] || 0) + (b[k] || 0)); return o; }
  function isId(o) { return KEYS.every(k => Math.abs(o[k] || 0) < 1e-4); }
  function matrix(o) {
    const s = 1 + o.sat, br = 1 + o.bright * 0.6;
    let M = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
    const r = br * (1 + 0.12 * o.warm), g = br * (1 - 0.06 * o.tint), b = br * (1 - 0.14 * o.warm);
    return [M[0] * r, M[1] * r, M[2] * r, M[3] * g, M[4] * g, M[5] * g, M[6] * b, M[7] * b, M[8] * b];
  }
  function curve(o, ch) {   // 9 points 0..1 for one channel: contrast, highlights, shadows, fade (lifted blacks), teal/orange
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      let x = i / 8, y = (x - 0.5) * (1 + o.contrast) + 0.5;
      y += o.hi * 0.35 * Math.max(0, x - 0.5) * 2 * x;            // highlights
      y += o.sh * 0.35 * Math.max(0, 0.5 - x) * 2 * (1 - x);      // shadows
      y = o.fade * 0.18 + y * (1 - o.fade * 0.18 - o.fade * 0.04); // lifted blacks, softer whites
      if (o.teal) { const k = o.teal * 0.09; if (ch === 0) y += k * (x - 0.35); if (ch === 2) y += k * (0.6 - x); if (ch === 1) y += k * 0.2 * (0.5 - Math.abs(x - 0.5)); }
      pts.push(clamp(y, 0, 1));
    }
    return pts;
  }
  window.GEFX_MATH = { FILTERS, KEYS, mix, matrix, curve, isId };

  /* ---------- the layers in this page ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  let svg = null, ov = null, FX = null, target = null, CAP = /caponly=1/.test(location.search), lastKey = '';
  function setup() {
    if (svg) return;
    svg = document.createElementNS(NS, 'svg'); svg.setAttribute('width', 0); svg.setAttribute('height', 0); svg.style.position = 'absolute';
    svg.innerHTML = `<defs>
      <filter id="gefx" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix id="gefxm" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>
        <feComponentTransfer id="gefxc"><feFuncR type="table" tableValues="0 1"/><feFuncG type="table" tableValues="0 1"/><feFuncB type="table" tableValues="0 1"/></feComponentTransfer>
        <feConvolveMatrix id="gefxs" order="3" kernelMatrix="0 0 0 0 1 0 0 0 0" preserveAlpha="true"/></filter>
      <filter id="gefxrgb" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
        <feOffset id="gefxr" in="SourceGraphic" dx="0" result="r0"/><feColorMatrix in="r0" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/>
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>
        <feOffset id="gefxb" in="SourceGraphic" dx="0" result="b0"/><feColorMatrix in="b0" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/>
        <feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/></filter></defs>`;
    document.body.append(svg);
    ov = document.createElement('div'); ov.id = 'gefxo';
    ov.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
    ov.innerHTML = '<i data-k="vig"></i><i data-k="grain"></i><i data-k="leak"></i><i data-k="black"></i><i data-k="white"></i>';
    [...ov.children].forEach(e => e.style.cssText = 'position:absolute;inset:0;opacity:0;display:block');
    ov.querySelector('[data-k=vig]').style.background = 'radial-gradient(ellipse 75% 70% at 50% 50%, transparent 45%, #000 100%)';
    ov.querySelector('[data-k=leak]').style.background = 'radial-gradient(ellipse 60% 55% at 85% 20%, rgba(255,170,60,.95), rgba(255,90,40,.55) 40%, transparent 72%), radial-gradient(ellipse 50% 45% at 10% 85%, rgba(255,210,120,.6), transparent 70%)';
    ov.querySelector('[data-k=black]').style.background = '#000';
    ov.querySelector('[data-k=white]').style.background = '#fff';
    const gc = document.createElement('canvas'); gc.width = 256; gc.height = 256; const g = gc.getContext('2d'), im = g.createImageData(256, 256);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < im.data.length; i += 4) { const v = rnd() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); const gr = ov.querySelector('[data-k=grain]'); gr.style.backgroundImage = `url(${gc.toDataURL()})`; gr.style.mixBlendMode = 'overlay';
    (document.getElementById('stage') || document.body).append(ov);
    if (document.getElementById('stage')) ov.style.position = 'absolute';
  }
  const pick = () => target || (target = document.getElementById('pic') || document.body);

  /* ---------- what is on at time T ---------- */
  function clipRanges() { try { return window.GEFX_CLIPS ? window.GEFX_CLIPS() : []; } catch (e) { return []; } }
  function transList() {
    const C = clipRanges(), out = [];
    (FX && FX.trans || []).forEach(x => { let t = x.at; if (x.before != null) { const c = C.find(c => c.id === x.before); if (!c) return; t = c.t0; } if (t == null) return; out.push({ kind: x.kind, t, dur: Math.max(0.1, x.dur || 0.5) }); });
    return out;
  }
  function state(T) {
    const s = { m: null, blur: 0, gray: 0, rgb: 0, sx: 0, sy: 0, sc: 1, ov: { vig: 0, grain: 0, leak: 0, black: 0, white: 0 } };
    if (!FX) return s;
    let o = mix(FX.look);
    const C = clipRanges(); if (C.length && FX.clips) { const c = C.find(c => T >= c.t0 && T < c.t1); if (c && FX.clips[c.id]) o = addMix(o, mix(FX.clips[c.id])); }
    s.m = o; s.ov.vig = clamp(o.vig, 0, 1) * 0.85; s.ov.grain = clamp(o.grain, 0, 1) * 0.35;
    (FX.effects || []).forEach(e => {
      if (T < e.t0 || T >= e.t1) return; const a = e.amt == null ? 1 : e.amt, d = Math.max(0.05, e.t1 - e.t0), p = (T - e.t0) / d, u = T - e.t0;
      if (e.kind === 'flash') s.ov.white = Math.max(s.ov.white, a * (1 - p) ** 2);
      if (e.kind === 'shake') { const A = 22 * a; s.sx += A * Math.sin(u * 47) * (1 - p * 0.3); s.sy += A * 0.7 * Math.cos(u * 61); s.sc = Math.max(s.sc, 1 + 0.05 * a); }
      if (e.kind === 'zoom') { const k = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8; s.sc *= 1 + 0.14 * a * (1 - (1 - k) ** 2); }
      if (e.kind === 'blurin') s.blur = Math.max(s.blur, 24 * a * (1 - p) ** 1.6);
      if (e.kind === 'rgb') s.rgb = Math.max(s.rgb, 12 * a * (0.7 + 0.3 * Math.sin(u * 37)));
      if (e.kind === 'leak') s.ov.leak = Math.max(s.ov.leak, a * Math.sin(Math.PI * p) * 0.9);
      if (e.kind === 'grain') s.ov.grain = Math.max(s.ov.grain, 0.35 * a);
      if (e.kind === 'bw') s.gray = Math.max(s.gray, a);
      if (e.kind === 'vig') s.ov.vig = Math.max(s.ov.vig, 0.85 * a);
    });
    transList().forEach(x => {
      const a0 = x.t - x.dur / 2; if (T < a0 || T >= a0 + x.dur) return; const u = (T - a0) / x.dur, tri = 1 - Math.abs(2 * u - 1);
      if (x.kind === 'black' || x.kind === 'fade') s.ov.black = Math.max(s.ov.black, Math.min(1, tri * 1.15));
      if (x.kind === 'white') s.ov.white = Math.max(s.ov.white, Math.min(1, tri * 1.15));
      if (x.kind === 'flash') s.ov.white = Math.max(s.ov.white, u < 0.5 ? (u / 0.5) ** 3 : (1 - (u - 0.5) / 0.5) ** 2);
      if (x.kind === 'zoom') { s.sc *= 1 + 0.28 * tri ** 1.5; s.blur = Math.max(s.blur, 10 * tri ** 2); }
      if (x.kind === 'blur') s.blur = Math.max(s.blur, 22 * tri);
      if (x.kind === 'glitch') { s.rgb = Math.max(s.rgb, 16 * tri); s.sx += (Math.sin(T * 173) > 0 ? 1 : -1) * 18 * tri; }
      if (x.kind === 'whip') { s.sx += (u < 0.5 ? -1 : 1) * (u < 0.5 ? u / 0.5 : (1 - u) / 0.5) ** 2 * -320; s.blur = Math.max(s.blur, 14 * tri); }
      if (x.kind === 'leak') s.ov.leak = Math.max(s.ov.leak, tri);
    });
    return s;
  }
  window.GEFX_STATE = state;

  function apply(T) {
    if (!FX) { if (svg && pick().style.filter) { pick().style.filter = ''; pick().style.transform = ''; } if (ov) [...ov.children].forEach(e => e.style.opacity = 0); return; }
    setup(); const s = state(T), P = pick();
    [...ov.children].forEach(e => e.style.opacity = (s.ov[e.dataset.k] || 0).toFixed(3));
    if (CAP) return;   // the caption frames of his own video carry only the overlay; ffmpeg does the picture
    const parts = [];
    if (s.m && !isId(s.m)) {
      const M = matrix(s.m), m = document.getElementById('gefxm');
      m.setAttribute('values', `${M[0]} ${M[1]} ${M[2]} 0 0 ${M[3]} ${M[4]} ${M[5]} 0 0 ${M[6]} ${M[7]} ${M[8]} 0 0 0 0 0 1 0`);
      const fs = document.getElementById('gefxc').children; [0, 1, 2].forEach(ch => fs[ch].setAttribute('tableValues', curve(s.m, ch).map(v => v.toFixed(4)).join(' ')));
      const k = clamp(s.m.sharp, 0, 1) * 0.6; document.getElementById('gefxs').setAttribute('kernelMatrix', `0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0`);
      parts.push('url(#gefx)');
    }
    if (s.rgb > 0.2) { document.getElementById('gefxr').setAttribute('dx', -s.rgb); document.getElementById('gefxb').setAttribute('dx', s.rgb); parts.push('url(#gefxrgb)'); }
    if (s.gray > 0.01) parts.push(`grayscale(${s.gray.toFixed(3)})`);
    if (s.blur > 0.2) parts.push(`blur(${s.blur.toFixed(2)}px)`);
    P.style.filter = parts.join(' ');
    P.style.transformOrigin = '50% 50%';
    P.style.transform = (s.sc !== 1 || s.sx || s.sy) ? `translate(${s.sx.toFixed(2)}px,${s.sy.toFixed(2)}px) scale(${s.sc.toFixed(4)})` : '';
  }
  window.GEFX = {
    set(fx) { FX = fx && (fx.look || (fx.effects && fx.effects.length) || (fx.trans && fx.trans.length) || (fx.clips && Object.keys(fx.clips).length)) ? JSON.parse(JSON.stringify(fx)) : null; apply(lastT); },
    get: () => FX, apply,
    key(T) { if (!FX) return ''; const s = state(T); return Object.values(s.ov).map(v => Math.round(v * 60)).join(','); },
  };
  let lastT = 0;
  // follow every moment the page draws (every kit has window.at(ms); the export calls it too)
  function hook() {
    const a = window.at; if (typeof a !== 'function' || a.__gefx) return;
    const w = function (ms) { const r = a.apply(this, arguments); lastT = (+ms || 0) / 1000; try { apply(lastT); } catch (e) {} return r; };
    w.__gefx = true; window.at = w;
    const k = window.capKey; if (typeof k === 'function' && !k.__gefx) { const kk = function (ms) { return k.apply(this, arguments) + '|' + window.GEFX.key((+ms || 0) / 1000); }; kk.__gefx = true; window.capKey = kk; }
  }
  hook(); const iv = setInterval(hook, 200); setTimeout(() => clearInterval(iv), 20000);
  if (window.EDIT_FX) window.GEFX.set(window.EDIT_FX);
  else if (!window.takeSet) fetch('/api/fx', { cache: 'no-store' }).then(r => r.json()).then(fx => { if (fx && !FX) window.GEFX.set(fx); }).catch(() => {});
})();

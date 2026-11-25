/* share_ui.js: the Share button (top right, icon only) on the Projects page and in the editor (Reel Editor LEDGER L543).
   One click: the Wi-Fi link for his Mac / iPhone / laptop, Copy, and "Send to my phone" (Telegram, via lan/phonecheck.py,
   which first proves the link really opens on the Wi-Fi). Same project, same files: the PC runs GEditor, other devices open it. */
(function () {
  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';
  const css = document.createElement('style');
  css.textContent = `#gshare{background:none;border:1px solid #3a352f;color:#f3e6cf;border-radius:999px;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none}
#gshare:hover{border-color:#ffd27a;color:#ffd27a}
#gsharem{position:fixed;z-index:9999;width:min(380px,calc(100vw - 32px));background:#1d1a17;border:1px solid #3a352f;border-radius:14px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);color:#f3e6cf;font:14px/1.45 system-ui,Segoe UI,sans-serif;display:none}
#gsharem.on{display:block}#gsharem h4{margin:0 0 6px;font-size:15px}#gsharem .h{color:#b3a893;font-size:13px;margin:4px 0 10px}
#gsharem .lk{background:#27231f;border:1px solid #3a352f;border-radius:10px;padding:10px;font:600 15px ui-monospace,Consolas,monospace;word-break:break-all;user-select:all;color:#ffd27a}
#gsharem .r{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}#gsharem button{background:#322d27;color:#f3e6cf;border:1px solid #3a352f;border-radius:9px;padding:8px 12px;cursor:pointer;font:inherit}
#gsharem button.p{background:#ffd27a;color:#141210;border-color:#ffd27a;font-weight:600}#gsharem .st{margin-top:8px;font-size:13px;color:#b3a893;min-height:18px}
#gsharem .tg{display:flex;gap:6px;margin:0 0 10px}#gsharem .tg button.on{border-color:#ffd27a;color:#ffd27a}`;
  document.head.append(css);
  let LAN = '', which = 'here', STK = '', STR = '';
  async function lan() { try { const j = await (await fetch('/api/state')).json(); LAN = j.lan || LAN; STK = j.kit || ''; STR = j.reel || ''; } catch (e) {} return LAN; }
  const pathHere = () => location.pathname.startsWith('/home') || !STR ? '/home' : `/?kit=${encodeURIComponent(STK || 'take')}&reel=${encodeURIComponent(STR)}`;   // the editor rewrites its own address, so ask the server which project is open
  function make(where) {
    if (document.getElementById('gshare')) return;
    const b = document.createElement('button'); b.id = 'gshare'; b.innerHTML = ICON; b.title = 'Share: open GEditor on your Mac, phone or laptop (same Wi-Fi)'; b.setAttribute('aria-label', 'Share workspace');
    const m = document.createElement('div'); m.id = 'gsharem'; document.body.append(m);
    b.onclick = async e => { e.stopPropagation(); if (m.classList.contains('on')) return m.classList.remove('on'); await draw(m); const r = b.getBoundingClientRect(); m.style.top = (r.bottom + 8) + 'px'; m.style.right = Math.max(16, innerWidth - r.right) + 'px'; m.classList.add('on'); };
    addEventListener('pointerdown', e => { if (!e.target.closest('#gsharem') && !e.target.closest('#gshare')) m.classList.remove('on'); });
    where(b);
  }
  async function draw(m) {
    const base = await lan(), here = pathHere(), onProj = here !== '/home';
    const link = base + (which === 'here' && onProj ? here : '/home');
    m.innerHTML = `<h4>Open on your other devices</h4><div class="h">Your Mac, phone or laptop on the same Wi-Fi opens this link: same projects, same files (they stay on this PC). Keep this PC on and GEditor open.</div>`
      + (onProj ? `<div class="tg"><button data-w="here" class="${which === 'here' ? 'on' : ''}">This project</button><button data-w="home" class="${which === 'home' ? 'on' : ''}">All projects</button></div>` : '')
      + `<div class="lk">${link || 'No Wi-Fi address found: is this PC on Wi-Fi?'}</div>`
      + `<div class="r"><button class="p" data-a="copy">Copy link</button><button data-a="open">Open in a new tab</button></div><div class="st"></div>`;
    const st = m.querySelector('.st');
    m.querySelectorAll('[data-w]').forEach(x => x.onclick = () => { which = x.dataset.w; draw(m); });
    m.querySelector('[data-a=copy]').onclick = async () => { try { await navigator.clipboard.writeText(link); st.textContent = 'Copied. Paste it into Safari or Chrome on the other device.'; } catch (e) { st.textContent = 'Select the link above and copy it.'; } };
    m.querySelector('[data-a=open]').onclick = () => window.open(link, '_blank');
    m.querySelector('[data-a=tg]').onclick = async () => {
      st.textContent = 'Checking that the link opens on the Wi-Fi, then sending it to your Telegram…';
      try { const r = await (await fetch('/api/share/telegram', { method: 'POST', body: JSON.stringify({ path: which === 'here' && onProj ? here : '/home' }) })).json();
        st.textContent = r.ok ? 'Sent to your Telegram. Tap it on your phone.' : 'Not sent: ' + (r.error || 'the link did not open on the Wi-Fi'); }
      catch (e) { st.textContent = 'Not sent: ' + e; }
    };
  }
  window.GShare = { make };
})();

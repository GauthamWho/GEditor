"""flow_api.py: the Reel Editor side of the Gautham Studio flow (Studio runner/flow.py). Plugged into server.py with 3 lines
(import, GET hook, POST hook) so the editor itself stays one file per job. localhost only, no AI.

  GET  /api/flow             the Studio step bar for the open reel (projects/<kit>__<reel>.flow.json, written by flow.py)
  GET  /api/caps   POST      caption switch + dragged caption times + Eye-Lock switches: {"mode": "ta"|"en", "shift": {"<line>.<group>": seconds}, "eye": {"full": true, "split": true}}
  GET  /api/ask    POST      his "Ask Claude" request: {t0, t1, lines, pieces, text, n} -> state "waiting for go" (he says "go" in chat)
  POST /api/pick             {"k": n}: runs the pick command flow.py stored in the ask file (version n goes into the reel)
  GET  /vreel/<reel>/<file>  another reel of the same kit (the versions shown side by side)
reel_page(html) adds window.CAP_MODE / CAP_SHIFT to the reel page (preview and the final video), so the kit's own page decides
which captions to draw (Blueprint engine.js reads them)."""
import json, pathlib, re, subprocess, threading, time

S = None          # the server module (set by init)
PICK = {"state": "idle", "msg": ""}


def init(server_module): global S; S = server_module


def _read(kind, empty):
    f = S.pfile(kind)
    try: return json.loads(f.read_text(encoding="utf-8")) if f.exists() else empty
    except Exception: return empty


def reel_page(html):
    c = _read("caps", {})
    ey = c.get("eye") or {}   # Blueprint Eye-Lock switches (chat 45): his eyes pinned in full screen / in split, each on its own (default both on)
    tag = (f"<script>window.CAP_MODE={json.dumps(c.get('mode') or '')};window.CAP_SHIFT={json.dumps(c.get('shift') or {})};"
           f"window.EYE_FULL={json.dumps(ey.get('full', True))};window.EYE_SPLIT={json.dumps(ey.get('split', True))};</script>")
    return html.replace("<head>", "<head>" + tag, 1) if "<head>" in html else tag + html


def get(h, p):
    if p == "/api/flow":
        d = _read("flow", {}); d["pick"] = PICK; return h.send(200, json.dumps(d)) or True
    if p == "/api/caps": return h.send(200, json.dumps(_read("caps", {"mode": "ta", "shift": {}, "eye": {"full": True, "split": True}}))) or True
    if p == "/api/ask": return h.send(200, json.dumps(_read("ask", {}))) or True
    if p.startswith("/vreel/"):
        parts = p[7:].split("/", 1)
        if len(parts) != 2 or not S.SAFE.match(parts[0]): return h.send(404, "{}") or True
        root = S.reels_root(); base = (root / parts[0]).resolve(); f = (base / parts[1]).resolve()
        if base.parent != root.resolve() or base not in f.parents or not f.is_file(): return h.send(404, "{}") or True
        if f.name == S.manifest()["reelFile"]:
            return h.send(200, reel_page(f.read_text(encoding="utf-8")).encode(), "text/html; charset=utf-8") or True
        return h.file(f) or True
    return False


def _run_pick(cmd, k):
    PICK.update(state="running", msg=f"putting version {k} into the reel (about 1 min)")
    try:
        r = subprocess.run(cmd + [str(k)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
        PICK.update(state="done" if r.returncode == 0 else "error", msg=(r.stdout + r.stderr).strip().splitlines()[-1][:300] if (r.stdout + r.stderr).strip() else "")
    except Exception as e: PICK.update(state="error", msg=str(e)[:300])
    PICK["t"] = time.time()


def post(h, p):
    if p == "/api/caps":
        b = h.body(); mode = b.get("mode") if b.get("mode") in ("ta", "en") else "ta"
        shift = {k: round(float(v), 2) for k, v in (b.get("shift") or {}).items() if re.match(r"^\d+\.\d+$", k) and abs(float(v)) <= 5}
        eye = {k: bool((b.get("eye") or {}).get(k, True)) for k in ("full", "split")}
        S.pfile("caps").write_text(json.dumps({"mode": mode, "shift": shift, "eye": eye}), encoding="utf-8"); return h.send(200, '{"ok":true}') or True
    if p == "/api/ask":
        b = h.body(); text = str(b.get("text") or "").strip()[:1000]
        if not text: return h.send(400, '{"error":"type what to change"}') or True
        q = {"t0": round(float(b.get("t0") or 0), 2), "t1": round(float(b.get("t1") or 0), 2), "lines": [int(x) for x in b.get("lines") or []][:20],
             "pieces": [str(x)[:60] for x in b.get("pieces") or []][:20], "text": text, "n": max(1, min(5, int(b.get("n") or 1))),
             "state": "waiting for go", "asked": time.strftime("%Y-%m-%d %H:%M")}
        S.pfile("ask").write_text(json.dumps(q, indent=1, ensure_ascii=False), encoding="utf-8"); return h.send(200, json.dumps(q)) or True
    if p == "/api/note":   # his right-click notes (his words: "whether I like it or I wanna change it" / "I need audio for this"); kept in notes_api
        b = h.body()
        if b.get("verdict") not in ("like", "change", "need-audio"): return h.send(400, '{"error":"bad note"}') or True
        import notes_api as NA
        try: n = NA.add_note(dict(b, kind=b["verdict"]))
        except ValueError as e: return h.send(400, json.dumps({"error": str(e)})) or True
        return h.send(200, json.dumps(n, ensure_ascii=False)) or True
    if p == "/api/pick":
        q = _read("ask", {}); k = int(h.body().get("k") or 0); cmd = q.get("pick_cmd")
        if not cmd or not any(v.get("k") == k for v in q.get("versions") or []): return h.send(400, '{"error":"no such version"}') or True
        if PICK.get("state") == "running": return h.send(409, '{"error":"a pick is already running"}') or True
        threading.Thread(target=_run_pick, args=(cmd, k), daemon=True).start(); return h.send(200, '{"ok":true}') or True
    return False

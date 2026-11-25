"""notes_api.py: his NOTES + the AI door of the Reel Editor (LEDGER L441, L447). Plugged into server.py like flow_api.py
(import, init, GET hook, POST hook). Any AI (a Claude chat through mcp_server.py, opencode, DeepSeek, a local model) uses these
plain web calls; every AI write bumps a change counter, and the open editor reloads within ~2 s with a "Claude changed ..." pop-up
(Ctrl+Z puts it back: his answer L447 "Change it, I can undo").

Notes (one file per reel: projects/<kit>__<reel>.notes.json, a list):
  {id, kind: note|like|change|need-audio, key, what, t0, t1, text, at, state: open|done, by, reply, replyBy, doneAt,
   kit, reel, folder, link}
  GET  /api/notes                     notes of the open reel           (?kit=&reel= another reel, ?all=1 every reel)
  POST /api/notes/add                 {text, t0, t1, kind?, key?, what?, kit?, reel?}
  POST /api/notes/update              {id, state?, reply?, text?, t0?, t1?, kit?, reel?}
  POST /api/notes/delete              {id, kit?, reel?}
AI door (the open reel; open another first with POST /api/open {kit, reel}):
  GET  /api/ai/reel                   everything about the open reel: lines, pieces, sounds, added, markers, camera keys,
                                      keyframes, captions, notes, sound files, link, folder
  GET  /api/ai/frame?t=12.3           a small picture (jpeg) of the reel near that second (from the timeline scan)
  GET  /api/ai/changes                the change counter {n, by, msg, at}
  POST /api/ai/sound                  {op: add|set|delete, id?, file?, t?, gain?, role?, mute?}
  POST /api/ai/added                  {op: set|delete, id, ...fields}
  POST /api/ai/camkey                 {line, keys: [{u, x, y, s, e}] } or {line, op: "reset"}  (kit camera keys, Blueprint)
  POST /api/ai/keyframe               {object, prop, t, v, ease?} or {object, prop, t, op: "delete"}
  POST /api/ai/caption                {mode: ta|en} or {key: "<line>.<group>", shift: seconds}
  POST /api/ai/marker                 {t, op?: add|delete}
Every AI write may carry the header X-Src (or body "by"): the name shown in his pop-up, e.g. "Claude", "DeepSeek"."""
import base64, json, re, time, urllib.parse, uuid

S = None
CHG = {"n": 0, "by": "", "msg": "", "at": ""}
KINDS = ("note", "like", "change", "need-audio")
EASES = {"smooth": [0.5, 0, 0.5, 1], "linear": [1 / 3, 1 / 3, 2 / 3, 2 / 3], "in": [0.42, 0, 1, 1], "out": [0, 0, 0.58, 1], "hold": None}


def init(server_module): global S; S = server_module


# ------------------------------------------------------------------ files
def _pf(kind, kit=None, reel=None):
    kit, reel = kit or S.ST["kit"], reel or S.ST["reel"]
    if not (S.SAFE.match(kit) and S.SAFE.match(reel)): raise ValueError("bad kit or reel name")
    return S.PROJECTS / f"{kit}__{reel}.{kind}.json"


def _read(kind, empty, kit=None, reel=None):
    f = _pf(kind, kit, reel)
    try: return json.loads(f.read_text(encoding="utf-8")) if f.exists() else empty
    except Exception: return empty


def _write(kind, data, kit=None, reel=None):
    S.PROJECTS.mkdir(exist_ok=True)
    _pf(kind, kit, reel).write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


def bump(by, msg, what=""):
    CHG.update(n=CHG["n"] + 1, by=(by or "AI")[:30], msg=msg[:200], at=time.strftime("%H:%M:%S"), what=what, reload=False)


def link(kit, reel, t0=None):
    q = {"kit": kit, "reel": reel}
    if t0: q["t"] = f"{float(t0):.2f}"
    return S.lan_link() + "/?" + urllib.parse.urlencode(q)


def folder(kit, reel):
    try:
        m = S.manifest(kit)
        return str((S.reels_root(m) / reel).resolve())
    except Exception: return ""


# ------------------------------------------------------------------ notes
def notes(kit=None, reel=None):
    kit, reel = kit or S.ST["kit"], reel or S.ST["reel"]
    L, fixed = _read("notes", [], kit, reel), False
    for n in L:                                    # notes from the Studio menu (flow_api, before ids) get ids + their place
        if not n.get("id"): n["id"] = "n" + uuid.uuid4().hex[:8]; fixed = True
        if not n.get("kind"): n["kind"] = n.get("verdict") if n.get("verdict") in KINDS else "note"; fixed = True
        if "kit" not in n: n.update(kit=kit, reel=reel, folder=folder(kit, reel), link=link(kit, reel, n.get("t0"))); fixed = True
        n.setdefault("state", "open"); n.setdefault("reply", "")
    if fixed: _write("notes", L, kit, reel)
    return L


def all_notes():
    out = []
    for f in sorted(S.PROJECTS.glob("*__*.notes.json")):
        kit, reel = f.name[:-len(".notes.json")].split("__", 1)
        try: out += notes(kit, reel)
        except Exception: pass
    out.sort(key=lambda n: n.get("at", ""), reverse=True)
    return out


def add_note(b, by="Gautham"):
    kit, reel = b.get("kit") or S.ST["kit"], b.get("reel") or S.ST["reel"]
    text = str(b.get("text") or "").strip()[:2000]
    kind = b.get("kind") or b.get("verdict") or "note"
    if kind not in KINDS: raise ValueError("kind must be one of " + ", ".join(KINDS))
    if not text and kind == "note": raise ValueError("type the note first")
    t0 = round(max(0.0, float(b.get("t0") or 0)), 2); t1 = round(max(t0, float(b.get("t1") or t0)), 2)
    n = {"id": "n" + uuid.uuid4().hex[:8], "kind": kind, "verdict": kind, "key": str(b.get("key") or "")[:80], "what": str(b.get("what") or "")[:160],
         "t0": t0, "t1": t1, "text": text, "at": time.strftime("%Y-%m-%d %H:%M"), "state": "open", "by": str(b.get("by") or by)[:30],
         "reply": "", "kit": kit, "reel": reel, "folder": folder(kit, reel), "link": link(kit, reel, t0)}
    L = notes(kit, reel)
    if kind == "like": L = [x for x in L if not (x.get("key") == n["key"] and x.get("kind") == "like")]   # one "like" per thing
    L.append(n); _write("notes", L, kit, reel); return n


def update_note(b, by=None):
    kit, reel = b.get("kit") or S.ST["kit"], b.get("reel") or S.ST["reel"]
    L = notes(kit, reel); n = next((x for x in L if x["id"] == b.get("id")), None)
    if not n: raise ValueError("no note with that id")
    if b.get("state") in ("open", "done"):
        n["state"] = b["state"]; n["doneAt"] = time.strftime("%Y-%m-%d %H:%M") if b["state"] == "done" else ""
    if "reply" in b: n["reply"] = str(b.get("reply") or "")[:2000]; n["replyBy"] = (by or "")[:30]
    if "text" in b: n["text"] = str(b.get("text") or "")[:2000]
    for k in ("t0", "t1"):
        if k in b: n[k] = round(max(0.0, float(b[k])), 2)
    _write("notes", L, kit, reel); return n


def delete_note(b):
    kit, reel = b.get("kit") or S.ST["kit"], b.get("reel") or S.ST["reel"]
    L = notes(kit, reel); M = [x for x in L if x["id"] != b.get("id")]
    if len(M) == len(L): raise ValueError("no note with that id")
    _write("notes", M, kit, reel); return {"ok": True}


# ------------------------------------------------------------------ what the reel is made of
def sounds():
    f = S.pfile("sounds")
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else S.sounds_from_kit()


def reel_summary():
    kit, reel, m = S.ST["kit"], S.ST["reel"], S.manifest()
    seen = _read("seen", {})
    sc = {}
    try:
        f = S.scan_file()
        if f.exists(): sc = json.loads(f.read_text(encoding="utf-8"))
    except Exception: pass
    try: files = S.sound_library(S.reels_root(m), m)
    except Exception: files = []
    return {
        "kit": kit, "kitTitle": m.get("title", kit), "reel": reel, "folder": folder(kit, reel), "link": link(kit, reel),
        "editorOpen": bool(seen), "total": seen.get("total") or sc.get("total"),
        "help": "times are seconds from the start of the reel. lines = the spoken lines (beats). pieces = things on screen "
                "(news pages, memes, slips) with the seconds they show. sounds: t = when it starts, gain in dB, guessed = the kit "
                "guessed it. objects = what keyframes can move (prop names per object). camkeys = the kit's camera keys he changed "
                "(per line: u = seconds into the line, x/y = where the camera looks, s = zoom).",
        "lines": seen.get("lines", []), "objects": seen.get("objects", []),
        "pieces": sc.get("pieces", []),
        "sounds": sounds(), "added": _read("added", []), "markers": _read("markers", {"marks": []}),
        "camkeys": _read("kitkeys", {"cam": {}}), "keyframes": keyframes_plain(), "captions": _read("caps", {"mode": "ta", "shift": {}}),
        "notes": notes(), "soundFiles": files[:400], "soundFilesTotal": len(files), "changes": CHG,
    }


def keyframes_plain():
    st = _read("timeline", {}); out = {}
    tr = (((st.get("sheetsById") or {}).get("Main") or {}).get("sequence") or {}).get("tracksByObject") or {}
    for obj, o in tr.items():
        for path, tid in (o.get("trackIdByPropPath") or {}).items():
            try: prop = json.loads(path)[0]
            except Exception: continue
            ks = ((o.get("trackData") or {}).get(tid) or {}).get("keyframes") or []
            out.setdefault(obj, {})[prop] = [{"t": k["position"], "v": k["value"], "ease": "hold" if not k.get("connectedRight", True) else "curve"} for k in ks]
    return out


def frame(t):
    try:
        f = S.scan_file()
        th = json.loads(f.read_text(encoding="utf-8")).get("thumbs") or [] if f.exists() else []
    except Exception: th = []
    if not th: return None
    best = min(th, key=lambda x: abs(float(x.get("t") or 0) - t))
    return base64.b64decode(best["src"].split(",", 1)[1]), float(best.get("t") or 0)


# ------------------------------------------------------------------ AI edits
def _snd_ok(f):
    r = S.resolve_snd(f, S.reels_root().resolve())
    return bool(r and r.is_file())


def _num(v, lo, hi, name):
    try: v = float(v)
    except Exception: raise ValueError(f"{name} must be a number")
    if not lo <= v <= hi: raise ValueError(f"{name} must be between {lo} and {hi}")
    return v


def ai_sound(b):
    L = sounds(); op = b.get("op") or ("add" if not b.get("id") else "set")
    if op == "add":
        f = str(b.get("file") or "")
        if not f: raise ValueError("file is needed (one of soundFiles from /api/ai/reel)")
        if not _snd_ok(f): raise ValueError("no such sound file: " + f)
        s = {"id": "s" + uuid.uuid4().hex[:8], "t": round(_num(b.get("t", 0), 0, 3600, "t"), 3), "role": str(b.get("role") or f.split("/")[-1].rsplit(".", 1)[0])[:40],
             "file": f, "gain": round(_num(b.get("gain", -6), -40, 12, "gain"), 1)}
        L.append(s); msg = f"added {s['role']} at {s['t']:.2f} s"
    else:
        s = next((x for x in L if x.get("id") == b.get("id")), None)
        if not s: raise ValueError("no sound with that id")
        if s.get("kit"): raise ValueError("that is the reel's own track; it cannot be changed here")
        if op == "delete": L = [x for x in L if x is not s]; msg = f"removed {s.get('role', 'a sound')} at {s['t']:.2f} s"
        elif op == "set":
            ch = []
            if "t" in b: s["t"] = round(_num(b["t"], 0, 3600, "t"), 3); ch.append(f"to {s['t']:.2f} s")
            if "gain" in b: s["gain"] = round(_num(b["gain"], -40, 12, "gain"), 1); ch.append(f"loudness {s['gain']} dB")
            if "mute" in b: s["mute"] = bool(b["mute"]); ch.append("silenced" if s["mute"] else "un-silenced")
            if "role" in b: s["role"] = str(b["role"])[:40]
            if "file" in b:
                if not _snd_ok(str(b["file"])): raise ValueError("no such sound file: " + str(b["file"]))
                s["file"] = str(b["file"]); s.pop("guessed", None); ch.append("new sound " + s["file"].split("/")[-1])
            msg = f"{s.get('role', 'sound')}: " + (", ".join(ch) or "changed")
        else: raise ValueError("op must be add, set or delete")
    S.pfile("sounds").write_text(json.dumps(L), encoding="utf-8"); return msg, {"sounds": L}


def ai_added(b):
    L = _read("added", []); a = next((x for x in L if x.get("id") == b.get("id")), None)
    if not a: raise ValueError("no added thing with that id")
    if b.get("op") == "delete": L = [x for x in L if x is not a]; msg = "removed " + str(a.get("text") or a.get("type"))
    else:
        for k, v in b.items():
            if k in ("op", "id", "by"): continue
            a[k] = v
        msg = "changed " + str(a.get("text") or a.get("type"))
    S.pfile("added").write_text(json.dumps(L), encoding="utf-8"); return msg, {"added": L}


def ai_camkey(b):
    K = _read("kitkeys", {"cam": {}}); K.setdefault("cam", {}); i = str(int(b.get("line")))
    if b.get("op") == "reset": K["cam"].pop(i, None); msg = f"camera of line {int(i) + 1} back to the kit's own"
    else:
        keys = b.get("keys")
        if not isinstance(keys, list) or not keys: raise ValueError("keys must be a list like [{u, x, y, s, e}]")
        clean = []
        for k in keys:
            c = {"u": round(_num(k.get("u", 0), 0, 600, "u"), 3), "x": round(_num(k.get("x", 0), -5000, 5000, "x"), 1),
                 "y": round(_num(k.get("y", 0), -5000, 5000, "y"), 1), "s": round(_num(k.get("s", 1), 0.2, 8, "s"), 3)}
            if k.get("e"): c["e"] = str(k["e"])[:12]
            clean.append(c)
        K["cam"][i] = sorted(clean, key=lambda k: k["u"]); msg = f"camera keys of line {int(i) + 1}"
    S.pfile("kitkeys").write_text(json.dumps(K), encoding="utf-8"); return msg, {"camkeys": K}


def ai_keyframe(b):
    st = _read("timeline", {}) or {"sheetsById": {}, "definitionVersion": "0.4.0", "revisionHistory": []}
    obj, prop = str(b.get("object") or ""), str(b.get("prop") or "")
    if not obj or not re.match(r"^[A-Za-z0-9_]{1,20}$", prop): raise ValueError("object and prop are needed (see objects in /api/ai/reel)")
    tt = round(round(_num(b.get("t", 0), 0, 3600, "t") * 30) / 30, 4)
    sh = st.setdefault("sheetsById", {}).setdefault("Main", {})
    sh.setdefault("staticOverrides", {"byObject": {}})
    seq = sh.setdefault("sequence", {"subUnitsPerUnit": 30, "type": "PositionalSequence", "tracksByObject": {}, "length": 0})
    o = seq.setdefault("tracksByObject", {}).setdefault(obj, {"trackData": {}, "trackIdByPropPath": {}})
    path = json.dumps([prop]); tid = o["trackIdByPropPath"].setdefault(path, "T" + prop)
    tr = o["trackData"].setdefault(tid, {"type": "BasicKeyframedTrack", "__debugName": prop, "keyframes": []}); ks = tr["keyframes"]
    ex = next((k for k in ks if abs(k["position"] - tt) < 0.5 / 30), None)
    if b.get("op") == "delete":
        if not ex: raise ValueError("no key at that time")
        ks.remove(ex); msg = f"removed {obj} {prop} key at {tt:.2f} s"
    else:
        v = _num(b.get("v"), -100000, 100000, "v")
        if (b.get("ease") or "smooth") not in EASES: raise ValueError("ease must be one of " + ", ".join(EASES))
        e = EASES[b.get("ease") or "smooth"]; ee = e or EASES["smooth"]
        ks.sort(key=lambda k: k["position"])
        if ex: k = ex
        else:
            nxt = next((x for x in ks if x["position"] > tt), None)    # the curve coming in from the key before keeps its shape
            k = {"id": "k" + uuid.uuid4().hex[:7], "position": tt, "handles": list((nxt or {}).get("handles", [0.5, 1, 0.5, 0])[:2]) + [0.5, 0]}; ks.append(k)
        k["value"] = v; k["connectedRight"] = e is not None; k.setdefault("handles", [0.5, 1, 0.5, 0]); k["handles"][2:4] = ee[0:2]
        ks.sort(key=lambda k: k["position"]); i = ks.index(k)
        if i + 1 < len(ks): ks[i + 1].setdefault("handles", [0.5, 1, 0.5, 0]); ks[i + 1]["handles"][0:2] = ee[2:4]
        msg = f"{obj} {prop} = {v:g} at {tt:.2f} s"
    ks.sort(key=lambda k: k["position"])
    seq["length"] = max(float(seq.get("length") or 0), tt + 0.1)
    st["revisionHistory"] = ["k" + uuid.uuid4().hex[:7]]
    S.pfile("timeline").write_text(json.dumps(st), encoding="utf-8"); return msg, {"keyframes": keyframes_plain()}


def ai_caption(b):
    c = _read("caps", {"mode": "ta", "shift": {}}); c.setdefault("shift", {})
    if "mode" in b:
        if b["mode"] not in ("ta", "en"): raise ValueError("mode must be ta or en")
        c["mode"] = b["mode"]; msg = "captions: " + ("English" if b["mode"] == "en" else "Tanglish")
    else:
        k = str(b.get("key") or "")
        if not re.match(r"^\d+\.\d+$", k): raise ValueError('key must look like "3.1" (line.group)')
        v = round(_num(b.get("shift", 0), -5, 5, "shift"), 2)
        if abs(v) < 0.04: c["shift"].pop(k, None)
        else: c["shift"][k] = v
        msg = f"caption {k} moved {v:+.2f} s"
    S.pfile("caps").write_text(json.dumps(c), encoding="utf-8"); return msg, {"captions": c}


def ai_marker(b):
    m = _read("markers", {"marks": []}); m.setdefault("marks", []); tt = round(_num(b.get("t", 0), 0, 3600, "t"), 3)
    if b.get("op") == "delete":
        n = len(m["marks"]); m["marks"] = [x for x in m["marks"] if abs(x["t"] - tt) > 0.05]
        if len(m["marks"]) == n: raise ValueError("no marker there")
        msg = f"marker at {tt:.2f} s removed"
    else: m["marks"] = sorted(m["marks"] + [{"t": tt, "label": str(b.get("label") or "")[:60]}], key=lambda x: x["t"]); msg = f"marker at {tt:.2f} s"
    S.pfile("markers").write_text(json.dumps(m), encoding="utf-8"); return msg, {"markers": m}


AI_POST = {"/api/ai/sound": ai_sound, "/api/ai/added": ai_added, "/api/ai/camkey": ai_camkey, "/api/ai/keyframe": ai_keyframe,
           "/api/ai/caption": ai_caption, "/api/ai/marker": ai_marker}
RELOAD = {"/api/ai/camkey", "/api/ai/caption"}        # these live inside the reel page: the preview is opened again


# ------------------------------------------------------------------ web
def _q(h):
    return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query).items()}


def _src(h, b=None):
    return str((b or {}).get("by") or h.headers.get("X-Src") or "").strip()[:30]


def _err(h, e): return h.send(400, json.dumps({"error": str(e)})) or True


def get(h, p):
    if p == "/api/notes":
        q = _q(h)
        try: return h.send(200, json.dumps(all_notes() if q.get("all") else notes(q.get("kit"), q.get("reel")), ensure_ascii=False)) or True
        except ValueError as e: return _err(h, e)
    if p == "/api/ai/changes": return h.send(200, json.dumps(dict(CHG, kit=S.ST["kit"], reel=S.ST["reel"]))) or True
    if p == "/api/ai/reel": return h.send(200, json.dumps(reel_summary(), ensure_ascii=False)) or True
    if p == "/api/ai/frame":
        r = frame(float(_q(h).get("t") or 0))
        if not r: return h.send(404, '{"error":"no pictures yet: open the reel in the editor once (it makes them in about a minute)"}') or True
        h.send_response(200); h.send_header("Content-Type", "image/jpeg"); h.send_header("X-Frame-Time", str(r[1]))
        h.send_header("Content-Length", str(len(r[0]))); h.end_headers(); h.wfile.write(r[0]); return True
    return False


def post(h, p):
    if p in ("/api/notes/add", "/api/notes/update", "/api/notes/delete"):
        b = h.body(); by = _src(h, b)
        try:
            if p.endswith("add"): r = add_note(b, by or "Gautham")
            elif p.endswith("update"): r = update_note(b, by or "Gautham")
            else: r = delete_note(b)
        except ValueError as e: return _err(h, e)
        if by and by.lower() != "editor":                                      # an AI touched the notes: the editor shows it
            bump(by, ("ticked a note done" if b.get("state") == "done" else "answered a note") if p.endswith("update") else "added a note" if p.endswith("add") else "removed a note", "notes")
        return h.send(200, json.dumps(r, ensure_ascii=False)) or True
    if p == "/api/ai/seen":                                                      # the editor tells what it sees: lines + what keys can move
        b = h.body(); _write("seen", {"total": b.get("total"), "lines": b.get("lines") or [], "objects": b.get("objects") or [], "at": time.strftime("%Y-%m-%d %H:%M")})
        return h.send(200, '{"ok":true}') or True
    if p in AI_POST:
        b = h.body()
        try: msg, data = AI_POST[p](b)
        except (ValueError, TypeError) as e: return _err(h, e)
        bump(_src(h, b) or "AI", msg, p[8:]); CHG["reload"] = p in RELOAD
        return h.send(200, json.dumps(dict(data, ok=True, msg=msg, change=CHG["n"]), ensure_ascii=False)) or True
    return False

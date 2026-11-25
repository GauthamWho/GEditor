"""take_api.py: GEditor's TAKE kit (Reel Editor LEDGER L468, L470, L482, L491-L493).
His own phone take goes in, Auto Edit (GauthamWho/auto.py: pause cuts + zooms, eye track, word timings) comes out as
BLOCKS he can change in the timeline (not a baked file). Eye-Lock on/off, 3 caption looks (GauthamWho Word build,
Blueprint, SKY), safe-zone layer, project file, export at any size + fps, SDR or HDR (his October fix: HDR kept with
libx265 -dolbyvision 1, SDR from it with libplacebo apply_dolbyvision; never auto.py's hable tonemap).

A take lives in projects/take/<name>/:
  take.json  = THE project file (source, blocks, eye track, words, his settings). Save = this file.
  proxy.mp4  = light 540-wide H.264 copy for the live preview (HDR takes: made with the same Dolby Vision mapping).
  reel.html  = the reel page (copy of take_reel.html; window.at(ms) + window.TOTAL like every kit).
  auto/      = auto.py's plan + caches.
Endpoints: GET /api/take/info, /api/take/job; POST /api/take/new {path}, /api/take/save {take}, /api/take/words.
The export is called by server.export_job when the open kit is "take"."""
import json, os, pathlib, re, shutil, subprocess, sys, threading, time, urllib.parse
import fx_ffmpeg as FXF   # Filters / Adjust / Effects / Transitions for the file (chat 8)

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE
TAKES = HERE / "projects" / "take"
TEMPLATE = HERE / "take_reel.html"
AUTO = HERE / "autoedit" / "auto.py"
FF_FULL = pathlib.Path(os.environ.get("GEDITOR_FFMPEG_FULL") or (HERE / "ffmpeg-full" / "bin" / "ffmpeg.exe"))   # has libplacebo (GPU)
# auto.py needs OpenCV 4.x (5.x has no face finder); the main Python here has 5.1, the reel29 setup has 4.14 + faster-whisper
PY_CANDIDATES = [HERE / ".venv/Scripts/python.exe", HERE / ".venv/bin/python", pathlib.Path(sys.executable)]
FPS = 30
JOB = {"state": "idle", "pct": 0, "msg": "", "take": ""}
S = None   # the server module (ST, EXP, mix_sounds ...)


def init(server): global S; S = server
def is_take(): return S.manifest().get("type") == "take"
def tdir(name=None): return TAKES / (name or S.ST["reel"])
def tfile(name=None): return tdir(name) / "take.json"
def load(name=None):
    f = tfile(name)
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None
def save(tk, name=None): tfile(name).write_text(json.dumps(tk, indent=1), encoding="utf-8")


def autopy():
    for p in PY_CANDIDATES:
        if p.exists():
            r = subprocess.run([str(p), "-c", "import cv2; assert hasattr(cv2, 'CascadeClassifier')"], capture_output=True)
            if r.returncode == 0: return str(p)
    return sys.executable


def ensure_page(name=None):
    """the reel page is the shared template: refreshed on every open so a fix reaches every take"""
    d = tdir(name)
    if d.exists() and TEMPLATE.exists(): shutil.copyfile(TEMPLATE, d / "reel.html")


def probe(src):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate,color_transfer,codec_name:stream_side_data=rotation,dv_profile:format=duration",
                        "-of", "json", src], capture_output=True, text=True)
    j = json.loads(r.stdout); st = j["streams"][0]; w, h = st["width"], st["height"]; rot = 0; dv = False
    for sd in st.get("side_data_list", []):
        if "rotation" in sd: rot = int(float(sd["rotation"]))
        if "dv_profile" in sd: dv = True
    if abs(rot) % 180 == 90: w, h = h, w
    n, d = map(int, st["r_frame_rate"].split("/"))
    trc = st.get("color_transfer", "")
    return {"w": w, "h": h, "fps": n / d, "dur": float(j["format"]["duration"]), "trc": trc,
            "hdr": trc in ("arib-std-b67", "smpte2084"), "dv": dv}


def run(cmd, **kw):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)
    if r.returncode != 0: raise RuntimeError(f"{pathlib.Path(str(cmd[0])).name} failed: {(r.stderr or r.stdout or '')[-600:]}")
    return r


def q(x): return round(round(x * FPS) / FPS, 4)     # every time on the 30 fps frame grid: preview = video, no drift


# ------------------------------------------------------------------ new take: proxy + Auto Edit plan + words
def safe_name(s): return re.sub(r"[^A-Za-z0-9_-]+", "_", str(s or "")).strip("_")[:50]


def free_name(base):
    """a New project never opens an old one by accident: IMG_9658 exists -> IMG_9658_2 (chat 8, L514)"""
    base = safe_name(base) or "project"; n = base; i = 2
    while (TAKES / n).exists(): n = f"{base}_{i}"; i += 1
    return n


AUTO_OPTS = {"cuts": True, "zooms": True, "stammers": False, "captions": True, "eyelock": False}


def new_take(src, aspect=None, redo=False, mode="auto", name=None, clip=None, opts=None):
    """mode auto = his auto.py cuts + zooms + caption words; plain = the whole video as one block (Auto Edit later, L519).
    opts (chat 9, L533) = which Auto Edit parts run: cuts (pauses out), zooms, stammers (repeated words out),
    captions (words from his voice), eyelock. Every part can be switched on or off later in the editor too."""
    src = str(pathlib.Path(src).resolve())
    if not os.path.isfile(src): raise FileNotFoundError(src)
    if JOB["state"] == "running": raise RuntimeError("another video is being prepared, wait for it to finish")
    if redo: name = S.ST["reel"] if is_take() else safe_name(pathlib.Path(src).stem)
    else: name = free_name(name or pathlib.Path(src).stem)
    JOB.update(state="running", pct=1, msg="reading the video", take=name, mode=mode, clip=clip if redo else None,
               opts=dict(AUTO_OPTS, **{k: bool(v) for k, v in (opts or {}).items() if k in AUTO_OPTS}))
    tdir(name).mkdir(parents=True, exist_ok=True)
    threading.Thread(target=_prepare, args=(src, name, aspect, redo, mode), daemon=True).start()
    return name


def _proxy(src, d, info):
    px = d / "proxy.mp4"
    if px.exists(): return px
    pw = 540 if info["w"] <= info["h"] else 960
    if info["hdr"] and FF_FULL.exists():   # the same Dolby Vision mapping as his SDR export, so the preview looks like the file
        vf = (f"libplacebo=w={pw}:h=-2:apply_dolbyvision=1:colorspace=bt709:color_primaries=bt709:"
              "color_trc=bt709:range=tv:format=yuv420p")
        run([FF_FULL, "-v", "error", "-y", "-init_hw_device", "vulkan", "-i", src, "-vf", vf, "-r", FPS, "-c:v", "libx264",
             "-preset", "veryfast", "-crf", 23, "-g", 8, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", px])
    else:
        run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"scale={pw}:-2,format=yuv420p", "-r", FPS, "-c:v", "libx264",
             "-preset", "veryfast", "-crf", 23, "-g", 8, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", px])
    return px


def _plain(src, name, aspect):
    d = tdir(name); info = probe(src)
    JOB.update(pct=10, msg="making the light preview copy (about 1 min)")
    _proxy(src, d, info)
    tk = {"src": src, "name": name, "info": info, "proxy": "proxy.mp4",
          "eyes": {"t": [0, info["dur"]], "x": [.5, .5], "y": [.36, .36]}, "noEyes": True,
          "blocks": [{"id": "b0", "in": 0, "out": q(info["dur"] - 0.5 / FPS), "zoom": 1.0, "shot": "wide"}],
          "settings": {"aspect": aspect or ("9:16" if info["h"] >= info["w"] else "16:9"), "eyelock": False, "lockY": None, "lockZoom": 1.12,
                       "safe": False, "caption": {"on": True, "look": "gw-signal", "size": 1.0, "y": None, "color": "", "stress": "", "font": ""}},
          "words": [], "auto": None, "made": time.strftime("%Y-%m-%d %H:%M")}
    save(tk, name); ensure_page(name)
    JOB.update(state="done", pct=100, msg="ready: the whole video is one clip. Split it with B, or Auto Edit it from the right panel")


def _prepare(src, name, aspect, redo, mode="auto"):
    if mode == "plain" and not redo:
        try: return _plain(src, name, aspect)
        except Exception as e: return JOB.update(state="error", msg=f"{type(e).__name__}: {e}")
    try:
        d = tdir(name); d.mkdir(parents=True, exist_ok=True); (d / "auto").mkdir(exist_ok=True)
        info = probe(src)
        old = load(name)   # kept on a redo too: his settings + caption words stay, only the blocks are re-made
        rng = JOB.get("clip")   # "Auto Edit this clip" (L519): the id of the one clip to re-cut
        # 1. light preview copy (keyframe every 0.25 s so scrubbing is instant)
        if not (d / "proxy.mp4").exists():
            JOB.update(pct=5, msg="making the light preview copy (about 1 min)")
            _proxy(src, d, info)
        # 2. Auto Edit = his auto.py (cuts + zooms + eye track), plan only
        JOB.update(pct=40, msg="Auto Edit: finding pauses, your face and eyes (about 2 min)")
        out = d / "auto"; py = autopy()
        O = JOB.get("opts") or AUTO_OPTS
        if O["stammers"]: JOB.update(msg="Auto Edit: finding pauses + repeated words (listens to your voice, about 5-10 min)")
        for f in out.glob("*_plan.json"): f.unlink()   # a fresh plan every run (switches may differ from last time)
        run([py, AUTO, src, "--plan-only", "--single", "--out", out, *(["--stammer-cuts", "--model", "small"] if O["stammers"] else [])], cwd=str(AUTO.parent))
        plan = json.loads(next(out.glob("*_plan.json")).read_text())
        work = next(out.glob("*_work"))
        ef = sorted(work.glob("eyes_*.json"), key=lambda p: p.stat().st_mtime)
        eyes = json.loads(ef[-1].read_text()) if ef else {"t": [0, info["dur"]], "x": [.5, .5], "y": [.36, .36]}
        blocks = []
        for i, ((a, b), z) in enumerate(zip(plan["segments"], plan["zoom"])):
            a = q(a); b = q(b)
            if b - a < 2 / FPS: continue
            blk = {"id": f"b{i}", "in": a, "out": b, "zoom": round(z[1], 3), "shot": z[0]}
            if len(z) > 3 and abs(z[2] - z[1]) > 1e-3: blk.update(zoomTo=round(z[2], 3), ease=round(float(z[3]), 3))   # auto.py's slow push in / out
            blocks.append(blk)
        if not O["cuts"]: blocks = keep_pauses(blocks, info["dur"])   # cuts off: the pauses stay, each clip runs on to the next
        tk = old or {}
        tk.update(src=src, name=name, info=info, proxy="proxy.mp4", eyes={"t": eyes["t"], "x": eyes["x"], "y": eyes["y"]}); tk.pop("noEyes", None)
        clip = rng and old and next((x for x in old.get("blocks", []) if x["id"] == rng), None)
        if clip:   # "Auto Edit this clip" (L519): that one clip is replaced, in its place, by the Auto Edit cuts inside it
            a, b = clip["in"], clip["out"]; stamp = int(time.time()) % 100000
            new = [dict(x, id=f"a{stamp}_{i}", **{"in": max(x["in"], a), "out": min(x["out"], b)}) for i, x in enumerate(blocks) if x["out"] > a and x["in"] < b]
            new = [x for x in new if x["out"] - x["in"] >= 2 / FPS]
            i = old["blocks"].index(clip)
            if new: tk["blocks"] = old["blocks"][:i] + new + old["blocks"][i + 1:]
            blocks = new
        elif not old or redo: tk["blocks"] = blocks
        tk.setdefault("settings", {"aspect": aspect or ("9:16" if info["h"] >= info["w"] else "16:9"), "eyelock": False,
                                   "lockY": None, "lockZoom": 1.12, "safe": False,
                                   "caption": {"on": True, "look": "gw-signal", "size": 1.0, "y": None, "color": "", "stress": "", "font": ""}})
        if not (rng and old):   # the switches he picked (a clip re-cut keeps the project's own)
            tk["settings"]["zooms"] = O["zooms"]; tk["settings"]["eyelock"] = O["eyelock"] or tk["settings"].get("eyelock", False)
            tk["settings"]["pauses"] = "cut" if O["cuts"] else "kept"; tk["settings"]["caption"]["on"] = O["captions"]
            tk["autoOpts"] = O
        tk.setdefault("words", []); tk["auto"] = {"made": time.strftime("%Y-%m-%d %H:%M"), "cuts": len(blocks), "kept": round(sum(x["out"] - x["in"] for x in blocks), 2)}
        save(tk, name); ensure_page(name)
        # 3. words for captions (Whisper, slower: the blocks are already usable while this runs)
        if not O["captions"] and not tk["words"]:
            return JOB.update(state="done", pct=100, msg=f"ready: {len(tk['blocks'])} clips (captions off: switch them on any time in Captions)")
        JOB.update(pct=70, msg="captions: listening to your words (about 5-10 min, you can edit meanwhile)")
        if not tk["words"]:
            ws = read_words(work)
            if not ws:   # the 'small' model: the 'medium' one ran out of memory on this PC (chat 5); English captions either way
                try: run([py, AUTO, src, "--plan-only", "--single", "--captions", "--model", "small", "--out", out], cwd=str(AUTO.parent)); ws = read_words(work)
                except Exception as e: JOB.update(state="error", msg=f"cuts + zooms are ready, but the caption words could not be made: {e}"); return
            tk = load(name); tk["words"] = ws; save(tk, name)
        JOB.update(state="done", pct=100, msg=f"ready: {len(tk['blocks'])} blocks, {len(tk['words'])} words")
    except Exception as e:
        JOB.update(state="error", msg=f"{type(e).__name__}: {e}")


def keep_pauses(blocks, total):
    """Auto Edit without cutting the pauses: every clip starts where the one before ended, so nothing is removed;
    each keeps its own zoom (cutIn remembers the cut, so the editor's 'Cut the pauses' switch can bring it back)"""
    out = []; prev = 0.0
    for i, b in enumerate(blocks):
        nb = dict(b, cutIn=b["in"], cutOut=b["out"], **{"in": q(prev)})
        if i == len(blocks) - 1: nb["out"] = q(total - 0.5 / FPS)
        out.append(nb); prev = nb["out"] if i == len(blocks) - 1 else b["out"]
    return out


def read_words(work):
    """English words with source times: auto.py's translation when he spoke Tamil/Tanglish, else the transcript itself"""
    tr = list(work.glob("words_translate_*.json"))
    if tr:
        out = []
        for sg in json.loads(tr[0].read_text(encoding="utf-8")).get("segments", []):
            n = len(sg["words"]); span = sg["e"] - sg["s"]
            for i, w in enumerate(sg["words"]):
                out.append({"w": w.strip(), "s": round(sg["s"] + span * i / max(1, n), 3), "e": round(sg["s"] + span * (i + 1) / max(1, n), 3)})
        if out: return out
    wf = [f for f in work.glob("words_*.json") if "translate" not in f.name]
    if wf:   # the file with the most words (a failed run leaves an empty one)
        j = max((json.loads(f.read_text(encoding="utf-8")) for f in wf), key=lambda d: len(d.get("words", [])))
        return [{"w": w["w"].strip(), "s": round(w["s"], 3), "e": round(w["e"], 3)} for w in j.get("words", []) if w.get("w", "").strip()]
    return []


# ------------------------------------------------------------------ framing (same maths as take_reel.html: preview = video)
def out_size(tk, size=None):
    if size: return int(size[0]) // 2 * 2, int(size[1]) // 2 * 2
    return (1080, 1920) if tk["settings"]["aspect"] == "9:16" else (1920, 1080)


def interp(t, T, V):
    if t <= T[0]: return V[0]
    if t >= T[-1]: return V[-1]
    lo, hi = 0, len(T) - 1
    while hi - lo > 1:
        m = (lo + hi) // 2
        if T[m] <= t: lo = m
        else: hi = m
    f = (t - T[lo]) / (T[hi] - T[lo] or 1)
    return V[lo] + (V[hi] - V[lo]) * f


def zoom_at(tk, b, src_t):
    """the clip's zoom at one moment (same maths as take_reel.html zoomAt, chat 9 L533):
    zoom = start, zoomTo = end (a slow zoom in / out), ease > 0 = auto.py's smooth move over that many seconds then hold.
    Auto zooms switched off (settings.zooms False) = 1, except a zoom he set by hand on that clip (zoomBy 'hand')."""
    if tk["settings"].get("zooms") is False and b.get("zoomBy") != "hand": return 1.0
    z0 = float(b.get("zoom") or 1.0); z1 = b.get("zoomTo"); z1 = z0 if z1 is None else float(z1)
    if abs(z1 - z0) < 1e-4: return z0
    L = max(b["out"] - b["in"], 1e-3); e = float(b.get("ease") or 0)
    p = min(max((src_t - b["in"]) / (min(e, L) if e > 0 else L), 0.0), 1.0)
    if e > 0: p = p * p * (3 - 2 * p)
    return z0 + (z1 - z0) * p


def moving(tk, b):
    return abs(zoom_at(tk, b, b["in"]) - zoom_at(tk, b, b["out"])) > 1e-3


def window(tk, b, src_t, OW, OH):
    """crop window (x0, y0 in source px) and scale s for one moment of a block"""
    W, H = tk["info"]["w"], tk["info"]["h"]; st = tk["settings"]; E = tk["eyes"]
    s0 = max(OW / W, OH / H); lock = st.get("eyelock")
    z = zoom_at(tk, b, src_t) * (st.get("lockZoom", 1.12) if lock else 1.0)
    s = s0 * z
    ex, ey = interp(src_t, E["t"], E["x"]) * W, interp(src_t, E["t"], E["y"]) * H
    if lock:   # eyes pinned to one screen point for the whole video (auto_lock.py rule); the block zooms in just enough (eyelock.py, max 1.8x)
        ly = st.get("lockY")
        if ly is None:   # auto: where the eyes naturally sit (same as take_reel.html autoY)
            ys = sorted(E["y"]); m = ys[len(ys) // 2] if ys else 0.36
            ly = min(max((OH / 2 + (m * H - H / 2) * s0 * st.get("lockZoom", 1.12)) / OH, 0.25), 0.6)
        px, py = OW * 0.5, OH * ly
        need = 0.0; tt = b["in"]
        while tt <= b["out"] + 1e-6:
            u = min(tt, b["out"]); qx, qy = interp(u, E["t"], E["x"]) * W, interp(u, E["t"], E["y"]) * H
            need = max(need, px / max(qx, 1), (OW - px) / max(W - qx, 1), py / max(qy, 1), (OH - py) / max(H - qy, 1)); tt += 0.25
        s = min(max(s, need), s0 * max(z, 1.8))
    else:      # wide = centred on him; zooms pivot on the eyes (auto.py rule: eyes never jump between wide and tight)
        x1 = min(max(ex - OW / s0 / 2, 0), W - OW / s0); y1 = min(max(ey - OH / s0 * 0.4, 0), H - OH / s0)
        eb = tk["eyes"]; mid = (b["in"] + b["out"]) / 2   # wide framing from the block middle: steady inside a block
        exm, eym = interp(mid, eb["t"], eb["x"]) * W, interp(mid, eb["t"], eb["y"]) * H
        x1 = min(max(exm - OW / s0 / 2, 0), W - OW / s0); y1 = min(max(eym - OH / s0 * 0.4, 0), H - OH / s0)
        px, py = (exm - x1) * s0, (eym - y1) * s0; ex, ey = exm, eym
    vw, vh = OW / s, OH / s
    x0 = min(max(ex - px / s, 0), W - vw); y0 = min(max(ey - py / s, 0), H - vh)
    return x0, y0, s


def piece_filter(tk, b, n, OW, OH, fps=FPS, sp=1.0):
    """ffmpeg filter for one block: scale once, crop that follows the eyes (piecewise-linear over the 4/s eye samples)"""
    lock = tk["settings"].get("eyelock")
    pre = f"setpts=(PTS-STARTPTS)/{sp:.5f}," if abs(sp - 1) > 1e-4 else ""
    if moving(tk, b):   # a zoom in / out inside the clip (chat 9): the size changes every frame, the crop follows (eyes stay put)
        W, H = tk["info"]["w"], tk["info"]["h"]; pts = []; k = max(0.1, n / fps / 60); tt = 0.0   # at most ~60 steps: ffmpeg's nested if() stays small
        while tt < n / fps + k:
            x0, y0, s = window(tk, b, min(b["in"] + tt * sp, b["out"]), OW, OH); pts.append((tt, x0 * s, y0 * s, s)); tt += k
        def pw(i):
            e = f"{pts[-1][i]:.5f}"
            for j in range(len(pts) - 2, -1, -1):
                (t0, *a), (t1, *c) = pts[j], pts[j + 1]
                e = f"if(lt(t\\,{t1:.3f})\\,{a[i - 1]:.5f}+({c[i - 1] - a[i - 1]:.6f})*(t-{t0:.3f})/{t1 - t0:.3f}\\,{e})"
            return e
        sw = f"max({OW}\\,trunc({W}*({pw(3)})/2)*2)"; sh = f"max({OH}\\,trunc({H}*({pw(3)})/2)*2)"
        return (f"{pre}fps={fps},scale=w='{sw}':h='{sh}':eval=frame:flags=lanczos,"
                f"crop={OW}:{OH}:'max(0\\,min({pw(1)}\\,iw-{OW}))':'max(0\\,min({pw(2)}\\,ih-{OH}))',setsar=1")
    _, _, s = window(tk, b, b["in"], OW, OH)
    W, H = tk["info"]["w"], tk["info"]["h"]; SW, SH = int(round(W * s / 2)) * 2, int(round(H * s / 2)) * 2
    sx, sy = SW / W, SH / H
    if not lock:
        x0, y0, _ = window(tk, b, b["in"], OW, OH)
        xe, ye = f"{min(int(x0 * sx), SW - OW)}", f"{min(int(y0 * sy), SH - OH)}"
    else:
        pts = []; k = 0.25
        tt = 0.0
        while tt < n / fps + k:
            x0, y0, _ = window(tk, b, b["in"] + tt * sp, OW, OH); pts.append((tt, min(x0 * sx, SW - OW), min(y0 * sy, SH - OH))); tt += k
        def expr(i):
            e = f"{pts[-1][i]:.1f}"
            for j in range(len(pts) - 2, -1, -1):
                (t0, *a), (t1, *c) = pts[j], pts[j + 1]
                e = f"if(lt(t\\,{t1:.3f})\\,{a[i - 1]:.1f}+({c[i - 1] - a[i - 1]:.2f})*(t-{t0:.3f})/{t1 - t0:.3f}\\,{e})"
            return e
        xe, ye = expr(1), expr(2)
    return f"{pre}fps={fps},scale={SW}:{SH}:flags=lanczos,crop={OW}:{OH}:{xe}:{ye},setsar=1"


# ------------------------------------------------------------------ export
def export(body, EXP):
    tk = body.get("take") or load(); name = S.ST["reel"]
    if body.get("take"): save(tk)
    OW, OH = out_size(tk, body.get("size")); fps_out = int(body.get("fps") or FPS)
    want_hdr = body.get("range") == "HDR"; src_hdr = tk["info"]["hdr"]
    EXP["folder"] = ""
    folder = body.get("mode") == "folder"   # "Me without background + project folder" (chat 9, L534): clean picture, no captions, SDR
    if folder: want_hdr = False
    if want_hdr and not src_hdr: raise RuntimeError("this take was not filmed in HDR, so the video can only be SDR")
    limit = float(body.get("seconds") or 0)
    blocks = []; acc = 0.0
    for b in tk["blocks"]:
        L = q((b["out"] - b["in"]) / float(b.get("speed") or 1))
        if limit and acc >= limit: break
        if limit and acc + L > limit: L = q(limit - acc)
        if L >= 1 / FPS: blocks.append((b, L)); acc += L
    total = acc
    tag = body.get("name") or "edit"; tag = tag if S.SAFE.match(tag) else "edit"
    if folder: tag = "folder" + ("_test" if limit else "")
    dest = S.PROJECTS / "exports" / f"take_{name}_{tag}"
    mfull = tdir(name) / "cutout" / "mask_full.mp4"
    hide_any = any(b.get("bg") == "hide" for b, _ in blocks)
    if (hide_any or folder) and not mfull.exists(): raise RuntimeError("nothing is cut out yet: pick clips and press Cut me out first")
    if dest.exists(): shutil.rmtree(dest)
    (dest / "pieces").mkdir(parents=True)
    src = tk["src"]; trc = tk["info"]["trc"]
    X265 = f"colorprim=bt2020:transfer={trc}:colormatrix=bt2020nc:vbv-maxrate=40000:vbv-bufsize=80000:log-level=error"
    HTAGS = ["-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", trc]
    SDRTAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    t0 = time.time()

    # 1. picture: one piece per block (same framing maths as the preview)
    starts = []; acc0 = 0.0
    for b, L in blocks: starts.append(acc0); acc0 += L
    def enc_piece(i, b, L):
        n = int(round(L * fps_out)); p = dest / "pieces" / f"p{i:04d}.mp4"; sp = float(b.get("speed") or 1)
        vf = piece_filter(tk, b, n, OW, OH, fps_out, sp)
        extra = FXF.piece(tk.get("fx"), tk, b, starts[i], n, fps_out, OW, OH)   # his filters / adjust / effects (same maths as the preview)
        if extra: vf += "," + extra
        if tk["settings"].get("hideVideo") or b.get("hide"): vf += ",drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill"   # hidden = black (L506)
        vff = dest / "pieces" / f"p{i:04d}.vf"; vff.write_text(vf, encoding="utf-8")
        if src_hdr:   # keep the HDR + Dolby Vision as it was filmed (October fix)
            enc = ["-c:v", "libx265", "-dolbyvision", "1", "-preset", "fast", "-crf", "14", "-pix_fmt", "yuv420p10le",
                   "-tag:v", "hvc1", "-x265-params", X265, *HTAGS]
        else:
            enc = ["-c:v", "libx264", "-preset", "fast", "-crf", "14", "-pix_fmt", "yuv420p", *SDRTAGS]
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{b['in']:.4f}", "-i", src, "-frames:v", n, "-map", "0:v:0", "-/vf", vff,
             *enc, "-an", "-strict", "unofficial", p])
        return p
    from concurrent.futures import ThreadPoolExecutor
    EXP.update(pct=3, msg=f"picture: 0/{len(blocks)} blocks")
    done = [0]; paths = [None] * len(blocks)
    def job(i):
        paths[i] = enc_piece(i, *blocks[i]); done[0] += 1
        EXP.update(pct=int(3 + 50 * done[0] / len(blocks)), msg=f"picture: {done[0]}/{len(blocks)} blocks")
    with ThreadPoolExecutor(2) as ex: list(ex.map(job, range(len(blocks))))   # 2 at a time: this PC has 7 GB and other chats run too
    (dest / "pieces.txt").write_text("".join(f"file '{p.as_posix()}'\n" for p in paths), encoding="utf-8")
    cat = dest / "picture.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", dest / "pieces.txt", "-c", "copy", "-strict", "unofficial", cat])
    mask = None
    if hide_any or folder:   # the cut-out mask, cut + zoomed exactly like the picture (same filter per clip); white = keep
        EXP.update(pct=50, msg="cut-out: lining your mask up with the clips")
        mask = mask_track(tk, blocks, fps_out, OW, OH, dest, mfull, every=folder)
    if hide_any and not folder:   # hidden backgrounds in a normal MP4: his colour behind him (see-through has to be black in an MP4)
        col = tk["settings"].get("bgColor") or "clear"; col = "#000000" if col == "clear" else col
        EXP.update(pct=52, msg="cut-out: hiding the background")
        cat2 = dest / "picture_bg.mp4"
        enc = (["-c:v", "libx265", "-dolbyvision", "1", "-preset", "fast", "-crf", "14", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-x265-params", X265, *HTAGS]
               if src_hdr else ["-c:v", "libx264", "-preset", "fast", "-crf", "14", "-pix_fmt", "yuv420p", *SDRTAGS])
        pf = "yuva444p10le" if src_hdr else "yuva444p"
        run(["ffmpeg", "-v", "error", "-y", "-i", cat, "-i", mask, "-f", "lavfi", "-i", f"color=c={col.replace('#', '0x')}:s={OW}x{OH}:r={fps_out}",
             "-filter_complex", f"[1:v]format=gray,setsar=1[m];[0:v]format={pf},setsar=1[p];[p][m]alphamerge[fg];[2:v][fg]overlay=shortest=1:format=auto[v]",
             "-map", "[v]", *enc, "-strict", "unofficial", cat2])
        cat.unlink(missing_ok=True); cat = cat2

    # 2. sound: the same blocks from the take, 20 ms fade at every join, -14 LUFS (auto.py / build_reel rule) + his added sounds
    EXP.update(pct=55, msg="sound: cutting your voice to the blocks")
    parts, labels = [], []
    def tempo(sp):   # atempo takes 0.5-2 per step: 3x = 2 x 1.5 (voice keeps its pitch)
        out = []
        while sp > 2.0 + 1e-9: out.append("atempo=2.0"); sp /= 2.0
        while sp < 0.5 - 1e-9: out.append("atempo=0.5"); sp /= 0.5
        if abs(sp - 1) > 1e-4: out.append(f"atempo={sp:.5f}")
        return "".join("," + x for x in out)
    for i, (b, L) in enumerate(blocks):
        sp = float(b.get("speed") or 1); a, e = b["in"], b["in"] + L * sp
        mute = ",volume=0" if b.get("mute") else (f",volume={float(b['gain']):.2f}dB" if b.get("gain") else "")   # a muted block stays, silent (L506); clip loudness (chat 8)
        parts.append(f"[0:a:0]atrim={a:.4f}:{e:.4f},asetpts=PTS-STARTPTS{tempo(sp)},atrim=0:{L:.4f},apad=whole_dur={L:.4f},afade=t=in:d=0.02,afade=t=out:st={max(0, L - 0.02):.4f}:d=0.02{mute}[a{i}]")
        labels.append(f"[a{i}]")
    (dest / "voice.graph").write_text(";".join(parts) + ";" + "".join(labels) + f"concat=n={len(blocks)}:v=0:a=1[cat]", encoding="utf-8")
    raw = dest / "voice_raw.wav"
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-/filter_complex", dest / "voice.graph", "-map", "[cat]", "-ar", "48000", "-c:a", "pcm_s16le", raw])
    LN = "loudnorm=I=-14:TP=-2:LRA=11"
    voice = dest / "voice.wav"
    if tk["settings"].get("muteVoice") or all(b.get("mute") for b, _ in blocks):   # voice muted: silence of the same length
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{total:.3f}", "-c:a", "pcm_s16le", voice])
    else:
        lg = subprocess.run(["ffmpeg", "-i", str(raw), "-af", LN + ":print_format=json", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
        m = json.loads(re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", lg, re.S)[-1])
        ln = f"{LN}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
        run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-af", ln, "-ar", "48000", voice])
    snd = voice
    items = [s for s in (body.get("sounds") or []) if not s.get("kit")]
    if items:
        S.mix_sounds(items, total, dest / "sounds.wav", S.reels_root())
        snd = dest / "sound.wav"
        run(["ffmpeg", "-v", "error", "-y", "-i", voice, "-i", dest / "sounds.wav", "-filter_complex",
             f"[0:a][1:a]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89[a]", "-map", "[a]", "-t", f"{total:.3f}", snd])

    # 3. captions: frames from the same page the preview uses (only frames that change are drawn)
    cap = None
    st = tk["settings"]
    if not folder and ((st["caption"].get("on") and tk.get("words")) or FXF.has_overlay(tk.get("fx"))):   # captions and/or his overlay effects (flash, dips, leak, grain, vignette)
        EXP.update(pct=60, msg="captions + effects: drawing frames")
        cap = caption_frames(dest, OW, OH, total, EXP)

    # 4. one final encode: picture + captions (+ safe zone never) + sound
    EXP.update(pct=88, msg="final file")
    label = f"{OW}x{OH}_{fps_out}fps"
    master = dest / f"{name}_{tag}_{label}_{'HDR' if src_hdr else 'SDR'}.mp4"
    ins = ["-i", cat]
    if cap: ins += ["-f", "concat", "-safe", "0", "-i", cap]
    ins += ["-i", snd]; ai = 2 if cap else 1
    sdr_from_hdr = src_hdr and not want_hdr
    cap_late = cap if sdr_from_hdr else None   # SDR from an HDR take: captions go on AFTER the Dolby Vision mapping, in exact SDR colours
    if sdr_from_hdr: ins = ["-i", cat, "-i", snd]; ai = 1; cap = None
    if cap and src_hdr:   # sRGB caption -> HLG at reference white (75 % signal), so white text is not a blinding 1000-nit white
        fc = ("[1:v]format=gbrapf32le,colorchannelmixer=rr=0.75:gg=0.75:bb=0.75,"   # caption white = HLG reference white (75 %, BT.2408)
              "scale=out_color_matrix=bt2020:out_range=tv,format=yuva444p10le[c];"
              f"[0:v][c]overlay=format=yuv444p10:eof_action=pass,format=yuv420p10le,fps={fps_out}[v]")
    elif cap:
        fc = f"[0:v][1:v]overlay=eof_action=pass,format=yuv420p,fps={fps_out}[v]"
    else:
        fc = f"[0:v]fps={fps_out}[v]"
    if src_hdr:
        enc = ["-c:v", "libx265", "-dolbyvision", "1", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-x265-params", X265, *HTAGS]
    else:
        enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p", *SDRTAGS]
    run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", fc, "-map", "[v]", "-map", f"{ai}:a", *enc,
         "-c:a", "aac", "-b:a", "256k", "-t", f"{total:.3f}", "-movflags", "+faststart", "-strict", "unofficial", master])
    final = master
    if src_hdr and not want_hdr:   # the SDR file the October way: the clip's own Dolby Vision mapping (GPU)
        EXP.update(pct=95, msg="SDR with your iPhone light (Dolby Vision mapping)")
        final = dest / f"{name}_{tag}_{label}_SDR.mp4"
        if FF_FULL.exists():
            lp = "libplacebo=apply_dolbyvision=1:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p"
            cin = ["-f", "concat", "-safe", "0", "-i", cap_late] if cap_late else []
            vf = ["-filter_complex", f"[0:v]{lp}[b];[b][1:v]overlay=eof_action=pass,format=yuv420p[v]", "-map", "[v]"] if cap_late else ["-vf", lp, "-map", "0:v:0"]
            run([FF_FULL, "-v", "error", "-y", "-init_hw_device", "vulkan", "-i", master, *cin, *vf, "-map", "0:a:0",
                 "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p", *SDRTAGS,
                 "-color_range", "tv", "-c:a", "copy", "-movflags", "+faststart", final])
            master.unlink(missing_ok=True)   # it was only the step in between (no captions on it)
        else:
            raise RuntimeError("the full ffmpeg with libplacebo is missing, so the SDR with your iPhone light could not be made (the HDR file is ready)")
    for p in (dest / "pieces",): shutil.rmtree(p, ignore_errors=True)
    for p in (raw, cat): pathlib.Path(p).unlink(missing_ok=True)
    if folder:
        final = kit_folder(tk, name, blocks, dest, final, mask, OW, OH, fps_out, total, EXP)
        for x in ("pieces.txt", "voice.graph", "voice.wav", "sounds.wav", "sound.wav"): (dest / x).unlink(missing_ok=True)
        EXP.update(state="done", pct=100, mp4=str(final), folder=str(dest), msg=f"folder ready: you without background (green, see-through MOV + WEBM), mask, clean edit, words ({total:.1f} s, {time.time() - t0:.0f}s to make)")
        return
    EXP.update(state="done", pct=100, mp4=str(final), msg=f"video ready: {OW}x{OH}, {fps_out} fps, {'HDR' if final == master and src_hdr else 'SDR'}, {total:.1f} s ({time.time() - t0:.0f}s to make)")


def mask_track(tk, blocks, fps_out, OW, OH, dest, mfull, every=False):
    """one grey video = the cut-out mask for the edited timeline: each clip's mask cut + zoomed with the SAME filter as its picture.
    A clip whose background stays (and every=False) gets plain white (= keep everything)."""
    W, H = tk["info"]["w"], tk["info"]["h"]; md = dest / "mpieces"; md.mkdir(exist_ok=True); paths = []
    for i, (b, L) in enumerate(blocks):
        n = int(round(L * fps_out)); pth = md / f"m{i:04d}.mp4"; sp = float(b.get("speed") or 1)
        if every or b.get("bg") == "hide":
            vf = f"scale={W}:{H}:flags=bicubic," + piece_filter(tk, b, n, OW, OH, fps_out, sp) + ",format=gray"
            vff = md / f"m{i:04d}.vf"; vff.write_text(vf, encoding="utf-8")
            run(["ffmpeg", "-v", "error", "-y", "-ss", f"{b['in']:.4f}", "-i", mfull, "-frames:v", n, "-/vf", vff,
                 "-c:v", "libx264", "-preset", "fast", "-crf", "8", "-pix_fmt", "yuv420p", "-an", pth])
        else:
            run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=white:s={OW}x{OH}:r={fps_out}", "-frames:v", n,
                 "-c:v", "libx264", "-preset", "fast", "-crf", "8", "-pix_fmt", "yuv420p", pth])
        paths.append(pth)
    (md / "list.txt").write_text("".join(f"file '{x.as_posix()}'\n" for x in paths), encoding="utf-8")
    out = dest / "mask.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", md / "list.txt", "-c", "copy", out])
    shutil.rmtree(md, ignore_errors=True)
    return out


def kit_folder(tk, name, blocks, dest, clean, mask, OW, OH, fps, total, EXP):
    """The project folder his kits can use straight away (L534): same file names as the Daily Usage Kit's matte.py
    (bg.mp4, person.webm, head.json) + green-screen MP4 + see-through MOV + mask + words on the edited timeline + README."""
    import numpy as np
    EXP.update(pct=96, msg="folder: you without background (green screen, see-through MOV + WEBM)")
    bg = dest / "bg.mp4"; os.replace(clean, bg)
    am = "[1:v]format=gray,setsar=1[m];[0:v]format=yuva444p,setsar=1[p];[p][m]alphamerge"
    run(["ffmpeg", "-v", "error", "-y", "-i", bg, "-i", mask, "-f", "lavfi", "-i", f"color=c=0x00ff00:s={OW}x{OH}:r={fps}",
         "-filter_complex", f"{am}[fg];[2:v][fg]overlay=shortest=1:format=auto,format=yuv420p[v]", "-map", "[v]", "-map", "0:a?",
         "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", dest / "person_green.mp4"])
    run(["ffmpeg", "-v", "error", "-y", "-i", bg, "-i", mask, "-filter_complex", f"{am},format=yuva444p10le[v]", "-map", "[v]", "-map", "0:a?",
         "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-c:a", "pcm_s16le", dest / "person_alpha.mov"])
    run(["ffmpeg", "-v", "error", "-y", "-i", bg, "-i", mask, "-filter_complex", f"{am},format=yuva420p[v]", "-map", "[v]", "-map", "0:a?",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "6M", "-auto-alt-ref", "0", "-deadline", "good", "-cpu-used", "4",
         "-c:a", "libopus", dest / "person.webm"])
    # head + body boxes per frame (matte.py format: head = top 22 % of the body box height), read from the mask at 1/4 size
    EXP.update(pct=98, msg="folder: where you are in each frame + words")
    sw, sh = OW // 4 // 2 * 2, OH // 4 // 2 * 2; fs = sw * sh; boxes = []
    rd = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(mask), "-vf", f"scale={sw}:{sh},format=gray", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    k = OW / sw
    while True:
        buf = rd.stdout.read(fs)
        if len(buf) < fs: break
        a = np.frombuffer(buf, np.uint8).reshape(sh, sw) > 128; ys, xs = np.nonzero(a)
        if not len(ys): boxes.append(None); continue
        top, bot = int(ys.min()), int(ys.max()); hb = top + int((sh - top) * 0.22); hx = np.nonzero(a[top:hb + 1].any(axis=0))[0]
        boxes.append({"head": [int(hx.min() * k), int(top * k), int(hx.max() * k), int(hb * k)], "body": [int(xs.min() * k), int(top * k), int(xs.max() * k), int(bot * k)]})
    rd.wait()
    (dest / "head.json").write_text(json.dumps({"fps": fps, "start": 0, "size": [OW, OH], "frames": boxes}), encoding="utf-8")
    # his words on the EDITED timeline (a word inside a cut part is dropped, like the sound)
    words = []; acc = 0.0
    for b, L in blocks:
        sp = float(b.get("speed") or 1)
        for w in tk.get("words") or []:
            m = (w["s"] + w["e"]) / 2
            if b["in"] <= m < b["out"] and (m - b["in"]) / sp < L:
                words.append({"w": w["w"], "s": round(acc + max(0, w["s"] - b["in"]) / sp, 3), "e": round(acc + min(L, (w["e"] - b["in"]) / sp), 3)})
        acc += L
    (dest / "words.json").write_text(json.dumps({"words": words}, indent=0), encoding="utf-8")
    (dest / "project").mkdir(exist_ok=True); (dest / "project" / "take.json").write_text(json.dumps(tk, indent=1), encoding="utf-8")
    (dest / "README.md").write_text(f"""# GEditor project folder: {name}

Made by GEditor on {time.strftime('%Y-%m-%d %H:%M')}. Everything below is already CUT (Auto Edit + his clip changes) and
CUT OUT (him + what he holds, away from the background). Use these files; do not cut or cut out again.

| File | What it is |
|---|---|
| bg.mp4 | the edited video WITH its background, {OW}x{OH}, {fps} fps, {total:.2f} s, his voice (-14 LUFS), no captions |
| person.webm | him alone, see-through around him (VP9 + alpha): for Remotion / web pages / kits |
| person_alpha.mov | him alone, see-through (ProRes 4444): for CapCut desktop, Premiere, DaVinci, Final Cut |
| person_green.mp4 | him alone on green (#00FF00): for any app with a green-screen / chroma key tool (Edits, CapCut phone) |
| mask.mp4 | black-and-white mask, frame for frame with bg.mp4: white = him, black = background |
| head.json | per frame: head box + body box in pixels (same format as the Daily Usage Kit's matte.py) |
| words.json | his words with times on THIS edited video (seconds) |
| project/take.json | the GEditor project file (open it again in GEditor to change the edit) |

For Claude: when Gautham says "use this GEditor folder", a kit skips its own cut + cut-out step:
- Daily Usage Kit: this folder already has matte.py's outputs (bg.mp4, person.webm, head.json); use it as the work folder.
- Any other kit: put things BEHIND him = layer order bg.mp4 -> your objects -> person.webm.
Reader: Common/tools/reel_editor/kitfolder.py (python kitfolder.py <this folder> = checks + prints the paths).
""", encoding="utf-8")
    return dest / "person_green.mp4"


def caption_frames(dest, OW, OH, total, EXP):
    """PNG frames of the caption layer only (transparent), from take_reel.html ?caponly=1. A frame is drawn only when the
    caption picture changes (capKey); the rest reuse it through an ffconcat list with durations."""
    from playwright.sync_api import sync_playwright
    cd = dest / "caps"; cd.mkdir()
    url = f"http://127.0.0.1:{S.ST['port']}/reel/reel.html?caponly=1&ow={OW}&oh={OH}"
    n = int(round(total * FPS)); lines = []; last = None; cur = None; run_n = 0; drawn = 0
    with sync_playwright() as pw:
        br = pw.chromium.launch(); pg = br.new_page(viewport={"width": OW, "height": OH})
        pg.goto(url); pg.wait_for_function("typeof window.at === 'function' && window.TOTAL > 0 && window.CAPREADY", timeout=60000)
        pg.evaluate("document.fonts.ready")
        def flush():
            if cur is not None and run_n: lines.append(f"file '{cur.name}'\nduration {run_n / FPS:.6f}\n")
        for i in range(n):
            ms = i * 1000 / FPS
            k = pg.evaluate(f"window.capKey({ms:.3f})")
            if k != last:
                flush(); run_n = 0
                pg.evaluate(f"window.at({ms:.3f})")
                cur = cd / f"c{drawn:05d}.png"; pg.screenshot(path=str(cur), omit_background=True); drawn += 1; last = k
            run_n += 1
            if i % 30 == 0: EXP.update(pct=int(60 + 27 * i / n), msg=f"captions: frame {i}/{n} ({drawn} drawn)")
        flush(); br.close()
    lines.append(f"file '{cur.name}'\n")   # concat demuxer: the last file again so its duration counts
    f = cd / "caps.ffconcat"; f.write_text("ffconcat version 1.0\n" + "".join(lines), encoding="utf-8")
    return f


# ------------------------------------------------------------------ HTTP
def get(h, p):
    if p == "/api/take/job": return h.send(200, json.dumps(JOB)) or True
    if p == "/api/take/info":
        if not is_take(): return h.send(200, "null") or True
        tk = load(); return h.send(200, json.dumps(tk)) or True
    if p == "/api/take/looks":
        f = TAKES / "_looks.json"; return h.send(200, f.read_bytes() if f.exists() else "[]") or True
    if p == "/api/take/inbox":   # his takes waiting in GauthamWho/Inbox (newest first)
        ib = HERE / "Inbox"
        l = sorted([f for f in ib.iterdir() if f.suffix.lower() in (".mov", ".mp4", ".m4v")], key=lambda f: -f.stat().st_mtime) if ib.exists() else []
        return h.send(200, json.dumps([{"path": str(f), "name": f.name, "mb": round(f.stat().st_size / 1e6)} for f in l])) or True
    return False


def post(h, p):
    if p == "/api/take/upload":   # New project from his computer / Mac / iPhone: the video is streamed to the PC (L514)
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query)
        nm = re.sub(r"[^A-Za-z0-9._-]", "_", (qs.get("name") or ["video.mp4"])[0])[-80:]
        if pathlib.Path(nm).suffix.lower() not in (".mov", ".mp4", ".m4v", ".mkv", ".webm"): return h.send(400, json.dumps({"error": "pick a video file (.mov, .mp4, .m4v, .mkv, .webm)"})) or True
        n = int(h.headers.get("Content-Length") or 0); up = TAKES / "_uploads"; up.mkdir(parents=True, exist_ok=True)
        f = up / nm
        if f.exists() and f.stat().st_size == n: return h.send(200, json.dumps({"path": str(f), "same": True})) or True
        tmp = up / (nm + ".part")
        with open(tmp, "wb") as o:
            left = n
            while left > 0:
                c = h.rfile.read(min(1 << 20, left))
                if not c: break
                o.write(c); left -= len(c)
        if left: tmp.unlink(missing_ok=True); return h.send(400, json.dumps({"error": "the upload stopped half way, try again"})) or True
        os.replace(tmp, f); return h.send(200, json.dumps({"path": str(f)})) or True
    if p == "/api/take/new":
        b = h.body()
        try: name = new_take(b["path"], b.get("aspect"), b.get("redo"), b.get("mode") or "auto", b.get("name"), b.get("clip"), b.get("opts"))
        except Exception as e: return h.send(400, json.dumps({"error": str(e)})) or True
        S.ST["kit"] = "take"; S.ST["reel"] = name
        return h.send(200, json.dumps({"ok": True, "reel": name})) or True
    if p == "/api/take/words":   # captions for a Plain project: listen to his voice (Whisper via auto.py), words land in the take
        if not is_take(): return h.send(400, '{"error":"not a take"}') or True
        if JOB["state"] == "running": return h.send(409, json.dumps({"error": "another job is running, wait for it"})) or True
        name = S.ST["reel"]; JOB.update(state="running", pct=5, msg="captions: listening to your words (about 5-10 min)", take=name, mode="words", clip=None)
        def wj():
            try:
                tk = load(name); out = tdir(name) / "auto"; out.mkdir(exist_ok=True); py = autopy()
                work = next(out.glob("*_work"), None); ws = read_words(work) if work else []
                if not ws:
                    run([py, AUTO, tk["src"], "--plan-only", "--single", "--captions", "--model", "small", "--out", out], cwd=str(AUTO.parent))
                    ws = read_words(next(out.glob("*_work")))
                tk = load(name); tk["words"] = ws; save(tk, name)
                JOB.update(state="done", pct=100, msg=f"captions ready: {len(ws)} words")
            except Exception as e: JOB.update(state="error", msg=f"captions could not be made: {e}")
        threading.Thread(target=wj, daemon=True).start(); return h.send(200, '{"ok":true}') or True
    if p == "/api/project":   # Projects page right-click: rename / copy / delete (to the bin) his own projects (chat 8 plan)
        b = h.body(); act = b.get("act"); n = b.get("reel", "")
        if not S.SAFE.match(n) or not (TAKES / n).is_dir(): return h.send(400, '{"error":"only your own video projects can be changed here"}') or True
        if act == "rename" or act == "copy":
            new = free_name(b.get("to") or (n + "_copy"))
            if act == "copy": shutil.copytree(TAKES / n, TAKES / new, ignore=shutil.ignore_patterns("auto"))
            else:
                if S.ST["kit"] == "take" and S.ST["reel"] == n: S.ST["reel"] = new
                os.replace(TAKES / n, TAKES / new)
            for f in S.PROJECTS.glob(f"take__{n}.*.json"):
                dst = S.PROJECTS / f.name.replace(f"take__{n}.", f"take__{new}.", 1)
                shutil.copyfile(f, dst) if act == "copy" else os.replace(f, dst)
            tk = load(new)
            if tk: tk["name"] = new; save(tk, new)
            return h.send(200, json.dumps({"ok": True, "reel": new})) or True
        if act == "delete":
            bin_ = S.PROJECTS / "_bin" / time.strftime("%Y%m%d_%H%M%S"); bin_.mkdir(parents=True, exist_ok=True)
            os.replace(TAKES / n, bin_ / n)
            for f in S.PROJECTS.glob(f"take__{n}.*.json"): os.replace(f, bin_ / f.name)
            if S.ST["kit"] == "take" and S.ST["reel"] == n: S.ST["reel"] = ""
            return h.send(200, json.dumps({"ok": True, "bin": str(bin_)})) or True
        return h.send(400, '{"error":"unknown action"}') or True
    if p == "/api/take/looks":
        TAKES.mkdir(parents=True, exist_ok=True); (TAKES / "_looks.json").write_text(json.dumps(h.body()), encoding="utf-8"); return h.send(200, '{"ok":true}') or True
    if p == "/api/take/save":
        if not is_take(): return h.send(400, '{"error":"not a take"}') or True
        tk = h.body().get("take")
        if not tk or "blocks" not in tk: return h.send(400, '{"error":"no take"}') or True
        save(tk); return h.send(200, '{"ok":true}') or True
    return False

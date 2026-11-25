"""cutout.py: GEditor's Cut-out (Reel Editor LEDGER L534, L536). Runs on this computer, no AI service, no Claude.

He picks clips (or the whole video) and presses "Cut me out". Every frame of that part gets a black-and-white mask:
white = him + whatever he holds (mug, phone, pen: L536), black = the background.
  Fast = people model (u2net_human_seg) + a general "what is in front" model (u2net); the front things are kept only
         where they touch him, so a mug in his hand stays and a chair far behind does not.
  Best = the same rule with BiRefNet (cleaner hair and fingers, several times slower).
Masks are saved one by one (a crash or a closed window resumes where it stopped).

A take's cut-out lives in projects/take/<name>/cutout/:
  masks/f000123.png  = the mask of source frame 123 (30 fps, source time 123/30 s), full size, 8-bit
  index.json         = which frames are done and with which engine
  mask_full.mp4      = every source frame's mask as one grey video (white where not cut out) -> export
  mask_proxy.mp4     = the same, 540 wide -> live preview (Hide background)
Endpoints: GET /api/cutout/job, /api/cutout/info; POST /api/cutout/run {ranges: [[a, b] source seconds], engine},
POST /api/cutout/stop."""
import json, pathlib, subprocess, threading, time
import numpy as np

FPS = 30
JOB = {"state": "idle", "pct": 0, "msg": "", "take": ""}
STOP = threading.Event()
S = None; TA = None
SESS = {}
MODELS = {"fast": "u2net", "best": "birefnet-general-lite"}


def init(server, take_api): global S, TA; S, TA = server, take_api
def cdir(name=None): return TA.tdir(name) / "cutout"
def idx_file(name=None): return cdir(name) / "index.json"
def load_idx(name=None):
    f = idx_file(name)
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"fps": FPS, "frames": {}}
def save_idx(ix, name=None): idx_file(name).write_text(json.dumps(ix), encoding="utf-8")


def sess(m):
    if m not in SESS:
        from rembg import new_session
        SESS[m] = new_session(m)   # first use downloads the model once (~176 / 224 MB) into ~/.u2net or ~/.rembg
    return SESS[m]


def work_size(info):
    W, H = info["w"], info["h"]; k = min(1.0, 1080 / min(W, H))   # full size up to 1080 on the short side
    return int(round(W * k / 2)) * 2, int(round(H * k / 2)) * 2


def combine(hum, gen, engine):
    """hum = people mask, gen = 'in front' mask (0-255). Keeps him + the front things that touch him (L536)."""
    import cv2
    core = hum > 128
    if not core.any(): return gen if engine == "best" else np.maximum(gen, hum)
    h, w = hum.shape; r = max(3, int(0.03 * min(h, w)))
    near = cv2.dilate(core.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0
    wide = cv2.dilate(core.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (8 * r + 1, 8 * r + 1))) > 0
    n, lab = cv2.connectedComponents((gen > 128).astype(np.uint8), connectivity=8)
    keep = np.zeros_like(core); parea = core.sum()
    for c in range(1, n):
        comp = lab == c
        if not (comp & near).any(): continue                     # not touching him: background furniture, a lamp...
        if (comp & ~wide).sum() > 0.6 * parea: comp = comp & wide  # a huge blob (a wall seen as 'front'): only the part close to him
        keep |= comp
    kept = np.where(keep | (gen > 128) & near, gen, 0).astype(np.uint8)
    if engine == "best":   # BiRefNet edges win; the people mask only fills holes inside him
        inner = cv2.erode(core.astype(np.uint8), np.ones((5, 5), np.uint8)) * 255
        return np.maximum(kept, inner.astype(np.uint8))
    return np.maximum(kept, hum)


def mask_for(rgb, engine):
    from PIL import Image
    from rembg import remove
    im = Image.fromarray(rgb)
    hum = np.array(remove(im, session=sess("u2net_human_seg"), only_mask=True).convert("L"))
    gen = np.array(remove(im, session=sess(MODELS[engine]), only_mask=True).convert("L"))
    return combine(hum, gen, engine)


# ------------------------------------------------------------------ the job
def run(name, ranges, engine):
    from PIL import Image
    tk = TA.load(name); src = tk["src"]; info = tk["info"]; MW, MH = work_size(info)
    d = cdir(name); md = d / "masks"; md.mkdir(parents=True, exist_ok=True)
    ix = load_idx(name); fr = ix["frames"]
    last_f = int(info["dur"] * FPS) - 1
    todo = []
    for a, b in ranges:
        f0, f1 = max(0, int(round(a * FPS))), min(last_f, int(round(b * FPS)))
        if f1 >= f0: todo.append((f0, f1))
    total = sum(f1 - f0 + 1 for f0, f1 in todo) or 1; done = 0; t0 = time.time()
    JOB.update(pct=1, msg=f"loading the {'Best' if engine == 'best' else 'Fast'} cut-out model (first time: downloads it once)")
    for k in [k for k in SESS if k not in ("u2net_human_seg", MODELS[engine])]: SESS.pop(k)   # this PC has little memory: one model pair at a time
    sess("u2net_human_seg"); sess(MODELS[engine])
    step = 2 if engine == "fast" else 1   # Fast: every 2nd frame is worked out, the one between = the blend of its two neighbours (half the time)
    for f0, f1 in todo:
        n = f1 - f0 + 1
        rd = subprocess.Popen(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{f0 / FPS:.4f}", "-i", src, "-frames:v", str(n), "-r", str(FPS),
                               "-vf", f"fps={FPS},scale={MW}:{MH},format=rgb24", "-f", "rawvideo", "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        fs = MW * MH * 3; prev = None; pend = None
        for k in range(n):
            if STOP.is_set(): rd.kill(); save_idx(ix, name); raise InterruptedError("stopped")
            buf = rd.stdout.read(fs)
            if len(buf) < fs: break
            fi = f0 + k; key = str(fi); out = md / f"f{fi:06d}.png"
            have = out.exists() and (fr.get(key) == engine or (engine == "fast" and fr.get(key) == "best"))
            if not have and step == 2 and k % 2 == 1 and k < n - 1: pend = fi; done += 1; continue   # filled in when the next frame is known
            m = np.array(Image.open(out).convert("L")) if have else mask_for(np.frombuffer(buf, np.uint8).reshape(MH, MW, 3), engine)
            if not have: Image.fromarray(m).save(out, optimize=False, compress_level=1); fr[key] = engine
            if pend is not None:
                mid = ((prev.astype(np.uint16) + m) // 2).astype(np.uint8) if prev is not None else m
                Image.fromarray(mid).save(md / f"f{pend:06d}.png", optimize=False, compress_level=1); fr[str(pend)] = engine; pend = None
            prev = m; done += 1
            if done % 15 == 0 or done == total:
                el = time.time() - t0; left = el / done * (total - done)
                JOB.update(pct=int(2 + 88 * done / total), msg=f"cutting you out: frame {done}/{total} · about {int(left // 60)} min {int(left % 60)} s left")
                save_idx(ix, name)
        rd.stdout.close(); rd.kill()
    save_idx(ix, name)
    JOB.update(pct=91, msg="making the mask videos for the preview and the export")
    mask_videos(name)
    tk = TA.load(name); tk["cutout"] = {"made": time.strftime("%Y-%m-%d %H:%M"), "v": int(time.time())}; TA.save(tk, name)
    JOB.update(state="done", pct=100, msg=f"cut-out ready: {done} frames ({(time.time() - t0) / 60:.1f} min)")


def mask_videos(name):
    """mask_full.mp4 (export) + mask_proxy.mp4 (preview): one grey frame per source frame, white where nothing was cut out"""
    from PIL import Image
    tk = TA.load(name); info = tk["info"]; MW, MH = work_size(info); d = cdir(name); md = d / "masks"
    n = int(round(info["dur"] * FPS)); white = b"\xff" * (MW * MH)
    pw = 540 if MW <= MH else 960; ph = int(round(MH * pw / MW / 2)) * 2
    full, prox = d / "mask_full.tmp.mp4", d / "mask_proxy.tmp.mp4"
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{MW}x{MH}", "-r", str(FPS), "-i", "-",
                            "-filter_complex", f"[0:v]split[a][b];[b]scale={pw}:{ph}[p]",
                            "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "8", "-pix_fmt", "yuv420p", "-g", "15", str(full),
                            "-map", "[p]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "8", "-movflags", "+faststart", str(prox)],
                           stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    have = {int(p.stem[1:]) for p in md.glob("f*.png")}
    for i in range(n):
        if i in have:
            enc.stdin.write(Image.open(md / f"f{i:06d}.png").convert("L").resize((MW, MH)).tobytes())
        else: enc.stdin.write(white)
        if i % 300 == 0: JOB.update(pct=91 + int(8 * i / n))
    enc.stdin.close(); err = enc.stderr.read().decode(errors="replace"); enc.wait()
    if enc.returncode: raise RuntimeError("mask video failed: " + err[-400:])
    full.replace(d / "mask_full.mp4"); prox.replace(d / "mask_proxy.mp4")


def done_ranges(name=None):
    """the cut-out parts as source-time ranges [[a, b, engine], ...] (for the timeline + panel)"""
    fr = load_idx(name)["frames"]; ks = sorted((int(k), v) for k, v in fr.items()); out = []
    for k, v in ks:
        if out and out[-1][2] == v and k == out[-1][1] + 1: out[-1][1] = k
        else: out.append([k, k, v])
    return [[a / FPS, (b + 1) / FPS, v] for a, b, v in out]


def coverage(name, a, b):
    """0..1 = how much of source a..b is cut out"""
    fr = load_idx(name)["frames"]; f0, f1 = int(round(a * FPS)), int(round(b * FPS)) - 1
    if f1 < f0: return 0.0
    return sum(1 for f in range(f0, f1 + 1) if str(f) in fr) / (f1 - f0 + 1)


# ------------------------------------------------------------------ HTTP
def get(h, p):
    if p == "/api/cutout/job": return h.send(200, json.dumps(JOB)) or True
    if p == "/api/cutout/info":
        if not TA.is_take(): return h.send(200, "null") or True
        name = S.ST["reel"]; d = cdir(name)
        return h.send(200, json.dumps({"ranges": done_ranges(name), "proxy": (d / "mask_proxy.mp4").exists(),
                                       "v": int((d / "mask_proxy.mp4").stat().st_mtime) if (d / "mask_proxy.mp4").exists() else 0})) or True
    return False


def post(h, p):
    if p == "/api/cutout/run":
        if not TA.is_take(): return h.send(400, '{"error":"open one of your own video projects first"}') or True
        if JOB["state"] == "running": return h.send(409, json.dumps({"error": "a cut-out is already running: wait for it, or press Stop"})) or True
        b = h.body(); engine = b.get("engine") if b.get("engine") in MODELS else "fast"; name = S.ST["reel"]
        ranges = [(float(a), float(z)) for a, z in (b.get("ranges") or []) if float(z) > float(a)]
        if not ranges: return h.send(400, '{"error":"pick a clip first"}') or True
        STOP.clear(); JOB.update(state="running", pct=0, msg="starting the cut-out", take=name, engine=engine)
        def job():
            try: run(name, ranges, engine)
            except InterruptedError: JOB.update(state="stopped", msg="stopped. The frames already done are kept; press Cut me out again to go on")
            except Exception as e: JOB.update(state="error", msg=f"{type(e).__name__}: {e}")
        threading.Thread(target=job, daemon=True).start()
        return h.send(200, '{"ok":true}') or True
    if p == "/api/cutout/stop": STOP.set(); return h.send(200, '{"ok":true}') or True
    return False

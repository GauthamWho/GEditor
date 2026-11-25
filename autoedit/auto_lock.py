#!/usr/bin/env python3
"""auto_lock.py: the EYE-LOCK edit. Same as auto.py v3 but your eyes are pinned to one fixed point
in every frame of the whole video. Outputs are named <name>Lock_vN_... so they never mix with auto.py.

auto.py v3: GauthamWho talking-video editor (cuts + smooth zooms + optional captions/music).

    python auto.py "D:\\GauthamWho\\Inbox\\clip.MOV" --out Output --lang ta --height 1280

WHAT IT DOES
  1. Cuts every pause by the REAL loudness of your voice (not Whisper timings), so small
     pauses and breaths go too. Whisper is NOT needed unless you ask for captions/stammer cuts.
  2. Tracks your face + eye line through the whole video.
  3. Adds engaging zooms: hard punch-ins, smooth push-ins, smooth zoom-outs, slow drift.
     Every zoom pivots on your eyes, so the eyes never jump between wide and tight shots.
  4. 15 ms audio fades at each cut, -14 LUFS, SDR output (HDR is tonemapped).
  -> <name>_v1_clean_SDR.mp4, then _v2, _v3 ... (old edits are never overwritten)

OPTIONAL (makes a second file <name>_vN_final_SDR.mp4, the clean one is left alone):
  --captions            word-by-word burned captions (runs Whisper)
  --music FILE          music bed that ducks while you talk

Needs: ffmpeg + ffprobe on PATH, python 3.9+, numpy, opencv-python-headless<5
       (+ faster-whisper only for --captions / --stammer-cuts)

CUT TUNING
  --gap 0.20      a pause longer than this is cut (smaller = cuts more, tighter)
  --pad 0.06      air kept before/after each phrase (raise if word ends get clipped)
  --thr 0.30      voice threshold, 0.2..0.5. LOWER = keeps more (if quiet words are cut)
                  HIGHER = cuts more (if background noise survives)
  --min-speech 0.10   sounds shorter than this (clicks, breaths) are dropped
  --stammer-cuts  also remove repeated/restarted words (uses Whisper)
  --intro-end S   keep the first S seconds uncut (default 0 for single takes)

ZOOM TUNING
  --scale 1.25    size of the tight shot (1.15 soft ... 1.4 strong)
  --drift 0.04    slow push-in added over wide/tight shots (0 = none)
  --ease 0.6      seconds a smooth zoom takes
  --no-zoom       cuts only
  --lock-eyes     pin your eyes to ONE fixed point in every frame of the whole video
                  (wide shots get a small base zoom so there is room to shift)
  --eye-target X,Y  where to pin them, as fractions, e.g. 0.5,0.38 (default: your average)

OTHER
  --height H      output height (1280 = 720x1280 preview for a portrait clip)
  --plan-only     write the plan, do not encode
  --single        treat the video as one take (skips shot detection, faster)
  --out DIR       output folder
  --model medium  Whisper model (only used for captions / stammer cuts)
  --retranscribe  ignore the saved transcript
Captions: --captions --caption-words 4 --font-name NAME --font-file PATH
Music:    --music FILE --music-db -8
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import traceback
import wave

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("--lang", default=None)
ap.add_argument("--model", default="medium")
ap.add_argument("--retranscribe", action="store_true")
ap.add_argument("--intro-end", type=float, default=None)
ap.add_argument("--gap", type=float, default=0.20)
ap.add_argument("--pad", type=float, default=0.06)
ap.add_argument("--thr", type=float, default=0.30)
ap.add_argument("--min-speech", type=float, default=0.10)
ap.add_argument("--stammer-cuts", action="store_true")
ap.add_argument("--scale", type=float, default=1.25)
ap.add_argument("--drift", type=float, default=0.04)
ap.add_argument("--ease", type=float, default=0.6)
ap.add_argument("--no-zoom", action="store_true")
ap.add_argument("--lock-eyes", action="store_true")
ap.add_argument("--eye-target", default=None)
ap.add_argument("--no-punch", action="store_true")  # old name for --no-zoom
ap.add_argument("--trim-broll", action="store_true")
ap.add_argument("--single", action="store_true")
ap.add_argument("--height", type=int, default=None)
ap.add_argument("--segments", default=None, help="use this cut list (a-b,c-d,... or a file)")
ap.add_argument("--plan-only", action="store_true")
ap.add_argument("--out", default=None)
ap.add_argument("--captions", action="store_true")
ap.add_argument("--caption-words", type=int, default=4)
ap.add_argument("--font-name", default=None)
ap.add_argument("--font-file", default=None)
ap.add_argument("--music", default=None)
ap.add_argument("--music-db", type=float, default=-8.0)
A = ap.parse_args()
A.lock_eyes = True          # this script ALWAYS pins the eyes (auto.py does not)
NOZOOM = A.no_zoom or A.no_punch

SRC = os.path.abspath(A.video)
NAME = re.sub(r"[^A-Za-z0-9]+", "", os.path.splitext(os.path.basename(SRC))[0]) or "Reel"
OUT = os.path.abspath(A.out) if A.out else os.path.dirname(SRC)
BASE_NAME = NAME
NAME = NAME + "Lock"        # outputs: <name>Lock_v1_clean_SDR.mp4 ... never mixed with auto.py edits
WORK = os.path.join(OUT, f"{NAME}_work")
# every real run gets its own version number, so old edits are never overwritten
os.makedirs(OUT, exist_ok=True)
_used = [int(m.group(1)) for f_ in os.listdir(OUT)
         for m in [re.match(re.escape(NAME) + r"_v(\d+)_(?:clean|final)_SDR\.mp4$", f_)] if m]
VER = max(_used, default=0) + 1
TAG = f"{NAME}_v{VER}"
os.makedirs(WORK, exist_ok=True)
if A.music and not os.path.exists(A.music):
    sys.exit(f"music file not found: {A.music}")


def run(cmd, capture=True, cwd=None):
    r = subprocess.run(cmd, capture_output=capture, text=True, encoding="utf-8", errors="replace", cwd=cwd)
    if r.returncode != 0:
        print((r.stderr or "")[-1800:])
        sys.exit(f"command failed: {cmd[0]}")
    return r


def say(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------ 1. probe
pj = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                     "stream=width,height,r_frame_rate,color_transfer:stream_side_data=rotation"
                     ":stream_tags=rotate:format=duration", "-of", "json", SRC]).stdout)
st = pj["streams"][0]
W, H = st["width"], st["height"]
rot = 0
for sd in st.get("side_data_list", []):
    if "rotation" in sd:
        rot = int(float(sd["rotation"]))
if not rot:
    rot = int(st.get("tags", {}).get("rotate", 0) or 0)
if abs(rot) % 180 == 90:      # phone video stored sideways: ffmpeg shows it rotated
    W, H = H, W
fn_, fd_ = map(int, st["r_frame_rate"].split("/"))
FPSF = fn_ / fd_              # exact fps (59.94 stays 59.94, so audio never drifts)
FPS = round(FPSF)
DUR = float(pj["format"]["duration"])
HDR = st.get("color_transfer", "") in ("arib-std-b67", "smpte2084")
say(f"[1/7] {W}x{H} {FPSF:.2f}fps {DUR:.1f}s {'HDR' if HDR else 'SDR'}")
TONEMAP = ("zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,"
           "zscale=t=bt709:m=bt709:r=tv,format=yuv420p")
FR = 1 / FPSF
fr = lambda t: int(round(t * FPSF))
even = lambda v: int(round(v)) // 2 * 2

# ------------------------------------------------------------------ 2. audio loudness
wav = os.path.join(WORK, "audio.wav")
run(["ffmpeg", "-v", "error", "-y", "-i", SRC, "-vn", "-ac", "1", "-ar", "16000", wav])
w_ = wave.open(wav)
x = np.frombuffer(w_.readframes(w_.getnframes()), dtype=np.int16).astype(float) / 32768
w_.close()
X = np.fft.rfft(x)
fq = np.fft.rfftfreq(len(x), 1 / 16000)
X[(fq < 120) | (fq > 4000)] = 0
xb = np.fft.irfft(X, len(x))
HOP, HS = 160, 0.01           # 10 ms frames
nfr = len(xb) // HOP
DB = 20 * np.log10(np.sqrt(np.mean(xb[:nfr * HOP].reshape(nfr, HOP) ** 2, axis=1)) + 1e-6)


def speech_islands():
    """Phrases of speech, found from the loudness of the voice. Pauses are the gaps between them."""
    d = np.convolve(np.pad(DB, (2, 2), mode="edge"), np.ones(5) / 5, mode="valid")
    floor, peak = np.percentile(d, 10), np.percentile(d, 95)
    span = max(peak - floor, 10.0)
    hi, lo = floor + A.thr * span, floor + 0.6 * A.thr * span
    say(f"      voice level: noise {floor:.0f} dB, speech {peak:.0f} dB, cut threshold {hi:.0f} dB")
    runs, on, s0 = [], False, 0
    for i, v in enumerate(d):
        if not on and v > hi:
            on, s0 = True, i
            while s0 > 0 and d[s0 - 1] > lo:
                s0 -= 1
        elif on and v < lo:
            on = False
            runs.append([s0 * HS, i * HS])
    if on:
        runs.append([s0 * HS, len(d) * HS])
    runs = [r for r in runs if r[1] - r[0] >= A.min_speech]
    merged = []
    for a, b in runs:
        if merged and a - merged[-1][1] <= A.gap:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    out = []
    for a, b in merged:
        a, b = max(0.0, a - A.pad), min(DUR, b + A.pad)
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


ISL = speech_islands()
say(f"[2/7] {len(ISL)} speech phrases found by loudness")

# ------------------------------------------------------------------ 3. Whisper (only if needed)
words, engine = [], "loudness"
if A.captions or A.stammer_cuts:
    os.makedirs(os.path.join(OUT, f"{BASE_NAME}_work"), exist_ok=True)
    cache = os.path.join(OUT, f"{BASE_NAME}_work", f"words_{A.model}_{A.lang or 'auto'}.json")   # shares the transcript with auto.py
    if os.path.exists(cache) and not A.retranscribe:
        c = json.load(open(cache, encoding="utf-8"))
        words, engine = c["words"], c["engine"]
        say(f"      using saved transcript ({len(words)} words)")
    else:
        try:
            from faster_whisper import WhisperModel
            say(f"      transcribing with Whisper '{A.model}' (a few minutes on CPU) ...")
            model = WhisperModel(A.model, device="cpu", compute_type="int8")
            segs_, info = model.transcribe(x.astype(np.float32), language=A.lang, word_timestamps=True,
                                           condition_on_previous_text=False, vad_filter=False)
            for sg in segs_:
                for w in sg.words or []:
                    words.append({"s": round(w.start, 3), "e": round(w.end, 3), "w": w.word.strip()})
            engine = f"whisper:{info.language}"
            json.dump({"engine": engine, "words": words}, open(cache, "w", encoding="utf-8"),
                      ensure_ascii=False, indent=1)
        except Exception as e:
            say(f"      Whisper failed: {type(e).__name__}: {e}")
            traceback.print_exc()
            say("      continuing without captions / stammer cuts")
            words, engine = [], "loudness"
    words.sort(key=lambda w: w["s"])


def ov(a0, a1, b0, b1):
    return a0 < b1 and b0 < a1


# ------------------------------------------------------------------ 4. shots
bounds = [0.0]
blacks = []
if not A.single:
    r = run(["ffmpeg", "-hide_banner", "-i", SRC, "-vf",
             "scale=320:-2,select='gt(scene,0.25)',metadata=print:file=-", "-an", "-f", "null", "-"])
    cuts = [float(m) for m in re.findall(r"pts_time:([0-9.]+)", r.stdout + r.stderr)]
    for c in sorted(cuts):
        if c - bounds[-1] >= 0.3 and DUR - c >= 0.3:
            bounds.append(c)
    r = run(["ffmpeg", "-hide_banner", "-i", SRC, "-vf", "scale=160:-2,blackdetect=d=0.1:pix_th=0.12",
             "-an", "-f", "null", "-"])
    blacks = [(float(a), float(b)) for a, b in
              re.findall(r"black_start:([0-9.]+) black_end:([0-9.]+)", r.stderr)]
bounds.append(DUR)
shots = [{"start": a, "end": b} for a, b in zip(bounds, bounds[1:])]
for sh in shots:
    sh["speech"] = sum(max(0, min(b, sh["end"]) - max(a, sh["start"])) for a, b in ISL)
    sh["talk"] = sh["speech"] >= 0.4
    sh["black"] = any(min(b, sh["end"]) - max(a, sh["start"]) >= 0.7 * (sh["end"] - sh["start"])
                      for a, b in blacks)
    sh["protected"] = False
SINGLE = len(shots) == 1
say(f"[3/7] {len(shots)} shot(s), {sum(s['talk'] for s in shots)} talking, "
    f"{sum(s['black'] for s in shots)} black clip(s)" + ("  (one single take)" if SINGLE else ""))
for i, sh in enumerate(shots):   # show -> drop -> black -> walk-in stay whole
    if sh["black"]:
        sh["protected"] = True
        for j in (i - 1, i - 2):
            if j >= 0 and not shots[j]["talk"]:
                shots[j]["protected"] = True
        if i + 1 < len(shots) and not shots[i + 1]["talk"]:
            shots[i + 1]["protected"] = True

# ------------------------------------------------------------------ 5. cut plan
norm = lambda t: re.sub(r"[^\w]", "", t.lower())
removes = []
if A.stammer_cuts and engine != "loudness":
    for a, b in zip(words, words[1:]):
        na, nb = norm(a["w"]), norm(b["w"])
        if not na or b["s"] - a["e"] > 0.6:
            continue
        if na == nb or a["w"].endswith("-") or (len(na) >= 2 and nb.startswith(na) and na != nb):
            if b["s"] - 0.06 > a["s"]:
                removes.append((a["s"] - 0.02, b["s"] - 0.06))

first_talk = next((s for s in shots if s["talk"]), None)
if A.intro_end is not None:
    intro_end = A.intro_end
elif SINGLE or not first_talk:
    intro_end = 0
else:
    ins = [b for a, b in ISL if ov(a, b, first_talk["start"], first_talk["end"])]
    intro_end = min(max(ins) + 0.2, first_talk["end"]) if ins else 0

keep = []
if intro_end:
    keep.append((0.0, intro_end))
for sh in shots:
    if sh["protected"]:
        keep.append((sh["start"], sh["end"]))
for a, b in ISL:
    keep.append((a, b))
if ISL and DUR - ISL[-1][1] < 0.5:        # last line plays to the very end
    keep.append((ISL[-1][0], DUR))
if not ISL:
    keep.append((0.0, DUR))
if not SINGLE:
    for sh in shots:                       # silent head/tail of a talking shot = b-roll: keep a little
        if not sh["talk"] or sh["protected"]:
            continue
        inside = [(max(a, sh["start"]), min(b, sh["end"])) for a, b in ISL if ov(a, b, sh["start"], sh["end"])]
        if inside:
            for a, b in ((sh["start"], inside[0][0]), (inside[-1][1], sh["end"])):
                if b - a >= 1.5:
                    keep.append((a + 0.06, a + 0.06 + min(2.0, 0.5 * (b - a))))
    for sh in shots:                       # non-talking shots stay, in order
        if sh["talk"] or sh["protected"]:
            continue
        a, b = sh["start"], sh["end"]
        if A.trim_broll:
            t = min(0.4, 0.12 * (b - a))
            a, b = a + t, b - t
        if b - a >= 0.3:
            keep.append((a, b))

prot = ([(0.0, intro_end)] if intro_end else []) + [(s["start"], s["end"]) for s in shots if s["protected"]]


def cut_removes(seg):
    out = [seg]
    for r0, r1 in removes:
        nxt = []
        for a, b in out:
            if ov(a, b, r0, r1):
                if a < r0:
                    nxt.append((a, r0))
                if r1 < b:
                    nxt.append((r1, b))
            else:
                nxt.append((a, b))
        out = nxt
    return out


segs = []
for a, b in keep:
    if any(a >= p0 - 1e-6 and b <= p1 + 1e-6 for p0, p1 in prot):
        segs.append((a, b))
    else:
        segs += cut_removes((a, b))
segs.sort()
SEG = []
for a, b in segs:
    if b - a < 2 * FR:
        continue
    if SEG and a - SEG[-1][1] < 2 * FR:
        SEG[-1][1] = max(SEG[-1][1], b)
    else:
        SEG.append([a, b])
SEG = [(round(a, 3), round(b, 3)) for a, b in SEG]
if A.segments:
    txt = open(A.segments).read() if os.path.exists(A.segments) else A.segments
    SEG = [tuple(map(float, t.split("-"))) for t in txt.strip().split(",")]
total = sum(b - a for a, b in SEG)
say(f"[4/7] cut plan: {len(SEG)} segments, {total:.1f}s of {DUR:.1f}s  (removed {DUR - total:.1f}s of pauses)")
if total > 90:
    say("      NOTE: over 90 s (Instagram Reels check); your call.")

# ------------------------------------------------------------------ 6. face / eye tracking + zoom plan
TW = 360
TH = even(H * TW / W)
TRACK_FPS = 8 if A.lock_eyes else 4
SMOOTH_K = 9 if A.lock_eyes else 5


def track_eyes():
    """Eye point (x, y as 0..1 fractions) every 0.25 s through the whole video, smoothed."""
    try:
        import cv2
        fcas = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        ecas = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
    except AttributeError:
        say("      OpenCV is the wrong version (5.x has no face detector). Run:")
        say('        pip uninstall -y opencv-python-headless')
        say('        pip install "opencv-python-headless<5"')
        sys.exit(1)
    if fcas.empty():
        say("      face detector file missing in this OpenCV install; zooms will anchor to the centre")
        return np.array([0.0, 1.0]), np.array([0.5, 0.5]), np.array([0.36, 0.36]), 0, 0
    key = hashlib.md5(f"{os.path.getmtime(SRC)}{W}{H}{HDR}{TRACK_FPS}{SMOOTH_K}".encode()).hexdigest()[:10]
    cf = os.path.join(WORK, f"eyes_{key}.json")
    if os.path.exists(cf):
        d = json.load(open(cf))
        return np.array(d["t"]), np.array(d["x"]), np.array(d["y"]), d["found"], d["total"]
    vf = (TONEMAP + "," if HDR else "") + f"fps={TRACK_FPS},scale={TW}:{TH},format=gray"
    p = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", SRC, "-vf", vf, "-f", "rawvideo", "-"],
                       capture_output=True)
    if p.returncode != 0:
        print(p.stderr.decode(errors="replace")[-1500:])
        sys.exit("command failed: ffmpeg (eye tracking)")
    buf = np.frombuffer(p.stdout, np.uint8)
    nf = len(buf) // (TW * TH)
    ts, xs, ys = [], [], []
    for i in range(nf):
        img = buf[i * TW * TH:(i + 1) * TW * TH].reshape(TH, TW)
        img = cv2.equalizeHist(img)
        fc = fcas.detectMultiScale(img, 1.1, 5, minSize=(int(TW * 0.12), int(TW * 0.12)))
        if not len(fc):
            continue
        fx, fy, fw, fh = max(fc, key=lambda r: r[2] * r[3])
        ex, ey = fx + fw / 2, fy + 0.38 * fh
        roi = img[fy:fy + int(0.58 * fh), fx:fx + fw]
        es = ecas.detectMultiScale(roi, 1.1, 4, minSize=(max(6, fw // 9), max(6, fw // 9)))
        if len(es) >= 2:
            es = sorted(es, key=lambda r: -r[2] * r[3])[:2]
            if abs((es[0][0] + es[0][2] / 2) - (es[1][0] + es[1][2] / 2)) > 0.2 * fw:
                ex = fx + float(np.mean([e[0] + e[2] / 2 for e in es]))
                ey = fy + float(np.mean([e[1] + e[3] / 2 for e in es]))
        ts.append(i / TRACK_FPS)
        xs.append(ex / TW)
        ys.append(ey / TH)
    grid = np.arange(nf) / TRACK_FPS
    if len(ts) >= 3:
        gx, gy = np.interp(grid, ts, xs), np.interp(grid, ts, ys)
        k = SMOOTH_K

        def smooth(v):
            pv = np.pad(v, (k // 2, k // 2), mode="edge")
            med = np.array([np.median(pv[i:i + k]) for i in range(len(v))])
            pm = np.pad(med, (k // 2, k // 2), mode="edge")
            return np.convolve(pm, np.ones(k) / k, mode="valid")
        gx, gy = smooth(gx), smooth(gy)
    else:
        gx = np.full(max(nf, 1), 0.5)
        gy = np.full(max(nf, 1), 0.36)
        grid = np.arange(max(nf, 1)) / TRACK_FPS
    json.dump({"t": grid.tolist(), "x": gx.tolist(), "y": gy.tolist(), "found": len(ts), "total": nf},
              open(cf, "w"))
    return grid, gx, gy, len(ts), nf


EYE_T = EYE_X = EYE_Y = None
if not NOZOOM:
    EYE_T, EYE_X, EYE_Y, nfound, ntot = track_eyes()
    say(f"[5/7] face found in {nfound}/{ntot} samples" + ("  (WARNING: few faces, zoom anchored to the centre)"
                                                          if nfound < 3 else ""))
LOCK = A.lock_eyes and not NOZOOM
TX, TY, ZF = 0.5, 0.36, 1.0
if LOCK:
    if A.eye_target:
        TX, TY = [float(v) for v in A.eye_target.split(",")]
    else:
        TX, TY = float(np.median(EYE_X)), float(np.median(EYE_Y))
    lim = []
    for arr, tg in ((EYE_X, TX), (EYE_Y, TY)):
        lo, hi = np.percentile(arr, 5), np.percentile(arr, 95)
        lim.append(min(lo / tg, (1 - hi) / (1 - tg)))
    ZF = min(max(1.0, 1.03 / max(min(lim), 1e-3)), 1.6)
    say(f"      eye lock: eyes pinned at x={TX:.2f} y={TY:.2f} of the frame, base zoom {ZF:.2f}")
eye_at = lambda t: (float(np.interp(t, EYE_T, EYE_X)), float(np.interp(t, EYE_T, EYE_Y)))

S = A.scale
D_ = A.drift
CYCLE = [  # (name, zoom at start, zoom at end, ease seconds)  -- a mix of hard punches and smooth moves
    ("wide", 1.00, 1.00 + D_, 0.0),
    ("punch", S, S + D_, 0.0),                   # hard cut in
    ("release", S + D_, 1.00, A.ease),           # smooth zoom OUT
    ("wide", 1.00, 1.00 + D_, 0.0),
    ("push", 1.00 + D_, S, A.ease),              # smooth zoom IN
    ("hold", S, S + D_, 0.0),
]
ZOOM = []   # per segment: (name, z0, z1, ease)
ci = 0
for a, b in SEG:
    mid = (a + b) / 2
    inprot = any(p0 - 1e-6 <= mid <= p1 + 1e-6 for p0, p1 in prot)
    sh = next((s_ for s_ in shots if s_["start"] <= mid <= s_["end"]), None)
    if NOZOOM or inprot or not sh or not sh["talk"]:
        ZOOM.append(("none", 1.0, 1.0, 0.0))
    elif b - a < 0.4:
        ZOOM.append(("short", 1.0, 1.0, 0.0) if LOCK else ("none", 1.0, 1.0, 0.0))
    else:
        ZOOM.append(CYCLE[ci % len(CYCLE)])
        ci += 1
if LOCK:
    ZOOM = [z if z[0] == "none" else (z[0], max(z[1], ZF), max(z[2], ZF), z[3]) for z in ZOOM]
if not NOZOOM:
    say("      zoom plan: " + " ".join(z[0] for z in ZOOM))

plan = {"source": SRC, "engine": engine, "duration": DUR, "fps": FPSF, "intro_end": intro_end,
        "segments": SEG, "zoom": ZOOM, "speech_phrases": ISL, "removed_stammers": removes,
        "output_length": round(total, 2)}
plan["settings"] = " ".join(sys.argv[1:])
PLAN_PATH = os.path.join(OUT, f"{NAME}_plan.json" if A.plan_only else f"{TAG}_plan.json")
json.dump(plan, open(PLAN_PATH, "w"), indent=1)
if A.plan_only:
    say("plan written:", PLAN_PATH)
    sys.exit()

# ------------------------------------------------------------------ 7. build
OW = even(W * A.height / H) if A.height else W
OH = even(A.height) if A.height else H
ZMAX = max([z[2] for z in ZOOM] + [z[1] for z in ZOOM] + [1.0])
KPRE = min(1.0, OW * ZMAX / W)          # pre-shrink factor (keeps downscaling clean)
PW, PH = max(2, int(round(W * KPRE))), max(2, int(round(H * KPRE)))
VF_READ = (TONEMAP + "," if HDR else "") + "format=bgr24"
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-colorspace", "bt709",
       "-color_primaries", "bt709", "-color_trc", "bt709"]


def zoom_at(zp, t, dur):
    _, z0, z1, ease = zp
    if z0 == z1:
        return z0
    if ease > 0:
        p = min(t / min(ease, max(dur, 1e-3)), 1.0)
        e = p * p * (3 - 2 * p)
        return z0 + (z1 - z0) * e
    return z0 + (z1 - z0) * (t / max(dur, 1e-3))


def render_zoom(path, s, e, zp):
    import cv2
    n = e - s
    dur = n / FPSF
    fsize = W * H * 3
    logr = open(os.path.join(WORK, "ff_read.log"), "wb")
    logw = open(os.path.join(WORK, "ff_write.log"), "wb")
    rd = subprocess.Popen(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{s / FPSF:.6f}", "-i", SRC,
                           "-frames:v", str(n), "-vf", VF_READ, "-f", "rawvideo", "-"],
                          stdout=subprocess.PIPE, stderr=logr)
    wr = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
                           "-s", f"{OW}x{OH}", "-r", f"{fn_}/{fd_}", "-i", "-",
                           "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"] + ENC + [path],
                          stdin=subprocess.PIPE, stderr=logw)
    last = None
    for k in range(n):
        buf = rd.stdout.read(fsize)
        if len(buf) == fsize:
            last = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        elif last is None:
            break
        frame = last
        z = zoom_at(zp, k / FPSF, dur)
        ex, ey = eye_at((s + k) / FPSF)
        ax, ay = ex * W, ey * H
        if LOCK:                                         # eyes pinned to the same point in every frame
            cw, ch = W / z, H / z
            x0 = min(max(ax - TX * cw, 0.0), W - cw)
            y0 = min(max(ay - TY * ch, 0.0), H - ch)
        else:
            x0, y0 = ax * (1 - 1 / z), ay * (1 - 1 / z)  # eyes stay exactly where they were
        src = cv2.resize(frame, (PW, PH), interpolation=cv2.INTER_AREA) if KPRE < 0.999 else frame
        kx, ky = PW / W, PH / H
        sx, sy = OW * z / W, OH * z / H
        M = np.array([[sx / kx, 0, -x0 * sx], [0, sy / ky, -y0 * sy]], dtype=np.float64)
        outf = cv2.warpAffine(src, M, (OW, OH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        wr.stdin.write(outf.tobytes())
    wr.stdin.close()
    wr.wait()
    rd.stdout.close()
    rd.terminate()
    rd.wait()
    logr.close()
    logw.close()
    if wr.returncode != 0 or not os.path.exists(path):
        print(open(os.path.join(WORK, "ff_write.log"), errors="replace").read()[-1500:])
        sys.exit("command failed: ffmpeg (zoom render)")


def render_plain(path, s, e):
    vf = [TONEMAP] if HDR else []
    if A.height:
        vf.append(f"scale={OW}:{OH}:flags=lanczos")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", f"{s / FPSF:.6f}",
           "-i", SRC, "-frames:v", str(e - s), "-map", "0:v:0"]
    if vf:
        cmd += ["-vf", ",".join(vf)]
    cmd += ENC + ["-pix_fmt", "yuv420p", path]
    run(cmd)


pd = os.path.join(WORK, "pieces")
os.makedirs(pd, exist_ok=True)
eyesig = hashlib.md5((str(EYE_X) + str(EYE_Y) + str((LOCK, TX, TY))).encode()).hexdigest()[:8] if EYE_X is not None else "none"
names, lst = [], []
for i, ((a, b), zp) in enumerate(zip(SEG, ZOOM)):
    s, e = fr(a), fr(b)
    key = hashlib.md5(json.dumps([s, e, zp, OW, OH, W, H, eyesig, os.path.getmtime(SRC), KPRE],
                                 default=str).encode()).hexdigest()[:12]
    path = os.path.join(pd, f"p_{key}.mp4")
    names.append(os.path.basename(path))
    if not os.path.exists(path):
        if zp[0] == "none":
            render_plain(path, s, e)
        else:
            render_zoom(path, s, e, zp)
    lst.append(f"file '{os.path.basename(path)}'")
    say(f"[6/7] piece {i + 1}/{len(SEG)}  {zp[0]}")
for f_ in os.listdir(pd):                         # remove pieces from older plans
    if f_.endswith(".mp4") and f_ not in names:
        os.remove(os.path.join(pd, f_))
open(os.path.join(pd, "list.txt"), "w").write("\n".join(lst) + "\n")
video = os.path.join(WORK, "video.mp4")
run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(pd, "list.txt"),
     "-c", "copy", video])

parts, labels = [], []
for i, (a, b) in enumerate(SEG):
    sa, sb = fr(a) / FPSF, fr(b) / FPSF
    parts.append(f"[0:a:0]atrim={sa:.6f}:{sb:.6f},asetpts=PTS-STARTPTS,afade=t=in:d=0.015,"
                 f"afade=t=out:st={max(0, sb - sa - 0.015):.6f}:d=0.015[a{i}]")
    labels.append(f"[a{i}]")
raw = os.path.join(WORK, "audio_raw.wav")
run(["ffmpeg", "-v", "error", "-y", "-i", SRC, "-filter_complex",
     ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(SEG)}:v=0:a=1[cat]",
     "-map", "[cat]", "-c:a", "pcm_s16le", raw])
lg = run(["ffmpeg", "-hide_banner", "-nostdin", "-i", raw, "-af",
          "loudnorm=I=-14:TP=-2:LRA=11:print_format=json", "-f", "null", "-"]).stderr
m = json.loads(re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", lg, re.S)[-1])
ln = (f"loudnorm=I=-14:TP=-2:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
      f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
audio = os.path.join(WORK, "audio.m4a")
run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-af", ln, "-ar", "48000", "-c:a", "aac", "-b:a", "256k", audio])

final = os.path.join(OUT, f"{TAG}_clean_SDR.mp4")
run(["ffmpeg", "-v", "error", "-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
     "-movflags", "+faststart", "-shortest", final])
say(f"[7/7] clean edit done: {final}")
say(f"      plan: {PLAN_PATH}")

# ------------------------------------------------------------------ 8. extras: captions + music
if not (A.captions or A.music):
    sys.exit()

OUT_LEN = sum(fr(b) - fr(a) for a, b in SEG) / FPSF
cap_video, mix_audio = video, audio

if A.captions:
    if engine == "loudness" or not words:
        say("[8] captions skipped: they need Whisper word timings (Whisper did not run).")
    else:
        starts, cum = [], 0.0
        for a, b in SEG:
            sa, sb = fr(a) / FPSF, fr(b) / FPSF
            starts.append((sa, sb, cum))
            cum += sb - sa
        cw = []
        for w in words:
            txt = w["w"].strip()
            if not txt or txt == "?":
                continue
            mid = (w["s"] + w["e"]) / 2
            hit = next((t for t in starts if t[0] - 1e-6 <= mid <= t[1] + 1e-6), None)
            if not hit:
                continue
            sa, sb, base = hit
            s_out = base + max(w["s"], sa) - sa
            e_out = base + min(w["e"], sb) - sa
            if e_out - s_out < 0.04:
                e_out = s_out + 0.04
            cw.append({"s": s_out, "e": e_out, "w": txt})
        cw.sort(key=lambda w: w["s"])

        portrait = OH > OW
        char_cap = 20 if portrait else 30
        lines, cur = [], []
        for w in cw:
            if cur:
                chars = sum(len(t["w"]) for t in cur) + len(cur) + len(w["w"])
                if (w["s"] - cur[-1]["e"] > 0.45 or len(cur) >= A.caption_words or chars > char_cap
                        or cur[-1]["w"][-1:] in ".?!।"):
                    lines.append(cur)
                    cur = []
            cur.append(w)
        if cur:
            lines.append(cur)

        fdir = os.path.join(WORK, "fonts")
        os.makedirs(fdir, exist_ok=True)
        fam = A.font_name
        if A.font_file:
            shutil.copy(A.font_file, fdir)
        elif os.name == "nt":
            wf = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
            for fn in ("NirmalaB.ttc", "NirmalaB.ttf", "Nirmala.ttc", "Nirmala.ttf", "NirmalaS.ttc"):
                if os.path.exists(os.path.join(wf, fn)):
                    shutil.copy(os.path.join(wf, fn), fdir)
                    fam = fam or "Nirmala UI"
            if not os.listdir(fdir):
                for fn in ("latha.ttf", "Latha.ttf", "vijaya.ttf"):
                    if os.path.exists(os.path.join(wf, fn)):
                        shutil.copy(os.path.join(wf, fn), fdir)
                        fam = fam or "Latha"
        fam = fam or "Nirmala UI"

        fs = round(min(OW, OH) * 0.062)
        mv = round(OH * (0.28 if portrait else 0.10))
        ol = max(3, round(fs * 0.075))

        def ts(t):
            cs = int(round(t * 100))
            return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"

        ev = []
        for i, ln_ in enumerate(lines):
            t0 = ln_[0]["s"]
            nxt = lines[i + 1][0]["s"] if i + 1 < len(lines) else OUT_LEN
            t1 = min(ln_[-1]["e"] + 0.15, nxt, OUT_LEN)
            txt = ""
            for j, w in enumerate(ln_):
                wend = ln_[j + 1]["s"] if j + 1 < len(ln_) else t1
                k = max(1, int(round((wend - w["s"]) * 100)))
                txt += "{\\k%d}%s " % (k, w["w"].replace("{", "(").replace("}", ")"))
            ev.append(f"Dialogue: 0,{ts(t0)},{ts(t1)},Cap,,0,0,0,,{txt.strip()}")

        ass = ("[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 2\n"
               "ScaledBorderAndShadow: yes\n\n[V4+ Styles]\n"
               "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
               "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
               "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
               "Style: Cap,%s,%d,&H0000D7FF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,%d,0,2,40,40,%d,1\n\n"
               "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
               % (OW, OH, fam, fs, ol, mv)) + "\n".join(ev) + "\n"
        open(os.path.join(WORK, "captions.ass"), "w", encoding="utf-8").write(ass)

        cap_video = os.path.join(WORK, "video_captions.mp4")
        vfc = "ass=captions.ass" + (":fontsdir=fonts" if os.listdir(fdir) else "")
        say(f"[8] burning {len(lines)} caption lines ({fam}, {fs}px) ...")
        run(["ffmpeg", "-v", "error", "-y", "-i", "video.mp4", "-vf", vfc, "-c:v", "libx264",
             "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
             "-color_primaries", "bt709", "-color_trc", "bt709", "video_captions.mp4"], cwd=WORK)

if A.music:
    mus = os.path.join(WORK, "music_prep.wav")
    swell = -14 + A.music_db
    say(f"[8] preparing music {os.path.basename(A.music)} ...")
    run(["ffmpeg", "-v", "error", "-y", "-stream_loop", "-1", "-i", A.music, "-vn", "-af",
         f"aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{OUT_LEN:.3f},asetpts=PTS-STARTPTS,"
         f"loudnorm=I={swell:.1f}:TP=-2:LRA=7,afade=t=in:d=0.6,"
         f"afade=t=out:st={max(0, OUT_LEN - 1.5):.3f}:d=1.5,apad=whole_dur={OUT_LEN:.3f}",
         "-t", f"{OUT_LEN:.3f}", mus])
    mixraw = os.path.join(WORK, "audio_mix_raw.wav")
    fc = ("[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[v][sc];"
          "[1:a]asetpts=PTS-STARTPTS[m];"
          "[m][sc]sidechaincompress=threshold=0.05:ratio=3:attack=30:release=500[duck];"
          "[v][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[mix]")
    say(f"[8] mixing: music {A.music_db:g} dB under your voice, dipping while you talk ...")
    run(["ffmpeg", "-v", "error", "-y", "-i", audio, "-i", mus, "-filter_complex", fc, "-map", "[mix]",
         "-t", f"{OUT_LEN:.3f}", "-c:a", "pcm_s16le", mixraw])
    lg2 = run(["ffmpeg", "-hide_banner", "-nostdin", "-i", mixraw, "-af",
               "loudnorm=I=-14:TP=-2:LRA=11:print_format=json", "-f", "null", "-"]).stderr
    m2 = json.loads(re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", lg2, re.S)[-1])
    ln2 = (f"loudnorm=I=-14:TP=-2:LRA=11:measured_I={m2['input_i']}:measured_TP={m2['input_tp']}:"
           f"measured_LRA={m2['input_lra']}:measured_thresh={m2['input_thresh']}:offset={m2['target_offset']}:linear=true")
    mix_audio = os.path.join(WORK, "audio_mix.m4a")
    run(["ffmpeg", "-v", "error", "-y", "-i", mixraw, "-af", ln2, "-ar", "48000", "-c:a", "aac",
         "-b:a", "256k", mix_audio])

if cap_video == video and mix_audio == audio:
    say("[8] nothing extra was added, so only the clean file was made.")
    sys.exit()
final2 = os.path.join(OUT, f"{TAG}_final_SDR.mp4")
run(["ffmpeg", "-v", "error", "-y", "-i", cap_video, "-i", mix_audio, "-map", "0:v:0", "-map", "1:a:0",
     "-c", "copy", "-movflags", "+faststart", "-shortest", final2])
say(f"[8/8] extras done: {final2}")
say(f"      (the clean version without extras is still {final})")

"""fx_ffmpeg.py: the chat 8 look + effects tools (Filters, Adjust, Effects, Transitions) for HIS OWN videos' export.
Same numbers as fx_runtime.js (the live preview), turned into ffmpeg filters per clip:
  colour  -> colorchannelmixer (3x3) + curves (9 points per channel) + unsharp
  picture -> scale/crop per frame (shake, zoom punch, zoom-through, whip, glitch jitter), gblur, rgbashift, hue (B&W)
The overlay part (flash, dips to black / white, light leak, grain, vignette) is NOT here: the caption frames page draws it
(fx_runtime.js in ?caponly=1), so preview and file share one drawing."""
import math

FILTERS = {
    "warm": {"warm": 0.55, "sat": 0.08, "contrast": 0.04},
    "cool": {"warm": -0.5, "tint": -0.1, "sat": -0.05},
    "film": {"contrast": 0.12, "sat": -0.18, "fade": 0.12, "warm": 0.15, "sh": 0.1},
    "bw": {"sat": -1, "contrast": 0.15},
    "punchy": {"contrast": 0.22, "sat": 0.3, "hi": -0.08},
    "fade": {"fade": 0.25, "contrast": -0.12, "sat": -0.15},
    "teal": {"teal": 0.6, "contrast": 0.1, "sat": 0.05},
    "night": {"bright": -0.18, "warm": -0.6, "sat": -0.25, "contrast": 0.1},
    "vivid": {"sat": 0.45, "contrast": 0.08, "bright": 0.04},
    "vintage": {"warm": 0.35, "fade": 0.18, "sat": -0.3, "tint": 0.08},
    "golden": {"warm": 0.7, "bright": 0.05, "hi": 0.1, "sat": 0.12},
    "moody": {"bright": -0.1, "contrast": 0.2, "sat": -0.25, "sh": -0.15, "warm": -0.15},
}
KEYS = ["bright", "contrast", "sat", "warm", "tint", "hi", "sh", "fade", "teal", "sharp", "vig", "grain"]
FPS = 30


def clamp(v, a, b): return min(max(v, a), b)


def mix(look):
    o = {k: 0.0 for k in KEYS}
    if not look: return o
    f = FILTERS.get(look.get("filter") or ""); a = 1 if look.get("amt") is None else float(look["amt"])
    if f:
        for k, v in f.items(): o[k] += v * a
    for k in KEYS: o[k] += float((look.get("adj") or {}).get(k) or 0)
    return o


def add(a, b): return {k: a.get(k, 0) + b.get(k, 0) for k in KEYS}
def is_id(o): return all(abs(o.get(k, 0)) < 1e-4 for k in KEYS)


def matrix(o):
    s = 1 + o["sat"]; br = 1 + o["bright"] * 0.6
    M = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]
    r = br * (1 + 0.12 * o["warm"]); g = br * (1 - 0.06 * o["tint"]); b = br * (1 - 0.14 * o["warm"])
    return [M[0] * r, M[1] * r, M[2] * r, M[3] * g, M[4] * g, M[5] * g, M[6] * b, M[7] * b, M[8] * b]


def curve(o, ch):
    pts = []
    for i in range(9):
        x = i / 8; y = (x - 0.5) * (1 + o["contrast"]) + 0.5
        y += o["hi"] * 0.35 * max(0, x - 0.5) * 2 * x
        y += o["sh"] * 0.35 * max(0, 0.5 - x) * 2 * (1 - x)
        y = o["fade"] * 0.18 + y * (1 - o["fade"] * 0.18 - o["fade"] * 0.04)
        if o["teal"]:
            k = o["teal"] * 0.09
            if ch == 0: y += k * (x - 0.35)
            if ch == 2: y += k * (0.6 - x)
            if ch == 1: y += k * 0.2 * (0.5 - abs(x - 0.5))
        pts.append(clamp(y, 0, 1))
    return pts


def color_filter(o):
    if is_id(o): return ""
    M = matrix(o); n = ["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"]
    cm = "colorchannelmixer=" + ":".join(f"{n[i]}={M[i]:.5f}" for i in range(9))
    cv = []
    for ch, key in ((0, "r"), (1, "g"), (2, "b")):
        p = curve(o, ch); cv.append(f"{key}='" + " ".join(f"{i / 8:.4f}/{v:.4f}" for i, v in enumerate(p)) + "'")
    out = [cm, "curves=" + ":".join(cv)]
    k = clamp(o["sharp"], 0, 1)
    if k > 0.01: out.append(f"unsharp=5:5:{k * 1.6:.3f}:5:5:0")
    return ",".join(out)


def clip_ranges(tk):
    out, acc = [], 0.0
    for b in tk.get("blocks", []):
        L = round(round((b["out"] - b["in"]) / float(b.get("speed") or 1) * FPS) / FPS, 4)
        out.append({"id": b["id"], "t0": acc, "t1": acc + L}); acc += L
    return out


def trans_list(fx, C):
    out = []
    for x in fx.get("trans") or []:
        t = x.get("at")
        if x.get("before") is not None:
            c = next((c for c in C if c["id"] == x["before"]), None)
            if not c: continue
            t = c["t0"]
        if t is None: continue
        out.append({"kind": x.get("kind"), "t": float(t), "dur": max(0.1, float(x.get("dur") or 0.5))})
    return out


def picture(fx, T, TR):
    """the picture part of fx_runtime.js state(): blur, gray, rgb, sx, sy, sc"""
    s = {"blur": 0.0, "gray": 0.0, "rgb": 0.0, "sx": 0.0, "sy": 0.0, "sc": 1.0}
    for e in fx.get("effects") or []:
        t0, t1 = float(e["t0"]), float(e["t1"])
        if T < t0 or T >= t1: continue
        a = 1 if e.get("amt") is None else float(e["amt"]); d = max(0.05, t1 - t0); p = (T - t0) / d; u = T - t0; k = e.get("kind")
        if k == "shake": A = 22 * a; s["sx"] += A * math.sin(u * 47) * (1 - p * 0.3); s["sy"] += A * 0.7 * math.cos(u * 61); s["sc"] = max(s["sc"], 1 + 0.05 * a)
        if k == "zoom": kk = p / 0.2 if p < 0.2 else 1 - (p - 0.2) / 0.8; s["sc"] *= 1 + 0.14 * a * (1 - (1 - kk) ** 2)
        if k == "blurin": s["blur"] = max(s["blur"], 24 * a * (1 - p) ** 1.6)
        if k == "rgb": s["rgb"] = max(s["rgb"], 12 * a * (0.7 + 0.3 * math.sin(u * 37)))
        if k == "bw": s["gray"] = max(s["gray"], a)
    for x in TR:
        a0 = x["t"] - x["dur"] / 2
        if T < a0 or T >= a0 + x["dur"]: continue
        u = (T - a0) / x["dur"]; tri = 1 - abs(2 * u - 1); k = x["kind"]
        if k == "zoom": s["sc"] *= 1 + 0.28 * tri ** 1.5; s["blur"] = max(s["blur"], 10 * tri ** 2)
        if k == "blur": s["blur"] = max(s["blur"], 22 * tri)
        if k == "glitch": s["rgb"] = max(s["rgb"], 16 * tri); s["sx"] += (1 if math.sin(T * 173) > 0 else -1) * 18 * tri
        if k == "whip":
            m = (u / 0.5 if u < 0.5 else (1 - u) / 0.5) ** 2
            s["sx"] += (-1 if u < 0.5 else 1) * m * -320; s["blur"] = max(s["blur"], 14 * tri)
    return s


def has_overlay(fx, tk=None):
    """does the file need the overlay frames (flash, dips, leak, grain, vignette)?"""
    if not fx: return False
    looks = [fx.get("look")] + list((fx.get("clips") or {}).values())
    if any(mix(l)["vig"] > 0.01 or mix(l)["grain"] > 0.01 for l in looks if l): return True
    if any(e.get("kind") in ("flash", "leak", "grain", "vig") for e in fx.get("effects") or []): return True
    return any(x.get("kind") in ("black", "fade", "white", "flash", "leak") for x in fx.get("trans") or [])


def _segments(vals, n, step, fps):
    """frames with the same rounded value -> [(value, t0, t1)] (piece-local seconds)"""
    seg, cur, a = [], None, 0
    for i in range(n + 1):
        v = round(vals[i] / step) * step if i < n else None
        if v != cur:
            if cur: seg.append((cur, a / fps, i / fps))
            cur, a = v, i
    return seg


def piece(fx, tk, b, s0, n, fps, OW, OH):
    """extra ffmpeg filters for one clip (after its framing crop). s0 = the clip's start on the timeline."""
    if not fx: return ""
    C = clip_ranges(tk); TR = trans_list(fx, C)
    o = mix(fx.get("look"))
    if (fx.get("clips") or {}).get(b["id"]): o = add(o, mix(fx["clips"][b["id"]]))
    out = []
    cf = color_filter(o)
    if cf: out.append(cf)
    P = [picture(fx, s0 + i / fps, TR) for i in range(n)]
    if any(p["sc"] != 1 or p["sx"] or p["sy"] for p in P):
        def expr(key, fmt):
            # one value per frame: if(lt(t, frame end), value, ...) only where it changes
            e = fmt(P[-1][key]); last = P[-1][key]
            for i in range(n - 2, -1, -1):
                if abs(P[i][key] - last) < 1e-4 and i < n - 1: continue
                e = f"if(lt(t\\,{(i + 1) / fps - 0.5 / fps:.4f})\\,{fmt(P[i][key])}\\,{e})"; last = P[i][key]
            return e
        # only frames that move get their own value; still frames share one
        Z = expr("sc", lambda v: f"{v:.4f}"); X = expr("sx", lambda v: f"{v:.2f}"); Y = expr("sy", lambda v: f"{v:.2f}")
        out.append(f"scale=w='trunc({OW}*({Z})/2)*2':h='trunc({OH}*({Z})/2)*2':eval=frame")
        out.append(f"crop={OW}:{OH}:'(iw-{OW})/2-({X})':'(ih-{OH})/2-({Y})'")
    for v, a, z in _segments([p["blur"] for p in P], n, 2, fps):
        if v >= 1: out.append(f"gblur=sigma={v:.1f}:enable='between(t\\,{a:.4f}\\,{z - 0.0001:.4f})'")
    for v, a, z in _segments([p["rgb"] for p in P], n, 2, fps):
        if v >= 1: out.append(f"rgbashift=rh={-int(v)}:bh={int(v)}:enable='between(t\\,{a:.4f}\\,{z - 0.0001:.4f})'")
    for v, a, z in _segments([p["gray"] for p in P], n, 0.1, fps):
        if v >= 0.05: out.append(f"hue=s={max(0, 1 - v):.2f}:enable='between(t\\,{a:.4f}\\,{z - 0.0001:.4f})'")
    return ",".join(out)

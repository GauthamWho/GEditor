"""Reel Editor server: one editor for every kit. localhost only, no GPU, no AI.
   python server.py [--kit blueprint] [--reel jensen_post35] [--port 8850] [--no-browser]
A kit plugs in with adapters/<kit>.json (see README.md). The kit's own files are never changed: the editor serves the reel
page read-only, keeps its own project files in projects/, and makes the final video itself (frames + the edited sounds + voice)."""
import remotion_bridge as RB
import notes_api as NA    # his notes + the AI door (notes_api.py, notes_ui.js, mcp_server.py)
import cutout as CO       # Cut me out: him + what he holds, away from the background (chat 9, L534)
import take_api as TA     # his own take: Auto Edit, Eye-Lock, captions, safe zone, SDR/HDR export (take_api.py, take_ui.js, take_reel.html)
import flow_api as FA     # Gautham Studio flow: step bar, caption switch, Ask Claude (flow_api.py, flow_ui.js)
import argparse, http.server, json, pathlib, re, shutil, socketserver, subprocess, sys, threading, time, urllib.parse, webbrowser

HERE = pathlib.Path(__file__).resolve().parent
LIB = HERE / "audio"          # Common/audio: the sound library every kit can use
MEDIA = None
ADAPTERS, PROJECTS, VENDOR = HERE / "adapters", HERE / "projects", HERE / "vendor"
MEDIA = PROJECTS / "media"               # photos / memes / sounds he adds
SAFE = re.compile(r"^[A-Za-z0-9_-]{1,60}$")
SR = 48000
EXP = {"state": "idle", "msg": "", "mp4": "", "pct": 0}
ST = {"kit": "take", "reel": "", "port": 8850}   # what is open now


def manifest(kit=None):
    kit = kit or ST["kit"]
    return json.loads((ADAPTERS / f"{kit}.json").read_text(encoding="utf-8"))


def kits(): return sorted(p.stem for p in ADAPTERS.glob("*.json"))
def is_rem(m=None): return (m or manifest()).get("type") == "remotion"


def reels_root(m=None):
    """page kits: their out folder. Remotion kits: the editor's own bridge folder (one sub-folder per reel)."""
    m = m or manifest()
    return RB.CACHE if is_rem(m) else HERE / pathlib.Path(m["reelsRoot"] or ".")


def list_reels(kit=None, with_time=False):
    m = manifest(kit)
    if is_rem(m):
        rows = RB.reels_for(m.get("match", {}), [manifest(k) for k in kits()])
        return [(r["id"], 0) for r in rows] if with_time else [r["id"] for r in rows]
    root = reels_root(m)
    if not m["reelsRoot"] or not root.exists(): return []
    rows = [(d.name, (d / m["reelFile"]).stat().st_mtime) for d in root.iterdir() if d.is_dir() and (d / m["reelFile"]).exists()]
    rows.sort(key=lambda r: r[1], reverse=True)
    return rows if with_time else [r[0] for r in rows]


def lan_link():
    """the address his Mac / laptop / iPhone use on the same Wi-Fi: this PC's Wi-Fi address + the fixed port"""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(("10.255.255.255", 1)); ip = s.getsockname()[0]
    except OSError: ip = socket.gethostbyname(socket.gethostname())
    finally: s.close()
    return f"http://{ip}:{ST['port']}"


def all_reels():
    """the home page: every reel of every kit, the ones he edited most recently first (Blueprint LEDGER L434)"""
    out = []
    for k in kits():
        m = manifest(k)
        try: rows = list_reels(k, with_time=True)
        except Exception: rows = []
        for r, made in rows:
            ed = [f.stat().st_mtime for f in PROJECTS.glob(f"{k}__{r}.*.json")]
            row = {"kit": k, "kitTitle": m.get("title", k), "reel": r, "made": made, "edited": max(ed) if ed else 0,
                   "cover": (PROJECTS / f"{k}__{r}.scan.json").exists(), "mine": m.get("type") == "take"}
            if row["mine"]:   # his own video projects: length + size like the Edits cards, picture from the preview copy (chat 8)
                try:
                    tk = json.loads((TA.TAKES / r / "take.json").read_text(encoding="utf-8"))
                    row["dur"] = round(sum(b["out"] - b["in"] for b in tk.get("blocks", [])), 2)
                    row["mb"] = round(pathlib.Path(tk["src"]).stat().st_size / 1e6, 1) if pathlib.Path(tk["src"]).exists() else 0
                    row["edited"] = max(row["edited"], (TA.TAKES / r / "take.json").stat().st_mtime)
                    row["cover"] = (TA.TAKES / r / "proxy.mp4").exists()
                except Exception: pass
            out.append(row)
    out.sort(key=lambda x: (x["edited"], x["made"]), reverse=True)
    return out


def cover(kit, reel):
    """one small picture from the middle of the reel, from its timeline scan"""
    import base64
    if not (SAFE.match(kit) and SAFE.match(reel)): return None
    if kit == "take":   # his own video: one frame a third of the way in, made once from the preview copy
        d = TA.TAKES / reel; c = d / "cover.jpg"
        if not c.exists() and (d / "proxy.mp4").exists():
            try:
                tk = json.loads((d / "take.json").read_text(encoding="utf-8")); b = tk["blocks"][len(tk["blocks"]) // 3] if tk.get("blocks") else {"in": 0}
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{b['in'] + 0.5:.2f}", "-i", str(d / "proxy.mp4"), "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", str(c)], timeout=30)
            except Exception: pass
        return c.read_bytes() if c.exists() else None
    f = PROJECTS / f"{kit}__{reel}.scan.json"
    if not f.exists(): return None
    th = json.loads(f.read_text(encoding="utf-8")).get("thumbs") or []
    if not th: return None
    return base64.b64decode(th[len(th) // 3]["src"].split(",", 1)[1])


def reel_dir():
    if is_rem(): return RB.build(ST["reel"])          # bundled on first open, cached after (rebuilt when the reel's files change)
    return reels_root() / ST["reel"]
def pfile(kind): return PROJECTS / f"{ST['kit']}__{ST['reel']}.{kind}.json"
def themes_dir():
    d = HERE / manifest()["themesDir"]; d.mkdir(exist_ok=True); return d


def inject_head(m, with_theme=True):
    s = f"<script>window.EDIT_MANIFEST={json.dumps(m)};</script>"
    return s


def reel_html(export=None):
    """the reel page with the editor runtime added just before </body>"""
    m = manifest()
    if m.get("type") == "take": TA.ensure_page()
    s = (reel_dir() / m["reelFile"]).read_text(encoding="utf-8")
    tag = f"<script>window.EDIT_MANIFEST={json.dumps(m)};</script>"
    if export:
        tag += "<script>" + (VENDOR / "theatre.core.js").read_text(encoding="utf-8") + "</script>"
        tag += f"<script>window.EDIT_TIMELINE={json.dumps(export['timeline'])};window.EDIT_OBJECTS={json.dumps(export['objects'])};window.EDIT_ITEMS={json.dumps(export.get('edits') or [])};window.EDIT_ADDED={json.dumps(embed_media(export.get('added') or []))};</script>"
    tag += '<script src="/edit/runtime.js"></script>' if not export else "<script>" + (HERE / "runtime.js").read_text(encoding="utf-8") + "</script>"
    if export and m.get("type") != "take":   # his look + effects go into the kit's video file (fx_runtime.js films with the page)
        try: tag += f"<script>window.EDIT_FX={pfile('fx').read_text(encoding='utf-8') if pfile('fx').exists() else 'null'};</script>"
        except Exception: pass
    tag += '<script src="/edit/fx_runtime.js"></script>' if not export else "<script>" + (HERE / "fx_runtime.js").read_text(encoding="utf-8") + "</script>"
    if m.get("themeScript"):
        tag += '<script src="/edit/theme.js"></script>' if not export else "<script>" + (ADAPTERS / m["themeScript"]).read_text(encoding="utf-8") + "</script>"
    if export: tag += f"<script>window.EDIT_THEME={json.dumps(export['theme'])};</script>"
    b = brand_now()   # his brand pick for this reel (captions + text look, LEDGER L481): live preview AND the video file
    if b: tag = f"<script>window.EDIT_BRAND={json.dumps(b)};</script>" + tag
    s = kit_keys_page(s)  # his edits to the kit's own camera keys (timeline, L439)
    s = FA.reel_page(s)   # Studio flow: caption switch + dragged caption times (flow_api.py)
    return s.replace("</body>", tag + "</body>", 1) if "</body>" in s else s + tag


BRANDS = HERE / "brands"
def brands_all():
    """every brand file: brands/<id>.json (LEDGER L481: GauthamWho first)"""
    out = []
    for f in sorted(BRANDS.glob("*.json")):
        try: out.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception: pass
    return out


def brand_now():
    """this reel's brand pick {"brand": id, "look": key} -> the brand with only that look, or None"""
    f = pfile("brand")
    if not f.exists(): return None
    try: pick = json.loads(f.read_text(encoding="utf-8"))
    except Exception: return None
    b = next((x for x in brands_all() if x.get("id") == pick.get("brand")), None)
    if not b: return None
    lk = pick.get("look") if pick.get("look") in b["looks"] else next(iter(b["looks"]))
    return dict({k: v for k, v in b.items() if k != "looks"}, look=lk, **b["looks"][lk])


def kit_keys_page(s):
    """the kit's own camera keys he changed in the timeline: written into window.BEATS before the kit's engine builds the animation.
    Works for kits whose page has window.BEATS.beats[i].cam (Blueprint); others ignore it."""
    f = pfile("kitkeys")
    if not f.exists(): return s
    try: kk = json.loads(f.read_text(encoding="utf-8"))
    except Exception: return s
    js = ("<script>(function(){var K=" + json.dumps(kk) + ";var B=window.BEATS&&window.BEATS.beats;if(!B)return;"
          "Object.keys(K.cam||{}).forEach(function(i){if(B[+i])B[+i].cam=K.cam[i];});})();</script>")
    m = re.search(r'<script[^>]*src="engine\.js', s)
    return s[:m.start()] + js + s[m.start():] if m else s


def embed_media(added):
    """the video page may be opened from a plain file: pictures he added travel inside it"""
    import base64, mimetypes
    out = []
    for a in added:
        a = dict(a); src = a.get("src") or ""
        if src.startswith("/media/"):
            f = (MEDIA / src[7:]).resolve()
            if MEDIA.resolve() in f.parents and f.is_file():
                a["src"] = f"data:{mimetypes.guess_type(f.name)[0] or 'image/png'};base64," + base64.b64encode(f.read_bytes()).decode()
        out.append(a)
    return out


def resolve_snd(rel, root):
    """a sound name from the editor -> a file: lib/... = Common/audio, media/... = what he added, else the kit's own folder"""
    if rel.startswith("lib/"): base, r = LIB, rel[4:]
    elif rel.startswith("media/"): base, r = MEDIA, rel[6:]
    elif rel.startswith("sfx/"): base, r = SFXLIB, rel[4:]          # the shared sound-effects folder (Sound FX tool, chat 8)
    elif rel.startswith("appr/"): base, r = APPROVED_DIR, rel[5:]   # sounds he approved by ear (Common/audio/approved_sounds.json)
    else: base, r = root, rel
    f = (base / r).resolve()
    return f if (base.resolve() in f.parents) else None


SFXLIB = HERE / "_absent" / "sfx"
APPROVED_DIR = HERE / "_absent" / "sounds_new"
SFX_CATS = {"whoosh": "Whoosh", "pop": "Pop", "click": "Click", "impact": "Hit", "riser": "Riser", "glitch": "Glitch", "tick": "Tick", "ding": "Ding", "typing": "Typing", "ambience": "Room / ambience"}


def sfx_library():
    """Sound FX tool (chat 8 plan): his approved sounds first (by what they are for), then the shared library by kind.
    Never a sound from banned_sounds.json (his rule 2026-11-21)."""
    def ld(n):
        try: return json.loads((LIB / n).read_text(encoding="utf-8"))
        except Exception: return {}
    banned = set(ld("banned_sounds.json").get("banned_ids", []))
    out = []
    for role, ids in (ld("approved_sounds.json").get("approved") or {}).items():
        files = []
        for i in ids:
            if i in banned: continue
            if i.startswith("kenney:"):
                f = LIB / "kenney-rpg-audio" / "Audio" / (i[7:] + ".ogg")
                if f.exists(): files.append({"id": i, "file": "lib/kenney-rpg-audio/Audio/" + f.name, "name": i[7:]})
            elif (APPROVED_DIR / (i + ".mp3")).exists(): files.append({"id": i, "file": f"appr/{i}.mp3", "name": i})
        if files: out.append({"group": "Approved: " + role, "approved": True, "files": files})
    for cat, label in SFX_CATS.items():
        d = SFXLIB / cat
        if not d.is_dir(): continue
        fs = [{"id": f.stem, "file": f"sfx/{cat}/{f.name}", "name": f.stem} for f in sorted(d.glob("*.*")) if f.suffix.lower() in (".ogg", ".mp3", ".wav") and not any(b in f.stem for b in banned)]
        if fs: out.append({"group": label, "files": fs})
    return out


def sound_library(root, m):
    rows = []
    if m.get("reelsRoot") and root.exists(): rows += sorted(f.relative_to(root).as_posix() for f in list(root.glob("sounds*/*.mp3")) + list(root.glob("sounds_guess/*/*.mp3")))
    for f in sorted((LIB / "kenney-rpg-audio" / "Audio").glob("*.ogg")): rows.append("lib/kenney-rpg-audio/Audio/" + f.name)
    return rows


# ------------------------------------------------------------------ sounds
def sounds_from_kit():
    """first list of sounds for a reel: the kit's own sound plan (beats.json events + the sounds he approved), as movable blocks.
    Same picking rule as the kit's sound placer, so an untouched list sounds exactly like the kit's own mix."""
    m = manifest()
    if m.get("sounds") == "kit-audio":
        f = RB.kit_audio(ST["reel"])
        if not f: RB.make_kit_audio(ST["reel"]); return []
        return [{"id": "kit", "t": 0, "role": "the reel's own sound", "file": f"{f.parent.name}/{f.name}", "gain": 0, "kit": True}]
    if m.get("sounds") == "kit-list":   # Tech Kit (chat 9): the kit's own placed list <reel>/sounds.json, each sound its own movable block
        f = reel_dir() / "sounds.json"
        if not f.exists(): return []
        return [{"id": f"s{i}", "t": round(x["t"], 2), "role": x["role"], "on": x.get("on", ""), "file": f"{ST['reel']}/assets/sfx/{x['id']}.mp3", "gain": x.get("db", 0)}
                for i, x in enumerate(json.loads(f.read_text(encoding="utf-8"))) if (reel_dir() / "assets" / "sfx" / f"{x['id']}.mp3").exists()]
    if m.get("sounds") != "blueprint": return []
    f = reel_dir() / "beats.json"
    if not f.exists(): return []
    root = reels_root(m); kitdir = root.parent
    sys.path.insert(0, str(kitdir))
    try:
        from sound_place2 import pick   # the kit's own picking rule: his ear picks + the kit's guesses, rotated (chat 41)
    except Exception:
        return []
    d = json.loads(f.read_text(encoding="utf-8")); rows = []
    for t, on, role, n, rel, lv, g in pick(d)[0]:
        if not (root / rel).exists(): continue
        rows.append({"id": f"s{len(rows)}", "t": round(t, 2), "role": role, "on": on, "file": rel, "gain": lv, **({"guessed": n} if g else {})})
    return rows


def learn_sounds(items):
    """his edit teaches the kit's sound guesser (Blueprint chat 41, his answer L421 "Delete it in the Reel Editor"): a GUESSED sound whose block he
    removed or silenced is banned for every project; a guessed sound he left everywhere is marked kept (liked). His own ear picks are never banned here."""
    try:
        root = reels_root(manifest()); sys.path.insert(0, str(root.parent))
        from sound_guess import learn
        start = sounds_from_kit()
        if start: EXP.update(learned=learn(start, items))
    except Exception as ex:
        EXP.update(learned={"error": str(ex)})


def decode(p):
    import numpy as np
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)


def mix_sounds(items, total, out_wav, root):
    """the edited sound list -> one track. Same rule as the kits: each file levelled to its own dB, loudest peak -3 dBFS."""
    import numpy as np
    from scipy.io import wavfile
    N = int(total * SR); mix = np.zeros(N)
    for it in items:
        if it.get("mute"): continue
        fp = resolve_snd(it["file"], root)
        if not fp or not fp.exists(): continue
        x = decode(fp)
        if not it.get("kit"): x = x / max(np.max(np.abs(x)), 1e-9)      # the reel's own finished mix keeps its level
        x = x * 10 ** (float(it.get("gain", 0)) / 20)
        if it.get("cut"): x = x[int(float(it["cut"]) * SR):]                 # his pulled block edges (GEditor chat 5)
        if it.get("len") is not None: x = x[:max(1, int(float(it["len"]) * SR))]
        s = int(float(it["t"]) * SR)
        if s < 0 or s >= N: continue
        x = x[:N - s]; mix[s:s + len(x)] += x
    pk = np.max(np.abs(mix)) or 1.0
    if any(it.get("kit") and not it.get("mute") for it in items):
        if pk > 10 ** (-1.0 / 20): mix = mix / pk * 10 ** (-1.0 / 20)   # only pull down if it would clip
    else: mix = mix / pk * 10 ** (-3.0 / 20)
    wavfile.write(str(out_wav), SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))


# ------------------------------------------------------------------ export
def export_job(body):
    if manifest().get("type") == "take":   # his take: picture straight from the original file (keeps HDR), not browser frames
        EXP.update(state="running", msg="starting", mp4="", pct=1)
        try: TA.export(body, EXP)
        except Exception as e: EXP.update(state="error", msg=f"{type(e).__name__}: {e}")
        return
    EXP.update(state="running", msg="copying the reel", mp4="", pct=2)
    try:
        from playwright.sync_api import sync_playwright
        m = manifest(); name = body.get("name") or "edit"; name = name if SAFE.match(name) else "edit"
        limit = float(body.get("seconds") or 0)
        dest = PROJECTS / "exports" / f"{ST['kit']}_{ST['reel']}_{name}"
        if dest.exists(): shutil.rmtree(dest)
        page = reel_html(export={"added": body.get("added") or [], "timeline": body.get("timeline") or {}, "objects": body["objects"], "theme": body["theme"], "edits": body.get("edits") or []})
        if is_rem(m):
            dest.mkdir(parents=True)
            xp = reel_dir() / f"export_{name}.html"; xp.write_text(page, encoding="utf-8")
            url = f"http://127.0.0.1:{ST['port']}/bridge/{reel_dir().name}/{xp.name}"
        else:
            top = reel_dir().resolve()   # Studio chat 8: skip old renders at the reel's top only; videos the page plays (assets/take.mp4, clips) are needed, or at() waits forever
            shutil.copytree(top, dest, ignore=lambda d, names: [n for n in names if n == "check" or n == "_frames.mp4" or (n.endswith(".mp4") and pathlib.Path(d).resolve() == top)])
            (dest / m["reelFile"]).write_text(page, encoding="utf-8")
            url = (dest / m["reelFile"]).as_uri()
        fps = 30; silent = dest / "_frames.mp4"
        ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(fps), str(silent)], stdin=subprocess.PIPE)
        t0 = time.time()
        with sync_playwright() as pw:
            br = pw.chromium.launch(); pg = br.new_page(viewport={"width": 1080, "height": 1920})
            pg.goto(url + "?at=0"); pg.wait_for_function("typeof window.at === 'function' && window.TOTAL > 0", timeout=60000)
            pg.wait_for_timeout(2500); pg.evaluate("window.at(0)")
            total = float(pg.evaluate("window.TOTAL")); dur = min(total, limit) if limit else total
            n = int(round(dur * fps))
            for i in range(n):
                pg.evaluate(f"window.at({i * 1000 / fps:.3f})")   # awaited when at() returns a promise (Remotion kits)
                ff.stdin.write(pg.screenshot(type="jpeg", quality=95))
                if i % 15 == 0: EXP.update(pct=int(5 + 85 * i / n), msg=f"frame {i}/{n}")
            br.close()
        ff.stdin.close(); ff.wait()
        EXP.update(pct=93, msg="mixing sound")
        mp4 = dest / f"{ST['reel']}_{name}_1080x1920_30fps.mp4"
        ins = ["-i", str(silent)]
        items = body.get("sounds")
        if m.get("sounds") == "blueprint" and items is not None and not limit: learn_sounds(items)   # chat 41 (L421): removed guess = banned, kept = liked
        if is_rem(m) and m.get("sounds") == "kit-audio" and not any(it.get("kit") for it in items or []):
            RB.make_kit_audio(ST["reel"])                     # the reel's own sound is needed in the file: wait for it
            while not RB.kit_audio(ST["reel"]) and RB.AUDIO.get(ST["reel"], {}).get("state") == "running":
                EXP.update(msg="making the reel's own sound (once per reel, about 5 min)"); time.sleep(2)
            f = RB.kit_audio(ST["reel"])
            if f: items = [{"id": "kit", "t": 0, "file": f"{f.parent.name}/{f.name}", "gain": 0, "kit": True}] + list(items or [])
        if items:
            mix_sounds(items, total, dest / "sound_edit.wav", reels_root(m))
            ins += ["-i", str(dest / "sound_edit.wav")]
        elif (dest / "assets" / "sound.m4a").exists(): ins += ["-i", str(dest / "assets" / "sound.m4a")]
        if (dest / "voice.wav").exists(): ins += ["-i", str(dest / "voice.wav")]
        na = len(ins) // 2 - 1
        base = ["ffmpeg", "-v", "error", "-y"] + ins
        if na == 0: cmd = base + ["-c:v", "copy", str(mp4)]
        LN = "loudnorm=I=-16:TP=-1.5:LRA=11"   # Studio chat 8: his finals are -16 LUFS (the editor's video came out at -21.7)
        if na == 1: cmd = base + ["-map", "0:v", "-map", "1:a", "-af", LN, "-ar", "48000", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{dur:.3f}", str(mp4)]
        elif na > 1: cmd = base + ["-filter_complex", f"[1:a][2:a]amix=inputs=2:normalize=0,{LN},aresample=48000[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{dur:.3f}", str(mp4)]
        subprocess.run(cmd, check=True); silent.unlink(missing_ok=True)
        EXP.update(state="done", msg=f"video ready ({n} frames, {time.time() - t0:.0f}s)", mp4=str(mp4), pct=100)
    except Exception as e:
        EXP.update(state="error", msg=f"{type(e).__name__}: {e}")


# ------------------------------------------------------------------ timeline scan (thumbnails + when each piece is on screen)
SCAN = {}            # (kit, reel) -> {"state", "pct", "msg"}
SCAN_V = 3           # bump when the scan changes (3: kit layers such as each pin, LEDGER L480)
PIECE_JS = r"""() => { const W = innerWidth, H = innerHeight, out = {};
  for (const e of document.querySelectorAll('[data-ek],[data-lid]')) {
    let op = 1, n = e, vis = true;
    for (; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') { vis = false; break; } op *= +c.opacity; }
    const r = e.getBoundingClientRect();
    out[e.dataset.ek || 'L:' + e.dataset.lid] = vis && op > 0.05 && r.width > 2 && r.height > 2 && r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
  }
  return out; }"""
NAME_JS = r"""() => Object.fromEntries([...document.querySelectorAll('[data-ek]')].map(e => {
  const img = e.querySelector('img'), cls = String(e.className || '').split(/\s+/), kind = /joke|meme/.test(cls.join(' ')) ? 'meme' : /slip|label/.test(cls.join(' ')) ? 'slip' : /pol/.test(cls.join(' ')) ? 'photo' : (img ? 'picture' : 'piece');
  const pic = img ? decodeURIComponent((img.getAttribute('src') || '').split('/').pop().split('?')[0]).replace(/\.[a-z0-9]+$/i, '') : '';
  const txt = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const name = [e.dataset.id, pic, txt].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ') || e.dataset.edit || e.dataset.ek;
  return [e.dataset.ek, { kind, name }]; }))"""


def scan_file(): return PROJECTS / f"{ST['kit']}__{ST['reel']}.scan.json"
def scan_sig():
    try: f = reel_dir() / manifest()["reelFile"]; return f"{SCAN_V}:{f.stat().st_mtime:.0f}:{f.stat().st_size}"
    except Exception: return f"{SCAN_V}:?"


def scan_job(key, sig):
    """opens the reel once in a hidden browser: a small picture every 0.5 s (the LINES row) and, every 0.1 s, which kit pieces
    are on screen (the PIECES row). Read-only; cached per reel until the reel page changes."""
    SCAN[key] = {"state": "running", "pct": 0, "msg": "starting"}
    try:
        import base64
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            br = pw.chromium.launch(); pg = br.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=0.125)
            pg.goto(f"http://127.0.0.1:{ST['port']}/reel/reel.html?at=0&edit=1")
            pg.wait_for_function("typeof window.at === 'function' && window.TOTAL > 0", timeout=90000); pg.wait_for_timeout(1500)
            total = float(pg.evaluate("window.TOTAL")); pg.evaluate("window.at(0)")
            names = pg.evaluate(NAME_JS); spans = {k: [] for k in names}; on = {}; thumbs = []
            layers = {"L:" + l["key"]: l for l in pg.evaluate("window.editLayers ? window.editLayers() : []")}   # each pin etc. (kit marks, LEDGER L480)
            spans.update({k: [] for k in layers})
            n = int(total * 10)
            for i in range(n + 1):
                t = min(total - 0.001, i / 10)
                pg.evaluate(f"window.at({t * 1000:.1f})")
                vis = pg.evaluate(PIECE_JS)
                for k, v in vis.items():
                    if k not in spans: spans[k] = []
                    if v and k not in on: on[k] = t
                    if not v and k in on: spans[k].append([round(on.pop(k), 2), round(t, 2)])
                if i % 5 == 0:
                    thumbs.append({"t": round(t, 2), "src": "data:image/jpeg;base64," + base64.b64encode(pg.screenshot(type="jpeg", quality=70)).decode()})
                if i % 20 == 0: SCAN[key].update(pct=int(100 * i / max(n, 1)), msg=f"{t:.0f} of {total:.0f} s")
            for k, t0 in on.items(): spans[k].append([round(t0, 2), round(total, 2)])
            if len(names) + len(layers) < len(spans): names.update({k: {"kind": "piece", "name": k} for k in spans if k not in names and k not in layers})
            br.close()
        pieces = [{"key": k, **names[k], "spans": v} for k, v in spans.items() if v and k in names]
        lay = [dict(layers[k], spans=v) for k, v in spans.items() if v and k in layers]
        out = {"sig": sig, "total": total, "thumbs": thumbs, "pieces": pieces, "layers": lay}
        if key == (ST["kit"], ST["reel"]): scan_file().write_text(json.dumps(out), encoding="utf-8")
        SCAN[key] = {"state": "done", "pct": 100, "msg": ""}
    except Exception as e:
        SCAN[key] = {"state": "error", "pct": 0, "msg": f"{type(e).__name__}: {e}"}


def scan_get():
    if manifest().get("type") == "take": return {"state": "done", "pieces": [], "layers": [], "thumbs": []}   # a take draws its own rows (take_ui.js)
    key, sig = (ST["kit"], ST["reel"]), scan_sig()
    f = scan_file()
    if f.exists():
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("sig") == sig: return dict(d, state="done")
    s = SCAN.get(key) or {}
    if s.get("state") != "running" and not (s.get("state") == "error" and s.get("sig") == sig):
        threading.Thread(target=scan_job, args=(key, sig), daemon=True).start(); s = {"state": "running", "pct": 0, "msg": "starting"}
    if s.get("state") == "error": SCAN[key]["sig"] = sig
    return s


CT = {".js": "application/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
      ".gif": "image/gif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
      ".html": "text/html; charset=utf-8", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf"}
def ctype(f): return CT.get(f.suffix.lower(), "application/octet-stream")


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(b)

    def file(self, f):
        """a file, with byte ranges (video and sound inside a reel must be seekable); only the asked part is read"""
        size = f.stat().st_size; rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if not m:
            if size < 8_000_000: return self.send(200, f.read_bytes(), ctype(f))
            a, b, code = 0, size - 1, 200
        else:
            a = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2) or 0))
            b = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
            b = min(b, size - 1, a + 8_000_000 - 1); code = 206          # at most 8 MB per answer; the browser asks for the rest
        self.send_response(code); self.send_header("Content-Type", ctype(f)); self.send_header("Accept-Ranges", "bytes")
        if code == 206: self.send_header("Content-Range", f"bytes {a}-{b}/{size}")
        self.send_header("Content-Length", str(b - a + 1 if code == 206 else size)); self.send_header("Cache-Control", "no-store"); self.end_headers()
        with f.open("rb") as h:
            h.seek(a); left = (b - a + 1) if code == 206 else size
            while left > 0:
                c = h.read(min(1 << 20, left))
                if not c: break
                self.wfile.write(c); left -= len(c)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urllib.parse.urlparse(self.path); p = urllib.parse.unquote(u.path); m = manifest()
        JS = "application/javascript"
        if p in ("/", "/index.html"): return self.send(200, (HERE / "editor.html").read_text(encoding="utf-8"), "text/html; charset=utf-8")
        if p == "/home": return self.send(200, (HERE / "home.html").read_text(encoding="utf-8"), "text/html; charset=utf-8")
        if p == "/api/allreels": return self.send(200, json.dumps({"open": {"kit": ST["kit"], "reel": ST["reel"]}, "reels": all_reels(), "lan": lan_link()}))
        if p == "/api/cover":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query); b = cover((q.get("kit") or [""])[0], (q.get("reel") or [""])[0])
            return self.send(200, b, "image/jpeg") if b else self.send(404, "{}")
        if p == "/edit/runtime.js": return self.send(200, (HERE / "runtime.js").read_bytes(), JS)
        if p == "/edit/flow_ui.js": return self.send(200, (HERE / "flow_ui.js").read_bytes(), JS)
        if p == "/edit/panels_ui.js": return self.send(200, (HERE / "panels_ui.js").read_bytes(), JS)
        if p == "/edit/notes_ui.js": return self.send(200, (HERE / "notes_ui.js").read_bytes(), JS)
        if p == "/edit/share_ui.js": return self.send(200, (HERE / "share_ui.js").read_bytes(), JS)   # Share button (chat 9, L543)
        if p in ("/edit/layout_ui.js", "/edit/tools_ui.js", "/edit/fx_runtime.js"): return self.send(200, (HERE / p[6:]).read_bytes(), JS)   # chat 8: new layout + new tools
        if NA.get(self, p) or FA.get(self, p) or TA.get(self, p) or CO.get(self, p): return
        if p == "/edit/take_ui.js": return self.send(200, (HERE / "take_ui.js").read_bytes(), JS)
        if p == "/edit/theme.js" and m.get("themeScript"): return self.send(200, (ADAPTERS / m["themeScript"]).read_bytes(), JS)
        if p == "/edit/theatre.bundle.js": return self.send(404, "{}")
        if p == "/reel/reel.html":
            try: return self.send(200, reel_html(), "text/html; charset=utf-8")
            except Exception as e: return self.send(500, f"<pre style='color:#fff;font:28px monospace;padding:40px'>This reel could not be opened. {e}</pre>", "text/html; charset=utf-8")
        if p.startswith("/reel/"):
            f = (reel_dir() / p[6:]).resolve()
            if reel_dir().resolve() in f.parents and f.is_file():
                return self.file(f)
            return self.send(404, "{}")
        if p.startswith("/snd/"):
            f = resolve_snd(p[5:], reels_root(m).resolve())
            if f and f.suffix.lower() in (".mp3", ".wav", ".m4a", ".ogg", ".webm") and f.is_file():
                return self.file(f)
            return self.send(404, "{}")
        if p.startswith("/bridge/"):
            f = (RB.CACHE / p[8:]).resolve()
            if RB.CACHE.resolve() in f.parents and f.is_file(): return self.file(f)
            return self.send(404, "{}")
        if p == "/api/state":
            try: reels = list_reels(); err = ""
            except Exception as e: reels, err = [], str(e)
            titles = {k: manifest(k).get("title", k) for k in kits()}
            return self.send(200, json.dumps({"kit": ST["kit"], "reel": ST["reel"], "kits": kits(), "titles": titles, "reels": reels, "manifest": m, "error": err,
                                              "audio": RB.AUDIO.get(ST["reel"], {}) if is_rem(m) else {}, "lan": lan_link()}))
        if p == "/api/themes": return self.send(200, json.dumps(sorted({x.stem for x in themes_dir().glob("*.json")} | {"default"})))
        if p.startswith("/api/theme/"):
            n = p[11:]; f = themes_dir() / f"{n}.json"
            if n == "default" and not f.exists(): return self.send(200, json.dumps({"name": "default", "colors": {}, "caption": {}, "moves": {}}))
            return self.send(200, f.read_bytes()) if SAFE.match(n) and f.exists() else self.send(404, "{}")
        if p == "/api/edits": return self.send(200, pfile("edits").read_bytes() if pfile("edits").exists() else "[]")
        if p == "/api/timeline": return self.send(200, pfile("timeline").read_bytes() if pfile("timeline").exists() else "{}")
        if p == "/api/sounds":
            if pfile("sounds").exists(): return self.send(200, pfile("sounds").read_bytes())
            return self.send(200, json.dumps(sounds_from_kit()))
        if p == "/api/sfxlib": return self.send(200, json.dumps(sfx_library()))
        if p == "/api/fx":   # Filters / Adjust / Effects / Transitions (chat 8): his own video keeps them in take.json
            if m.get("type") == "take": return self.send(200, json.dumps((TA.load() or {}).get("fx") or {}))
            return self.send(200, pfile("fx").read_bytes() if pfile("fx").exists() else "{}")
        if p == "/api/soundfiles":
            return self.send(200, json.dumps(sound_library(reels_root(m), m)))
        if p.startswith("/media/"):
            f = (MEDIA / p[7:]).resolve()
            if MEDIA.resolve() in f.parents and f.is_file(): return self.file(f)
            return self.send(404, "{}")
        if p == "/api/added": return self.send(200, pfile("added").read_bytes() if pfile("added").exists() else "[]")
        if p == "/api/brands": return self.send(200, json.dumps(brands_all()))
        if p == "/api/brand": return self.send(200, pfile("brand").read_bytes() if pfile("brand").exists() else "{}")
        if p == "/api/kitkeys": return self.send(200, pfile("kitkeys").read_bytes() if pfile("kitkeys").exists() else '{"cam":{}}')
        if p == "/api/markers": return self.send(200, pfile("markers").read_bytes() if pfile("markers").exists() else '{"marks":[]}')
        if p == "/api/scan": return self.send(200, json.dumps(scan_get()))
        if p == "/api/export": return self.send(200, json.dumps(EXP))
        # pictures and sounds a Remotion reel asks for with staticFile("x") arrive as "/x": they live in Video/public
        f = (RB.VIDEO / "public" / p.lstrip("/")).resolve()
        if (RB.VIDEO / "public").resolve() in f.parents and f.is_file(): return self.file(f)
        self.send(404, "{}")

    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path
        if p == "/api/share/telegram": return self.send(404, '{"ok":false,"error":"not in this package"}')
        if NA.post(self, p) or FA.post(self, p) or TA.post(self, p) or CO.post(self, p): return
        if p == "/api/open":
            b = self.body()
            if not SAFE.match(b.get("kit", "")) or not (ADAPTERS / f"{b['kit']}.json").exists(): return self.send(400, '{"error":"unknown kit"}')
            ST["kit"] = b["kit"]; rl = list_reels()
            r = b.get("reel") or (manifest().get("defaultReel") if manifest().get("defaultReel") in rl else (rl[0] if rl else ""))
            if r and not SAFE.match(r): return self.send(400, '{"error":"bad reel"}')
            ST["reel"] = r; return self.send(200, '{"ok":true}')
        if p.startswith("/api/theme/"):
            n = p[11:]
            if not SAFE.match(n): return self.send(400, '{"error":"bad name"}')
            if n == "default": return self.send(403, '{"error":"default is locked"}')
            t = self.body(); t["name"] = n
            (themes_dir() / f"{n}.json").write_text(json.dumps(t, indent=1), encoding="utf-8"); return self.send(200, '{"ok":true}')
        if p in ("/api/timeline", "/api/sounds", "/api/edits", "/api/added", "/api/markers", "/api/kitkeys", "/api/brand", "/api/fx"):
            PROJECTS.mkdir(exist_ok=True)
            pfile(p[5:]).write_text(json.dumps(self.body()), encoding="utf-8"); return self.send(200, '{"ok":true}')
        if p == "/api/upload":            # a picture / meme / sound from his computer: raw bytes, name in ?name=
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query); nm = re.sub(r"[^A-Za-z0-9._-]", "_", (q.get("name") or ["file"])[0])[-60:]
            ext = pathlib.Path(nm).suffix.lower()
            if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp3", ".wav", ".m4a", ".ogg", ".webm"): return self.send(400, '{"error":"that file type is not allowed"}')
            n = int(self.headers.get("Content-Length") or 0)
            if n > 80_000_000: return self.send(400, '{"error":"file too big (80 MB max)"}')
            d = MEDIA / f"{ST['kit']}__{ST['reel']}"; d.mkdir(parents=True, exist_ok=True)
            f = d / f"{int(time.time() * 1000)}_{nm}"; f.write_bytes(self.rfile.read(n))
            rel = f"{d.name}/{f.name}"
            return self.send(200, json.dumps({"src": "/media/" + rel, "file": "media/" + rel, "name": nm}))
        if p == "/api/sounds/reset":
            pfile("sounds").unlink(missing_ok=True); return self.send(200, json.dumps(sounds_from_kit()))
        if p == "/api/export":
            if EXP["state"] == "running": return self.send(409, '{"error":"already rendering"}')
            threading.Thread(target=export_job, args=(self.body(),), daemon=True).start()
            return self.send(200, '{"ok":true}')
        self.send(404, "{}")

    def do_DELETE(self):
        p = urllib.parse.urlparse(self.path).path
        if p.startswith("/api/theme/"):
            n = p[11:]
            if n == "default" or not SAFE.match(n): return self.send(403, '{"error":"default is locked"}')
            (themes_dir() / f"{n}.json").unlink(missing_ok=True); return self.send(200, '{"ok":true}')
        self.send(404, "{}")


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True
    def handle_error(self, request, client_address):   # the browser cancelling a video/sound request is normal: stay quiet
        if not isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)): super().handle_error(request, client_address)


FA.init(sys.modules[__name__]); NA.init(sys.modules[__name__]); TA.init(sys.modules[__name__]); CO.init(sys.modules[__name__], TA)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--kit", default="take"); ap.add_argument("--reel", default=""); ap.add_argument("--port", type=int, default=8850); ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--last", action="store_true", help="open the reel he edited most recently, any kit (the GEditor desktop icon)")
    a = ap.parse_args()
    PROJECTS.mkdir(exist_ok=True); (PROJECTS / "exports").mkdir(exist_ok=True)
    if a.last and not a.reel:
        try:
            top = next((r for r in all_reels() if r["edited"]), None)
            if top: a.kit, a.reel = top["kit"], top["reel"]
        except Exception as e: print(f"could not find the last reel ({e}); opening {a.kit}", flush=True)
    ST["kit"] = a.kit; ST["port"] = a.port; rl = list_reels()
    ST["reel"] = a.reel or (manifest().get("defaultReel") if manifest().get("defaultReel") in rl else (rl[0] if rl else ""))
    print(f"Reel Editor: http://localhost:{a.port}  (kit {ST['kit']}, reel {ST['reel']}). Close this window to stop it.", flush=True)
    if not a.no_browser: threading.Timer(1.2, lambda: webbrowser.open(f"http://localhost:{a.port}")).start()
    print(f"Other devices on the same Wi-Fi (Mac, laptop, iPhone): {lan_link()}", flush=True)
    S(("0.0.0.0", a.port), H).serve_forever()   # reachable from his other devices on the home Wi-Fi (Blueprint LEDGER L435)

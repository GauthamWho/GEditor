"""Remotion bridge: lets the Reel Editor open any reel made in Remotion (SKY, Notebook, HalfBright, Red Cheeks, any future kit).

How: Video/src/Root.tsx (and the composition files it renders, like <HbWarCompositions />) are read as text. Every
<Composition id="..." component={X} durationInFrames={...} ...> becomes a reel. Opening one writes a tiny entry file
that imports only that component, bundles it with esbuild from Video/node_modules (no new packages), and serves a page
that plays it with @remotion/player and has the same contract as a kit's reel page: window.at(ms), window.TOTAL.
Nothing in Video/ or the kits is ever changed. Bundles are cached in projects/_bridge/<comp id>/ and rebuilt when any
file that went into them changes."""
import json, os, pathlib, re, subprocess

VIDEO = pathlib.Path(__file__).resolve().parent / "_no_remotion"   # the public GEditor has no Remotion kits
ROOT_TSX = VIDEO / "src" / "Root.tsx"
HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / "projects" / "_bridge"
ESBUILD = VIDEO / "node_modules" / "esbuild" / "bin" / "esbuild"   # run with node directly (no .cmd, no shell quoting trouble)
SKIP_ID = re.compile(r"(SafeCheck|Preview|Sheet|Board|Still|Frame|Options?|Test|Audit|Probe)$", re.I)
EXTS = (".tsx", ".ts", ".jsx", ".js")


def _match_brace(s, i):
    """s[i] is '{': index just after its matching '}' (skips strings and template literals)."""
    d, q = 0, None
    while i < len(s):
        c = s[i]
        if q:
            if c == "\\": i += 2; continue
            if c == q: q = None
        elif c in "\"'`": q = c
        elif c == "{": d += 1
        elif c == "}":
            d -= 1
            if d == 0: return i + 1
        i += 1
    return -1


def _imports(src, here):
    """name -> (absolute module path without extension, exported name)"""
    out = {}
    for m in re.finditer(r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+[\"']([^\"']+)[\"']", src, re.S):
        mod = m.group(2)
        if not mod.startswith("."): continue
        p = (here / mod).resolve()
        for part in m.group(1).split(","):
            part = part.strip()
            if not part or part.startswith("type "): continue
            a = re.split(r"\s+as\s+", part)
            out[a[-1].strip()] = (p, a[0].strip())
    return out


def _resolve_file(p):
    if p.suffix in EXTS and p.exists(): return p
    for e in EXTS:
        if (p.parent / (p.name + e)).exists(): return p.parent / (p.name + e)
    for e in EXTS:
        if (p / ("index" + e)).exists(): return p / ("index" + e)
    return None


def _tags(src):
    """every <Composition ...> tag: dict attr -> raw expression text"""
    for m in re.finditer(r"<Composition\b", src):
        i, attrs, n = m.end(), {}, len(src)
        while i < n:
            while i < n and src[i].isspace(): i += 1
            if src.startswith("/>", i) or src.startswith(">", i): break
            a = re.match(r"([A-Za-z_]\w*)\s*=\s*", src[i:])
            if not a: break
            k = a.group(1); i += a.end()
            if src[i] in "\"'":
                j = src.index(src[i], i + 1); attrs[k] = src[i:j + 1]; i = j + 1
            elif src[i] == "{":
                j = _match_brace(src, i); attrs[k] = src[i + 1:j - 1].strip(); i = j
            else: break
        yield attrs


IDENT = re.compile(r"(?<![\w.$\"'])([A-Za-z_$][\w$]*)")


def _idents(expr):
    s = re.sub(r"\"(?:\\.|[^\"])*\"|'(?:\\.|[^'])*'", "''", expr or "")
    s = re.sub(r"([A-Za-z_$][\w$]*)\s*:", " ", s)           # object keys
    return {x for x in IDENT.findall(s) if x not in ("true", "false", "null", "undefined", "Math")}


def _scan_file(f, seen, rows):
    f = f.resolve()
    if f in seen or not f.exists(): return
    seen.add(f)
    src = f.read_text(encoding="utf-8", errors="ignore"); imp = _imports(src, f.parent)
    for a in _tags(src):
        cid = a.get("id", "")
        if not (cid[:1] in "\"'" and cid[-1:] == cid[:1]): continue          # only plain string ids
        cid = cid[1:-1]; comp = a.get("component", "")
        if comp not in imp: continue
        exprs = {k: a.get(k, "") for k in ("durationInFrames", "fps", "width", "height", "defaultProps")}
        need = set().union(*(_idents(v) for v in exprs.values())) | {comp}
        if not need <= set(imp): continue                                    # uses a value made inside the file: skip
        mfile = _resolve_file(imp[comp][0])
        if not mfile: continue
        rows.append({"id": cid, "component": comp, "file": mfile.as_posix(), "exprs": exprs,
                     "imports": {k: [imp[k][0].as_posix(), imp[k][1]] for k in need}, "where": f.as_posix()})
    # follow composition files rendered as <SomethingCompositions /> / <Compositions />
    for m in re.finditer(r"<([A-Z]\w*(?:Compositions|Comps))\s*/>", src):
        if m.group(1) in imp:
            g = _resolve_file(imp[m.group(1)][0])
            if g: _scan_file(g, seen, rows)


_SCAN = {"key": None, "rows": None, "files": []}
_BUILT = {}   # comp id -> (time checked, folder): the many file requests of one page do not re-check every source file


def scan():
    """cached until Root.tsx or one of the composition files it points to changes"""
    key = tuple((f, os.path.getmtime(f)) for f in _SCAN["files"] if os.path.exists(f)) if _SCAN["files"] else None
    if key and key == _SCAN["key"]: return _SCAN["rows"]
    seen = set(); rows = _scan(seen)
    _SCAN.update(files=sorted(str(f) for f in seen), rows=rows)
    _SCAN["key"] = tuple((f, os.path.getmtime(f)) for f in _SCAN["files"] if os.path.exists(f))
    return rows


def _scan(seen):
    rows = []; _scan_file(ROOT_TSX, seen, rows)
    out, ids = [], set()
    for r in rows:
        if r["id"] in ids: continue
        ids.add(r["id"]); e = r["exprs"]
        r["vertical"] = e["width"].strip() in ("1080", "") and e["height"].strip() in ("1920", "")
        r["still"] = e["durationInFrames"].strip() in ("1", "")
        r["helper"] = bool(SKIP_ID.search(r["id"]))
        out.append(r)
    return out


def reels_for(match, all_adapters):
    """the reels an adapter of type remotion owns. match = {"path": regex, "id": regex} or {"rest": true}"""
    rows = [r for r in scan() if r["vertical"] and not r["still"] and not r["helper"]]
    def hit(r, m):
        return bool((m.get("path") and re.search(m["path"], r["file"], re.I)) or (m.get("id") and re.search(m["id"], r["id"], re.I)))
    if match.get("exclude"): rows = [r for r in rows if not re.search(match["exclude"], r["id"], re.I)]
    if match.get("rest"):
        others = [a.get("match", {}) for a in all_adapters if a.get("type") == "remotion" and not a.get("match", {}).get("rest")]
        return [r for r in rows if not any(hit(r, m) for m in others)]
    return [r for r in rows if hit(r, match)]


def find(cid):
    for r in scan():
        if r["id"] == cid: return r
    return None


# ------------------------------------------------------------------ bundle
ENTRY = """import * as __React from "react";
import { createRoot as __createRoot } from "react-dom/client";
import { Player as __Player } from "@remotion/player";
__IMPORTS__
const __FPS = (__FPS__);
const __FRAMES = (__FRAMES__);
const __PROPS = (__PROPS__);
const __W = (__W__), __H = (__H__);
const __two = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
const __App = () => {
  const ref = __React.useRef<any>(null);
  __React.useEffect(() => {
    const w = window as any;
    w.TOTAL = __FRAMES / __FPS; w.FPS = __FPS; w.player = ref.current; w.BRIDGE = { id: __ID__, frames: __FRAMES, fps: __FPS };
    w.at = async (ms: number) => {
      ref.current?.seekTo(Math.max(0, Math.min(__FRAMES - 1, Math.round(ms / 1000 * __FPS))));
      await __two();
      if (w.__editAfterAt) w.__editAfterAt(ms);
    };
    w.dispatchEvent(new Event("bridge-ready"));
  }, []);
  return <__Player ref={ref} component={__COMP__ as any} inputProps={__PROPS} durationInFrames={__FRAMES} fps={__FPS}
    compositionWidth={__W} compositionHeight={__H} style={{ width: 1080, height: 1920 }} acknowledgeRemotionLicense
    clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false}
    numberOfSharedAudioTags={0} initiallyMuted />;
};
__createRoot(document.getElementById("root")!).render(<__App />);
"""

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>__ID__</title>
<style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000}#root{width:1080px;height:1920px}</style>
<script>window.remotion_inputProps="{}";window.REMOTION_BRIDGE=true;</script></head>
<body><div id="root"></div><script src="bridge.js"></script></body></html>"""


def _stale(d):
    b, meta = d / "bridge.js", d / "meta.json"
    if not b.exists() or not meta.exists(): return True
    t = b.stat().st_mtime
    try: ins = json.loads(meta.read_text(encoding="utf-8"))["inputs"]
    except Exception: return True
    for k in ins:
        p = pathlib.Path(k) if os.path.isabs(k) else (d / k)
        try:
            if p.stat().st_mtime > t: return True
        except OSError: return True
    return False


def build(cid, force=False):
    """bundle one composition; returns its cache folder (bridge.js + index.html + assets)."""
    import time
    if not force and cid in _BUILT and time.time() - _BUILT[cid][0] < 10: return _BUILT[cid][1]
    r = find(cid)
    if not r: raise KeyError(f"no composition {cid}")
    d = CACHE / re.sub(r"[^A-Za-z0-9_-]", "_", cid); d.mkdir(parents=True, exist_ok=True)
    if not force and not _stale(d):
        pg = PAGE.replace("__ID__", cid)
        if not (d / "index.html").exists() or (d / "index.html").read_text(encoding="utf-8") != pg: (d / "index.html").write_text(pg, encoding="utf-8")
        _BUILT[cid] = (time.time(), d); return d
    lines, by_mod = [], {}
    for name, (mod, exp) in r["imports"].items(): by_mod.setdefault(mod, []).append(f"{exp} as {name}" if exp != name else name)
    for mod, names in by_mod.items():
        rel = os.path.relpath(mod, d).replace("\\", "/")
        lines.append(f'import {{ {", ".join(sorted(names))} }} from "{rel if rel.startswith(".") else "./" + rel}";')
    e = r["exprs"]
    src = (ENTRY.replace("__IMPORTS__", "\n".join(lines)).replace("__FPS__", e["fps"] or "30").replace("__FRAMES__", e["durationInFrames"])
           .replace("__PROPS__", e["defaultProps"] or "{}").replace("__W__", e["width"] or "1080").replace("__H__", e["height"] or "1920")
           .replace("__ID__", json.dumps(cid)).replace("__COMP__", r["component"]))
    (d / "entry.tsx").write_text(src, encoding="utf-8")
    (d / "index.html").write_text(PAGE.replace("__ID__", cid), encoding="utf-8")
    env = dict(os.environ, NODE_PATH=str(VIDEO / "node_modules"), MSYS_NO_PATHCONV="1")
    loaders = [f"--loader:{x}=file" for x in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp3", ".wav", ".m4a", ".mp4", ".webm", ".woff", ".woff2", ".ttf", ".otf", ".glb")]
    cmd = ["node", str(ESBUILD), "entry.tsx", "--bundle", "--outfile=bridge.js", "--jsx=automatic", "--format=iife", "--metafile=meta.json",
           '--define:process.env.NODE_ENV="development"', "--log-level=error"] + loaders
    p = subprocess.run(cmd, cwd=d, env=env, capture_output=True, text=True)
    if p.returncode != 0:
        (d / "bridge.js").unlink(missing_ok=True)
        raise RuntimeError("bundle failed: " + (p.stderr or p.stdout)[-1500:])
    (d / "comp.json").write_text(json.dumps(r, indent=1), encoding="utf-8")
    _BUILT[cid] = (time.time(), d)
    return d


# ------------------------------------------------------------------ the reel's own sound (voice, music, its SFX)
AUDIO = {}   # comp id -> {"state": idle|running|done|error, "msg": ""}


def kit_audio(cid):
    """path of the reel's own mixed sound, or None while it is not made yet. Made once by Remotion (about 5 min), kept
    until the reel's files change."""
    d = CACHE / re.sub(r"[^A-Za-z0-9_-]", "_", cid); f = d / "kit_audio.wav"
    if not f.exists(): return None
    try: ins = json.loads((d / "meta.json").read_text(encoding="utf-8"))["inputs"]
    except Exception: return f
    t = f.stat().st_mtime
    for k in ins:                       # a changed source file of the reel = its sound may have changed too
        p = (pathlib.Path(k) if os.path.isabs(k) else (d / k)).resolve()
        if p.parent == d.resolve(): continue          # the editor's own entry file, rewritten on every rebuild
        if p.exists() and p.stat().st_mtime > t: return None
    return f


def make_kit_audio(cid):
    """runs in a thread. Same mix Remotion puts in its own render, nothing else."""
    import threading
    if AUDIO.get(cid, {}).get("state") == "running" or kit_audio(cid): return
    AUDIO[cid] = {"state": "running", "msg": "making the reel's own sound (about 5 min, once)"}
    def job():
        d = build(cid); out = d / "kit_audio.part.wav"
        p = subprocess.run(["node", str(VIDEO / "node_modules/@remotion/cli/remotion-cli.js"), "render", "src/index.ts", cid, str(out),
                            "--codec=wav", "--log=error"], cwd=VIDEO, capture_output=True, text=True)
        if p.returncode == 0 and out.exists():
            out.replace(d / "kit_audio.wav"); AUDIO[cid] = {"state": "done", "msg": ""}
        else:
            AUDIO[cid] = {"state": "error", "msg": (p.stderr or p.stdout)[-600:]}
    threading.Thread(target=job, daemon=True).start()


if __name__ == "__main__":
    import sys, time
    rows = scan()
    print(len(rows), "compositions;", sum(1 for r in rows if r["vertical"] and not r["still"] and not r["helper"]), "vertical reels")
    for a in sys.argv[1:]:
        t = time.time(); d = build(a, force=True); print(a, "->", d, f"{time.time() - t:.1f}s", (d / "bridge.js").stat().st_size // 1024, "KB")

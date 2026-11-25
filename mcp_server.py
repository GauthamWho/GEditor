"""mcp_server.py: the Reel Editor connector for Claude (and any app that speaks MCP: opencode, Qoder, local model apps).
His words (LEDGER L441): "is it not like a MCP where the clock can directly enter and edit ... I should able to connect it with any LLMs".
A tiny MCP server over stdio (JSON-RPC, one message per line), Python standard library only. It talks to the running Reel Editor
(http://localhost:8850, or REEL_EDITOR_URL) through notes_api.py's plain web calls; every edit shows up in the open editor within
~2 s with "Claude changed: ..." and Ctrl+Z puts it back (his answer, L447).

Add to Claude (once, every chat):  claude mcp add --scope user reel-editor -- python <GEditor folder>/mcp_server.py
Try it by hand:                    python mcp_server.py --selftest"""
import base64, json, os, pathlib, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
URL = os.environ.get("REEL_EDITOR_URL", "http://localhost:8850").rstrip("/")
SRC = os.environ.get("REEL_EDITOR_AI_NAME", "Claude")
VERSION = "1.0.0"


# ------------------------------------------------------------------ talking to the editor
class EditorDown(Exception): pass


def call(path, body=None, raw=False):
    req = urllib.request.Request(URL + path, None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST",
                                 headers={"X-Src": SRC, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read(); return (data, dict(r.headers)) if raw else json.loads(data or b"{}")
    except urllib.error.HTTPError as e:
        try: msg = json.loads(e.read()).get("error") or str(e)
        except Exception: msg = str(e)
        raise ValueError(msg)
    except (urllib.error.URLError, ConnectionError, TimeoutError):
        raise EditorDown(f"The Reel Editor is not running at {URL}. Use the start_editor tool (or double-click OPEN_REEL_EDITOR.bat).")


def start_editor(a):
    try: return {"already": True, "state": call("/api/state").get("reel")}
    except EditorDown: pass
    port = urllib.parse.urlparse(URL).port or 8850
    args = [sys.executable, str(HERE / "server.py"), "--port", str(port), "--no-browser"]
    if a.get("kit"): args += ["--kit", a["kit"]]
    if a.get("reel"): args += ["--reel", a["reel"]]
    flags = 0x00000008 | 0x00000200 if os.name == "nt" else 0          # DETACHED_PROCESS | NEW_PROCESS_GROUP: keeps running after this chat
    subprocess.Popen(args, cwd=str(HERE), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    for _ in range(40):
        time.sleep(0.5)
        try: st = call("/api/state"); return {"started": True, "kit": st["kit"], "reel": st["reel"], "open_in_browser": URL}
        except EditorDown: pass
    raise ValueError("the editor did not start in 20 s")


# ------------------------------------------------------------------ tools
def T(name, desc, props=None, req=None):
    return {"name": name, "description": desc, "inputSchema": {"type": "object", "properties": props or {}, "required": req or []}}


N = {"type": "number"}; S_ = {"type": "string"}
KIT_REEL = {"kit": {"type": "string", "description": "kit id, e.g. blueprint (default: the open reel)"}, "reel": {"type": "string", "description": "reel id (default: the open reel)"}}
TOOLS = [
    T("editor_status", "Is the Reel Editor running, which kit + reel is open, its links (this PC and Wi-Fi), the open-notes count and the last change."),
    T("start_editor", "Start the Reel Editor server if it is not running (no browser window). Optional kit + reel to open.", dict(KIT_REEL)),
    T("list_reels", "Every reel of every kit, most recently edited first, with how many open notes each has."),
    T("open_reel", "Open another reel in the editor (the open browser tab follows on its next reload). Needed before editing a reel that is not open.", dict(KIT_REEL), ["kit", "reel"]),
    T("list_notes", "Gautham's notes on a reel: what he wants changed, from which second to which second, on which thing (sound id, news piece, line, camera, key). "
      "state open = still to do. Each note has kit, reel, folder and an editor link.",
      dict(KIT_REEL, state={"type": "string", "enum": ["open", "done", "all"], "description": "default open"}, all_reels={"type": "boolean", "description": "notes of every reel"})),
    T("add_note", "Add a note to a reel (e.g. a question back to Gautham, or a to-do you found).",
      dict(KIT_REEL, text=S_, t0=N, t1=N, kind={"type": "string", "enum": ["note", "change", "like", "need-audio"]}, what=S_), ["text"]),
    T("resolve_note", "Answer a note and (by default) tick it done. Say in plain words what you changed. Gautham sees the reply under his note.",
      dict(KIT_REEL, id=S_, reply=S_, done={"type": "boolean", "description": "default true; false = only answer, keep it open"}), ["id", "reply"]),
    T("get_reel", "Everything about the open reel: lines (spoken lines with start + length), pieces (news pages / memes on screen and when), sounds "
      "(id, t start seconds, file, gain dB, role, guessed), added stickers/captions, markers, the kit's camera keys he changed, keyframes, "
      "captions, notes, and soundFiles (files you can use in set_sound / add_sound). Read this before editing.",
      {"include_sound_files": {"type": "boolean", "description": "default false (the list can be long)"}}),
    T("see_frame", "A small picture of the reel near a second (from the editor's timeline scan). Use it to look at what is on screen before and after a change.", {"t": N}, ["t"]),
    T("add_sound", "Add a sound to the open reel at a time.", {"file": {"type": "string", "description": "one of soundFiles from get_reel"}, "t": N, "gain": {"type": "number", "description": "dB, default -6"}, "role": S_}, ["file", "t"]),
    T("set_sound", "Change one sound of the open reel: move it (t), louder/quieter (gain dB), swap the file, silence it (mute).",
      {"id": S_, "t": N, "gain": N, "file": S_, "mute": {"type": "boolean"}, "role": S_}, ["id"]),
    T("delete_sound", "Remove one sound from the open reel.", {"id": S_}, ["id"]),
    T("set_added", "Change a thing Gautham added on top of the reel (caption, text, card, photo): any of its fields (t0, t1, x, y, text, size...).",
      {"id": S_, "fields": {"type": "object"}}, ["id", "fields"]),
    T("delete_added", "Remove a thing Gautham added on top of the reel.", {"id": S_}, ["id"]),
    T("set_camera_keys", "Replace the kit's camera keys of one line (Blueprint): keys = [{u: seconds into the line, x, y: where the camera looks, s: zoom, e: ease}]. "
      "Read the current ones in get_reel (camkeys, or the kit's own in lines). reset=true puts the kit's own keys back.",
      {"line": {"type": "integer", "description": "0-based line index (line 1 = 0)"}, "keys": {"type": "array", "items": {"type": "object"}}, "reset": {"type": "boolean"}}, ["line"]),
    T("set_keyframe", "Add or change one keyframe: object (from get_reel objects[].object), prop (from its props, e.g. dx, dy, scale, rot, zoom), "
      "t seconds, v value, ease smooth|linear|in|out|hold. delete=true removes the key at t.",
      {"object": S_, "prop": S_, "t": N, "v": N, "ease": {"type": "string", "enum": ["smooth", "linear", "in", "out", "hold"]}, "delete": {"type": "boolean"}}, ["object", "prop", "t"]),
    T("set_caption", "Captions: mode ta (his Tanglish words) or en (English line), or move one caption group earlier/later: key 'line.group' (e.g. '3.1'), shift seconds (-5..5).",
      {"mode": {"type": "string", "enum": ["ta", "en"]}, "key": S_, "shift": N}),
    T("add_marker", "Drop a marker on the timeline (a flag he sees on the ruler), e.g. where you changed something.", {"t": N, "label": S_}, ["t"]),
]


def text(o): return {"content": [{"type": "text", "text": o if isinstance(o, str) else json.dumps(o, ensure_ascii=False, indent=1)}]}


def run(name, a):
    kr = {k: a[k] for k in ("kit", "reel") if a.get(k)}
    if name == "start_editor": return text(start_editor(a))
    if name == "editor_status":
        st = call("/api/state"); ch = call("/api/ai/changes"); nn = call("/api/notes")
        return text({"running": True, "kit": st["kit"], "reel": st["reel"], "editor": URL, "wifi_link": st.get("lan"), "open_notes": sum(1 for n in nn if n.get("state") != "done"), "last_change": ch})
    if name == "list_reels":
        r = call("/api/allreels"); cnt = {}
        for n in call("/api/notes?all=1"):
            if n.get("state") != "done": cnt[(n["kit"], n["reel"])] = cnt.get((n["kit"], n["reel"]), 0) + 1
        return text({"open": r["open"], "reels": [{"kit": x["kit"], "kitTitle": x["kitTitle"], "reel": x["reel"], "open_notes": cnt.get((x["kit"], x["reel"]), 0),
                                                   "edited": time.strftime("%Y-%m-%d %H:%M", time.localtime(x["edited"])) if x["edited"] else ""} for x in r["reels"]]})
    if name == "open_reel": call("/api/open", {"kit": a["kit"], "reel": a["reel"]}); return text(f"Opened {a['kit']} / {a['reel']}. Reload the editor tab to see it.")
    if name == "list_notes":
        q = "?all=1" if a.get("all_reels") else ("?" + urllib.parse.urlencode(kr) if kr else "")
        L = call("/api/notes" + q); want = a.get("state") or "open"
        if want != "all": L = [n for n in L if (n.get("state") or "open") == want]
        return text(L if L else f"No {want} notes.")
    if name == "add_note": return text(call("/api/notes/add", dict(kr, text=a["text"], t0=a.get("t0", 0), t1=a.get("t1", a.get("t0", 0)), kind=a.get("kind") or "note", what=a.get("what") or "", by=SRC)))
    if name == "resolve_note":
        b = dict(kr, id=a["id"], reply=a["reply"], by=SRC)
        if a.get("done", True): b["state"] = "done"
        return text(call("/api/notes/update", b))
    if name == "get_reel":
        r = call("/api/ai/reel")
        if not a.get("include_sound_files"): r["soundFiles"] = f"{r.get('soundFilesTotal', 0)} files: call get_reel with include_sound_files=true to list them"
        if not r.get("lines"): r["lines_note"] = "the editor has not been opened on this reel yet, so its lines are unknown; open it once in the browser"
        return text(r)
    if name == "see_frame":
        data, h = call(f"/api/ai/frame?t={float(a['t']):.2f}", raw=True)
        return {"content": [{"type": "text", "text": f"the reel near {h.get('X-Frame-Time', a['t'])} s"}, {"type": "image", "data": base64.b64encode(data).decode(), "mimeType": "image/jpeg"}]}
    if name == "add_sound": return text(call("/api/ai/sound", {"op": "add", "file": a["file"], "t": a["t"], "gain": a.get("gain", -6), "role": a.get("role") or ""})["msg"])
    if name == "set_sound": return text(call("/api/ai/sound", dict({k: v for k, v in a.items() if k in ("id", "t", "gain", "file", "mute", "role")}, op="set"))["msg"])
    if name == "delete_sound": return text(call("/api/ai/sound", {"op": "delete", "id": a["id"]})["msg"])
    if name == "set_added": return text(call("/api/ai/added", dict(a.get("fields") or {}, op="set", id=a["id"]))["msg"])
    if name == "delete_added": return text(call("/api/ai/added", {"op": "delete", "id": a["id"]})["msg"])
    if name == "set_camera_keys":
        b = {"line": a["line"], "op": "reset"} if a.get("reset") else {"line": a["line"], "keys": a.get("keys") or []}
        return text(call("/api/ai/camkey", b)["msg"])
    if name == "set_keyframe":
        b = {"object": a["object"], "prop": a["prop"], "t": a["t"]}
        b.update({"op": "delete"} if a.get("delete") else {"v": a.get("v"), "ease": a.get("ease") or "smooth"})
        return text(call("/api/ai/keyframe", b)["msg"])
    if name == "set_caption": return text(call("/api/ai/caption", {k: a[k] for k in ("mode", "key", "shift") if k in a})["msg"])
    if name == "add_marker": return text(call("/api/ai/marker", {"t": a["t"], "label": a.get("label") or ""})["msg"])
    raise ValueError("unknown tool " + name)


# ------------------------------------------------------------------ MCP over stdio
def reply(i, result=None, error=None):
    m = {"jsonrpc": "2.0", "id": i}
    if error: m["error"] = error
    else: m["result"] = result
    sys.stdout.write(json.dumps(m, ensure_ascii=False) + "\n"); sys.stdout.flush()


def handle(m):
    meth, i, p = m.get("method"), m.get("id"), m.get("params") or {}
    if i is None: return                                  # notifications (initialized, cancelled): nothing to answer
    if meth == "initialize":
        return reply(i, {"protocolVersion": p.get("protocolVersion") or "2025-06-18", "capabilities": {"tools": {"listChanged": False}},
                         "serverInfo": {"name": "reel-editor", "version": VERSION},
                         "instructions": "Gautham's Reel Editor. Start with list_notes (his open notes) and get_reel, change the reel with the set_/add_/delete_ tools, "
                                         "look with see_frame, then resolve_note with a plain-words reply. Every change shows at once in his open editor; he can undo it."})
    if meth == "ping": return reply(i, {})
    if meth == "tools/list": return reply(i, {"tools": TOOLS})
    if meth == "tools/call":
        try: return reply(i, run(p.get("name"), p.get("arguments") or {}))
        except (ValueError, KeyError, EditorDown) as e: return reply(i, dict(text(f"Error: {e}"), isError=True))
        except Exception as e: return reply(i, dict(text(f"Error: {type(e).__name__}: {e}"), isError=True))
    if meth in ("resources/list", "prompts/list"): return reply(i, {meth.split("/")[0]: []})
    reply(i, error={"code": -32601, "message": "method not found: " + str(meth)})


def main():
    if "--selftest" in sys.argv:
        for n, a in (("editor_status", {}), ("list_notes", {"state": "all"})):
            try: print(n, "->", run(n, a)["content"][0]["text"][:600])
            except Exception as e: print(n, "-> Error:", e)
        return
    sys.stdout.reconfigure(encoding="utf-8"); sys.stdin.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try: m = json.loads(line)
        except Exception: reply(None, error={"code": -32700, "message": "parse error"}); continue
        for x in (m if isinstance(m, list) else [m]): handle(x)


if __name__ == "__main__":
    main()

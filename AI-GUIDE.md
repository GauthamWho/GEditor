# Reel Editor: guide for any AI (Claude, opencode, DeepSeek, Qoder, a local model)

Gautham edits his reels in the Reel Editor (a page on his PC). He leaves **notes** on the timeline ("from 12 s to 15 s the camera
should zoom into the headline"). Your job: read his open notes, look at the reel, change it, then answer the note and tick it
done. Every change you make shows up in his open editor within about 2 seconds with a pop-up "<your name> changed: …", and he
can press Ctrl+Z to undo it. So make the change he asked for and nothing more.

## Two ways in

1. **MCP connector** (Claude Code, opencode, Qoder, any MCP app): server `mcp_server.py` in this folder (stdio, Python standard library only).
   - Claude Code: `claude mcp add --scope user reel-editor -- python <GEditor folder>/mcp_server.py`.
   - opencode (`opencode.json`): `"mcp": {"reel-editor": {"type": "local", "command": ["python", "<GEditor folder>/mcp_server.py"], "environment": {"REEL_EDITOR_AI_NAME": "opencode"}}}`
   - Set `REEL_EDITOR_AI_NAME` to the name he should see in the pop-up (default "Claude"); `REEL_EDITOR_URL` if the editor is not on `http://localhost:8850`.
   - Tools: `editor_status`, `start_editor`, `list_reels`, `open_reel`, `list_notes`, `add_note`, `resolve_note`, `get_reel`, `see_frame`,
     `add_sound`, `set_sound`, `delete_sound`, `set_added`, `delete_added`, `set_camera_keys`, `set_keyframe`, `set_caption`, `add_marker`.
2. **Plain web calls** (any model that can run `curl` or Python): the editor at `http://localhost:8850` (from another device on his
   Wi-Fi: the address in the editor's "📱 Other devices" button). Send the header `X-Src: <your name>` on every write.

## The loop (both ways)

1. `GET /api/notes?all=1` (or `list_notes`): his notes. Open = still to do. Each note has `id, kind (note|change|like|need-audio),
   t0, t1 (seconds), text, what (the thing he right-clicked: "sound: pin · kenney-… (id s4)", "line 3: …", "camera of line 2"), kit, reel, folder, link`.
2. If the note's reel is not the open one: `POST /api/open {"kit": "...", "reel": "..."}` (or `open_reel`). His editor tab switches by itself.
3. `GET /api/ai/reel` (or `get_reel`): lines (spoken lines, start + length), pieces (news pages, memes on screen and when), sounds
   (id, t, file, gain dB, role, guessed), added things, markers, camera keys he changed, keyframes, captions, sound files you may use.
4. `GET /api/ai/frame?t=12.3` (or `see_frame`): a picture of the reel near that second. Look before and after.
5. Change it (one call per change):

| What | Web call (POST, JSON body) |
|---|---|
| add a sound | `/api/ai/sound {"op":"add","file":"sounds4/x.mp3","t":12.3,"gain":-6}` |
| move / louder / swap / silence a sound | `/api/ai/sound {"op":"set","id":"s4","t":12.5,"gain":-3,"file":"…","mute":false}` |
| remove a sound | `/api/ai/sound {"op":"delete","id":"s4"}` |
| change / remove an added caption, card, photo | `/api/ai/added {"op":"set","id":"a…","t0":3,"t1":5,"text":"…"}` / `{"op":"delete","id":"a…"}` |
| the kit's camera keys of a line (Blueprint) | `/api/ai/camkey {"line":2,"keys":[{"u":0,"x":540,"y":700,"s":1.1,"e":"soft"}]}` / `{"line":2,"op":"reset"}` |
| a keyframe (move, size, turn of a piece; camera zoom) | `/api/ai/keyframe {"object":"<objects[].object>","prop":"scale","t":4.0,"v":1.2,"ease":"smooth"}` (`"op":"delete"` removes) |
| captions | `/api/ai/caption {"mode":"en"}` or `{"key":"3.1","shift":-0.3}` |
| a marker on the ruler | `/api/ai/marker {"t":12.3,"label":"new whoosh"}` |

6. Answer the note: `POST /api/notes/update {"id":"n…","reply":"Done: moved the whoosh to 12.5 s and made it 3 dB louder.","state":"done"}`
   (or `resolve_note`). Write the reply in plain words he understands (no file names, no code). If you could not do it, keep it
   open (`"state"` left out) and say why in the reply.

## Rules

- Change only what the note asks. Never delete his sounds or pieces unless the note says so.
- Times are seconds from the start of the reel. Gain is dB (0 = as recorded, -6 = quieter).
- A sound marked `guessed` was guessed by the kit; a sound with `kit: true` is the reel's own track and cannot be changed here.
- The final video is made only when he presses "Make the video file" in the editor: do not render.
- Errors come back as `{"error": "plain reason"}` (HTTP 400). Fix the call; do not retry the same thing.
- The editor not running: `start_editor` (MCP) or run `python server.py --no-browser` in this folder.

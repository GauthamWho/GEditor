# Third-party parts GEditor uses

GEditor's own code is under the GEditor Licence (see LICENSE). These other free parts are used and keep their own licences.
Nothing here is bundled except Theatre.js core; the rest is installed by `setup.py` from the usual public sources.

| Part | What GEditor uses it for | Licence |
|---|---|---|
| Theatre.js core (`vendor/theatre.core.js`) | keyframe maths | Apache-2.0 |
| FFmpeg (installed separately) | cutting, joining, colour, sound | LGPL / GPL, depends on the build you install |
| Playwright + Chromium | draws captions and effects into the video | Apache-2.0 / BSD |
| rembg + ONNX Runtime | "Cut me out" (person without background) | MIT / MIT |
| u2net models (downloaded on first use) | cut-out, Fast | Apache-2.0 |
| BiRefNet model (downloaded on first use) | cut-out, Best | MIT |
| faster-whisper (Whisper models, downloaded on first use) | caption words from your voice | MIT |
| OpenCV (headless) | finds your face and eyes for Eye-Lock | Apache-2.0 |
| NumPy, SciPy, Pillow | maths, sound, pictures | BSD-style |
| Inter font (Google Fonts, loaded from the web) | caption look | OFL |

Theatre's separate "studio" editor is **not** included (it has a different licence).
Check the licence of any model or font before you sell something made with it.

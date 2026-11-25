"""GEditor one-click setup (Windows + Mac). Run by setup_windows.bat / setup_mac.command.

What it does, in order (it tells you each step, and asks before installing anything outside this folder):
  1. checks Python 3.9+
  2. makes a private .venv folder here and installs the Python parts into it (nothing touches your system Python)
  3. checks ffmpeg + ffprobe (the video tools); offers to install them with winget (Windows) or Homebrew (Mac)
  4. installs the small browser GEditor uses to draw captions into the video file (Playwright Chromium)
  5. checks that everything imports, then tells you how to start GEditor
The cut-out models (about 400 MB) download once, the first time you press "Cut me out".
Options: --yes answers every question with yes (for scripts)."""
import os, pathlib, platform, shutil, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
WIN = platform.system() == "Windows"
YES = "--yes" in sys.argv
VENV = HERE / ".venv"
VPY = VENV / ("Scripts/python.exe" if WIN else "bin/python")


def say(msg): print(f"\n== {msg}", flush=True)
def ask(q):
    if YES: print(f"{q} [y] (--yes)"); return True
    try: return input(f"{q} [Y/n] ").strip().lower() in ("", "y", "yes")
    except EOFError: return True
def run(cmd, **kw): return subprocess.run([str(c) for c in cmd], **kw)


def main():
    print("GEditor setup. Folder:", HERE)
    say("1/5  Python")
    if sys.version_info < (3, 9): sys.exit(f"Python {sys.version.split()[0]} is too old. Install Python 3.9 or newer from python.org, then run this again.")
    print("Python", sys.version.split()[0], "OK")

    say("2/5  Private Python folder (.venv) + parts (about 5 minutes the first time)")
    if not VPY.exists(): run([sys.executable, "-m", "venv", VENV], check=True)
    run([VPY, "-m", "pip", "install", "--upgrade", "pip", "-q"])
    r = run([VPY, "-m", "pip", "install", "-r", HERE / "requirements.txt"])
    if r.returncode: sys.exit("Installing the Python parts failed (see the lines above). Fix that, then run this setup again: it continues where it stopped.")

    say("3/5  ffmpeg + ffprobe (the video tools)")
    if shutil.which("ffmpeg") and shutil.which("ffprobe"): print("ffmpeg found:", shutil.which("ffmpeg"))
    else:
        done = False
        if WIN and shutil.which("winget") and ask("ffmpeg is missing. Install it with winget now (free, about 100 MB)?"):
            done = run(["winget", "install", "--id", "Gyan.FFmpeg", "-e", "--accept-source-agreements", "--accept-package-agreements"]).returncode == 0
        elif (not WIN) and shutil.which("brew") and ask("ffmpeg is missing. Install it with Homebrew now?"):
            done = run(["brew", "install", "ffmpeg"]).returncode == 0
        print("ffmpeg installed. If GEditor says it cannot find ffmpeg, close this window and open a new one so your computer sees it." if done else
              "Please install ffmpeg yourself:  Windows: winget install Gyan.FFmpeg   Mac: brew install ffmpeg   (or ffmpeg.org/download.html). Then run this setup again.")

    say("4/5  Caption drawing browser (Playwright Chromium, about 150 MB)")
    if run([VPY, "-m", "playwright", "install", "chromium"]).returncode: print("Could not install it. Exporting videos with captions needs it: run  .venv/bin/python -m playwright install chromium  later.")

    say("5/5  Check")
    code = "import numpy, scipy, cv2, PIL, playwright, onnxruntime, rembg, faster_whisper; assert hasattr(cv2, 'CascadeClassifier'); import server; print('all parts load')"
    r = run([VPY, "-c", code], cwd=HERE)
    if r.returncode: sys.exit("A part did not load (see above). Run this setup again; if it keeps failing, open an issue on GitHub with the lines above.")

    start = "Start_GEditor.bat" if WIN else "Start_GEditor.command"
    print(f"\nDONE. Start GEditor by double-clicking {start} (the browser opens by itself).")
    print("To use it from your phone or another computer: open the Share button (top right) and use the Wi-Fi link.")
    lnk = pathlib.Path(os.path.expanduser("~")) / "Desktop" / "GEditor.lnk"
    if WIN and not lnk.exists() and ask("Put a GEditor icon on your Desktop?"):   # never replaces an icon that is already there
        ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\GEditor.lnk');"
              f"$s.TargetPath='{HERE / start}';$s.WorkingDirectory='{HERE}';$s.IconLocation='{HERE / 'logo.ico'}';$s.Save()")
        run(["powershell", "-NoProfile", "-Command", ps])


if __name__ == "__main__": main()

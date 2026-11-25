"""kitfolder.py: read a GEditor project folder (Reel Editor LEDGER L534). Made by GEditor's Export -> "Me without background".
Any kit uses it instead of cutting and cutting out again:  python kitfolder.py <folder>  -> checks it + prints what is inside.
In Python:  from kitfolder import load; f = load(folder); f["person_webm"], f["bg"], f["head"], f["words"] ...
Layer order to put things BEHIND him: bg.mp4 -> your objects -> person.webm (see-through)."""
import json, pathlib, sys

FILES = {"bg": "bg.mp4", "person_webm": "person.webm", "person_mov": "person_alpha.mov", "green": "person_green.mp4",
         "mask": "mask.mp4", "head_json": "head.json", "words_json": "words.json", "project": "project/take.json", "readme": "README.md"}


def load(folder):
    d = pathlib.Path(folder)
    if not (d / "README.md").exists() or "GEditor project folder" not in (d / "README.md").read_text(encoding="utf-8", errors="replace"):
        raise ValueError(f"{d} is not a GEditor project folder (no GEditor README.md)")
    out = {k: d / v for k, v in FILES.items()}
    miss = [v for k, v in FILES.items() if not out[k].exists()]
    if miss: raise FileNotFoundError(f"{d}: missing {', '.join(miss)} (export the folder again in GEditor)")
    out["head"] = json.loads(out["head_json"].read_text(encoding="utf-8"))
    out["words"] = json.loads(out["words_json"].read_text(encoding="utf-8"))["words"]
    out["fps"] = out["head"]["fps"]; out["size"] = out["head"].get("size"); out["frames"] = len(out["head"]["frames"])
    return out


if __name__ == "__main__":
    f = load(sys.argv[1])
    print(f"OK GEditor folder: {f['frames']} frames at {f['fps']} fps, size {f['size']}, {len(f['words'])} words")
    for k in FILES: print(f"  {k:12s} {f[k]}")

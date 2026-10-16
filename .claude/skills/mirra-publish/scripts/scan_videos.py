"""List videos in config.video_dir with metadata and publish status (needs ffprobe)."""
import hashlib
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import VIDEO_EXTS, load_config, read_log  # noqa: E402


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, text=True, check=True).stdout
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        return {"probe_error": str(e)}
    data = json.loads(out)
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    w, h = v.get("width"), v.get("height")
    rot = str(v.get("tags", {}).get("rotate", "")) or ""
    for sd in v.get("side_data_list", []):
        rot = str(sd.get("rotation", rot))
    if rot.lstrip("-") in ("90", "270") and w and h:
        w, h = h, w
    ratio = None
    if w and h:
        from math import gcd
        g = gcd(w, h)
        ratio = f"{w // g}:{h // g}"
    return {
        "duration_sec": round(float(data.get("format", {}).get("duration", 0)), 1),
        "resolution": f"{w}x{h}" if w else None,
        "aspect_ratio": ratio,
        "has_audio": any(s.get("codec_type") == "audio" for s in data.get("streams", [])),
    }


def main():
    cfg = load_config()
    vdir = os.path.expanduser(cfg["video_dir"])
    log = read_log()
    done_names = {r["file"] for r in log if r["status"] == "success"}
    done_hashes = {r["sha256"] for r in log if r["status"] == "success"}
    unknown = {r["file"] for r in log if r["status"] == "unknown"} | {r["sha256"] for r in log if r["status"] == "unknown"}
    rows = []
    for name in sorted(os.listdir(vdir), key=lambda n: os.path.getmtime(os.path.join(vdir, n))):
        path = os.path.join(vdir, name)
        if not os.path.isfile(path) or os.path.splitext(name)[1].lower() not in VIDEO_EXTS:
            continue
        digest = sha256(path)
        if name in done_names or digest in done_hashes:
            status = "published"
        elif name in unknown or digest in unknown:
            status = "check_needed"  # 이전 발행 결과 미확인 → 중복 위험, 사람 확인 필요
        else:
            status = "new"
        rows.append({"file": name, "path": path, "format": os.path.splitext(name)[1].lstrip(".").lower(),
                     "size_mb": round(os.path.getsize(path) / 1e6, 1), "sha256": digest,
                     "status": status, **probe(path)})
    print(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

"""Extract evenly spaced keyframes (+ audio/transcript if possible) for analysis. Needs ffmpeg."""
import argparse
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import KIT  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--frames", type=int, default=8)
    a = ap.parse_args()
    out = os.path.join(KIT, "work", os.path.splitext(os.path.basename(a.video))[0])
    os.makedirs(out, exist_ok=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                "default=nw=1:nk=1", a.video], capture_output=True, text=True, check=True).stdout)
    frames = []
    for i in range(a.frames):
        t = dur * (i + 0.5) / a.frames
        p = os.path.join(out, f"frame_{i + 1:02d}_{t:05.1f}s.jpg")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", a.video, "-frames:v", "1",
                        "-vf", "scale='min(1080,iw)':-2", "-q:v", "3", p], check=True)
        frames.append(p)
    audio = os.path.join(out, "audio.wav")
    has_audio = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.video, "-vn", "-ac", "1", "-ar", "16000",
                                audio]).returncode == 0 and os.path.getsize(audio) > 1000
    transcript = None
    if has_audio and shutil.which("whisper"):
        subprocess.run(["whisper", audio, "--language", "ko", "--model", "small", "--output_format", "txt",
                        "--output_dir", out], check=False)
        t = os.path.join(out, "audio.txt")
        if os.path.exists(t):
            transcript = os.path.join(out, "transcript.txt")
            os.replace(t, transcript)
    print(json.dumps({"duration_sec": round(dur, 1), "frames": frames,
                      "audio": audio if has_audio else None, "transcript": transcript}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

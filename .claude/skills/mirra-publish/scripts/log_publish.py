"""Append one publish result to mirra-publisher/publish-log.csv."""
import argparse
import csv
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from common import LOG, LOG_FIELDS  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    for f in ("file", "sha256", "accounts", "caption", "hashtags"):
        ap.add_argument(f"--{f.replace('_', '-')}", required=True)
    ap.add_argument("--status", required=True, choices=["success", "failed", "unknown"])
    ap.add_argument("--post-url", default="")
    ap.add_argument("--error", default="")
    a = ap.parse_args()
    new = not os.path.exists(LOG)
    with open(LOG, "a", encoding="utf-8-sig" if new else "utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LOG_FIELDS)
        if new:
            w.writeheader()
        w.writerow({"published_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                    "file": a.file, "sha256": a.sha256, "accounts": a.accounts, "caption": a.caption,
                    "hashtags": a.hashtags, "status": a.status, "post_url": a.post_url, "error": a.error})
    print(f"기록 완료: {LOG}")


if __name__ == "__main__":
    main()

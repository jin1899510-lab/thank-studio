"""Shared helpers for the mirra-publish skill (stdlib only)."""
import csv
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
KIT = os.path.join(ROOT, "mirra-publisher")
CONFIG = os.path.join(KIT, "config.json")
LOG = os.path.join(KIT, "publish-log.csv")
LOG_FIELDS = ["published_at", "file", "sha256", "accounts", "caption", "hashtags", "status", "post_url", "error"]
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}


def load_config():
    if not os.path.exists(CONFIG):
        sys.exit(f"config.json이 없습니다: {CONFIG}\nconfig.example.json을 복사해 값을 채우세요.")
    with open(CONFIG, encoding="utf-8") as f:
        return json.load(f)


def read_log():
    if not os.path.exists(LOG):
        return []
    with open(LOG, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))

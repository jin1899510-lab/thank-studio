"""Mirra 영상 발행 프로그램 (Mirra MCP 서버 사용, 파이썬 표준 라이브러리만 사용).

사용법
  python mirra_app.py            # 창 열기: 영상 선택 → 캡션 입력 → 계정 선택 → 지금 발행
  python mirra_app.py tools      # Mirra MCP가 제공하는 도구 목록을 tools.json으로 저장

설정은 같은 폴더의 config.json (config.example.json 참고).
"""
import base64
import csv
import hashlib
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "config.json")
LOG = os.path.join(HERE, "publish-log.csv")
LOG_FIELDS = ["published_at", "file", "sha256", "accounts", "caption", "hashtags", "status", "post_url", "error"]
DEFAULT_URL = "https://www.mirra.my/api/mcp"

# 도구 이름을 config.json "tools"에 지정하지 않았을 때 이름으로 추측하는 키워드
TOOL_KEYWORDS = {
    "accounts": [["account"], ["channel"], ["profile"], ["social"]],
    "upload": [["upload"], ["media"], ["asset"]],
    "publish": [["publish"], ["post", "create"], ["content", "create"]],
    "status": [["post", "status"], ["publish", "status"], ["get", "post"], ["get", "content"]],
}


class MirraError(Exception):
    pass


# ---------------------------------------------------------------- MCP client
class MCPClient:
    """Minimal MCP client over Streamable HTTP (JSON-RPC POST, JSON or SSE replies)."""

    def __init__(self, url, api_key, auth_header="Authorization", auth_prefix="Bearer ", timeout=300):
        self.url, self.timeout = url, timeout
        self.headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if api_key:
            self.headers[auth_header] = f"{auth_prefix}{api_key}"
        self.session_id = None
        self._id = 0

    def _post(self, payload):
        headers = dict(self.headers)
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(self.url, json.dumps(payload).encode(), headers, method="POST")
        try:
            resp = urllib.request.urlopen(req, timeout=self.timeout)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:500]
            if e.code in (401, 403):
                raise MirraError(f"인증 실패({e.code}). config.json의 api_key를 확인하세요. {body}")
            raise MirraError(f"Mirra 서버 오류 {e.code}: {body}")
        except urllib.error.URLError as e:
            raise MirraError(f"Mirra에 연결할 수 없습니다: {e.reason}")
        with resp:
            self.session_id = resp.headers.get("Mcp-Session-Id") or self.session_id
            ctype = resp.headers.get("Content-Type", "")
            raw = resp.read().decode("utf-8", errors="replace")
        if "id" not in payload or not raw.strip():
            return None
        if "text/event-stream" in ctype:
            for msg in _sse_messages(raw):
                if msg.get("id") == payload["id"]:
                    return msg
            raise MirraError("Mirra 응답에서 결과를 찾지 못했습니다.")
        return json.loads(raw)

    def request(self, method, params=None):
        self._id += 1
        msg = self._post({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}})
        if "error" in msg:
            raise MirraError(f"{method} 실패: {msg['error'].get('message', msg['error'])}")
        return msg["result"]

    def connect(self):
        self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                    "clientInfo": {"name": "mirra-publisher", "version": "1.0"}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def list_tools(self):
        tools, cursor = [], None
        while True:
            res = self.request("tools/list", {"cursor": cursor} if cursor else {})
            tools += res.get("tools", [])
            cursor = res.get("nextCursor")
            if not cursor:
                return tools

    def call(self, name, args):
        res = self.request("tools/call", {"name": name, "arguments": args})
        data = res.get("structuredContent")
        if data is None:
            texts = [c.get("text", "") for c in res.get("content", []) if c.get("type") == "text"]
            text = "\n".join(texts)
            try:
                data = json.loads(text)
            except ValueError:
                data = text
        if res.get("isError"):
            raise MirraError(f"{name} 실패: {data}")
        return data


def _sse_messages(raw):
    for block in raw.replace("\r\n", "\n").split("\n\n"):
        data = "\n".join(line[5:].lstrip() for line in block.split("\n") if line.startswith("data:"))
        if data:
            try:
                yield json.loads(data)
            except ValueError:
                pass


# ------------------------------------------------------- tool/argument mapping
def pick_tool(tools, role, override=None):
    names = [t["name"] for t in tools]
    if override:
        if override not in names:
            raise MirraError(f"config.json에 지정한 도구 '{override}'가 Mirra에 없습니다.")
        return next(t for t in tools if t["name"] == override)
    for words in TOOL_KEYWORDS[role]:
        for t in tools:
            n = t["name"].lower()
            if all(w in n for w in words):
                return t
    return None


def props(tool):
    return (tool.get("inputSchema") or {}).get("properties", {})


def find_prop(tool, *keyword_sets):
    for words in keyword_sets:
        for p in props(tool):
            if all(w in p.lower() for w in words):
                return p
    return None


def find_list(data):
    """Return the first list of dicts found in a tool result."""
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data
    if isinstance(data, dict):
        for v in data.values():
            found = find_list(v)
            if found:
                return found
    return []


def first_value(d, *keys):
    if not isinstance(d, dict):
        return None
    for k in keys:
        if d.get(k) not in (None, ""):
            return d[k]
    for v in d.values():
        if isinstance(v, dict):
            found = first_value(v, *keys)
            if found:
                return found
    return None


# ------------------------------------------------------------ publish flow
class Publisher:
    def __init__(self, cfg):
        self.cfg = cfg
        key = os.environ.get("MIRRA_API_KEY") or cfg.get("mirra_api_key", "")
        if not key:
            raise MirraError("Mirra API 키가 없습니다. config.json의 mirra_api_key에 넣어 주세요.")
        self.client = MCPClient(cfg.get("mcp_url", DEFAULT_URL), key,
                                cfg.get("auth_header", "Authorization"), cfg.get("auth_prefix", "Bearer "))
        self.client.connect()
        self.tools = self.client.list_tools()
        names = cfg.get("tools", {})
        self.t = {role: pick_tool(self.tools, role, names.get(role)) for role in TOOL_KEYWORDS}
        for role in ("accounts", "publish"):
            if not self.t[role]:
                raise MirraError(f"'{role}' 도구를 찾지 못했습니다. `python mirra_app.py tools` 결과를 보고 "
                                 f"config.json \"tools\"에 이름을 지정하세요.")

    def accounts(self):
        items = find_list(self.client.call(self.t["accounts"]["name"], {}))
        out = []
        for a in items:
            aid = first_value(a, "id", "account_id", "accountId", "channel_id", "profile_id")
            name = first_value(a, "name", "username", "handle", "display_name", "displayName", "title")
            platform = first_value(a, "platform", "provider", "type", "network") or ""
            if aid:
                out.append({"id": aid, "name": str(name or aid), "platform": str(platform)})
        if not out:
            raise MirraError("연결된 SNS 계정을 불러오지 못했습니다.")
        return out

    def upload(self, path):
        tool = self.t["upload"]
        if not tool:
            return None  # publish 도구가 파일을 직접 받는 경우
        mime = mimetypes.guess_type(path)[0] or "video/mp4"
        args = {}
        name_p = find_prop(tool, ["file", "name"], ["filename"], ["name"])
        mime_p = find_prop(tool, ["mime"], ["content", "type"], ["type"])
        data_p = find_prop(tool, ["base64"], ["data"], ["content"], ["file"])
        if name_p:
            args[name_p] = os.path.basename(path)
        if mime_p and mime_p != name_p:
            args[mime_p] = mime
        if data_p and data_p not in (name_p, mime_p):
            with open(path, "rb") as f:
                args[data_p] = base64.b64encode(f.read()).decode()
        res = self.client.call(tool["name"], args)
        # 업로드용 주소(presigned URL)를 돌려주는 방식이면 파일을 그 주소로 PUT
        put_url = first_value(res, "upload_url", "uploadUrl", "presigned_url", "signedUrl")
        if put_url and not data_p:
            with open(path, "rb") as f:
                req = urllib.request.Request(put_url, f.read(), {"Content-Type": mime}, method="PUT")
            try:
                urllib.request.urlopen(req, timeout=600).close()
            except urllib.error.URLError as e:
                raise MirraError(f"영상 업로드 실패: {e}")
            confirm = self.cfg.get("tools", {}).get("upload_complete")
            if confirm:
                res = self.client.call(confirm, {"media_id": first_value(res, "media_id", "mediaId", "id")})
        media_id = first_value(res, "media_id", "mediaId", "asset_id", "assetId", "id")
        media_url = first_value(res, "url", "media_url", "mediaUrl", "file_url")
        if not (media_id or media_url):
            raise MirraError(f"업로드 결과에서 영상 ID를 찾지 못했습니다: {str(res)[:300]}")
        return {"id": media_id, "url": media_url}

    def publish_args(self, media, path, text, account_ids):
        tool = self.t["publish"]
        args = {}
        text_p = find_prop(tool, ["caption"], ["text"], ["content"], ["message"], ["body"])
        acc_p = find_prop(tool, ["account"], ["channel"], ["profile"], ["target"])
        if not (text_p and acc_p):
            raise MirraError("발행 도구의 캡션/계정 입력란을 찾지 못했습니다. tools.json을 확인해 주세요.")
        args[text_p] = text
        acc_schema = props(tool)[acc_p]
        args[acc_p] = account_ids if acc_schema.get("type") == "array" or len(account_ids) > 1 else account_ids[0]
        media_p = find_prop(tool, ["media", "id"], ["media"], ["video"], ["asset"], ["attachment"], ["file"])
        if media_p:
            m_schema = props(tool)[media_p]
            if media:
                val = media["id"] or media["url"]
                if "url" in media_p.lower() and media["url"]:
                    val = media["url"]
            else:
                with open(path, "rb") as f:
                    val = base64.b64encode(f.read()).decode()
            args[media_p] = [val] if m_schema.get("type") == "array" else val
        elif not media:
            raise MirraError("영상을 넣을 입력란을 찾지 못했습니다.")
        now_p = find_prop(tool, ["publish", "now"], ["now"], ["immediate"])
        if now_p:
            args[now_p] = True
        for p, s in props(tool).items():  # 발행 시점 선택형(enum)이면 "지금" 값 선택
            if p not in args and "now" in [str(e).lower() for e in s.get("enum", [])]:
                args[p] = next(e for e in s["enum"] if str(e).lower() == "now")
        return args

    def publish(self, args):
        res = self.client.call(self.t["publish"]["name"], args)
        post_id = first_value(res, "post_id", "postId", "content_id", "contentId", "id")
        return res, post_id

    def confirm_status(self, res, post_id):
        """실제 발행 성공 여부. True/False/None(확인 불가)."""
        def judge(r):
            s = str(first_value(r, "status", "state", "publish_status") or "").lower()
            if s in ("published", "success", "succeeded", "completed", "posted", "live", "done"):
                return True
            if s in ("failed", "error", "rejected"):
                return False
            return None
        verdict = judge(res)
        if verdict is None and self.t["status"] and post_id:
            id_p = find_prop(self.t["status"], ["post", "id"], ["content", "id"], ["id"]) or "id"
            import time
            for _ in range(12):  # 최대 약 1분 확인
                time.sleep(5)
                verdict = judge(self.client.call(self.t["status"]["name"], {id_p: post_id}))
                if verdict is not None:
                    break
        return verdict


# ------------------------------------------------------------------ helpers
def load_config():
    if not os.path.exists(CONFIG):
        raise MirraError("config.json이 없습니다. config.example.json을 복사해 config.json을 만들어 주세요.")
    with open(CONFIG, encoding="utf-8") as f:
        return json.load(f)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def already_published(name, digest):
    if not os.path.exists(LOG):
        return None
    with open(LOG, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r["status"] in ("success", "unknown") and (r["file"] == name or r["sha256"] == digest):
                return r
    return None


def write_log(**row):
    new = not os.path.exists(LOG)
    with open(LOG, "a", encoding="utf-8-sig" if new else "utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LOG_FIELDS)
        if new:
            w.writeheader()
        w.writerow({"published_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                    **{k: row.get(k, "") for k in LOG_FIELDS[1:]}})


def split_caption(text):
    tags = " ".join(w for w in text.split() if w.startswith("#"))
    return tags


# ---------------------------------------------------------------------- GUI
def run_gui():
    import threading
    import tkinter as tk
    from tkinter import filedialog, messagebox, scrolledtext, ttk

    root = tk.Tk()
    root.title("Mirra 영상 발행")
    root.geometry("560x680")
    state = {"pub": None, "path": None, "vars": {}}

    frm = ttk.Frame(root, padding=14)
    frm.pack(fill="both", expand=True)
    status = tk.StringVar(value="Mirra에 연결하는 중…")

    ttk.Label(frm, text="1. 영상 선택", font=("", 11, "bold")).pack(anchor="w")
    file_var = tk.StringVar(value="선택된 영상 없음")
    row = ttk.Frame(frm)
    row.pack(fill="x", pady=(4, 12))
    ttk.Label(row, textvariable=file_var, width=52).pack(side="left")

    def choose():
        p = filedialog.askopenfilename(title="발행할 영상", initialdir=os.path.expanduser(
            state["cfg"].get("video_dir", "~")) if state.get("cfg") else "~",
            filetypes=[("영상", "*.mp4 *.mov *.m4v *.avi *.webm"), ("모든 파일", "*.*")])
        if p:
            state["path"] = p
            file_var.set(f"{os.path.basename(p)}  ({os.path.getsize(p) / 1e6:.1f}MB)")
    ttk.Button(row, text="찾아보기", command=choose).pack(side="right")

    ttk.Label(frm, text="2. 캡션 + 해시태그", font=("", 11, "bold")).pack(anchor="w")
    text = scrolledtext.ScrolledText(frm, height=12, wrap="word")
    text.pack(fill="x", pady=(4, 12))

    ttk.Label(frm, text="3. 발행할 계정 선택", font=("", 11, "bold")).pack(anchor="w")
    acc_box = ttk.Frame(frm)
    acc_box.pack(fill="x", pady=(4, 12))

    btn = ttk.Button(frm, text="지금 발행", state="disabled")
    btn.pack(fill="x", pady=6, ipady=6)
    ttk.Label(frm, textvariable=status, foreground="#555", wraplength=520).pack(anchor="w")

    def ui(fn):
        root.after(0, fn)

    def connect():
        try:
            cfg = load_config()
            state["cfg"] = cfg
            pub = Publisher(cfg)
            accs = pub.accounts()
            state["pub"] = pub
        except Exception as e:  # noqa: BLE001
            ui(lambda e=e: status.set(f"연결 실패: {e}"))
            return

        def fill():
            preset = set(state["cfg"].get("accounts", []))
            for a in accs:
                v = tk.BooleanVar(value=a["name"] in preset or str(a["id"]) in preset)
                label = f"{a['name']}  [{a['platform']}]" if a["platform"] else a["name"]
                ttk.Checkbutton(acc_box, text=label, variable=v).pack(anchor="w")
                state["vars"][a["id"]] = (v, a)
            status.set("연결됨. 영상, 캡션, 계정을 확인한 뒤 '지금 발행'을 누르세요.")
            btn.config(state="normal")
        ui(fill)

    def do_publish():
        path, body = state["path"], text.get("1.0", "end").strip()
        chosen = [a for v, a in state["vars"].values() if v.get()]
        if not path:
            return messagebox.showwarning("확인", "영상을 선택해 주세요.")
        if not body:
            return messagebox.showwarning("확인", "캡션을 입력해 주세요.")
        if not chosen:
            return messagebox.showwarning("확인", "발행할 계정을 하나 이상 선택해 주세요.")
        digest = sha256(path)
        dup = already_published(os.path.basename(path), digest)
        if dup:
            return messagebox.showerror("중복", f"이미 발행(또는 확인 대기) 기록이 있는 영상입니다.\n"
                                              f"{dup['published_at']} / {dup['accounts']} / {dup['status']}")
        summary = (f"영상: {os.path.basename(path)}\n계정: {', '.join(a['name'] for a in chosen)}\n\n"
                   f"{body[:400]}{'…' if len(body) > 400 else ''}\n\n이대로 지금 발행할까요?")
        if not messagebox.askyesno("발행 전 최종 확인", summary):
            return
        btn.config(state="disabled")
        threading.Thread(target=worker, args=(path, digest, body, chosen), daemon=True).start()

    def worker(path, digest, body, chosen):
        pub = state["pub"]
        names = ";".join(a["name"] for a in chosen)
        log = dict(file=os.path.basename(path), sha256=digest, accounts=names, caption=body,
                   hashtags=split_caption(body))
        try:
            ui(lambda: status.set("영상 업로드 중… (용량에 따라 몇 분 걸릴 수 있습니다)"))
            media = pub.upload(path)
            ui(lambda: status.set("발행 요청 중…"))
            res, post_id = pub.publish(pub.publish_args(media, path, body, [a["id"] for a in chosen]))
            ui(lambda: status.set("발행 결과 확인 중…"))
            ok = pub.confirm_status(res, post_id)
            url = first_value(res, "post_url", "postUrl", "permalink", "url") or ""
        except Exception as e:  # noqa: BLE001
            write_log(**log, status="failed", error=str(e))
            ui(lambda e=e: (status.set(f"실패: {e}"), messagebox.showerror("발행 실패", str(e)),
                            btn.config(state="normal")))
            return
        if ok is True:
            write_log(**log, status="success", post_url=url)
            ui(lambda: (status.set("발행 완료! publish-log.csv에 기록했습니다."),
                        messagebox.showinfo("완료", f"발행이 완료되었습니다.\n{url}")))
        elif ok is False:
            write_log(**log, status="failed", error=str(res)[:300])
            ui(lambda: (status.set("Mirra가 발행 실패로 응답했습니다."), messagebox.showerror("실패", str(res)[:500]),
                        btn.config(state="normal")))
        else:
            write_log(**log, status="unknown", post_url=url, error="발행 성공 여부 확인 불가")
            ui(lambda: (status.set("요청은 보냈지만 게시 완료를 확인하지 못했습니다. Mirra 콘텐츠 관리에서 확인하세요."),
                        messagebox.showwarning("확인 필요", "Mirra 콘텐츠 관리에서 게시 상태를 직접 확인해 주세요.\n"
                                                         "중복 방지를 위해 다시 발행하지 마세요.")))

    btn.config(command=do_publish)
    threading.Thread(target=connect, daemon=True).start()
    root.mainloop()


def dump_tools():
    cfg = load_config()
    key = os.environ.get("MIRRA_API_KEY") or cfg.get("mirra_api_key", "")
    c = MCPClient(cfg.get("mcp_url", DEFAULT_URL), key, cfg.get("auth_header", "Authorization"),
                  cfg.get("auth_prefix", "Bearer "))
    c.connect()
    tools = c.list_tools()
    out = os.path.join(HERE, "tools.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(tools, f, ensure_ascii=False, indent=2)
    for t in tools:
        print(f"- {t['name']}: {(t.get('description') or '').splitlines()[0][:80] if t.get('description') else ''}")
    for role in TOOL_KEYWORDS:
        hit = pick_tool(tools, role, cfg.get("tools", {}).get(role))
        print(f"[{role}] → {hit['name'] if hit else '못 찾음'}")
    print(f"\n전체 목록 저장: {out}")


if __name__ == "__main__":
    try:
        dump_tools() if sys.argv[1:] == ["tools"] else run_gui()
    except MirraError as e:
        sys.exit(f"오류: {e}")

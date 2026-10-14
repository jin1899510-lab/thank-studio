#!/usr/bin/env python3
"""Meta 광고 일일 점검: 이번 달 캠페인별 지출이 한도 이상이면 캠페인을 일시정지한다.

인증은 환경의 네트워크 시크릿(graph.facebook.com 에 Authorization: Bearer 헤더 자동 주입)을 사용한다.

사용법:
  python3 scripts/meta_ads_check.py            # 점검만 (변경 없음)
  python3 scripts/meta_ads_check.py --apply    # 한도 이상 캠페인 OFF
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request

GRAPH = "https://graph.facebook.com/v21.0"
AD_ACCOUNT = "act_989273679132128"
MONTHLY_CAP_KRW = 100_000


def call(path, params=None, method="GET"):
    url = f"{GRAPH}/{path}"
    data = None
    if method == "GET" and params:
        url += "?" + urllib.parse.urlencode(params)
    elif params:
        data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Graph API 오류 {e.code} ({path}): {e.read().decode()[:500]}")


def fetch_all(path, params):
    rows, out = [], call(path, params)
    while True:
        rows += out.get("data", [])
        nxt = out.get("paging", {}).get("next")
        if not nxt:
            return rows
        with urllib.request.urlopen(nxt, timeout=30) as resp:
            out = json.load(resp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="한도 이상 캠페인을 실제로 일시정지")
    ap.add_argument("--cap", type=int, default=MONTHLY_CAP_KRW)
    args = ap.parse_args()

    campaigns = {
        c["id"]: c
        for c in fetch_all(f"{AD_ACCOUNT}/campaigns",
                           {"fields": "name,status,effective_status,stop_time", "limit": 100})
    }
    spend = {
        r["campaign_id"]: float(r["spend"])
        for r in fetch_all(f"{AD_ACCOUNT}/insights",
                           {"level": "campaign", "fields": "campaign_id,campaign_name,spend",
                            "date_preset": "this_month", "limit": 200})
    }

    print(f"이번 달 캠페인별 지출 (한도 {args.cap:,}원)")
    to_pause = []
    for cid, c in sorted(campaigns.items(), key=lambda kv: -spend.get(kv[0], 0)):
        s = spend.get(cid, 0)
        over = s >= args.cap
        mark = "한도 도달" if over else f"{s / args.cap:.0%}"
        print(f"- {c['name']} [{c['effective_status']}] {s:,.0f}원 ({mark})")
        if over and c["status"] == "ACTIVE":
            to_pause.append(c)

    if not to_pause:
        print("\nOFF 대상 없음")
        return
    print("\nOFF 대상: " + ", ".join(c["name"] for c in to_pause))
    if not args.apply:
        print("(--apply 없이 실행: 변경하지 않음)")
        return
    for c in to_pause:
        res = call(c["id"], {"status": "PAUSED"}, method="POST")
        ok = res.get("success")
        print(f"- {c['name']}: {'일시정지 완료' if ok else '실패 ' + json.dumps(res, ensure_ascii=False)}")
        if not ok:
            sys.exit(1)


if __name__ == "__main__":
    main()

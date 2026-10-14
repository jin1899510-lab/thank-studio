#!/usr/bin/env python3
"""카카오톡 '나에게 보내기'로 메시지를 보낸다.

필요한 환경 변수:
  KAKAO_CLIENT_SECRET   카카오 로그인 클라이언트 시크릿
  KAKAO_REFRESH_TOKEN   최초 인증(exchange)으로 받은 리프레시 토큰 (send 에 필요)

사용법:
  python3 scripts/kakao_notify.py auth-url                  # 로그인 동의 링크 출력
  python3 scripts/kakao_notify.py exchange CODE --out FILE  # 인가 코드 -> 리프레시 토큰을 FILE 에 저장
  echo "본문" | python3 scripts/kakao_notify.py send         # 메시지 전송 (200자 단위로 나눠 보냄)
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

REST_API_KEY = "ed37fe8c0af072ac064f029e14560e93"
REDIRECT_URI = "https://localhost:3000/oauth"
ADS_MANAGER_URL = "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=989273679132128"
TEXT_LIMIT = 200  # 카카오 텍스트 템플릿 본문 최대 길이


def post(url, params, token=None):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(params).encode(), method="POST")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"카카오 API 오류 {e.code} ({url}): {e.read().decode()[:500]}")


def env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"환경 변수 {name} 이(가) 설정되지 않았습니다")
    return value


def token_request(params):
    return post("https://kauth.kakao.com/oauth/token",
                {"client_id": REST_API_KEY, "client_secret": env("KAKAO_CLIENT_SECRET"), **params})


def chunks(text):
    """줄 단위로 묶어 TEXT_LIMIT 이하 조각으로 나눈다."""
    out, cur = [], ""
    for line in text.strip().splitlines():
        while len(line) > TEXT_LIMIT:
            if cur:
                out.append(cur)
                cur = ""
            out.append(line[:TEXT_LIMIT])
            line = line[TEXT_LIMIT:]
        if cur and len(cur) + 1 + len(line) > TEXT_LIMIT:
            out.append(cur)
            cur = line
        else:
            cur = f"{cur}\n{line}" if cur else line
    if cur:
        out.append(cur)
    return out


def cmd_auth_url(_):
    print("https://kauth.kakao.com/oauth/authorize?" + urllib.parse.urlencode({
        "client_id": REST_API_KEY, "redirect_uri": REDIRECT_URI,
        "response_type": "code", "scope": "talk_message"}))


def cmd_exchange(args):
    res = token_request({"grant_type": "authorization_code", "redirect_uri": REDIRECT_URI, "code": args.code})
    with open(args.out, "w") as f:
        f.write(res["refresh_token"])
    os.chmod(args.out, 0o600)
    days = res.get("refresh_token_expires_in", 0) // 86400
    print(f"리프레시 토큰을 {args.out} 에 저장했습니다 (유효 약 {days}일, scope: {res.get('scope')})")


def cmd_send(args):
    text = args.text or sys.stdin.read()
    res = token_request({"grant_type": "refresh_token", "refresh_token": env("KAKAO_REFRESH_TOKEN")})
    if "refresh_token" in res:
        # 만료 1개월 전부터 카카오가 새 리프레시 토큰을 준다. 환경 변수는 여기서 갱신할 수 없으니 알린다.
        print("주의: 카카오 리프레시 토큰이 곧 만료됩니다. 카카오 재인증이 필요합니다.", file=sys.stderr)
    parts = chunks(text)
    for i, part in enumerate(parts, 1):
        template = {"object_type": "text", "text": part, "button_title": "광고관리자 열기",
                    "link": {"web_url": ADS_MANAGER_URL, "mobile_web_url": ADS_MANAGER_URL}}
        out = post("https://kapi.kakao.com/v2/api/talk/memo/default/send",
                   {"template_object": json.dumps(template, ensure_ascii=False)}, token=res["access_token"])
        if out.get("result_code") != 0:
            raise SystemExit(f"전송 실패 ({i}/{len(parts)}): {out}")
    print(f"카카오톡 전송 완료 ({len(parts)}개 메시지)")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("auth-url").set_defaults(fn=cmd_auth_url)
    ex = sub.add_parser("exchange")
    ex.add_argument("code")
    ex.add_argument("--out", required=True)
    ex.set_defaults(fn=cmd_exchange)
    se = sub.add_parser("send")
    se.add_argument("text", nargs="?")
    se.set_defaults(fn=cmd_send)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

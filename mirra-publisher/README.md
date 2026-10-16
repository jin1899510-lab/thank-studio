# Mirra 영상 자동 발행 키트

PC 영상 → 분석 → 캡션/해시태그 → Mirra "지금 발행" → 발행 기록을 Claude Code 스킬 하나로 수행합니다.
동작 규칙은 `.claude/skills/mirra-publish/SKILL.md`에 있습니다.

## 설치 (PC에서 1회)

1. 이 저장소를 PC에 clone하고 그 폴더에서 Claude Code를 실행합니다.
2. ffmpeg 설치 (`winget install ffmpeg` / `brew install ffmpeg`). 음성 인식이 필요하면 `pip install openai-whisper`.
3. `config.example.json`을 `config.json`으로 복사하고 영상 폴더, **발행 계정**, 브랜드·매장·지역을 입력합니다.
4. Mirra 연결 (둘 중 하나):
   - **원격 MCP(권장)**: 저장소 루트의 `.mcp.json`에 `https://www.mirra.my/api/mcp`가 등록돼 있습니다.
     이 폴더에서 Claude Code를 열면 프로젝트 MCP 사용 여부를 묻는데, 승인한 뒤 `/mcp` → `mirra` → 인증으로 OAuth 로그인을 1회 진행합니다.
   - **브라우저**: Claude in Chrome 확장 또는 Playwright MCP를 연결하고 Mirra에 미리 로그인해 둡니다.

## 발행 프로그램 (클릭만으로 발행)

`mirra_app.py`는 Mirra MCP에 API 키로 접속해 **영상 선택 → 캡션 입력 → 계정 체크 → 지금 발행**을 하는 창 프로그램입니다. 설치할 패키지는 없고 파이썬만 있으면 됩니다.

1. [python.org](https://www.python.org/downloads/)에서 파이썬을 설치합니다. 설치 화면에서 "Add python.exe to PATH"를 체크하세요.
2. Mirra → 설정 → API와 MCP → **API** 탭에서 키를 발급하고 `config.json`의 `mirra_api_key`에 넣습니다.
3. `mirra-publisher` 폴더에서 `python mirra_app.py`를 실행합니다(명령 프롬프트). 창이 뜨면:
   - **찾아보기**로 영상 선택 → 캡션과 해시태그를 붙여넣기 → 발행할 계정 체크 → **지금 발행**
   - 발행 직전에 확인창이 뜨고, 같은 영상의 발행 기록이 있으면 발행을 막습니다.
   - Mirra에서 게시 완료가 확인돼야 '완료'로 표시하고, 결과는 `publish-log.csv`에 남습니다.

처음 연결이 안 되거나 "도구를 찾지 못했습니다"가 나오면 `python mirra_app.py tools`를 실행해 나온 목록(`tools.json`)을 Claude에게 보내 주세요. `config.json`의 `"tools"`에 정확한 이름을 지정해 드립니다.

## Claude Code로 실행

Claude Code에서 `/mirra-publish` 또는 "대기 중인 영상 Mirra로 발행해줘".
기본값(`confirm_before_publish: true`)에서는 발행 직전 검수표를 보여주고 승인을 받습니다.

`config.json`, `work/`, `publish-log.csv`는 로컬 전용이라 git에 올라가지 않습니다.

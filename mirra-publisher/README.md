# Mirra 영상 자동 발행 키트

PC 영상 → 분석 → 캡션/해시태그 → Mirra "지금 발행" → 발행 기록을 Claude Code 스킬 하나로 수행합니다.
동작 규칙은 `.claude/skills/mirra-publish/SKILL.md`에 있습니다.

## 설치 (PC에서 1회)

1. 이 저장소를 PC에 clone하고 그 폴더에서 Claude Code를 실행합니다.
2. ffmpeg 설치 (`winget install ffmpeg` / `brew install ffmpeg`). 음성 인식이 필요하면 `pip install openai-whisper`.
3. `config.example.json`을 `config.json`으로 복사하고 영상 폴더, **발행 계정**, 브랜드·매장·지역을 입력합니다.
4. Mirra 연결 (둘 중 하나):
   - **원격 MCP(권장)**: Mirra → 설정 → API와 MCP → MCP 연동 → 원격 MCP 탭의 URL을 복사해
     `claude mcp add --transport http mirra <URL>` 실행 후 `/mcp`에서 OAuth 로그인.
     (또는 `.mcp.example.json`을 저장소 루트의 `.mcp.json`으로 복사해 URL 입력)
   - **브라우저**: Claude in Chrome 확장 또는 Playwright MCP를 연결하고 Mirra에 미리 로그인해 둡니다.

## 실행

Claude Code에서 `/mirra-publish` 또는 "대기 중인 영상 Mirra로 발행해줘".
기본값(`confirm_before_publish: true`)에서는 발행 직전 검수표를 보여주고 승인을 받습니다.

`config.json`, `work/`, `publish-log.csv`는 로컬 전용이라 git에 올라가지 않습니다.

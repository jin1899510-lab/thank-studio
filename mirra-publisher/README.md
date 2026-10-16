# Mirra 자동 발행 (mirra-publisher)

PC 에 저장된 영상을 고르면 **AI 가 영상을 분석해 캡션·해시태그를 작성**하고,
**Mirra 를 통해 지정된 SNS 계정에 실제로 발행**하는 프로그램입니다.

## 처리 순서 (10단계)

| # | 단계 | 실제 동작 |
|---|------|-----------|
| 1 | 영상 업로드 | PC 의 영상 선택 → Gemini 에 분석용으로 업로드 |
| 2 | 캡션 작성 | Gemini 가 영상(화면·음성·자막)을 보고 요약 + 캡션 + YouTube 제목 작성 |
| 3 | 해시태그 작성 | 영상과 캡션에 맞는 해시태그 작성 (대형/중형/니치 혼합, 중복 제거) |
| 4 | Mirra 접속 | API 키로 Mirra 인증, 연결된 SNS 계정 조회 |
| 5 | 콘텐츠 관리 메뉴 접속 | Mirra 콘텐츠 관리(게시물) API 접근 확인 |
| 6 | 영상 업로드 | Mirra 스토리지에 영상 업로드 (업로드 URL 발급 → 업로드 → 확정) |
| 7 | 캡션 및 해시태그 입력 | 게시물 본문 = 캡션 + 해시태그 (수정 가능, 플랫폼별 글자 수 경고) |
| 8 | 발행할 계정 선택 | `MIRRA_DEFAULT_ACCOUNTS` 의 지정 계정이 자동 선택됨 → 계정별 게시물 초안 생성 |
| 9 | 최종 내용 확인 | Mirra 에 저장된 초안을 다시 불러와 영상·본문·계정 확인 (체크해야 발행 가능) |
| 10 | 지금 발행 | Mirra "지금 발행" 요청 → 발행 완료/실패 상태까지 확인 |

Mirra 연동은 Mirra 공식 MCP 서버(`@mirrai/mcp-server`)와 같은 Mirra REST API(`/api/v1`)를 사용합니다.
그래서 브라우저로 Mirra 사이트를 클릭하는 방식보다 안정적이고, 화면 구성이 바뀌어도 동작합니다.

## 설치

Node.js 18.17 이상이 필요합니다.

```bash
cd mirra-publisher
npm install
cp .env.example .env     # Windows: copy .env.example .env
```

`.env` 를 열어 키를 입력합니다.

- `GEMINI_API_KEY`: https://aistudio.google.com/apikey (상위 폴더의 `.env.local` 에 있으면 그 값을 함께 사용)
- `MIRRA_API_KEY`: Mirra 워크스페이스 설정 → API 키
- `MIRRA_DEFAULT_ACCOUNTS` (선택): 항상 발행할 계정. 예) `instagram:thank_cafe,youtube:thankstudio`

## 사용법 ① 웹 화면 (권장)

```bash
npm start
```

브라우저에서 http://localhost:5180 을 엽니다. 영상을 끌어다 놓고 버튼을 순서대로 누르면 됩니다.
왼쪽 진행 표시에 10단계 상태가 실시간으로 표시됩니다.

- 캡션·해시태그·YouTube 제목은 Mirra 로 넘기기 전에 직접 고칠 수 있습니다.
- "지금 발행"은 최종 확인 체크와 확인 창을 모두 거쳐야 실행됩니다.
- 서버는 이 PC(127.0.0.1)에서만 접속되며, API 키는 브라우저로 전달되지 않습니다.

## 사용법 ② 터미널 (자동화용)

```bash
# 단계마다 확인하며 진행
npm run publish-video -- "C:\영상\latte.mp4"

# 계정·톤 지정
npm run publish-video -- ./latte.mp4 --accounts instagram:thank_cafe --tone "감성적인" --notes "성수동 카페 땡큐 신메뉴"

# 확인 단계(9단계)까지만 진행하고 발행하지 않음 → Mirra 콘텐츠 관리에 초안으로 남음
npm run publish-video -- ./latte.mp4 --dry-run

# 확인 질문 없이 바로 발행 (작업 스케줄러 등) — 발행 계정을 반드시 지정해야 함
npm run publish-video -- ./latte.mp4 --accounts thank_cafe --yes
```

## 플랫폼별 처리

| 플랫폼 | 처리 |
|--------|------|
| Instagram | 단일 영상 → 릴스, 피드에도 노출(`shareToFeed`) |
| YouTube | AI 가 만든 제목 + 본문을 설명으로, 공개 범위 `MIRRA_YOUTUBE_PRIVACY` |
| TikTok | 바로 게시(`DIRECT_POST`), 공개 범위 `MIRRA_TIKTOK_PRIVACY` |
| X · Threads · LinkedIn · Facebook | 본문 + 영상 (X 280자, Threads 500자 초과 시 경고) |

## Mirra MCP 로 쓰기 (선택)

Claude Desktop / Claude Code 에서 대화로 발행하고 싶다면 `mcp.example.json` 의 내용을
Claude 설정의 `mcpServers` 에 추가하세요. `media_upload` → `post_create` → `post_publish_now`
도구가 이 프로그램과 같은 순서로 동작합니다.

## 테스트

```bash
npm test
```

Mirra API 를 흉내 내는 모의 서버(`test/mock-mirra.js`)로 4~10단계 순서, 영상 업로드, 초안 생성,
확인 없는 발행 거부, 중복 발행 방지를 검증합니다. 실제 키나 네트워크 없이도 실행됩니다.

## 문제 해결

- **401/403**: `MIRRA_API_KEY` 를 확인하세요.
- **402**: Mirra 크레딧/요금제 한도를 확인하세요.
- **계정이 안 보임**: Mirra 에서 SNS 계정을 먼저 연결하세요.
- **"처리 중"으로 끝남**: 플랫폼 처리가 오래 걸리는 경우입니다. 결과의 "Mirra 에서 보기" 링크로 상태를 확인하세요.
- **발행 실패**: 결과에 표시된 오류(예: 영상 길이·비율 제한)를 확인한 뒤 Mirra 콘텐츠 관리에서 수정 후 다시 발행할 수 있습니다.

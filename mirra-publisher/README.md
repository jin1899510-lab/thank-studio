# Mirra 자동 발행 (mirra-publisher)

PC 에 저장된 영상을 고르면 **AI 가 영상을 분석해 캡션·해시태그를 작성**하고,
**Mirra 를 통해 지정된 SNS 계정에 실제로 발행**하는 프로그램입니다.

## 처리 순서 (10단계)

| # | 단계 | 실제 동작 |
|---|------|-----------|
| 1 | 영상 업로드 | PC 의 영상 선택 → Gemini 에 분석용으로 업로드 |
| 2 | 캡션 작성 | Gemini 가 영상(화면·음성·자막)을 보고 요약 + 캡션 + YouTube 제목 작성 |
| 3 | 해시태그 작성 | 영상과 캡션에 맞는 해시태그 작성 (대형/중형/니치 혼합, 중복 제거) + **썸네일 장면 3곳 추천** |
| 4 | Mirra 접속 | API 키로 Mirra 인증, 연결된 SNS 계정 조회 |
| 5 | 콘텐츠 관리 메뉴 접속 | Mirra 콘텐츠 관리(게시물) API 접근 확인 |
| 6 | 영상 업로드 | Mirra 스토리지에 영상(+ 선택한 썸네일) 업로드 (업로드 URL 발급 → 업로드 → 확정) |
| 7 | 캡션 및 해시태그 입력 | 게시물 본문 = 캡션 + 해시태그 (수정 가능, 플랫폼별 글자 수 경고) |
| 8 | 발행할 계정 선택 | `MIRRA_DEFAULT_ACCOUNTS` 의 지정 계정이 자동 선택됨 → 계정별 게시물 초안 생성 |
| 9 | 최종 내용 확인 | Mirra 에 저장된 초안을 다시 불러와 영상·본문·계정 확인 (체크해야 발행 가능) |
| 10 | 지금 발행 | Mirra "지금 발행" 요청 → 발행 완료/실패 상태까지 확인 |

Mirra 연동은 Mirra 공식 MCP 서버(`@mirrai/mcp-server`)와 같은 Mirra REST API(`/api/v1`)를 사용합니다.
그래서 브라우저로 Mirra 사이트를 클릭하는 방식보다 안정적이고, 화면 구성이 바뀌어도 동작합니다.

## 가장 쉬운 방법: 웹 앱으로 올리기 (PC 설치 없음)

인터넷 서비스 Render 에 올려 두면 **웹 주소 하나로 PC·휴대폰 어디서나** 쓸 수 있습니다.

1. https://render.com 에 GitHub 계정으로 가입합니다. (무료)
2. 아래 링크를 엽니다.
   https://render.com/deploy?repo=https://github.com/jin1899510-lab/thank-studio/tree/claude/quirky-fermat-jk05oj
3. 입력칸 4개를 채우고 **Deploy Blueprint** 를 누릅니다.
   - `APP_PASSWORD`: 이 앱에 들어갈 때 쓸 비밀번호 (직접 정함)
   - `GEMINI_API_KEY`: Gemini 키
   - `MIRRA_API_KEY`: Mirra 키
   - `MIRRA_DEFAULT_ACCOUNTS`: 항상 발행할 계정 (예: `instagram:thank_cafe`, 없으면 비워도 됨)
4. 몇 분 뒤 `https://mirra-publisher-xxxx.onrender.com` 같은 주소가 생깁니다. 이 주소를 열고,
   아이디는 아무거나, 비밀번호는 `APP_PASSWORD` 로 로그인하면 바로 사용할 수 있습니다.

참고: 무료 요금제는 15분 동안 안 쓰면 잠들어서, 다음 접속 때 첫 화면이 뜨기까지 1분 정도 걸립니다.
키나 계정을 바꾸려면 Render 대시보드 → mirra-publisher → **Environment** 에서 수정합니다.

## PC 에서 직접 실행하기

### 설치

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

### 웹 화면

```bash
npm start
```

브라우저에서 http://localhost:5180 을 엽니다. 영상을 끌어다 놓고 버튼을 순서대로 누르면 됩니다.
왼쪽 진행 표시에 10단계 상태가 실시간으로 표시됩니다.

- 캡션·해시태그·YouTube 제목은 Mirra 로 넘기기 전에 직접 고칠 수 있습니다.
- "지금 발행"은 최종 확인 체크와 확인 창을 모두 거쳐야 실행됩니다.
- 서버는 이 PC(127.0.0.1)에서만 접속되며, API 키는 브라우저로 전달되지 않습니다.

### 여러 개 한번에

화면 위쪽 **여러 개 한번에** 탭에서 영상을 최대 20개까지 한꺼번에 올릴 수 있습니다.

1. 영상들을 끌어다 놓고 **모두 분석 시작** → 영상마다 캡션·해시태그·썸네일 추천 (2개씩 동시에 분석)
2. 영상별로 내용을 확인·수정하고 썸네일 선택 → **모두 Mirra 접속 및 업로드**
3. 발행 계정 선택 (모든 영상 공통) → **최종 내용 확인으로**
4. 영상별 초안을 확인하고 체크 → **모두 지금 발행**

- 영상마다 10단계 진행 막대가 표시되며, 실패한 영상은 건너뛰고 나머지는 계속 진행합니다.
- 업로드 전까지는 ✕ 버튼으로 목록에서 뺄 수 있습니다.

### 썸네일 추천

AI 가 썸네일로 쓰기 좋은 장면 3곳을 이유와 함께 추천하고, 화면에서 그 장면을 이미지로 보여줍니다.
하나를 눌러 고르면 Instagram 릴스 커버 / YouTube 썸네일로 함께 올라갑니다.

- 미리보기 영상을 원하는 곳에 멈추고 **＋ 미리보기의 현재 장면 추가** 로 직접 고를 수도 있습니다.
- **썸네일에 문구 넣기** 를 켜면 AI 가 제안한 짧은 문구(수정 가능)를 장면 아래쪽에 얹습니다.
- 장면 추출은 브라우저에서 하므로 서버에 별도 프로그램이 필요 없습니다. (Chrome 권장, 일부 .mov 는 브라우저가 못 읽을 수 있음)
- TikTok 등 커버 지정을 지원하지 않는 플랫폼은 플랫폼이 자동으로 정합니다.

### 터미널 (자동화용)

```bash
# 단계마다 확인하며 진행
npm run publish-video -- "C:\영상\latte.mp4"

# 계정·톤 지정
npm run publish-video -- ./latte.mp4 --accounts instagram:thank_cafe --tone "감성적인" --notes "성수동 카페 땡큐 신메뉴"

# 확인 단계(9단계)까지만 진행하고 발행하지 않음 → Mirra 콘텐츠 관리에 초안으로 남음
npm run publish-video -- ./latte.mp4 --dry-run

# AI 추천 1순위 장면을 썸네일로 사용 (PC 에 ffmpeg 필요)
npm run publish-video -- ./latte.mp4 --thumbnail

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

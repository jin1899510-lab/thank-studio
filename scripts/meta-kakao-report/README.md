# 메타 광고 성과 → 카카오톡 리포트

매일 오전 9시(KST)에 전날 메타 광고 성과(지출, 노출, 클릭, CTR, CPC, 구매, 매출, ROAS, 지출 상위 캠페인 3개)를
카카오톡 **나에게 보내기**로 받습니다. GitHub Actions(`.github/workflows/meta-kakao-report.yml`)로 실행됩니다.

## 1. 메타 토큰 준비
1. [Meta for Developers](https://developers.facebook.com)에서 앱을 만들고 Marketing API를 추가합니다.
2. 비즈니스 설정 → 시스템 사용자 → 토큰 생성(`ads_read` 권한). 만료되지 않는 시스템 사용자 토큰을 권장합니다.
3. 광고 관리자 주소의 `act=` 뒤 숫자가 광고 계정 ID입니다.

## 2. 카카오 토큰 준비
1. [Kakao Developers](https://developers.kakao.com)에서 앱 생성 → **REST API 키** 복사.
2. 카카오 로그인 활성화, Redirect URI 등록(예: `https://localhost`).
3. 동의항목에서 **카카오톡 메시지 전송(talk_message)** 을 켭니다.
4. 리프레시 토큰 발급:
   ```bash
   KAKAO_REST_API_KEY=키 KAKAO_REDIRECT_URI=https://localhost node scripts/meta-kakao-report/get-kakao-token.mjs
   # 출력된 URL을 열고 동의 → 이동한 주소의 code= 값을 복사
   KAKAO_REST_API_KEY=키 KAKAO_REDIRECT_URI=https://localhost node scripts/meta-kakao-report/get-kakao-token.mjs 복사한코드
   ```

## 3. GitHub Secrets 등록
저장소 Settings → Secrets and variables → Actions 에 추가:

| 이름 | 값 |
| --- | --- |
| `META_ACCESS_TOKEN` | 메타 토큰 |
| `META_AD_ACCOUNT_ID` | 광고 계정 ID |
| `KAKAO_REST_API_KEY` | 카카오 REST API 키 |
| `KAKAO_REFRESH_TOKEN` | 위에서 발급한 리프레시 토큰 |
| `KAKAO_CLIENT_SECRET` | (Client Secret을 켠 경우만) |

Actions 탭 → "Meta 광고 성과 카카오톡 리포트" → **Run workflow** 로 바로 테스트할 수 있습니다.

## 참고
- 카카오 리프레시 토큰은 약 2개월간 유효합니다. 만료가 가까워지면 실행 로그에 경고가 뜨니,
  그때 2-4단계로 새로 발급해 Secret을 바꿔주세요.
- 로컬 확인: `DRY_RUN=1` 을 붙이면 카카오로 보내지 않고 메시지만 출력합니다.

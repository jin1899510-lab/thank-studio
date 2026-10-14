// 카카오 리프레시 토큰을 처음 한 번 발급받는 도우미입니다.
//
// 1) 아래 명령으로 로그인 URL을 출력합니다.
//    KAKAO_REST_API_KEY=... KAKAO_REDIRECT_URI=... node get-kakao-token.mjs
// 2) URL을 브라우저에서 열고 동의하면 redirect URI로 이동합니다. 주소창의 code= 값을 복사합니다.
// 3) 같은 명령 뒤에 code를 붙여 실행하면 refresh_token이 출력됩니다.
//    KAKAO_REST_API_KEY=... KAKAO_REDIRECT_URI=... node get-kakao-token.mjs <code>

const clientId = process.env.KAKAO_REST_API_KEY;
const redirectUri = process.env.KAKAO_REDIRECT_URI;
if (!clientId || !redirectUri) {
  console.error('KAKAO_REST_API_KEY와 KAKAO_REDIRECT_URI를 설정해 주세요.');
  process.exit(1);
}

const code = process.argv[2];
if (!code) {
  const url = new URL('https://kauth.kakao.com/oauth/authorize');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'talk_message' });
  console.log(`브라우저에서 열어주세요:\n${url}`);
  process.exit(0);
}

const params = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code });
if (process.env.KAKAO_CLIENT_SECRET) params.set('client_secret', process.env.KAKAO_CLIENT_SECRET);

const res = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', body: params });
const body = await res.json();
if (!res.ok) {
  console.error(`발급 실패: ${body.error_description ?? res.status}`);
  process.exit(1);
}
console.log(`KAKAO_REFRESH_TOKEN=${body.refresh_token}`);
console.log(`(만료까지 약 ${Math.round(body.refresh_token_expires_in / 86400)}일)`);

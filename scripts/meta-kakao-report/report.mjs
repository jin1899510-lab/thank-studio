// 메타 광고 성과를 조회해서 카카오톡 "나에게 보내기"로 전송합니다.
// Node 18+ 내장 fetch만 사용하므로 별도 설치가 필요 없습니다.
//
// 필요한 환경 변수
//   META_ACCESS_TOKEN    메타 마케팅 API 토큰 (ads_read 권한, 시스템 사용자 토큰 권장)
//   META_AD_ACCOUNT_ID   광고 계정 ID (예: act_1234567890 또는 1234567890)
//   KAKAO_REST_API_KEY   카카오 앱의 REST API 키
//   KAKAO_REFRESH_TOKEN  카카오 리프레시 토큰 (get-kakao-token.mjs로 발급)
// 선택
//   KAKAO_CLIENT_SECRET  카카오 앱에서 Client Secret을 켠 경우
//   DATE_PRESET          조회 기간 (기본 yesterday, 예: today, last_7d)
//   DRY_RUN=1            카카오로 보내지 않고 메시지만 출력

const GRAPH = 'https://graph.facebook.com/v21.0';
const PURCHASE_TYPES = ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'];
const KAKAO_TEXT_LIMIT = 200;

const env = (name, required = true) => {
  const value = process.env[name];
  if (required && !value) throw new Error(`환경 변수 ${name}가 설정되지 않았습니다.`);
  return value;
};

const accountId = () => {
  const id = env('META_AD_ACCOUNT_ID').trim();
  return id.startsWith('act_') ? id : `act_${id}`;
};

async function graph(path, params) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries({ ...params, access_token: env('META_ACCESS_TOKEN') })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(`메타 API 오류: ${body.error?.message ?? res.status}`);
  }
  return body;
}

const sumActions = (list = []) =>
  list
    .filter((a) => PURCHASE_TYPES.includes(a.action_type))
    // 같은 구매가 여러 action_type으로 중복 집계되므로 가장 큰 값 하나만 사용
    .reduce((max, a) => Math.max(max, Number(a.value)), 0);

function summarize(row = {}) {
  const spend = Number(row.spend ?? 0);
  const purchases = sumActions(row.actions);
  const revenue = sumActions(row.action_values);
  return {
    spend,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(row.ctr ?? 0),
    cpc: Number(row.cpc ?? 0),
    purchases,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
  };
}

async function fetchReport() {
  const datePreset = env('DATE_PRESET', false) || 'yesterday';
  const fields = 'spend,impressions,clicks,ctr,cpc,actions,action_values';
  const [account, total, campaigns] = await Promise.all([
    graph(accountId(), { fields: 'name,currency' }),
    graph(`${accountId()}/insights`, { fields, date_preset: datePreset, level: 'account' }),
    graph(`${accountId()}/insights`, {
      fields: `campaign_name,${fields}`,
      date_preset: datePreset,
      level: 'campaign',
      sort: 'spend_descending',
      limit: '3',
    }),
  ]);
  const row = total.data?.[0];
  return {
    account,
    datePreset,
    range: row ? `${row.date_start}~${row.date_stop}` : datePreset,
    total: summarize(row),
    campaigns: (campaigns.data ?? []).map((c) => ({ name: c.campaign_name, ...summarize(c) })),
  };
}

function formatMessages({ account, range, total, campaigns }) {
  const money = (n) =>
    new Intl.NumberFormat('ko-KR', { style: 'currency', currency: account.currency || 'KRW', maximumFractionDigits: 0 }).format(n);
  const num = (n) => Math.round(n).toLocaleString('ko-KR');

  const summary = [
    `📊 메타 광고 성과 (${range})`,
    `${account.name}`,
    `지출 ${money(total.spend)}`,
    `노출 ${num(total.impressions)} · 클릭 ${num(total.clicks)}`,
    `CTR ${total.ctr.toFixed(2)}% · CPC ${money(total.cpc)}`,
    `구매 ${num(total.purchases)}건 · 매출 ${money(total.revenue)}`,
    `ROAS ${(total.roas * 100).toFixed(0)}%`,
  ].join('\n');

  const messages = [summary];
  if (campaigns.length) {
    messages.push(
      [
        '🏆 지출 상위 캠페인',
        ...campaigns.map(
          (c, i) => `${i + 1}. ${c.name.slice(0, 20)}\n 지출 ${money(c.spend)} · 구매 ${num(c.purchases)} · ROAS ${(c.roas * 100).toFixed(0)}%`,
        ),
      ].join('\n'),
    );
  }
  // 카카오 텍스트 템플릿은 200자 제한
  return messages.map((m) => (m.length > KAKAO_TEXT_LIMIT ? `${m.slice(0, KAKAO_TEXT_LIMIT - 1)}…` : m));
}

async function kakaoAccessToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env('KAKAO_REST_API_KEY'),
    refresh_token: env('KAKAO_REFRESH_TOKEN'),
  });
  const secret = env('KAKAO_CLIENT_SECRET', false);
  if (secret) params.set('client_secret', secret);

  const res = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', body: params });
  const body = await res.json();
  if (!res.ok) throw new Error(`카카오 토큰 갱신 실패: ${body.error_description ?? res.status}`);
  if (body.refresh_token) {
    // 리프레시 토큰 만료가 1개월 이내로 남으면 새 토큰이 발급됩니다. 저장소 Secret을 교체해 주세요.
    console.warn('⚠️ 카카오 리프레시 토큰이 갱신되었습니다. KAKAO_REFRESH_TOKEN 값을 새 토큰으로 바꿔주세요.');
  }
  return body.access_token;
}

async function sendKakao(accessToken, text) {
  const adsManager = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId().replace('act_', '')}`;
  const template = {
    object_type: 'text',
    text,
    link: { web_url: adsManager, mobile_web_url: adsManager },
    button_title: '광고 관리자 열기',
  };
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  const body = await res.json();
  if (!res.ok || body.result_code !== 0) {
    throw new Error(`카카오 전송 실패: ${body.msg ?? res.status}`);
  }
}

const messages = formatMessages(await fetchReport());
if (process.env.DRY_RUN) {
  console.log(messages.join('\n\n---\n\n'));
} else {
  const token = await kakaoAccessToken();
  for (const text of messages) await sendKakao(token, text);
  console.log(`카카오톡으로 ${messages.length}개 메시지를 보냈습니다.`);
}

/**
 * 영상 → Mirra 지금 발행 워크플로 (웹 UI 와 CLI 가 함께 사용)
 *
 *  1. 영상 업로드            (로컬 파일 선택 → Gemini 업로드)
 *  2. 캡션 작성              (Gemini 영상 분석)
 *  3. 해시태그 작성          (Gemini)
 *  4. Mirra 접속             (API 키 인증 + 연결 계정 조회)
 *  5. 콘텐츠 관리 메뉴 접속  (게시물 API 접근 확인)
 *  6. 영상 업로드            (Mirra 스토리지)
 *  7. 캡션 및 해시태그 입력  (게시물 본문 구성)
 *  8. 발행할 계정 선택       (계정별 게시물 초안 생성)
 *  9. 최종 내용 확인         (Mirra 에 저장된 초안 다시 조회)
 * 10. 지금 발행              (발행 요청 + 결과 확인)
 */
import { VideoAnalyzer, composePostText, normalizeHashtags } from './analyzer.js';
import { config } from './config.js';
import { MirraClient, PLATFORM_LABELS, PLATFORM_TEXT_LIMITS, videoMimeType } from './mirra.js';

export const STEPS = [
  '영상 업로드',
  '캡션 작성',
  '해시태그 작성',
  'Mirra 접속',
  '콘텐츠 관리 메뉴 접속',
  'Mirra 영상 업로드',
  '캡션 및 해시태그 입력',
  '발행할 계정 선택',
  '최종 내용 확인',
  '지금 발행',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMirraClient() {
  return new MirraClient({ apiKey: config.mirraApiKey, baseUrl: config.mirraBaseUrl });
}

// ── 1~3단계: 영상 분석 ─────────────────────────────────────────────

export async function analyzeVideo(filePath, options = {}, onStep = () => {}) {
  const analyzer = new VideoAnalyzer();
  const mimeType = videoMimeType(filePath);

  onStep(1, 'running', 'AI 분석용으로 영상을 업로드하는 중…');
  const videoFile = await analyzer.uploadVideo(filePath, mimeType);
  onStep(1, 'done', '영상 업로드 완료');

  try {
    onStep(2, 'running', '영상 내용을 분석해 캡션을 작성하는 중…');
    const { summary, caption, youtubeTitle } = await analyzer.writeCaption(videoFile, options);
    onStep(2, 'done', '캡션 작성 완료');

    onStep(3, 'running', '해시태그를 작성하는 중…');
    const hashtags = await analyzer.writeHashtags(videoFile, caption, options);
    onStep(3, 'done', `해시태그 ${hashtags.length}개 작성 완료`);

    return { summary, caption, youtubeTitle, hashtags };
  } finally {
    await analyzer.deleteVideo(videoFile);
  }
}

// ── 4~5단계: Mirra 접속 / 콘텐츠 관리 ──────────────────────────────

export async function connectMirra(mirra = createMirraClient(), onStep = () => {}) {
  onStep(4, 'running', 'Mirra 에 접속하는 중…');
  const accounts = await mirra.listAccounts();
  onStep(4, 'done', `Mirra 접속 완료 · 연결된 계정 ${accounts.length}개`);

  onStep(5, 'running', '콘텐츠 관리(게시물) 메뉴에 접근하는 중…');
  await mirra.listPosts({ limit: 1 });
  onStep(5, 'done', '콘텐츠 관리 접근 완료');

  return { accounts, defaultAccountIds: resolveDefaultAccounts(accounts, config.defaultAccounts) };
}

/** MIRRA_DEFAULT_ACCOUNTS (ID / username / displayName / platform:username) → 계정 ID 목록 */
export function resolveDefaultAccounts(accounts, selectors) {
  const ids = new Set();
  for (const selector of selectors) {
    const s = selector.replace(/^@/, '').toLowerCase();
    const [platform, name] = s.includes(':') ? s.split(':', 2) : [null, s];
    for (const a of accounts) {
      if (platform && a.platform !== platform) continue;
      const names = [a.id, a.username, a.displayName].filter(Boolean).map((v) => String(v).replace(/^@/, '').toLowerCase());
      if (names.includes(name)) ids.add(a.id);
    }
  }
  return [...ids];
}

// ── 6단계: Mirra 영상 업로드 ───────────────────────────────────────

export async function uploadVideoToMirra(mirra, filePath, fileName, onStep = () => {}) {
  onStep(6, 'running', 'Mirra 에 영상을 업로드하는 중…');
  let last = -1;
  const media = await mirra.uploadVideo(filePath, {
    fileName,
    onProgress: (ratio) => {
      const pct = Math.floor(ratio * 100);
      if (pct >= last + 10 || pct === 100) {
        last = pct;
        onStep(6, 'running', `Mirra 에 영상을 업로드하는 중… ${pct}%`);
      }
    },
  });
  onStep(6, 'done', 'Mirra 영상 업로드 완료');
  return media;
}

// ── 7단계: 캡션 및 해시태그 입력 ───────────────────────────────────

export function buildPostText({ caption, hashtags }) {
  return composePostText(caption || '', normalizeHashtags(hashtags || []));
}

/** 계정(플랫폼)별 Mirra 게시물 생성 요청 본문 */
export function buildPostBody(account, { text, videoUrl, youtubeTitle }) {
  const body = { socialAccountId: account.id, content: text, videos: [videoUrl] };
  switch (account.platform) {
    case 'youtube':
      body.youtubeTitle = (youtubeTitle || text.split('\n').find((l) => l.trim()) || '').trim().slice(0, 100);
      body.description = text;
      body.privacyStatus = config.youtubePrivacy;
      break;
    case 'instagram':
    case 'instagram_fb':
      body.instagramOptions = { shareToFeed: true }; // 단일 영상 = 릴스, 피드에도 노출
      break;
    case 'tiktok':
      body.tiktokOptions = { tiktokPostMode: 'DIRECT_POST', privacyLevel: config.tiktokPrivacy };
      break;
    default:
      break;
  }
  return body;
}

export function textWarnings(account, text) {
  const limit = PLATFORM_TEXT_LIMITS[account.platform];
  const length = [...text].length;
  return limit && length > limit
    ? [`${PLATFORM_LABELS[account.platform] || account.platform} 글자 수 제한(${limit}자)을 초과합니다: ${length}자`]
    : [];
}

// ── 8~9단계: 계정 선택 → 초안 생성 → 최종 확인 ─────────────────────

export async function createDrafts(mirra, { accounts, accountIds, text, videoUrl, youtubeTitle }, onStep = () => {}) {
  onStep(7, 'done', '캡션 및 해시태그 입력 완료');
  const selected = accountIds.map((id) => accounts.find((a) => a.id === id)).filter(Boolean);
  if (!selected.length) throw new Error('발행할 계정을 하나 이상 선택하세요.');

  onStep(8, 'running', `선택한 계정 ${selected.length}개에 게시물을 준비하는 중…`);
  const drafts = [];
  for (const account of selected) {
    const { postId } = await mirra.createPost(buildPostBody(account, { text, videoUrl, youtubeTitle }));
    drafts.push({ postId, account });
  }
  onStep(8, 'done', `발행 계정 선택 완료 · ${selected.map((a) => `${a.platformLabel} @${a.username}`).join(', ')}`);

  onStep(9, 'running', 'Mirra 에 저장된 최종 내용을 불러오는 중…');
  const review = [];
  for (const { postId, account } of drafts) {
    const post = await mirra.getPost(postId);
    const content = post.content ?? text;
    review.push({
      postId,
      account,
      status: post.status || 'draft',
      content,
      youtubeTitle: post.youtubeTitle,
      videos: post.videos || [videoUrl],
      dashboardUrl: mirra.dashboardUrl(postId),
      warnings: textWarnings(account, content),
    });
  }
  onStep(9, 'waiting', '최종 내용을 확인하고 "지금 발행"을 눌러주세요');
  return review;
}

// ── 10단계: 지금 발행 ──────────────────────────────────────────────

const FINAL_STATUSES = new Set(['published', 'failed', 'error']);

export async function publishNow(mirra, postIds, onStep = () => {}, { pollMs = 4000, timeoutMs = 5 * 60_000 } = {}) {
  onStep(9, 'done', '최종 내용 확인 완료');
  onStep(10, 'running', '지금 발행 요청 중…');
  const results = [];
  for (const postId of postIds) {
    try {
      await mirra.publishNow(postId);
      results.push({ postId, status: 'publishing' });
    } catch (error) {
      results.push({ postId, status: 'failed', error: error.message });
    }
  }

  // 발행은 비동기로 처리되므로 최종 상태가 될 때까지 확인한다
  const deadline = Date.now() + timeoutMs;
  while (results.some((r) => !FINAL_STATUSES.has(r.status)) && Date.now() < deadline) {
    await sleep(pollMs);
    for (const r of results.filter((x) => !FINAL_STATUSES.has(x.status))) {
      try {
        const post = await mirra.getPost(r.postId);
        r.status = post.status || r.status;
        r.platformUrl = post.platformPostUrl || post.publishedUrl || post.permalink || r.platformUrl;
        r.error = post.errorMessage || post.failureReason || r.error;
      } catch {
        // 일시적인 조회 실패는 다음 주기에 다시 확인
      }
    }
    const done = results.filter((r) => FINAL_STATUSES.has(r.status)).length;
    onStep(10, 'running', `발행 진행 중… (${done}/${results.length})`);
  }

  for (const r of results) r.dashboardUrl = mirra.dashboardUrl(r.postId);
  const published = results.filter((r) => r.status === 'published').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'error').length;
  const pending = results.length - published - failed;
  const summary = `발행 완료 ${published}건` + (failed ? ` · 실패 ${failed}건` : '') + (pending ? ` · 처리 중 ${pending}건 (Mirra 에서 확인)` : '');
  onStep(10, failed ? 'error' : 'done', summary);
  return { results, summary };
}

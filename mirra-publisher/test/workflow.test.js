import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { startMockMirra } from './mock-mirra.js';

let mock;
let workflow;
let analyzer;
let MirraClient;
let createAppServer;
let videoPath;

before(async () => {
  mock = await startMockMirra();
  process.env.MIRRA_API_KEY = 'test-key';
  process.env.MIRRA_BASE_URL = mock.url;
  process.env.MIRRA_DEFAULT_ACCOUNTS = 'instagram:thank_cafe';
  process.env.GEMINI_API_KEY = '';
  workflow = await import('../src/workflow.js');
  analyzer = await import('../src/analyzer.js');
  ({ MirraClient } = await import('../src/mirra.js'));
  ({ createAppServer } = await import('../src/server.js'));
  const dir = await mkdtemp(join(tmpdir(), 'mirra-test-'));
  videoPath = join(dir, 'clip.mp4');
  await writeFile(videoPath, Buffer.alloc(256 * 1024, 7));
});

after(() => mock.close());

test('해시태그 정규화: # 접두어, 공백/중복 제거', () => {
  assert.deepEqual(analyzer.normalizeHashtags(['카페', '#카페', '#성수 카페', '##Latte', 'latte', '']), ['#카페', '#성수카페', '#Latte']);
  assert.equal(analyzer.composePostText('본문입니다', ['a', '#b']), '본문입니다\n\n#a #b');
  assert.equal(analyzer.stripHashtags('맛있어요 #카페 #라떼\n좋아요').trim(), '맛있어요\n좋아요');
});

test('썸네일 추천 시점 정리', () => {
  assert.deepEqual(analyzer.normalizeThumbnails([
    { time: 3.14159, reason: ' 선명 ', headline: '라떼' },
    { time: 3.5, reason: '중복', headline: '' },
    { time: -2, reason: '음수', headline: '' },
    { time: 'abc', reason: '잘못됨', headline: '' },
  ]), [
    { time: 3.1, reason: '선명', headline: '라떼' },
    { time: 0, reason: '음수', headline: '' },
  ]);
  assert.deepEqual(analyzer.normalizeThumbnails(undefined), []);
});

test('지정된 계정(MIRRA_DEFAULT_ACCOUNTS) 해석', () => {
  const accounts = [
    { id: '1', username: 'thank_cafe', displayName: '땡큐카페', platform: 'instagram' },
    { id: '2', username: 'thank_cafe', platform: 'threads' },
    { id: '3', username: 'other', platform: 'youtube' },
  ];
  assert.deepEqual(workflow.resolveDefaultAccounts(accounts, ['instagram:thank_cafe']), ['1']);
  assert.deepEqual(workflow.resolveDefaultAccounts(accounts, ['@thank_cafe']), ['1', '2']);
  assert.deepEqual(workflow.resolveDefaultAccounts(accounts, ['땡큐카페', '3']), ['1', '3']);
});

test('플랫폼별 게시물 본문 구성', () => {
  const input = { text: '제목줄\n본문', videoUrl: 'https://cdn/v.mp4', youtubeTitle: '유튜브 제목' };
  const yt = workflow.buildPostBody({ id: 'y', platform: 'youtube' }, input);
  assert.equal(yt.youtubeTitle, '유튜브 제목');
  assert.equal(yt.description, input.text);
  assert.equal(yt.privacyStatus, 'public');
  assert.deepEqual(workflow.buildPostBody({ id: 'i', platform: 'instagram' }, input).instagramOptions, { shareToFeed: true });
  assert.equal(workflow.buildPostBody({ id: 't', platform: 'tiktok' }, input).tiktokOptions.tiktokPostMode, 'DIRECT_POST');
  assert.deepEqual(workflow.buildPostBody({ id: 'x', platform: 'twitter' }, input).videos, ['https://cdn/v.mp4']);
  const withThumb = { ...input, thumbnailUrl: 'https://cdn/t.jpg' };
  assert.deepEqual(workflow.buildPostBody({ id: 'i', platform: 'instagram' }, withThumb).videoThumbnails, ['https://cdn/t.jpg']);
  assert.deepEqual(workflow.buildPostBody({ id: 'y', platform: 'youtube' }, withThumb).videoThumbnails, ['https://cdn/t.jpg']);
  assert.equal(workflow.buildPostBody({ id: 't', platform: 'tiktok' }, withThumb).videoThumbnails, undefined);
});

test('4~10단계: Mirra 접속 → 업로드 → 초안 → 확인 → 지금 발행', async () => {
  const mirra = new MirraClient({ apiKey: 'test-key', baseUrl: mock.url });
  const log = [];
  const onStep = (step, state) => log.push(`${step}:${state}`);

  const { accounts, defaultAccountIds } = await workflow.connectMirra(mirra, onStep);
  assert.equal(accounts.length, 3);
  assert.deepEqual(defaultAccountIds, ['acc-ig']);

  const media = await workflow.uploadVideoToMirra(mirra, videoPath, 'clip.mp4', onStep);
  assert.match(media.url, /^https:\/\/cdn\.example\.com\/storage\/.*clip\.mp4$/);
  assert.equal([...mock.uploads.values()].at(-1).size, 256 * 1024);
  assert.equal([...mock.uploads.values()].at(-1).type, 'video/mp4');

  const text = workflow.buildPostText({ caption: '오늘의 신메뉴 ☕️', hashtags: ['카페', '신메뉴'] });
  const drafts = await workflow.createDrafts(mirra, { accounts, accountIds: ['acc-ig', 'acc-yt'], text, videoUrl: media.url, youtubeTitle: '신메뉴 소개' }, onStep);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].content, '오늘의 신메뉴 ☕️\n\n#카페 #신메뉴');
  assert.equal(mock.posts.get(drafts[1].postId).youtubeTitle, '신메뉴 소개');
  assert.equal(mock.posts.get(drafts[0].postId).status, 'draft');

  const { results, summary } = await workflow.publishNow(mirra, drafts.map((d) => d.postId), onStep, { pollMs: 20 });
  assert.deepEqual(results.map((r) => r.status), ['published', 'published']);
  assert.match(results[0].platformUrl, /social\.example\.com/);
  assert.equal(summary, '발행 완료 2건');

  // 단계 순서 검증: 4 → 5 → 6 → 7 → 8 → 9 → 10
  const doneOrder = log.filter((l) => l.endsWith(':done')).map((l) => Number(l.split(':')[0]));
  assert.deepEqual(doneOrder, [4, 5, 6, 7, 8, 9, 10]);
});

test('잘못된 API 키는 이해하기 쉬운 오류로 안내', async () => {
  const mirra = new MirraClient({ apiKey: 'wrong', baseUrl: mock.url });
  await assert.rejects(mirra.listAccounts(), /401.*API 키를 확인하세요/);
});

test('웹 서버 e2e: 영상 업로드 → Mirra → 초안 → 확인 없이 발행 거부 → 지금 발행', async () => {
  const server = createAppServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, headers) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: body instanceof Buffer ? body : JSON.stringify(body ?? {}) });
    return { status: res.status, data: await res.json() };
  };
  try {
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.steps.length, 10);
    assert.equal((await fetch(`${base}/`)).status, 200);

    const bad = await post('/api/jobs', Buffer.from('x'), { 'X-File-Name': 'a.txt' });
    assert.equal(bad.status, 500);

    const { data: job } = await post('/api/jobs', Buffer.alloc(1024, 1), { 'X-File-Name': encodeURIComponent('내 영상.mp4') });
    assert.ok(job.jobId);

    const progress = await (await fetch(`${base}/api/jobs/${job.jobId}`)).json();
    assert.equal(progress.steps.length, 10);
    assert.equal(progress.fileName, '내 영상.mp4');

    const analyze = await post(`/api/jobs/${job.jobId}/analyze`, {});
    assert.match(analyze.data.error, /GEMINI_API_KEY/);

    const badThumb = await post(`/api/jobs/${job.jobId}/thumbnail`, Buffer.from('not-jpeg'), { 'Content-Type': 'image/jpeg' });
    assert.equal(badThumb.status, 400);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 3)]);
    const { data: t } = await post(`/api/jobs/${job.jobId}/thumbnail`, jpeg, { 'Content-Type': 'image/jpeg' });
    assert.equal(t.thumbnail, true);

    const { data: m } = await post(`/api/jobs/${job.jobId}/mirra`);
    assert.deepEqual(m.defaultAccountIds, ['acc-ig']);
    assert.match(m.thumbnailUrl, /thumbnail\.jpg$/);
    const lateThumb = await post(`/api/jobs/${job.jobId}/thumbnail`, jpeg, { 'Content-Type': 'image/jpeg' });
    assert.equal(lateThumb.status, 409);
    assert.ok(m.videoUrl.endsWith('.mp4'));

    const { data: d } = await post(`/api/jobs/${job.jobId}/drafts`, { text: '캡션\n\n#태그', accountIds: ['acc-x', 'acc-ig'] });
    assert.equal(d.drafts[0].account.username, 'thank_x');
    assert.equal(mock.posts.get(d.drafts[0].postId).videoThumbnails, undefined);
    assert.deepEqual(mock.posts.get(d.drafts[1].postId).videoThumbnails, [m.thumbnailUrl]);
    assert.equal(d.drafts[1].thumbnail, m.thumbnailUrl);

    const refused = await post(`/api/jobs/${job.jobId}/publish`, {});
    assert.equal(refused.status, 400);

    const { data: p } = await post(`/api/jobs/${job.jobId}/publish`, { confirmed: true });
    assert.deepEqual(p.results.map((r) => r.status), ['published', 'published']);

    const again = await post(`/api/jobs/${job.jobId}/publish`, { confirmed: true });
    assert.equal(again.status, 409);
  } finally {
    server.close();
  }
});

test('APP_PASSWORD 설정 시 비밀번호 없이는 접근 불가', async () => {
  const server = createAppServer({ password: 's3cret' }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = (pw) => ({ Authorization: `Basic ${Buffer.from(`me:${pw}`).toString('base64')}` });
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 401);
    assert.equal((await fetch(`${base}/api/status`, { headers: auth('wrong') })).status, 401);
    assert.equal((await fetch(`${base}/api/status`, { headers: auth('s3cret') })).status, 200);
  } finally {
    server.close();
  }
});

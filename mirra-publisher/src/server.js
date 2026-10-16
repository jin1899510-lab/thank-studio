/**
 * 로컬 웹 UI 서버 — http://localhost:5180
 *
 * API 키는 이 서버(PC)에만 보관되고 브라우저로 전달되지 않는다.
 * 외부에서 접근할 수 없도록 127.0.0.1 에만 바인딩한다.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ROOT_DIR, config, requireKeys } from './config.js';
import { videoMimeType } from './mirra.js';
import {
  STEPS,
  analyzeVideo,
  buildPostText,
  connectMirra,
  createDrafts,
  createMirraClient,
  publishNow,
  uploadVideoToMirra,
} from './workflow.js';

const PUBLIC_DIR = resolve(ROOT_DIR, 'public');
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/** @type {Map<string, any>} */
const jobs = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '잘못된 JSON 요청입니다.');
  }
}

function getJob(id) {
  const job = jobs.get(id);
  if (!job) throw new HttpError(404, '작업을 찾을 수 없습니다. 영상을 다시 선택하세요.');
  return job;
}

// 진행 상황을 SSE 로 브라우저에 실시간 전달
function emit(job, step, state, message) {
  job.steps[step - 1] = { state, message };
  const payload = `data: ${JSON.stringify({ step, state, message })}\n\n`;
  for (const res of job.listeners) res.write(payload);
}

const routes = {
  'GET /api/status': async () => ({
    steps: STEPS,
    geminiReady: Boolean(config.geminiApiKey),
    mirraReady: Boolean(config.mirraApiKey),
    mirraBaseUrl: config.mirraBaseUrl,
    defaultAccounts: config.defaultAccounts,
  }),

  // 1단계: PC 의 영상 파일을 받는다 (본문 = 파일 원본)
  'POST /api/jobs': async (req) => {
    const fileName = decodeURIComponent(req.headers['x-file-name'] || 'video.mp4').replace(/[\\/]/g, '_');
    videoMimeType(fileName);
    await mkdir(config.uploadDir, { recursive: true });
    const id = randomUUID();
    const filePath = join(config.uploadDir, `${id}${extname(fileName).toLowerCase()}`);
    await pipeline(req, createWriteStream(filePath));
    jobs.set(id, { id, fileName, filePath, steps: STEPS.map(() => ({ state: 'pending' })), listeners: new Set() });
    return { jobId: id, fileName };
  },

  // 1~3단계: 영상 분석 → 캡션 → 해시태그
  'POST /api/jobs/:id/analyze': async (req, job) => {
    requireKeys('geminiApiKey');
    const options = await readJson(req);
    job.analysis = await analyzeVideo(job.filePath, options, (...a) => emit(job, ...a));
    return job.analysis;
  },

  // 4~6단계: Mirra 접속 → 콘텐츠 관리 → 영상 업로드
  'POST /api/jobs/:id/mirra': async (req, job) => {
    requireKeys('mirraApiKey');
    const mirra = createMirraClient();
    const onStep = (...a) => emit(job, ...a);
    const { accounts, defaultAccountIds } = await connectMirra(mirra, onStep);
    job.accounts = accounts;
    if (!job.media) job.media = await uploadVideoToMirra(mirra, job.filePath, job.fileName, onStep);
    else onStep(6, 'done', 'Mirra 영상 업로드 완료 (이전 업로드 사용)');
    const text = buildPostText(job.analysis || {});
    emit(job, 7, 'waiting', '게시물 본문(캡션 + 해시태그)을 확인하세요');
    return { accounts, defaultAccountIds, videoUrl: job.media.url, text };
  },

  // 7~9단계: 본문 입력 → 계정 선택(초안 생성) → 최종 확인 데이터
  'POST /api/jobs/:id/drafts': async (req, job) => {
    if (!job.media) throw new HttpError(400, 'Mirra 영상 업로드가 먼저 완료되어야 합니다.');
    const { text, accountIds, youtubeTitle } = await readJson(req);
    if (!text?.trim()) throw new HttpError(400, '게시물 본문이 비어 있습니다.');
    if (job.drafts?.length) throw new HttpError(409, '이미 게시물 초안이 만들어졌습니다. 새 작업으로 다시 시작하세요.');
    const mirra = createMirraClient();
    job.drafts = await createDrafts(mirra, {
      accounts: job.accounts,
      accountIds: accountIds || [],
      text,
      videoUrl: job.media.url,
      youtubeTitle: youtubeTitle ?? job.analysis?.youtubeTitle,
    }, (...a) => emit(job, ...a));
    return { drafts: job.drafts };
  },

  // 10단계: 지금 발행 (최종 확인 체크 필수)
  'POST /api/jobs/:id/publish': async (req, job) => {
    const { confirmed } = await readJson(req);
    if (confirmed !== true) throw new HttpError(400, '최종 내용 확인에 동의해야 발행할 수 있습니다.');
    if (!job.drafts?.length) throw new HttpError(400, '발행할 게시물이 없습니다.');
    if (job.published) throw new HttpError(409, '이미 발행 요청한 작업입니다.');
    job.published = true;
    const result = await publishNow(createMirraClient(), job.drafts.map((d) => d.postId), (...a) => emit(job, ...a));
    rm(job.filePath, { force: true }).catch(() => {});
    return result;
  },
};

function matchRoute(method, pathname) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const params = pattern.split('/');
    const parts = pathname.split('/');
    if (params.length !== parts.length) continue;
    let id;
    if (params.every((p, i) => (p === ':id' ? (id = parts[i]) : p === parts[i]))) return { handler, id };
  }
  return null;
}

async function serveStatic(res, pathname) {
  const file = resolve(PUBLIC_DIR, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(404, 'Not found');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    throw new HttpError(404, 'Not found');
  }
}

export function createAppServer() {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      const events = pathname.match(/^\/api\/jobs\/([\w-]+)\/events$/);
      if (req.method === 'GET' && events) {
        const job = getJob(events[1]);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        job.steps.forEach((s, i) => s.state !== 'pending' && res.write(`data: ${JSON.stringify({ step: i + 1, ...s })}\n\n`));
        job.listeners.add(res);
        req.on('close', () => job.listeners.delete(res));
        return;
      }
      if (pathname.startsWith('/api/')) {
        const route = matchRoute(req.method, pathname);
        if (!route) throw new HttpError(404, '알 수 없는 API 입니다.');
        const job = route.id ? getJob(route.id) : undefined;
        return sendJson(res, 200, await route.handler(req, job));
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      await serveStatic(res, pathname);
    } catch (error) {
      const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
      const job = pathname.match(/^\/api\/jobs\/([\w-]+)\//)?.[1];
      if (job && jobs.has(job)) {
        const j = jobs.get(job);
        const running = j.steps.findIndex((s) => s.state === 'running');
        if (running !== -1) emit(j, running + 1, 'error', error.message);
      }
      console.error(`[${req.method} ${pathname}]`, error.message);
      if (!res.headersSent) sendJson(res, status, { error: error.message });
      else res.end();
    }
  });
}

if (process.argv[1]?.endsWith('server.js')) {
  createAppServer().listen(config.port, '127.0.0.1', () => {
    console.log(`\n  Mirra 자동 발행 도구 실행 중 → http://localhost:${config.port}\n`);
    if (!config.geminiApiKey) console.warn('  ⚠ GEMINI_API_KEY 가 없습니다 (.env 확인)');
    if (!config.mirraApiKey) console.warn('  ⚠ MIRRA_API_KEY 가 없습니다 (.env 확인)');
  });
}

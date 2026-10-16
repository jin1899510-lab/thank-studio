/**
 * Mirra REST API 클라이언트
 *
 * 공식 Mirra MCP 서버(@mirrai/mcp-server)가 호출하는 것과 같은 /api/v1 엔드포인트를 사용한다.
 *   - GET  /api/v1/social-accounts/my-accounts      연결된 SNS 계정 목록
 *   - GET  /api/v1/posts                            콘텐츠 관리(게시물) 목록
 *   - POST /api/v1/media/upload-url                 업로드용 서명 URL 발급
 *   - PUT  <uploadUrl>                              파일 업로드
 *   - POST /api/v1/media/confirm-upload             업로드 확정 → 공개 URL
 *   - POST /api/v1/posts                            게시물(초안) 생성
 *   - GET  /api/v1/posts/:id                        게시물 상세
 *   - POST /api/v1/posts/publishing/now/:id         지금 발행
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

const MIME_BY_EXTENSION = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export const PLATFORM_LABELS = {
  instagram: 'Instagram',
  instagram_fb: 'Instagram (Facebook 로그인)',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  twitter: 'X (Twitter)',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
};

// 플랫폼별 본문 글자 수 제한 (최종 확인 단계에서 경고로 사용)
export const PLATFORM_TEXT_LIMITS = {
  instagram: 2200,
  instagram_fb: 2200,
  tiktok: 2200,
  youtube: 5000,
  twitter: 280,
  threads: 500,
  linkedin: 3000,
  facebook: 63206,
};

export function videoMimeType(filePath) {
  const match = filePath.toLowerCase().match(/\.[^.]+$/);
  const mime = match ? MIME_BY_EXTENSION[match[0]] : undefined;
  if (!mime) throw new Error('지원하지 않는 영상 형식입니다. (mp4, mov, webm 지원)');
  return mime;
}

export class MirraApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class MirraClient {
  constructor({ apiKey, baseUrl }) {
    if (!apiKey) throw new Error('MIRRA_API_KEY 가 필요합니다.');
    this.apiKey = apiKey;
    this.baseUrl = new URL(baseUrl).origin;
  }

  async request(method, path, { body, query } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new MirraApiError(0, `Mirra 서버(${this.baseUrl})에 연결할 수 없습니다: ${error.cause?.message || error.message}`);
    }
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      const detail = payload.error?.message || payload.error || payload.message || text.slice(0, 300);
      const hint = response.status === 401 || response.status === 403
        ? ' (API 키를 확인하세요: Mirra 워크스페이스 설정 → API 키)'
        : response.status === 402 ? ' (크레딧/요금제 한도를 확인하세요)' : '';
      throw new MirraApiError(response.status, `Mirra API 오류 ${response.status}: ${detail}${hint}`, payload);
    }
    return payload;
  }

  /** 연결된 SNS 계정 목록 */
  async listAccounts() {
    const result = await this.request('GET', '/api/v1/social-accounts/my-accounts');
    return (result.socialAccounts || []).map((a) => ({
      id: a.id,
      username: a.username,
      displayName: a.displayName ?? a.name ?? a.username,
      platform: a.platform,
      platformLabel: PLATFORM_LABELS[a.platform] || a.platform,
    }));
  }

  /** 콘텐츠 관리(게시물) 목록 */
  async listPosts(query = {}) {
    return this.request('GET', '/api/v1/posts', { query: { limit: 5, ...query } });
  }

  /** 로컬 영상 파일을 Mirra 스토리지에 업로드하고 공개 URL 을 돌려준다 */
  async uploadVideo(filePath, { fileName = basename(filePath), onProgress } = {}) {
    const fileType = videoMimeType(fileName);
    const { size } = await stat(filePath);
    const { uploadUrl, storagePath } = await this.request('POST', '/api/v1/media/upload-url', {
      body: { fileName, fileType, fileSize: size },
    });
    if (!uploadUrl) throw new MirraApiError(500, 'Mirra 가 업로드 URL 을 돌려주지 않았습니다.');

    let sent = 0;
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      sent += chunk.length;
      onProgress?.(sent / size);
    });
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': fileType, 'Content-Length': String(size) },
      body: stream,
      duplex: 'half',
    });
    if (!response.ok) {
      throw new MirraApiError(response.status, `영상 스토리지 업로드 실패 (HTTP ${response.status})`);
    }
    const confirmed = await this.request('POST', '/api/v1/media/confirm-upload', {
      body: { storagePath, fileType: 'video' },
    });
    const url = confirmed.url || confirmed.publicUrl || confirmed.data?.url;
    if (!url) throw new MirraApiError(500, `업로드 확정 응답에 URL 이 없습니다: ${JSON.stringify(confirmed)}`);
    return { url, storagePath, fileName, fileSize: size };
  }

  /** 게시물(초안) 생성 → postId */
  async createPost(body) {
    const result = await this.request('POST', '/api/v1/posts', { body: { status: 'draft', origin: 'mirra-publisher', ...body } });
    const postId = result.postId || result.id || result.post?.id || result.data?.id;
    if (!postId) throw new MirraApiError(500, `게시물 생성 응답에 postId 가 없습니다: ${JSON.stringify(result)}`);
    return { postId, raw: result };
  }

  async getPost(postId) {
    const result = await this.request('GET', `/api/v1/posts/${encodeURIComponent(postId)}`);
    return result.post || result.data || result;
  }

  /** 지금 발행 (비동기 처리 — getPost 로 상태 확인) */
  async publishNow(postId) {
    return this.request('POST', `/api/v1/posts/publishing/now/${encodeURIComponent(postId)}`);
  }

  dashboardUrl(postId, locale = 'ko') {
    return `${this.baseUrl}/${locale}/posts/${postId}`;
  }
}

/**
 * Gemini 로 영상을 분석해 SNS 캡션과 해시태그를 작성한다.
 *   1) 영상을 Gemini Files API 에 업로드하고 처리(ACTIVE) 완료까지 대기
 *   2) 캡션 작성 (영상 요약 + 캡션 + YouTube 제목)
 *   3) 해시태그 작성 (영상 + 확정된 캡션 기반)
 */
import { GoogleGenAI, FileState, Type, createPartFromUri } from '@google/genai';
import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class VideoAnalyzer {
  constructor({ apiKey = config.geminiApiKey, model = config.geminiModel } = {}) {
    if (!apiKey) throw new Error('GEMINI_API_KEY 가 필요합니다.');
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  /** 영상을 Gemini 에 올리고 분석 가능한 상태가 될 때까지 기다린다 */
  async uploadVideo(filePath, mimeType, { timeoutMs = 10 * 60_000 } = {}) {
    let file = await this.ai.files.upload({ file: filePath, config: { mimeType } });
    const deadline = Date.now() + timeoutMs;
    while (file.state === FileState.PROCESSING) {
      if (Date.now() > deadline) throw new Error('Gemini 영상 처리 시간이 초과되었습니다.');
      await sleep(3000);
      file = await this.ai.files.get({ name: file.name });
    }
    if (file.state === FileState.FAILED) throw new Error('Gemini 가 영상을 처리하지 못했습니다.');
    return { name: file.name, uri: file.uri, mimeType: file.mimeType || mimeType };
  }

  async deleteVideo(videoFile) {
    try {
      await this.ai.files.delete({ name: videoFile.name });
    } catch {
      // 48시간 후 자동 삭제되므로 실패해도 무시
    }
  }

  async generateJson(videoFile, prompt, schema) {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [createPartFromUri(videoFile.uri, videoFile.mimeType), { text: prompt }] }],
      config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.8 },
    });
    try {
      return JSON.parse(response.text || '{}');
    } catch {
      throw new Error(`AI 응답을 해석하지 못했습니다: ${(response.text || '').slice(0, 200)}`);
    }
  }

  /** 2단계: 영상 내용에 맞는 캡션 작성 */
  async writeCaption(videoFile, options = {}) {
    const { language = config.captionLanguage, tone = '친근하고 자연스러운', platforms = [], notes = '' } = options;
    const prompt = [
      '너는 SNS 마케팅 카피라이터다. 첨부된 영상을 처음부터 끝까지 보고(화면, 자막, 음성, 음악, 분위기 모두 고려) 게시물 캡션을 작성해라.',
      `- 언어: ${language}`,
      `- 톤: ${tone}`,
      platforms.length ? `- 발행 플랫폼: ${platforms.join(', ')} (모든 플랫폼에 어울리게)` : '',
      notes ? `- 추가 요청/브랜드 정보: ${notes}` : '',
      '- 첫 문장은 스크롤을 멈추게 하는 훅으로 시작한다.',
      '- 영상에 실제로 나오는 내용만 쓰고, 보이지 않는 사실(가격, 장소명 등)은 지어내지 않는다.',
      '- 2~5개의 짧은 문단, 이모지는 적당히, 마지막에 자연스러운 행동 유도(CTA) 한 줄.',
      '- 캡션 안에는 해시태그(#)를 넣지 않는다. 해시태그는 별도 단계에서 작성한다.',
      '- 전체 캡션은 공백 포함 1500자를 넘지 않는다.',
      'JSON 으로 답한다: summary(영상 내용 요약 2~3문장), caption(캡션 본문), youtubeTitle(유튜브용 제목, 100자 이내, 해시태그 없음).',
    ].filter(Boolean).join('\n');

    const result = await this.generateJson(videoFile, prompt, {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        caption: { type: Type.STRING },
        youtubeTitle: { type: Type.STRING },
      },
      required: ['summary', 'caption', 'youtubeTitle'],
    });
    return {
      summary: String(result.summary || '').trim(),
      caption: stripHashtags(String(result.caption || '')).trim(),
      youtubeTitle: String(result.youtubeTitle || '').replace(/#\S+/g, '').trim().slice(0, 100),
    };
  }

  /** 3단계: 영상과 캡션에 맞는 해시태그 작성 */
  async writeHashtags(videoFile, caption, options = {}) {
    const { language = config.captionLanguage, count = config.hashtagCount, platforms = [], notes = '' } = options;
    const prompt = [
      '너는 SNS 해시태그 전략가다. 첨부된 영상과 아래 캡션에 가장 잘 맞는 해시태그를 작성해라.',
      `- 개수: ${count}개 내외`,
      `- 주 언어: ${language} (검색량이 많은 영어 태그를 일부 섞어도 된다)`,
      platforms.length ? `- 발행 플랫폼: ${platforms.join(', ')}` : null,
      notes ? `- 추가 요청/브랜드 정보: ${notes}` : null,
      '- 대형(인기) 태그, 중형(카테고리) 태그, 소형(구체적/니치) 태그를 고루 섞는다.',
      '- 영상과 관련 없는 태그, 금지/스팸성 태그는 넣지 않는다. 띄어쓰기 없이 작성한다.',
      '',
      `[캡션]\n${caption}`,
      '',
      'JSON 으로 답한다: hashtags(문자열 배열, 각 항목은 #으로 시작).',
    ].filter((line) => line !== null).join('\n');

    const result = await this.generateJson(videoFile, prompt, {
      type: Type.OBJECT,
      properties: { hashtags: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ['hashtags'],
    });
    return normalizeHashtags(result.hashtags || []);
  }
}

export function stripHashtags(text) {
  return text.replace(/(^|\s)#[^\s#]+/g, '$1').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/** '#' 접두어 보장, 공백/특수문자 제거, 중복 제거 */
export function normalizeHashtags(tags) {
  const items = Array.isArray(tags) ? tags : String(tags).split(/[\s,]+/);
  const seen = new Set();
  const result = [];
  for (const raw of items) {
    const body = String(raw).trim().replace(/^#+/, '').replace(/[\s#.,!?'"`~@$%^&*()+=\[\]{}|\\/<>:;-]+/g, '');
    if (!body) continue;
    const key = body.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(`#${body}`);
  }
  return result;
}

/** Mirra 게시물 본문 = 캡션 + 빈 줄 + 해시태그 */
export function composePostText(caption, hashtags) {
  const tags = normalizeHashtags(hashtags).join(' ');
  return [caption.trim(), tags].filter(Boolean).join('\n\n');
}

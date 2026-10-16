import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// .env 파일을 읽어 process.env 에 채운다. (이미 설정된 환경변수는 덮어쓰지 않음)
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(ROOT_DIR, '.env'));
loadDotEnv(resolve(ROOT_DIR, '..', '.env.local'));

const list = (value) => (value || '').split(',').map((v) => v.trim()).filter(Boolean);

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
  mirraApiKey: process.env.MIRRA_API_KEY || '',
  mirraBaseUrl: process.env.MIRRA_BASE_URL || 'https://www.mirra.my',
  // "지정된 계정": username, displayName 또는 계정 ID 를 쉼표로 구분
  defaultAccounts: list(process.env.MIRRA_DEFAULT_ACCOUNTS),
  youtubePrivacy: process.env.MIRRA_YOUTUBE_PRIVACY || 'public',
  tiktokPrivacy: process.env.MIRRA_TIKTOK_PRIVACY || 'PUBLIC_TO_EVERYONE',
  captionLanguage: process.env.CAPTION_LANGUAGE || '한국어',
  hashtagCount: Number(process.env.HASHTAG_COUNT || 15),
  port: Number(process.env.PORT || 5180),
  // 인터넷에 올릴 때는 HOST=0.0.0.0, 그리고 APP_PASSWORD 가 반드시 필요
  host: process.env.HOST || '127.0.0.1',
  appPassword: process.env.APP_PASSWORD || '',
  uploadDir: resolve(ROOT_DIR, 'uploads'),
};

export function requireKeys(...names) {
  const missing = names.filter((name) => !config[name]);
  if (missing.length) {
    const envNames = { geminiApiKey: 'GEMINI_API_KEY', mirraApiKey: 'MIRRA_API_KEY' };
    throw new Error(`환경변수가 설정되지 않았습니다: ${missing.map((n) => envNames[n] || n).join(', ')} (.env 파일을 확인하세요)`);
  }
}

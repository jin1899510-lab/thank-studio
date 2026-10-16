#!/usr/bin/env node
/**
 * 터미널 버전 — 영상 한 개를 10단계 순서대로 처리해 Mirra 로 지금 발행한다.
 *
 *   npm run publish-video -- <영상파일> [옵션]
 *
 *   --accounts a,b   발행 계정 (ID / username / platform:username). 없으면 MIRRA_DEFAULT_ACCOUNTS 사용
 *   --tone "..."     캡션 톤
 *   --notes "..."    추가 요청 · 브랜드 정보
 *   --yes            확인 질문 없이 바로 발행 (예약 작업/자동화용)
 *   --dry-run        최종 확인 단계까지만 진행하고 발행하지 않음 (초안은 Mirra 에 남음)
 */
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { requireKeys } from './config.js';
import {
  STEPS,
  analyzeVideo,
  buildPostText,
  connectMirra,
  createDrafts,
  createMirraClient,
  publishNow,
  resolveDefaultAccounts,
  uploadVideoToMirra,
} from './workflow.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    accounts: { type: 'string' },
    tone: { type: 'string' },
    notes: { type: 'string' },
    yes: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || !positionals[0]) {
  console.log('사용법: npm run publish-video -- <영상파일> [--accounts a,b] [--tone ".."] [--notes ".."] [--yes] [--dry-run]');
  process.exit(values.help ? 0 : 1);
}

const ICON = { running: '…', done: '✔', waiting: '?', error: '✖' };
const onStep = (step, state, message) => {
  if (state === 'running' && !process.stdout.isTTY) return;
  const line = `[${String(step).padStart(2)}/10] ${ICON[state] || ' '} ${STEPS[step - 1]} — ${message}`;
  if (process.stdout.isTTY && state === 'running') process.stdout.write(`\r\x1b[2K${line}`);
  else process.stdout.write(`${process.stdout.isTTY ? '\r\x1b[2K' : ''}${line}\n`);
};

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => (values.yes ? 'y' : (await rl.question(q)).trim());
const yes = async (q) => /^(y|yes|ㅇ|네|예)?$/i.test(await ask(`${q} [Y/n] `));

async function main() {
  requireKeys('geminiApiKey', 'mirraApiKey');
  const filePath = resolve(positionals[0]);
  if (!existsSync(filePath)) throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);

  // 1~3단계
  const analysis = await analyzeVideo(filePath, { tone: values.tone, notes: values.notes }, onStep);
  console.log(`\n🎬 ${analysis.summary}\n\n── 캡션 ──\n${analysis.caption}\n\n── 해시태그 ──\n${analysis.hashtags.join(' ')}\n`);
  if (!(await yes('이 캡션과 해시태그로 진행할까요?'))) throw new Error('사용자가 취소했습니다.');

  // 4~6단계
  const mirra = createMirraClient();
  const { accounts, defaultAccountIds } = await connectMirra(mirra, onStep);
  if (!accounts.length) throw new Error('Mirra 에 연결된 SNS 계정이 없습니다.');
  const media = await uploadVideoToMirra(mirra, filePath, basename(filePath), onStep);

  // 7단계
  const text = buildPostText(analysis);
  onStep(7, 'done', `게시물 본문 ${[...text].length}자`);

  // 8단계
  let accountIds = values.accounts
    ? resolveDefaultAccounts(accounts, values.accounts.split(',').map((s) => s.trim()).filter(Boolean))
    : defaultAccountIds;
  if (!accountIds.length) {
    if (values.yes) throw new Error('--yes 사용 시 --accounts 또는 MIRRA_DEFAULT_ACCOUNTS 로 발행 계정을 지정해야 합니다.');
    console.log('\n연결된 계정:');
    accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.platformLabel} @${a.username}`));
    const picked = await rl.question('발행할 계정 번호 (쉼표로 구분): ');
    accountIds = picked.split(/[,\s]+/).map((n) => accounts[Number(n) - 1]?.id).filter(Boolean);
  }
  const drafts = await createDrafts(mirra, { accounts, accountIds, text, videoUrl: media.url, youtubeTitle: analysis.youtubeTitle }, onStep);

  // 9단계
  console.log('\n════════ 최종 내용 확인 ════════');
  console.log(`영상: ${media.url}`);
  for (const d of drafts) {
    console.log(`\n▶ ${d.account.platformLabel} @${d.account.username}  (${d.dashboardUrl})`);
    if (d.youtubeTitle) console.log(`제목: ${d.youtubeTitle}`);
    console.log(d.content);
    d.warnings.forEach((w) => console.log(`⚠ ${w}`));
  }
  console.log('════════════════════════════════\n');
  if (values['dry-run']) {
    console.log('--dry-run: 발행하지 않고 종료합니다. 초안은 Mirra 콘텐츠 관리에서 확인할 수 있습니다.');
    return;
  }
  if (!(await yes(`${drafts.length}개 계정에 지금 발행할까요?`))) {
    console.log('발행을 취소했습니다. 초안은 Mirra 콘텐츠 관리에 남아 있습니다.');
    return;
  }

  // 10단계
  const { results } = await publishNow(mirra, drafts.map((d) => d.postId), onStep);
  for (const r of results) {
    const d = drafts.find((x) => x.postId === r.postId);
    console.log(`  ${r.status === 'published' ? '✅' : r.status === 'failed' ? '❌' : '⏳'} ${d.account.platformLabel} @${d.account.username} — ${r.status}${r.error ? ` (${r.error})` : ''}  ${r.platformUrl || r.dashboardUrl}`);
  }
  if (results.some((r) => r.status === 'failed' || r.status === 'error')) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(`\n✖ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());


// 여러 개 한번에: 영상마다 서버 작업(job)을 하나씩 만들어 10단계를 같은 순서로 진행한다.
import { $, api, composeThumbnail, createFrameGrabber, escapeHtml, formatTime, toJpeg } from './common.js';

const MAX_FILES = 20;
const STEP_COUNT = 10;
let steps = [];
let phase = 'select'; // select → analyzing → analyzed → uploading → uploaded → drafting → review → publishing → done
let accounts = [];
let seq = 0;
/** @type {any[]} */
const cards = [];

const STATUS_LABEL = {
  pending: '대기 중', analyzing: '분석 중', analyzed: '분석 완료', uploading: 'Mirra 업로드 중', uploaded: '업로드 완료',
  drafting: '게시물 준비 중', review: '확인 대기', publishing: '발행 중', done: '완료', error: '실패',
};

function showError(error) {
  $('error').hidden = !error;
  $('error').textContent = error ? `⚠ ${error.message || error}` : '';
}

const active = () => cards.filter((c) => c.status !== 'error');

// 동시에 limit 개씩 처리
async function runPool(items, limit, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

// ── 카드 ──────────────────────────────────────────────────

function addFiles(files) {
  showError(null);
  for (const file of files) {
    if (cards.length >= MAX_FILES) {
      showError(new Error(`한 번에 최대 ${MAX_FILES}개까지 올릴 수 있습니다.`));
      break;
    }
    if (!/\.(mp4|mov|m4v|webm)$/i.test(file.name)) continue;
    const card = { id: ++seq, file, url: URL.createObjectURL(file), status: 'pending', steps: [], thumbs: [], thumbIndex: -1 };
    card.grab = createFrameGrabber(card.url);
    cards.push(card);
    $('cards').append(buildCard(card));
  }
  updateAction();
}

function buildCard(card) {
  const el = document.createElement('article');
  el.className = 'panel card';
  el.innerHTML = `
    <div class="card-head">
      <strong class="card-name">${escapeHtml(card.file.name)}</strong>
      <small class="muted">${(card.file.size / 1024 / 1024).toFixed(1)} MB</small>
      <span class="pill" data-el="pill"></span>
      <button type="button" class="icon" data-el="remove" title="목록에서 빼기">✕</button>
    </div>
    <div class="mini-steps" data-el="dots"></div>
    <p class="card-msg muted small" data-el="msg"></p>
    <div class="card-body" data-el="body" hidden>
      <video src="${card.url}" controls muted data-el="video"></video>
      <div class="card-fields">
        <p class="summary" data-el="summary"></p>
        <label>캡션<textarea rows="6" data-el="caption"></textarea></label>
        <label>해시태그<textarea rows="2" data-el="hashtags"></textarea></label>
        <label>YouTube 제목<input maxlength="100" data-el="youtubeTitle" /></label>
        <div class="thumbs-section">
          <h3>썸네일 <small>(눌러서 선택 · 다시 누르면 해제)</small></h3>
          <div class="thumbs small-thumbs" data-el="thumbs"></div>
          <div class="thumb-tools">
            <button type="button" data-el="capture">＋ 현재 장면 추가</button>
            <label class="inline"><input type="checkbox" data-el="textOn" /> 문구 넣기</label>
            <input maxlength="30" placeholder="썸네일 문구" data-el="text" disabled />
          </div>
        </div>
      </div>
    </div>
    <div data-el="review" hidden></div>
    <div data-el="result" hidden></div>`;
  card.el = el;
  card.q = (name) => el.querySelector(`[data-el="${name}"]`);

  card.q('remove').addEventListener('click', () => {
    if (!['pending', 'analyzed', 'uploaded', 'error'].includes(card.status) || ['review', 'publishing', 'done'].includes(phase)) return;
    cards.splice(cards.indexOf(card), 1);
    el.remove();
    URL.revokeObjectURL(card.url);
    updateAction();
  });
  card.q('capture').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { time, canvas } = await card.grab(card.q('video').currentTime);
      card.thumbs.push({ time, canvas, reason: '', recommended: false });
      card.thumbIndex = card.thumbs.length - 1;
      renderThumbs(card);
    } catch (error) {
      showError(error);
    } finally {
      e.target.disabled = card.locked;
    }
  });
  card.q('textOn').addEventListener('change', (e) => {
    card.q('text').disabled = !e.target.checked;
    renderThumbs(card);
  });
  card.q('text').addEventListener('input', () => card.q('textOn').checked && renderThumbs(card));
  setStatus(card, 'pending');
  return el;
}

function setStatus(card, status, message) {
  card.status = status;
  card.q('pill').textContent = STATUS_LABEL[status];
  card.q('pill').className = `pill ${status}`;
  if (message !== undefined) card.q('msg').textContent = message;
  renderDots(card);
}

function renderDots(card) {
  card.q('dots').innerHTML = Array.from({ length: STEP_COUNT }, (_, i) => {
    const s = card.steps[i]?.state || 'pending';
    return `<span class="mini ${s}" title="${i + 1}. ${escapeHtml(steps[i] || '')}"></span>`;
  }).join('');
}

// 서버 작업 진행 상황을 주기적으로 가져와 점(10단계)과 메시지를 갱신
async function tracked(card, fn) {
  const timer = setInterval(async () => {
    if (!card.jobId) return;
    try {
      const { steps: s } = await api(`/api/jobs/${card.jobId}`, { method: 'GET' });
      card.steps = s;
      const current = [...s].reverse().find((x) => x.state !== 'pending');
      if (current?.message) card.q('msg').textContent = current.message;
      renderDots(card);
    } catch { /* 다음 주기에 다시 */ }
  }, 1500);
  try {
    return await fn();
  } catch (error) {
    setStatus(card, 'error', error.message);
    card.q('msg').classList.add('warn');
    return undefined;
  } finally {
    clearInterval(timer);
    if (card.jobId) {
      try {
        card.steps = (await api(`/api/jobs/${card.jobId}`, { method: 'GET' })).steps;
        renderDots(card);
      } catch { /* 무시 */ }
    }
  }
}

// ── 썸네일 ────────────────────────────────────────────────

function thumbText(card) {
  return card.q('textOn').checked ? card.q('text').value.trim() : '';
}

function renderThumbs(card) {
  const box = card.q('thumbs');
  box.innerHTML = '';
  const text = thumbText(card);
  card.thumbs.forEach((thumb, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `thumb${i === card.thumbIndex ? ' selected' : ''}`;
    const img = composeThumbnail(thumb.canvas, text);
    img.className = 'thumb-img';
    btn.append(img);
    const meta = document.createElement('span');
    meta.className = 'thumb-meta';
    meta.innerHTML = `<strong>${i === card.thumbIndex ? '✓ 선택' : thumb.recommended ? `추천 ${i + 1}` : '직접'} · ${formatTime(thumb.time)}</strong>${thumb.reason ? `<small>${escapeHtml(thumb.reason)}</small>` : ''}`;
    btn.append(meta);
    btn.addEventListener('click', () => {
      if (card.locked) return;
      card.thumbIndex = card.thumbIndex === i ? -1 : i;
      renderThumbs(card);
    });
    box.append(btn);
  });
}

async function loadThumbs(card, suggestions) {
  try {
    for (const s of suggestions) {
      const { time, canvas } = await card.grab(s.time);
      card.thumbs.push({ ...s, time, canvas, recommended: true });
    }
    const headline = suggestions.find((s) => s.headline)?.headline;
    if (headline) card.q('text').value = headline;
    card.thumbIndex = card.thumbs.length ? 0 : -1;
    renderThumbs(card);
  } catch (error) {
    card.q('thumbs').innerHTML = `<p class="warn small">⚠ ${escapeHtml(error.message)}</p>`;
    card.q('capture').disabled = true;
  }
}

async function saveThumbnail(card) {
  const thumb = card.thumbs[card.thumbIndex];
  const body = thumb ? await toJpeg(composeThumbnail(thumb.canvas, thumbText(card))) : new Blob([]);
  await api(`/api/jobs/${card.jobId}/thumbnail`, { body, headers: { 'Content-Type': 'image/jpeg' } });
}

function lockCard(card) {
  card.locked = true;
  ['caption', 'hashtags', 'youtubeTitle'].forEach((n) => (card.q(n).readOnly = true));
  ['capture', 'textOn', 'text'].forEach((n) => (card.q(n).disabled = true));
}

// ── 단계별 일괄 처리 ──────────────────────────────────────

// 1~3단계: 영상 업로드 → 캡션 → 해시태그·썸네일 (2개씩 동시에)
async function analyzeAll() {
  const options = {
    tone: $('optTone').value,
    language: $('optLanguage').value,
    count: Number($('optCount').value) || 15,
    notes: $('optNotes').value,
  };
  const targets = cards.filter((c) => c.status === 'pending');
  await runPool(targets, 2, (card) => tracked(card, async () => {
    setStatus(card, 'analyzing', '영상을 올리는 중…');
    const { jobId } = await api('/api/jobs', { body: card.file, headers: { 'X-File-Name': encodeURIComponent(card.file.name) } });
    card.jobId = jobId;
    const result = await api(`/api/jobs/${jobId}/analyze`, { body: options });
    card.analysis = result;
    card.q('summary').textContent = result.summary ? `🎬 ${result.summary}` : '';
    card.q('caption').value = result.caption;
    card.q('hashtags').value = result.hashtags.join(' ');
    card.q('youtubeTitle').value = result.youtubeTitle || '';
    card.q('body').hidden = false;
    setStatus(card, 'analyzed', '캡션·해시태그를 확인하고 썸네일을 고르세요');
    await loadThumbs(card, result.thumbnails || []);
  }));
}

// 4~6단계: Mirra 접속 → 콘텐츠 관리 → 영상·썸네일 업로드 (1개씩 차례로)
async function uploadAll() {
  let defaults = [];
  await runPool(cards.filter((c) => c.status === 'analyzed'), 1, (card) => tracked(card, async () => {
    lockCard(card);
    setStatus(card, 'uploading', 'Mirra 에 올리는 중…');
    await saveThumbnail(card);
    const result = await api(`/api/jobs/${card.jobId}/mirra`);
    if (!accounts.length) {
      accounts = result.accounts;
      defaults = result.defaultAccountIds;
    }
    setStatus(card, 'uploaded', result.thumbnailUrl ? 'Mirra 영상 · 썸네일 업로드 완료' : 'Mirra 영상 업로드 완료');
  }));
  renderAccounts(defaults);
}

function renderAccounts(defaultIds) {
  $('panel-accounts').hidden = false;
  if (!accounts.length) {
    $('accounts').innerHTML = '<p class="muted">Mirra 에 연결된 SNS 계정이 없습니다. Mirra 에서 계정을 먼저 연결하세요.</p>';
    return;
  }
  $('accounts').innerHTML = accounts
    .map((a) => `<label class="account"><input type="checkbox" value="${escapeHtml(a.id)}" ${defaultIds.includes(a.id) ? 'checked' : ''} />
      <span class="badge ${escapeHtml(a.platform)}">${escapeHtml(a.platformLabel)}</span>
      <span>@${escapeHtml(a.username)}${a.displayName && a.displayName !== a.username ? ` <small>${escapeHtml(a.displayName)}</small>` : ''}</span></label>`)
    .join('');
  $('accounts').onchange = updateAction;
}

const selectedAccountIds = () => [...document.querySelectorAll('#accounts input:checked')].map((el) => el.value);

function postText(card) {
  const tags = card.q('hashtags').value.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
  return [card.q('caption').value.trim(), tags.join(' ')].filter(Boolean).join('\n\n');
}

// 7~9단계: 본문 입력 → 계정별 초안 생성 → Mirra 에 저장된 내용으로 최종 확인
async function draftAll() {
  const accountIds = selectedAccountIds();
  if (!accountIds.length) throw new Error('발행할 계정을 하나 이상 선택하세요.');
  document.querySelectorAll('#accounts input').forEach((el) => (el.disabled = true));
  await runPool(cards.filter((c) => c.status === 'uploaded'), 1, (card) => tracked(card, async () => {
    setStatus(card, 'drafting', '게시물을 준비하는 중…');
    const { drafts } = await api(`/api/jobs/${card.jobId}/drafts`, {
      body: { text: postText(card), accountIds, youtubeTitle: card.q('youtubeTitle').value },
    });
    card.drafts = drafts;
    card.q('review').hidden = false;
    card.q('review').innerHTML = `<h3 class="review-title">최종 확인</h3>` + drafts.map((d) => `
      <div class="review-card">
        <div class="review-head">
          <span class="badge ${escapeHtml(d.account.platform)}">${escapeHtml(d.account.platformLabel)}</span>
          <strong>@${escapeHtml(d.account.username)}</strong>
          <a href="${escapeHtml(d.dashboardUrl)}" target="_blank" rel="noopener">Mirra 에서 보기 ↗</a>
        </div>
        ${d.thumbnail ? `<img class="review-thumb" src="${escapeHtml(d.thumbnail)}" alt="썸네일" />` : ''}
        ${d.youtubeTitle ? `<p class="yt-title">제목: ${escapeHtml(d.youtubeTitle)}</p>` : ''}
        <pre>${escapeHtml(d.content)}</pre>
        ${d.warnings.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join('')}
      </div>`).join('');
    setStatus(card, 'review', '최종 내용을 확인하세요');
  }));
}

// 10단계: 지금 발행 (3개씩 동시에)
async function publishAll() {
  await runPool(cards.filter((c) => c.status === 'review'), 3, (card) => tracked(card, async () => {
    setStatus(card, 'publishing', '지금 발행 요청 중…');
    const { results, summary } = await api(`/api/jobs/${card.jobId}/publish`, { body: { confirmed: true } });
    const byId = Object.fromEntries(card.drafts.map((d) => [d.postId, d]));
    const label = { published: '✅ 발행 완료', failed: '❌ 실패', error: '❌ 실패' };
    card.q('result').hidden = false;
    card.q('result').innerHTML = results.map((r) => {
      const d = byId[r.postId];
      return `<div class="result-row">
        <span class="badge ${escapeHtml(d?.account.platform)}">${escapeHtml(d?.account.platformLabel)}</span>
        <strong>@${escapeHtml(d?.account.username)}</strong>
        <span>${label[r.status] || `⏳ ${escapeHtml(r.status)}`}</span>
        ${r.platformUrl ? `<a href="${escapeHtml(r.platformUrl)}" target="_blank" rel="noopener">게시물 ↗</a>` : ''}
        <a href="${escapeHtml(r.dashboardUrl)}" target="_blank" rel="noopener">Mirra ↗</a>
        ${r.error ? `<small class="warn">${escapeHtml(r.error)}</small>` : ''}</div>`;
    }).join('');
    const failed = results.some((r) => r.status === 'failed' || r.status === 'error');
    setStatus(card, failed ? 'error' : 'done', summary);
  }));
}

// ── 하단 버튼 ─────────────────────────────────────────────

const ACTIONS = {
  select: { label: (n) => `모두 분석 시작 (${n}개)`, busy: '분석 중…', next: 'analyzed', run: analyzeAll, ready: () => cards.some((c) => c.status === 'pending') },
  analyzed: { label: (n) => `모두 Mirra 접속 및 업로드 (${n}개)`, busy: 'Mirra 업로드 중…', next: 'uploaded', run: uploadAll, ready: () => cards.some((c) => c.status === 'analyzed') },
  uploaded: { label: (n) => `최종 내용 확인으로 (${n}개)`, busy: '게시물 준비 중…', next: 'review', run: draftAll, ready: () => cards.some((c) => c.status === 'uploaded') && selectedAccountIds().length > 0 },
  review: { label: (n) => `모두 지금 발행 (${n}개 영상)`, busy: '발행 중…', next: 'done', run: publishAll, ready: () => cards.some((c) => c.status === 'review') && $('confirmCheck').checked },
  done: { label: () => '새로 시작', run: async () => location.reload(), ready: () => true },
};

function countFor(p) {
  const status = { select: 'pending', analyzed: 'analyzed', uploaded: 'uploaded', review: 'review' }[p];
  return cards.filter((c) => c.status === status).length;
}

function updateAction() {
  $('countLabel').textContent = cards.length ? `(${cards.length}개)` : '';
  const action = ACTIONS[phase];
  const btn = $('btnAction');
  $('confirmWrap').hidden = phase !== 'review';
  if (!action) return;
  btn.textContent = cards.length || phase === 'done' ? action.label(countFor(phase)) : '영상을 선택하세요';
  btn.disabled = !action.ready();
  btn.className = phase === 'review' ? 'publish' : 'primary';
  const hints = {
    select: '영상을 더 추가할 수 있습니다.',
    analyzed: '캡션·해시태그·썸네일을 영상마다 확인하고 고치세요. 실패한 영상은 건너뜁니다.',
    uploaded: '발행할 계정을 고르세요.',
    review: 'Mirra 에서 보기 링크로 초안을 확인한 뒤 발행하세요.',
    done: '',
  };
  $('actionHint').textContent = hints[phase] || '';
}

$('btnAction').addEventListener('click', async () => {
  const action = ACTIONS[phase];
  if (phase === 'review') {
    const n = countFor('review');
    if (!confirm(`${n}개 영상을 선택한 계정에 지금 바로 발행합니다. 계속할까요?`)) return;
    $('confirmCheck').disabled = true;
  }
  if (phase === 'select') $('fileInput').disabled = true;
  const btn = $('btnAction');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${action.busy || ''}`;
  showError(null);
  try {
    await action.run();
    if (action.next) phase = active().length ? action.next : 'done';
  } catch (error) {
    showError(error);
  }
  updateAction();
});

$('confirmCheck').addEventListener('change', updateAction);
$('fileInput').addEventListener('change', (e) => {
  addFiles([...e.target.files]);
  e.target.value = '';
});
$('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop').classList.remove('over');
  if (phase === 'select') addFiles([...e.dataTransfer.files]);
});
window.addEventListener('beforeunload', (e) => {
  if (['analyzed', 'uploaded', 'review'].includes(phase) || $('btnAction').querySelector('.spinner')) e.preventDefault();
});

(async () => {
  const status = await api('/api/status', { method: 'GET' });
  steps = status.steps;
  const missing = [!status.geminiReady && 'GEMINI_API_KEY', !status.mirraReady && 'MIRRA_API_KEY'].filter(Boolean);
  $('keyStatus').innerHTML = missing.length
    ? `<span class="warn">⚠ ${missing.join(', ')} 가 설정되지 않았습니다 (Render 환경변수 또는 .env 확인)</span>`
    : `<span class="ok">● Gemini · Mirra 연결 준비됨</span>`;
  updateAction();
})().catch(showError);

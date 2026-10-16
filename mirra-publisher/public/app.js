const $ = (id) => document.getElementById(id);
const LIMITS = { instagram: 2200, instagram_fb: 2200, tiktok: 2200, youtube: 5000, twitter: 280, threads: 500, linkedin: 3000, facebook: 63206 };

const state = { jobId: null, file: null, steps: [], accounts: [], events: null, thumbs: [], thumbIndex: -1 };

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, { method = 'POST', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: body instanceof Blob ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function showError(error) {
  $('error').hidden = !error;
  $('error').textContent = error ? `⚠ ${error.message || error}` : '';
}

// ── 단계 표시 ─────────────────────────────────────────────

function renderSteps() {
  $('steps').innerHTML = state.steps
    .map((s, i) => `<li class="step ${s.state}"><span class="dot">${s.state === 'done' ? '✓' : i + 1}</span>
      <div><strong>${escapeHtml(s.name)}</strong>${s.message ? `<small>${escapeHtml(s.message)}</small>` : ''}</div></li>`)
    .join('');
}

function setStep(step, stepState, message) {
  Object.assign(state.steps[step - 1], { state: stepState, message });
  renderSteps();
}

function listen(jobId) {
  state.events?.close();
  state.events = new EventSource(`/api/jobs/${jobId}/events`);
  state.events.onmessage = (e) => {
    const { step, state: s, message } = JSON.parse(e.data);
    setStep(step, s, message);
  };
}

async function busy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span>${label}`;
  showError(null);
  try {
    return await fn();
  } catch (error) {
    showError(error);
    throw error;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ── 1단계: 영상 선택 ──────────────────────────────────────

function pickFile(file) {
  if (!file) return;
  if (!/\.(mp4|mov|m4v|webm)$/i.test(file.name)) return showError(new Error('mp4, mov, webm 영상만 지원합니다.'));
  state.file = file;
  $('dropText').innerHTML = `<strong>${escapeHtml(file.name)}</strong><br /><small>${(file.size / 1024 / 1024).toFixed(1)} MB · 다른 영상을 선택하려면 클릭</small>`;
  $('preview').src = URL.createObjectURL(file);
  $('preview').hidden = false;
  $('btnAnalyze').disabled = false;
  showError(null);
}

$('fileInput').addEventListener('change', (e) => pickFile(e.target.files[0]));
$('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop').classList.remove('over');
  pickFile(e.dataTransfer.files[0]);
});

// 1~3단계: 업로드 → 캡션 → 해시태그
$('btnAnalyze').addEventListener('click', () => busy($('btnAnalyze'), '영상 분석 중… (1~2분 소요)', async () => {
  setStep(1, 'running', '영상을 프로그램으로 불러오는 중…');
  const { jobId } = await api('/api/jobs', { body: state.file, headers: { 'X-File-Name': encodeURIComponent(state.file.name) } });
  state.jobId = jobId;
  listen(jobId);
  const result = await api(`/api/jobs/${jobId}/analyze`, {
    body: {
      tone: $('optTone').value,
      language: $('optLanguage').value,
      count: Number($('optCount').value) || 15,
      notes: $('optNotes').value,
    },
  });
  $('summary').textContent = result.summary ? `🎬 ${result.summary}` : '';
  $('caption').value = result.caption;
  $('hashtags').value = result.hashtags.join(' ');
  $('youtubeTitle').value = result.youtubeTitle || '';
  loadThumbnails(result.thumbnails || []);
  $('panel-caption').hidden = false;
  $('btnAnalyze').hidden = true;
  $('fileInput').disabled = true;
  $('panel-caption').scrollIntoView({ behavior: 'smooth' });
}).catch(() => {}));

// 4~6단계: Mirra 접속 → 콘텐츠 관리 → 영상 업로드
$('btnMirra').addEventListener('click', () => busy($('btnMirra'), 'Mirra 진행 중…', async () => {
  await saveThumbnail();
  const result = await api(`/api/jobs/${state.jobId}/mirra`);
  state.accounts = result.accounts;
  const tags = $('hashtags').value.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
  $('postText').value = [$('caption').value.trim(), tags.join(' ')].filter(Boolean).join('\n\n');
  renderAccounts(result.defaultAccountIds);
  updateCounter();
  ['caption', 'hashtags', 'youtubeTitle'].forEach((id) => ($(id).readOnly = true));
  lockThumbnails();
  $('btnMirra').hidden = true;
  $('panel-post').hidden = false;
  $('panel-post').scrollIntoView({ behavior: 'smooth' });
}).catch(() => {}));


// ── 썸네일 추천 ───────────────────────────────────────────

const formatTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let frameVideo;

// 브라우저에서 영상의 특정 시점을 이미지로 잘라낸다 (서버에 ffmpeg 불필요)
async function grabFrame(time) {
  if (!frameVideo) {
    frameVideo = document.createElement('video');
    frameVideo.muted = true;
    frameVideo.preload = 'auto';
    frameVideo.src = $('preview').src;
    await new Promise((ok, fail) => {
      frameVideo.onloadeddata = ok;
      frameVideo.onerror = () => fail(new Error('이 브라우저에서 영상 장면을 읽을 수 없습니다. (Chrome 권장)'));
    });
  }
  const t = Math.min(Math.max(0, time), Math.max(0, frameVideo.duration - 0.1));
  await new Promise((ok) => {
    frameVideo.onseeked = ok;
    frameVideo.currentTime = t;
  });
  const scale = Math.min(1, 1920 / Math.max(frameVideo.videoWidth, frameVideo.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(frameVideo.videoWidth * scale);
  canvas.height = Math.round(frameVideo.videoHeight * scale);
  canvas.getContext('2d').drawImage(frameVideo, 0, 0, canvas.width, canvas.height);
  return { time: t, canvas };
}

// 썸네일 문구: 아래쪽에 굵은 흰 글씨 + 검은 테두리
function composeThumbnail(canvas, text) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  if (text) {
    let size = Math.round(Math.min(out.width, out.height) * 0.11);
    ctx.font = `900 ${size}px "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    while (ctx.measureText(text).width > out.width * 0.9 && size > 12) {
      size -= 2;
      ctx.font = `900 ${size}px "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    }
    const gradient = ctx.createLinearGradient(0, out.height * 0.6, 0, out.height);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, out.height * 0.6, out.width, out.height * 0.4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size * 0.16);
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    const y = out.height * 0.9;
    ctx.strokeText(text, out.width / 2, y);
    ctx.fillText(text, out.width / 2, y);
  }
  return out;
}

function renderThumbs() {
  const text = $('thumbTextOn').checked ? $('thumbText').value.trim() : '';
  $('thumbs').innerHTML = '';
  state.thumbs.forEach((thumb, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `thumb${i === state.thumbIndex ? ' selected' : ''}`;
    const img = composeThumbnail(thumb.canvas, text);
    img.className = 'thumb-img';
    card.append(img);
    const meta = document.createElement('span');
    meta.className = 'thumb-meta';
    meta.innerHTML = `<strong>${i === state.thumbIndex ? '✓ 선택됨' : thumb.recommended ? `추천 ${i + 1}` : '직접 추가'} · ${formatTime(thumb.time)}</strong>${thumb.reason ? `<small>${escapeHtml(thumb.reason)}</small>` : ''}`;
    card.append(meta);
    card.addEventListener('click', () => {
      if (state.thumbsLocked) return;
      state.thumbIndex = state.thumbIndex === i ? -1 : i;
      if (state.thumbIndex !== -1 && thumb.headline && !$('thumbText').value) $('thumbText').value = thumb.headline;
      renderThumbs();
    });
    $('thumbs').append(card);
  });
}

async function loadThumbnails(suggestions) {
  state.thumbs = [];
  state.thumbIndex = -1;
  $('thumbs').innerHTML = '<p class="muted small">추천 장면을 불러오는 중…</p>';
  const times = suggestions.length ? suggestions : [{ time: 1, reason: '', headline: '' }];
  try {
    for (const s of times) {
      const { time, canvas } = await grabFrame(s.time);
      state.thumbs.push({ ...s, time, canvas, recommended: suggestions.length > 0 });
    }
    const headline = suggestions.find((s) => s.headline)?.headline;
    if (headline) $('thumbText').value = headline;
    state.thumbIndex = suggestions.length ? 0 : -1;
    renderThumbs();
  } catch (error) {
    $('thumbs').innerHTML = `<p class="warn small">⚠ ${escapeHtml(error.message)}</p>`;
    $('btnCaptureFrame').disabled = true;
  }
}

$('btnCaptureFrame').addEventListener('click', async () => {
  $('btnCaptureFrame').disabled = true;
  try {
    const { time, canvas } = await grabFrame($('preview').currentTime);
    state.thumbs.push({ time, canvas, reason: '', headline: '', recommended: false });
    state.thumbIndex = state.thumbs.length - 1;
    renderThumbs();
  } catch (error) {
    showError(error);
  } finally {
    $('btnCaptureFrame').disabled = Boolean(state.thumbsLocked);
  }
});
$('thumbTextOn').addEventListener('change', (e) => {
  $('thumbText').disabled = !e.target.checked;
  renderThumbs();
});
$('thumbText').addEventListener('input', () => $('thumbTextOn').checked && renderThumbs());

async function saveThumbnail() {
  const thumb = state.thumbs[state.thumbIndex];
  let body = new Blob([]);
  if (thumb) {
    const text = $('thumbTextOn').checked ? $('thumbText').value.trim() : '';
    body = await new Promise((ok) => composeThumbnail(thumb.canvas, text).toBlob(ok, 'image/jpeg', 0.9));
  }
  await api(`/api/jobs/${state.jobId}/thumbnail`, { body, headers: { 'Content-Type': 'image/jpeg' } });
}

function lockThumbnails() {
  state.thumbsLocked = true;
  ['btnCaptureFrame', 'thumbTextOn', 'thumbText'].forEach((id) => ($(id).disabled = true));
  $('thumbHint').textContent = state.thumbIndex === -1 ? '썸네일을 선택하지 않았습니다. (플랫폼 자동 선택)' : '선택한 썸네일이 Mirra 에 업로드되었습니다.';
}

// ── 7~8단계 ───────────────────────────────────────────────

function renderAccounts(defaultIds = []) {
  if (!state.accounts.length) {
    $('accounts').innerHTML = '<p class="muted">Mirra 에 연결된 SNS 계정이 없습니다. Mirra 에서 계정을 먼저 연결하세요.</p>';
    $('btnDrafts').disabled = true;
    return;
  }
  $('accounts').innerHTML = state.accounts
    .map((a) => `<label class="account"><input type="checkbox" value="${escapeHtml(a.id)}" ${defaultIds.includes(a.id) ? 'checked' : ''} />
      <span class="badge ${escapeHtml(a.platform)}">${escapeHtml(a.platformLabel)}</span>
      <span>@${escapeHtml(a.username)}${a.displayName && a.displayName !== a.username ? ` <small>${escapeHtml(a.displayName)}</small>` : ''}</span></label>`)
    .join('');
  $('accounts').addEventListener('change', updateCounter);
  setStep(8, 'waiting', defaultIds.length ? '지정된 계정이 선택되어 있습니다' : '발행할 계정을 선택하세요');
}

const selectedAccounts = () => [...document.querySelectorAll('#accounts input:checked')].map((el) => state.accounts.find((a) => a.id === el.value));

function updateCounter() {
  const length = [...$('postText').value].length;
  const over = selectedAccounts().filter((a) => LIMITS[a.platform] && length > LIMITS[a.platform]);
  $('counter').textContent = `${length}자` + (over.length ? ` · ⚠ 글자 수 초과: ${over.map((a) => `${a.platformLabel}(${LIMITS[a.platform]}자)`).join(', ')}` : '');
  $('counter').classList.toggle('warn', over.length > 0);
}
$('postText').addEventListener('input', updateCounter);

$('btnDrafts').addEventListener('click', () => busy($('btnDrafts'), '게시물 준비 중…', async () => {
  const accountIds = selectedAccounts().map((a) => a.id);
  if (!accountIds.length) throw new Error('발행할 계정을 하나 이상 선택하세요.');
  const { drafts } = await api(`/api/jobs/${state.jobId}/drafts`, {
    body: { text: $('postText').value, accountIds, youtubeTitle: $('youtubeTitle').value },
  });
  renderReview(drafts);
  $('postText').readOnly = true;
  document.querySelectorAll('#accounts input').forEach((el) => (el.disabled = true));
  $('btnDrafts').hidden = true;
  $('panel-review').hidden = false;
  $('panel-review').scrollIntoView({ behavior: 'smooth' });
}).catch(() => {}));

// ── 9단계: 최종 내용 확인 ─────────────────────────────────

function renderReview(drafts) {
  const videoSrc = drafts[0]?.videos?.[0] || $('preview').src;
  $('review').innerHTML = `
    <video src="${escapeHtml(videoSrc)}" controls class="review-video"></video>
    ${drafts.map((d) => `
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
      </div>`).join('')}`;
  state.drafts = drafts;
}

$('confirmCheck').addEventListener('change', (e) => ($('btnPublish').disabled = !e.target.checked));

// ── 10단계: 지금 발행 ─────────────────────────────────────

$('btnPublish').addEventListener('click', () => {
  if (!confirm(`선택한 ${state.drafts.length}개 계정에 지금 바로 발행합니다. 계속할까요?`)) return;
  busy($('btnPublish'), '발행 중…', async () => {
    $('confirmCheck').disabled = true;
    const { results, summary } = await api(`/api/jobs/${state.jobId}/publish`, { body: { confirmed: true } });
    const byId = Object.fromEntries(state.drafts.map((d) => [d.postId, d]));
    const label = { published: '✅ 발행 완료', failed: '❌ 실패', error: '❌ 실패' };
    $('result').innerHTML = `<p class="result-summary">${escapeHtml(summary)}</p>` + results.map((r) => {
      const d = byId[r.postId];
      return `<div class="review-card"><div class="review-head">
        <span class="badge ${escapeHtml(d?.account.platform)}">${escapeHtml(d?.account.platformLabel)}</span>
        <strong>@${escapeHtml(d?.account.username)}</strong>
        <span>${label[r.status] || `⏳ ${escapeHtml(r.status)}`}</span></div>
        ${r.error ? `<p class="warn">${escapeHtml(r.error)}</p>` : ''}
        <p>${r.platformUrl ? `<a href="${escapeHtml(r.platformUrl)}" target="_blank" rel="noopener">게시물 보기 ↗</a> · ` : ''}
        <a href="${escapeHtml(r.dashboardUrl)}" target="_blank" rel="noopener">Mirra 에서 보기 ↗</a></p></div>`;
    }).join('');
    $('btnPublish').hidden = true;
    $('panel-result').hidden = false;
    $('panel-result').scrollIntoView({ behavior: 'smooth' });
  }).catch(() => {});
});

$('btnRestart').addEventListener('click', () => location.reload());

// ── 시작 ──────────────────────────────────────────────────

(async () => {
  const status = await api('/api/status', { method: 'GET' });
  state.steps = status.steps.map((name) => ({ name, state: 'pending' }));
  renderSteps();
  const missing = [!status.geminiReady && 'GEMINI_API_KEY', !status.mirraReady && 'MIRRA_API_KEY'].filter(Boolean);
  $('keyStatus').innerHTML = missing.length
    ? `<span class="warn">⚠ ${missing.join(', ')} 가 설정되지 않았습니다 (Render 환경변수 또는 .env 확인)</span>`
    : `<span class="ok">● Gemini · Mirra 연결 준비됨</span>`;
})().catch(showError);

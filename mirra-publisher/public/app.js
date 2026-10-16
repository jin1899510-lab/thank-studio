const $ = (id) => document.getElementById(id);
const LIMITS = { instagram: 2200, instagram_fb: 2200, tiktok: 2200, youtube: 5000, twitter: 280, threads: 500, linkedin: 3000, facebook: 63206 };

const state = { jobId: null, file: null, steps: [], accounts: [], events: null };

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, { method = 'POST', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: body instanceof File ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body instanceof File ? body : body ? JSON.stringify(body) : undefined,
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
  $('panel-caption').hidden = false;
  $('btnAnalyze').hidden = true;
  $('fileInput').disabled = true;
  $('panel-caption').scrollIntoView({ behavior: 'smooth' });
}).catch(() => {}));

// 4~6단계: Mirra 접속 → 콘텐츠 관리 → 영상 업로드
$('btnMirra').addEventListener('click', () => busy($('btnMirra'), 'Mirra 진행 중…', async () => {
  const result = await api(`/api/jobs/${state.jobId}/mirra`);
  state.accounts = result.accounts;
  const tags = $('hashtags').value.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
  $('postText').value = [$('caption').value.trim(), tags.join(' ')].filter(Boolean).join('\n\n');
  renderAccounts(result.defaultAccountIds);
  updateCounter();
  ['caption', 'hashtags', 'youtubeTitle'].forEach((id) => ($(id).readOnly = true));
  $('btnMirra').hidden = true;
  $('panel-post').hidden = false;
  $('panel-post').scrollIntoView({ behavior: 'smooth' });
}).catch(() => {}));

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
    ? `<span class="warn">⚠ .env 에 ${missing.join(', ')} 를 설정한 뒤 서버를 다시 실행하세요</span>`
    : `<span class="ok">● Gemini · Mirra 연결 준비됨</span>`;
})().catch(showError);

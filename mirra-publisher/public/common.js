// 단일 화면(app.js)과 여러 개 화면(batch.js)이 함께 쓰는 도구
export const $ = (id) => document.getElementById(id);
export const LIMITS = { instagram: 2200, instagram_fb: 2200, tiktok: 2200, youtube: 5000, twitter: 280, threads: 500, linkedin: 3000, facebook: 63206 };

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function api(path, { method = 'POST', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: body instanceof Blob ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

export const formatTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** 영상의 특정 시점을 이미지(canvas)로 잘라내는 함수를 만든다 (서버에 ffmpeg 불필요) */
export function createFrameGrabber(src) {
  let video;
  let queue = Promise.resolve();
  const grab = async (time) => {
    if (!video) {
      video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = src;
      await new Promise((ok, fail) => {
        video.onloadeddata = ok;
        video.onerror = () => fail(new Error('이 브라우저에서 영상 장면을 읽을 수 없습니다. (Chrome 권장)'));
      });
    }
    const t = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.1));
    await new Promise((ok) => {
      video.onseeked = ok;
      video.currentTime = t;
    });
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return { time: t, canvas };
  };
  // 같은 영상에서 동시에 여러 장면을 요청해도 순서대로 처리
  return (time) => (queue = queue.catch(() => {}).then(() => grab(time)));
}

// 썸네일 문구: 아래쪽에 굵은 흰 글씨 + 검은 테두리
export function composeThumbnail(canvas, text) {
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

export const toJpeg = (canvas) => new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));

// Mirra /api/v1 동작을 흉내 내는 테스트용 서버
import { createServer } from 'node:http';

export function startMockMirra({ apiKey = 'test-key', publishResult = 'published' } = {}) {
  const posts = new Map();
  const uploads = new Map();
  const calls = [];
  let seq = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    calls.push({ method: req.method, path: url.pathname, bytes: raw.length });
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

    if (url.pathname.startsWith('/storage/')) {
      uploads.set(decodeURIComponent(url.pathname), { size: raw.length, type: req.headers['content-type'] });
      res.writeHead(200); return res.end();
    }
    if (req.headers.authorization !== `Bearer ${apiKey}`) return json(401, { error: 'Invalid API key' });
    const body = raw.length ? JSON.parse(raw) : {};
    const port = server.address().port;

    if (req.method === 'GET' && url.pathname === '/api/v1/social-accounts/my-accounts') {
      return json(200, { socialAccounts: [
        { id: 'acc-ig', username: 'thank_cafe', displayName: '땡큐카페', platform: 'instagram' },
        { id: 'acc-yt', username: 'thankstudio', displayName: 'Thank Studio', platform: 'youtube' },
        { id: 'acc-x', username: 'thank_x', platform: 'twitter' },
      ] });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/posts') return json(200, { posts: [...posts.values()], total: posts.size });
    if (req.method === 'POST' && url.pathname === '/api/v1/media/upload-url') {
      const storagePath = `/storage/${++seq}-${body.fileName}`;
      return json(200, { uploadUrl: `http://127.0.0.1:${port}${storagePath}`, storagePath });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/media/confirm-upload') {
      if (!uploads.has(body.storagePath)) return json(400, { error: 'not uploaded' });
      return json(200, { type: body.fileType, url: `https://cdn.example.com${body.storagePath}` });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/posts') {
      const id = `post-${++seq}`;
      posts.set(id, { id, status: body.status, ...body });
      return json(200, { success: true, postId: id });
    }
    const getMatch = url.pathname.match(/^\/api\/v1\/posts\/([\w-]+)$/);
    if (req.method === 'GET' && getMatch) {
      const p = posts.get(getMatch[1]);
      return p ? json(200, p) : json(404, { error: 'not found' });
    }
    const pubMatch = url.pathname.match(/^\/api\/v1\/posts\/publishing\/now\/([\w-]+)$/);
    if (req.method === 'POST' && pubMatch) {
      const p = posts.get(pubMatch[1]);
      if (!p) return json(404, { error: 'not found' });
      p.status = 'publishing';
      setTimeout(() => { p.status = publishResult; if (publishResult === 'published') p.platformPostUrl = `https://social.example.com/${p.id}`; }, 50);
      return json(200, { success: true, message: 'Publishing started' });
    }
    json(404, { error: 'unknown route' });
  });

  return new Promise((resolveStart) => server.listen(0, '127.0.0.1', () => resolveStart({
    url: `http://127.0.0.1:${server.address().port}`, posts, uploads, calls, close: () => server.close(),
  })));
}

const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.join(__dirname, 'frontend');
const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8787);
const PORT = Number(process.env.PREVIEW_PORT || 8081);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function resolveFile(urlPath) {
  let pathname = decodeURIComponent(urlPath.split('?')[0] || '/');
  if (pathname === '/') pathname = '/index.html';
  const requested = path.normalize(path.join(FRONTEND_DIR, pathname));
  if (!requested.startsWith(FRONTEND_DIR)) return '';

  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return requested;
  }

  if (!path.extname(requested)) {
    const htmlPath = requested + '.html';
    if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
      return htmlPath;
    }
  }

  return '';
}

function proxyApi(req, res) {
  const proxyReq = http.request(
    {
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    send(res, 502, JSON.stringify({ ok: false, error: 'Preview proxy failed', detail: error.message }), {
      'Content-Type': 'application/json; charset=utf-8'
    });
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (!req.url) return send(res, 400, 'Bad Request');

  if (req.url.startsWith('/api/')) {
    return proxyApi(req, res);
  }

  const filePath = resolveFile(req.url);
  if (!filePath) {
    return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      return send(res, 500, 'Server Error', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    send(res, 200, buffer, { 'Content-Type': contentType });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`snow123 preview listening on http://127.0.0.1:${PORT}`);
});

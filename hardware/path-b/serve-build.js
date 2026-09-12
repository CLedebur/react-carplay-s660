#!/usr/bin/env node
// Minimal static server for the CRA production build.
// Sends the SAME COOP/COEP headers the dev server's setupProxy.js used, so
// SharedArrayBuffer (the audio ring buffer) keeps working. No npm deps.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] ||
  path.join(process.env.HOME, 'react-carplay-s660/hardware/path-b/node-CarPlay/examples/carplay-web-app/build'));
const PORT = parseInt(process.env.PORT || '3000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.map': 'application/json', '.txt': 'text/plain'
};

function sendFile(res, fp, code = 200) {
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream');
    res.writeHead(code);
    res.end(data);
  });
}

http.createServer((req, res) => {
  // Cross-origin isolation for SharedArrayBuffer (matches setupProxy.js).
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let fp = path.normalize(path.join(ROOT, urlPath));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); } // no traversal

  fs.stat(fp, (err, st) => {
    if (!err && st.isDirectory()) fp = path.join(fp, 'index.html');
    fs.access(fp, fs.constants.R_OK, (e) => {
      if (e) return sendFile(res, path.join(ROOT, 'index.html')); // SPA fallback
      sendFile(res, fp);
    });
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serve-build: ${ROOT} on http://localhost:${PORT} (COOP/COEP on)`);
});

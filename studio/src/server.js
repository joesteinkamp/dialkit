// DialKit Studio HTTP server.
//
//   GET  /                  -> redirect to /studio/
//   GET  /studio/[asset]    -> the Studio shell UI (static)
//   GET  /api/history       -> commits (cheap) + the `current` working-tree version
//   GET  /api/status?ref=   -> build status for a ref
//   POST /api/build {ref}   -> kick off a lazy build (coalesced); poll status to await
//   GET  /v/:ref/*          -> serve a built version's static files

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCommits } from './git.js';

const UI_DIR = fileURLToPath(new URL('../ui/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJSON(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(data);
}

async function sendFile(res, filePath, { spaFallback } = {}) {
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) throw Object.assign(new Error('is dir'), { code: 'EISDIR' });
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
    return true;
  } catch (err) {
    if (spaFallback) {
      try {
        const body = await readFile(spaFallback);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
        return true;
      } catch {
        /* fall through */
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return false;
  }
}

// Prevent path traversal: resolve within `base` and reject escapes.
function safeJoin(base, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const full = join(base, clean);
  if (!full.startsWith(base)) return null;
  return full;
}

export function createStudioServer(config, builder, log = () => {}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${config.port}`);
      const path = url.pathname;

      if (path === '/') {
        res.writeHead(302, { location: '/studio/' });
        res.end();
        return;
      }

      // --- Studio shell UI ---
      if (path === '/studio' || path === '/studio/') {
        await sendFile(res, join(UI_DIR, 'index.html'));
        return;
      }
      if (path.startsWith('/studio/')) {
        const file = safeJoin(UI_DIR, path.slice('/studio/'.length));
        if (!file) return sendJSON(res, 400, { error: 'bad path' });
        await sendFile(res, file);
        return;
      }

      // --- API ---
      if (path === '/api/history') {
        const commits = await listCommits(config.root, config.maxCommits);
        return sendJSON(res, 200, {
          head: builder.headHash(),
          packageDir: config.relPackageDir,
          current: { ref: 'current', label: 'Current (working tree)' },
          commits,
        });
      }

      if (path === '/api/status') {
        const ref = url.searchParams.get('ref');
        if (!ref) return sendJSON(res, 400, { error: 'ref required' });
        return sendJSON(res, 200, { ref, ...builder.status(ref) });
      }

      if (path === '/api/build' && req.method === 'POST') {
        const body = await readBody(req);
        const ref = body.ref;
        if (!ref) return sendJSON(res, 400, { error: 'ref required' });
        // Kick off in the background; the client polls /api/status.
        builder.ensure(ref, { force: !!body.force }).catch(() => {});
        return sendJSON(res, 202, { ref, ...builder.status(ref) });
      }

      // --- Built version assets: /v/:ref/* ---
      if (path.startsWith('/v/')) {
        const rest = path.slice('/v/'.length);
        const slash = rest.indexOf('/');
        const ref = slash === -1 ? rest : rest.slice(0, slash);
        if (slash === -1) {
          res.writeHead(302, { location: `/v/${ref}/` });
          res.end();
          return;
        }
        const entry = builder.status(ref);
        if (entry.status !== 'ready') {
          return sendJSON(res, 503, { ref, ...entry });
        }
        const subPath = rest.slice(slash + 1) || 'index.html';
        const base = builder.outputDir(ref);
        const file = safeJoin(base, subPath);
        if (!file) return sendJSON(res, 400, { error: 'bad path' });
        const indexFile = join(base, 'index.html');
        // SPA fallback for extensionless routes (client-side routing in the iframe).
        const spaFallback = extname(subPath) === '' ? indexFile : undefined;
        await sendFile(res, file, { spaFallback });
        return;
      }

      sendJSON(res, 404, { error: 'not found' });
    } catch (err) {
      log(`[server] error: ${err.stack ?? err}`);
      sendJSON(res, 500, { error: String(err.message ?? err) });
    }
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

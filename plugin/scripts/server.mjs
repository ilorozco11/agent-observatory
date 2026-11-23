#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventReader, dataHome, serverPort, prepareHome } from '../lib/storage.mjs';
import { reduceEvents } from '../lib/model.mjs';
import { createDemoSnapshot } from '../lib/demo.mjs';
import { createOfficeDemoFrames } from '../lib/office-demo.mjs';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
export function makeServer({ home = dataHome(), port = serverPort(), demo = false, now = () => Date.now() } = {}) {
  const readEvents = createEventReader(home);
  const streams = new Set();
  async function snapshot(sample = false) {
    if (sample) return createDemoSnapshot(now());
    const { events, warnings } = await readEvents();
    return reduceEvents(events, { now: now(), mode: 'live', warnings });
  }
  const server = createServer(async (req, res) => {
    const host = req.headers.host || '';
    const expectedPort = server.address()?.port || port;
    if (![`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`].includes(host)) { res.writeHead(403); res.end('Local host required'); return; }
    const origin = req.headers.origin;
    if (origin && ![`http://127.0.0.1:${expectedPort}`, `http://localhost:${expectedPort}`].includes(origin)) { res.writeHead(403); res.end('Same origin required'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${expectedPort}`); } catch { res.writeHead(400); res.end(); return; }
    const sample = demo || url.searchParams.get('demo') === '1';
    try {
      if (url.pathname === '/api/health') {
        res.setHeader('Content-Type', MIME['.json']);
        res.end(JSON.stringify({ service: 'agent-observatory', version: '0.2.0', mode: demo ? 'demo' : 'live' })); return;
      }
      if (url.pathname === '/api/state') {
        res.setHeader('Content-Type', MIME['.json']); res.end(JSON.stringify(await snapshot(sample))); return;
      }
      if (url.pathname === '/api/office-demo') {
        res.setHeader('Content-Type', MIME['.json']);
        res.end(JSON.stringify({ mode: 'demo', frames: createOfficeDemoFrames(now()) })); return;
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        if (req.method === 'HEAD') { res.end(); return; }
        res.write('retry: 3000\n\n');
        let busy = false;
        const push = async () => {
          if (busy || res.destroyed) return;
          busy = true;
          try { res.write(`event: snapshot\ndata: ${JSON.stringify(await snapshot(sample))}\n\n`); }
          catch { res.write('event: source-error\ndata: {"message":"Không đọc được dữ liệu cục bộ"}\n\n'); }
          finally { busy = false; }
        };
        const timer = setInterval(push, 2000);
        streams.add(res);
        req.on('close', () => { clearInterval(timer); streams.delete(res); });
        await push(); return;
      }
      const assets = {
        '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css',
        '/office': 'office.html', '/office/': 'office.html', '/office.html': 'office.html',
        '/office.js': 'office.js', '/office.css': 'office.css', '/office-model.mjs': 'office-model.mjs', '/office-scene.svg': 'office-scene.svg',
        '/office/office.js': 'office.js', '/office/office.css': 'office.css', '/office/office-model.mjs': 'office-model.mjs', '/office/office-scene.svg': 'office-scene.svg',
      };
      const asset = assets[url.pathname];
      if (!asset) { res.writeHead(404); res.end('Not found'); return; }
      const file = resolve(WEB, asset);
      res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
      if (req.method === 'HEAD') { res.end(); return; }
      res.end(await readFile(file));
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ error: 'Local data unavailable. Check data folder permissions.' }));
    }
  });
  server.closeStreams = () => { for (const res of streams) res.end(); streams.clear(); };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = serverPort();
  await prepareHome();
  const demo = process.argv.includes('--demo');
  const server = makeServer({ port, demo });
  server.on('error', e => { process.stderr.write(`Agent Observatory: ${e.code === 'EADDRINUSE' ? `port ${port} is in use` : e.message}\n`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Agent Observatory: http://127.0.0.1:${port}/${demo ? '?demo=1' : ''}\n${demo ? 'DEMO — sample data only' : 'LIVE — waiting for Claude Code hook events'}\n`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.closeStreams(); server.close(); });
}

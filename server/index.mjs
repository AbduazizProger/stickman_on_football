// Room relay + static server. Host screen and phone pads talk through here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 3001);
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function lanIps() {
  if (process.env.LAN_IP) return [process.env.LAN_IP];
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const priv = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address);
      out.push({ ip: i.address, score: (priv ? 10 : 0) + (/^(en|wl|eth)/.test(name) ? 5 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((o) => o.ip);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ips: lanIps() }));
  }
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('Run `npm run build` first, or use `npm run dev`.');
  }
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

/** @type {Map<string, {host: any, pads: any[], gone: any}>} */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.t === 'host') {
      let room = m.room && rooms.get(m.room) ? m.room : null;
      if (!room) { room = newCode(); rooms.set(room, { host: null, pads: [null, null], gone: null }); }
      const r = rooms.get(room);
      clearTimeout(r.gone);
      if (r.host && r.host !== ws) r.host.close();
      r.host = ws; ws.role = 'host'; ws.room = room;
      send(ws, { t: 'room', room, ips: lanIps() });
      r.pads.forEach((p, slot) => p && send(ws, { t: 'pad-join', slot }));
      return;
    }

    if (m.t === 'join') {
      const r = rooms.get(m.room);
      const slot = m.slot === 1 ? 1 : 0;
      if (!r || !r.host) return send(ws, { t: 'error', msg: 'Room not found. Scan the QR code again.' });
      if (r.pads[slot] && r.pads[slot] !== ws) r.pads[slot].close();
      r.pads[slot] = ws; ws.role = 'pad'; ws.room = m.room; ws.slot = slot;
      send(ws, { t: 'joined', slot });
      send(r.host, { t: 'pad-join', slot });
      return;
    }

    const r = rooms.get(ws.room);
    if (!r) return;
    if (ws.role === 'pad') send(r.host, { t: 'pad', slot: ws.slot, m });
    else if (ws.role === 'host' && m.t === 'to') send(r.pads[m.slot], m.m);
  });

  ws.on('close', () => {
    const r = rooms.get(ws.room);
    if (!r) return;
    if (ws.role === 'pad' && r.pads[ws.slot] === ws) {
      r.pads[ws.slot] = null;
      send(r.host, { t: 'pad-leave', slot: ws.slot });
    } else if (ws.role === 'host' && r.host === ws) {
      r.host = null;
      r.pads.forEach((p) => p && send(p, { t: 'error', msg: 'Host screen disconnected.' }));
      r.gone = setTimeout(() => rooms.delete(ws.room), 60_000);
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 10_000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Relay listening on :${PORT}  (LAN: ${lanIps().join(', ') || 'none'})`);
});

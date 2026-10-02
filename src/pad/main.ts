// Phone controller (PlayStation / FIFA layout): floating stick + face buttons + shoulders, sends input to the host screen.
import { BTN, KITS, type HostMsg, type PadCtx, type PadMsg } from '../shared/protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);
const room = (q.get('room') || '').toUpperCase();
const slot = q.get('slot') === '1' ? 1 : 0;
const accent = slot === 0 ? '#2ee6ff' : '#ffb02e';
document.documentElement.style.setProperty('--c', accent);
$('who').textContent = `PLAYER ${slot + 1}`;

type UiMsg = Extract<HostMsg, { t: 'ui' }>;
let ws: WebSocket | null = null;
let joined = false;
let phase: UiMsg['phase'] = 'lobby';
let ctx: PadCtx = 'none';
let ready = false;
let kit = slot;
let helpOpen = false;

// ---------------------------------------------------------------- network
function send(m: PadMsg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  if (!room) { show('status', 'No room — scan the QR code on the big screen'); return; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws!.send(JSON.stringify({ t: 'join', room, slot }));
  ws.onmessage = (ev) => {
    let m: HostMsg; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'joined') { joined = true; wake(); }
    else if (m.t === 'error') { joined = false; show('status', m.msg); }
    else if (m.t === 'vib') navigator.vibrate?.(m.p as any);
    else if (m.t === 'ui') applyUi(m);
  };
  ws.onclose = () => { joined = false; show('status', 'Reconnecting…'); setTimeout(connect, 800); };
}

function show(which: 'status' | 'lobby' | 'game' | 'overlay', text?: string) {
  $('status').hidden = which !== 'status';
  $('lobby').hidden = which !== 'lobby';
  $('game').hidden = which !== 'game' && which !== 'overlay';
  $('overlay').hidden = which !== 'overlay';
  if (text) $('statustext').textContent = text;
}

function applyUi(m: UiMsg) {
  const prev = phase;
  phase = m.phase; ctx = m.ctx; ready = m.ready; kit = m.kit;
  drawKit();
  if (phase === 'lobby') show('lobby');
  else if (phase === 'paused') overlay('PAUSED', [['RESUME', () => send({ t: 'cmd', c: 'resume' })], ['MENU', () => send({ t: 'cmd', c: 'menu' }), true]]);
  else if (phase === 'end') overlay('FULL TIME', [['REMATCH', () => send({ t: 'cmd', c: 'rematch' })], ['MENU', () => send({ t: 'cmd', c: 'menu' }), true]]);
  else show('game');
  if (phase !== prev && phase !== 'lobby') releaseAll();
  labels();
}

function overlay(title: string, btns: [string, () => void, boolean?][]) {
  show('overlay'); $('game').hidden = true;
  $('ovtitle').textContent = title;
  const box = $('ovbtns'); box.innerHTML = '';
  for (const [t, fn, alt] of btns) {
    const b = document.createElement('button'); b.textContent = t; if (alt) b.className = 'alt';
    b.onclick = fn; box.appendChild(b);
  }
}

// ------------------------------------------------------- context labels
type Labels = { X: string; S: string; O: string; T: string; L1: string; R1: string; L2: string; R2: string; title: string; hot?: boolean };
const BASE_ATK: Labels = { X: 'PASS', S: 'SHOOT', O: 'LOB', T: 'THROUGH', L1: 'CHIP', R1: 'FINESSE', L2: 'SHIELD', R2: 'SPRINT', title: 'attacking' };
const LABELS: Record<PadCtx, Labels> = {
  atk: BASE_ATK,
  cross: { ...BASE_ATK, O: 'CROSS', title: 'cross: ○ ○○ ○○○' },
  recv: { ...BASE_ATK, X: '1-TIME PASS', S: '1-TIME SHOT', O: '1-TIME LOB', T: '1-TIME THRU', title: 'first time' },
  air: { ...BASE_ATK, X: 'HEAD PASS', S: 'HEADER', O: 'CLEAR', T: 'FLICK ON', title: 'header!', hot: true },
  def: { X: 'CONTAIN', S: 'SLIDE', O: 'TACKLE', T: 'GK RUSH', L1: 'SWITCH', R1: 'TEAM PRESS', L2: 'JOCKEY', R2: 'SPRINT', title: 'defending' },
  set: { ...BASE_ATK, O: 'LOB / CROSS', title: 'set piece' },
  pen: { X: '—', S: 'SHOOT', O: '—', T: '—', L1: 'CHIP', R1: 'PLACED', L2: '—', R2: '—', title: 'penalty: aim + hold □', hot: true },
  gk: { X: 'DIVE', S: 'DIVE', O: 'DIVE', T: 'DIVE', L1: '—', R1: '—', L2: '—', R2: '—', title: 'keeper: stick + button', hot: true },
  none: { X: '', S: '', O: '', T: '', L1: '', R1: '', L2: '', R2: '', title: '' },
};
function labels() {
  const L = LABELS[ctx] || LABELS.none;
  $('lX').textContent = L.X; $('lS').textContent = L.S; $('lO').textContent = L.O; $('lT').textContent = L.T;
  $('lL1').textContent = L.L1; $('lR1').textContent = L.R1; $('lL2').textContent = L.L2; $('lR2').textContent = L.R2;
  const t = $('ctxlabel'); t.textContent = L.title; t.classList.toggle('hot', !!L.hot);
}

// ------------------------------------------------------------------ lobby
function drawKit() {
  const k = KITS[kit] || KITS[0];
  const el = $('shirt');
  let bg = k.shirt;
  if (k.pattern === 'stripes') bg = `repeating-linear-gradient(90deg, ${k.shirt} 0 14px, ${k.shirt2} 14px 28px)`;
  else if (k.pattern === 'hoops') bg = `repeating-linear-gradient(0deg, ${k.shirt} 0 14px, ${k.shirt2} 14px 28px)`;
  else if (k.pattern === 'half') bg = `linear-gradient(90deg, ${k.shirt} 50%, ${k.shirt2} 50%)`;
  else if (k.pattern === 'sash') bg = `linear-gradient(120deg, ${k.shirt} 38%, ${k.shirt2} 38% 62%, ${k.shirt} 62%)`;
  el.style.background = bg;
  el.style.boxShadow = `inset 0 -26px 0 ${k.shorts}`;
  $('kitname').textContent = k.name;
  const r = $('ready'); r.textContent = ready ? 'READY ✓' : "I'M READY"; r.classList.toggle('on', ready);
}
$('prev').onclick = () => send({ t: 'kit', d: -1 });
$('next').onclick = () => send({ t: 'kit', d: 1 });
$('ready').onclick = () => { ready = !ready; send({ t: 'ready', v: ready }); drawKit(); };
$('menu').onclick = () => send({ t: 'cmd', c: 'pause' });

// ------------------------------------------------------------------- help
let edgeSprint = true;
try { edgeSprint = localStorage.getItem('edgeSprint') !== '0'; } catch { /* ignore */ }
const edgeBox = $<HTMLInputElement>('edgesprint');
edgeBox.checked = edgeSprint;
edgeBox.onchange = () => { edgeSprint = edgeBox.checked; try { localStorage.setItem('edgeSprint', edgeSprint ? '1' : '0'); } catch { /* ignore */ } };
const openHelp = () => { helpOpen = true; $('help').hidden = false; releaseAll(); };
$('help1').onclick = openHelp;
$('help2').onclick = openHelp;
$('closehelp').onclick = () => { helpOpen = false; $('help').hidden = true; };

// --------------------------------------------------------------- controls
let sx = 0, sy = 0, bits = 0, stickSprint = false;
let lastSent = '', lastT = 0;
const R = 62, SPRINT_R = R * 1.32;

const zone = $('stickzone'), base = $('stickbase'), knob = $('stickknob');
let stickId = -1, ox = 0, oy = 0;
zone.addEventListener('pointerdown', (e) => {
  if (stickId !== -1) return;
  stickId = e.pointerId; zone.setPointerCapture(e.pointerId);
  const r = zone.getBoundingClientRect();
  ox = e.clientX - r.left; oy = e.clientY - r.top;
  base.style.left = ox + 'px'; base.style.top = oy + 'px'; base.classList.add('show');
  moveStick(e);
});
zone.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
const endStick = (e: PointerEvent) => {
  if (e.pointerId !== stickId) return;
  stickId = -1; sx = sy = 0; stickSprint = false;
  base.classList.remove('show', 'sprint'); knob.style.transform = '';
  flush(true);
};
zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);
function moveStick(e: PointerEvent) {
  const r = zone.getBoundingClientRect();
  let dx = e.clientX - r.left - ox, dy = e.clientY - r.top - oy;
  const d = Math.hypot(dx, dy);
  const wasSprint = stickSprint;
  stickSprint = edgeSprint && d > SPRINT_R;
  if (stickSprint !== wasSprint) { base.classList.toggle('sprint', stickSprint); if (stickSprint) navigator.vibrate?.(6); }
  const lim = edgeSprint ? SPRINT_R + 6 : R;
  if (d > lim) { dx *= lim / d; dy *= lim / d; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  const k = Math.min(Math.hypot(dx, dy), R) / (Math.hypot(dx, dy) || 1);
  sx = (dx * k / R) * 100; sy = (dy * k / R) * 100;
}

document.querySelectorAll<HTMLElement>('.b').forEach((btn) => {
  const bit = Number(btn.dataset.bit);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); btn.setPointerCapture(e.pointerId);
    bits |= bit; btn.classList.add('down'); navigator.vibrate?.(8); flush(true);
  });
  const up = () => { if (bits & bit) { bits &= ~bit; btn.classList.remove('down'); flush(true); } };
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
});
function releaseAll() {
  bits = 0; sx = sy = 0; stickId = -1; stickSprint = false; base.classList.remove('show', 'sprint');
  document.querySelectorAll('.b.down').forEach((b) => b.classList.remove('down'));
  flush(true);
}

function flush(force = false) {
  if (!joined || phase === 'lobby') return;
  const now = performance.now();
  const b = helpOpen ? 0 : bits | (stickSprint ? BTN.SPRINT : 0);
  const key = `${Math.round(sx)},${Math.round(sy)},${b}`;
  if (!force && key === lastSent && now - lastT < 120) return;
  if (!force && now - lastT < 14) return;
  lastSent = key; lastT = now;
  send({ t: 'in', x: helpOpen ? 0 : Math.round(sx), y: helpOpen ? 0 : Math.round(sy), b });
}
setInterval(() => flush(), 16);

// --------------------------------------------------------------- niceties
async function wake() {
  try { await (navigator as any).wakeLock?.request('screen'); } catch { /* not available */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('pointerdown', () => {
  const el: any = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => (screen.orientation as any)?.lock?.('landscape')).catch(() => {});
}, { once: true });

connect();
drawKit();
labels();

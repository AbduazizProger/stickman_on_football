// Host screen: wires the simulation, renderer, UI, audio and the phone controllers together.
import { BTN, FRAME, KITS, type HostMsg, type Kit, type PadMsg } from '../shared/protocol';
import { DT, Game, HL, type Human } from './sim';
import { View3D } from './render';
import type { CamInput, CamStyle } from './camera';
import { HostNet } from './net';
import { Sfx } from './audio';
import { UI, type Settings } from './ui';

const game = new Game();
const view = new View3D(document.getElementById('view')!);
const ui = new UI();
const sfx = new Sfx();
const net = new HostNet();

const settings: Settings = { size: 11, half: 120, level: 0.75, replay: true, cam: 'tele', pens: true };
const opts = () => ({ size: settings.size, halfLen: settings.half, level: settings.level, replay: settings.replay, pens: settings.pens });
let phase: 'lobby' | 'match' | 'end' = 'lobby';
let paused = false;
let pausedFor = -1; // slot whose controller dropped (auto-resume on reconnect), -1 = manual
let kits: [Kit, Kit] = [KITS[0], KITS[1]];
let goalExcite = 0;
let replay: { data: Float32Array; pos: number; n: number } | null = null;
let base = location.origin;

// ------------------------------------------------------------ setup helpers
function resolveKits() {
  const k: [number, number] = [game.humanActive(0) || game.humans[0].connected ? game.humans[0].kit : -1, game.humanActive(1) || game.humans[1].connected ? game.humans[1].kit : -1];
  if (k[0] < 0) k[0] = KITS.findIndex((_, i) => i !== k[1] && i !== (k[1] < 0 ? 1 : k[1]));
  if (k[1] < 0) k[1] = KITS.findIndex((_, i) => i !== k[0]);
  if (k[0] === k[1]) k[1] = (k[0] + 1) % KITS.length;
  kits = [KITS[k[0]], KITS[k[1]]];
}
function applyKits() {
  resolveKits();
  view.setTeams(kits, game.players);
  ui.teams(kits[0], kits[1]);
  for (let s = 0; s < 2; s++) ui.lobbyCard(s, { connected: game.humans[s].connected, kb: game.humans[s].kb, ready: game.humans[s].ready, kit: kits[s] });
}
function rebuild() {
  game.setup(opts());
  applyKits();
}
function toLobby() {
  phase = 'lobby'; paused = false; game.paused = false; replay = null; goalExcite = 0;
  game.toIdle(); game.humans.forEach((h) => { h.ready = false; h.kb = false; h.b = 0; h.x = h.y = 0; });
  ui.hideEnd(); ui.pause(false); ui.showHud(false); ui.replayTag(false); ui.showLobby(true);
  applyKits();
}
function startMatch() {
  if (phase !== 'lobby') return;
  phase = 'match';
  ui.showLobby(false); ui.showHud(true); ui.hideEnd();
  applyKits();
  view.director.coop = game.humans.filter((h) => h.connected || h.kb).length > 1;
  game.startMatch();
  ui.banner('KICK OFF', `${kits[0].name} vs ${kits[1].name}`, 2200);
  sfx.enable(); ui.setSound(true);
}
function rematch() {
  ui.hideEnd(); phase = 'match'; goalExcite = 0;
  game.setup(opts());
  view.setTeams(kits, game.players);
  game.startMatch();
  ui.banner('KICK OFF', '', 1800);
}
function checkAutoStart() {
  if (phase !== 'lobby') return;
  const conn = game.humans.filter((h) => h.connected);
  if (conn.length > 0 && conn.every((h) => h.ready)) startMatch();
}

// ----------------------------------------------------------------- input
function setInput(h: Human, x: number, y: number, b: number) {
  const old = h.b;
  h.pressed |= b & ~old; h.released |= old & ~b;
  h.b = b; h.x = x; h.y = y;
}

net.onRoom = (room, ips) => {
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  base = local && ips[0] ? `${location.protocol}//${ips[0]}${location.port ? ':' + location.port : ''}` : location.origin;
  void ui.setRoom(room, base);
};
net.onJoin = (slot) => {
  const h = game.humans[slot];
  h.connected = true; h.kb = false; h.ready = false; h.b = 0; h.x = h.y = 0;
  if (phase === 'lobby') applyKits();
  if (paused && pausedFor === slot) setPause(false);
  pushPad(slot, true);
};
net.onLeave = (slot) => {
  const h = game.humans[slot];
  h.connected = false; h.ready = false; h.b = 0; h.x = h.y = 0; h.released = h.pressed = 0;
  if (phase === 'lobby') applyKits();
  else if (phase === 'match') { pausedFor = slot; setPause(true, `Player ${slot + 1} disconnected — scan the code to reconnect`, [slot]); }
};
net.onPad = (slot, m: PadMsg) => {
  const h = game.humans[slot];
  switch (m.t) {
    case 'in': h.seen = performance.now(); setInput(h, m.x, m.y, m.b); break;
    case 'kit':
      if (phase !== 'lobby') break;
      { // skip the kit the other player holds
        let k = h.kit; const other = game.humans[1 - slot];
        for (let i = 0; i < KITS.length; i++) { k = (k + m.d + KITS.length) % KITS.length; if (!(other.connected && other.kit === k)) break; }
        h.kit = k; applyKits();
      }
      break;
    case 'ready': if (phase === 'lobby') { h.ready = m.v; applyKits(); checkAutoStart(); } break;
    case 'cmd':
      if (m.c === 'pause' && phase === 'match') { pausedFor = -1; setPause(true, 'Resume from a phone, or press Esc'); }
      else if (m.c === 'resume' && paused && pausedFor === -1) setPause(false);
      else if (m.c === 'rematch' && phase === 'end') rematch();
      else if (m.c === 'menu' && (phase === 'end' || paused)) toLobby();
      break;
  }
};
net.onStatus = (on) => { if (!on) document.getElementById('roomcode')!.textContent = '----'; };

function setPause(v: boolean, msg = '', slots: number[] = []) {
  paused = v; game.paused = v;
  void ui.pause(v, msg, slots);
}

// keyboard fallback for player 1 (also handy for testing without a phone)
const keys = new Set<string>();
// ✕ J · □ K · ○ L · △ I · R2 Shift · L1 Q/U · R1 E/O · L2 Space
const KEYMAP: Record<string, number> = {
  KeyJ: BTN.PASS, KeyK: BTN.SHOOT, KeyL: BTN.LOB, KeyI: BTN.THROUGH, ShiftLeft: BTN.SPRINT, ShiftRight: BTN.SPRINT,
  KeyQ: BTN.SWITCH, KeyU: BTN.SWITCH, KeyE: BTN.R1, KeyO: BTN.R1, Space: BTN.L2,
};
const MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
function syncKeyboard() {
  const h = game.humans[0];
  if (h.connected) return;
  const ky = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0), kx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const l = Math.hypot(kx, ky) || 1;
  let b = 0; for (const k of keys) b |= KEYMAP[k] || 0;
  setInput(h, (kx / l) * 100, (ky / l) * 100, b);
}
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  sfx.enable(); ui.setSound(true);
  if (e.code === 'Enter') {
    if (phase === 'lobby') startMatch();
    else if (phase === 'end') rematch();
    else if (game.mode === 'replay') { replay = null; game.endReplay(); ui.replayTag(false); }
    return;
  }
  if (e.code === 'Escape') { if (phase === 'match') { if (paused) setPause(false); else { pausedFor = -1; setPause(true, 'Press Esc to resume'); } } return; }
  if (e.code === 'KeyM' && (phase === 'end' || paused)) { toLobby(); return; }
  if (e.code === 'KeyC') { cycleCamera(); return; }
  if (game.mode === 'replay' && KEYMAP[e.code]) { replay = null; game.endReplay(); ui.replayTag(false); return; }
  if (KEYMAP[e.code] || MOVE.includes(e.code)) {
    e.preventDefault(); keys.add(e.code);
    if (phase === 'match' && !game.humans[0].connected) game.humans[0].kb = true;
    syncKeyboard();
  }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); syncKeyboard(); });
window.addEventListener('pointerdown', () => { sfx.enable(); ui.setSound(true); }, { once: true });

const CAMS: CamStyle[] = ['tele', 'broadcast', 'wide'];
function cycleCamera() {
  settings.cam = CAMS[(CAMS.indexOf(settings.cam) + 1) % CAMS.length];
  view.director.style = settings.cam;
  ui.setOptions(settings);
  if (phase !== 'lobby') ui.toast(`CAMERA: ${settings.cam.toUpperCase()}`);
}

ui.onStart = startMatch;
ui.onSound = () => { sfx.enable(); ui.setSound(true); };
ui.onOption = (key, v) => {
  if (phase !== 'lobby') return;
  if (key === 'size') settings.size = Number(v) as 7 | 11;
  if (key === 'half') settings.half = Number(v);
  if (key === 'level') settings.level = Number(v);
  if (key === 'replay') settings.replay = v === '1';
  if (key === 'pens') settings.pens = v === '1';
  if (key === 'cam') { settings.cam = v as CamStyle; view.director.style = settings.cam; }
  ui.setOptions(settings);
  if (key === 'size') rebuild(); else game.opts = { ...game.opts, ...opts() };
};

// ------------------------------------------------------------ pad state
const lastPush: string[] = ['', ''];
function padPhase(): Extract<HostMsg, { t: 'ui' }>['phase'] {
  if (phase === 'lobby') return 'lobby';
  if (phase === 'end') return 'end';
  if (paused) return 'paused';
  if (game.mode === 'replay') return 'replay';
  if (game.mode === 'wait' || game.mode === 'dead' || game.mode === 'half') return 'wait';
  return 'play';
}
function padCtx(slot: number) { return game.humans[slot].ctx; }
function pushPad(slot: number, force = false) {
  const h = game.humans[slot];
  if (!h.connected) return;
  const m: HostMsg = { t: 'ui', phase: padPhase(), kit: h.kit, ready: h.ready, ctx: padCtx(slot) };
  const s = JSON.stringify(m);
  if (!force && s === lastPush[slot]) return;
  lastPush[slot] = s;
  net.to(slot, m);
}
function vib(slot: number, p: number | number[]) { if (game.humans[slot].connected) net.to(slot, { t: 'vib', p }); }

// ---------------------------------------------------------------- events
const SETPIECE: Record<string, string> = { corner: 'CORNER', throw: 'THROW-IN', goalkick: 'GOAL KICK', free: 'FREE KICK', penalty: 'PENALTY', kickoff: '' };
function handleEvents() {
  for (const e of game.events) {
    switch (e.t) {
      case 'kick': sfx.kick(e.power); if (e.power > 0.5 && e.kind === 'shoot') vib(e.team, 25); break;
      case 'bounce': sfx.bounce(e.v); break;
      case 'post': sfx.post(); vib(0, 40); vib(1, 40); ui.banner('OFF THE WOODWORK!', '', 900); break;
      case 'tackle': sfx.tackle(); if (e.victim !== undefined) vib(game.players[e.victim].team, 30); break;
      case 'save': sfx.save(); if (e.shot) ui.banner('SAVED!', '', 900); break;
      case 'whistle': sfx.whistle(); break;
      case 'whistle3': sfx.whistle(true); break;
      case 'foul':
        if (!e.advantage) ui.banner(e.penalty ? 'PENALTY!' : 'FOUL', `#${game.players[e.id].num} · ${kits[e.team].name}`, 1400);
        vib(game.players[e.id].team, 60); vib(game.players[e.victim].team, 60); break;
      case 'advantage': ui.toast('ADVANTAGE', 1800); sfx.whistle(); break;
      case 'advback': ui.toast('ADVANTAGE OVER — FREE KICK'); break;
      case 'card': {
        const p = game.players[e.id];
        const title = e.color === 'red' ? (e.second ? 'SECOND YELLOW' : 'RED CARD') : 'YELLOW CARD';
        ui.banner(title, `#${p.num} · ${kits[e.team].name}${e.color === 'red' ? ' — SENT OFF' : ''}`, 2600, e.color === 'red' ? 'red' : 'yellow');
        vib(e.team, e.color === 'red' ? [200, 80, 200] : 120);
        break;
      }
      case 'shootout': ui.banner('PENALTY SHOOTOUT', `${kits[e.first].name} to shoot first`, 3000); break;
      case 'pen': ui.banner(e.scored ? 'SCORED!' : 'MISSED!', kits[e.team].name, 1600); if (e.scored) { sfx.goal(); goalExcite = 0.8; setTimeout(() => (goalExcite = 0.3), 1800); } break;
      case 'setpiece': if (SETPIECE[e.type] && !game.so) ui.banner(SETPIECE[e.type], '', 1200); break;
      case 'offside': ui.banner('OFFSIDE', `#${game.players[e.id].num} · ${kits[e.team].name}`, 1500); vib(e.team, 50); break;
      case 'head': if (e.kind === 'shoot') vib(game.players[e.id].team, 20); sfx.kick(0.3); break;
      case 'goal': {
        sfx.goal(); goalExcite = 1; setTimeout(() => (goalExcite = 0.3), 5000);
        view.netPulse(e.side, e.z, e.y);
        const sc = e.scorer >= 0 ? game.players[e.scorer] : null;
        ui.banner(e.own ? 'OWN GOAL!' : 'GOAL!', sc ? `#${sc.num} · ${kits[e.team].name}` : kits[e.team].name, 3000);
        vib(e.team, [120, 60, 120, 60, 300]); vib(1 - e.team, 400);
        break;
      }
      case 'half': ui.banner('HALF TIME', `${game.score[0]} – ${game.score[1]}`, 3800); break;
      case 'full': phase = 'end'; ui.end(game, kits); break;
    }
  }
  game.events.length = 0;
}

// ------------------------------------------------------------------ loop
let last = performance.now(), acc = 0, hudT = 0, exciteT = 0, lastEx = -1;
const camIn: CamInput = { mode: 'lobby', bx: 0, by: 0, bz: 0, bvx: 0, bvz: 0, attackDir: 0, humans: [], setX: 0, setZ: 0, setDir: 1, celebX: 0, celebZ: 0, replayFrac: 0 };

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;

  let prev: Float32Array = game.prevFrame, cur: Float32Array = game.curFrame, alpha = 1;
  if (phase === 'match' && !paused) {
    if (game.mode === 'replay') {
      if (!replay) {
        const data = game.exportReplay();
        replay = { data, pos: 0, n: data.length / game.frameLen };
        ui.replayTag(true);
      }
      if (game.humans.some((h) => h.pressed)) { replay.pos = replay.n; }
      game.humans.forEach((h) => { h.pressed = h.released = 0; });
      const frac = replay.pos / replay.n;
      replay.pos += dt * 60 * (frac > 0.55 ? 0.4 : 0.8); // second angle in slow motion
      if (replay.pos >= replay.n - 1) { replay = null; ui.replayTag(false); game.endReplay(); }
      else {
        const i = Math.floor(replay.pos), fl = game.frameLen;
        prev = replay.data.subarray(i * fl, (i + 1) * fl); cur = replay.data.subarray((i + 1) * fl, (i + 2) * fl);
        alpha = replay.pos - i;
      }
    } else {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6) { game.step(); acc -= DT; n++; }
      if (n === 6) acc = 0;
      alpha = acc / DT;
      prev = game.prevFrame; cur = game.curFrame;
      handleEvents();
    }
  }

  // camera
  const c = camIn, r = game.restart, pen = game.pen;
  c.bx = cur[0]; c.by = cur[1]; c.bz = cur[2];
  c.bvx = (cur[0] - prev[0]) * 60; c.bvz = (cur[2] - prev[2]) * 60;
  const pt = game.possTeam();
  c.attackDir = pt === 0 || pt === 1 ? game.dir[pt] : 0;
  c.humans = game.humans.filter((h) => h.ctrl && (h.connected || h.kb)).map((h) => ({ x: h.ctrl!.x, z: h.ctrl!.z }));
  if (phase === 'lobby') c.mode = 'lobby';
  else if (phase === 'end' || game.mode === 'full') c.mode = 'end';
  else if (game.mode === 'replay') { c.mode = 'replay'; c.replayFrac = replay ? replay.pos / replay.n : 0; }
  else if (game.so || (pen && pen.phase !== 'done')) { c.mode = 'penalty'; c.setX = pen ? pen.d * (HL - 11) : HL - 11; c.setDir = pen ? pen.d : 1; }
  else if (game.mode === 'dead' && game.goalInfo) {
    c.mode = 'celebrate';
    const sc = game.goalInfo.scorer;
    if (sc) { const o = FRAME.HDR + sc.id * FRAME.P; c.celebX = cur[o]; c.celebZ = cur[o + 1]; }
    else { c.celebX = cur[0]; c.celebZ = cur[2]; }
  } else if (game.mode === 'wait' && r && r.type === 'corner') { c.mode = 'corner'; c.setX = r.x; c.setZ = r.z; }
  else if (game.mode === 'wait' && r && r.type === 'free' && Math.hypot(game.dir[r.team] * HL - r.x, r.z) < 34) {
    c.mode = 'freekick'; c.setX = r.x; c.setZ = r.z; c.setDir = game.dir[r.team];
  } else c.mode = 'play';

  const cut = c.mode === 'penalty' || c.mode === 'corner' || c.mode === 'freekick';
  ui.cutscene(cut);
  view.hideMarkers = c.mode === 'penalty';
  const bx = Math.abs(cur[0]);
  const excite = Math.max(goalExcite, phase === 'lobby' ? 0.1 : 0.12 + Math.max(0, (bx - (HL - 28)) / 28) * 0.35);
  view.update(prev, cur, alpha, dt, camIn, excite);

  exciteT += dt;
  if (exciteT > 0.25) { exciteT = 0; if (Math.abs(excite - lastEx) > 0.03) { sfx.setExcite(excite); lastEx = excite; } }

  hudT += dt;
  if (hudT > 0.05) {
    hudT = 0;
    if (phase !== 'lobby') ui.hud(game, cur, kits);
    pushPad(0); pushPad(1);
  }
  // stale input guard: if a phone goes silent for a while, release its controls
  for (const h of game.humans) if (h.connected && h.b && now - h.seen > 1500) setInput(h, 0, 0, 0);
}

// -------------------------------------------------------------------- go
ui.setOptions(settings);
rebuild();
net.connect();
requestAnimationFrame(frame);
(window as any).__game = game; (window as any).__view = view; (window as any).__cam = camIn; // handy for debugging in the console

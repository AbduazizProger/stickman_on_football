// DOM overlays: lobby (QR codes, kit status, options), HUD, banners, pause/end screens.
import QRCode from 'qrcode';
import { ACT, FRAME, type Kit } from '../shared/protocol';
import { HL, HW, PEN_D, PEN_HW, type Game } from './sim';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface LobbySlot { connected: boolean; kb: boolean; ready: boolean; kit: Kit }
export interface Settings { size: 7 | 11; half: number; level: number; replay: boolean; cam: 'tele' | 'broadcast' | 'wide'; pens: boolean }

export class UI {
  onOption: (key: string, value: string) => void = () => {};
  onStart: () => void = () => {};
  onSound: () => void = () => {};
  private bannerT = 0;
  private qrUrls: string[] = ['', ''];

  constructor() {
    document.querySelectorAll<HTMLElement>('.opt').forEach((opt) => {
      opt.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.onOption(opt.dataset.key!, b.dataset.v!)));
    });
    $('startbtn').addEventListener('click', () => this.onStart());
    $('soundbtn').addEventListener('click', () => this.onSound());
  }

  setOptions(s: Settings) {
    const cur: Record<string, string> = { size: String(s.size), half: String(s.half), level: String(s.level), replay: s.replay ? '1' : '0', cam: s.cam, pens: s.pens ? '1' : '0' };
    document.querySelectorAll<HTMLElement>('.opt').forEach((opt) => {
      opt.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.v === cur[opt.dataset.key!]));
    });
  }

  setSound(on: boolean) { $('soundbtn').textContent = on ? '🔊 Sound on' : '🔊 Enable sound'; }

  async setRoom(room: string, base: string) {
    $('roomcode').textContent = room;
    $('urlhint').textContent = base.replace(/^https?:\/\//, '') + '/pad.html';
    for (let s = 0; s < 2; s++) {
      const url = `${base}/pad.html?room=${room}&slot=${s}`;
      this.qrUrls[s] = url;
      const canvas = document.querySelector<HTMLCanvasElement>(`#card${s} .qr`)!;
      await QRCode.toCanvas(canvas, url, { width: 190, margin: 1, color: { dark: '#0a1020', light: '#ffffff' } });
    }
  }

  lobbyCard(slot: number, s: LobbySlot) {
    const card = $('card' + slot);
    const on = s.connected || s.kb;
    card.classList.toggle('on', on);
    (card.querySelector('.state') as HTMLElement).textContent = !on ? 'Scan to join…' : s.kb && !s.connected ? 'Keyboard player' : s.ready ? 'Connected · READY ✓' : 'Connected · picking kit…';
    (card.querySelector('.sw') as HTMLElement).style.background = `linear-gradient(90deg, ${s.kit.shirt} 50%, ${s.kit.shorts} 50%)`;
    (card.querySelector('.kn') as HTMLElement).textContent = s.kit.name.toUpperCase();
  }

  showLobby(v: boolean) { $('lobby').hidden = !v; }
  showHud(v: boolean) { $('hud').hidden = !v; }
  /** radar + stamina boxes are hidden during set-piece cut-scenes, like FIFA */
  cutscene(v: boolean) { $('hud').classList.toggle('cut', v); }
  replayTag(v: boolean) { $('replaytag').hidden = !v; }

  teams(k0: Kit, k1: Kit) {
    $('tn0').textContent = k0.short; $('tn0').style.background = k0.shirt; $('tn0').style.color = lum(k0.shirt) > 0.6 ? '#111' : '#fff';
    $('tn1').textContent = k1.short; $('tn1').style.background = k1.shirt; $('tn1').style.color = lum(k1.shirt) > 0.6 ? '#111' : '#fff';
  }

  banner(title: string, sub = '', ms = 1800, card: '' | 'yellow' | 'red' = '') {
    const el = $('banner');
    el.querySelector('h1')!.textContent = title; el.querySelector('p')!.textContent = sub;
    el.classList.remove('card-yellow', 'card-red');
    if (card) el.classList.add('card-' + card);
    el.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  private toastT = 0;
  toast(text: string, ms = 1400) {
    const el = $('toast'); el.textContent = text; el.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  hud(g: Game, frame: Float32Array, kits: [Kit, Kit]) {
    for (let t = 0; t < 2; t++) $('rc' + t).innerHTML = '<i></i>'.repeat(g.stats.red[t]);
    const so = g.so;
    $('so').hidden = !so;
    if (so) {
      for (let t = 0; t < 2; t++) {
        const n = $('son' + t); n.textContent = kits[t].short; n.style.background = kits[t].shirt; n.style.color = lum(kits[t].shirt) > 0.6 ? '#111' : '#fff';
        const r = so.res[t], shown = Math.max(5, r.length, so.res[1 - t].length);
        let html = '';
        for (let i = 0; i < shown; i++) html += i < r.length ? `<i class="${r[i] ? 'g' : 'm'}"></i>` : '<i></i>';
        $('sod' + t).innerHTML = html;
      }
    }
    $('s0').textContent = String(g.score[0]); $('s1').textContent = String(g.score[1]);
    $('clock').textContent = g.clockText();
    $('halflbl').textContent = g.half === 1 ? '1ST HALF' : '2ND HALF';
    for (let s = 0; s < 2; s++) {
      const h = g.humans[s];
      const box = $('pbox' + s);
      box.style.display = g.humanActive(s) ? 'flex' : 'none';
      if (h.ctrl) ($('stam' + s) as HTMLElement).style.width = `${Math.round(h.ctrl.stamina * 100)}%`;
    }
    this.radar(g, frame, kits);
  }

  private radar(g: Game, f: Float32Array, kits: [Kit, Kit]) {
    const c = $<HTMLCanvasElement>('radar'), x = c.getContext('2d')!;
    const W = c.width, H = c.height, pad = 10;
    const sx = (W - pad * 2) / (HL * 2), sz = (H - pad * 2) / (HW * 2);
    x.clearRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = 1;
    x.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    x.beginPath(); x.moveTo(W / 2, pad); x.lineTo(W / 2, H - pad); x.stroke();
    x.beginPath(); x.arc(W / 2, H / 2, 9.15 * sx, 0, 7); x.stroke();
    for (const s of [-1, 1]) x.strokeRect(s < 0 ? pad : W - pad - PEN_D * sx, H / 2 - PEN_HW * sz, PEN_D * sx, PEN_HW * 2 * sz);
    let o = FRAME.HDR;
    for (const p of g.players) {
      if (f[o + 5] === ACT.OFF) { o += FRAME.P; continue; }
      const px = pad + (f[o] + HL) * sx, pz = pad + (f[o + 1] + HW) * sz;
      x.fillStyle = p.gk ? '#9aa' : kits[p.team].shirt;
      x.strokeStyle = '#000'; x.beginPath(); x.arc(px, pz, 4, 0, 7); x.fill(); x.stroke();
      if (f[o + 9] > 0 && f[o + 9] < 3) { x.strokeStyle = f[o + 9] === 1 ? '#2ee6ff' : '#ffb02e'; x.lineWidth = 2; x.beginPath(); x.arc(px, pz, 7, 0, 7); x.stroke(); x.lineWidth = 1; }
      o += FRAME.P;
    }
    x.fillStyle = '#fff'; x.beginPath(); x.arc(pad + (f[0] + HL) * sx, pad + (f[2] + HW) * sz, 3, 0, 7); x.fill();
  }

  async pause(show: boolean, msg = '', reconnectSlots: number[] = []) {
    $('pause').hidden = !show;
    if (!show) return;
    $('pausemsg').textContent = msg;
    const box = $('reconnect'); box.innerHTML = '';
    for (const s of reconnectSlots) {
      const d = document.createElement('div'); d.className = 'card';
      d.innerHTML = `<h2 style="color:var(${s === 0 ? '--p1' : '--p2'})">PLAYER ${s + 1}</h2>`;
      const cv = document.createElement('canvas'); cv.className = 'qr'; cv.width = 190; cv.height = 190; d.appendChild(cv);
      box.appendChild(d);
      await QRCode.toCanvas(cv, this.qrUrls[s], { width: 190, margin: 1 });
    }
  }

  end(g: Game, kits: [Kit, Kit]) {
    const [a, b] = g.score;
    const so = g.so;
    const pa = so ? so.res[0].reduce((s, x) => s + x, 0) : 0, pb = so ? so.res[1].reduce((s, x) => s + x, 0) : 0;
    const winner = so && so.winner >= 0 ? so.winner : a === b ? -1 : a > b ? 0 : 1;
    $('endtitle').textContent = winner < 0 ? 'DRAW' : `${kits[winner].name.toUpperCase()} WIN${so ? ' ON PENALTIES' : ''}`;
    $('e-n0').textContent = kits[0].short; $('e-n1').textContent = kits[1].short;
    $('e-s0').textContent = so ? `${a} (${pa})` : String(a); $('e-s1').textContent = so ? `${b} (${pb})` : String(b);
    const st = g.stats, tp = st.poss[0] + st.poss[1] || 1;
    const rows: [string, string, string][] = [
      [String(st.shots[0]), 'Shots', String(st.shots[1])],
      [String(st.onTarget[0]), 'On target', String(st.onTarget[1])],
      [`${Math.round((st.poss[0] / tp) * 100)}%`, 'Possession', `${Math.round((st.poss[1] / tp) * 100)}%`],
      [String(st.corners[0]), 'Corners', String(st.corners[1])],
      [String(st.fouls[0]), 'Fouls', String(st.fouls[1])],
      [String(st.offsides[0]), 'Offsides', String(st.offsides[1])],
      [String(st.yellow[0]), 'Yellow cards', String(st.yellow[1])],
      [String(st.red[0]), 'Red cards', String(st.red[1])],
    ];
    $('stats').innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
    $('end').hidden = false;
  }
  hideEnd() { $('end').hidden = true; }
}

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

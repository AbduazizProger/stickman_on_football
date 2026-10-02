// Football simulation: pitch rules, ball physics, FIFA-style player control, discipline, penalties, referee.
// Pure TypeScript (no DOM / three.js) so it can be run headless for testing.
import { ACT, BTN, FRAME, type PadCtx } from '../shared/protocol';
import { aiPlayer, penaltyAim } from './ai';

export const HL = 50; // half pitch length (x)
export const HW = 31; // half pitch width (z)
export const GOAL_HW = 3.66;
export const GOAL_H = 2.44;
export const NET_D = 2.4;
export const BR = 0.2; // ball radius
export const G = 9.81;
export const PEN_D = 16.5;
export const PEN_HW = 20.16;
export const SPOT = 11;
export const CIRCLE = 9.15;
export const DT = 1 / 60;

export type Role = 'GK' | 'DEF' | 'MID' | 'FWD';
export type Mode = 'idle' | 'wait' | 'play' | 'dead' | 'replay' | 'half' | 'full';
export type KickKind = 'pass' | 'through' | 'lob' | 'shoot';
/** FIFA modifiers: R1 = driven/finesse, L1 = chip/lobbed, L1+R1 = power, double-tap = low, triple-tap ○ = ground cross. */
export type Mod = '' | 'driven' | 'finesse' | 'chip' | 'power' | 'low' | 'lobbed' | 'ground';

interface Form { role: Role; nx: number; nz: number; num: number }
export const FORMATIONS: Record<number, Form[]> = {
  7: [
    { role: 'GK', nx: -46, nz: 0, num: 1 },
    { role: 'DEF', nx: -28, nz: -12, num: 2 }, { role: 'DEF', nx: -28, nz: 12, num: 3 },
    { role: 'MID', nx: -9, nz: -19, num: 7 }, { role: 'MID', nx: -11, nz: 0, num: 8 }, { role: 'MID', nx: -9, nz: 19, num: 11 },
    { role: 'FWD', nx: 12, nz: 0, num: 9 },
  ],
  11: [
    { role: 'GK', nx: -46, nz: 0, num: 1 },
    { role: 'DEF', nx: -30, nz: -22, num: 3 }, { role: 'DEF', nx: -32, nz: -8, num: 5 },
    { role: 'DEF', nx: -32, nz: 8, num: 4 }, { role: 'DEF', nx: -30, nz: 22, num: 2 },
    { role: 'MID', nx: -12, nz: -24, num: 11 }, { role: 'MID', nx: -14, nz: -8, num: 8 },
    { role: 'MID', nx: -14, nz: 8, num: 6 }, { role: 'MID', nx: -12, nz: 24, num: 7 },
    { role: 'FWD', nx: 8, nz: -9, num: 10 }, { role: 'FWD', nx: 10, nz: 9, num: 9 },
  ],
};

export interface Player {
  id: number; team: 0 | 1; idx: number; role: Role; num: number; gk: boolean;
  x: number; z: number; vx: number; vz: number; face: number; phase: number;
  nx: number; nz: number; // formation home in attack-right coordinates
  stamina: number; spd: number; skill: number;
  act: number; actT: number; actDur: number; side: number;
  cool: number; thinkT: number; tackleCd: number; passCd: number;
  // desired movement (set by human input or AI each step)
  wx: number; wz: number; ws: number; sprint: boolean;
  /** speed multiplier for this step (jockey / shield / close control) */
  spdCap: number;
  /** angle to face this step instead of the running direction (NaN = none) */
  look: number;
  /** close control: shorter touches */
  tight: boolean;
  /** shielding the ball: harder to dispossess */
  shield: boolean;
  slx: number; slz: number; slideDone: boolean;
  holdT: number; aiDx: number; aiDz: number;
  diveHigh: boolean;
  /** discipline */
  yellow: number; off: boolean;
}

export interface Ball {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  spin: number; owner: Player | null; lastTouch: Player | null;
  target: number; targetT: number; shot: boolean;
  qx: number; qy: number; qz: number; qw: number;
}

/** An action the player asked for: waits a moment for extra taps, then fires (or stays buffered until the ball arrives). */
export interface Intent {
  kind: KickKind; bit: number; power: number; mods: number; taps: number;
  x: number; z: number; pid: number; t: number; wait: number;
}

export interface Human {
  slot: 0 | 1; connected: boolean; kb: boolean;
  x: number; y: number; b: number; pressed: number; released: number;
  ctrl: Player | null; charging: number; chargeT: number; chargeMods: number;
  intent: Intent | null; retap: number;
  ready: boolean; kit: number; seen: number;
  // switching
  since: number; lock: number; cand: Player | null; candT: number; next: Player | null;
  cycle: Player[]; cycleT: number;
  ctx: PadCtx;
}

export interface Restart {
  type: 'kickoff' | 'goalkick' | 'corner' | 'throw' | 'free' | 'penalty';
  team: 0 | 1; x: number; z: number; taker: number; t: number;
}

export interface Penalty {
  team: 0 | 1; taker: Player; keeper: Player; d: number;
  phase: 'aim' | 'run' | 'done';
  t: number; aimZ: number; aimY: number; power: number; mod: Mod;
  charging: boolean; chargeT: number; chargeMods: number;
  dived: boolean; keeperReact: number; doneT: number;
}

export interface Shootout {
  res: [number[], number[]]; turn: 0 | 1; first: 0 | 1;
  order: [Player[], Player[]]; idx: [number, number];
  t: number; resolved: boolean; winner: number;
}

export interface Referee { x: number; z: number; vx: number; vz: number; face: number; phase: number; card: number; cardT: number }

export interface GameEvent { t: string; [k: string]: any }

export interface Opts { size: 7 | 11; halfLen: number; level: number; replay: boolean; pens: boolean }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// ------------------------------------------------------------ ball flight
/** Quadratic air drag coefficient (per metre): a = -DRAG * |v| * v. ~11 m/s² at 30 m/s, like a real ball. */
export const DRAG = 0.012;

/** Height of a ball (launched from y0 with horizontal speed hs, vertical vy) once it has covered `dist` metres. Ignores the ground. */
function heightAt(hs: number, vy: number, y0: number, dist: number) {
  let h = hs, v = vy, y = y0, d = 0;
  for (let i = 0; i < 600 && d < dist; i++) {
    const s = Math.hypot(h, v);
    h -= DRAG * s * h * DT; v -= (G + DRAG * s * v) * DT;
    d += h * DT; y += v * DT;
    if (h < 0.5) break;
  }
  return y;
}
/** Horizontal distance until the ball comes back down to the ground. */
function landDist(hs: number, vy: number, y0: number) {
  let h = hs, v = vy, y = y0, d = 0;
  for (let i = 0; i < 600; i++) {
    const s = Math.hypot(h, v);
    h -= DRAG * s * h * DT; v -= (G + DRAG * s * v) * DT;
    d += h * DT; y += v * DT;
    if (y <= BR && v < 0) break;
  }
  return d;
}
/** Vertical launch speed that makes the ball pass `dist` metres away at height `targetY`. */
export function solveVy(hs: number, y0: number, dist: number, targetY: number) {
  let lo = -6, hi = 20;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (heightAt(hs, mid, y0, dist) < targetY) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Horizontal speed that makes a ball launched with vertical speed vy land `dist` metres away. */
export function solveHs(vy: number, y0: number, dist: number) {
  let lo = 2, hi = 45;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (landDist(mid, vy, y0) < dist) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const RING = 60 * 10;
const PRED_N = 46; // ball prediction samples (every 1/15 s, ~3 s)
const SHOT_TAP = 0.16; // window after releasing □ / ○ for a second (third) tap
const POWER_WINDUP = 0.3;

export class Game {
  opts: Opts = { size: 11, halfLen: 120, level: 0.75, replay: true, pens: true };
  players: Player[] = [];
  /** players still on the pitch (not sent off) */
  field: Player[] = [];
  ball!: Ball;
  humans: Human[] = [this.newHuman(0), this.newHuman(1)];
  mode: Mode = 'idle';
  modeT = 0;
  clock = 0; // simulation seconds, never reset
  score: [number, number] = [0, 0];
  half: 1 | 2 = 1;
  time = 0;
  dir: [number, number] = [1, -1];
  restart: Restart | null = null;
  events: GameEvent[] = [];
  pressT: [number, number] = [0, 0];
  rushT: [number, number] = [0, 0];
  chasers: [Set<number>, Set<number>] = [new Set(), new Set()];
  stats = this.newStats();
  goalInfo: { team: number; scorer: Player | null; side: number } | null = null;
  replayPending = false;
  paused = false;
  /** players caught offside by the last pass (by id) */
  offside = new Set<number>();
  offKicker = -1;
  prevTouch: Player | null = null;
  /** offside line per team, in that team's attack-normalised x */
  offLine: [number, number] = [0, 0];
  /** time since the team in possession changed */
  turnoverT = 9;
  private possTeamPrev = -1;
  /** advantage being played after a foul */
  adv: { team: number; x: number; z: number; t: number } | null = null;
  pendingCards: { p: Player; color: 'yellow' | 'red' }[] = [];
  pen: Penalty | null = null;
  so: Shootout | null = null;
  ref: Referee = { x: 0, z: -14, vx: 0, vz: 0, face: 0, phase: 0, card: 0, cardT: 0 };

  // ball prediction cache (refreshed every step)
  predX = new Float32Array(PRED_N); predY = new Float32Array(PRED_N); predZ = new Float32Array(PRED_N);
  private tmp2 = [0, 0];

  frameLen = 0;
  prevFrame = new Float32Array(0);
  curFrame = new Float32Array(0);
  private ring = new Float32Array(0);
  private ringN = 0;
  private goalRingN = 0;

  private newHuman(slot: 0 | 1): Human {
    return {
      slot, connected: false, kb: false, x: 0, y: 0, b: 0, pressed: 0, released: 0,
      ctrl: null, charging: 0, chargeT: 0, chargeMods: 0, intent: null, retap: 0,
      ready: false, kit: slot === 0 ? 0 : 1, seen: 0,
      since: 9, lock: 0, cand: null, candT: 0, next: null, cycle: [], cycleT: 0, ctx: 'none',
    };
  }
  private newStats() {
    return { shots: [0, 0], onTarget: [0, 0], fouls: [0, 0], corners: [0, 0], poss: [0, 0], yellow: [0, 0], red: [0, 0], offsides: [0, 0] };
  }

  humanActive(t: number) { const h = this.humans[t]; return h.connected || h.kb; }

  // ---------------------------------------------------------------- setup
  setup(opts: Opts) {
    this.opts = { ...opts };
    const form = FORMATIONS[opts.size];
    this.players = [];
    for (let t = 0; t < 2; t++) {
      form.forEach((f, i) => {
        const id = t * form.length + i;
        const seed = (i * 37 + t * 11) % 7;
        this.players.push({
          id, team: t as 0 | 1, idx: i, role: f.role, num: f.num, gk: f.role === 'GK',
          x: 0, z: 0, vx: 0, vz: 0, face: 0, phase: 0, nx: f.nx, nz: f.nz,
          stamina: 1, spd: 0.97 + seed * 0.012 + (f.role === 'FWD' ? 0.02 : f.role === 'DEF' ? -0.01 : 0),
          skill: 0.72 + ((seed * 13) % 10) * 0.028,
          act: 0, actT: 0, actDur: 0, side: 1, cool: 0, thinkT: Math.random() * 0.3, tackleCd: 0, passCd: 0,
          wx: 0, wz: 0, ws: 0, sprint: false, spdCap: 1, look: NaN, tight: false, shield: false,
          slx: 0, slz: 0, slideDone: false, holdT: 0, aiDx: 0, aiDz: 1, diveHigh: false, yellow: 0, off: false,
        });
      });
    }
    this.field = this.players.slice();
    this.ball = {
      x: 0, y: BR, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: null, lastTouch: null,
      target: -1, targetT: 0, shot: false, qx: 0, qy: 0, qz: 0, qw: 1,
    };
    this.frameLen = FRAME.HDR + this.players.length * FRAME.P;
    this.prevFrame = new Float32Array(this.frameLen);
    this.curFrame = new Float32Array(this.frameLen);
    this.ring = new Float32Array(RING * this.frameLen);
    this.ringN = 0;
    this.resetMatchState();
    this.layoutKickoff(0);
    this.mode = 'idle';
    this.resetFrames();
  }

  private resetMatchState() {
    this.score = [0, 0]; this.half = 1; this.time = 0; this.dir = [1, -1];
    this.stats = this.newStats();
    this.restart = null; this.goalInfo = null; this.replayPending = false;
    this.adv = null; this.pendingCards = []; this.pen = null; this.so = null;
    this.ref.card = 0;
    for (const p of this.players) { p.stamina = 1; p.yellow = 0; p.off = false; p.act = ACT.NONE; }
    this.field = this.players.slice();
    this.humans.forEach((h) => { h.ctrl = null; h.charging = 0; h.intent = null; h.next = null; });
  }

  startMatch() {
    this.resetMatchState();
    this.kickoff(0);
    this.emit({ t: 'whistle' });
  }

  /** Back to the lobby formation. */
  toIdle() {
    this.mode = 'idle'; this.restart = null; this.pen = null; this.so = null; this.layoutKickoff(0); this.resetFrames();
  }

  private emit(e: GameEvent) { this.events.push(e); }

  // ------------------------------------------------------------ formation
  formationTarget(p: Player, poss: number, bx: number, bz: number, out: number[]) {
    const d = this.dir[p.team];
    const bn = bx * d;
    const attacking = poss === p.team;
    const shift = clamp(bn * 0.5, -20, 24);
    let nx = p.nx;
    if (p.role === 'DEF') nx = attacking ? Math.min(p.nx + shift * 0.55 + 2, bn - 6) : p.nx + shift * 0.5 - 3;
    else if (p.role === 'MID') nx = attacking ? p.nx + shift * 0.85 + 8 : p.nx + shift * 0.7 - 2;
    else if (p.role === 'FWD') nx = attacking ? Math.max(p.nx + shift * 0.8 + 14, bn + 6) : p.nx + shift * 0.5 - 4;
    nx = clamp(nx, -44, 44);
    if (attacking) nx = Math.min(nx, this.offLine[p.team] - 0.8); // stay onside
    const nz = clamp(p.nz * (attacking ? 0.95 : 0.8) + bz * d * 0.28, -HW + 2, HW - 2);
    out[0] = nx * d; out[1] = nz * d;
  }

  private layoutKickoff(first: number) {
    for (const p of this.players) {
      if (p.off) { this.parkOff(p); continue; }
      const d = this.dir[p.team];
      let nx = Math.min(p.nx * 0.9, -3.5);
      if (p.team !== first) nx = Math.min(nx, -CIRCLE - 1.5);
      p.x = nx * d; p.z = p.nz * d * 0.85; p.vx = p.vz = 0;
      p.face = Math.atan2(d, 0); p.act = 0; p.actT = 0; p.cool = 0; p.wx = p.wz = p.ws = 0;
    }
    const b = this.ball;
    b.x = 0; b.y = BR; b.z = 0; b.vx = b.vy = b.vz = 0; b.owner = null; b.spin = 0; b.target = -1; b.shot = false;
    this.ref.x = -4; this.ref.z = -12; this.ref.vx = this.ref.vz = 0;
  }

  private parkOff(p: Player) {
    p.x = -2 + p.id * 0.9; p.z = HW + 9; p.vx = p.vz = 0; p.act = ACT.OFF;
  }

  private resetFrames() {
    this.writeFrame(this.curFrame);
    this.prevFrame.set(this.curFrame);
  }

  // ---------------------------------------------------------- restarts
  private clearPlayState() {
    this.offside.clear(); this.ball.lastTouch = null; this.prevTouch = null;
    for (const h of this.humans) { h.intent = null; h.charging = 0; h.retap = 0; }
    this.flushCards();
    this.adv = null;
  }

  kickoff(team: number) {
    this.layoutKickoff(team);
    const taker = this.field.filter((p) => p.team === team && !p.gk).reduce((a, b) => (a.idx > b.idx ? a : b));
    const d = this.dir[team];
    taker.x = -0.9 * d; taker.z = 0; taker.face = Math.atan2(d, 0);
    this.restart = { type: 'kickoff', team: team as 0 | 1, x: 0, z: 0, taker: taker.id, t: 0 };
    this.pen = null;
    this.clearPlayState();
    this.mode = 'wait'; this.modeT = 0;
    this.assignHumanTaker();
    this.resetFrames();
  }

  setRestart(type: Restart['type'], team: number, x: number, z: number, forced?: Player) {
    const b = this.ball;
    this.clearPlayState();
    b.owner = null; b.vx = b.vy = b.vz = 0; b.spin = 0; b.target = -1; b.shot = false;
    b.x = x; b.z = z; b.y = type === 'throw' ? 2.0 : BR;
    const cands = this.field.filter((p) => p.team === team && !p.gk);
    let taker: Player;
    if (forced) taker = forced;
    else if (type === 'goalkick') taker = this.field.find((p) => p.team === team && p.gk) || cands[0];
    else if (type === 'penalty') taker = cands.reduce((a, c) => (a.idx > c.idx ? a : c));
    else taker = cands.reduce((a, c) => (Math.hypot(a.x - x, a.z - z) < Math.hypot(c.x - x, c.z - z) ? a : c));
    const d = this.dir[team];
    taker.vx = taker.vz = 0; taker.act = 0; taker.cool = 0;
    for (const p of this.field) if (p.act === ACT.DIVE || p.act === ACT.HOLD || p.act === ACT.SLIDE) p.act = ACT.NONE;
    if (type === 'throw') {
      const s = Math.sign(z) || 1;
      taker.x = x; taker.z = s * (HW + 0.6); taker.face = Math.atan2(0, -s);
      taker.act = ACT.THROW; taker.actDur = 999; taker.actT = 0;
    } else if (type === 'penalty') {
      taker.x = x - 2.6 * d; taker.z = z - 0.6; taker.face = Math.atan2(d, 0);
    } else {
      // stand just behind the ball, looking at the opponent goal
      taker.x = x - 0.8 * d; taker.z = z; taker.face = Math.atan2(d, 0);
      if (type === 'corner') { taker.x = x - Math.sign(x) * 0.6; taker.z = z + Math.sign(z) * 0.6; taker.face = Math.atan2(-Math.sign(x), -Math.sign(z)); }
    }
    this.restart = { type, team: team as 0 | 1, x, z, taker: taker.id, t: 0 };
    this.mode = 'wait'; this.modeT = 0;
    this.pen = null;
    if (type === 'penalty') this.setupPenalty(taker);
    this.assignHumanTaker();
    this.emit({ t: 'whistle' });
    this.emit({ t: 'setpiece', type, team });
  }

  private assignHumanTaker() {
    if (!this.restart) return;
    const tk = this.players[this.restart.taker];
    const h = this.humans[tk.team];
    if (this.humanActive(tk.team)) { h.ctrl = tk; h.charging = 0; h.lock = 0.5; }
    if (this.pen) {
      const kh = this.humans[this.pen.keeper.team];
      if (this.humanActive(this.pen.keeper.team)) { kh.ctrl = this.pen.keeper; kh.charging = 0; }
    }
  }

  // ------------------------------------------------------------ helpers
  nearestTo(team: number, x: number, z: number, skipGk = true, exclude?: Player | null) {
    let best: Player | null = null, bd = 1e9;
    for (const p of this.field) {
      if (p.team !== team || (skipGk && p.gk) || p === exclude) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  clearance(ax: number, az: number, bx: number, bz: number, team: number) {
    let m = 6;
    for (const o of this.field) {
      if (o.team === team) continue;
      m = Math.min(m, segDist(o.x, o.z, ax, az, bx, bz));
    }
    return m;
  }

  /** Second-last defender line (or the ball / halfway, whichever is further forward) for `team`'s attack. */
  computeOffLine(team: number, ballX = this.ball.x) {
    const d = this.dir[team];
    let a = -1e9, b = -1e9; // two deepest opponents
    for (const o of this.field) {
      if (o.team === team) continue;
      const x = o.x * d;
      if (x > a) { b = a; a = x; } else if (x > b) b = x;
    }
    return Math.max(b, ballX * d, 0);
  }

  private markOffside(p: Player, ballX: number) {
    const line = this.computeOffLine(p.team, ballX), d = this.dir[p.team];
    for (const t of this.field) if (t.team === p.team && t !== p && t.x * d > line + 0.25) this.offside.add(t.id);
  }

  private offsideCall(p: Player) {
    this.offside.clear();
    this.stats.offsides[p.team]++;
    const x = clamp(p.x, -HL + 2, HL - 2), z = clamp(p.z, -HW + 1.5, HW - 1.5);
    this.setRestart('free', 1 - p.team, x, z);
    this.emit({ t: 'offside', id: p.id, team: p.team });
  }

  // ------------------------------------------------------ ball prediction
  /** Predict the ball path for the next ~3 s (gravity, drag, bounces, rolling friction) - shared by AI and switching. */
  predictBall() {
    const b = this.ball, o = b.owner;
    if (o) {
      for (let i = 0; i < PRED_N; i++) {
        const t = Math.min(i / 15, 0.8);
        this.predX[i] = b.x + o.vx * t; this.predZ[i] = b.z + o.vz * t; this.predY[i] = b.y;
      }
      return;
    }
    let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz;
    const dt = 1 / 60;
    for (let i = 0; i < PRED_N; i++) {
      this.predX[i] = x; this.predY[i] = y; this.predZ[i] = z;
      for (let k = 0; k < 4; k++) {
        if (y > BR + 0.03 || vy > 0) {
          const s = Math.hypot(vx, vy, vz), d = DRAG * s * dt;
          vx -= vx * d; vz -= vz * d; vy -= G * dt + vy * d;
        } else {
          const sp = Math.hypot(vx, vz);
          if (sp > 0) { const ns = Math.max(0, sp * Math.exp(-0.5 * dt) - 0.35 * dt); vx *= ns / sp; vz *= ns / sp; }
        }
        x += vx * dt; y += vy * dt; z += vz * dt;
        if (y < BR) { y = BR; vy = vy < -1.4 ? -vy * 0.62 : 0; }
      }
    }
  }

  /** Earliest time `p` can play the ball (reachable and below head height); writes the meeting point to `out`. */
  interceptPoint(p: Player, out: number[], speed = 7.6) {
    const b = this.ball;
    if (b.owner && b.owner.team !== p.team) {
      const tx = b.owner.x + b.owner.vx * 0.3, tz = b.owner.z + b.owner.vz * 0.3;
      out[0] = tx; out[1] = tz;
      return Math.hypot(tx - p.x, tz - p.z) / speed;
    }
    for (let i = 0; i < PRED_N; i++) {
      const t = i / 15;
      const x = this.predX[i], z = this.predZ[i];
      if (this.predY[i] < 2.35 && Math.hypot(x - p.x, z - p.z) <= speed * t + 0.7) {
        out[0] = clamp(x, -HL - 1, HL + 1); out[1] = clamp(z, -HW - 1, HW + 1); return t;
      }
    }
    const i = PRED_N - 1;
    out[0] = clamp(this.predX[i], -HL - 1, HL + 1); out[1] = clamp(this.predZ[i], -HW - 1, HW + 1);
    return 3 + Math.hypot(out[0] - p.x, out[1] - p.z) / speed;
  }

  /** True if the loose ball is travelling towards `p` (passes within reach in the next ~2 s). */
  ballComingTo(p: Player) {
    const b = this.ball;
    if (b.owner || Math.hypot(b.vx, b.vz) < 2.5) return false;
    if ((p.x - b.x) * b.vx + (p.z - b.z) * b.vz < 0) return false;
    for (let i = 0; i < 30; i++) if (Math.hypot(this.predX[i] - p.x, this.predZ[i] - p.z) < 2.6) return true;
    return false;
  }

  /** Height of the ball when `p` would meet it. */
  private meetHeight(p: Player) {
    this.interceptPoint(p, this.tmp2);
    let best = 0, bd = 1e9;
    for (let i = 0; i < PRED_N; i++) {
      const d = Math.hypot(this.predX[i] - this.tmp2[0], this.predZ[i] - this.tmp2[1]);
      if (d < bd) { bd = d; best = i; }
    }
    return this.predY[best];
  }

  possTeam() {
    if (this.ball.owner) return this.ball.owner.team;
    if (this.restart) return this.restart.team;
    return this.ball.lastTouch ? this.ball.lastTouch.team : -1;
  }

  humanTarget(p: Player, dx: number, dz: number, kind: KickKind): Player | null {
    const d0 = this.dir[p.team];
    let best: Player | null = null, bs = -1e9;
    for (const t of this.field) {
      if (t.team !== p.team || t === p) continue;
      const rx = t.x - p.x, rz = t.z - p.z, d = Math.hypot(rx, rz);
      if (d < 2.5) continue;
      const cosA = (rx * dx + rz * dz) / d;
      if (cosA < 0.6) continue;
      if (kind === 'through' && rx * d0 < 3) continue;
      let s = cosA * 6 - d * 0.045 + Math.min(this.clearance(p.x, p.z, t.x, t.z, p.team), 4) * 0.55;
      if (kind === 'through') s += rx * d0 * 0.05;
      if (t.gk) s -= 2;
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  }

  /** Attacking third, out wide: ○ becomes a cross. */
  inCrossZone(p: Player) {
    const d = this.dir[p.team];
    return p.x * d > HL - 32 && Math.abs(p.z) > 12;
  }

  /** Best team-mate to aim a cross at (in or near the box, least marked). */
  private crossTarget(p: Player): Player | null {
    const d = this.dir[p.team];
    let best: Player | null = null, bs = -1e9;
    for (const t of this.field) {
      if (t.team !== p.team || t === p || t.gk) continue;
      const bx = t.x * d;
      if (bx < HL - 22 || Math.abs(t.z) > 14) continue;
      let open = 6;
      for (const o of this.field) if (o.team !== p.team) open = Math.min(open, Math.hypot(o.x - t.x, o.z - t.z));
      const s = open - Math.abs(bx - (HL - 9)) * 0.15 - Math.abs(t.z) * 0.08;
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  }

  // -------------------------------------------------------------- kicks
  kick(p: Player, kind: KickKind, power: number, sx: number, sz: number, target: Player | null = null, mod: Mod = '') {
    const b = this.ball;
    const has = sx !== 0 || sz !== 0;
    let dx = sx, dz = sz;
    if (!has) { dx = Math.sin(p.face); dz = Math.cos(p.face); }
    else { const l = Math.hypot(dx, dz); dx /= l; dz /= l; }
    const d0 = this.dir[p.team];
    const wasWait = this.mode === 'wait';
    const rtype = this.restart?.type;
    if (rtype === 'throw' && wasWait && kind === 'shoot') kind = 'lob';
    if (rtype === 'throw' && wasWait) mod = '';
    if (this.mode === 'play' && this.offside.has(p.id)) { this.offsideCall(p); return; }
    const ox = b.x;
    const g = (): number => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;
    const y0 = Math.max(b.y, BR + 0.02);
    const volley = b.y > 0.55 && !b.owner;
    b.target = -1;

    if (kind === 'shoot') {
      const gx = HL * d0;
      let aimZ = (Math.random() - 0.5) * 2 * 2.6;
      let ax = gx - p.x, az = 0;
      if (has && dx * d0 > 0.35) aimZ = clamp((dz / Math.max(dx * d0, 0.3)) * 3.6, -3.3, 3.3);
      if (mod === 'finesse' && Math.abs(aimZ) < 2.2) aimZ = (Math.sign(aimZ) || (Math.random() < 0.5 ? -1 : 1)) * 2.7; // finesse goes for the corner
      const hoof = has && dx * d0 <= 0.35 && Math.hypot(sx, sz) > 0.2; // clearance along the stick
      let tx: number, tz: number;
      if (hoof) { tx = p.x + dx * 30; tz = p.z + dz * 30; ax = dx; az = dz; } else { tx = gx; tz = aimZ; }
      const dist = Math.max(Math.hypot(tx - p.x, tz - p.z), 1);
      let pressure = 0;
      for (const o of this.field) if (o.team !== p.team) pressure = Math.max(pressure, 1 - Math.hypot(o.x - p.x, o.z - p.z) / 3.5);
      pressure = Math.max(pressure, 0);
      let sigma = 0.018 + (1 - p.skill) * 0.08 + pressure * 0.04 + power * 0.02 + (p.ws > 0.9 && p.sprint ? 0.012 : 0);
      if (volley) sigma *= 1.5;
      let speed = 17 + power * 15;
      let aimY = 0.25 + power * 1.15 + Math.random() * 0.5;
      if (power > 0.9) aimY += (power - 0.9) * 7 * Math.random();
      let spin = (Math.random() - 0.5) * 0.9;
      switch (mod) {
        case 'finesse': speed = 15 + power * 10; sigma *= 0.65; aimY = 0.5 + power * 1.1 + Math.random() * 0.3; break;
        case 'power': speed = 24 + power * 13; sigma *= 1.15; aimY = 0.4 + power * 1.0 + Math.random() * 0.4; break;
        case 'low': aimY = 0.22 + Math.random() * 0.25; speed = 18 + power * 12; break;
      }
      aimY += g() * (0.1 + (1 - p.skill) * 0.45 + pressure * 0.3) * (mod === 'finesse' ? 0.6 : 1);
      if (mod === 'chip') {
        // high, slow lob that drops under the bar
        const T = 0.9 + dist * 0.028;
        const vy = 0.5 * G * T * 1.05;
        const hs = solveHs(vy, y0, dist + 0.8 + power * 2.5);
        const ang = Math.atan2(tz - p.z, tx - p.x) + g() * sigma;
        b.vx = Math.cos(ang) * hs; b.vz = Math.sin(ang) * hs; b.vy = vy; spin = 0;
      } else {
        let ang = Math.atan2(tz - p.z, tx - p.x) + g() * sigma;
        if (hoof) ang = Math.atan2(az, ax) + g() * 0.03;
        if (mod === 'finesse') {
          // curl: launch outside the target and let spin bring it back in
          const side = Math.sign(tz - p.z * 0.3) || 1;
          spin = side * 0.55 * d0;
          const T = dist / speed * 1.1;
          const curve = 0.5 * Math.abs(spin) * speed * 0.25 * T * T;
          ang -= Math.sign(spin) * Math.atan2(curve, dist);
        }
        b.vx = Math.cos(ang) * speed; b.vz = Math.sin(ang) * speed;
        b.vy = hoof ? 2 + power * 4 : solveVy(speed, y0, dist, Math.max(aimY, BR));
      }
      b.spin = spin;
      b.shot = !hoof;
      if (!hoof) this.stats.shots[p.team]++;
    } else {
      const cross = kind === 'lob' && !wasWait && this.inCrossZone(p) || (kind === 'lob' && rtype === 'corner');
      let tgt = target;
      if (!tgt && cross) tgt = this.crossTarget(p);
      if (!tgt && has) tgt = this.humanTarget(p, dx, dz, kind);
      if (!tgt && !has && kind !== 'lob') tgt = this.humanTarget(p, Math.sin(p.face), Math.cos(p.face), kind);
      const pw = clamp(power, 0, 1);
      let tx: number, tz: number;
      if (tgt) {
        tx = tgt.x; tz = tgt.z;
        const dd = Math.hypot(tx - p.x, tz - p.z);
        if (kind === 'through') {
          const lead = clamp(dd / 14, 0.4, 1.3) * (mod === 'lobbed' ? 1.25 : 1);
          tx += tgt.vx * lead + d0 * (mod === 'lobbed' ? 5 : 3.5); tz += tgt.vz * lead;
        } else if (cross) {
          tx += tgt.vx * 0.8 + d0 * 0.5; tz += tgt.vz * 0.8;
        } else {
          tx += tgt.vx * 0.35; tz += tgt.vz * 0.35;
        }
        tx = clamp(tx, -HL + 1, HL - 1); tz = clamp(tz, -HW + 1, HW - 1);
        b.target = tgt.id; b.targetT = 2.4;
      } else if (cross) {
        tx = d0 * (HL - 8); tz = -Math.sign(p.z) * 1.5;
      } else {
        const dist = kind === 'lob' ? 10 + pw * 32 : 6 + pw * 20;
        tx = p.x + dx * dist; tz = p.z + dz * dist;
      }
      const d = Math.max(Math.hypot(tx - p.x, tz - p.z), 1.5);
      const ang = Math.atan2(tz - p.z, tx - p.x) + g() * (0.012 + (1 - p.skill) * 0.05);
      const groundCross = cross && mod === 'ground';
      const lofted = (kind === 'lob' && !groundCross) || rtype === 'throw' || (kind === 'through' && mod === 'lobbed');
      if (lofted) {
        // hang time grows with distance; throw-ins / low / driven crosses are flatter
        let T = clamp((rtype === 'throw' ? 0.55 : 0.75) + d * 0.03, 0.7, 2.3);
        if (cross && mod === 'low') T = clamp(0.5 + d * 0.016, 0.55, 1.0);
        else if (mod === 'driven') T *= 0.72;
        else if (kind === 'through') T = clamp(0.8 + d * 0.022, 0.8, 1.8);
        const vy = 0.5 * G * T;
        const hs = solveHs(vy, y0, d * (0.96 + pw * 0.08));
        b.vx = Math.cos(ang) * hs; b.vz = Math.sin(ang) * hs;
        b.vy = vy;
      } else {
        const T = 0.45 + d * 0.042;
        let v0 = ((d + 0.3) * 0.5) / (1 - Math.exp(-0.5 * T));
        v0 = clamp(v0 * (0.92 + pw * 0.3), 7, 30);
        if (mod === 'driven' || groundCross) v0 = clamp(Math.max(v0 * 1.35, 14), 14, 33);
        b.vx = Math.cos(ang) * v0; b.vz = Math.sin(ang) * v0; b.vy = 0;
      }
      b.spin = 0; b.shot = false;
      if (tgt && this.humanActive(p.team)) { const h = this.humans[p.team]; this.setCtrl(h, tgt, 0.6); }
    }
    if (b.y < BR + 0.01 && !(rtype === 'throw' && wasWait)) b.y = BR + 0.02;
    b.owner = null;
    b.lastTouch = p;
    p.act = ACT.KICK; p.actT = 0; p.actDur = 0.32; p.cool = 0.45;
    // offside is judged at the moment of the pass (not from throw-ins, corners or goal kicks)
    this.offside.clear(); this.offKicker = p.id; this.prevTouch = p;
    if (!(wasWait && (rtype === 'throw' || rtype === 'corner' || rtype === 'goalkick'))) this.markOffside(p, ox);
    if (wasWait) { this.mode = 'play'; this.restart = null; }
    this.emit({ t: 'kick', id: p.id, team: p.team, kind, mod, power: kind === 'shoot' ? power : 0.4 });
  }

  // ------------------------------------------------------------ tackles
  standingTackle(p: Player) {
    if (p.act !== ACT.NONE || p.tackleCd > 0 || this.mode !== 'play') return;
    p.act = ACT.TACKLE; p.actT = 0; p.actDur = 0.5; p.tackleCd = 0.9;
    const b = this.ball, o = b.owner;
    const fx = Math.sin(p.face), fz = Math.cos(p.face);
    if (o && o.team !== p.team && o.act !== ACT.STUN && o.act !== ACT.HOLD) {
      const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz);
      if (d < 1.8) {
        const facing = (dx * fx + dz * fz) / Math.max(d, 0.01) > 0.15;
        const behind = Math.sin(o.face) * fx + Math.cos(o.face) * fz > 0.4;
        const chance = 0.5 + (p.skill - 0.8) * 0.5 - (o.sprint && o.ws > 0.8 ? 0.15 : 0) - (facing ? 0 : 0.25)
          + (p.spdCap < 0.9 ? 0.1 : 0) - (o.shield ? 0.15 : 0);
        if (Math.random() < chance) this.winBall(p, o, 5);
        else if (Math.random() < (behind ? 0.4 : 0.12)) this.foul(p, o, 'standing');
      }
    } else if (!o && Math.hypot(b.x - p.x, b.z - p.z) < 1.6 && b.y < 0.8) {
      b.vx = fx * 6 + (Math.random() - 0.5) * 2; b.vz = fz * 6 + (Math.random() - 0.5) * 2;
      b.lastTouch = p; this.emit({ t: 'tackle', id: p.id });
    }
  }

  slideTackle(p: Player) {
    if (p.act !== ACT.NONE || p.tackleCd > 0 || this.mode !== 'play') return;
    p.act = ACT.SLIDE; p.actT = 0; p.actDur = 0.95; p.tackleCd = 1.6; p.slideDone = false;
    const sp = Math.hypot(p.vx, p.vz);
    const fx = Math.sin(p.face), fz = Math.cos(p.face);
    p.slx = fx; p.slz = fz; p.vx = fx * Math.max(sp, 6); p.vz = fz * Math.max(sp, 6);
  }

  private winBall(p: Player, o: Player, pop: number) {
    const b = this.ball;
    b.owner = null; b.lastTouch = p;
    const fx = Math.sin(p.face), fz = Math.cos(p.face);
    b.vx = fx * pop + (Math.random() - 0.5) * 3; b.vz = fz * pop + (Math.random() - 0.5) * 3; b.vy = 0.8;
    o.act = ACT.STUN; o.actT = 0; o.actDur = 0.6; o.cool = 0.7; p.cool = 0;
    b.target = -1;
    this.emit({ t: 'tackle', id: p.id, victim: o.id });
  }

  gkDive(p: Player, dz: number, high: boolean, speed = 7.4) {
    p.act = ACT.DIVE; p.actT = 0; p.actDur = 0.95; p.diveHigh = high;
    p.side = Math.sign(dz * -Math.sin(p.face)) || 1;
    p.vx = 0; p.vz = clamp(dz, -1, 1) * speed;
    this.emit({ t: 'dive', id: p.id });
  }

  // ---------------------------------------------------------- discipline
  /** Denying an obvious goal-scoring opportunity: through on goal with nobody but the keeper to beat. */
  private isDogso(fouler: Player, victim: Player) {
    const d = this.dir[victim.team];
    const vx = victim.x * d;
    if (vx < HL - 32 || Math.abs(victim.z) > 20) return false;
    const b = this.ball;
    if (b.owner !== victim && Math.hypot(b.x - victim.x, b.z - victim.z) > 2.5) return false;
    let cover = 0;
    for (const o of this.field) {
      if (o.team === victim.team || o === fouler || o.gk) continue;
      if (o.x * d > vx - 0.5 && Math.abs(o.z - victim.z) < 12) cover++;
    }
    return cover === 0;
  }

  private foul(p: Player, victim: Player, kind: 'standing' | 'slide') {
    this.stats.fouls[p.team]++;
    const b = this.ball;
    victim.act = ACT.STUN; victim.actT = 0; victim.actDur = 1.1;
    if (b.owner === victim) b.owner = null;
    const fx = Math.sin(p.face), fz = Math.cos(p.face);
    const behind = Math.max(0, Math.sin(victim.face) * fx + Math.cos(victim.face) * fz);
    const speed = clamp(Math.hypot(p.vx, p.vz) / 9, 0, 1);
    const severity = (kind === 'slide' ? 0.24 : 0.1) + behind * 0.3 + speed * 0.2 + Math.random() * 0.3;
    const own = -this.dir[p.team];
    const inBox = victim.x * own > HL - PEN_D && Math.abs(victim.z) < PEN_HW;
    const dogso = this.isDogso(p, victim);
    let card: '' | 'yellow' | 'red' = severity > 1.0 ? 'red' : severity > 0.64 ? 'yellow' : ''; // straight red only for reckless lunges
    if (dogso) card = inBox ? (card === 'red' ? 'red' : 'yellow') : 'red';
    if (card === 'red' && (p.gk || this.field.filter((q) => q.team === p.team).length <= this.opts.size - 3)) card = 'yellow';

    // advantage: foul in the attacking half and a team-mate of the victim is first to the loose ball
    const d = this.dir[victim.team];
    if (!inBox && !dogso && victim.x * d > -5) {
      let mate = 1e9, opp = 1e9;
      for (const q of this.field) {
        if (q === victim || q === p) continue;
        const dd = Math.hypot(q.x - b.x, q.z - b.z);
        if (q.team === victim.team) mate = Math.min(mate, dd); else opp = Math.min(opp, dd);
      }
      if (mate < 7 && mate < opp - 1.5) {
        this.adv = { team: victim.team, x: clamp(victim.x, -HL + 2, HL - 2), z: clamp(victim.z, -HW + 1.5, HW - 1.5), t: 0 };
        if (card) this.pendingCards.push({ p, color: card });
        this.emit({ t: 'foul', id: p.id, victim: victim.id, team: p.team, penalty: false, advantage: true });
        this.emit({ t: 'advantage', team: victim.team });
        return;
      }
    }
    this.emit({ t: 'foul', id: p.id, victim: victim.id, team: p.team, penalty: inBox, dogso, severity, card });
    if (inBox) this.setRestart('penalty', victim.team, own * (HL - SPOT), 0);
    else this.setRestart('free', victim.team, clamp(victim.x, -HL + 2, HL - 2), clamp(victim.z, -HW + 1.5, HW - 1.5));
    if (card) this.issueCard(p, card);
  }

  private flushCards() {
    const cards = this.pendingCards; this.pendingCards = [];
    for (const c of cards) if (!c.p.off) this.issueCard(c.p, c.color);
  }

  issueCard(p: Player, color: 'yellow' | 'red') {
    let second = false;
    if (color === 'yellow') {
      p.yellow++; this.stats.yellow[p.team]++;
      if (p.yellow >= 2) { color = 'red'; second = true; }
    }
    if (color === 'red') { this.stats.red[p.team]++; this.sendOff(p); }
    this.ref.card = color === 'red' ? 2 : 1; this.ref.cardT = 0;
    this.emit({ t: 'card', id: p.id, team: p.team, color, second });
  }

  private sendOff(p: Player) {
    p.off = true;
    if (this.ball.owner === p) this.ball.owner = null;
    this.field = this.players.filter((q) => !q.off);
    this.parkOff(p);
    for (const h of this.humans) if (h.ctrl === p) h.ctrl = null;
    if (this.restart && this.restart.taker === p.id) {
      const r = this.restart;
      const alt = this.nearestTo(r.team, r.x, r.z);
      if (alt) r.taker = alt.id;
    }
  }

  private updateAdvantage(dt: number) {
    const a = this.adv;
    if (!a) return;
    a.t += dt;
    const o = this.ball.owner;
    if (o && o.team !== a.team && a.t < 2.5) {
      // advantage didn't materialise: bring it back for the free kick
      this.adv = null;
      const cards = this.pendingCards; this.pendingCards = [];
      this.setRestart('free', a.team, a.x, a.z);
      for (const c of cards) if (!c.p.off) this.issueCard(c.p, c.color);
      this.emit({ t: 'advback' });
    } else if (a.t >= 2.5) this.adv = null;
  }

  // ------------------------------------------------------------ penalties
  private setupPenalty(taker: Player) {
    const team = taker.team, d = this.dir[team];
    const keeper = this.field.find((q) => q.team !== team && q.gk) || this.nearestTo(1 - team, d * HL, 0)!;
    keeper.x = d * (HL - 0.3); keeper.z = 0; keeper.vx = keeper.vz = 0; keeper.act = ACT.NONE;
    keeper.face = Math.atan2(-d, 0);
    this.pen = {
      team, taker, keeper, d, phase: 'aim', t: 0, aimZ: 0, aimY: 1.0, power: 0.6, mod: '',
      charging: false, chargeT: 0, chargeMods: 0, dived: false, keeperReact: -1, doneT: 0,
    };
  }

  private modFromBits(kind: KickKind, mods: number, taps: number): Mod {
    const l1 = !!(mods & BTN.SWITCH), r1 = !!(mods & BTN.R1);
    switch (kind) {
      case 'shoot': return l1 && r1 ? 'power' : l1 ? 'chip' : r1 ? 'finesse' : taps >= 2 ? 'low' : '';
      case 'pass': return r1 ? 'driven' : '';
      case 'through': return l1 ? 'lobbed' : r1 ? 'driven' : '';
      case 'lob': return taps >= 3 ? 'ground' : taps === 2 ? 'low' : r1 ? 'driven' : '';
    }
  }

  /** Human control during a penalty: the taker aims with the stick and holds □; the keeper moves on his line and dives. */
  private penaltyHuman(h: Human, sx: number, sy: number, downs: number, ups: number, dt: number) {
    const pen = this.pen!;
    const d = pen.d;
    if (h.slot === pen.team && pen.phase === 'aim') {
      h.ctrl = pen.taker;
      pen.aimZ = clamp(sx * d * (GOAL_HW - 0.2), -(GOAL_HW - 0.2), GOAL_HW - 0.2);
      pen.aimY = clamp(1.0 - sy * 1.2, 0.25, 2.3);
      if (downs & BTN.SHOOT) { pen.charging = true; pen.chargeT = 0; pen.chargeMods = h.b; }
      if (pen.charging) pen.chargeT = Math.min(pen.chargeT + dt, 1.2);
      if ((ups & BTN.SHOOT) && pen.charging) {
        pen.charging = false;
        pen.power = clamp(pen.chargeT / 0.75, 0, 1);
        pen.mod = this.modFromBits('shoot', pen.chargeMods, 1);
        if (pen.mod === 'low' || pen.mod === 'power') pen.mod = '';
        this.startRunUp();
      }
    }
    if (h.slot === pen.keeper.team) {
      h.ctrl = pen.keeper;
      const k = pen.keeper;
      if (k.act === ACT.NONE && !pen.dived) {
        k.z = clamp(k.z + sx * d * 1.6 * dt, -1.2, 1.2);
        if (downs & (BTN.PASS | BTN.SHOOT | BTN.LOB | BTN.THROUGH)) {
          pen.dived = true;
          if (Math.abs(sx) > 0.3) this.gkDive(k, Math.sign(sx * d), sy < -0.4);
          else { k.act = ACT.TACKLE; k.actT = 0; k.actDur = 0.6; } // stays big in the middle
        }
      }
    }
  }

  private startRunUp() {
    const pen = this.pen!;
    pen.phase = 'run'; pen.t = 0;
    // a keeper who moved early leaves the other side open for the AI
    if (!this.humanActive(pen.team) && pen.dived && pen.keeper.act === ACT.DIVE) pen.aimZ = -Math.sign(pen.keeper.vz) * 2.6;
  }

  private updatePenalty(dt: number) {
    const pen = this.pen;
    if (!pen) return;
    pen.t += dt;
    const tk = pen.taker, b = this.ball;
    if (pen.phase === 'aim') {
      if (!this.humanActive(pen.team) && pen.t > 1.4) {
        penaltyAim(this, pen);
        this.startRunUp();
      }
    } else if (pen.phase === 'run') {
      const k = Math.min(pen.t / 0.55, 1);
      tk.x = b.x - pen.d * (2.6 - 2.0 * k) ; tk.z = b.z - 0.6 * (1 - k);
      tk.vx = pen.d * 4; tk.vz = 0; tk.face = Math.atan2(pen.d, 0);
      if (k >= 1) this.penaltyStrike();
    } else {
      pen.doneT += dt;
      if (pen.keeperReact >= 0) {
        pen.keeperReact -= dt;
        if (pen.keeperReact < 0 && !pen.dived && pen.keeper.act === ACT.NONE) {
          pen.dived = true;
          const lvl = this.opts.level;
          const r = Math.random();
          let side: number;
          if (r < 0.18) side = 0;
          else side = Math.random() < 0.38 + lvl * 0.14 ? Math.sign(pen.aimZ) || 1 : -(Math.sign(pen.aimZ) || 1);
          if (side !== 0) this.gkDive(pen.keeper, side, pen.aimY > 1.5 && Math.random() < 0.7);
          else { pen.keeper.act = ACT.TACKLE; pen.keeper.actT = 0; pen.keeper.actDur = 0.6; }
        }
      }
      if (!this.so && pen.doneT > 3) this.pen = null;
    }
  }

  private penaltyStrike() {
    const pen = this.pen!, b = this.ball, tk = pen.taker, d = pen.d;
    const g = (): number => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;
    const pw = pen.power;
    let speed = 15 + pw * 15;
    let err = 0.12 + (1 - tk.skill) * 0.5;
    if (Math.abs(pen.aimZ) > GOAL_HW - 0.8) err *= 1.5; // hugging the post is risky
    let aimY = pen.aimY;
    if (pw > 0.85) aimY += (pw - 0.85) * 7 * Math.random(); // blasting it can fly over
    if (pen.mod === 'finesse') { speed = 14 + pw * 10; err *= 0.6; }
    const tz = pen.aimZ + g() * err, ty = Math.max(BR, aimY + g() * err);
    const gx = d * HL;
    const dist = Math.hypot(gx - b.x, tz - b.z);
    const ang = Math.atan2(tz - b.z, gx - b.x);
    if (pen.mod === 'chip') {
      const T = 1.05; const vy = 0.5 * G * T;
      const hs = solveHs(vy, BR + 0.02, dist + 1);
      b.vx = Math.cos(ang) * hs; b.vz = Math.sin(ang) * hs; b.vy = vy;
    } else {
      b.vx = Math.cos(ang) * speed; b.vz = Math.sin(ang) * speed;
      b.vy = solveVy(speed, BR + 0.02, dist, ty);
    }
    b.y = BR + 0.02; b.spin = 0; b.shot = true; b.owner = null; b.lastTouch = tk; b.target = -1;
    this.stats.shots[tk.team]++;
    tk.act = ACT.KICK; tk.actT = 0; tk.actDur = 0.32; tk.cool = 1.0; tk.vx = tk.vz = 0;
    this.offside.clear(); this.offKicker = tk.id; this.prevTouch = tk;
    pen.phase = 'done'; pen.doneT = 0;
    if (!this.humanActive(pen.keeper.team)) pen.keeperReact = 0.04 + Math.random() * 0.06;
    this.mode = 'play'; this.restart = null;
    this.emit({ t: 'kick', id: tk.id, team: tk.team, kind: 'shoot', mod: pen.mod, power: pw });
  }

  // ------------------------------------------------------------ shootout
  private startShootout() {
    const order = (t: number) => {
      const pref = ['FWD', 'MID', 'DEF'];
      return this.field.filter((p) => p.team === t && !p.gk).sort((a, c) => pref.indexOf(a.role) - pref.indexOf(c.role) || c.skill - a.skill);
    };
    const first = (Math.random() < 0.5 ? 0 : 1) as 0 | 1;
    this.so = { res: [[], []], turn: first, first, order: [order(0), order(1)], idx: [0, 0], t: 0, resolved: false, winner: -1 };
    this.emit({ t: 'shootout', first });
    this.nextShootoutKick();
  }

  private nextShootoutKick() {
    const so = this.so!;
    const team = so.turn;
    this.dir[team] = 1; this.dir[1 - team] = -1;
    const list = so.order[team].filter((p) => !p.off);
    const taker = list[so.idx[team] % list.length];
    so.idx[team]++;
    so.resolved = false; so.t = 0;
    // everyone else waits in the centre circle; the shooting side's keeper stands by the box
    let k = 0;
    for (const p of this.field) {
      p.act = ACT.NONE; p.vx = p.vz = 0; p.cool = 0;
      if (p === taker) continue;
      if (p.gk) {
        if (p.team === team) { p.x = HL - 18; p.z = -16; p.face = Math.atan2(1, 0.4); }
        continue;
      }
      const a = (k++ / Math.max(1, this.field.length - 3)) * Math.PI - Math.PI / 2;
      p.x = Math.sin(a) * 6.5 * 0.9; p.z = Math.cos(a) * 6.5 * (p.team === 0 ? -1 : 1) * 0.6 + (p.team === 0 ? -1.5 : 1.5);
      p.face = Math.atan2(1, 0);
    }
    taker.x = HL - SPOT - 3; taker.z = 0;
    this.setRestart('penalty', team, HL - SPOT, 0, taker);
  }

  private shootoutResult(scored: boolean) {
    const so = this.so!;
    if (so.resolved) return;
    so.resolved = true; so.t = 0;
    so.res[so.turn].push(scored ? 1 : 0);
    const taker = this.pen?.taker;
    if (scored && taker) { taker.act = ACT.CELEB; taker.actT = 0; taker.actDur = 999; }
    this.mode = 'dead'; this.modeT = 0; this.goalInfo = null;
    this.ball.owner = null;
    this.emit({ t: 'pen', team: so.turn, scored, kicks: so.res.map((r) => r.slice()) });
  }

  private shootoutWinner() {
    const so = this.so!;
    const [a, b] = so.res;
    const ga = a.reduce((s, x) => s + x, 0), gb = b.reduce((s, x) => s + x, 0);
    if (a.length <= 5 && b.length <= 5) {
      const ra = 5 - a.length, rb = 5 - b.length;
      if (ga + ra < gb) return 1;
      if (gb + rb < ga) return 0;
      return -1;
    }
    if (a.length === b.length && ga !== gb) return ga > gb ? 0 : 1;
    return -1;
  }

  private updateShootout() {
    const so = this.so!, b = this.ball;
    if (this.mode === 'play' && !so.resolved) {
      so.t += DT;
      const k = this.pen?.keeper;
      const stopped = Math.hypot(b.vx, b.vz) < 0.6 && b.y < 0.4;
      if ((k && b.owner === k) || stopped || so.t > 4.5 || Math.abs(b.z) > HW || b.x < HL - 25) this.shootoutResult(false);
    } else if (this.mode === 'dead' && so.resolved) {
      if (this.modeT > 2.2) {
        const w = this.shootoutWinner();
        if (w >= 0) {
          so.winner = w; this.pen = null; this.restart = null;
          this.mode = 'full'; this.modeT = 0;
          this.emit({ t: 'whistle3' });
          this.emit({ t: 'full' });
        } else {
          so.turn = (1 - so.turn) as 0 | 1;
          this.nextShootoutKick();
        }
      }
    }
  }

  // ----------------------------------------------------------- switching
  private setCtrl(h: Human, p: Player, lock = 0) {
    if (h.ctrl !== p) { h.ctrl = p; h.since = 0; h.intent = null; h.charging = 0; }
    h.lock = Math.max(h.lock, lock);
    h.cand = null; h.candT = 0;
  }

  /** Team-mates ordered by how soon they can get to the ball. */
  private switchOrder(team: number, exclude: Player | null) {
    const list: { p: Player; t: number }[] = [];
    for (const q of this.field) {
      if (q.team !== team || q.gk || q === exclude) continue;
      list.push({ p: q, t: this.interceptPoint(q, this.tmp2) });
    }
    list.sort((a, c) => a.t - c.t);
    return list;
  }

  /**
   * FIFA-style auto switching. Switches immediately for possession and passes; otherwise only when a team-mate
   * is clearly (and consistently) better placed, with extra stickiness right after a switch and while the
   * player is steering towards the ball. This stops the selector flickering between bunched players.
   */
  private autoSwitch(h: Human, p: Player, ux: number, uz: number, smag: number, dt: number) {
    const team = h.slot, b = this.ball;
    if (b.owner && b.owner.team === team) {
      if (!b.owner.gk && b.owner !== p) this.setCtrl(h, b.owner);
      return;
    }
    const passTarget = !b.owner && b.lastTouch?.team === team && b.target >= 0 && b.targetT > 0 ? this.players[b.target] : null;
    if (passTarget && !passTarget.gk && !passTarget.off) { if (passTarget !== p) this.setCtrl(h, passTarget); return; }
    if (h.lock > 0 || h.charging || h.intent) { h.cand = null; return; }

    const order = this.switchOrder(team, null);
    if (!order.length) return;
    const best = order[0];
    if (best.p === p) { h.cand = null; return; }
    const mine = order.find((o) => o.p === p)?.t ?? 9;
    let margin = 0.45;
    if (h.since < 1.2) margin += 0.5;
    if (smag > 0.5) {
      this.interceptPoint(p, this.tmp2);
      const dx = this.tmp2[0] - p.x, dz = this.tmp2[1] - p.z, d = Math.hypot(dx, dz) || 1;
      if ((dx * ux + dz * uz) / d > 0.6) margin += 0.7; // the user is already heading for the ball
    }
    const quick = this.turnoverT < 0.35; // possession just changed: react fast
    if (quick) margin = 0.15;
    if (best.t + margin < mine) {
      if (h.cand === best.p) h.candT += dt; else { h.cand = best.p; h.candT = 0; }
      if (quick || h.candT >= 0.22) this.setCtrl(h, best.p, 0.5);
    } else { h.cand = null; h.candT = 0; }
  }

  private manualSwitch(h: Human, p: Player) {
    if (h.cycleT > 0 && h.cycle.length) {
      // repeated L1: walk down the list built on the first press
      const i = h.cycle.indexOf(p);
      const nxt = h.cycle[(i + 1) % h.cycle.length];
      if (nxt) this.setCtrl(h, nxt, 1.0);
    } else {
      h.cycle = this.switchOrder(h.slot, null).slice(0, 4).map((o) => o.p);
      const nxt = h.cycle.find((q) => q !== p);
      if (nxt) this.setCtrl(h, nxt, 1.0);
    }
    h.cycleT = 1.3;
  }

  // ----------------------------------------------------------- humans
  private updateHuman(h: Human, dt: number) {
    const team = h.slot;
    const downs = h.pressed, ups = h.released;
    h.pressed = 0; h.released = 0;
    if (!this.humanActive(team)) { h.ctrl = null; h.ctx = 'none'; return; }
    const b = this.ball;
    h.since += dt; h.lock -= dt; h.cycleT -= dt;
    let sx = h.x / 100, sz = h.y / 100;
    const mag = Math.min(Math.hypot(sx, sz), 1);
    if (mag < 0.12) { sx = sz = 0; } else { const k = (mag - 0.12) / 0.88 / mag; sx *= k; sz *= k; }
    const smag = Math.hypot(sx, sz);
    const ux = smag > 0 ? sx / smag : 0, uz = smag > 0 ? sz / smag : 0;

    // penalties have their own controls
    const pen = this.pen;
    if (pen && ((team === pen.team && (pen.phase !== 'done' || this.so)) ||
                (team === pen.keeper.team && (pen.phase !== 'done' || this.so || pen.doneT < 0.8)))) {
      this.penaltyHuman(h, sx, sz, downs, ups, dt);
      h.ctx = team === pen.team ? (pen.phase === 'aim' ? 'pen' : 'none') : 'gk';
      return;
    }
    if (this.so) { h.ctx = 'none'; return; }

    let p = h.ctrl;
    if (!p || p.team !== team || p.gk || p.off) {
      p = this.nearestTo(team, b.x, b.z) || this.field.find((q) => q.team === team && !q.gk)!;
      this.setCtrl(h, p);
    }

    const ourBall = b.owner ? b.owner.team === team : !!b.lastTouch && b.lastTouch.team === team;
    const defending0 = this.mode === 'play' && !ourBall;

    if (this.mode === 'play') {
      this.autoSwitch(h, p, ux, uz, smag, dt);
      if ((downs & BTN.SWITCH) && defending0) this.manualSwitch(h, h.ctrl!);
      p = h.ctrl!;
    }
    // next-switch indicator (defending only)
    h.next = null;
    if (defending0) { const o = this.switchOrder(team, p); if (o.length) h.next = o[0].p; }

    const taker = this.mode === 'wait' && this.restart?.taker === p.id;
    const hasBall = b.owner === p;
    const nearLoose = this.mode === 'play' && !b.owner && Math.hypot(p.x - b.x, p.z - b.z) < 1.35 && b.y < 1.7 && p.cool <= 0;
    const able = p.act !== ACT.STUN && p.act !== ACT.SLIDE && p.act !== ACT.DIVE && p.act !== ACT.DHEAD;
    const canKick = (this.mode === 'play' || this.mode === 'wait') && (hasBall || taker || nearLoose) && able;
    // while our pass is travelling, buttons are charged and buffered instead of triggering tackles
    const canBuffer = this.mode === 'play' && ourBall && !b.owner && able;
    const defending = defending0 && !canKick;

    const map: [number, KickKind][] = [[BTN.PASS, 'pass'], [BTN.SHOOT, 'shoot'], [BTN.LOB, 'lob'], [BTN.THROUGH, 'through']];
    for (const [bit, kind] of map) {
      if (downs & bit) {
        if ((canKick || canBuffer) && h.intent && h.intent.bit === bit && h.intent.t < h.intent.wait + 0.12) {
          h.intent.taps++; h.retap = bit; // double / triple tap
        } else if (canKick || canBuffer) {
          if (!h.charging) { h.charging = bit; h.chargeT = 0; h.chargeMods = h.b; h.intent = null; }
        } else if (defending) {
          // FIFA defending: ✕ contain (hold), ○ tackle, □ slide, △ keeper rush (hold)
          if (bit === BTN.LOB) this.standingTackle(p);
          else if (bit === BTN.SHOOT) this.slideTackle(p);
        }
      }
      if (ups & bit) {
        if (h.retap === bit) h.retap = 0;
        else if (h.charging === bit) {
          const power = clamp(h.chargeT / 0.75, 0, 1);
          if (canKick || canBuffer) {
            const mods = h.chargeMods;
            const wait = (kind === 'shoot' || kind === 'lob') ? ((mods & BTN.SWITCH) && (mods & BTN.R1) && kind === 'shoot' ? POWER_WINDUP : SHOT_TAP) : 0;
            h.intent = { kind, bit, power, mods, taps: 1, x: ux, z: uz, pid: p.id, t: 0, wait };
          }
          h.charging = 0; h.chargeT = 0;
        }
      }
    }
    if (h.charging) {
      if (!(h.b & h.charging)) { h.charging = 0; h.chargeT = 0; }
      else if (!canKick && !canBuffer) { h.charging = 0; h.chargeT = 0; }
      else h.chargeT = Math.min(h.chargeT + dt, 1.2);
    }
    if (defending && (h.b & BTN.R1)) this.pressT[team] = Math.max(this.pressT[team], 0.3); // team-mate contain
    if (defending && (h.b & BTN.THROUGH)) this.rushT[team] = 0.3; // keeper rush

    // resolve the intent: fire when the player can play the ball
    const it = h.intent;
    if (it) {
      it.t += dt;
      if (smag > 0) { it.x = ux; it.z = uz; }
      if (this.mode === 'wait' ? !taker : (this.mode !== 'play' || !ourBall)) h.intent = null;
      else if (it.pid !== p.id || it.t > 3) h.intent = null;
      else if (it.t >= it.wait && canKick) {
        h.intent = null;
        const mod = this.modFromBits(it.kind, it.mods, it.taps);
        this.kick(p, it.kind, it.power, it.x, it.z, null, mod);
      }
    }

    // movement
    p.wx = p.wz = p.ws = 0; p.sprint = false;
    if (this.mode === 'play' || (this.mode === 'wait' && !taker)) {
      p.wx = ux; p.wz = uz; p.ws = smag * (h.charging ? 0.7 : 1);
      p.sprint = !!(h.b & BTN.SPRINT);
      const r1 = !!(h.b & BTN.R1), l2 = !!(h.b & BTN.L2);
      if (hasBall) {
        if (l2) { // shield: slow, body between ball and nearest opponent
          p.spdCap = 0.45; p.shield = true;
          const o = this.nearestTo(1 - team, p.x, p.z, false);
          if (o) p.look = Math.atan2(p.x - o.x, p.z - o.z);
        } else if (r1) { p.tight = true; if (!p.sprint) p.spdCap = 0.75; } // close control / controlled sprint
      } else if (this.mode === 'play' && !b.owner && ourBall && p !== b.lastTouch && smag < 0.3 &&
                 (b.target === p.id || this.ballComingTo(p))) {
        // receiver assist: run onto the pass if the player isn't steering
        this.interceptPoint(p, this.tmp2);
        const dx = this.tmp2[0] - p.x, dz = this.tmp2[1] - p.z, d = Math.hypot(dx, dz);
        if (d > 0.3) { p.wx = dx / d; p.wz = dz / d; p.ws = Math.min(1, d / 2.5); }
      } else if (defending) {
        const o = b.owner;
        if (h.b & BTN.PASS) {
          // contain: get goal-side of the carrier and stay with him; chase a loose ball
          if (o) {
            const gx = -this.dir[team] * HL;
            let gdx = gx - o.x, gdz = -o.z; const gl = Math.hypot(gdx, gdz) || 1; gdx /= gl; gdz /= gl;
            this.tmp2[0] = o.x + o.vx * 0.2 + gdx * 1.5; this.tmp2[1] = o.z + o.vz * 0.2 + gdz * 1.5;
            p.look = Math.atan2(o.x - p.x, o.z - p.z);
          } else this.interceptPoint(p, this.tmp2);
          const dx = this.tmp2[0] - p.x, dz = this.tmp2[1] - p.z, d = Math.hypot(dx, dz);
          if (d > 0.25) { p.wx = dx / d; p.wz = dz / d; p.ws = Math.min(1, d / 1.5); }
          else p.ws = 0;
        }
        if (l2) { // jockey: side-on, facing the attacker, short quick steps
          p.spdCap = p.sprint ? 0.85 : 0.55;
          const t = o || b;
          p.look = Math.atan2(t.x - p.x, t.z - p.z);
        }
      }
    }

    // pad context
    if (this.mode === 'wait') h.ctx = taker ? 'set' : 'none';
    else if (this.mode !== 'play') h.ctx = 'none';
    else if (hasBall || nearLoose) h.ctx = this.inCrossZone(p) ? 'cross' : 'atk';
    else if (canBuffer && (b.target === p.id || this.ballComingTo(p))) h.ctx = this.meetHeight(p) > 1.4 ? 'air' : 'recv';
    else if (ourBall) h.ctx = 'atk';
    else h.ctx = 'def';
  }

  // ------------------------------------------------------------- step
  step() {
    if (this.mode === 'idle' || this.mode === 'replay' || this.paused) return;
    const dt = DT;
    this.modeT += dt;
    this.clock += dt;

    if (this.mode === 'half') {
      if (this.modeT > 4.5) {
        this.half = 2; this.time = 0; this.dir = [-1, 1];
        this.kickoff(1); this.emit({ t: 'whistle' });
      }
      this.pushFrame(); return;
    }
    if (this.mode === 'full') { this.pushFrame(); return; }

    for (const p of this.field) {
      p.cool -= dt; p.tackleCd -= dt; p.thinkT -= dt; p.passCd -= dt;
      p.spdCap = 1; p.look = NaN; p.tight = false; p.shield = false;
      if (p.act !== ACT.NONE) {
        p.actT += dt;
        if (p.act === ACT.HOLD || p.act === ACT.THROW || p.act === ACT.CELEB) { /* held until released */ }
        else if (p.actT >= p.actDur) p.act = ACT.NONE;
      }
    }
    this.pressT[0] -= dt; this.pressT[1] -= dt; this.rushT[0] -= dt; this.rushT[1] -= dt;
    this.ball.targetT -= dt;
    if (this.restart) this.restart.t += dt;
    const pt = this.possTeam();
    this.turnoverT += dt;
    if (pt >= 0 && pt !== this.possTeamPrev) { this.turnoverT = 0; this.possTeamPrev = pt; }

    this.predictBall();
    if (this.mode !== 'dead') for (const h of this.humans) this.updateHuman(h, dt);
    else for (const h of this.humans) { h.pressed = h.released = 0; h.ctx = 'none'; }
    this.updatePenalty(dt);
    this.planChasers();
    const ctrlSet = new Set<Player>();
    for (const h of this.humans) if (h.ctrl && this.humanActive(h.slot)) ctrlSet.add(h.ctrl);
    for (const p of this.field) {
      if (!ctrlSet.has(p) || this.mode === 'dead') aiPlayer(this, p, dt);
    }
    for (const p of this.field) this.movePlayer(p, dt);
    this.separate();
    this.enforceRestart();
    this.updateRef(dt);

    const b = this.ball;
    if (this.mode === 'wait') this.pinBall();
    else {
      this.ballPhysics(dt);
      if (this.mode === 'play') {
        this.interactions(dt);
        if (this.mode === 'play') this.checkOffside();
        if (this.mode === 'play') this.rules();
        if (this.mode === 'play') this.updateAdvantage(dt);
        if (!this.so) {
          this.time += dt;
          const o = b.owner ? b.owner.team : b.lastTouch ? b.lastTouch.team : -1;
          if (o >= 0) this.stats.poss[o] += dt;
          if (this.time >= this.opts.halfLen && this.mode === 'play' && !this.pen) this.endHalf();
        }
      } else if (this.mode === 'dead') this.deadBall(dt);
    }
    if (this.so) this.updateShootout();
    this.pushFrame();
  }

  /** First touch after a pass by a player who was offside when it was played -> free kick. */
  private checkOffside() {
    const lt = this.ball.lastTouch;
    if (lt === this.prevTouch) return;
    this.prevTouch = lt;
    if (!lt) return;
    if (this.offside.has(lt.id)) this.offsideCall(lt);
    else if (lt.id !== this.offKicker) this.offside.clear();
  }

  private pinBall() {
    const b = this.ball, r = this.restart!;
    b.x = r.x; b.z = r.z; b.vx = b.vy = b.vz = 0; b.y = r.type === 'throw' ? 2.0 : BR; b.owner = null;
  }

  private planChasers() {
    this.offLine[0] = this.computeOffLine(0); this.offLine[1] = this.computeOffLine(1);
    for (const t of [0, 1]) {
      const set = this.chasers[t]; set.clear();
      const b = this.ball, o = b.owner;
      if (this.mode !== 'play' || this.so || (o && o.team === t)) continue;
      const px = o ? o.x + o.vx * 0.2 : b.x + b.vx * 0.3, pz = o ? o.z + o.vz * 0.2 : b.z + b.vz * 0.3;
      const cands = this.field.filter((p) => p.team === t && !p.gk && !(this.humans[t].ctrl === p && this.humanActive(t)));
      cands.sort((a, c) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(c.x - px, c.z - pz));
      const own = -this.dir[t];
      const danger = (px * own) > HL - 28;
      // a human-controlled side only gets one automatic presser (two with R1 team-mate contain)
      const n = this.humanActive(t) ? (this.pressT[t] > 0 ? 1 : (danger ? 1 : 0)) : ((this.pressT[t] > 0 || danger) ? 2 : 1);
      for (let i = 0; i < Math.min(n, cands.length); i++) set.add(cands[i].id);
    }
  }

  private movePlayer(p: Player, dt: number) {
    let vmax = 7.0 * p.spd * (0.9 + 0.1 * this.opts.level + (this.humanActive(p.team) ? 0.1 - 0.1 * this.opts.level : 0));
    const hasBall = this.ball.owner === p;
    const moving = p.ws > 0.05;
    if (p.sprint && p.stamina > 0.04 && moving) { vmax = 8.9 * p.spd * (p.tight ? 0.93 : 1); p.stamina -= 0.13 * dt; }
    else p.stamina += (moving ? 0.045 : 0.1) * dt;
    p.stamina = clamp(p.stamina, 0, 1);
    vmax *= 0.88 + 0.12 * p.stamina;
    if (hasBall) vmax *= 0.95;
    vmax *= p.spdCap;

    let free = true;
    switch (p.act) {
      case ACT.SLIDE: {
        const k = Math.pow(Math.max(0, 1 - p.actT / p.actDur), 0.7);
        const sp = 9.5 * k;
        p.vx = p.slx * sp; p.vz = p.slz * sp; free = false;
        if (!p.slideDone && p.actT < 0.65) this.slideContact(p);
        break;
      }
      case ACT.TACKLE: case ACT.STUN: { const k = Math.exp(-5 * dt); p.vx *= k; p.vz *= k; free = false; break; }
      case ACT.DIVE: case ACT.DHEAD: { const k = Math.exp(-1.3 * dt); p.vx *= k; p.vz *= k; free = false; break; }
      case ACT.THROW: case ACT.HOLD: case ACT.OFF: p.vx = p.vz = 0; free = false; break;
      case ACT.KICK: vmax *= 0.6; break;
      case ACT.HEAD: vmax *= 0.5; break;
    }
    const pen = this.pen;
    if (pen && pen.phase !== 'done' && (p === pen.taker || (p === pen.keeper && p.act !== ACT.DIVE))) {
      // scripted by the penalty routine: positions are set directly, velocity only drives the animation
      p.phase += Math.hypot(p.vx, p.vz) * 3 * dt;
      return;
    }
    if (free) {
      const mag = Math.hypot(p.wx, p.wz);
      const f = mag > 0 ? p.ws / mag : 0;
      const tx = p.wx * f * vmax, tz = p.wz * f * vmax;
      let dx = tx - p.vx, dz = tz - p.vz;
      const dl = Math.hypot(dx, dz);
      const sp = Math.hypot(p.vx, p.vz);
      const braking = tx * p.vx + tz * p.vz < sp * sp * 0.5;
      const amax = (braking ? 22 : 14) * dt * (p.spdCap < 0.9 ? 1.3 : 1);
      if (dl > amax) { dx *= amax / dl; dz *= amax / dl; }
      p.vx += dx; p.vz += dz;
    }
    if (p.act === ACT.OFF) return;
    p.x = clamp(p.x + p.vx * dt, -HL - 8, HL + 8);
    p.z = clamp(p.z + p.vz * dt, -HW - 6, HW + 6);
    const speed = Math.hypot(p.vx, p.vz);
    p.phase += speed * 3.0 * dt;
    if (p.act !== ACT.SLIDE && p.act !== ACT.THROW && p.act !== ACT.DIVE && p.act !== ACT.STUN && p.act !== ACT.DHEAD) {
      let target = p.face, ok = false;
      if (!Number.isNaN(p.look)) { target = p.look; ok = true; }
      else if (p.gk && p.act === ACT.NONE && this.mode === 'play' && speed < 6) { // keepers shuffle while watching the ball
        target = Math.atan2(this.ball.x - p.x, this.ball.z - p.z); ok = true;
      }
      else if (speed > 0.8) { target = Math.atan2(p.vx, p.vz); ok = true; }
      else if (p.ws > 0.1) { target = Math.atan2(p.wx, p.wz); ok = true; }
      if (ok) {
        const rate = (12 - 7 * Math.min(speed / 9, 1)) * (p.tight ? 1.5 : 1);
        p.face += clamp(wrap(target - p.face), -rate * dt, rate * dt);
        p.face = wrap(p.face);
      }
    }
  }

  private slideContact(p: Player) {
    const b = this.ball, o = b.owner;
    if (o && o.team !== p.team && o.act !== ACT.HOLD) { // a keeper holding the ball is off-limits
      if (Math.hypot(o.x - p.x, o.z - p.z) < 1.15) {
        p.slideDone = true;
        // getting the ball first is clean; arriving from behind rarely is
        const fx = Math.sin(p.face), fz = Math.cos(p.face);
        const behind = Math.sin(o.face) * fx + Math.cos(o.face) * fz > 0.5;
        if (Math.random() < (behind ? 0.3 : 0.6)) this.winBall(p, o, 6);
        else this.foul(p, o, 'slide');
      }
    } else if (!o && Math.hypot(b.x - p.x, b.z - p.z) < 1.2 && b.y < 0.6) {
      p.slideDone = true;
      b.vx = p.slx * 9; b.vz = p.slz * 9; b.lastTouch = p; this.emit({ t: 'tackle', id: p.id });
    }
  }

  private separate() {
    const ps = this.field;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const c = ps[j];
        const dx = c.x - a.x, dz = c.z - a.z;
        if (dx > 0.7 || dx < -0.7 || dz > 0.7 || dz < -0.7) continue;
        const d = Math.hypot(dx, dz);
        if (d >= 0.62 || d < 1e-4) continue;
        const push = (0.62 - d) * 0.5, nx = dx / d, nz = dz / d;
        const wa = a.act === ACT.SLIDE ? 0 : 1, wc = c.act === ACT.SLIDE ? 0 : 1;
        if (wa + wc === 0) continue;
        a.x -= nx * push * (wa / (wa + wc)) * 2; a.z -= nz * push * (wa / (wa + wc)) * 2;
        c.x += nx * push * (wc / (wa + wc)) * 2; c.z += nz * push * (wc / (wa + wc)) * 2;
      }
    }
  }

  private enforceRestart() {
    const r = this.restart;
    if (!r || this.mode !== 'wait') return;
    for (const p of this.field) {
      if (p.id === r.taker) continue;
      const own = p.team === r.team;
      if (r.type === 'kickoff') {
        const d = this.dir[p.team];
        if (p.x * d > -0.3) p.x = -0.3 * d;
        if (!own) {
          const dd = Math.hypot(p.x, p.z);
          if (dd < CIRCLE + 0.3) { p.x = (p.x / (dd || 1)) * (CIRCLE + 0.3); p.z = (p.z / (dd || 1)) * (CIRCLE + 0.3); if (p.x * d > -0.3) p.x = -(CIRCLE + 0.3) * d; }
        }
      } else if (r.type === 'penalty') {
        if (this.pen && p === this.pen.keeper) continue;
        const s = Math.sign(r.x);
        if (p.x * s > HL - PEN_D - 1 && Math.abs(p.z) < PEN_HW + 1) p.x = s * (HL - PEN_D - 1.3);
        if (Math.hypot(p.x - r.x, p.z - r.z) < CIRCLE && p.x * s > r.x * s - 1) p.x = r.x - s * CIRCLE * 0.9;
      } else if (!own) {
        const R = r.type === 'corner' ? CIRCLE : 6.5;
        const dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz);
        if (d < R) { const k = d < 1e-3 ? 1 : R / d; p.x = r.x + (d < 1e-3 ? R : dx * k); p.z = r.z + (d < 1e-3 ? 0 : dz * k); }
        if (r.type === 'goalkick' && !p.gk) {
          const s = Math.sign(r.x);
          if (p.x * s > HL - PEN_D - 1 && Math.abs(p.z) < PEN_HW + 1) p.x = s * (HL - PEN_D - 1.3);
        }
      }
    }
  }

  // ------------------------------------------------------------ referee
  /** Diagonal system: stays ~10 m from play, on the far side of the ball, out of the passing lanes. */
  private updateRef(dt: number) {
    const r = this.ref, b = this.ball;
    r.cardT += dt;
    if (r.card && r.cardT > 2.6) r.card = 0;
    let tx: number, tz: number;
    if (this.so) { tx = HL - 13; tz = -7; }
    else {
      const side = b.z > 4 ? -1 : 1;
      tx = clamp(b.x - Math.sign(b.x || 1) * 5, -HL + 6, HL - 6);
      tz = clamp(b.z + side * 10, -HW + 3, HW - 3);
      for (const p of this.field) {
        const dd = Math.hypot(p.x - tx, p.z - tz);
        if (dd < 2) { tx += (tx - p.x) / (dd || 1) * (2 - dd); tz += (tz - p.z) / (dd || 1) * (2 - dd); }
      }
    }
    if (r.card) { tx = r.x; tz = r.z; }
    const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz);
    const want = d < 0.5 ? 0 : Math.min(7.5, d * 1.2);
    const ax = (d > 0 ? dx / d * want : 0) - r.vx, az = (d > 0 ? dz / d * want : 0) - r.vz;
    const al = Math.hypot(ax, az), amax = 12 * dt;
    r.vx += al > amax ? ax / al * amax : ax; r.vz += al > amax ? az / al * amax : az;
    r.x += r.vx * dt; r.z += r.vz * dt;
    const sp = Math.hypot(r.vx, r.vz);
    r.phase += sp * 3 * dt;
    const look = sp > 1 ? Math.atan2(r.vx, r.vz) : Math.atan2(b.x - r.x, b.z - r.z);
    r.face += clamp(wrap(look - r.face), -8 * dt, 8 * dt);
  }

  // ------------------------------------------------------------- ball
  private ballPhysics(dt: number) {
    const b = this.ball;
    if (b.owner) {
      const o = b.owner;
      b.lastTouch = o;
      if (o.gk && o.act === ACT.HOLD) { // keeper holds it in his hands
        b.x = o.x + Math.sin(o.face) * 0.32; b.z = o.z + Math.cos(o.face) * 0.32; b.y = 1.05;
        b.vx = b.vy = b.vz = 0;
        return;
      }
      const sp = Math.hypot(o.vx, o.vz);
      const dx = sp > 0.5 ? o.vx / sp : Math.sin(o.face), dz = sp > 0.5 ? o.vz / sp : Math.cos(o.face);
      const stride = 0.5 + 0.5 * Math.sin(o.phase * 1.0);
      let lead = (0.5 + sp * 0.075 + (o.sprint && sp > 6 ? 0.18 : 0)) * (0.78 + 0.4 * stride) * (sp < 0.5 ? 0.6 : 1);
      if (o.tight || o.shield) lead *= 0.7;
      let tx = o.x + dx * lead, tz = o.z + dz * lead;
      if (o.shield) { tx = o.x - Math.sin(o.face) * 0.45; tz = o.z - Math.cos(o.face) * 0.45; } // ball on the far side of the body
      b.vx = o.vx + (tx - b.x) * 14; b.vz = o.vz + (tz - b.z) * 14;
      if (b.y > BR + 0.005) { // chest/thigh trap: let it drop to the feet instead of snapping down
        b.vy = Math.min(b.vy, 0) - G * dt; b.y += b.vy * dt;
        if (b.y < BR) { b.y = BR; b.vy = 0; }
      } else { b.vy = 0; b.y = BR; }
      b.x += b.vx * dt; b.z += b.vz * dt;
      this.rollBall(dt);
      return;
    }
    const sp0 = Math.hypot(b.vx, b.vz);
    const air = b.y > BR + 0.03;
    if (b.spin !== 0 && sp0 > 0.5 && air) { // Magnus curve, perpendicular to travel
      const a = b.spin * sp0 * 0.25 * dt, nx = -b.vz / sp0, nz = b.vx / sp0;
      b.vx += nx * a; b.vz += nz * a;
    }
    if (air) {
      const s = Math.hypot(b.vx, b.vy, b.vz), k = DRAG * s * dt;
      b.vx -= b.vx * k; b.vz -= b.vz * k;
      b.vy -= G * dt + b.vy * k;
      b.spin *= Math.exp(-0.5 * dt);
    } else if (b.vy > 0) b.vy -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < BR) {
      b.y = BR;
      if (b.vy < -1.4) { this.emit({ t: 'bounce', v: -b.vy }); b.vy = -b.vy * 0.62; b.vx *= 0.92; b.vz *= 0.92; }
      else b.vy = 0;
    }
    if (b.y <= BR + 0.02 && b.vy === 0) {
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0) {
        const ns = Math.max(0, sp * Math.exp(-0.5 * dt) - 0.35 * dt);
        b.vx *= ns / sp; b.vz *= ns / sp;
        if (ns < 0.05) { b.vx = b.vz = 0; }
      }
    }
    this.collideGoals(dt);
    this.rollBall(dt);
  }

  private rollBall(dt: number) {
    const b = this.ball;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < 0.01) return;
    // axis = up x v ; angle = dist / r
    const ax = b.vz / sp, az = -b.vx / sp, ang = (sp * dt) / BR;
    const s = Math.sin(ang / 2), c = Math.cos(ang / 2);
    const dqx = ax * s, dqz = az * s, dqw = c;
    const { qx, qy, qz, qw } = b;
    b.qx = dqw * qx + dqx * qw - dqz * qy;
    b.qy = dqw * qy + dqz * qx - dqx * qz;
    b.qz = dqw * qz + dqz * qw + dqx * qy;
    b.qw = dqw * qw - dqx * qx - dqz * qz;
    const n = Math.hypot(b.qx, b.qy, b.qz, b.qw) || 1;
    b.qx /= n; b.qy /= n; b.qz /= n; b.qw /= n;
  }

  private collideGoals(dt: number) {
    const b = this.ball;
    for (const s of [-1, 1]) {
      // posts
      for (const pz of [-GOAL_HW, GOAL_HW]) {
        if (b.y > GOAL_H + 0.1) continue;
        const dx = b.x - s * HL, dz = b.z - pz, d = Math.hypot(dx, dz);
        if (d < BR + 0.08 && d > 1e-4) {
          const nx = dx / d, nz = dz / d, vn = b.vx * nx + b.vz * nz;
          if (vn < 0) { b.vx -= 1.4 * vn * nx; b.vz -= 1.4 * vn * nz; b.vx *= 0.8; b.vz *= 0.8; b.spin = 0; this.emit({ t: 'post', v: -vn }); }
          b.x = s * HL + nx * (BR + 0.08); b.z = pz + nz * (BR + 0.08);
        }
      }
      // crossbar
      if (Math.abs(b.z) < GOAL_HW) {
        const dx = b.x - s * HL, dy = b.y - GOAL_H, d = Math.hypot(dx, dy);
        if (d < BR + 0.08 && d > 1e-4) {
          const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
          if (vn < 0) { b.vx -= 1.4 * vn * nx; b.vy -= 1.4 * vn * ny; b.vx *= 0.8; b.vy = Math.min(b.vy * 0.8, 6); b.spin = 0; this.emit({ t: 'post', v: -vn }); }
        }
      }
      // net (only once the ball is behind the line and inside the frame)
      if (b.x * s > HL && Math.abs(b.z) < GOAL_HW + 0.3 && b.y < GOAL_H + 0.5) {
        const k = Math.exp(-2.5 * dt);
        b.vx *= k; b.vz *= k;
        if (b.x * s > HL + NET_D - BR) { b.x = s * (HL + NET_D - BR); b.vx *= -0.1; }
        if (Math.abs(b.z) > GOAL_HW - BR) { b.z = Math.sign(b.z) * (GOAL_HW - BR); b.vz *= -0.1; }
        if (b.y > GOAL_H + 0.25 - BR) { b.y = GOAL_H + 0.25 - BR; b.vy = Math.min(b.vy, 0); }
      }
    }
  }

  private humanOf(p: Player): Human | null {
    const h = this.humans[p.team];
    return this.humanActive(p.team) && h.ctrl === p ? h : null;
  }

  private interactions(dt: number) {
    const b = this.ball;
    // goalkeepers first
    for (const p of this.field) if (p.gk) this.gkContact(p);

    if (b.owner) {
      const o = b.owner;
      if (o.act === ACT.STUN || o.act === ACT.SLIDE || (!o.gk && b.y > 1.6) || Math.hypot(b.x - o.x, b.z - o.z) > 1.8) { b.owner = null; if (o.act === ACT.STUN) o.cool = 0.5; }
      else if (!o.gk) {
        // passive dispossession by pressing opponents (shielding makes it much harder)
        for (const p of this.field) {
          if (p.team === o.team || p.act !== ACT.NONE || p.gk) continue;
          if (Math.hypot(p.x - b.x, p.z - b.z) < 0.85) {
            let rate = 0.45 + (o.sprint && Math.hypot(o.vx, o.vz) > 6.5 && !o.tight ? 0.5 : 0);
            if (o.shield) rate *= 0.35;
            if (Math.random() < rate * dt * (0.6 + 0.4 * this.opts.level) * (this.humanActive(p.team) ? 1.1 : 1)) {
              b.owner = null; b.lastTouch = p;
              b.vx = p.vx * 0.9 + (Math.random() - 0.5) * 2; b.vz = p.vz * 0.9 + (Math.random() - 0.5) * 2;
              o.cool = 0.4; p.cool = 0; b.target = -1;
              this.emit({ t: 'tackle', id: p.id, victim: o.id, soft: true });
              break;
            }
          }
        }
      }
      return;
    }

    let best: Player | null = null, bd = 1e9, head = false;
    const bs = Math.hypot(b.vx, b.vz);
    for (const p of this.field) {
      if (p.gk || p.cool > 0 || (p.act !== ACT.NONE && p.act !== ACT.KICK && p.act !== ACT.CELEB && p.act !== ACT.TACKLE)) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (b.y < 1.45 && d < 0.85 + (p.act === ACT.TACKLE ? 0.4 : 0)) { if (d < bd) { bd = d; best = p; head = false; } }
      else if (b.y >= 1.45 && b.y < 2.35 && d < 0.85 && bs > 1.5 && b.vy < 1.5) { if (d < bd) { bd = d; best = p; head = true; } }
    }
    // diving header: a buffered shot / pass on a fast ball at waist height, lunging forward
    if (!best) {
      for (const h of this.humans) {
        const p = h.ctrl, it = h.intent;
        if (!p || !it || !this.humanActive(h.slot) || p.cool > 0 || p.act !== ACT.NONE || p.off) continue;
        if (it.kind !== 'shoot' && it.kind !== 'pass') continue;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (b.y > 0.45 && b.y < 1.3 && d > 0.8 && d < 1.7 && bs > 6 && p.x * this.dir[p.team] > HL - 20) {
          p.act = ACT.DHEAD; p.actT = 0; p.actDur = 0.9;
          const l = d || 1; p.vx = (b.x - p.x) / l * 6; p.vz = (b.z - p.z) / l * 6;
          p.face = Math.atan2(b.x - p.x, b.z - p.z);
          this.header(p, h, it);
          return;
        }
      }
      return;
    }
    const p = best;
    if (b.shot && b.lastTouch && b.lastTouch.team !== p.team) b.shot = false;
    const h = this.humanOf(p);
    if (head) {
      const it = h?.intent && h.intent.pid === p.id ? h.intent : null;
      if (h && !it) {
        // no button: chest / head it down and keep it (if it's not too hot)
        if (Math.hypot(b.vx - p.vx, b.vz - p.vz) < 14 + p.skill * 6) {
          b.owner = p; b.lastTouch = p; b.target = -1; b.shot = false; b.vx *= 0.3; b.vz *= 0.3; b.vy = Math.min(b.vy, 0);
          this.emit({ t: 'control', id: p.id, chest: true });
          return;
        }
      }
      this.header(p, h, it);
      return;
    }
    const rel = Math.hypot(b.vx - p.vx, b.vz - p.vz, b.y > 0.9 ? b.vy : 0);
    if (rel > 14 + p.skill * 8) { // too hot to control: it bounces off
      b.vx = b.vx * 0.4 + (Math.random() - 0.5) * 5; b.vz = b.vz * 0.4 + (Math.random() - 0.5) * 5;
      p.cool = 0.3; b.lastTouch = p; b.target = -1; b.shot = false;
      this.emit({ t: 'touch', id: p.id });
      return;
    }
    b.owner = p; b.lastTouch = p; b.target = -1; b.shot = false;
    this.emit({ t: 'control', id: p.id });
  }

  /**
   * Headers. Human with a button: ✕ headed pass, □ header at goal, ○ headed clearance, △ flick-on.
   * AI (or human with no button and a ball too hot to cushion): context decides.
   */
  private header(p: Player, h: Human | null, it: Intent | null) {
    const b = this.ball, d0 = this.dir[p.team];
    const gx = HL * d0;
    const gdist = Math.hypot(gx - p.x, p.z);
    const ownGoalDist = Math.hypot(-gx - p.x, p.z);
    const bs = Math.hypot(b.vx, b.vz);
    let kind: KickKind;
    if (it) kind = it.kind;
    else if (gdist < 20) kind = 'shoot';
    else if (ownGoalDist < 28) kind = 'lob';
    else kind = 'pass';
    if (h && it) h.intent = null;
    let dx = Math.sin(p.face), dz = Math.cos(p.face);
    const stick = h && (Math.abs(h.x) + Math.abs(h.y) > 20) ? (() => { const l = Math.hypot(h.x, h.y); return [h.x / l, h.y / l]; })() : null;
    let speed = Math.max(bs * 0.7, 10), vy = 3;
    const power = it ? it.power : 0.5;
    switch (kind) {
      case 'shoot': {
        let aimZ = (Math.random() - 0.5) * 4.4;
        if (stick && stick[0] * d0 > 0.3) aimZ = clamp(stick[1] / Math.max(stick[0] * d0, 0.3) * 3.6, -3.2, 3.2);
        dx = gx - p.x; dz = aimZ - p.z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
        speed = 11 + power * 9 + bs * 0.15;
        const dist = Math.hypot(gx - p.x, aimZ - p.z);
        vy = solveVy(speed, b.y, dist, 0.3 + Math.random() * 0.9);
        b.shot = true; this.stats.shots[p.team]++;
        break;
      }
      case 'pass': {
        const dir = stick ?? [dx, dz];
        const t = this.humanTarget(p, dir[0], dir[1], 'pass') || this.nearestTo(p.team, p.x + dir[0] * 12, p.z + dir[1] * 12, true, p);
        if (t) { dx = t.x - p.x; dz = t.z - p.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; speed = clamp(l * 0.9, 7, 14); b.target = t.id; b.targetT = 2; }
        vy = 2.5;
        break;
      }
      case 'lob': { // clearance: high and far, away from goal (or along the stick)
        if (stick) { dx = stick[0]; dz = stick[1]; } else { dx = d0; dz = (p.z > 0 ? 1 : -1) * 0.5; const l = Math.hypot(dx, dz); dx /= l; dz /= l; }
        speed = 15 + power * 4; vy = 7;
        break;
      }
      case 'through': { // flick-on into space towards goal
        if (stick) { dx = stick[0]; dz = stick[1]; } else { dx = d0; dz = -p.z * 0.02; const l = Math.hypot(dx, dz); dx /= l; dz /= l; }
        speed = 10 + power * 3; vy = 2;
        break;
      }
    }
    b.vx = dx * speed; b.vz = dz * speed; b.vy = vy; b.spin = 0;
    if (kind !== 'pass') b.target = -1;
    b.lastTouch = p;
    if (p.act !== ACT.DHEAD) { p.act = ACT.HEAD; p.actT = 0; p.actDur = 0.5; }
    p.cool = 0.5;
    this.offside.clear(); this.offKicker = p.id; this.prevTouch = p;
    if (kind !== 'shoot') this.markOffside(p, b.x);
    if (b.target >= 0 && h) this.setCtrl(h, this.players[b.target], 0.6);
    this.emit({ t: 'head', id: p.id, kind });
  }

  private gkContact(p: Player) {
    const b = this.ball;
    if (b.owner || p.cool > 0 || p.act === ACT.STUN) return;
    if (this.mode !== 'play') return;
    const diving = p.act === ACT.DIVE;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    const maxY = diving ? (p.diveHigh ? 2.55 : 1.9) : 2.1;
    if (d > (diving ? 1.9 : 1.25) || b.y > maxY) return;
    if (diving && !p.diveHigh && b.y > 1.5 && d > 1.2) return;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (b.lastTouch === p && p.cool > -0.4) return;
    const shot = b.shot && b.lastTouch && b.lastTouch.team !== p.team;
    const catchP = sp < 3.5 ? 1 : clamp(0.9 - sp * 0.017 - (diving ? 0.12 : 0), 0.15, 1);
    if (shot) this.stats.onTarget[b.lastTouch!.team]++;
    b.shot = false;
    if (Math.random() < catchP && (sp < 21 || diving)) {
      b.owner = p; b.lastTouch = p; b.vx = b.vy = b.vz = 0; b.target = -1; b.y = BR;
      p.act = ACT.HOLD; p.actT = 0; p.actDur = 999; p.holdT = 0; p.vx = p.vz = 0;
      this.emit({ t: 'save', caught: true, shot: !!shot, team: p.team });
    } else {
      const away = this.dir[p.team];
      b.vx = away * (2 + Math.random() * 6); b.vz = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 6); b.vy = 1 + Math.random() * 4;
      b.lastTouch = p; p.cool = 0.5; b.target = -1;
      this.emit({ t: 'save', caught: false, shot: !!shot, team: p.team });
    }
  }

  // ------------------------------------------------------------ rules
  private rules() {
    const b = this.ball;
    if (Math.abs(b.x) > HL + BR) {
      const s = Math.sign(b.x);
      if (Math.abs(b.z) < GOAL_HW - 0.02 && b.y < GOAL_H - 0.02) { this.goal(s); return; }
      if (this.so) { this.shootoutResult(false); return; }
      const lt = b.lastTouch ? b.lastTouch.team : 0;
      const defTeam = this.dir[0] === -s ? 0 : 1; // team defending the end at x = s*HL
      if (lt === defTeam) {
        const at = 1 - defTeam;
        this.stats.corners[at]++;
        this.setRestart('corner', at, s * (HL - 0.3), (b.z >= 0 ? 1 : -1) * (HW - 0.3));
      } else this.setRestart('goalkick', defTeam, s * (HL - 5.5), (b.z >= 0 ? 1 : -1) * 5);
      this.emit({ t: 'out' });
    } else if (Math.abs(b.z) > HW + BR) {
      if (this.so) { this.shootoutResult(false); return; }
      const lt = b.lastTouch ? b.lastTouch.team : 0;
      this.setRestart('throw', 1 - lt, clamp(b.x, -HL + 2, HL - 2), (b.z >= 0 ? 1 : -1) * (HW - 0.2));
      this.emit({ t: 'out' });
    }
  }

  private goal(s: number) {
    const b = this.ball;
    if (this.so) { this.shootoutResult(true); return; }
    const team = this.dir[0] === s ? 0 : 1;
    this.score[team]++;
    const lt = b.lastTouch;
    if (b.shot && lt) this.stats.onTarget[lt.team]++;
    const scorer = lt && lt.team === team ? lt : null;
    this.goalInfo = { team, scorer, side: s };
    this.mode = 'dead'; this.modeT = 0; this.replayPending = false;
    this.goalRingN = this.ringN;
    b.owner = null; b.shot = false;
    this.pen = null; this.adv = null;
    for (const h of this.humans) { h.charging = 0; h.intent = null; }
    for (const p of this.field) {
      if (p.team === team) { p.act = ACT.CELEB; p.actT = 0; p.actDur = 999; }
      else if (p.act !== ACT.NONE && p.act !== ACT.STUN) p.act = ACT.NONE;
    }
    this.emit({ t: 'goal', team, scorer: scorer ? scorer.id : -1, side: s, z: b.z, y: b.y, own: !scorer });
  }

  private deadBall(dt: number) {
    if (this.so) return;
    if (this.goalInfo && this.modeT > 3.2 && !this.replayPending) {
      if (this.opts.replay) { this.replayPending = true; this.mode = 'replay'; return; }
    }
    if (this.modeT > (this.opts.replay ? 3.3 : 4.5)) this.afterGoal();
  }

  /** Called when a replay finishes (or is skipped). */
  endReplay() {
    if (this.mode === 'replay') this.afterGoal();
  }

  private afterGoal() {
    const gi = this.goalInfo;
    for (const p of this.field) { p.act = ACT.NONE; }
    this.flushCards();
    if (this.time >= this.opts.halfLen) { this.endHalf(); return; }
    this.kickoff(gi ? 1 - gi.team : 0);
    this.emit({ t: 'whistle' });
  }

  private endHalf() {
    this.restart = null; this.ball.owner = null; this.pen = null;
    this.flushCards(); this.adv = null;
    for (const h of this.humans) { h.charging = 0; h.intent = null; }
    this.emit({ t: 'whistle3' });
    for (const p of this.field) { p.act = ACT.NONE; p.wx = p.wz = p.ws = 0; }
    if (this.half === 1) { this.mode = 'half'; this.modeT = 0; this.emit({ t: 'half' }); }
    else if (this.opts.pens && this.score[0] === this.score[1]) { this.startShootout(); }
    else { this.mode = 'full'; this.modeT = 0; this.emit({ t: 'full' }); }
  }

  clockText() {
    if (this.so) return 'PENS';
    const frac = clamp(this.time / this.opts.halfLen, 0, 1);
    const sec = Math.floor(frac * 45 * 60) + (this.half - 1) * 45 * 60;
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ----------------------------------------------------------- frames
  writeFrame(f: Float32Array) {
    const b = this.ball, r = this.ref;
    f[0] = b.x; f[1] = b.y; f[2] = b.z; f[3] = b.qx; f[4] = b.qy; f[5] = b.qz; f[6] = b.qw;
    const R = FRAME.REF;
    f[R] = r.x; f[R + 1] = r.z; f[R + 2] = r.face; f[R + 3] = r.phase; f[R + 4] = Math.hypot(r.vx, r.vz); f[R + 5] = r.card;
    const A = FRAME.AIM, pen = this.pen;
    const aiming = !!pen && pen.phase === 'aim' && this.humanActive(pen.team);
    f[A] = aiming ? 1 : 0;
    if (pen) { f[A + 1] = pen.d * HL; f[A + 2] = pen.aimY; f[A + 3] = pen.aimZ; }
    let o = FRAME.HDR;
    for (const p of this.players) {
      f[o] = p.x; f[o + 1] = p.z; f[o + 2] = p.face; f[o + 3] = p.phase;
      f[o + 4] = Math.hypot(p.vx, p.vz); f[o + 5] = p.act; f[o + 6] = p.actT; f[o + 7] = p.actDur;
      f[o + 8] = p.side * (p.diveHigh ? 2 : 1);
      let ctrl = 0, charge = 0;
      for (const h of this.humans) {
        if (!this.humanActive(h.slot)) continue;
        if (h.ctrl === p) {
          ctrl = 1 + h.slot;
          charge = h.charging ? clamp(h.chargeT / 0.75, 0, 1) : h.intent ? Math.max(h.intent.power, 0.05) : 0;
          if (pen && pen.taker === p && pen.charging) charge = clamp(pen.chargeT / 0.75, 0, 1);
        } else if (h.next === p && !ctrl) ctrl = 3 + h.slot;
      }
      f[o + 9] = ctrl; f[o + 10] = charge;
      o += FRAME.P;
    }
  }

  private pushFrame() {
    const t = this.prevFrame; this.prevFrame = this.curFrame; this.curFrame = t;
    this.writeFrame(this.curFrame);
    this.ring.set(this.curFrame, (this.ringN % RING) * this.frameLen);
    this.ringN++;
  }

  /** Frames leading up to (and just after) the last goal, for the replay. */
  exportReplay(before = 330, after = 120): Float32Array {
    const start = Math.max(0, this.goalRingN - before, this.ringN - RING);
    const end = Math.min(this.ringN, this.goalRingN + after);
    const n = Math.max(end - start, 2);
    const out = new Float32Array(n * this.frameLen);
    for (let i = 0; i < n; i++) {
      const idx = ((start + i) % RING) * this.frameLen;
      out.set(this.ring.subarray(idx, idx + this.frameLen), i * this.frameLen);
    }
    return out;
  }
}

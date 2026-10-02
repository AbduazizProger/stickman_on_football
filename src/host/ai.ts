// Team AI: formations, pressing, marking, dribbling, passing, set pieces and goalkeepers.
import { ACT } from '../shared/protocol';
import type { Game, Player, Penalty } from './sim';
import { HL, HW, GOAL_HW, PEN_D, PEN_HW, G, clamp } from './sim';

const tmp = [0, 0];

function goTo(p: Player, tx: number, tz: number, sprint: boolean, maxSpeed = 1) {
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d < 0.35) { p.wx = p.wz = p.ws = 0; p.sprint = false; return; }
  p.wx = dx / d; p.wz = dz / d;
  p.ws = Math.min(maxSpeed, Math.max(0.3, (d - 0.2) / 3));
  p.sprint = sprint && d > 3;
}

export function aiPlayer(g: Game, p: Player, dt: number) {
  p.wx = p.wz = p.ws = 0; p.sprint = false;
  const pen = g.pen;
  if (pen && (p === pen.taker || p === pen.keeper) && (pen.phase !== 'done' || (p === pen.keeper && pen.doneT < 0.6))) return; // scripted
  if (g.so) { // shootout: everyone else watches
    if (g.mode !== 'dead' || p.act !== ACT.CELEB) p.look = Math.atan2(HL - p.x, -p.z);
    if (!(pen && p === pen.keeper)) return;
  }
  switch (g.mode) {
    case 'dead': return celebrate(g, p);
    case 'wait': return waiting(g, p);
    case 'play': return playing(g, p, dt);
    default: return;
  }
}

// ------------------------------------------------------------ celebration
function celebrate(g: Game, p: Player) {
  const gi = g.goalInfo;
  if (!gi || p.act !== ACT.CELEB) return;
  const cx = gi.side * (HL - 7), cz = HW - 5;
  const sc = gi.scorer;
  if (sc === p) { if (g.modeT < 2.2) goTo(p, cx, cz, true); }
  else if (sc) {
    const d = Math.hypot(sc.x - p.x, sc.z - p.z);
    if (d > 5 && g.modeT < 2.6) goTo(p, sc.x, sc.z, true);
  }
}

// ------------------------------------------------------------ set pieces
function waiting(g: Game, p: Player) {
  const r = g.restart!;
  if (p.id === r.taker) {
    p.wx = p.wz = p.ws = 0;
    if (r.t > 1.0 + Math.random() * 0.002 && !humanTaker(g, p)) aiTake(g, p, r.type);
    return;
  }
  if (p.gk) return gkPosition(g, p);
  if (r.type === 'free' && p.team !== r.team && wallSlot(g, p) >= 0) return;
  const poss = r.team;
  g.formationTarget(p, poss, r.x, r.z, tmp);
  let tx = tmp[0], tz = tmp[1];
  if (r.type === 'corner') {
    const end = Math.sign(r.x);
    if (p.team === r.team && p.role !== 'DEF') { tx = end * (HL - 8 - (p.idx % 3) * 3); tz = ((p.idx % 5) - 2) * 4; }
    else if (p.team !== r.team && p.role !== 'FWD') { tx = end * (HL - 5 - (p.idx % 3) * 2.5); tz = ((p.idx % 5) - 2) * 3.4 + 1; }
  }
  goTo(p, tx, tz, Math.hypot(tx - p.x, tz - p.z) > 12, 0.9);
}

function humanTaker(g: Game, p: Player) {
  return g.humanActive(p.team) && g.humans[p.team].ctrl === p;
}

function aiTake(g: Game, p: Player, type: string) {
  const d = g.dir[p.team];
  const lvl = g.opts.level;
  p.face = Math.atan2(d, 0);
  if (type === 'penalty') return; // the penalty routine handles the run-up
  if (type === 'free') {
    const gd = Math.hypot(HL * d - p.x, p.z);
    if (gd < 30 && Math.random() < 0.6) { g.kick(p, 'shoot', 0.75, d, (Math.random() - 0.5) * 0.5); return; }
  }
  if (type === 'corner') {
    let best: Player | null = null, bs = 1e9;
    for (const q of g.field) {
      if (q.team !== p.team || q === p || q.gk) continue;
      const s = Math.hypot(q.x - Math.sign(g.restart!.x) * (HL - 9), q.z);
      if (s < bs) { bs = s; best = q; }
    }
    g.kick(p, 'lob', 0.6, 0, 0, best); return;
  }
  const c = bestPass(g, p, type !== 'kickoff');
  if (type === 'goalkick') { g.kick(p, 'lob', 0.7 + lvl * 0.1, 0, 0, c ? c.t : null); return; }
  if (type === 'kickoff') {
    const t = g.nearestTo(p.team, p.x, p.z, true, p);
    g.kick(p, 'pass', 0.2, 0, 0, t); return;
  }
  g.kick(p, c && c.kind === 'lob' ? 'lob' : 'pass', 0.4, 0, 0, c ? c.t : g.nearestTo(p.team, p.x, p.z, true, p));
}

// ---------------------------------------------------------------- play
function playing(g: Game, p: Player, dt: number) {
  if (p.gk) return gkAI(g, p, dt);
  const b = g.ball;
  if (b.owner === p) return ownerAI(g, p, dt);

  if (!b.owner && b.target === p.id && b.targetT > 0) {
    g.interceptPoint(p, tmp);
    goTo(p, tmp[0], tmp[1], Math.hypot(tmp[0] - p.x, tmp[1] - p.z) > 4); return;
  }
  const lvl = g.opts.level;
  if (g.chasers[p.team].has(p.id)) {
    const o = b.owner;
    let tx: number, tz: number;
    if (o) { tx = o.x + o.vx * 0.25; tz = o.z + o.vz * 0.25; } else { g.interceptPoint(p, tmp); tx = tmp[0]; tz = tmp[1]; }
    const d = Math.hypot(tx - p.x, tz - p.z);
    goTo(p, tx, tz, d > 3.5, d < 2.6 && o ? 0.8 : 1);
    if (o && o.team !== p.team && p.act === ACT.NONE) {
      const sp = Math.hypot(p.vx, p.vz);
      // only commit when not coming from behind (that's how fouls and cards happen), and rarely slide in our own box
      const rx = o.x - p.x, rz = o.z - p.z, rl = Math.hypot(rx, rz) || 1;
      const fromBehind = (Math.sin(o.face) * rx + Math.cos(o.face) * rz) / rl > 0.5;
      const own = -g.dir[p.team];
      const inOwnBox = o.x * own > HL - PEN_D && Math.abs(o.z) < PEN_HW;
      if (d < 1.7 && p.tackleCd <= 0 && Math.random() < dt * (fromBehind ? 0.5 : 1.3) * lvl) g.standingTackle(p);
      else if (d > 2.0 && d < 3.5 && sp > 5 && p.tackleCd <= 0 && (!fromBehind || Math.random() < 0.35) && !(inOwnBox && Math.random() < 0.85) && Math.random() < dt * 0.1 * lvl) g.slideTackle(p);
    }
    return;
  }
  position(g, p);
}

function position(g: Game, p: Player) {
  const b = g.ball, poss = g.possTeam();
  g.formationTarget(p, poss, b.x + b.vx * 0.3, b.z + b.vz * 0.3, tmp);
  let tx = tmp[0], tz = tmp[1];
  const d0 = g.dir[p.team];
  if (poss !== p.team && (p.role === 'DEF' || p.role === 'MID')) {
    // mark the nearest dangerous opponent
    let mark: Player | null = null, md = 16;
    for (const o of g.field) {
      if (o.team === p.team || o.gk || o === b.owner) continue;
      const d = Math.hypot(o.x - tx, o.z - tz);
      if (d < md) { md = d; mark = o; }
    }
    if (mark) {
      const ogx = -d0 * HL;
      let ux = ogx - mark.x, uz = -mark.z * 0.5; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
      tx = tx * 0.45 + (mark.x + ux * 2.2) * 0.55; tz = tz * 0.45 + (mark.z + uz * 2.2) * 0.55;
    }
  }
  // keep spacing from team-mates
  let sx = 0, sz = 0;
  for (const q of g.field) {
    if (q === p || q.team !== p.team) continue;
    const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
    if (d < 6 && d > 0.01) { const k = (6 - d) / 6; sx += (dx / d) * k * 3; sz += (dz / d) * k * 3; }
  }
  tx = clamp(tx + sx, -HL + 2, HL - 2); tz = clamp(tz + sz, -HW + 2, HW - 2);
  const far = Math.hypot(tx - p.x, tz - p.z);
  goTo(p, tx, tz, far > 9, 0.85);
}

// ----------------------------------------------------------- ball owner
function ownerAI(g: Game, p: Player, dt: number) {
  const d0 = g.dir[p.team];
  const gx = HL * d0;
  const lvl = g.opts.level;
  const gd = Math.hypot(gx - p.x, p.z);
  let near = 99;
  for (const o of g.field) if (o.team !== p.team) near = Math.min(near, Math.hypot(o.x - p.x, o.z - p.z));

  if (p.thinkT <= 0 && p.act === ACT.NONE) {
    p.thinkT = (0.18 + Math.random() * 0.2) / (0.5 + lvl * 0.6);
    // shoot?
    if (gd < 27) {
      let base = gd < 14 ? 0.5 : gd < 20 ? 0.28 : 0.1;
      if (near < 2) base *= 0.6;
      if (Math.random() < base * (0.6 + 0.6 * lvl)) {
        p.face = Math.atan2(gx - p.x, -p.z);
        g.kick(p, 'shoot', 0.5 + Math.random() * 0.38, 0, 0); return;
      }
    }
    const best = bestPass(g, p, false);
    const pressured = near < 3.2;
    const own = -d0 * HL;
    const inOwnThird = (p.x - own) * d0 < 30;
    if (p.passCd <= 0 && best &&
        ((pressured && best.score > 1.0) || (best.score > 3.6 && Math.random() < 0.45) || (inOwnThird && near < 5 && best.score > 1.5) || (Math.random() < 0.04 && best.score > 2))) {
      p.face = Math.atan2(best.t.x - p.x, best.t.z - p.z);
      g.kick(p, best.kind, 0.25 + Math.random() * 0.3, 0, 0, best.t);
      p.passCd = 0.6;
      return;
    }
    if (pressured && inOwnThird && !best && p.passCd <= 0) {
      g.kick(p, 'lob', 0.8, d0, (Math.random() - 0.5) * 0.8); p.passCd = 0.8; return;
    }
    steer(g, p);
  }
  p.wx = p.aiDx; p.wz = p.aiDz; p.ws = 1;
  p.sprint = near > 5.5 && gd > 12;
}

function steer(g: Game, p: Player) {
  const d0 = g.dir[p.team];
  const gx = HL * d0;
  let gdx = gx - p.x, gdz = -p.z * 0.7;
  const gl = Math.hypot(gdx, gdz) || 1; gdx /= gl; gdz /= gl;
  const base = Math.atan2(gdx, gdz);
  const prev = Math.atan2(p.aiDx, p.aiDz);
  let best = base, bs = -1e9;
  for (let k = -5; k <= 5; k++) {
    const a = base + k * 0.3;
    const dx = Math.sin(a), dz = Math.cos(a);
    let s = Math.cos(k * 0.3) - 0.15 * Math.abs(Math.atan2(Math.sin(a - prev), Math.cos(a - prev)));
    for (const o of g.field) {
      if (o.team === p.team) continue;
      const rx = o.x - p.x, rz = o.z - p.z, d = Math.hypot(rx, rz);
      if (d > 9 || d < 0.01) continue;
      const al = (dx * rx + dz * rz) / d;
      if (al > 0.3) s -= al * (1 - d / 9) * 2.4;
    }
    const px = p.x + dx * 3, pz = p.z + dz * 3;
    if (Math.abs(pz) > HW - 2.5) s -= 0.9;
    if (Math.abs(px) > HL - 2 && Math.abs(p.z) > GOAL_HW) s -= 0.7;
    if (s > bs) { bs = s; best = a; }
  }
  p.aiDx = Math.sin(best); p.aiDz = Math.cos(best);
}

// ------------------------------------------------------------- passing
export interface PassOpt { t: Player; kind: 'pass' | 'through' | 'lob'; score: number }

export function bestPass(g: Game, p: Player, allowGK: boolean): PassOpt | null {
  const d0 = g.dir[p.team];
  let best: PassOpt | null = null;
  for (const t of g.field) {
    if (t.team !== p.team || t === p) continue;
    if (t.gk && !allowGK && g.mode === 'play') continue;
    if (g.mode === 'play' && t.x * d0 > g.offLine[p.team] + 0.2) continue; // would be offside
    const rx = t.x - p.x, rz = t.z - p.z, d = Math.hypot(rx, rz);
    if (d < 5 || d > 46) continue;
    const lane = g.clearance(p.x, p.z, t.x, t.z, p.team);
    let open = 8;
    for (const o of g.field) if (o.team !== p.team) open = Math.min(open, Math.hypot(o.x - t.x, o.z - t.z));
    const forward = (rx * d0) / d;
    let score = forward * 3 + rx * d0 * 0.1 + open * 0.4 + Math.min(lane, 4) * 0.5 - d * 0.03 - (t.gk ? 3 : 0);
    let kind: PassOpt['kind'] = 'pass';
    if (lane < 1.6) { if (d > 12) { kind = 'lob'; score -= 1.2; } else continue; }
    else if (forward > 0.4 && Math.hypot(t.vx, t.vz) > 3 && rx * d0 > 10) kind = 'through';
    if (!best || score > best.score) best = { t, kind, score };
  }
  return best;
}

// ---------------------------------------------------------- goalkeeper
function gkPosition(g: Game, p: Player) {
  const own = -g.dir[p.team];
  const gx = own * (HL - 0.4);
  const b = g.ball;
  const dbx = b.x - gx, dbz = b.z, dist = Math.hypot(dbx, dbz) || 1;
  const k = clamp(0.14 * dist + 1.0, 1.2, 6);
  const tx = gx + (dbx / dist) * k, tz = clamp((dbz / dist) * k, -GOAL_HW - 1.2, GOAL_HW + 1.2);
  goTo(p, tx, tz, false, 0.85);
  p.face += 0; // faces movement; set explicitly below
  const want = Math.atan2(b.x - p.x, b.z - p.z);
  if (p.ws < 0.1) p.face = want;
}

function gkAI(g: Game, p: Player, dt: number) {
  const b = g.ball;
  const own = -g.dir[p.team];
  const d0 = g.dir[p.team];
  if (b.owner === p) {
    p.holdT += dt;
    p.wx = p.wz = p.ws = 0;
    if (p.holdT > 1.3) {
      const c = bestPass(g, p, false);
      p.face = Math.atan2(d0, 0);
      if (c) g.kick(p, c.kind === 'through' ? 'pass' : c.kind, 0.55, 0, 0, c.t);
      else g.kick(p, 'lob', 0.8, d0, 0);
    }
    return;
  }
  if (p.act === ACT.DIVE || p.act === ACT.HOLD) return;

  const sp = Math.hypot(b.vx, b.vz);
  if (!b.owner && sp > 7 && (own * HL - b.x) * b.vx > 0) {
    const tt = (p.x - b.x) / b.vx;
    if (tt > 0 && tt < 0.9) {
      const zp = b.z + b.vz * tt;
      const yp = b.y + b.vy * tt - 0.5 * G * tt * tt;
      if (Math.abs(zp) < GOAL_HW + 1.5 && yp < 3.2 && yp > -0.3) {
        const dz = zp - p.z;
        if (Math.abs(dz) > 1.0 && tt < 0.55 && p.cool <= 0 && Math.random() < 0.9 * (0.4 + g.opts.level * 0.6)) {
          const v = clamp(dz / (tt * 0.9), -9.5, 9.5);
          g.gkDive(p, Math.sign(v), yp > 1.5, Math.abs(v));
          return;
        }
        goTo(p, p.x, zp, true);
        return;
      }
    }
  }
  // keeper rush (△ held by the human defending): charge the ball
  if (g.rushT[p.team] > 0 && (!b.owner || b.owner.team !== p.team) && b.x * own > 5) {
    const t = b.owner || b;
    goTo(p, t.x, t.z, true); return;
  }
  // come out for loose balls in the box
  const inBox = (b.x * own) > HL - PEN_D && Math.abs(b.z) < PEN_HW;
  if (!b.owner && inBox && sp < 9) {
    const dme = Math.hypot(b.x - p.x, b.z - p.z);
    let closest = true;
    for (const q of g.field) if (q !== p && !q.gk && Math.hypot(b.x - q.x, b.z - q.z) < dme * 0.9) { closest = false; break; }
    if (closest) { goTo(p, b.x, b.z, true); return; }
  }
  gkPosition(g, p);
}

// ---------------------------------------------------------- free-kick wall
/** Up to 3 defenders form a wall 9.15 m from the ball on the line to goal when a free kick is in shooting range. */
function wallSlot(g: Game, p: Player) {
  const r = g.restart!;
  const gx = -g.dir[p.team] * HL;
  const dx = gx - r.x, dz = -r.z, dist = Math.hypot(dx, dz);
  if (dist > 32 || dist < 12) return -1;
  const ux = dx / dist, uz = dz / dist;
  const wx = r.x + ux * 9.4, wz = r.z + uz * 9.4;
  const size = dist < 22 ? 4 : 3;
  const cands = g.field.filter((q) => q.team === p.team && !q.gk)
    .sort((a, c) => Math.hypot(a.x - wx, a.z - wz) - Math.hypot(c.x - wx, c.z - wz) || a.id - c.id)
    .slice(0, size).sort((a, c) => a.id - c.id);
  const k = cands.indexOf(p);
  if (k < 0) return -1;
  const off = (k - (size - 1) / 2) * 0.7;
  goTo(p, wx - uz * off, wz + ux * off, true);
  if (p.ws < 0.05) p.face = Math.atan2(r.x - p.x, r.z - p.z);
  return k;
}

// ------------------------------------------------------------- penalties
/** CPU penalty taker: pick a side and height; better takers go closer to the corners. */
export function penaltyAim(g: Game, pen: Penalty) {
  const r = Math.random();
  const side = Math.random() < 0.5 ? -1 : 1;
  if (r < 0.12) { pen.aimZ = (Math.random() - 0.5) * 0.8; pen.aimY = 0.8 + Math.random() * 0.8; }
  else { pen.aimZ = side * (1.6 + Math.random() * (1.4 + pen.taker.skill * 0.4)); pen.aimY = 0.3 + Math.random() * 1.6; }
  pen.power = 0.55 + Math.random() * 0.3;
  pen.mod = Math.random() < 0.04 ? 'chip' : Math.random() < 0.3 ? 'finesse' : '';
  void g;
}

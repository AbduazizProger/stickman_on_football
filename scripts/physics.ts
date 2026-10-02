// Shot heights at the goal line and lob accuracy, per power level.
import { Game, HL, GOAL_H, GOAL_HW } from '../src/host/sim';

const g = new Game();
g.setup({ size: 11, halfLen: 999, level: 0.75, replay: false, pens: true });
g.startMatch();
g.mode = 'play'; g.restart = null;
const shooter = g.players[9];
const keeper = g.players.find((p) => p.gk && p.team === 1)!;

function shot(power: number, dist: number) {
  const b = g.ball;
  shooter.x = HL - dist; shooter.z = 0; shooter.face = Math.PI / 2; shooter.cool = 0; shooter.act = 0;
  shooter.skill = 0.85;
  for (const p of g.players) if (p !== shooter) { p.x = -40; p.z = p.id; }
  keeper.x = -45;
  b.x = shooter.x + 0.6; b.z = 0; b.y = 0.2; b.vx = b.vy = b.vz = 0; b.owner = shooter;
  g.mode = 'play';
  g.kick(shooter, 'shoot', power, 1, 0);
  let maxY = 0;
  for (let i = 0; i < 400; i++) {
    (g as any).ballPhysics(1 / 60);
    maxY = Math.max(maxY, b.y);
    if (b.x >= HL) return { y: b.y, z: b.z, maxY };
    if (Math.hypot(b.vx, b.vz) < 1) break;
  }
  return { y: -1, z: 0, maxY };
}
for (const dist of [12, 20, 28]) {
  for (const power of [0.2, 0.5, 0.8, 0.95, 1]) {
    let on = 0, over = 0, wide = 0, ys: number[] = [], mx = 0;
    for (let i = 0; i < 300; i++) {
      const r = shot(power, dist);
      mx = Math.max(mx, r.maxY);
      if (r.y < 0) continue;
      ys.push(r.y);
      if (r.y > GOAL_H) over++; else if (Math.abs(r.z) > GOAL_HW) wide++; else on++;
    }
    ys.sort((a, b) => a - b);
    const med = ys[Math.floor(ys.length / 2)] ?? -1;
    console.log(`dist ${dist}m power ${power}: on ${(on / 3).toFixed(0)}% over ${(over / 3).toFixed(0)}% wide ${(wide / 3).toFixed(0)}%  median height ${med.toFixed(2)}m  peak ${mx.toFixed(2)}m`);
  }
}
// lob accuracy
const passer = g.players[5];
for (const d of [15, 30, 45]) {
  passer.x = 0; passer.z = 0; passer.cool = 0; passer.act = 0; passer.face = Math.PI / 2;
  const b = g.ball; b.x = 0.5; b.z = 0; b.y = 0.2; b.vx = b.vy = b.vz = 0; b.owner = passer; b.spin = 0;
  g.offside.clear();
  const t = g.players[8]; t.x = d; t.z = 0; t.vx = t.vz = 0;
  for (const p of g.players) if (p !== passer && p !== t) { p.x = -45; p.z = p.id - 10; }
  g.mode = 'play';
  g.kick(passer, 'lob', 0.5, 0, 0, t);
  let landX = 0, peak = 0;
  let pvy = 1;
  for (let i = 0; i < 400; i++) { (g as any).ballPhysics(1 / 60); peak = Math.max(peak, b.y); if (i > 5 && pvy < 0 && b.vy >= 0) { landX = b.x; break; } pvy = b.vy; }
  console.log(`lob ${d}m: lands at ${landX.toFixed(1)}m, peak ${peak.toFixed(1)}m`);
}

import { Game, DT } from '../src/host/sim';
import { BTN } from '../src/shared/protocol';

const g = new Game();
g.setup({ size: 11, halfLen: 90, level: 0.75, replay: true, pens: true });
g.humans[0].connected = true; g.humans[1].connected = true;
g.startMatch();
const bits = [BTN.PASS, BTN.SHOOT, BTN.LOB, BTN.THROUGH, BTN.SPRINT, BTN.SWITCH, BTN.R1, BTN.L2];
const counts: Record<string, number> = {};
let steps = 0, replays = 0;
const t0 = Date.now();
while (g.mode !== 'full' && steps < 60 * 60 * 8) {
  for (const h of g.humans) {
    if (Math.random() < 0.05) { h.x = Math.round((Math.random() * 2 - 1) * 100); h.y = Math.round((Math.random() * 2 - 1) * 100); }
    if (Math.random() < 0.08) {
      const bit = bits[Math.floor(Math.random() * bits.length)];
      const old = h.b; const nb = h.b ^ bit;
      h.pressed |= nb & ~old; h.released |= old & ~nb; h.b = nb;
    }
  }
  if (g.mode === 'replay') { g.exportReplay(); replays++; g.endReplay(); }
  g.step(); steps++;
  for (const e of g.events) { counts[e.t] = (counts[e.t] || 0) + 1; if (e.t === 'save' && counts.save < 8) console.log(steps, JSON.stringify(e), g.ball.x.toFixed(1), g.ball.y.toFixed(2), g.ball.z.toFixed(1), g.mode, g.ball.owner?.id, g.ball.lastTouch?.id, g.ball.vx.toFixed(1)); }
  g.events.length = 0;
  const b = g.ball;
  if (![b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite)) throw new Error('ball NaN at step ' + steps);
  for (const p of g.players) if (![p.x, p.z, p.vx, p.vz, p.face].every(Number.isFinite)) throw new Error('player NaN ' + p.id);
}
console.log(`done ${(steps * DT).toFixed(0)}s sim in ${Date.now() - t0}ms mode=${g.mode} score=${g.score} replays=${replays}`);
console.log(JSON.stringify(counts));
console.log(JSON.stringify(g.stats));

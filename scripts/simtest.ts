import { Game, DT } from '../src/host/sim';

for (const size of [7, 11] as const) {
  const g = new Game();
  g.setup({ size, halfLen: 120, level: 0.75, replay: false, pens: true });
  g.startMatch();
  const counts: Record<string, number> = {};
  let steps = 0, nan = false, ownerChanges = 0, lastOwner: any = null, maxBall = 0;
  while (g.mode !== 'full' && steps < 60 * 60 * 6) {
    g.step(); steps++;
    for (const e of g.events) counts[e.t] = (counts[e.t] || 0) + 1;
    g.events.length = 0;
    if (g.ball.owner !== lastOwner) { ownerChanges++; lastOwner = g.ball.owner; }
    if (!isFinite(g.ball.x + g.ball.y + g.ball.z)) { nan = true; break; }
    maxBall = Math.max(maxBall, Math.hypot(g.ball.x, g.ball.z));
    for (const p of g.players) if (!isFinite(p.x + p.z)) nan = true;
    if (g.mode === 'half') { /* proceeds automatically */ }
  }
  console.log(`size ${size}: ${(steps * DT).toFixed(0)}s mode=${g.mode} score=${g.score} nan=${nan} ownerChanges=${ownerChanges}`);
  console.log('  events', JSON.stringify(counts));
  console.log('  stats', JSON.stringify(g.stats));
}

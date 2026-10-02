// Scenario tests: FIFA controls, buffered first-time play, headers, switching, discipline, penalties, shootout.
import { Game, HL, type Player } from '../src/host/sim';
import { ACT, BTN } from '../src/shared/protocol';

let fails = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };

function fresh(humans = 1) {
  const g = new Game();
  g.setup({ size: 11, halfLen: 999, level: 0.75, replay: false, pens: true });
  g.humans[0].connected = true;
  if (humans > 1) g.humans[1].connected = true;
  g.startMatch();
  g.mode = 'play'; g.restart = null;
  for (const p of g.players) if (p.team === 1) { p.x = 40 + (p.id % 3); p.z = (p.id - 16) * 3; }
  return g;
}
function press(g: Game, bit: number, slot = 0) { const h = g.humans[slot]; h.pressed |= bit & ~h.b; h.b |= bit; }
function release(g: Game, bit: number, slot = 0) { const h = g.humans[slot]; h.released |= bit & h.b; h.b &= ~bit; }
function tap(g: Game, bit: number, frames = 4, slot = 0) { press(g, bit, slot); run(g, frames); release(g, bit, slot); run(g, 1); }
function run(g: Game, steps: number, each?: () => void) { for (let i = 0; i < steps; i++) { g.step(); each?.(); } }
function events(g: Game, steps: number, pred: (e: any) => boolean) {
  let hit: any = null;
  run(g, steps, () => { for (const e of g.events) if (!hit && pred(e)) hit = e; g.events.length = 0; });
  return hit;
}
function giveBall(g: Game, p: Player, face = Math.PI / 2) {
  p.face = face; p.cool = 0; p.act = ACT.NONE;
  g.ball.x = p.x + Math.sin(face) * 0.6; g.ball.z = p.z + Math.cos(face) * 0.6; g.ball.y = 0.2;
  g.ball.vx = g.ball.vy = g.ball.vz = 0; g.ball.owner = p; g.ball.lastTouch = p;
  g.humans[p.team].ctrl = p;
}

// 1) pass, then press □ while the ball travels -> no tackle/slide, receiver shoots first-time
{
  const g = fresh();
  const passer = g.players[6], recv = g.players[9];
  passer.x = 0; passer.z = 0; recv.x = 18; recv.z = 2;
  giveBall(g, passer); run(g, 2);
  g.humans[0].x = 100; tap(g, BTN.PASS, 6); g.humans[0].x = 0;
  check('pass released toward receiver', g.ball.owner === null && g.ball.target === recv.id, `target=${g.ball.target}`);
  check('control switched to receiver', g.humans[0].ctrl === recv);
  run(g, 8); tap(g, BTN.SHOOT, 20);
  const it = g.humans[0].intent;
  check('shot buffered while ball in flight', !!it && it.kind === 'shoot', JSON.stringify(it && { kind: it.kind, power: +it.power.toFixed(2) }));
  check('no slide/tackle fired', recv.act !== ACT.SLIDE && recv.act !== ACT.TACKLE);
  const e = events(g, 90, (e) => e.t === 'kick' && e.kind === 'shoot' && e.id === recv.id);
  check('receiver shot first-time on arrival', !!e);
}

// 2) receiver assist: with no stick input the receiver runs onto a through ball
{
  const g = fresh();
  const passer = g.players[6], recv = g.players[9];
  passer.x = 0; passer.z = 0; recv.x = 15; recv.z = 8;
  giveBall(g, passer); run(g, 2);
  g.humans[0].x = 100; tap(g, BTN.THROUGH, 4); g.humans[0].x = 0;
  let got = false;
  run(g, 180, () => { if (g.ball.owner === recv) got = true; });
  check('receiver ran onto the through ball', got);
}

// 3) shot modifiers: □□ low, R1+□ finesse, L1+□ chip, L1+R1+□ power
for (const [name, bits, taps, want] of [['double tap □ = low shot', 0, 2, 'low'], ['R1+□ = finesse', BTN.R1, 1, 'finesse'],
  ['L1+□ = chip', BTN.SWITCH, 1, 'chip'], ['L1+R1+□ = power shot', BTN.SWITCH | BTN.R1, 1, 'power']] as const) {
  const g = fresh();
  const p = g.players[9]; p.x = 30; p.z = 0;
  giveBall(g, p); run(g, 2);
  g.humans[0].x = 100;
  if (bits) press(g, bits);
  for (let i = 0; i < taps; i++) { press(g, BTN.SHOOT); run(g, 3); release(g, BTN.SHOOT); run(g, 3); }
  if (bits) release(g, bits);
  const e = events(g, 40, (e) => e.t === 'kick');
  check(name, !!e && e.mod === want, `got ${e && e.mod}`);
}

// 4) crosses: ○ from the wing aims at a team-mate in the box; ○○○ is a ground cross
{
  for (const [taps, ground] of [[1, false], [3, true]] as const) {
    const g = fresh();
    for (const p of g.players) if (p.team === 1 && !p.gk) { p.x = -30; p.z = p.id - 16; }
    const w = g.players[8], st = g.players[9];
    w.x = 38; w.z = 24; st.x = 41; st.z = 1;
    giveBall(g, w, Math.PI); run(g, 2);
    for (let i = 0; i < taps; i++) { press(g, BTN.LOB); run(g, 3); release(g, BTN.LOB); run(g, 3); }
    let target = -2, peak = 0, mod = '';
    run(g, 40, () => {
      for (const e of g.events) if (e.t === 'kick' && e.id === w.id) { target = g.ball.target; mod = e.mod; }
      g.events.length = 0;
      if (target !== -2) peak = Math.max(peak, g.ball.y);
    });
    check(`${ground ? 'ground cross ○○○' : 'cross ○'} targets the striker`, target === st.id && (ground ? peak < 0.4 && mod === 'ground' : peak > 2), `target=${target} peak=${peak.toFixed(2)} mod=${mod}`);
  }
}

// 5) header: buffered □ on a cross = header at goal; no button = chest control
for (const withButton of [true, false]) {
  const g = fresh();
  const w = g.players[8], st = g.players[9];
  w.x = 36; w.z = 22; st.x = 42; st.z = 0;
  for (const p of g.players) if (p.team === 1) { p.x = -40; p.z = p.id - 16; }
  const gk = g.players.find((p) => p.gk && p.team === 1)!; gk.x = HL - 0.5; gk.z = -3;
  giveBall(g, w, Math.PI); run(g, 2);
  g.kick(w, 'lob', 0.5, 0, 0, st);
  g.humans[0].ctrl = st;
  run(g, 10);
  if (withButton) tap(g, BTN.SHOOT, 5);
  let head: any = null, ctl = false;
  run(g, 120, () => { for (const e of g.events) { if (e.t === 'head' && e.id === st.id) head = head || e; if (e.t === 'control' && e.id === st.id) ctl = true; } g.events.length = 0; });
  if (withButton) check('□ on a high ball = header at goal', !!head && head.kind === 'shoot', JSON.stringify(head));
  else check('no button on a high ball = chest / head control', ctl || g.ball.owner === st, `head=${JSON.stringify(head)}`);
}

// 6) defending: ✕ held = contain (goal-side, close), ✕ is not a tackle, ○ is
{
  const g = fresh();
  const carrier = g.players[20], me = g.players[5];
  carrier.x = 10; carrier.z = 0; me.x = 0; me.z = 6;
  giveBall(g, carrier, -Math.PI / 2);
  g.humans[0].ctrl = me; g.humans[0].lock = 5;
  press(g, BTN.PASS); run(g, 90);
  const d1 = Math.hypot(carrier.x - me.x, carrier.z - me.z);
  const goalSide = (me.x - carrier.x) * -1 > 0; // team 0 defends -x
  check('✕ held = contain (close & goal-side)', d1 < 3 && goalSide, `dist=${d1.toFixed(1)} me.x=${me.x.toFixed(1)} carrier.x=${carrier.x.toFixed(1)}`);
  check('✕ while defending is not a tackle', me.act !== ACT.TACKLE);
  release(g, BTN.PASS);
  me.act = ACT.NONE; me.tackleCd = 0;
  me.x = carrier.x - 1.0; me.z = carrier.z; me.face = Math.PI / 2;
  g.ball.owner = carrier;
  press(g, BTN.LOB); run(g, 1);
  check('○ while defending = standing tackle', me.act === ACT.TACKLE);
}

// 7) switching: bunched team-mates around a loose ball should not flicker
{
  let maxSwitches = 0;
  for (let trial = 0; trial < 20; trial++) {
    const g = fresh();
    const ps = [g.players[5], g.players[6], g.players[7]];
    ps.forEach((p, i) => { p.x = -2 + i * 1.6; p.z = (i - 1) * 1.8; });
    const opp = g.players[20]; opp.x = 6; opp.z = 0;
    g.ball.owner = null; g.ball.lastTouch = opp; g.ball.x = 2; g.ball.z = 0.5; g.ball.vx = -3 + Math.random() * 2; g.ball.vz = (Math.random() - 0.5) * 4;
    g.humans[0].ctrl = ps[0];
    let switches = 0, last: Player | null = g.humans[0].ctrl;
    run(g, 150, () => { if (g.humans[0].ctrl !== last) { switches++; last = g.humans[0].ctrl; } });
    maxSwitches = Math.max(maxSwitches, switches);
  }
  check('no selector flicker with bunched players (max auto switches in 2.5 s)', maxSwitches <= 2, `max=${maxSwitches}`);
}

// 8) L1 picks the best player, a second tap cycles to the next one
{
  const g = fresh();
  const carrier = g.players[20]; carrier.x = 0; carrier.z = 0;
  giveBall(g, carrier, -Math.PI / 2);
  const far = g.players[1]; far.x = -35; far.z = -20;
  g.humans[0].ctrl = far; g.humans[0].lock = 0;
  g.players[6].x = -3; g.players[6].z = 1;
  tap(g, BTN.SWITCH, 2);
  const first = g.humans[0].ctrl;
  tap(g, BTN.SWITCH, 2);
  const second = g.humans[0].ctrl;
  check('L1 switches to the best-placed player', first === g.players[6], `got #${first?.num}`);
  check('second L1 cycles to another player', second !== first && second !== far);
}

// 9) offside
{
  const g = fresh();
  const passer = g.players[6], fwd = g.players[9];
  for (const p of g.players) if (p.team === 1 && !p.gk) { p.x = 20; p.z = 14 + (p.id % 4) * 3; }
  passer.x = 0; passer.z = 0; fwd.x = 30; fwd.z = 0;
  giveBall(g, passer);
  g.kick(passer, 'pass', 0.5, 0, 0, fwd);
  check('offside called', !!events(g, 240, (e) => e.t === 'offside'));
}

// 10) cards: a last-man foul is a red (DOGSO); fouls from behind earn yellows sometimes
{
  const g = fresh();
  const att = g.players[9], def = g.players[16];
  for (const p of g.players) if (p.team === 1 && !p.gk && p !== def) { p.x = -30; p.z = p.id - 16; }
  att.x = 30; att.z = 0; giveBall(g, att);
  def.x = 29; def.z = 0; def.face = Math.PI / 2; // right behind him
  let card: any = null;
  for (let i = 0; i < 40 && !card; i++) {
    def.act = ACT.NONE; def.tackleCd = 0; att.act = ACT.NONE; g.mode = 'play'; g.restart = null;
    giveBall(g, att); def.x = att.x - 0.9; def.z = att.z; def.face = Math.PI / 2;
    g.standingTackle(def);
    for (const e of g.events) if (e.t === 'card') card = e;
    g.events.length = 0;
  }
  check('last-man foul = red card, player sent off', !!card && card.color === 'red' && def.off, JSON.stringify(card));
  check('sent-off player removed from the pitch', !g.field.includes(def));
}

// 11) penalty: human taker aims high right; ball goes that way
{
  const g = fresh();
  g.setRestart('penalty', 0, HL - 11, 0);
  run(g, 5);
  g.humans[0].x = 100; g.humans[0].y = -100; // right & up -> world +z (attacking +x), high
  run(g, 3);
  press(g, BTN.SHOOT); run(g, 30); release(g, BTN.SHOOT);
  let shot = false;
  run(g, 60, () => { for (const e of g.events) if (e.t === 'kick') shot = true; g.events.length = 0; });
  const pen = g.pen;
  check('penalty: run-up then strike', shot);
  check('penalty: aimed side respected', !!pen && pen.aimZ > 2 && pen.aimY > 1.7, pen ? `aimZ=${pen.aimZ.toFixed(1)} aimY=${pen.aimY.toFixed(1)}` : '');
}

// 12) penalty: human keeper dives with stick + button
{
  const g = fresh(2);
  g.setRestart('penalty', 0, HL - 11, 0);
  run(g, 5);
  const k = g.pen!.keeper;
  g.humans[1].x = -100; tap(g, BTN.PASS, 2, 1);
  check('penalty: human keeper dives', k.act === ACT.DIVE && Math.sign(k.vz) === -1, `act=${k.act} vz=${k.vz.toFixed(1)}`);
}

// 13) shootout from a draw finishes with a winner
{
  const g = new Game();
  g.setup({ size: 7, halfLen: 0.05, level: 0.75, replay: false, pens: true });
  g.startMatch();
  let steps = 0;
  while (g.mode !== 'full' && steps < 60 * 400) { g.step(); g.events.length = 0; steps++; if (g.mode === 'replay') g.endReplay(); }
  const so = g.so;
  const tally = so ? so.res.map((r) => r.join('')).join(' vs ') : '';
  check('penalty shootout decided', !!so && so.winner >= 0, `${tally} score=${g.score}`);
}
process.exit(fails ? 1 : 0);

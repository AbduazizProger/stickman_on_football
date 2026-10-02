# Stickman Football

A PES/FIFA-style football game for the desktop browser. Two players scan a QR code each and their **phones become the controllers**. Headless stickmen are told apart by their kits.

## Run it

```bash
npm install
npm run dev          # relay server (:3001) + Vite (:5173)
```

Open **http://localhost:5173** on the big screen (laptop/TV). The lobby shows two QR codes — the phones must be on the **same Wi‑Fi**. The QR links use your LAN IP automatically (override with `LAN_IP=192.168.x.x npm run dev` if the wrong interface is picked).

Production: `npm run build && npm start` (single server on `:3001`, serves the game and the WebSocket relay).

## Playing

Each phone: pick a kit with ‹ ›, tap **I'M READY**. The match starts when everyone connected is ready (or press **Enter** on the big screen). One phone → you vs the CPU. Tap **?** on the pad for the full control sheet.

The phone is a PlayStation-style pad with the **FIFA control scheme**: ✕ ○ □ △ face buttons, L1/L2/R1/R2 shoulders in the top corners, a floating stick on the left (push it past the ring to sprint).

**Attacking**

| Button | Action |
|---|---|
| ✕ | short pass (hold = power) · **R1+✕** driven pass |
| △ | through ball · **L1+△** lobbed through ball |
| ○ | lob pass / cross from the wing · **○○** low cross · **○○○** ground cross |
| □ | shot (hold = power, aim with the stick) · **□□** low shot · **R1+□** finesse · **L1+□** chip · **L1+R1+□** power shot |
| R2 | sprint · **R1** close control (R1+R2 controlled sprint) · **L2** shield the ball |

**Defending**

| Button | Action |
|---|---|
| ✕ (hold) | contain – get goal-side of the carrier and stay with him |
| ○ | standing tackle |
| □ | slide tackle |
| R1 (hold) | team-mate contain |
| △ (hold) | keeper rushes out |
| L1 | switch player (best-placed first, tap again to cycle) · next candidate is shown with a faint ring |
| L2 | jockey |

**First time & headers:** while a pass is coming, control is on the receiver and any button is buffered – it's played the moment the ball arrives (first-time pass/shot/volley). If the ball arrives in the air: ✕ headed pass, □ header at goal, ○ headed clearance, △ flick-on; on a fast low cross a buffered □ becomes a diving header. No button = chest/head control.

**Penalties:** the camera goes behind the taker. Aim with the stick (a reticle shows the target), hold □ for power, release to run up. **L1+□** = chip (Panenka), **R1+□** = placed. Aiming close to the post or blasting it is risky. As the keeper: move along the line with the stick and press any face button to dive that way (stick up = high dive) – go too early and the CPU will put it the other way.

**Rules:** fouls are judged by angle, speed and tackle type → yellow / red cards (two yellows = red; denying an obvious goal-scoring chance = red), sent-off players leave the pitch. Advantage is played when the fouled side keeps the ball (brought back if it's lost within 2.5 s). Offside, free kicks with a wall, penalties, and an optional **penalty shootout** after a draw.

**Camera** (lobby option, or **C** during a match): *Tele* (FIFA's default – follows the ball along and across the pitch with look-ahead and constant zoom), *Broadcast* (fixed on the stand, pans and zooms), *Wide*. Corners, free kicks and penalties cut to dedicated angles; goal replays switch angles with a slow-motion second half. With two players the camera frames both.

Keyboard fallback for player 1: WASD move, J ✕, K □, L ○, I △, Shift R2, Q L1, E R1, Space L2. `Esc` pauses, `Enter` kicks off / rematches / skips replays, `C` changes camera, `M` goes back to the menu.

## What's in the game

- Fixed 60 Hz simulation (`src/host/sim.ts`), interpolated rendering, custom ball physics (quadratic drag, bounce, spin curve, posts/crossbar, net) and a 3 s ball-flight prediction shared by the AI and player switching
- 11v11 or 7v7, formations that shift with the ball, marking, pressing, off-ball runs, AI dribble steering, passing/shooting, careful tackling (`src/host/ai.ts`)
- FIFA-style auto switching with hysteresis + debounce (no flicker in crowded areas), instant switch on passes and turnovers
- Goalkeepers: positioning, dives (low/high), catches/parries, rushing out, distribution
- Rules: offside, fouls, advantage, yellow/red cards and send-offs, free kicks with walls, penalties, corners, throw-ins, goal kicks, two halves, penalty shootout; a referee who follows play and shows the cards
- Presentation: FIFA-style camera director (`src/host/camera.ts`), set-piece cut-scenes, multi-angle slow-mo replays, HUD with radar, card banners, shootout tracker, crowd + synthesized SFX, phone haptics
- Procedural headless stickmen with swappable kits (stripes / hoops / halves / sash, shirt numbers) – `src/host/stickman.ts`

## Layout

```
server/index.mjs     rooms + WebSocket relay + static hosting
src/shared/          protocol, kits
src/host/            game screen (sim, ai, render, stadium, stickman, ui, audio, net)
src/pad/             phone controller
scripts/             headless tests: simtest (AI v AI), fuzz (random input), controls (scenarios), physics (shot/lob flight)
```

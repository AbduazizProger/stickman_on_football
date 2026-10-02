// FIFA-style camera director.
//  - "Tele Broadcast" (default): tracks the ball along the pitch AND across it (dollies in/out with the ball's depth),
//    keeps a constant on-screen scale by adjusting the FOV, and looks ahead in the direction of play.
//  - "Broadcast": stays near the halfway line on the stand and pans/zooms.
//  - "Wide": a higher, further version of Tele for seeing more of the pitch.
//  Set pieces cut to dedicated angles (corner, free kick, penalty), replays alternate angles, co-op framing keeps
//  both controlled players in view.
import * as THREE from 'three';
import { HL, HW } from './sim';

export type CamStyle = 'tele' | 'broadcast' | 'wide';
export type CamMode = 'lobby' | 'play' | 'celebrate' | 'replay' | 'corner' | 'penalty' | 'freekick' | 'end';

export interface CamInput {
  mode: CamMode;
  bx: number; by: number; bz: number; bvx: number; bvz: number;
  /** attacking direction of the team on the ball (+1 / -1, 0 = nobody) */
  attackDir: number;
  /** positions of the human-controlled players (co-op framing) */
  humans: { x: number; z: number }[];
  setX: number; setZ: number; setDir: number;
  celebX: number; celebZ: number;
  replayFrac: number;
}

interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

/** Critically damped spring (Unity's SmoothDamp). */
function smoothDamp(cur: number, target: number, vel: { v: number }, smoothTime: number, dt: number) {
  const omega = 2 / Math.max(smoothTime, 1e-4);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const STYLE = {
  tele: { h: 16.5, d: 31, fov: 34, dolly: 0.62, follow: 0.94 },
  wide: { h: 24, d: 44, fov: 36, dolly: 0.5, follow: 0.9 },
  broadcast: { h: 26, d: 0, fov: 30, dolly: 0, follow: 0.35 },
};

export class CameraDirector {
  style: CamStyle = 'tele';
  coop = false;
  private fx = 0; private fz = 0; private lead = 0;
  private vfx = { v: 0 }; private vfz = { v: 0 }; private vlead = { v: 0 };
  private zoom = 1; private vzoom = { v: 0 };
  private mode: CamMode = 'lobby';
  private from: Pose = { pos: new THREE.Vector3(0, 30, 60), look: new THREE.Vector3(), fov: 34 };
  private blend = 1; private blendDur = 0.8;
  private out: Pose = { pos: new THREE.Vector3(0, 30, 60), look: new THREE.Vector3(), fov: 34 };
  private t = 0;
  private replaySeg = -1;

  update(cam: THREE.PerspectiveCamera, inp: CamInput, dt: number) {
    this.t += dt;
    if (inp.mode !== this.mode) this.transition(this.mode, inp.mode);
    if (inp.mode === 'replay') {
      const seg = inp.replayFrac < 0.55 ? 0 : 1;
      if (seg !== this.replaySeg) { this.replaySeg = seg; this.blend = 1; } // hard cut between replay angles
    } else this.replaySeg = -1;

    this.track(inp, dt);
    const target = this.targetPose(inp);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const k = ease(this.blend);
      this.out.pos.copy(this.from.pos).lerp(target.pos, k);
      this.out.look.copy(this.from.look).lerp(target.look, k);
      this.out.fov = this.from.fov + (target.fov - this.from.fov) * k;
    } else {
      this.out.pos.copy(target.pos); this.out.look.copy(target.look); this.out.fov = target.fov;
    }
    cam.position.copy(this.out.pos);
    cam.lookAt(this.out.look);
    if (Math.abs(cam.fov - this.out.fov) > 0.01) { cam.fov = this.out.fov; cam.updateProjectionMatrix(); }
  }

  private transition(prev: CamMode, next: CamMode) {
    this.mode = next;
    const cut = next === 'corner' || next === 'penalty' || next === 'freekick' || next === 'replay' || prev === 'replay' || prev === 'lobby';
    this.from = { pos: this.out.pos.clone(), look: this.out.look.clone(), fov: this.out.fov };
    if (cut) { this.blend = 1; if (prev === 'replay' || prev === 'lobby') { this.vfx.v = this.vfz.v = 0; } }
    else { this.blend = 0; this.blendDur = prev === 'celebrate' ? 1.2 : 0.8; }
  }

  /** Smoothly track the ball with look-ahead in the direction of play. */
  private track(inp: CamInput, dt: number) {
    let tx = inp.bx;
    let leadT = clamp(inp.attackDir * 4 + inp.bvx * 0.3, -9, 9);
    let zoomT = 1;
    if (this.coop && inp.humans.length > 1) {
      let lo = inp.bx, hi = inp.bx;
      for (const h of inp.humans) { lo = Math.min(lo, h.x); hi = Math.max(hi, h.x); }
      tx = inp.bx * 0.6 + (lo + hi) * 0.2;
      zoomT = clamp((hi - lo) / 34, 1, 1.45);
      leadT *= 0.5;
    }
    zoomT *= 1 + clamp(Math.hypot(inp.bvx, inp.bvz) - 14, 0, 14) * 0.008; // zoom out a touch on long balls
    this.lead = smoothDamp(this.lead, leadT, this.vlead, 0.9, dt);
    this.fx = smoothDamp(this.fx, clamp(tx + this.lead, -HL + 5, HL - 5), this.vfx, 0.32, dt);
    this.fz = smoothDamp(this.fz, clamp(inp.bz * 0.9, -HW, HW), this.vfz, 0.5, dt);
    this.zoom = smoothDamp(this.zoom, zoomT, this.vzoom, 0.8, dt);
  }

  private targetPose(inp: CamInput): Pose {
    const P = new THREE.Vector3(), L = new THREE.Vector3();
    let fov = 34;
    switch (inp.mode) {
      case 'lobby': case 'end': {
        const a = this.t * 0.1;
        P.set(Math.sin(a) * 42, 22, 54 + Math.cos(a) * 6); L.set(0, 1, 0); fov = 36;
        break;
      }
      case 'celebrate': {
        const a = Math.sin(this.t * 0.35) * 0.5;
        P.set(inp.celebX + Math.sin(a) * 14 - Math.sign(inp.celebX) * 2, 6, inp.celebZ + Math.cos(a) * 14);
        L.set(inp.celebX, 1.3, inp.celebZ); fov = 32;
        break;
      }
      case 'replay': {
        if (inp.replayFrac < 0.55) { P.set(inp.bx - 3, 6, inp.bz + 17); L.set(inp.bx, 0.8, inp.bz); fov = 34; }
        else {
          const s = Math.sign(inp.bx) || 1;
          P.set(s * (HL + 13), 4.5, inp.bz * 0.35); L.set(inp.bx, Math.max(inp.by, 0.8), inp.bz); fov = 36;
        }
        break;
      }
      case 'corner': {
        const cx = inp.setX, cz = inp.setZ, bx = Math.sign(cx) * (HL - 11);
        let ux = bx - cx, uz = -cz; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
        P.set(cx - ux * 9, 7, cz - uz * 9); L.set(bx, 0.5, 0); fov = 42;
        break;
      }
      case 'penalty': {
        const d = inp.setDir || 1;
        P.set(inp.setX - d * 13.5, 4.4, 0.6); L.set(d * HL, 1.0, 0); fov = 30;
        break;
      }
      case 'freekick': {
        const d = inp.setDir || 1, gx = d * HL;
        let ux = gx - inp.setX, uz = -inp.setZ; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
        // behind the ball, slightly off-centre so the taker doesn't hide it
        P.set(inp.setX - ux * 13 + uz * 2.5, 5.5, inp.setZ - uz * 13 - ux * 2.5); L.set(gx, 1, 0); fov = 38;
        break;
      }
      default: {
        const st = STYLE[this.style];
        const k = this.coop ? 1.18 : 1;
        if (this.style === 'broadcast') {
          P.set(this.fx * st.follow, st.h, HW + 40);
          L.set(this.fx, 0, this.fz + 1);
          // fixed on the stand: pan and zoom so the ball keeps the same on-screen size
          const dist = P.distanceTo(L);
          fov = clamp(deg(2 * Math.atan(Math.tan(rad(st.fov) / 2) * (75 / dist) * this.zoom * k)), 14, 50);
        } else {
          const h = st.h * k, d = st.d * k;
          P.set(this.fx * st.follow, h, this.fz * st.dolly + d);
          L.set(this.fx, 0, this.fz + 1);
          const d0 = Math.hypot(h, d), dist = P.distanceTo(L);
          // constant on-screen scale: widen the FOV when the ball is close, narrow it when far
          fov = clamp(deg(2 * Math.atan(Math.tan(rad(st.fov) / 2) * (d0 / dist) * this.zoom)), 22, 58);
        }
      }
    }
    return { pos: P, look: L, fov };
  }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

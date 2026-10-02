// Scene, camera and frame-buffer driven rendering of players, referee and ball.
import * as THREE from 'three';
import { ACT, FRAME, GK_KITS, type Kit } from '../shared/protocol';
import { Stadium } from './stadium';
import { createStickman, pose, type Rig } from './stickman';
import { BR } from './sim';
import { CameraDirector, type CamInput } from './camera';

const SLOT_COLORS = [0x2ee6ff, 0xffb02e];
const REF_KIT: Kit = { name: 'Referee', short: 'REF', shirt: '#151515', shirt2: '#151515', shorts: '#151515', socks: '#151515', pattern: 'plain' };
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

function ballMesh() {
  const geo = new THREE.IcosahedronGeometry(BR, 1);
  const pos = geo.attributes.position;
  const orig = new THREE.IcosahedronGeometry(1, 0).attributes.position;
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < orig.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(orig, i).normalize();
    if (!dirs.some((d) => d.distanceTo(v) < 1e-3)) dirs.push(v);
  }
  const colors = new Float32Array(pos.count * 3);
  for (let t = 0; t < pos.count; t += 3) {
    let dark = false;
    for (let k = 0; k < 3; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, t + k).normalize();
      if (dirs.some((d) => d.distanceTo(v) < 1e-3)) dark = true;
    }
    for (let k = 0; k < 3; k++) {
      const c = dark ? 0.08 : 0.97;
      colors.set([c, c, c], (t + k) * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4 }));
  m.castShadow = true;
  return m;
}

export class View3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 16 / 9, 1, 700);
  director = new CameraDirector();
  stadium = new Stadium();
  ball = ballMesh();
  ballShadow: THREE.Mesh;
  rigs: Rig[] = [];
  ref: Rig;
  refCard: THREE.Mesh;
  aim: THREE.Group;
  meters: { g: THREE.Group; fill: THREE.Mesh }[] = [];
  private time = 0;
  private lastCtrl: number[] = [];
  /** hide player markers (penalty cut-scene) */
  hideMarkers = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a1020);
    this.scene.fog = new THREE.Fog(0x0a1020, 130, 320);
    this.scene.add(this.stadium.group);
    this.scene.add(this.ball);

    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = 0.03;
    this.scene.add(this.ballShadow);

    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.14), new THREE.MeshBasicMaterial({ color: SLOT_COLORS[i], depthTest: false }));
      fill.position.z = 0.01; bg.renderOrder = 10; fill.renderOrder = 11;
      g.add(bg, fill); g.visible = false; this.scene.add(g);
      this.meters.push({ g, fill });
    }

    // referee with a card to show
    this.ref = createStickman(REF_KIT, 0, false, SLOT_COLORS);
    this.refCard = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.16), new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide }));
    this.refCard.position.set(0, -0.38, 0.03); this.refCard.visible = false;
    this.ref.foreR.add(this.refCard);
    this.scene.add(this.ref.root);

    // penalty aim reticle
    this.aim = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 32), ringMat);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), ringMat);
    ring.renderOrder = dot.renderOrder = 20;
    this.aim.add(ring, dot); this.aim.visible = false;
    this.scene.add(this.aim);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setTeams(kits: [Kit, Kit], players: { team: number; num: number; gk: boolean }[]) {
    for (const r of this.rigs) this.scene.remove(r.root);
    this.rigs = players.map((p) => {
      const kit = p.gk ? GK_KITS[p.team] : kits[p.team];
      const r = createStickman(kit, p.num, p.gk, SLOT_COLORS);
      this.scene.add(r.root);
      return r;
    });
    this.lastCtrl = players.map(() => -1);
  }

  netPulse(side: number, z: number, y: number) { this.stadium.netPulse(side, z, y); }

  update(prev: Float32Array, cur: Float32Array, alpha: number, dt: number, cam: CamInput, excite: number) {
    this.time += dt;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    // ball
    const bx = lerp(prev[0], cur[0]), by = lerp(prev[1], cur[1]), bz = lerp(prev[2], cur[2]);
    this.ball.position.set(bx, by, bz);
    this.ball.quaternion.set(cur[3], cur[4], cur[5], cur[6]);
    this.ballShadow.position.set(bx, 0.03, bz);
    const hs = Math.max(0.4, 1 - by * 0.25);
    this.ballShadow.scale.setScalar(hs);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.4 * hs;

    // referee
    const R = FRAME.REF;
    const rx = Math.abs(cur[R] - prev[R]) < 4 ? lerp(prev[R], cur[R]) : cur[R];
    const rz = Math.abs(cur[R + 1] - prev[R + 1]) < 4 ? lerp(prev[R + 1], cur[R + 1]) : cur[R + 1];
    this.ref.root.position.set(rx, 0, rz);
    this.ref.root.rotation.y = lerpAngle(prev[R + 2], cur[R + 2], alpha);
    const card = cur[R + 5];
    pose(this.ref, cur[R + 4], cur[R + 3], ACT.NONE, 0, 0, 1, this.time, 99, card);
    this.refCard.visible = card > 0;
    if (card > 0) (this.refCard.material as THREE.MeshBasicMaterial).color.setHex(card === 2 ? 0xe01e1e : 0xffd400);

    // penalty aim reticle (only while a human is aiming)
    const A = FRAME.AIM;
    this.aim.visible = cur[A] > 0.5;
    if (this.aim.visible) {
      this.aim.position.set(cur[A + 1] - Math.sign(cur[A + 1]) * 0.05, cur[A + 2], cur[A + 3]);
      this.aim.rotation.y = Math.PI / 2;
      this.aim.scale.setScalar(1 + Math.sin(this.time * 6) * 0.06);
    }

    // players
    let o = FRAME.HDR;
    const meterUsed = [false, false];
    for (let i = 0; i < this.rigs.length; i++, o += FRAME.P) {
      const r = this.rigs[i];
      const act = cur[o + 5];
      r.root.visible = act !== ACT.OFF;
      if (!r.root.visible) continue;
      let x = cur[o], z = cur[o + 1];
      const px = prev[o], pz = prev[o + 1];
      if (Math.abs(x - px) < 4 && Math.abs(z - pz) < 4) { x = lerp(px, x); z = lerp(pz, z); }
      const face = Math.abs(x - px) < 4 ? lerpAngle(prev[o + 2], cur[o + 2], alpha) : cur[o + 2];
      r.root.position.x = x; r.root.position.z = z; r.root.rotation.y = face;
      pose(r, cur[o + 4], cur[o + 3], act, cur[o + 6], cur[o + 7], cur[o + 8], this.time, i);
      const ctrl = cur[o + 9];
      if (ctrl > 0 && !this.hideMarkers) {
        const next = ctrl > 2; // "next player" indicator for L1
        const slot = (ctrl - 1) % 2;
        if (this.lastCtrl[i] !== ctrl) {
          const rm = r.ring.material as THREE.MeshBasicMaterial;
          rm.color.setHex(SLOT_COLORS[slot]); rm.opacity = next ? 0.4 : 0.9;
          (r.arrow.material as THREE.MeshBasicMaterial).color.setHex(SLOT_COLORS[slot]);
          r.arrow.visible = !next;
        }
        r.marker.visible = true;
        r.arrow.position.y = 2.35 + Math.sin(this.time * 5) * 0.08;
        r.ring.scale.setScalar(next ? 0.75 : 1 + Math.sin(this.time * 4) * 0.04);
        const charge = cur[o + 10];
        if (!next && charge > 0.01) {
          const m = this.meters[slot];
          m.g.visible = true; meterUsed[slot] = true;
          m.g.position.set(x, 3.0, z); m.g.quaternion.copy(this.camera.quaternion);
          m.fill.scale.x = Math.max(0.001, charge); m.fill.position.x = -0.75 * (1 - charge);
          (m.fill.material as THREE.MeshBasicMaterial).color.setHex(charge > 0.85 ? 0xff4d4d : SLOT_COLORS[slot]);
        }
      } else r.marker.visible = false;
      this.lastCtrl[i] = ctrl;
    }
    this.meters.forEach((m, i) => { if (!meterUsed[i]) m.g.visible = false; });

    this.stadium.excite += (excite - this.stadium.excite) * Math.min(1, dt * 2);
    this.stadium.update(dt, this.time);
    this.director.update(this.camera, cam, dt);
    this.renderer.render(this.scene, this.camera);
  }
}

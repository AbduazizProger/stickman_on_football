// Pitch, goals with nets, ad boards, stands with a crowd, floodlights.
import * as THREE from 'three';
import { HL, HW, GOAL_HW, GOAL_H, NET_D, PEN_D, PEN_HW, CIRCLE, SPOT } from './sim';

const MARGIN = 9;

function pitchTexture() {
  const ppm = 14;
  const W = (HL * 2 + MARGIN * 2) * ppm, H = (HW * 2 + MARGIN * 2) * ppm;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const X = (m: number) => (m + HL + MARGIN) * ppm;
  const Z = (m: number) => (m + HW + MARGIN) * ppm;
  // mow stripes
  const n = 20, sw = (HL * 2 + MARGIN * 2) / n;
  for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? '#2f8f3c' : '#33a043'; x.fillRect(i * sw * ppm, 0, sw * ppm + 1, H); }
  // subtle noise
  for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`; x.fillRect(Math.random() * W, Math.random() * H, 3 + Math.random() * 6, 2); }
  x.strokeStyle = 'rgba(255,255,255,.92)'; x.fillStyle = 'rgba(255,255,255,.92)'; x.lineWidth = 0.14 * ppm;
  x.strokeRect(X(-HL), Z(-HW), HL * 2 * ppm, HW * 2 * ppm);
  x.beginPath(); x.moveTo(X(0), Z(-HW)); x.lineTo(X(0), Z(HW)); x.stroke();
  x.beginPath(); x.arc(X(0), Z(0), CIRCLE * ppm, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(X(0), Z(0), 0.25 * ppm, 0, Math.PI * 2); x.fill();
  for (const s of [-1, 1]) {
    x.strokeRect(s < 0 ? X(-HL) : X(HL - PEN_D), Z(-PEN_HW), PEN_D * ppm, PEN_HW * 2 * ppm);
    x.strokeRect(s < 0 ? X(-HL) : X(HL - 5.5), Z(-9.16), 5.5 * ppm, 18.32 * ppm);
    x.beginPath(); x.arc(X(s * (HL - SPOT)), Z(0), 0.25 * ppm, 0, Math.PI * 2); x.fill();
    const a = Math.acos((PEN_D - SPOT) / CIRCLE);
    x.beginPath();
    if (s < 0) x.arc(X(-HL + SPOT), Z(0), CIRCLE * ppm, -a, a); else x.arc(X(HL - SPOT), Z(0), CIRCLE * ppm, Math.PI - a, Math.PI + a);
    x.stroke();
    for (const zs of [-1, 1]) {
      x.beginPath();
      const cx = X(s * HL), cz = Z(zs * HW);
      const a0 = s < 0 ? (zs < 0 ? 0 : -Math.PI / 2) : (zs < 0 ? Math.PI / 2 : Math.PI);
      x.arc(cx, cz, 1 * ppm, a0, a0 + Math.PI / 2); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function netTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 3;
  for (let i = 0; i <= 128; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

export class Stadium {
  group = new THREE.Group();
  nets: { mesh: THREE.Mesh; base: Float32Array; pulse: number; z: number; y: number }[] = [];
  crowd!: THREE.InstancedMesh;
  private crowdBase: { x: number; y: number; z: number; ph: number; ry: number; s: number }[] = [];
  private crowdWasActive = false;
  private crowdDummy = new THREE.Object3D();
  excite = 0;
  light!: THREE.DirectionalLight;

  constructor() {
    this.buildPitch(); this.buildGoals(); this.buildBoards(); this.buildStands(); this.buildLights();
  }

  private buildPitch() {
    const w = HL * 2 + MARGIN * 2, h = HW * 2 + MARGIN * 2;
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 1 }));
    pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true;
    this.group.add(pitch);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x1a2a1f, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true;
    this.group.add(ground);
  }

  private buildGoals() {
    const post = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const netTex = netTexture();
    const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.x = s * HL;
      const cyl = (len: number, rot: 'y' | 'z', x: number, y: number, z: number) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 10), post);
        if (rot === 'z') m.rotation.x = Math.PI / 2;
        m.position.set(x, y, z); m.castShadow = true; g.add(m);
      };
      cyl(GOAL_H, 'y', 0, GOAL_H / 2, -GOAL_HW); cyl(GOAL_H, 'y', 0, GOAL_H / 2, GOAL_HW);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, GOAL_HW * 2, 10), post);
      bar.rotation.x = Math.PI / 2; bar.position.set(0, GOAL_H, 0); bar.castShadow = true; g.add(bar);
      // back stays
      for (const z of [-GOAL_HW, GOAL_HW]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, NET_D + 0.2, 6), post);
        m.rotation.z = Math.PI / 2; m.position.set(s * (NET_D / 2), GOAL_H, z); g.add(m);
      }
      // nets
      const back = new THREE.PlaneGeometry(GOAL_HW * 2, GOAL_H, 22, 12);
      const bm = new THREE.Mesh(back, netMat.clone());
      (bm.material as THREE.MeshBasicMaterial).map = netTex.clone();
      (bm.material as THREE.MeshBasicMaterial).map!.repeat.set(6, 3);
      bm.rotation.y = Math.PI / 2; bm.position.set(s * NET_D, GOAL_H / 2, 0); g.add(bm);
      this.nets.push({ mesh: bm, base: Float32Array.from(back.attributes.position.array as Float32Array), pulse: 99, z: 0, y: 0 });
      const side = new THREE.PlaneGeometry(NET_D, GOAL_H);
      for (const z of [-GOAL_HW, GOAL_HW]) { const m = new THREE.Mesh(side, netMat); m.position.set(s * NET_D / 2, GOAL_H / 2, z); g.add(m); }
      const top = new THREE.Mesh(new THREE.PlaneGeometry(NET_D, GOAL_HW * 2), netMat);
      top.rotation.x = Math.PI / 2; top.position.set(s * NET_D / 2, GOAL_H, 0); g.add(top);
      this.group.add(g);
    }
  }

  netPulse(side: number, z: number, y: number) {
    const n = this.nets[side > 0 ? 1 : 0];
    n.pulse = 0; n.z = z; n.y = y;
  }

  private buildBoards() {
    const names = ['STICK CUP', 'PES-ISH', 'NO HEAD', 'KICK&GO', 'GOALLL', 'PHONE PAD', 'THREE.JS', 'FULL TIME'];
    const mk = (i: number) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 64;
      const x = c.getContext('2d')!;
      const cols = ['#e63946', '#1d3557', '#f4a261', '#2a9d8f', '#6a4c93', '#264653', '#ff006e', '#3a86ff'];
      x.fillStyle = cols[i % cols.length]; x.fillRect(0, 0, 512, 64);
      x.fillStyle = '#fff'; x.font = 'bold 40px system-ui, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(names[i % names.length], 256, 34);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const mats = names.map((_, i) => new THREE.MeshStandardMaterial({ map: mk(i), roughness: 0.6, emissive: 0x222222 }));
    const bw = 9;
    const place = (len: number, fn: (k: number, i: number) => [number, number, number, number]) => {
      const n = Math.floor(len / bw);
      for (let i = 0; i < n; i++) {
        const [x, y, z, ry] = fn(i, n);
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw - 0.1, 0.9, 0.12), mats[i % mats.length]);
        m.position.set(x, y, z); m.rotation.y = ry; this.group.add(m);
      }
    };
    for (const s of [-1, 1]) {
      place(HL * 2 + 10, (i, n) => [-((n - 1) * bw) / 2 + i * bw, 0.45, s * (HW + 3), s > 0 ? Math.PI : 0]);
      place(HW * 2 + 6, (i, n) => [s * (HL + 6), 0.45, -((n - 1) * bw) / 2 + i * bw, s > 0 ? -Math.PI / 2 : Math.PI / 2]);
    }
  }

  private buildStands() {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.95 });
    const tiers = 11, rise = 0.75, run = 1.0;
    const seatsPerRow = (len: number) => Math.floor(len / 0.95);
    const crowdPos: { x: number; y: number; z: number; ry: number }[] = [];
    const side = (alongX: boolean, s: number, len: number, off: number) => {
      for (let i = 0; i < tiers; i++) {
        const dist = off + i * run;
        const m = new THREE.Mesh(
          alongX ? new THREE.BoxGeometry(len, rise * (i + 1), run) : new THREE.BoxGeometry(run, rise * (i + 1), len), concrete);
        if (alongX) m.position.set(0, rise * (i + 1) / 2, s * (dist + run / 2)); else m.position.set(s * (dist + run / 2), rise * (i + 1) / 2, 0);
        m.receiveShadow = true; this.group.add(m);
        const n = seatsPerRow(len);
        for (let k = 0; k < n; k++) {
          const a = -len / 2 + 0.6 + k * 0.95;
          if (Math.random() < 0.06) continue;
          if (alongX) crowdPos.push({ x: a, y: rise * (i + 1), z: s * (dist + run / 2), ry: s > 0 ? Math.PI : 0 });
          else crowdPos.push({ x: s * (dist + run / 2), y: rise * (i + 1), z: a, ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
        }
      }
    };
    for (const s of [-1, 1]) {
      side(true, s, HL * 2 + 24, HW + 5);
      side(false, s, HW * 2 + 14, HL + 8);
    }
    const geo = new THREE.CapsuleGeometry(0.2, 0.55, 2, 6); geo.translate(0, 0.45, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.crowd = new THREE.InstancedMesh(geo, mat, crowdPos.length);
    const palette = ['#e63946', '#f1faee', '#457b9d', '#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#8338ec', '#fb8500', '#adb5bd'];
    const col = new THREE.Color();
    crowdPos.forEach((c, i) => {
      this.crowdDummy.position.set(c.x, c.y, c.z); this.crowdDummy.rotation.set(0, c.ry, 0);
      const sc = 0.85 + Math.random() * 0.3;
      this.crowdDummy.scale.setScalar(sc); this.crowdDummy.updateMatrix();
      this.crowd.setMatrixAt(i, this.crowdDummy.matrix);
      this.crowd.setColorAt(i, col.set(palette[Math.floor(Math.random() * palette.length)]));
      this.crowdBase.push({ x: c.x, y: c.y, z: c.z, ph: Math.random() * 6.28, ry: c.ry, s: sc });
    });
    this.crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.crowd);
  }

  private buildLights() {
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x555a66, roughness: 0.7 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sx * (HL + 26), 0, sz * (HW + 20));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 34, 8), towerMat); pole.position.y = 17; g.add(pole);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 0.6), lampMat); panel.position.y = 35;
      panel.lookAt(0, 20, 0); g.add(panel);
      this.group.add(g);
    }
    this.light = new THREE.DirectionalLight(0xfff4e0, 2.6);
    this.light.position.set(25, 70, 40);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const sc = this.light.shadow.camera as THREE.OrthographicCamera;
    sc.left = -70; sc.right = 70; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 200;
    this.light.shadow.bias = -0.0004; this.light.shadow.normalBias = 0.05;
    this.light.target.position.set(0, 0, 0);
    this.group.add(this.light, this.light.target);
    this.group.add(new THREE.HemisphereLight(0xbfd4ff, 0x1c3a22, 0.9));
  }

  update(dt: number, t: number) {
    // net ripple (back net only): displacement along the goal depth axis, centred on the impact point
    for (const n of this.nets) {
      if (n.pulse > 3) continue;
      n.pulse += dt;
      const pos = n.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const sgn = n === this.nets[1] ? 1 : -1;
      const amp = n.pulse > 3 ? 0 : 0.9 * Math.exp(-n.pulse * 2.2) * Math.cos(n.pulse * 14);
      for (let i = 0; i < pos.count; i++) {
        const bx = n.base[i * 3], by = n.base[i * 3 + 1];
        const rr = Math.hypot(bx + n.z, by + GOAL_H / 2 - n.y);
        pos.setZ(i, sgn * amp * Math.exp(-rr * 0.55));
      }
      pos.needsUpdate = true;
    }
    // crowd bounce
    if (this.excite > 0.02 || this.crowdWasActive) {
      const amp = this.excite;
      for (let i = 0; i < this.crowdBase.length; i++) {
        const c = this.crowdBase[i];
        const hop = Math.max(0, Math.sin(t * (6 + amp * 6) + c.ph)) * 0.35 * amp;
        this.crowdDummy.position.set(c.x, c.y + hop, c.z);
        this.crowdDummy.rotation.set(0, c.ry, 0);
        this.crowdDummy.scale.setScalar(c.s);
        this.crowdDummy.updateMatrix();
        this.crowd.setMatrixAt(i, this.crowdDummy.matrix);
      }
      this.crowd.instanceMatrix.needsUpdate = true;
      this.crowdWasActive = this.excite > 0.02;
    }
  }
}

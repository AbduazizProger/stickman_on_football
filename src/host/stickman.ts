// Procedural headless stickman: neutral body + kit shells (shirt/shorts/socks/boots), skeletal pose animation.
import * as THREE from 'three';
import { ACT, type Kit } from '../shared/protocol';

export interface Rig {
  root: THREE.Group; hips: THREE.Group; torso: THREE.Group;
  armL: THREE.Group; foreL: THREE.Group; armR: THREE.Group; foreR: THREE.Group;
  thL: THREE.Group; shL: THREE.Group; thR: THREE.Group; shR: THREE.Group;
  marker: THREE.Group; ring: THREE.Mesh; arrow: THREE.Mesh;
  gk: boolean;
}

const SKIN = new THREE.MeshStandardMaterial({ color: 0xe9e9ec, roughness: 0.7, metalness: 0.0 });
const BOOT = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 });
const GLOVE = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });

const limbCache = new Map<string, THREE.BufferGeometry>();
function limbGeo(len: number, r: number) {
  const k = `${len}:${r}`;
  let g = limbCache.get(k);
  if (!g) { g = new THREE.CapsuleGeometry(r, len - 2 * r, 4, 8); g.translate(0, -len / 2, 0); limbCache.set(k, g); }
  return g;
}
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function group(x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); return g; }

function shirtTexture(kit: Kit, num: number, textColor: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = kit.shirt; x.fillRect(0, 0, 256, 128);
  x.fillStyle = kit.shirt2;
  switch (kit.pattern) {
    case 'stripes': for (let i = 0; i < 16; i += 2) x.fillRect(i * 16, 0, 16, 128); break;
    case 'hoops': for (let i = 0; i < 8; i += 2) x.fillRect(0, i * 16, 256, 16); break;
    case 'half': x.fillRect(64, 0, 128, 128); break; // the back/front halves alternate
    case 'sash':
      x.save(); x.translate(128, 0); x.rotate(0.35);
      x.fillRect(-26, -40, 52, 220); x.restore(); break;
    default: break;
  }
  if (num > 0) {
    x.font = 'bold 64px system-ui, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.35)'; x.strokeText(String(num), 128, 58);
    x.fillStyle = textColor; x.fillText(String(num), 128, 58);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function luma(hex: string) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function createStickman(kit: Kit, num: number, gk: boolean, slotColors: number[]): Rig {
  const patternDark = kit.pattern === 'plain' ? luma(kit.shirt) : luma(kit.shirt) * 0.5 + luma(kit.shirt2) * 0.5;
  const numColor = patternDark > 0.55 ? '#111111' : '#ffffff';
  const shirtMat = new THREE.MeshStandardMaterial({ map: shirtTexture(kit, num, numColor), roughness: 0.75 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.75 });
  const shortsMat = new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.8 });
  const sockMat = new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.8 });

  const root = group();
  const hips = group(0, 0.95, 0); root.add(hips);
  hips.add(mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.2, 14), shortsMat, 0, -0.03, 0));

  const torso = group(0, 0.08, 0); hips.add(torso);
  torso.add(mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.58, 16, 1, true), shirtMat, 0, 0.29, 0));
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), sleeveMat); // plain colour: the texture centre holds the number
  cap.rotation.x = -Math.PI / 2; cap.position.y = 0.58; torso.add(cap);
  torso.add(mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.17, 10), SKIN, 0, 0.66, 0)); // neck stub, no head

  const mkArm = (sx: number) => {
    const sh = group(sx * 0.255, 0.5, 0); torso.add(sh);
    sh.add(mesh(limbGeo(0.3, 0.045), SKIN));
    sh.add(mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.15, 10), sleeveMat, 0, -0.08, 0));
    const fore = group(0, -0.3, 0); sh.add(fore);
    fore.add(mesh(limbGeo(0.3, 0.04), SKIN));
    fore.add(mesh(new THREE.SphereGeometry(gk ? 0.065 : 0.045, 8, 6), gk ? GLOVE : SKIN, 0, -0.31, 0));
    return { sh, fore };
  };
  const aL = mkArm(1), aR = mkArm(-1);

  const mkLeg = (sx: number) => {
    const th = group(sx * 0.1, -0.1, 0); hips.add(th);
    th.add(mesh(limbGeo(0.44, 0.058), SKIN));
    th.add(mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.26, 10), shortsMat, 0, -0.13, 0));
    const sh = group(0, -0.44, 0); th.add(sh);
    sh.add(mesh(limbGeo(0.44, 0.048), SKIN));
    sh.add(mesh(new THREE.CylinderGeometry(0.064, 0.062, 0.34, 10), sockMat, 0, -0.27, 0));
    sh.add(mesh(new THREE.BoxGeometry(0.11, 0.08, 0.28), BOOT, 0, -0.43, 0.06));
    return { th, sh };
  };
  const lL = mkLeg(1), lR = mkLeg(-1);

  const marker = group(); root.add(marker);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32), new THREE.MeshBasicMaterial({ color: slotColors[0] ?? 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; marker.add(ring);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 4), new THREE.MeshBasicMaterial({ color: slotColors[0] ?? 0xffffff }));
  arrow.rotation.x = Math.PI; arrow.position.y = 2.35; marker.add(arrow);
  marker.visible = false;

  return { root, hips, torso, armL: aL.sh, foreL: aL.fore, armR: aR.sh, foreR: aR.fore, thL: lL.th, shL: lL.sh, thR: lR.th, shR: lR.sh, marker, ring, arrow, gk };
}

const sm = (x: number) => x * x * (3 - 2 * x);

/**
 * Pose conventions: +z is forward, +x is the character's left.
 * rotation.x < 0 swings a hanging limb forward; shin rotation.x > 0 bends the knee; forearm rotation.x < 0 bends the elbow.
 */
export function pose(r: Rig, speed: number, phase: number, act: number, actT: number, actDur: number, side: number, t: number, id: number, card = 0) {
  const A = Math.min(speed / 8.5, 1);
  const s = Math.sin(phase), c = Math.cos(phase);
  const idle = 1 - Math.min(speed / 1.5, 1);
  const br = Math.sin(t * 2.2 + id) * 0.012;

  let hipY = 0.95 - 0.015 * A + Math.abs(c) * 0.035 * A;
  let rootY = 0, bodyX = 0, bodyZ = 0, lean = 0.04 + 0.26 * A + br;
  // legs: forward swing f -> rotation.x = -f
  let fL = s * 0.95 * A, fR = -fL;
  let bL = 0.12 * A + Math.max(0, c) * 1.25 * A, bR = 0.12 * A + Math.max(0, -c) * 1.25 * A;
  // arms
  let aLx = s * 0.85 * A, aRx = -aLx;
  let aLz = 0.1 + idle * 0.03, aRz = -aLz;
  let eL = 0.35 + 0.8 * A, eR = eL;
  const p = actDur > 0 && actDur < 100 ? Math.min(actT / actDur, 1) : 0;

  switch (act) {
    case ACT.KICK: {
      // right-foot strike: back-swing then whip through
      let f: number, bend: number;
      if (p < 0.3) { f = -0.9 * sm(p / 0.3); bend = 1.3 * sm(p / 0.3); }
      else if (p < 0.55) { const q = (p - 0.3) / 0.25; f = -0.9 + 2.4 * sm(q); bend = 1.3 - 1.1 * sm(q); }
      else { const q = (p - 0.55) / 0.45; f = 1.5 * (1 - sm(q)); bend = 0.2 * (1 - q); }
      fR = f; bR = bend; fL = 0.12; bL = 0.25;
      lean = 0.12; aLx = -0.5; aRx = 0.4; aLz = 0.9; aRz = -0.9; hipY = 0.92;
      break;
    }
    case ACT.TACKLE:
      fR = 1.25; bR = 0.12; fL = -0.7; bL = 1.1; hipY = 0.82; lean = 0.5 * Math.sin(Math.PI * p) + 0.1;
      aLx = 0.4; aRx = -0.6; aLz = 0.7; aRz = -0.7; break;
    case ACT.SLIDE: {
      const k = sm(Math.min(p / 0.15, 1)) * (p > 0.8 ? 1 - (p - 0.8) / 0.2 : 1);
      bodyX = -1.2 * k; hipY = 0.95 - 0.58 * k; lean = 0.1;
      fR = 0.25; bR = 0.05; fL = 0.1; bL = 0.5;
      aLx = 0.5; aRx = 0.5; aLz = 0.6; aRz = -0.6; eL = eR = 0.3; break;
    }
    case ACT.STUN: {
      const k = Math.pow(Math.sin(Math.PI * p), 0.6);
      bodyX = -1.3 * k; hipY = 0.95 - 0.55 * k; lean = 0.2 * k;
      fR = 0.4 * k; fL = 0.1; bL = 0.4 * k; bR = 0.3 * k;
      aLx = -1.2 * k; aRx = -1.0 * k; aLz = 0.9 * k; aRz = -0.9 * k; break;
    }
    case ACT.DIVE: {
      const k = Math.sin(Math.PI * Math.min(p * 1.1, 1));
      const high = Math.abs(side) > 1.5, sd = Math.sign(side) || 1;
      bodyZ = -sd * (high ? 1.25 : 1.4) * k; hipY = 0.95 - (high ? 0.2 : 0.45) * k; rootY = (high ? 0.75 : 0.18) * k; lean = 0.1;
      aLx = aRx = -2.8 * k; aLz = 0.15; aRz = -0.15; eL = eR = 0.2; fL = 0.5 * k; fR = -0.2; bL = 0.4; bR = 0.8 * k; break;
    }
    case ACT.DHEAD: { // diving header: launch forward, horizontal, then land
      const k = Math.sin(Math.PI * Math.min(p * 1.2, 1));
      bodyX = 1.35 * k; hipY = 0.95 - 0.5 * k; rootY = 0.12 * k; lean = 0;
      aLx = aRx = 0.9 * k; aLz = 0.5; aRz = -0.5; eL = eR = 0.3;
      fL = fR = -0.25 * k; bL = bR = 0.2; break;
    }
    case ACT.HEAD: {
      const k = Math.sin(Math.PI * p);
      rootY = 0.5 * k; lean = -0.35 * (1 - p) + 0.6 * p; bL = bR = 0.9 * k; fL = fR = 0.25 * k;
      aLz = 1.0; aRz = -1.0; aLx = aRx = -0.3; break;
    }
    case ACT.CELEB:
      if (speed < 2.5) {
        rootY = Math.abs(Math.sin(t * 7 + id)) * 0.22; lean = 0;
        aLx = -2.9 + Math.sin(t * 12 + id) * 0.25; aRx = -2.9 + Math.cos(t * 12 + id) * 0.25; aLz = 0.35; aRz = -0.35; eL = eR = 0.25;
        bL = bR = 0.3; fL = fR = 0.1;
      } else { aLx = aRx = -2.7; aLz = 0.5; aRz = -0.5; eL = eR = 0.2; lean = 0.15; }
      break;
    case ACT.THROW:
      aLx = aRx = -3.0; aLz = 0.2; aRz = -0.2; eL = eR = 0.45; lean = -0.15; fL = fR = 0.1; bL = bR = 0.1; break;
    case ACT.HOLD:
      aLx = aRx = -1.1; aLz = 0.15; aRz = -0.15; eL = eR = 1.2; lean = 0.1; fL = fR = 0; bL = bR = 0.15; break;
    default:
      if (r.gk && speed < 3) { // keeper ready stance
        hipY = 0.88 + br; lean = 0.22; bL = bR = 0.4; fL = fR = 0.25;
        aLx = aRx = -0.6; aLz = 0.7; aRz = -0.7; eL = eR = 0.8;
      }
  }

  r.root.position.y = rootY;
  r.hips.position.y = hipY; r.hips.rotation.set(bodyX, 0, bodyZ);
  r.torso.rotation.set(lean, 0, 0);
  r.thL.rotation.x = -fL; r.thR.rotation.x = -fR; r.shL.rotation.x = bL; r.shR.rotation.x = bR;
  if (card) { aRx = -3.0; aRz = -0.15; eR = 0.05; } // referee holding up a card
  r.armL.rotation.set(aLx, 0, aLz); r.armR.rotation.set(aRx, 0, aRz);
  r.foreL.rotation.x = -eL; r.foreR.rotation.x = -eR;
}

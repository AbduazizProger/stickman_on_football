// Constants and message types shared by the host screen and the phone pad.

/**
 * Buttons use the PlayStation / FIFA layout.
 * PASS = ✕, SHOOT = □, LOB = ○, THROUGH = △, SPRINT = R2, SWITCH = L1, R1, L2.
 */
export const BTN = { PASS: 1, SHOOT: 2, LOB: 4, THROUGH: 8, SPRINT: 16, SWITCH: 32, R1: 64, L2: 128 } as const;
export const L1 = BTN.SWITCH;

export const ACT = {
  NONE: 0, KICK: 1, TACKLE: 2, SLIDE: 3, STUN: 4, DIVE: 5, CELEB: 6, HEAD: 7, THROW: 8, HOLD: 9, DHEAD: 10, OFF: 11,
} as const;

/**
 * Frame layout shared by the simulation, renderer and replay buffer.
 * Header: ball (0-6: x y z qx qy qz qw), referee (7-12: x z face phase speed card), penalty aim (13-16: on x y z).
 * Then P floats per player.
 */
export const FRAME = { HDR: 17, REF: 7, AIM: 13, P: 11 } as const;

/** Context the phone uses to label its buttons. */
export type PadCtx = 'atk' | 'cross' | 'recv' | 'air' | 'def' | 'set' | 'pen' | 'gk' | 'none';

export interface Kit {
  name: string;
  short: string;
  shirt: string;
  shirt2: string;
  shorts: string;
  socks: string;
  pattern: 'plain' | 'stripes' | 'hoops' | 'half' | 'sash';
}

export const KITS: Kit[] = [
  { name: 'Crimson Stripes', short: 'CRM', shirt: '#d7263d', shirt2: '#ffffff', shorts: '#ffffff', socks: '#d7263d', pattern: 'stripes' },
  { name: 'Royal Blue', short: 'BLU', shirt: '#1f4eff', shirt2: '#1f4eff', shorts: '#ffffff', socks: '#1f4eff', pattern: 'plain' },
  { name: 'Sunshine Hoops', short: 'SUN', shirt: '#ffd400', shirt2: '#161616', shorts: '#161616', socks: '#ffd400', pattern: 'hoops' },
  { name: 'Emerald Halves', short: 'EMR', shirt: '#0f9d58', shirt2: '#ffffff', shorts: '#0b6b3a', socks: '#0f9d58', pattern: 'half' },
  { name: 'Tangerine Sash', short: 'TNG', shirt: '#ff7a00', shirt2: '#ffffff', shorts: '#1a1a1a', socks: '#ff7a00', pattern: 'sash' },
  { name: 'Midnight', short: 'MID', shirt: '#232946', shirt2: '#eebbc3', shorts: '#232946', socks: '#eebbc3', pattern: 'plain' },
  { name: 'Violet', short: 'VIO', shirt: '#7b2cbf', shirt2: '#ffffff', shorts: '#ffffff', socks: '#7b2cbf', pattern: 'plain' },
  { name: 'Sky Stripes', short: 'SKY', shirt: '#4cc9f0', shirt2: '#ffffff', shorts: '#0b132b', socks: '#4cc9f0', pattern: 'stripes' },
];

export const GK_KITS: Kit[] = [
  { name: 'Keeper', short: 'GK', shirt: '#39ff14', shirt2: '#39ff14', shorts: '#111111', socks: '#39ff14', pattern: 'plain' },
  { name: 'Keeper', short: 'GK', shirt: '#ff2e93', shirt2: '#ff2e93', shorts: '#111111', socks: '#ff2e93', pattern: 'plain' },
];

// Phone -> host
export type PadMsg =
  | { t: 'in'; x: number; y: number; b: number }
  | { t: 'kit'; d: 1 | -1 }
  | { t: 'ready'; v: boolean }
  | { t: 'cmd'; c: 'pause' | 'resume' | 'rematch' | 'menu' };

// Host -> phone
export type HostMsg =
  | {
      t: 'ui';
      phase: 'lobby' | 'wait' | 'play' | 'paused' | 'end' | 'replay';
      kit: number;
      ready: boolean;
      ctx: PadCtx;
      note?: string;
    }
  | { t: 'vib'; p: number | number[] }
  | { t: 'error'; msg: string }
  | { t: 'joined'; slot: number };

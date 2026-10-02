// Tiny synthesized sound effects + crowd ambience (no audio assets needed).
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private crowd!: GainNode;
  private noise!: AudioBuffer;
  private lastKick = 0;
  enabled = false;

  enable() {
    if (this.ctx) { void this.ctx.resume(); this.enabled = true; return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx; this.enabled = true;
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3.2; } // brown-ish noise
    // crowd bed
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.5;
    this.crowd = ctx.createGain(); this.crowd.gain.value = 0.05;
    src.connect(bp); bp.connect(this.crowd); this.crowd.connect(this.master); src.start();
  }

  setExcite(x: number) {
    if (!this.ctx) return;
    this.crowd.gain.setTargetAtTime(0.04 + x * 0.22, this.ctx.currentTime, 0.4);
  }

  private burst(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', drop = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * drop), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  private puff(dur: number, vol: number, freq = 800) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  kick(power: number) {
    if (!this.ctx) return; const n = performance.now(); if (n - this.lastKick < 40) return; this.lastKick = n;
    this.burst(150 + power * 60, 0.12, 0.35 + power * 0.3, 'sine', 0.4); this.puff(0.08, 0.2 + power * 0.2, 1500);
  }
  bounce(v: number) { this.burst(120, 0.1, Math.min(0.3, v * 0.03), 'sine', 0.6); }
  post() { this.burst(900, 0.35, 0.35, 'triangle', 0.7); this.burst(1400, 0.25, 0.2, 'sine', 0.8); }
  tackle() { this.puff(0.18, 0.35, 600); this.burst(90, 0.15, 0.25); }
  save() { this.puff(0.1, 0.3, 1800); }
  whistle(long = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, dur = long ? 1.0 : 0.45;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2900;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 38;
    const lg = this.ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(o.frequency);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.03); g.gain.setValueAtTime(0.28, t + dur - 0.05); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
  }
  goal() { this.whistle(); this.puff(0.4, 0.4, 2500); }
}

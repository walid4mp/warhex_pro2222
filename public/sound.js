/**
 * sound.js — Web Audio API sound effects (no external files needed).
 * Generates all sounds procedurally: move, capture, check, win, lose, dice.
 */
const SoundFX = {
  ctx: null,
  enabled: true,

  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { this.enabled = false; }
  },

  ensureCtx() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  },

  tone(freq, dur, type = 'sine', vol = 0.15) {
    if (!this.enabled) return;
    this.ensureCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.start(); osc.stop(this.ctx.currentTime + dur);
  },

  move()    { this.tone(400, 0.08, 'triangle', 0.1); },
  capture() { this.tone(200, 0.15, 'sawtooth', 0.15); setTimeout(() => this.tone(150, 0.1, 'sawtooth', 0.1), 50); },
  check()   { this.tone(800, 0.2, 'square', 0.1); setTimeout(() => this.tone(600, 0.2, 'square', 0.08), 100); },
  checkmate(){ this.tone(800, 0.15, 'square', 0.12); setTimeout(() => this.tone(600, 0.15, 'square', 0.12), 100); setTimeout(() => this.tone(400, 0.3, 'square', 0.12), 200); },
  win()     { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 'triangle', 0.12), i * 100)); },
  lose()    { [400, 350, 300, 250].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 'sine', 0.12), i * 120)); },
  dice()    { this.tone(300 + Math.random() * 200, 0.05, 'square', 0.08); setTimeout(() => this.tone(200 + Math.random() * 100, 0.1, 'square', 0.06), 60); },
  click()   { this.tone(600, 0.03, 'triangle', 0.05); },
  notify()  { this.tone(880, 0.1, 'sine', 0.08); setTimeout(() => this.tone(1100, 0.1, 'sine', 0.06), 80); },
  error()   { this.tone(200, 0.15, 'sawtooth', 0.1); },

  vibrate(ms = 50) {
    if (navigator.vibrate) navigator.vibrate(ms);
  },

  toggle() { this.enabled = !this.enabled; return this.enabled; },
};

if (typeof window !== 'undefined') window.SoundFX = SoundFX;

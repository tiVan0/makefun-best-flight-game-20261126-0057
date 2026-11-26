// audio.js — every sound is synthesised live with WebAudio: engine drone,
// wind, ring chimes, warnings and fanfares. No audio files, no network.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.windGain = null;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // Engine: two detuned saws through a lowpass, pitch follows throttle.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 58;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 320;
    this.engineOsc.connect(filt); osc2.connect(filt);
    filt.connect(this.engineGain); this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start(); osc2.start();
    this.engineOsc2 = osc2;
    // Wind: looped noise buffer through a bandpass.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
    noise.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.ctx.destination);
    noise.start();
  }

  setFlight(throttle, speed) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const freq = 48 + throttle * 55 + speed * 0.25;
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.1);
    this.engineOsc2.frequency.setTargetAtTime(freq * 1.01, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.045 + throttle * 0.05, t, 0.15);
    this.windGain.gain.setTargetAtTime(Math.min(0.12, speed * 0.0011), t, 0.2);
  }

  blip(freq, dur, type, vol, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  ringChime() { this.blip(880, 0.18, 'sine', 0.18); this.blip(1318, 0.3, 'sine', 0.14, 0.09); }
  warning() { this.blip(440, 0.16, 'square', 0.07); this.blip(440, 0.16, 'square', 0.07, 0.22); }
  crash() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.7;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = 0.3;
    src.connect(g); g.connect(this.ctx.destination); src.start(t);
    this.blip(70, 0.6, 'sine', 0.22);
  }
  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.32, 'triangle', 0.16, i * 0.13));
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) {
      this.engineGain.gain.value = this.muted ? 0 : 0.06;
      this.windGain.gain.value = this.muted ? 0 : 0.03;
    }
    return this.muted;
  }
}

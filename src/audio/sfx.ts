/**
 * Fully synthesized audio — no asset files. Sound effects are short envelopes on
 * oscillators; the music is a chiptune sequencer playing Korobeiniki.
 */

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private _muted = false;
  private musicTimer = 0;
  private musicStep = 0;
  private musicNextTime = 0;
  private _musicOn = true;
  private tempo = 1;
  /** extra music layers after a chain; decays back to 0 over a couple of bars */
  private surge = 0;
  /** arrangement tier (0-3): instruments and layers change every two levels */
  private tier = 0;
  /** bass note currently sounding: action sounds are pitched from it, so they stay in key */
  private root = 82.41;
  /** audio-clock times of recently scheduled beats (every bass hit) */
  private beats: number[] = [];
  private moveStep = 0;

  get muted() {
    return this._muted;
  }

  get musicOn() {
    return this._musicOn;
  }

  /** Must be called from a user gesture to satisfy autoplay policies. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this._musicOn ? 0.35 : 0;
    this.musicGain.connect(this.master);
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    return this._muted;
  }

  toggleMusic(): boolean {
    this._musicOn = !this._musicOn;
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(this._musicOn ? 0.35 : 0, this.ctx.currentTime, 0.05);
    return this._musicOn;
  }

  setTempo(level: number): void {
    this.tempo = Math.min(1.6, 1 + (level - 1) * 0.045);
    this.tier = Math.min(3, Math.floor((level - 1) / 2));
  }

  /** Seconds between the moment a sound is scheduled and when it's heard. */
  private get latency(): number {
    return this.ctx ? (this.ctx.outputLatency || this.ctx.baseLatency || 0) : 0;
  }

  /** Signed ms from the nearest beat as heard right now, or null if the music isn't playing. */
  beatOffsetMs(): number | null {
    if (!this.ctx || this.ctx.state !== 'running' || this.beats.length === 0) return null;
    const now = this.ctx.currentTime - this.latency;
    let best = Infinity;
    for (const t of this.beats) if (Math.abs(now - t) < Math.abs(best)) best = now - t;
    return Math.abs(best) > 1 ? null : best * 1000;
  }

  /** 0 at each heard beat, rising to 1 just before the next; -1 when there's no beat. */
  beatPhase(): number {
    if (!this.ctx || this.beats.length < 2) return -1;
    const now = this.ctx.currentTime - this.latency;
    const past = this.beats.filter((t) => t <= now);
    if (!past.length) return -1;
    const last = past[past.length - 1];
    const len = 0.5 / this.tempo;
    const k = (now - last) / len;
    return k > 2 ? -1 : Math.min(1, k);
  }

  /** A chord tone above the current bass note: degree 0 = root, then fifth, octave, ... */
  private chord(degree: number, octave = 2): number {
    const ratios = [1, 1.5, 2, 3, 4];
    return this.root * Math.pow(2, octave) * ratios[degree % ratios.length];
  }

  // ------------------------------------------------------------------ SFX

  private tone(freq: number, dur: number, opts: { wave?: Wave; vol?: number; slide?: number; delay?: number; attack?: number } = {}) {
    if (!this.ctx || !this.master) return;
    const { wave = 'square', vol = 0.25, slide = 0, delay = 0, attack = 0.004 } = opts;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol = 0.3, delay = 0) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  // Action sounds are notes of the chord the bass is playing, so playing is playing along.

  move() {
    this.tone(this.chord(this.moveStep++ % 3, 2), 0.05, { wave: 'square', vol: 0.07 });
  }

  rotate() {
    const f = this.chord(1 + (this.moveStep++ % 2), 3);
    this.tone(f, 0.08, { wave: 'triangle', vol: 0.13, slide: f * 0.06 });
  }

  softDrop() {
    this.tone(this.chord(0, 2), 0.03, { wave: 'square', vol: 0.04 });
  }

  hold() {
    const f = this.chord(3, 2);
    this.tone(f, 0.1, { wave: 'sine', vol: 0.15, slide: -f / 3 });
  }

  lock() {
    this.tone(this.chord(0, 1), 0.08, { wave: 'triangle', vol: 0.25, slide: -20 });
    this.noise(0.05, 0.12);
  }

  hardDrop() {
    this.tone(this.chord(0, 0), 0.14, { wave: 'sawtooth', vol: 0.22, slide: -15 });
    this.noise(0.09, 0.25);
  }

  /** A lock judged against the beat: on-beat chimes climb with the groove; losing it sags. */
  beatHit(onBeat: boolean, groove: number, lost: number) {
    if (onBeat) {
      const g = Math.min(groove, 8);
      this.tone(this.chord(g, 3), 0.16, { wave: 'sine', vol: 0.18 });
      this.tone(this.chord(g + 2, 3), 0.2, { wave: 'triangle', vol: 0.08, delay: 0.03 });
    } else if (lost >= 3) {
      this.tone(this.chord(2, 2), 0.35, { wave: 'sawtooth', vol: 0.12, slide: -this.chord(2, 2) * 0.4 });
    }
  }

  /** The player shoving the cabinet. */
  nudge() {
    this.tone(this.chord(0, 0), 0.12, { wave: 'triangle', vol: 0.3, slide: -20 });
    this.noise(0.12, 0.28);
  }

  /** Tilted out: the pinball buzzer. */
  tilted() {
    this.tone(110, 0.9, { wave: 'square', vol: 0.16 });
    this.tone(116.5, 0.9, { wave: 'sawtooth', vol: 0.12 });
    this.noise(0.3, 0.2);
  }

  /** The board swinging 90°. */
  tilt() {
    this.noise(0.35, 0.18);
    this.tone(this.chord(0, 1), 0.4, { wave: 'sawtooth', vol: 0.12, slide: this.chord(0, 1) });
  }

  clear(count: number, special: boolean) {
    const base = special ? 660 : 523;
    const n = special ? 5 : count + 1;
    for (let i = 0; i < n; i++) {
      this.tone(base * Math.pow(2, i / 12 * (special ? 3 : 4)), 0.16, { wave: 'square', vol: 0.18, delay: i * 0.055 });
    }
    if (count === 4 || special) {
      this.tone(base * 2, 0.5, { wave: 'sawtooth', vol: 0.12, delay: n * 0.055, slide: 200 });
    }
  }

  perfectClear() {
    const notes = [523, 659, 784, 1047, 1319, 1568];
    notes.forEach((f, i) => this.tone(f, 0.35, { wave: 'triangle', vol: 0.22, delay: i * 0.08 }));
  }

  levelUp() {
    [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.25, { wave: 'square', vol: 0.18, delay: i * 0.09 }));
  }

  gameOver() {
    [392, 349, 311, 262, 196].forEach((f, i) => this.tone(f, 0.4, { wave: 'sawtooth', vol: 0.2, delay: i * 0.18, slide: -30 }));
  }

  /** Color group popping: bubbly plucks that climb with the group size and chain depth. */
  pop(cells: number, chain: number) {
    const root = 392 * Math.pow(2, (Math.min(chain, 6) - 1) / 6);
    const n = Math.min(8, 2 + Math.floor(cells / 4));
    for (let i = 0; i < n; i++) {
      const f = root * Math.pow(2, (i * 3) / 12);
      this.tone(f, 0.12, { wave: 'sine', vol: 0.22, slide: f * 0.6, delay: i * 0.035 });
    }
    this.noise(0.08, 0.15);
  }

  /** Garbage rising: a grinding two-note warning. */
  garbage(rows: number) {
    this.tone(98, 0.22, { wave: 'sawtooth', vol: 0.2, slide: 40 });
    this.tone(92.5, 0.22, { wave: 'square', vol: 0.12, slide: 40, delay: 0.02 });
    for (let i = 0; i < rows; i++) this.noise(0.12, 0.22, i * 0.09);
  }

  /** Stack crumbling after a clear: low rumble that lengthens with the drop. */
  cascade(maxDrop: number) {
    const dur = Math.min(0.5, 0.12 + maxDrop * 0.03);
    this.noise(dur, 0.18);
    this.tone(160, dur, { wave: 'sawtooth', vol: 0.1, slide: -90 });
  }

  /** Falling chunks hitting the stack. */
  landed(chain: number) {
    this.tone(70 + chain * 6, 0.14, { wave: 'triangle', vol: 0.3, slide: -30 });
    this.noise(0.06, 0.2);
  }

  /** Chain clear: an arpeggio that climbs a whole step per link, and the music surges. */
  chain(chain: number) {
    const root = 523.25 * Math.pow(2, ((chain - 2) * 2) / 12);
    const steps = [0, 4, 7, 12, 16, 19, 24].slice(0, Math.min(7, chain + 3));
    steps.forEach((st, i) => {
      this.tone(root * Math.pow(2, st / 12), 0.22, { wave: 'square', vol: 0.16, delay: i * 0.045 });
      this.tone(root * Math.pow(2, st / 12) * 1.005, 0.22, { wave: 'sawtooth', vol: 0.06, delay: i * 0.045 });
    });
    this.tone(root * 4, 0.6, { wave: 'triangle', vol: 0.12, delay: steps.length * 0.045, slide: 400 });
    this.surge = Math.max(this.surge, Math.min(4, chain));
  }

  tspin() {
    this.tone(1200, 0.12, { wave: 'sine', vol: 0.2, slide: 600 });
  }

  // ---------------------------------------------------------------- MUSIC

  /** Call every frame; schedules a few beats ahead. */
  updateMusic(): void {
    if (!this.ctx || !this.musicGain) return;
    const lookahead = 0.25;
    while (this.musicNextTime < this.ctx.currentTime + lookahead) {
      this.playStep(this.musicStep, this.musicNextTime);
      const beat = 0.5 / 2 / this.tempo; // 16th notes at 120bpm * tempo... quarter = 0.5s
      this.musicNextTime += beat;
      this.musicStep = (this.musicStep + 1) % MELODY_STEPS.length;
      this.musicTimer++;
    }
  }

  private playStep(step: number, time: number) {
    if (!this.ctx || !this.musicGain) return;
    const unit = 0.25 / this.tempo;
    const tier = this.tier;
    const m = MELODY_STEPS[step];
    if (m) {
      // the lead gets thicker every tier: square, + detuned saw, saw, saw + octave
      this.note(m.f, m.len * unit, time, tier >= 2 ? 'sawtooth' : 'square', tier >= 2 ? 0.16 : 0.22);
      if (tier === 1) this.note(m.f * 1.006, m.len * unit, time, 'sawtooth', 0.07);
      if (tier >= 3) this.note(m.f * 2, m.len * unit, time, 'square', 0.06);
    }
    const b = BASS_STEPS[step % BASS_STEPS.length];
    if (b) {
      this.note(b.f, b.len * unit, time, 'triangle', 0.35);
      if (tier >= 2) this.note(b.f, b.len * unit, time, 'square', 0.05);
      this.root = b.f < 120 ? b.f : b.f / 2;
    }
    if (step % 2 === 0) {
      this.beats.push(time);
      if (this.beats.length > 8) this.beats.shift();
    }
    // the band fills in as levels rise: hats, then arpeggio and kick, then snare
    if (tier >= 1 && step % 2 === 0) this.hat(time, 0.06);
    if (tier >= 2 && step % 4 === 0) this.kick(time, 0.35);
    if (tier >= 2 && step % 2 === 1) this.note(this.chord(step % 4 === 1 ? 1 : 2, 3), unit * 0.9, time, 'sine', 0.05);
    if (tier >= 3 && step % 8 === 4) this.snare(time, 0.16);

    // Surge layers, added by chain depth: octave harmony, then hats, then a kick.
    const s = this.surge;
    if (s > 0) {
      const k = Math.min(1, s / 2);
      if (m) this.note(m.f * 2, m.len * (0.25 / this.tempo), time, 'sawtooth', 0.07 * k);
      if (s > 1 && step % 2 === 0) this.hat(time, 0.12 * Math.min(1, s - 1));
      if (s > 2 && step % 4 === 0) this.kick(time, 0.5 * Math.min(1, s - 2));
      this.surge = Math.max(0, s - 1 / 32);
    }
  }

  private hat(time: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * 0.04), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.musicGain);
    src.start(time);
  }

  private snare(time: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * 0.12), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.musicGain);
    src.start(time);
  }

  private kick(time: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    osc.connect(g).connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private note(freq: number, dur: number, time: number, wave: Wave, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    if (this.musicNextTime < this.ctx.currentTime - 1) this.musicNextTime = this.ctx.currentTime; // resync after tab sleep
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.01);
    g.gain.setValueAtTime(vol, time + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g).connect(this.musicGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  startMusic(): void {
    if (!this.ctx) return;
    this.musicStep = 0;
    this.surge = 0;
    this.beats = [];
    this.musicNextTime = this.ctx.currentTime + 0.1;
  }
}

// ------------------------------------------------------------------ score data

const N: Record<string, number> = {
  E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63,
  F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25,
  E2: 82.41, A2: 110.0, G2: 98.0, C3: 130.81, D3: 146.83, F2: 87.31, B2: 123.47,
};

interface Step {
  f: number;
  len: number; // in 16ths
}

/** Korobeiniki (Tetris theme A), one note per 16th-note step; nulls are rests / sustains. */
function seq(spec: [string, number][]): (Step | null)[] {
  const out: (Step | null)[] = [];
  for (const [name, len] of spec) {
    if (name === '-') {
      for (let i = 0; i < len; i++) out.push(null);
    } else {
      out.push({ f: N[name], len });
      for (let i = 1; i < len; i++) out.push(null);
    }
  }
  return out;
}

const MELODY_STEPS = seq([
  ['E5', 4], ['B4', 2], ['C5', 2], ['D5', 4], ['C5', 2], ['B4', 2],
  ['A4', 4], ['A4', 2], ['C5', 2], ['E5', 4], ['D5', 2], ['C5', 2],
  ['B4', 6], ['C5', 2], ['D5', 4], ['E5', 4],
  ['C5', 4], ['A4', 4], ['A4', 4], ['-', 4],
  ['-', 2], ['D5', 4], ['F4', 2], ['A4', 4], ['G4', 2], ['F4', 2],
  ['E4', 6], ['C5', 2], ['E5', 4], ['D5', 2], ['C5', 2],
  ['B4', 4], ['B4', 2], ['C5', 2], ['D5', 4], ['E5', 4],
  ['C5', 4], ['A4', 4], ['A4', 4], ['-', 4],
]);

const BASS_STEPS = seq([
  ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2],
  ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2],
  ['G2', 2], ['G3', 2], ['G2', 2], ['G3', 2], ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2],
  ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2],
  ['D3', 2], ['D3', 2], ['D3', 2], ['D3', 2], ['F2', 2], ['F3', 2], ['F2', 2], ['F3', 2],
  ['C3', 2], ['C3', 2], ['C3', 2], ['C3', 2], ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2],
  ['B2', 2], ['B3', 2], ['B2', 2], ['B3', 2], ['E2', 2], ['E3', 2], ['E2', 2], ['E3', 2],
  ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2], ['A2', 2], ['A3', 2],
]);

// Автотюн: определяет ноту (YIN) и подтягивает голос к ближайшей ноте тональности.
class Tuner extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false; this.strength = 0.6; this.scale = [0,1,2,3,4,5,6,7,8,9,10,11];
    // анализ (децимация x2)
    this.ds = sampleRate > 60000 ? 4 : 2;
    this.aRate = sampleRate / this.ds;
    this.W = 512; this.tauMax = Math.floor(this.aRate / 70); this.tauMin = Math.floor(this.aRate / 1100);
    this.aBuf = new Float32Array(this.W + this.tauMax); this.aPos = 0; this.dsAcc = 0; this.dsCnt = 0; this.sinceDet = 0;
    this.yin = new Float32Array(this.tauMax + 1);
    // сдвиг высоты (две «головки» с кроссфейдом)
    this.N = 16384; this.buf = new Float32Array(this.N); this.w = 0;
    this.G = Math.round(sampleRate * 0.03); this.minD = 48; this.p = 0;
    this.ratio = 1; this.want = 1; this.voiced = false; this.lastMsg = 0; this.f0 = 0; this.target = 0;
    this.port.onmessage = e => { const d = e.data; if ('enabled' in d) this.enabled = d.enabled; if ('strength' in d) this.strength = d.strength; if ('scale' in d) this.scale = d.scale; };
  }
  detect() {
    const W = this.W, tMax = this.tauMax, b = this.aBuf, n = b.length, start = this.aPos;
    if (!this.lin) this.lin = new Float32Array(n);
    const L = this.lin; for (let i = 0, j = start; i < n; i++) { L[i] = b[j]; if (++j === n) j = 0; }
    // энергия — тишину не анализируем
    let en = 0; for (let i = 0; i < W; i++) { const v = L[i]; en += v * v; }
    if (en / W < 1e-5) { this.voiced = false; return; }
    const y = this.yin; y[0] = 1; let run = 0;
    for (let t = 1; t <= tMax; t++) {
      let s = 0; for (let i = 0; i < W; i++) { const d = L[i] - L[i + t]; s += d * d; }
      run += s; y[t] = run ? s * t / run : 1;
    }
    let tau = -1;
    for (let t = this.tauMin; t < tMax; t++) { if (y[t] < 0.15) { while (t + 1 < tMax && y[t + 1] < y[t]) t++; tau = t; break; } }
    if (tau < 0) { this.voiced = false; return; }
    const a = y[tau - 1], c = y[tau], d = y[tau + 1] ?? c; const den = a - 2 * c + d;
    const ft = den ? tau + (a - d) / (2 * den) : tau;
    const f = this.aRate / ft;
    const midi = 69 + 12 * Math.log2(f / 440);
    // ближайшая нота из тональности
    let best = Math.round(midi), bestD = 99;
    for (let k = Math.floor(midi) - 2; k <= Math.ceil(midi) + 2; k++) {
      if (this.scale.includes(((k % 12) + 12) % 12)) { const dd = Math.abs(k - midi); if (dd < bestD) { bestD = dd; best = k; } }
    }
    this.voiced = true; this.f0 = midi; this.target = best;
    this.want = Math.pow(2, (best - midi) / 12);
  }
  process(inputs, outputs) {
    const inp = inputs[0][0], out = outputs[0][0];
    if (!out) return true;
    if (!inp) { out.fill(0); return true; }
    const N = this.N, G = this.G;
    for (let i = 0; i < inp.length; i++) {
      const s = inp[i];
      // анализ
      this.dsAcc += s; if (++this.dsCnt === this.ds) { this.aBuf[this.aPos] = this.dsAcc / this.ds; this.aPos = (this.aPos + 1) % this.aBuf.length; this.dsAcc = 0; this.dsCnt = 0; this.sinceDet++; }
      // запись
      this.buf[this.w] = s;
      if (!this.enabled) { out[i] = s; this.w = (this.w + 1) % N; continue; }
      // плавное движение к нужной ноте: сила 1 — мгновенно (робот), 0 — почти не трогает
      const target = this.voiced ? this.want : 1;
      const k = this.voiced ? (0.0004 + this.strength * this.strength * 0.02) : 0.0005;
      this.ratio += (target - this.ratio) * k;
      this.p += (1 - this.ratio) / G; this.p -= Math.floor(this.p);
      const p2 = (this.p + 0.5) % 1;
      const read = (ph) => { const dly = this.minD + ph * G; let r = this.w - dly; while (r < 0) r += N; const i0 = Math.floor(r), fr = r - i0; return this.buf[i0] * (1 - fr) + this.buf[(i0 + 1) % N] * fr; };
      const gA = 0.5 - 0.5 * Math.cos(2 * Math.PI * this.p), gB = 1 - gA;
      out[i] = read(this.p) * gA + read(p2) * gB;
      this.w = (this.w + 1) % N;
    }
    if (this.sinceDet >= 256 / this.ds * 2) { this.sinceDet = 0; this.detect(); }
    if (currentTime - this.lastMsg > 0.06) { this.lastMsg = currentTime; this.port.postMessage({ voiced: this.voiced, f0: this.f0, target: this.target }); }
    return true;
  }
}
registerProcessor('tuner', Tuner);

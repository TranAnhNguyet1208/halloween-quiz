/*
 * ÂM THANH tổng hợp bằng Web Audio (không cần file âm thanh, chạy offline).
 * Chỉ khởi tạo sau thao tác đầu tiên của người dùng; có thể tắt/bật.
 */
(function (root) {
  'use strict';

  var ctx = null;
  var master = null;
  var enabled = true;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }

  function tone(freq, start, dur, opts) {
    opts = opts || {};
    var t0 = ctx.currentTime + start;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    var vol = opts.vol == null ? 0.3 : opts.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Tiếng "vút" của vệt sáng: nhiễu trắng lọc dải, tần số quét lên.
  function whoosh(start, dur, from, to, vol) {
    var t0 = ctx.currentTime + start;
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  var SOUNDS = {
    summon: function () {
      whoosh(0, 0.9, 300, 4200, 0.22);
      [784, 988, 1175].forEach(function (f, i) { tone(f, 0.12 + i * 0.08, 0.5, { type: 'sine', vol: 0.06 }); });
    },
    reveal: function () { tone(1568, 0, 0.6, { type: 'sine', vol: 0.12 }); tone(2093, 0.05, 0.7, { type: 'sine', vol: 0.08 }); },
    legend: function () {
      whoosh(0, 0.6, 2000, 8000, 0.12);
      [523, 659, 784, 1047, 1319, 1568].forEach(function (f, i) { tone(f, i * 0.08, 0.5, { type: 'triangle', vol: 0.2 }); });
      [1047, 1568, 2093].forEach(function (f) { tone(f, 0.55, 1.4, { type: 'sine', vol: 0.1 }); });
    },
    click: function () { tone(660, 0, 0.08, { type: 'triangle', vol: 0.15 }); },
    select: function () { tone(520, 0, 0.1, { type: 'triangle', vol: 0.18 }); tone(780, 0.06, 0.12, { type: 'triangle', vol: 0.14 }); },
    lock: function () { tone(220, 0, 0.5, { type: 'sawtooth', vol: 0.08 }); tone(330, 0, 0.5, { type: 'triangle', vol: 0.12 }); tone(440, 0.25, 0.8, { type: 'sine', vol: 0.1 }); },
    correct: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.09, 0.35, { type: 'triangle', vol: 0.22 }); }); },
    wrong: function () { tone(200, 0, 0.55, { type: 'sawtooth', to: 90, vol: 0.18 }); tone(150, 0.1, 0.6, { type: 'square', to: 70, vol: 0.08 }); },
    level: function () { [392, 523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.15 + i * 0.07, 0.3, { type: 'triangle', vol: 0.16 }); }); },
    tick: function () { tone(1400, 0, 0.035, { type: 'square', vol: 0.05 }); },
    win: function () {
      [523, 659, 784].forEach(function (f, i) { tone(f, i * 0.1, 0.25, { type: 'triangle', vol: 0.22 }); });
      [1047, 1319, 1568].forEach(function (f) { tone(f, 0.32, 0.9, { type: 'triangle', vol: 0.12 }); });
    },
    none: function () { tone(392, 0, 0.25, { type: 'triangle', vol: 0.16 }); tone(330, 0.2, 0.25, { type: 'triangle', vol: 0.16 }); tone(262, 0.4, 0.5, { type: 'triangle', vol: 0.16 }); }
  };

  root.HQSound = {
    unlock: unlock,
    setEnabled: function (on) { enabled = !!on; },
    isEnabled: function () { return enabled; },
    play: function (name) {
      if (!enabled || !ctx || !SOUNDS[name]) return;
      try { SOUNDS[name](); } catch (e) { /* âm thanh không bắt buộc */ }
    }
  };
})(window);

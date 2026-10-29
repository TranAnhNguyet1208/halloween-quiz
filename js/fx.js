/*
 * HIỆU ỨNG HÌNH ẢNH (chỉ trang trí, không quyết định kết quả).
 * Nhẹ cho laptop phổ thông: một canvas dùng chung, tối đa ~150 hạt, tự dừng khi xong.
 * Bật "giảm chuyển động" trên máy: bỏ vệt sáng, hạt và chuyển cảnh.
 */
(function (root) {
  'use strict';

  // Màu theo loại quà ĐÃ CHỐT — chỉ dùng tại thời điểm công bố (vệt sáng trước đó luôn trung tính).
  var TIER_COLORS = {
    legend: ['#ffe08a', '#ffc23d', '#fff6d6', '#ffb347'],
    epic: ['#c99bff', '#a35cff', '#efe0ff'],
    rare: ['#7fe3ff', '#38b6e8', '#e2f8ff'],
    common: ['#ffb37a', '#ff7a18', '#fff0e0'],
    none: ['#b9a8d6', '#7d6a9c']
  };

  function reduced() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function $(id) { return document.getElementById(id); }

  function replay(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }

  // Vệt sáng trung tính quét qua màn hình khi bắt đầu quay (cùng một màu cho mọi kết quả).
  function streak() {
    if (reduced()) return;
    replay($('summonFx'), 'go-streak', 900);
  }

  // Lóe sáng tại (x, y) theo màu của kết quả đã chốt.
  function flash(tier, x, y) {
    var fx = $('summonFx');
    var c = (TIER_COLORS[tier] || TIER_COLORS.none)[0];
    fx.style.setProperty('--fx-x', x + 'px');
    fx.style.setProperty('--fx-y', y + 'px');
    fx.style.setProperty('--fx-color', c);
    if (reduced()) return;
    replay(fx, 'go-flash', 700);
  }

  var raf = null;
  function particles(kind, opts) {
    if (reduced()) return;
    var cv = $('confetti'), ctx = cv.getContext('2d');
    var w = cv.width = root.innerWidth, h = cv.height = root.innerHeight;
    var parts = [];
    var life = kind === 'confetti' ? 2600 : 1500;
    if (kind === 'confetti') {
      var colors = ['#ff7a18', '#ffd27a', '#9b4dff', '#ff4fa3', '#7CFFB2', '#ffffff'];
      for (var i = 0; i < 140; i++) {
        parts.push({ x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.42, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 4,
          s: 5 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[i % colors.length], g: 0.38, shape: 'rect' });
      }
    } else {
      var pal = TIER_COLORS[opts.tier] || TIER_COLORS.none;
      var n = opts.tier === 'legend' ? 150 : opts.tier === 'none' ? 24 : 80;
      for (var k = 0; k < n; k++) {
        var a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * (opts.tier === 'legend' ? 11 : 7);
        parts.push({ x: opts.x, y: opts.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 1.5 + Math.random() * 3.5,
          c: pal[k % pal.length], g: 0.03, drag: 0.965, shape: k % 5 === 0 ? 'star' : 'dot', r: Math.random() * 3 });
      }
    }
    cancelAnimationFrame(raf);
    var t0 = performance.now();
    function star(x, y, s, r) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.beginPath();
      for (var j = 0; j < 4; j++) { ctx.rotate(Math.PI / 2); ctx.lineTo(0, -s * 2.6); ctx.lineTo(s * 0.5, -s * 0.5); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    (function frame(now) {
      var t = now - t0;
      ctx.clearRect(0, 0, w, h);
      var alpha = Math.max(0, 1 - t / life);
      parts.forEach(function (p) {
        if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; } else p.vx *= 0.99;
        p.vy += p.g; p.x += p.vx; p.y += p.vy;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.c;
        if (p.shape === 'rect') {
          p.r += p.vr;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
        } else if (p.shape === 'star') star(p.x, p.y, p.s, p.r);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill(); }
      });
      ctx.globalAlpha = 1;
      if (t < life) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, w, h);
    })(t0);
  }

  // Chuyển cảnh ngắn (sương tím lướt qua) khi đổi màn hình.
  function sceneWipe() {
    if (reduced()) return;
    replay($('sceneWipe'), 'go', 750);
  }

  root.HQFx = {
    reduced: reduced,
    streak: streak,
    flash: flash,
    burst: function (tier, x, y) { flash(tier, x, y); particles('burst', { tier: tier, x: x, y: y }); },
    confetti: function () { particles('confetti'); },
    sceneWipe: sceneWipe
  };
})(window);

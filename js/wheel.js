/*
 * VÒNG QUAY (SVG). Chỉ lo phần hình ảnh: kết quả đã được chốt trước,
 * vòng quay chỉ quay tới đúng ô của kết quả đó (dùng HQLogic.spinTarget).
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var L = root.HQLogic;

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  function pt(r, deg) {
    var a = deg * Math.PI / 180;
    return (r * Math.sin(a)).toFixed(3) + ' ' + (-r * Math.cos(a)).toFixed(3);
  }

  function HQWheel(container, prizes) {
    this.prizes = prizes;
    this.n = prizes.length;
    this.rotation = 0;
    this.spinning = false;
    this.build(container);
    this.setRotation(L.restRotation(0, this.n, 0));
  }

  HQWheel.prototype.build = function (container) {
    var n = this.n, seg = 360 / n;
    container.innerHTML = '';
    var svg = el('svg', { viewBox: '-112 -118 224 230', class: 'wheel-svg', role: 'img', 'aria-label': 'Vòng quay may mắn' }, container);
    var defs = el('defs', {}, svg);
    var rim = el('linearGradient', { id: 'wRim', x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffe2a3' }, rim);
    el('stop', { offset: '.5', 'stop-color': '#c76a12' }, rim);
    el('stop', { offset: '1', 'stop-color': '#ffd27a' }, rim);
    var shade = el('radialGradient', { id: 'wShade' }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.18' }, shade);
    el('stop', { offset: '.65', 'stop-color': '#fff', 'stop-opacity': '0' }, shade);
    el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '.35' }, shade);
    var hub = el('radialGradient', { id: 'wHub', cx: '.4', cy: '.35' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffcf7a' }, hub);
    el('stop', { offset: '1', 'stop-color': '#c4500c' }, hub);

    el('circle', { r: 109, fill: '#120821', stroke: 'url(#wRim)', 'stroke-width': 6 }, svg);
    var bulbs = el('g', { class: 'wheel-bulbs' }, svg);
    for (var b = 0; b < 30; b++) {
      var xy = pt(103.5, b * 12).split(' ');
      el('circle', { cx: xy[0], cy: xy[1], r: 2.2, class: b % 2 ? 'bulb bulb-b' : 'bulb bulb-a' }, bulbs);
    }

    var rotor = el('g', { class: 'wheel-rotor' }, svg);
    this.rotor = rotor;
    for (var i = 0; i < n; i++) {
      var p = this.prizes[i];
      var a0 = i * seg, a1 = (i + 1) * seg;
      el('path', {
        d: 'M0 0 L' + pt(98, a0) + ' A98 98 0 0 1 ' + pt(98, a1) + ' Z',
        fill: p.color || '#552288', stroke: '#ffd27a', 'stroke-width': 1.4, 'data-slice': i, class: 'wheel-slice'
      }, rotor);
      var label = el('g', { transform: 'rotate(' + (a0 + seg / 2) + ')' }, rotor);
      var icon = el('text', { x: 0, y: -73, class: 'wheel-icon', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, label);
      icon.textContent = p.icon;
      var name = el('text', { x: 0, y: -49, class: 'wheel-name', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, label);
      name.textContent = p.name;
    }
    el('circle', { r: 98, fill: 'url(#wShade)', 'pointer-events': 'none' }, rotor);
    el('circle', { r: 21, fill: 'url(#wHub)', stroke: '#ffe2a3', 'stroke-width': 3 }, svg);
    var hubIcon = el('text', { x: 0, y: 1, class: 'wheel-hub', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg);
    hubIcon.textContent = '🎃';
    this.pointer = el('g', { class: 'wheel-pointer' }, svg);
    el('path', { d: 'M-11 -117 L11 -117 L0 -88 Z', fill: 'url(#wRim)', stroke: '#5a2a00', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, this.pointer);
    el('circle', { cx: 0, cy: -112, r: 3, fill: '#5a2a00' }, this.pointer);
    this.svg = svg;
  };

  HQWheel.prototype.setRotation = function (deg) {
    this.rotation = deg;
    this.rotor.setAttribute('transform', 'rotate(' + deg.toFixed(3) + ')');
    this.svg.setAttribute('data-rotation', deg.toFixed(3));
    this.svg.setAttribute('data-slice', String(L.sliceAtPointer(deg, this.n)));
  };

  HQWheel.prototype.showSlice = function (index) {
    this.setRotation(L.restRotation(index, this.n, 0));
  };

  // Làm sáng ô vừa trúng (index < 0: bỏ làm sáng).
  HQWheel.prototype.highlight = function (index) {
    var slices = this.rotor.querySelectorAll('.wheel-slice');
    for (var i = 0; i < slices.length; i++) slices[i].classList.toggle('is-win', i === index);
  };

  // Bấm vào vòng quay khi đang quay: dừng ngay tại ô đã chốt (không đổi kết quả).
  HQWheel.prototype.skip = function () {
    if (this.spinning) this.skipRequested = true;
  };

  // Quay tới ô `index`. Trả về Promise khi dừng hẳn. onTick: gọi mỗi khi kim lướt qua vạch ô.
  // duration đã được app chọn theo chế độ "giảm chuyển động".
  HQWheel.prototype.spinTo = function (index, duration, onTick) {
    var self = this, n = this.n, seg = 360 / n;
    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dur = duration;
    var turns = reduce ? 1 : 4;
    this.skipRequested = false;
    // lệch ngẫu nhiên trong ô (chỉ để tự nhiên, không ảnh hưởng kết quả), chừa 20% mép mỗi bên
    var offset = (Math.random() * 2 - 1) * seg * 0.3;
    var start = L.normAngle(this.rotation);
    var target = L.spinTarget(start, index, n, turns, offset);
    var lastSlice = L.sliceAtPointer(start, n);
    this.spinning = true;
    this.highlight(-1);
    this.svg.classList.add('is-spinning');
    return new Promise(function (resolve) {
      var t0 = null;
      function frame(now) {
        if (t0 === null) t0 = now;
        var t = self.skipRequested ? 1 : Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - t, 4);
        var deg = start + (target - start) * eased;
        self.setRotation(deg);
        var s = L.sliceAtPointer(deg, n);
        if (s !== lastSlice) {
          lastSlice = s;
          if (onTick) onTick();
          self.pointer.classList.remove('tick');
          void self.pointer.getBBox();
          self.pointer.classList.add('tick');
        }
        if (t < 1) return root.requestAnimationFrame(frame);
        self.setRotation(target);
        self.spinning = false;
        self.svg.classList.remove('is-spinning');
        if (L.sliceAtPointer(target, n) !== index) self.showSlice(index); // phòng hờ, không bao giờ nên xảy ra
        resolve();
      }
      root.requestAnimationFrame(frame);
    });
  };

  root.HQWheel = HQWheel;
})(window);

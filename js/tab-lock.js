/*
 * KHÓA MỘT TAB: chỉ một tab/cửa sổ được xử lý phiên tại một thời điểm.
 * Tab giữ khóa ghi "nhịp tim" vào localStorage; tab khác thấy khóa còn mới thì tự khóa mình.
 * Khóa tự hết hạn nếu tab giữ khóa bị đóng đột ngột (STALE_MS).
 */
(function (root) {
  'use strict';

  var HEARTBEAT_MS = 1500;
  var STALE_MS = 6000;
  var CONFIRM_MS = 150;

  function HQTabLock(key) {
    this.key = key;
    this.id = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
    this.owner = false;
    this.timer = null;
    this.onLost = null;
    var self = this;
    root.addEventListener('storage', function (e) {
      if (e.key === self.key && self.owner) {
        var cur = self.read();
        if (cur && cur.id !== self.id) self.lose();
      }
    });
    root.addEventListener('pagehide', function () { self.release(); });
  }

  HQTabLock.prototype.read = function () {
    try { return JSON.parse(root.localStorage.getItem(this.key)); } catch (e) { return null; }
  };

  HQTabLock.prototype.write = function () {
    root.localStorage.setItem(this.key, JSON.stringify({ id: this.id, ts: Date.now() }));
  };

  HQTabLock.prototype.isFree = function () {
    var cur = this.read();
    return !cur || cur.id === this.id || Date.now() - cur.ts > STALE_MS;
  };

  // force = true: BTC chủ động giành quyền cho tab này.
  HQTabLock.prototype.acquire = function (force) {
    var self = this;
    return new Promise(function (resolve) {
      try {
        if (!force && !self.isFree()) return resolve(false);
        self.write();
      } catch (e) { return resolve(false); }
      setTimeout(function () {
        var cur = self.read();
        if (cur && cur.id === self.id) {
          self.owner = true;
          self.startHeartbeat();
          resolve(true);
        } else resolve(false);
      }, CONFIRM_MS);
    });
  };

  HQTabLock.prototype.startHeartbeat = function () {
    var self = this;
    clearInterval(this.timer);
    this.timer = setInterval(function () { self.beat(); }, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) self.beat(); });
  };

  HQTabLock.prototype.beat = function () {
    if (!this.owner) return;
    var cur = this.read();
    if (cur && cur.id !== this.id) return this.lose();
    try { this.write(); } catch (e) { /* lần ghi sau thử lại */ }
  };

  // Kiểm tra ngay trước mỗi lần ghi dữ liệu game.
  HQTabLock.prototype.isOwner = function () {
    if (!this.owner) return false;
    var cur = this.read();
    if (cur && cur.id !== this.id) { this.lose(); return false; }
    return true;
  };

  HQTabLock.prototype.lose = function () {
    if (!this.owner) return;
    this.owner = false;
    clearInterval(this.timer);
    if (this.onLost) this.onLost();
  };

  HQTabLock.prototype.release = function () {
    if (!this.owner) return;
    var cur = this.read();
    if (cur && cur.id === this.id) {
      try { root.localStorage.removeItem(this.key); } catch (e) { /* bỏ qua */ }
    }
    this.owner = false;
    clearInterval(this.timer);
  };

  root.HQTabLock = HQTabLock;
})(window);

/*
 * LƯU TRỮ (localStorage). Toàn bộ sự kiện nằm trong MỘT khóa "<tiền tố>:event" có version,
 * nên mỗi thao tác chỉ ghi một lần (không ghi dở nhiều khóa).
 * Mỗi lần ghi đều kiểm tra số hiệu bản ghi (rev) chưa bị tab khác đổi, rồi đọc lại để xác nhận đã lưu thật.
 * Dữ liệu hỏng / bản cũ KHÔNG bị tự xóa: trả về trạng thái để BTC quyết định.
 */
(function (root) {
  'use strict';

  function HQStorage(prefix, legacyPrefixes) {
    this.prefix = prefix;
    this.legacyPrefixes = legacyPrefixes || [];
    this.keys = {
      state: prefix + ':event',
      lock: prefix + ':lock',
      prefs: prefix + ':prefs',
      backupPrefix: prefix + ':backup:'
    };
  }

  HQStorage.prototype.ls = function () {
    return root.localStorage;
  };

  HQStorage.prototype.probe = function () {
    try {
      var ls = this.ls();
      var k = this.keys.state + ':probe';
      var v = String(Date.now());
      ls.setItem(k, v);
      var ok = ls.getItem(k) === v;
      ls.removeItem(k);
      return ok ? { ok: true } : { ok: false, error: 'Đọc lại không khớp.' };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  };

  HQStorage.prototype.readRaw = function (key) {
    try { return this.ls().getItem(key); } catch (e) { return null; }
  };

  HQStorage.prototype.writeVerified = function (key, value) {
    try {
      var json = JSON.stringify(value);
      this.ls().setItem(key, json);
      return this.ls().getItem(key) === json;
    } catch (e) {
      return false;
    }
  };

  /*
   * status: 'empty' | 'ok' | 'corrupt' (hỏng) | 'incompatible' (khác phiên bản hoặc khác danh mục quà)
   */
  HQStorage.prototype.loadState = function (config) {
    var Inv = root.HQInventory;
    var raw = this.readRaw(this.keys.state);
    if (raw === null) return { status: 'empty' };
    var obj;
    try { obj = JSON.parse(raw); } catch (e) {
      return { status: 'corrupt', raw: raw, errors: ['Không đọc được JSON của dữ liệu sự kiện.'] };
    }
    if (obj && obj.format === Inv.FORMAT && obj.version !== Inv.VERSION) {
      return { status: 'incompatible', raw: raw, errors: ['Dữ liệu sự kiện phiên bản ' + obj.version + ', game hiện tại dùng phiên bản ' + Inv.VERSION + '.'] };
    }
    var errors = Inv.validateState(obj);
    if (errors.length) return { status: 'corrupt', raw: raw, errors: errors };
    var compat = config ? Inv.compatErrors(obj, config) : [];
    if (compat.length) return { status: 'incompatible', raw: raw, errors: compat, state: obj };
    return { status: 'ok', state: obj };
  };

  HQStorage.prototype.storedRev = function () {
    var raw = this.readRaw(this.keys.state);
    if (raw === null) return null;
    try { var o = JSON.parse(raw); return o && typeof o.rev === 'number' ? o.rev : -1; } catch (e) { return -1; }
  };

  /*
   * Ghi trạng thái mới. prevRev = rev của bản đang dùng (null nếu chưa có bản nào).
   * Nếu bản đang lưu đã bị nơi khác đổi (rev khác) -> từ chối ('conflict'), không ghi đè.
   * opts.overwrite = true: BTC chủ động thay toàn bộ (khởi tạo / nhập sao lưu) — vẫn tăng rev.
   */
  HQStorage.prototype.saveState = function (next, prevRev, opts) {
    var stored = this.storedRev();
    if (!(opts && opts.overwrite) && stored !== prevRev) return { ok: false, reason: 'conflict' };
    var base = typeof stored === 'number' && stored >= 0 ? stored : -1;
    var out = JSON.parse(JSON.stringify(next));
    out.rev = Math.max(base, typeof prevRev === 'number' ? prevRev : -1) + 1;
    return this.writeVerified(this.keys.state, out) ? { ok: true, state: out } : { ok: false, reason: 'write-failed' };
  };

  // Các khóa dữ liệu của bản cũ (trước khi có kho quà) còn trong trình duyệt.
  HQStorage.prototype.legacyKeys = function () {
    var out = [];
    try {
      var ls = this.ls();
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (this.legacyPrefixes.some(function (p) { return k === p + ':current' || k === p + ':history'; })) out.push(k);
      }
    } catch (e) { /* không đọc được: coi như không có */ }
    return out.sort();
  };

  // Sao chép nguyên văn mọi khóa của bản cũ (kể cả bản sao lưu cũ) để BTC tải về.
  HQStorage.prototype.legacyDump = function () {
    var dump = {};
    try {
      var ls = this.ls();
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (this.legacyPrefixes.some(function (p) { return k.indexOf(p + ':') === 0 && k !== p + ':lock'; })) dump[k] = ls.getItem(k);
      }
    } catch (e) { /* bỏ qua */ }
    return dump;
  };

  // Sao lưu nguyên văn dữ liệu sự kiện (kể cả dữ liệu hỏng) sang một khóa riêng trước khi BTC tạo lại.
  HQStorage.prototype.backupRaw = function () {
    var snapshot = {
      backedUpAt: new Date().toISOString(),
      event: this.readRaw(this.keys.state),
      legacy: this.legacyDump()
    };
    var key = this.keys.backupPrefix + Date.now();
    var ok = false;
    try { this.ls().setItem(key, JSON.stringify(snapshot)); ok = true; } catch (e) { ok = false; }
    return { ok: ok, key: key, snapshot: snapshot };
  };

  HQStorage.prototype.getPrefs = function () {
    try { return JSON.parse(this.readRaw(this.keys.prefs)) || {}; } catch (e) { return {}; }
  };

  HQStorage.prototype.setPref = function (name, value) {
    var p = this.getPrefs();
    p[name] = value;
    this.writeVerified(this.keys.prefs, p);
  };

  root.HQStorage = HQStorage;
})(typeof window !== 'undefined' ? window : globalThis);

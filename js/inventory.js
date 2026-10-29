/*
 * KHO QUÀ & TRẠNG THÁI SỰ KIỆN (thuần, không đụng tới giao diện hay bộ nhớ trình duyệt).
 *
 * Toàn bộ sự kiện nằm trong MỘT bản ghi có version:
 *   { format, version, rev, eventId, createdAt, catalog, allocations, log, history, current, seq }
 * - catalog: danh mục quà vật lý và tồn kho ban đầu, chụp lại lúc khởi tạo sự kiện.
 * - allocations: mỗi phần quà đã trúng là một dòng { sessionId, spin, prize, status }.
 *   status: 'reserved' (đã giữ chỗ, chưa trao) | 'awarded' (đã trao) | 'released' (BTC hoàn kho).
 * - log: nhật ký BTC (khởi tạo, điều chỉnh kho, hoàn kho, xác nhận trao, nhập sao lưu).
 * Số quà khả dụng KHÔNG được lưu riêng mà luôn tính lại:
 *   khả dụng = ban đầu + tổng điều chỉnh − đang giữ chỗ − đã trao
 * nên không có hai bộ đếm có thể lệch nhau.
 * Các hàm thay đổi trạng thái luôn trả về BẢN SAO mới.
 */
(function (root) {
  'use strict';

  var L = root.HQLogic || (typeof require === 'function' ? require('./game-logic.js') : null);

  var FORMAT = 'hq-halloween-event';
  var BACKUP_FORMAT = 'hq-halloween-backup';
  var VERSION = 2;
  var ALLOC_STATUS = { reserved: 'Đang giữ chỗ', awarded: 'Đã trao', released: 'Đã hoàn kho' };
  var LOG_LABEL = {
    init: 'Khởi tạo sự kiện',
    adjust: 'Điều chỉnh kho',
    release: 'Hoàn kho quà giữ chỗ',
    award: 'Xác nhận đã trao quà giữ chỗ',
    import: 'Nhập sao lưu'
  };
  var MAX_ADJUST = 1000;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function iso(now) { return new Date(now).toISOString(); }
  function isInt(n) { return typeof n === 'number' && Math.floor(n) === n && isFinite(n); }

  function catalogFrom(config) {
    return config.PRIZES.filter(function (p) { return p.isPrize !== false; })
      .map(function (p) { return { id: p.id, name: p.name, icon: p.icon, initial: p.stock }; });
  }

  function newEventId(now) {
    var d = new Date(now);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return 'E' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function createEvent(config, session, now, note) {
    var catalog = catalogFrom(config);
    var stock = {};
    catalog.forEach(function (c) { stock[c.id] = c.initial; });
    return {
      format: FORMAT,
      version: VERSION,
      rev: 0,
      eventId: newEventId(now),
      createdAt: iso(now),
      catalog: catalog,
      allocations: [],
      log: [{ at: iso(now), kind: 'init', reason: note || 'Khởi tạo sự kiện mới', stock: stock }],
      history: [],
      current: session,
      seq: 0
    };
  }

  // ---------- Tính tồn kho (luôn suy ra từ catalog + log + allocations) ----------

  function summary(state) {
    var rows = {};
    state.catalog.forEach(function (c) {
      rows[c.id] = { id: c.id, name: c.name, icon: c.icon, initial: c.initial, adjust: 0, reserved: 0, awarded: 0, released: 0, available: 0 };
    });
    state.log.forEach(function (e) { if (e.kind === 'adjust' && rows[e.prize]) rows[e.prize].adjust += e.delta; });
    state.allocations.forEach(function (a) { if (rows[a.prize] && rows[a.prize][a.status] !== undefined) rows[a.prize][a.status]++; });
    var list = state.catalog.map(function (c) {
      var r = rows[c.id];
      r.available = r.initial + r.adjust - r.reserved - r.awarded;
      return r;
    });
    function sum(k) { return list.reduce(function (s, r) { return s + r[k]; }, 0); }
    return { list: list, byId: rows, available: sum('available'), reserved: sum('reserved'), awarded: sum('awarded'), initial: sum('initial') };
  }

  function available(state) {
    var out = {};
    summary(state).list.forEach(function (r) { out[r.id] = r.available; });
    return out;
  }

  function allOut(state) { return summary(state).available <= 0; }

  // ---------- Thao tác phiên ----------

  function withCurrent(state, session) {
    var s = clone(state);
    s.current = session;
    return s;
  }

  function isPhysical(state, id) { return state.catalog.some(function (c) { return c.id === id; }); }

  // Phần hỏi vừa kết thúc: lưu phiên đã chốt kết quả và giữ chỗ quà TRONG CÙNG một bản ghi.
  function commitQuizEnd(state, session, now) {
    var s = clone(state);
    s.current = session;
    session.gacha.results.forEach(function (id, i) {
      if (!isPhysical(s, id)) return;
      s.seq++;
      s.allocations.push({ id: 'A' + s.seq, sessionId: session.id, spin: i, prize: id, status: 'reserved', at: iso(now) });
    });
    var bad = summary(s).list.filter(function (r) { return r.available < 0; });
    if (bad.length) return { ok: false, reason: 'over-stock', prizes: bad.map(function (r) { return r.id; }) };
    return { ok: true, state: s };
  }

  function reservedOf(state, sessionId) {
    return state.allocations.filter(function (a) { return a.sessionId === sessionId && a.status === 'reserved'; });
  }

  function countBy(allocs) {
    var c = {};
    allocs.forEach(function (a) { c[a.prize] = (c[a.prize] || 0) + 1; });
    return c;
  }

  /*
   * Đóng phiên hiện tại và mở phiên mới (không đụng tới kho, nhật ký hay cài đặt sự kiện).
   * status 'awarded': quà giữ chỗ của phiên chuyển sang "đã trao" (bấm lại không trừ thêm).
   * status 'cancelled': quà giữ chỗ VẪN giữ chỗ; BTC xử lý riêng bằng awardHeld / releaseHeld.
   */
  function closeCurrent(state, status, newSession, now) {
    var s = clone(state);
    var cur = s.current;
    if (status === 'awarded') {
      s.allocations.forEach(function (a) {
        if (a.sessionId === cur.id && a.status === 'reserved') { a.status = 'awarded'; a.awardedAt = iso(now); }
      });
    }
    if (!s.history.some(function (h) { return h.sessionId === cur.id; })) {
      var entry = L.makeHistoryEntry(cur, status, now);
      entry.heldAfterClose = reservedOf(s, cur.id).length;
      s.history.push(entry);
    }
    s.current = newSession;
    return s;
  }

  // Các phiên đã đóng nhưng còn quà giữ chỗ (thường là phiên BTC hủy).
  function heldSessions(state) {
    var bySession = {};
    state.allocations.forEach(function (a) {
      if (a.status !== 'reserved' || a.sessionId === state.current.id) return;
      (bySession[a.sessionId] = bySession[a.sessionId] || []).push(a);
    });
    return Object.keys(bySession).map(function (id) {
      var h = state.history.filter(function (x) { return x.sessionId === id; })[0];
      return { sessionId: id, status: h ? h.status : '', closedAt: h ? h.closedAt : '', counts: countBy(bySession[id]), total: bySession[id].length };
    });
  }

  // action 'award': phiên bị hủy nhưng người chơi đã nhận quà; 'release': hoàn quà về kho khả dụng.
  function resolveHeld(state, sessionId, action, reason, now) {
    if (action !== 'award' && action !== 'release') return { ok: false, reason: 'bad-action' };
    if (state.current && sessionId === state.current.id) return { ok: false, reason: 'current-session' };
    var why = String(reason || '').trim();
    if (!why) return { ok: false, reason: 'no-reason' };
    if (!reservedOf(state, sessionId).length) return { ok: false, reason: 'nothing-held' };
    var s = clone(state);
    var list = reservedOf(s, sessionId);
    list.forEach(function (a) {
      if (action === 'award') { a.status = 'awarded'; a.awardedAt = iso(now); }
      else { a.status = 'released'; a.releasedAt = iso(now); }
    });
    s.log.push({ at: iso(now), kind: action, sessionId: sessionId, counts: countBy(list), reason: why.slice(0, 200) });
    return { ok: true, state: s };
  }

  // Cộng/trừ quà KHẢ DỤNG. Không trừ quá số khả dụng nên không bao giờ lấy quà đang giữ chỗ.
  function adjust(state, prizeId, delta, reason, now) {
    if (!isPhysical(state, prizeId)) return { ok: false, reason: 'bad-prize' };
    if (!isInt(delta) || delta === 0 || Math.abs(delta) > MAX_ADJUST) return { ok: false, reason: 'bad-delta' };
    var why = String(reason || '').trim();
    if (!why) return { ok: false, reason: 'no-reason' };
    var before = available(state)[prizeId];
    if (before + delta < 0) return { ok: false, reason: 'insufficient', available: before };
    var s = clone(state);
    s.log.push({ at: iso(now), kind: 'adjust', prize: prizeId, delta: delta, reason: why.slice(0, 200), availableBefore: before, availableAfter: before + delta });
    return { ok: true, state: s };
  }

  // ---------- Kiểm tra dữ liệu ----------

  function validateState(st) {
    var e = [];
    function bad(m) { e.push(m); }
    if (!st || typeof st !== 'object') return ['Không phải dữ liệu sự kiện.'];
    if (st.format !== FORMAT) return ['Không đúng định dạng dữ liệu sự kiện.'];
    if (st.version !== VERSION) return ['Phiên bản dữ liệu ' + st.version + ' không tương thích (cần ' + VERSION + ').'];
    if (!isInt(st.rev) || st.rev < 0) bad('Số hiệu bản ghi không hợp lệ.');
    if (typeof st.eventId !== 'string' || !st.eventId) bad('Thiếu mã sự kiện.');
    if (!isInt(st.seq) || st.seq < 0) bad('Bộ đếm quà không hợp lệ.');
    if (!Array.isArray(st.catalog) || !st.catalog.length) return e.concat('Thiếu danh mục quà.');
    var ids = st.catalog.map(function (c) { return c && c.id; });
    st.catalog.forEach(function (c) {
      if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !isInt(c.initial) || c.initial < 0) bad('Danh mục quà hỏng.');
    });
    if (ids.some(function (id, i) { return ids.indexOf(id) !== i; })) bad('Danh mục quà có mã trùng.');
    if (!Array.isArray(st.allocations) || !Array.isArray(st.log) || !Array.isArray(st.history)) return e.concat('Thiếu dữ liệu kho/lịch sử.');

    var hIds = {};
    st.history.forEach(function (h, i) {
      if (!h || typeof h.sessionId !== 'string' || !Array.isArray(h.prizes) || !L.STATUS_LABEL[h.status]) bad('Lịch sử dòng ' + (i + 1) + ' hỏng.');
      else if (hIds[h.sessionId]) bad('Lịch sử có phiên trùng: ' + h.sessionId);
      else hIds[h.sessionId] = true;
    });
    st.log.forEach(function (x, i) {
      if (!x || !LOG_LABEL[x.kind] || typeof x.at !== 'string') bad('Nhật ký dòng ' + (i + 1) + ' hỏng.');
      else if (x.kind === 'adjust' && (ids.indexOf(x.prize) < 0 || !isInt(x.delta) || x.delta === 0)) bad('Nhật ký điều chỉnh dòng ' + (i + 1) + ' hỏng.');
    });

    var sessErr = L.validateSession(st.current);
    if (sessErr.length) return e.concat(sessErr.map(function (m) { return 'Phiên hiện tại: ' + m; }));
    var cur = st.current;
    if (hIds[cur.id]) bad('Phiên hiện tại đã nằm trong lịch sử.');

    var aIds = {}, slots = {};
    st.allocations.forEach(function (a, i) {
      if (!a || typeof a.id !== 'string' || ids.indexOf(a.prize) < 0 || !ALLOC_STATUS[a.status] || !isInt(a.spin) || a.spin < 0) { bad('Quà giữ chỗ dòng ' + (i + 1) + ' hỏng.'); return; }
      if (aIds[a.id]) bad('Mã quà giữ chỗ trùng: ' + a.id);
      aIds[a.id] = true;
      var slot = a.sessionId + '#' + a.spin;
      if (slots[slot]) bad('Một lượt quay có hai phần quà: ' + slot);
      slots[slot] = a;
      if (a.sessionId !== cur.id && !hIds[a.sessionId]) bad('Quà giữ chỗ thuộc phiên không tồn tại: ' + a.sessionId);
    });
    // Phiên hiện tại: quà giữ chỗ phải khớp đúng từng kết quả đã chốt.
    var mine = st.allocations.filter(function (a) { return a && a.sessionId === cur.id; });
    var physicalResults = 0;
    cur.gacha.results.forEach(function (id, i) {
      var a = slots[cur.id + '#' + i];
      if (ids.indexOf(id) >= 0) {
        physicalResults++;
        if (!a || a.prize !== id || a.status !== 'reserved') bad('Lượt ' + (i + 1) + ' của phiên hiện tại không khớp quà giữ chỗ.');
      } else if (a) bad('Lượt ' + (i + 1) + ' của phiên hiện tại không trúng quà nhưng lại có quà giữ chỗ.');
    });
    if (mine.length !== physicalResults) bad('Số quà giữ chỗ của phiên hiện tại không khớp kết quả.');

    if (!e.length) {
      summary(st).list.forEach(function (r) { if (r.available < 0) bad('Tồn kho "' + r.name + '" bị âm.'); });
    }
    return e;
  }

  // Danh mục quà của sự kiện phải khớp cấu hình hiện tại; khác nhau = phải khởi tạo sự kiện mới.
  function compatErrors(state, config) {
    var want = catalogFrom(config).map(function (c) { return c.id; });
    var have = state.catalog.map(function (c) { return c.id; });
    var e = [];
    if (want.join('|') !== have.join('|')) e.push('Danh mục quà của sự kiện đã lưu (' + have.join(', ') + ') khác cấu hình hiện tại (' + want.join(', ') + ').');
    var cfgIds = config.PRIZES.map(function (p) { return p.id; });
    if (state.current.gacha.prizes.some(function (p) { return cfgIds.indexOf(p.id) < 0; })) e.push('Phiên đang lưu dùng ô quà không còn trong cấu hình.');
    return e;
  }

  // ---------- Sao lưu ----------

  function makeBackup(state, now) {
    return { format: BACKUP_FORMAT, version: VERSION, exportedAt: iso(now), state: state };
  }

  // Đọc file sao lưu; chỉ trả ok khi dữ liệu hợp lệ hoàn toàn. Không đụng tới trạng thái đang chạy.
  function parseBackup(text, config) {
    var obj;
    try { obj = JSON.parse(text); } catch (err) { return { ok: false, errors: ['File không phải JSON hợp lệ.'] }; }
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['File không chứa dữ liệu.'] };
    var st = null;
    if (obj.format === BACKUP_FORMAT) {
      if (obj.version !== VERSION) return { ok: false, errors: ['Bản sao lưu phiên bản ' + obj.version + ' không tương thích (cần ' + VERSION + ').'] };
      st = obj.state;
    } else if (obj.format === FORMAT) st = obj;
    else if (Array.isArray(obj.sessions) || 'current' in obj || 'history' in obj) {
      return { ok: false, legacy: true, errors: ['Đây là dữ liệu của bản cũ (trước khi có kho quà). Không nhập được vào sự kiện hiện tại.'] };
    } else return { ok: false, errors: ['Không nhận ra định dạng file sao lưu.'] };
    var errors = validateState(st);
    if (!errors.length && config) errors = compatErrors(st, config);
    return errors.length ? { ok: false, errors: errors } : { ok: true, state: st };
  }

  function logToCSV(state) {
    var names = {};
    state.catalog.forEach(function (c) { names[c.id] = c.name; });
    function counts(c) { return Object.keys(c || {}).map(function (k) { return (names[k] || k) + ' x' + c[k]; }).join(' | '); }
    var header = ['STT', 'Thời gian', 'Thao tác', 'Món', 'Thay đổi khả dụng', 'Khả dụng sau', 'Phiên', 'Chi tiết', 'Lý do'];
    var rows = state.log.map(function (x, i) {
      var detail = x.kind === 'init' ? counts(x.stock) : x.counts ? counts(x.counts) : '';
      var change = x.kind === 'adjust' ? (x.delta > 0 ? '+' : '') + x.delta : '';
      return [i + 1, x.at, LOG_LABEL[x.kind] || x.kind, x.prize ? names[x.prize] || x.prize : '', change,
        x.kind === 'adjust' ? x.availableAfter : '', x.sessionId || '', detail, x.reason || ''];
    });
    return [header].concat(rows).map(function (r) { return r.map(L.csvCell).join(','); }).join('\r\n');
  }

  var api = {
    FORMAT: FORMAT,
    BACKUP_FORMAT: BACKUP_FORMAT,
    VERSION: VERSION,
    ALLOC_STATUS: ALLOC_STATUS,
    LOG_LABEL: LOG_LABEL,
    MAX_ADJUST: MAX_ADJUST,
    catalogFrom: catalogFrom,
    createEvent: createEvent,
    summary: summary,
    available: available,
    allOut: allOut,
    withCurrent: withCurrent,
    commitQuizEnd: commitQuizEnd,
    reservedOf: reservedOf,
    closeCurrent: closeCurrent,
    heldSessions: heldSessions,
    resolveHeld: resolveHeld,
    adjust: adjust,
    validateState: validateState,
    compatErrors: compatErrors,
    makeBackup: makeBackup,
    parseBackup: parseBackup,
    logToCSV: logToCSV
  };

  root.HQInventory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

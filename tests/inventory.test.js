/*
 * Kiểm thử kho quà, giữ chỗ, sao lưu và lưu trữ. Chạy:  node tests/inventory.test.js
 * localStorage được giả lập trong bộ nhớ (dùng chung giữa hai "tab").
 */
'use strict';
const assert = require('node:assert/strict');
const L = require('../js/game-logic.js');
const Inv = require('../js/inventory.js');
const CONFIG = require('../js/config.js');
const BANK = require('../js/questions-data.js');

// localStorage giả lập
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  key: (i) => Array.from(mem.keys())[i] ?? null,
  get length() { return mem.size; }
};
require('../js/storage.js');
const HQStorage = globalThis.HQStorage;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { console.error('  ✘ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
}
function scripted(values) {
  let i = 0;
  return () => { if (i >= values.length) throw new Error('rng hết giá trị kịch bản'); return values[i++]; };
}
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = { bear: 0.005, puzzle: 0.06, sticker: 0.16, candy: 0.35, nothing: 0.75 };
let clock = Date.parse('2026-10-31T18:00:00Z');
const now = () => (clock += 1000);
const newSession = () => L.createSession(BANK, CONFIG, seeded(clock), now());
const fresh = () => Inv.createEvent(CONFIG, newSession(), now());
const avail = (st) => Inv.available(st);
const row = (st, id) => Inv.summary(st).byId[id];

// Chơi phiên hiện tại tới hết phần hỏi với `correct` câu đúng (đi qua đúng đường mà app dùng).
function playQuiz(st, correct, rng) {
  let s = L.startQuiz(st.current, now()).session;
  st = Inv.withCurrent(st, s);
  for (let i = 0; i < 10; i++) {
    const q = st.current.questions[i];
    const ok = i < correct;
    const r = L.submitAnswer(st.current, i, ok ? q.correctIndex : (q.correctIndex + 1) % 3, CONFIG, rng || seeded(i + clock), now(), Inv.available(st));
    if (r.finished) {
      const c = Inv.commitQuizEnd(st, r.session, now());
      assert.ok(c.ok, 'commitQuizEnd: ' + c.reason);
      st = c.state;
      break;
    }
    st = Inv.withCurrent(st, r.session);
  }
  assert.deepEqual(Inv.validateState(st), []);
  return st;
}
function openAll(st) {
  let s = L.proceedFromResult(st.current).session;
  while (s.phase === 'gacha' && s.gacha.opened < s.gacha.spinsAwarded) s = L.openNextSpin(s).session;
  if (s.phase === 'gacha') s = L.finishGacha(s).session;
  return Inv.withCurrent(st, s);
}
function award(st) {
  const has = L.groupPrizes(st.current, L.openedResults(st.current)).length > 0;
  return Inv.closeCurrent(st, has ? 'awarded' : 'no-prize', newSession(), now());
}

console.log('Khởi tạo sự kiện');
test('Sự kiện mới: 103 phần quà khả dụng 3/20/20/60, chưa giữ chỗ, chưa trao', () => {
  const st = fresh();
  assert.deepEqual(Inv.validateState(st), []);
  assert.deepEqual(avail(st), { bear: 3, puzzle: 20, sticker: 20, candy: 60 });
  const sm = Inv.summary(st);
  assert.equal(sm.available, 103); assert.equal(sm.reserved, 0); assert.equal(sm.awarded, 0);
  assert.equal(st.log[0].kind, 'init');
});

console.log('Giữ chỗ, trao quà');
test('Kết thúc phần hỏi: quà được giữ chỗ ngay trong cùng bản ghi với kết quả đã chốt', () => {
  let st = playQuiz(fresh(), 10, scripted([R.bear, R.candy]));
  assert.deepEqual(st.current.gacha.results, ['bear', 'candy', 'nothing', 'nothing', 'nothing']);
  assert.deepEqual(avail(st), { bear: 2, puzzle: 20, sticker: 20, candy: 59 });
  assert.equal(row(st, 'bear').reserved, 1);
  assert.equal(Inv.summary(st).reserved, 2);
});
test('Mở lượt quay và tải lại (JSON khứ hồi) không bốc lại, không trừ kho thêm', () => {
  let st = playQuiz(fresh(), 6, scripted([R.sticker, R.nothing, R.puzzle]));
  const before = JSON.stringify(avail(st));
  let s = L.proceedFromResult(st.current).session;
  for (let i = 0; i < 3; i++) {
    s = L.openNextSpin(s).session;
    st = JSON.parse(JSON.stringify(Inv.withCurrent(st, s))); // mô phỏng lưu + tải lại sau mỗi lượt
    assert.deepEqual(Inv.validateState(st), []);
    assert.equal(JSON.stringify(avail(st)), before);
    assert.deepEqual(st.current.gacha.results, ['sticker', 'nothing', 'puzzle']);
  }
});
test('BTC xác nhận trao: giữ chỗ -> đã trao, không trừ khả dụng thêm; bấm lần 2 không đổi gì', () => {
  let st = openAll(playQuiz(fresh(), 4, scripted([R.candy, R.candy])));
  const a1 = avail(st);
  const closed = award(st);
  assert.deepEqual(avail(closed), a1);
  assert.equal(row(closed, 'candy').reserved, 0);
  assert.equal(row(closed, 'candy').awarded, 2);
  assert.equal(closed.history.length, 1);
  assert.equal(closed.history[0].status, 'awarded');
  // bấm lần 2 trên cùng phiên cũ (ví dụ trạng thái cũ còn trong bộ nhớ): không trừ, không ghi lịch sử trùng
  const again = Inv.closeCurrent(Inv.withCurrent(closed, st.current), 'awarded', newSession(), now());
  assert.equal(row(again, 'candy').awarded, 2);
  assert.deepEqual(avail(again), a1);
  assert.equal(again.history.length, 1);
  assert.deepEqual(Inv.validateState(closed), []);
});
test('"Người chơi tiếp theo" không reset tồn kho, nhật ký hay danh mục', () => {
  let st = fresh();
  st = Inv.adjust(st, 'candy', -5, 'Chuyển sang trò chơi khác', now()).state;
  st = award(openAll(playQuiz(st, 2, scripted([R.sticker]))));
  const snap = { a: avail(st), log: st.log.length, cat: JSON.stringify(st.catalog), ev: st.eventId };
  for (let i = 0; i < 5; i++) st = award(openAll(playQuiz(st, 0)));
  assert.deepEqual(avail(st), snap.a);
  assert.equal(st.log.length, snap.log);
  assert.equal(JSON.stringify(st.catalog), snap.cat);
  assert.equal(st.eventId, snap.ev);
  assert.equal(st.history.length, 6);
});

console.log('Điều chỉnh kho');
test('Cộng/trừ khả dụng có ghi nhật ký (món, số lượng, lý do, thời gian)', () => {
  let st = fresh();
  const r = Inv.adjust(st, 'sticker', -4, 'Dùng cho minigame khác', now());
  assert.ok(r.ok);
  st = r.state;
  assert.equal(avail(st).sticker, 16);
  const e = st.log[st.log.length - 1];
  assert.deepEqual([e.kind, e.prize, e.delta, e.reason, e.availableBefore, e.availableAfter], ['adjust', 'sticker', -4, 'Dùng cho minigame khác', 20, 16]);
  assert.match(e.at, /^\d{4}-\d\d-\d\dT/);
  st = Inv.adjust(st, 'sticker', 7, 'Nhận thêm từ nhà tài trợ', now()).state;
  assert.equal(avail(st).sticker, 23);
  assert.equal(row(st, 'sticker').initial, 20);
});
test('Không trừ quá khả dụng và không lấy được quà đang giữ chỗ', () => {
  let st = playQuiz(fresh(), 10, scripted([R.bear, R.bear])); // giữ chỗ 2 gấu, còn 1 khả dụng
  assert.equal(avail(st).bear, 1);
  const r = Inv.adjust(st, 'bear', -2, 'thử', now());
  assert.equal(r.ok, false); assert.equal(r.reason, 'insufficient'); assert.equal(r.available, 1);
  st = Inv.adjust(st, 'bear', -1, 'Tặng khách mời', now()).state;
  assert.equal(avail(st).bear, 0);
  assert.equal(row(st, 'bear').reserved, 2); // quà giữ chỗ không bị ảnh hưởng
  assert.equal(Inv.adjust(st, 'bear', -1, 'thử', now()).reason, 'insufficient');
  assert.deepEqual(Inv.validateState(st), []);
});
test('Điều chỉnh không hợp lệ bị từ chối: thiếu lý do, số lẻ, 0, món lạ, ô "Không quà"', () => {
  const st = fresh();
  assert.equal(Inv.adjust(st, 'candy', 3, '  ', now()).reason, 'no-reason');
  assert.equal(Inv.adjust(st, 'candy', 1.5, 'x', now()).reason, 'bad-delta');
  assert.equal(Inv.adjust(st, 'candy', 0, 'x', now()).reason, 'bad-delta');
  assert.equal(Inv.adjust(st, 'keychain', 1, 'x', now()).reason, 'bad-prize');
  assert.equal(Inv.adjust(st, 'nothing', 1, 'x', now()).reason, 'bad-prize');
});

console.log('Hủy phiên & hoàn kho');
test('Hủy phiên có quà giữ chỗ: quà VẪN giữ chỗ; chỉ hoàn kho bằng thao tác riêng có lý do và nhật ký', () => {
  let st = playQuiz(fresh(), 4, scripted([R.puzzle, R.sticker]));
  const sid = st.current.id;
  st = Inv.closeCurrent(st, 'cancelled', newSession(), now());
  assert.equal(st.history[0].status, 'cancelled');
  assert.equal(st.history[0].heldAfterClose, 2);
  assert.equal(Inv.summary(st).reserved, 2);
  assert.deepEqual(Inv.heldSessions(st).map((h) => [h.sessionId, h.total]), [[sid, 2]]);
  assert.equal(Inv.resolveHeld(st, sid, 'release', '', now()).reason, 'no-reason');
  const r = Inv.resolveHeld(st, sid, 'release', 'Người chơi bỏ về', now());
  assert.ok(r.ok);
  st = r.state;
  assert.deepEqual(avail(st), { bear: 3, puzzle: 20, sticker: 20, candy: 60 });
  assert.equal(row(st, 'puzzle').released, 1);
  const e = st.log[st.log.length - 1];
  assert.deepEqual([e.kind, e.sessionId, e.counts, e.reason], ['release', sid, { puzzle: 1, sticker: 1 }, 'Người chơi bỏ về']);
  assert.equal(Inv.resolveHeld(st, sid, 'release', 'lần 2', now()).reason, 'nothing-held');
  assert.deepEqual(Inv.validateState(st), []);
});
test('Phiên bị hủy nhưng đã nhận quà: BTC xác nhận đã trao (không trừ khả dụng thêm)', () => {
  let st = playQuiz(fresh(), 2, scripted([R.candy]));
  const sid = st.current.id;
  st = Inv.closeCurrent(st, 'cancelled', newSession(), now());
  const a = avail(st);
  st = Inv.resolveHeld(st, sid, 'award', 'Đã đưa kẹo trước khi hủy', now()).state;
  assert.deepEqual(avail(st), a);
  assert.equal(row(st, 'candy').awarded, 1);
});
test('Không thể hoàn kho / chuyển quà giữ chỗ của phiên đang chơi', () => {
  const st = playQuiz(fresh(), 4, scripted([R.bear, R.candy]));
  assert.equal(Inv.resolveHeld(st, st.current.id, 'release', 'x', now()).reason, 'current-session');
  assert.equal(Inv.heldSessions(st).length, 0);
});

console.log('Tồn kho không bao giờ âm');
test('Chơi liên tục tới khi hết sạch 103 phần quà: không âm kho, không vượt kho, tổng khớp', () => {
  let st = fresh();
  const rng = seeded(2026);
  let sessions = 0, singleWithStock = 0;
  while (!Inv.allOut(st) && sessions < 5000) {
    const correct = Math.floor(rng() * 11);
    st = playQuiz(st, correct, rng);
    const g = st.current.gacha;
    if (g.spinsAwarded === 1) { singleWithStock++; assert.notEqual(g.results[0], 'nothing'); }
    Inv.summary(st).list.forEach((r) => assert.ok(r.available >= 0, r.id));
    st = award(openAll(st));
    sessions++;
  }
  const sm = Inv.summary(st);
  assert.equal(sm.available, 0);
  assert.equal(sm.awarded, 103);
  assert.deepEqual(sm.list.map((r) => r.awarded), [3, 20, 20, 60]);
  assert.ok(singleWithStock > 0);
  assert.deepEqual(Inv.validateState(st), []);
});
test('Hết toàn bộ quà: allOut = true; phiên dở (nếu có) nhận "Không quà" + đánh dấu hết quà', () => {
  let st = fresh();
  for (const id of ['bear', 'puzzle', 'sticker', 'candy']) st = Inv.adjust(st, id, -avail(st)[id], 'Hết', now()).state;
  assert.equal(Inv.allOut(st), true);
  st = playQuiz(st, 2, scripted([]));
  assert.deepEqual(st.current.gacha.results, ['nothing']);
  assert.deepEqual(st.current.gacha.soldOut, [true]);
});
test('commitQuizEnd từ chối kết quả vượt kho (phòng hờ)', () => {
  const st = fresh();
  let s = L.startQuiz(st.current, now()).session;
  s = L.submitAnswer(s, 0, s.questions[0].correctIndex, CONFIG, Math.random, now(), { bear: 9, puzzle: 0, sticker: 0, candy: 0 }).session;
  const fake = L.clone(s); // dựng phiên 5 gấu dù kho chỉ có 3
  fake.answers = []; fake.quiz.correctCount = 0;
  for (let i = 0; i < 10; i++) fake.answers.push({ q: i, choice: fake.questions[i].correctIndex, correct: true, at: new Date().toISOString() });
  Object.assign(fake.quiz, { correctCount: 10, status: 'completed' });
  Object.assign(fake.gacha, { spinsAwarded: 5, results: ['bear', 'bear', 'bear', 'bear', 'nothing'], soldOut: [false, false, false, false, false] });
  fake.phase = 'quizResult';
  const r = Inv.commitQuizEnd(st, fake, now());
  assert.equal(r.ok, false); assert.equal(r.reason, 'over-stock');
});

console.log('Kiểm tra dữ liệu & sao lưu');
test('validateState phát hiện dữ liệu bị sửa: kho âm, quà giữ chỗ lệch kết quả, trùng lượt, phiên lạ', () => {
  const st = playQuiz(fresh(), 4, scripted([R.bear, R.candy]));
  const t = [];
  let x = L.clone(st); x.log.push({ at: 'x', kind: 'adjust', prize: 'bear', delta: -9, reason: 'x' }); t.push(x);
  x = L.clone(st); x.allocations[0].prize = 'puzzle'; t.push(x);
  x = L.clone(st); x.allocations.pop(); t.push(x);
  x = L.clone(st); x.allocations.push(Object.assign({}, x.allocations[0], { id: 'A99' })); t.push(x);
  x = L.clone(st); x.allocations[0].sessionId = 'P-LA'; t.push(x);
  x = L.clone(st); x.allocations[0].status = 'awarded'; t.push(x);
  x = L.clone(st); x.version = 1; t.push(x);
  x = L.clone(st); x.catalog[0].initial = -1; t.push(x);
  for (const bad of t) assert.ok(Inv.validateState(bad).length > 0);
  assert.deepEqual(Inv.validateState(st), []);
});
test('Sao lưu: xuất rồi nhập lại được nguyên trạng thái', () => {
  let st = award(openAll(playQuiz(fresh(), 6, scripted([R.sticker, R.candy]))));
  st = Inv.adjust(st, 'puzzle', -3, 'Chuyển sang quầy check-in', now()).state;
  const text = JSON.stringify(Inv.makeBackup(st, now()));
  const r = Inv.parseBackup(text, CONFIG);
  assert.ok(r.ok, (r.errors || []).join('; '));
  assert.deepEqual(r.state, st);
});
test('Nhập dữ liệu sai / bản cũ / phiên bản khác bị từ chối kèm lý do', () => {
  const st = fresh();
  const cases = [
    'không phải json',
    JSON.stringify({ hello: 1 }),
    JSON.stringify({ exportedAt: 'x', sessions: [] }), // file JSON lịch sử của bản cũ
    JSON.stringify({ current: '{}', history: '[]' }), // bản sao dữ liệu lỗi của bản cũ
    JSON.stringify(Object.assign(Inv.makeBackup(st, now()), { version: 1 })),
    JSON.stringify(Inv.makeBackup(Object.assign(L.clone(st), { allocations: [{ id: 'A1', sessionId: st.current.id, spin: 0, prize: 'bear', status: 'reserved' }] }), now()))
  ];
  for (const c of cases) { const r = Inv.parseBackup(c, CONFIG); assert.equal(r.ok, false); assert.ok(r.errors.length > 0); }
  assert.equal(Inv.parseBackup(cases[2], CONFIG).legacy, true);
  // danh mục khác cấu hình (ví dụ bản sao lưu có Móc khóa)
  const other = L.clone(st); other.catalog.push({ id: 'keychain', name: 'Móc khóa', initial: 5 });
  assert.equal(Inv.parseBackup(JSON.stringify(Inv.makeBackup(other, now())), CONFIG).ok, false);
});
test('CSV nhật ký kho có món, thay đổi, lý do, thời gian', () => {
  let st = Inv.adjust(fresh(), 'candy', -10, 'Chuyển, sang "quầy" khác', now()).state;
  const csv = Inv.logToCSV(st);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[2], /Điều chỉnh kho,Kẹo,-10,50/);
  assert.match(lines[2], /"Chuyển, sang ""quầy"" khác"/);
});

console.log('Lưu trữ (localStorage giả lập)');
const P = 'test-ev';
test('Bản ghi duy nhất có version; ghi xác nhận lại; tăng rev mỗi lần', () => {
  mem.clear();
  const store = new HQStorage(P, ['hq-halloween-v1']);
  assert.equal(store.loadState(CONFIG).status, 'empty');
  const r = store.saveState(fresh(), null);
  assert.ok(r.ok); assert.equal(r.state.rev, 0);
  const r2 = store.saveState(r.state, 0);
  assert.equal(r2.state.rev, 1);
  const loaded = store.loadState(CONFIG);
  assert.equal(loaded.status, 'ok');
  assert.equal(loaded.state.rev, 1);
  assert.deepEqual(Array.from(mem.keys()), [P + ':event']);
});
test('Hai tab: tab ghi sau với rev cũ bị từ chối (không cấp quà hai lần trên cùng kho)', () => {
  mem.clear();
  const tabA = new HQStorage(P), tabB = new HQStorage(P);
  const base = tabA.saveState(fresh(), null).state;
  const viewA = tabA.loadState(CONFIG).state, viewB = tabB.loadState(CONFIG).state;
  // cả hai tab cùng chốt kết quả trên cùng tồn kho
  const nextA = playQuiz(viewA, 10, scripted([R.bear, R.bear]));
  const nextB = playQuiz(viewB, 10, scripted([R.bear, R.bear]));
  assert.ok(tabA.saveState(nextA, base.rev).ok);
  const rb = tabB.saveState(nextB, base.rev);
  assert.equal(rb.ok, false); assert.equal(rb.reason, 'conflict');
  const final = tabA.loadState(CONFIG).state;
  assert.equal(Inv.summary(final).byId.bear.reserved, 2);
  assert.equal(Inv.available(final).bear, 1);
});
test('Dữ liệu bản cũ được phát hiện và giữ nguyên (không xóa, không tính vào kho mới)', () => {
  mem.clear();
  mem.set('hq-halloween-v1:current', '{"schema":1,"id":"P1029-1200-AAAAA"}');
  mem.set('hq-halloween-v1:history', '[{"sessionId":"P1","prizes":[{"id":"keychain","name":"Móc khóa","count":1}]}]');
  mem.set('hq-halloween-v1:backup:1', '{}');
  const store = new HQStorage(P, ['hq-halloween-v1']);
  assert.equal(store.loadState(CONFIG).status, 'empty');
  assert.deepEqual(store.legacyKeys(), ['hq-halloween-v1:current', 'hq-halloween-v1:history']);
  assert.deepEqual(Object.keys(store.legacyDump()).sort(), ['hq-halloween-v1:backup:1', 'hq-halloween-v1:current', 'hq-halloween-v1:history']);
  const st = store.saveState(fresh(), null).state;
  assert.equal(Inv.summary(st).available, 103);
  assert.ok(mem.has('hq-halloween-v1:current') && mem.has('hq-halloween-v1:history'));
});
test('Bản ghi phiên bản khác / danh mục khác cấu hình -> "incompatible"; JSON hỏng -> "corrupt"', () => {
  mem.clear();
  const store = new HQStorage(P);
  const st = fresh();
  mem.set(P + ':event', JSON.stringify(Object.assign({}, st, { version: 3 })));
  assert.equal(store.loadState(CONFIG).status, 'incompatible');
  const cfg2 = Object.assign({}, CONFIG, { PRIZES: CONFIG.PRIZES.filter((p) => p.id !== 'sticker') });
  mem.set(P + ':event', JSON.stringify(st));
  assert.equal(store.loadState(cfg2).status, 'incompatible');
  assert.equal(store.loadState(CONFIG).status, 'ok');
  mem.set(P + ':event', '{"format":"hq-halloween-event"');
  assert.equal(store.loadState(CONFIG).status, 'corrupt');
  assert.equal(mem.get(P + ':event'), '{"format":"hq-halloween-event"'); // không tự xóa
});

console.log('\n' + passed + ' kiểm thử đạt' + (process.exitCode ? ' — CÓ LỖI' : ''));

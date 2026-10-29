/*
 * Kiểm thử logic thuần. Chạy:  node tests/logic.test.js
 * Dùng nguồn ngẫu nhiên có kịch bản để kiểm tra chính xác các trường hợp biên.
 */
'use strict';
const assert = require('node:assert/strict');
const L = require('../js/game-logic.js');
const CONFIG = require('../js/config.js');
const BANK = require('../js/questions-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { console.error('  ✘ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
}

// rng trả lần lượt các giá trị cho trước, hết thì báo lỗi (để biết chính xác số lần bốc).
function scripted(values) {
  let i = 0;
  const fn = () => { if (i >= values.length) throw new Error('rng hết giá trị kịch bản'); return values[i++]; };
  fn.used = () => i;
  return fn;
}
// Giá trị rng rơi vào từng ô theo xác suất gốc khi còn đủ hàng: [0,1) [1,11) [11,21) [21,50) [50,100)
const R = { bear: 0.005, puzzle: 0.06, sticker: 0.16, candy: 0.35, nothing: 0.75 };
const IDS = Object.keys(R);
const PHYSICAL = ['bear', 'puzzle', 'sticker', 'candy'];
const FULL = { bear: 3, puzzle: 20, sticker: 20, candy: 60 };
const isPrize = (id) => id !== 'nothing';
const gen = (spins, rng, avail) => L.generateGachaResults(spins, CONFIG, rng, avail || FULL);

function seeded(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function playSession(correctTarget, rng, avail) {
  let s = L.createSession(BANK, CONFIG, seeded(42), Date.now());
  s = L.startQuiz(s, Date.now()).session;
  for (let i = 0; i < 10; i++) {
    const q = s.questions[i];
    const choice = i < correctTarget ? q.correctIndex : (q.correctIndex + 1) % 3;
    const r = L.submitAnswer(s, i, choice, CONFIG, rng || seeded(i), Date.now(), avail || FULL);
    assert.ok(r.ok);
    s = r.session;
    if (r.finished) break;
  }
  return s;
}

/*
 * Phân bố CHÍNH XÁC của phiên 1 lượt: duyệt lưới đều của rng (mỗi 1% = 100 điểm ở lần bốc thứ nhất;
 * lần bốc dự phòng khi hết Kẹo dùng lưới 210 điểm để chia hết cho tổng 21).
 */
function exactSingle(avail) {
  const N1 = 10000, N2 = 210, out = {};
  const add = (id, p) => { out[id] = (out[id] || 0) + p; };
  for (let a = 0; a < N1; a++) {
    const v1 = (a + 0.5) / N1;
    let needSecond = false;
    const probe = () => { let n = 0; return () => { if (n++ === 0) return v1; needSecond = true; throw new Error('second'); }; };
    try { add(gen(1, probe(), avail).results[0], 1 / N1); continue; } catch (e) { if (!needSecond) throw e; }
    for (let b = 0; b < N2; b++) add(gen(1, scripted([v1, (b + 0.5) / N2]), avail).results[0], 1 / N1 / N2);
  }
  return out;
}
function assertDist(got, want, eps) {
  for (const k of new Set([...Object.keys(got), ...Object.keys(want)])) {
    assert.ok(Math.abs((got[k] || 0) - (want[k] || 0)) < (eps || 1e-9), k + ': ' + got[k] + ' ≠ ' + want[k]);
  }
}

console.log('Cấu hình & dữ liệu');
test('Cấu hình mặc định hợp lệ với ngân hàng câu hỏi', () => {
  assert.deepEqual(L.validateConfig(CONFIG, BANK), []);
});
test('Bảng quà chính thức: 1/10/10/29/50, tồn kho 3/20/20/60, tổng 103 phần, không còn Móc khóa', () => {
  const t = CONFIG.PRIZES.map((p) => [p.id, p.name, p.weight, p.stock]);
  assert.deepEqual(t, [['bear', 'Gấu bông', 1, 3], ['puzzle', 'Mảnh ghép', 10, 20], ['sticker', 'Sticker', 10, 20],
    ['candy', 'Kẹo', 29, 60], ['nothing', 'Không quà', 50, null]]);
  assert.equal(CONFIG.PRIZES.filter((p) => p.isPrize).reduce((s, p) => s + p.stock, 0), 103);
  assert.equal(CONFIG.PRIZES.find((p) => p.id === 'nothing').revealName, 'Chúc bạn may mắn lần sau!');
  assert.ok(!CONFIG.PRIZES.some((p) => /Móc khóa/.test(p.name)));
});
test('validateConfig: tổng xác suất khác 100%, xác suất lẻ, tồn kho sai đều bị bắt', () => {
  const mk = (patch) => Object.assign({}, CONFIG, { PRIZES: CONFIG.PRIZES.map((p) => Object.assign({}, p, patch[p.id] || {})) });
  assert.ok(L.validateConfig(mk({ bear: { weight: 2 } }), BANK).some((e) => /100%/.test(e)));
  assert.ok(L.validateConfig(mk({ bear: { weight: 1.45 }, candy: { weight: 28.55 } }), BANK).some((e) => /số nguyên/.test(e)));
  assert.ok(L.validateConfig(mk({ candy: { stock: -1 } }), BANK).some((e) => /tồn kho/.test(e)));
  assert.ok(L.validateConfig(mk({ nothing: { stock: 5 } }), BANK).some((e) => /stock: null/.test(e)));
});
test('Ngân hàng: 59 câu = 23 dễ + 27 trung bình + 9 khó, mỗi câu 3 lựa chọn khác nhau', () => {
  assert.equal(BANK.questions.length, 59);
  assert.deepEqual(BANK.counts, { easy: 23, medium: 27, hard: 9 });
  for (const q of BANK.questions) {
    assert.equal(new Set([q.correct, ...q.wrong]).size, 3);
    assert.ok(!/^Giải thích$/.test(q.text));
  }
  assert.equal(BANK.questions.filter((q) => q.explanation).length, 9);
});
test('validateConfig bắt lỗi thiếu câu và bảng lượt sai độ dài', () => {
  const bad = Object.assign({}, CONFIG, { LEVEL_PLAN: CONFIG.LEVEL_PLAN.concat([{ level: 6, difficulty: 'hard', count: 8 }]) });
  const errs = L.validateConfig(bad, BANK);
  assert.ok(errs.some((e) => /SPIN_TABLE/.test(e)));
  assert.ok(errs.some((e) => /Khó/.test(e)));
});

console.log('Bộ đề');
test('2000 phiên: 10 câu không trùng, đúng độ khó theo level, đáp án đúng giữ nguyên', () => {
  const byId = Object.fromEntries(BANK.questions.map((q) => [q.id, q]));
  const expected = ['easy', 'easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'medium', 'hard', 'hard'];
  const positions = [0, 0, 0];
  for (let seed = 1; seed <= 2000; seed++) {
    const s = L.createSession(BANK, CONFIG, seeded(seed), Date.now());
    assert.equal(s.questions.length, 10);
    assert.equal(new Set(s.questions.map((q) => q.qid)).size, 10);
    s.questions.forEach((q, i) => {
      const src = byId[q.qid];
      assert.equal(q.difficulty, expected[i]);
      assert.equal(src.difficulty, expected[i]);
      assert.equal(q.level, Math.floor(i / 2) + 1);
      assert.equal(q.text, src.text);
      assert.equal(q.options[q.correctIndex], src.correct);
      assert.deepEqual([...q.options].sort(), [src.correct, ...src.wrong].sort());
      positions[q.correctIndex]++;
    });
    assert.deepEqual(L.validateSession(s), []);
  }
  positions.forEach((p) => assert.ok(Math.abs(p / 20000 - 1 / 3) < 0.02, 'phân bố vị trí đáp án đúng lệch: ' + positions));
});

console.log('Luật câu hỏi & lượt quay');
test('Đúng 0..10 câu -> số lượt quay đúng bảng', () => {
  const table = { 0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 4, 10: 5 };
  for (let k = 0; k <= 10; k++) {
    const s = playSession(k);
    assert.equal(s.quiz.correctCount, k);
    assert.equal(s.gacha.spinsAwarded, table[k], k + ' câu đúng');
    assert.equal(s.gacha.results.length, table[k]);
    assert.equal(s.gacha.soldOut.length, table[k]);
    assert.equal(s.quiz.status, k === 10 ? 'completed' : 'failed');
    assert.equal(s.answers.length, k === 10 ? 10 : k + 1);
    assert.equal(L.levelsPassed(s.levelPlan, k), Math.floor(k / 2));
    assert.equal(s.phase, 'quizResult');
    assert.deepEqual(L.validateSession(s), []);
  }
});
test('Ví dụ: đúng 5 rồi sai câu 6 -> 2 lượt', () => {
  const s = playSession(5);
  assert.equal(s.answers.length, 6);
  assert.equal(s.gacha.spinsAwarded, 2);
});
test('Sai là dừng; không thể gửi lại hay trả lời tiếp', () => {
  const s = playSession(3);
  const q = s.questions[3];
  assert.equal(L.submitAnswer(s, 3, q.correctIndex, CONFIG, Math.random, Date.now(), FULL).reason, 'wrong-phase');
  assert.equal(L.submitAnswer(s, 4, 0, CONFIG, Math.random, Date.now(), FULL).reason, 'wrong-phase');
});
test('Mỗi câu chỉ chốt một lần (gửi lại câu đã trả lời bị từ chối)', () => {
  let s = L.startQuiz(L.createSession(BANK, CONFIG, seeded(7), Date.now()), Date.now()).session;
  const r1 = L.submitAnswer(s, 0, s.questions[0].correctIndex, CONFIG, Math.random, Date.now(), FULL);
  assert.ok(r1.ok);
  const again = L.submitAnswer(r1.session, 0, (s.questions[0].correctIndex + 1) % 3, CONFIG, Math.random, Date.now(), FULL);
  assert.equal(again.reason, 'already-answered');
  assert.equal(L.submitAnswer(r1.session, 2, 0, CONFIG, Math.random, Date.now(), FULL).reason, 'already-answered');
  assert.equal(L.submitAnswer(r1.session, 1, 5, CONFIG, Math.random, Date.now(), FULL).reason, 'invalid-choice');
  assert.equal(s.answers.length, 0);
});
test('Chưa bấm Bắt đầu thì không trả lời được; Bắt đầu chỉ một lần', () => {
  const s = L.createSession(BANK, CONFIG, seeded(9), Date.now());
  assert.equal(L.submitAnswer(s, 0, 0, CONFIG, Math.random, Date.now(), FULL).reason, 'wrong-phase');
  const started = L.startQuiz(s, Date.now()).session;
  assert.equal(L.startQuiz(started, Date.now()).reason, 'wrong-phase');
});

console.log('Bốc quà — xác suất gốc & xử lý hết hàng');
test('Còn đủ hàng: xác suất áp dụng đúng 1/10/10/29/50', () => {
  assert.deepEqual(L.effectiveWeights(CONFIG.PRIZES, FULL).map((p) => p.weight), [1, 10, 10, 29, 50]);
});
test('Hết từng món: phần trăm của món đó chuyển hết sang "Không quà", không chia lại', () => {
  const want = {
    bear: [0, 10, 10, 29, 51], puzzle: [1, 0, 10, 29, 60], sticker: [1, 10, 0, 29, 60], candy: [1, 10, 10, 0, 79]
  };
  for (const id of PHYSICAL) {
    const avail = Object.assign({}, FULL, { [id]: 0 });
    assert.deepEqual(L.effectiveWeights(CONFIG.PRIZES, avail).map((p) => p.weight), want[id], 'hết ' + id);
  }
  assert.deepEqual(L.effectiveWeights(CONFIG.PRIZES, { bear: 0, puzzle: 0, sticker: 0, candy: 0 }).map((p) => p.weight), [0, 0, 0, 0, 100]);
});
test('pickWeighted bám sát trọng số gốc (400.000 lần, nguồn ngẫu nhiên crypto)', () => {
  const n = 400000, c = {};
  for (let i = 0; i < n; i++) { const r = L.pickWeighted(CONFIG.PRIZES, L.cryptoRandom); c[r] = (c[r] || 0) + 1; }
  for (const p of CONFIG.PRIZES) assert.ok(Math.abs(c[p.id] / n - p.weight / 100) < 0.004, p.id + ' = ' + c[p.id] / n);
});
test('pickWeighted chịu được rng biên 0 và gần 1', () => {
  assert.equal(L.pickWeighted(CONFIG.PRIZES, () => 0), 'bear');
  assert.equal(L.pickWeighted(CONFIG.PRIZES, () => 0.9999999999), 'nothing');
});
test('Phiên nhiều lượt, đủ hàng: phân bố chính xác của lượt đầu = 1/10/10/29/50', () => {
  const c = {};
  for (let a = 0; a < 10000; a++) { const id = gen(2, scripted([(a + 0.5) / 10000, 0.99])).results[0]; c[id] = (c[id] || 0) + 1e-4; }
  assertDist(c, { bear: 0.01, puzzle: 0.1, sticker: 0.1, candy: 0.29, nothing: 0.5 });
});

console.log('Bảo hiểm phiên 1 lượt');
test('Trúng "Không quà" -> đổi thành Kẹo; các ô khác giữ nguyên', () => {
  for (const id of IDS) {
    const rng = scripted([R[id]]);
    assert.deepEqual(gen(1, rng).results, [id === 'nothing' ? 'candy' : id]);
    assert.equal(rng.used(), 1);
  }
});
test('Đủ hàng: phân bố CHÍNH XÁC Gấu 1% · Mảnh ghép 10% · Sticker 10% · Kẹo 79%', () => {
  assertDist(exactSingle(FULL), { bear: 0.01, puzzle: 0.1, sticker: 0.1, candy: 0.79 });
});
test('Hết gấu: bảo hiểm áp dụng SAU bước xử lý hết hàng -> Kẹo 80%', () => {
  assertDist(exactSingle(Object.assign({}, FULL, { bear: 0 })), { puzzle: 0.1, sticker: 0.1, candy: 0.8 });
});
test('Hết kẹo: "Không quà" -> chọn quà còn hàng theo trọng số gốc chuẩn hóa (1:10:10)', () => {
  const avail = Object.assign({}, FULL, { candy: 0 });
  assertDist(exactSingle(avail), { bear: 0.01 + 0.79 / 21, puzzle: 0.1 + 0.79 * 10 / 21, sticker: 0.1 + 0.79 * 10 / 21 });
  // kịch bản: bốc trúng "Không quà" rồi bốc dự phòng rơi vào Gấu (khoảng [0, 1/21))
  assert.deepEqual(gen(1, scripted([R.nothing, 0.01]), avail).results, ['bear']);
  // chỉ còn Sticker: luôn ra Sticker
  assertDist(exactSingle({ bear: 0, puzzle: 0, sticker: 2, candy: 0 }), { sticker: 1 });
});
test('Chỉ còn 1 kẹo: luôn ra Kẹo', () => {
  assertDist(exactSingle({ bear: 0, puzzle: 0, sticker: 0, candy: 1 }), { candy: 1 });
});
test('Hết toàn bộ quà: không bảo đảm được -> "Không quà" kèm đánh dấu hết quà, không bốc', () => {
  const rng = scripted([]);
  assert.deepEqual(gen(1, rng, { bear: 0, puzzle: 0, sticker: 0, candy: 0 }), { results: ['nothing'], soldOut: [true] });
  assert.equal(rng.used(), 0);
});
test('Phiên 1 lượt: 200.000 lần (crypto) không bao giờ ra "Không quà"; tỉ lệ ~ 1/10/10/79', () => {
  const n = 200000, c = {};
  for (let i = 0; i < n; i++) { const r = gen(1, L.cryptoRandom).results[0]; c[r] = (c[r] || 0) + 1; }
  assert.equal(c.nothing || 0, 0);
  const want = { bear: 0.01, puzzle: 0.1, sticker: 0.1, candy: 0.79 };
  for (const k in want) assert.ok(Math.abs(c[k] / n - want[k]) < 0.005, k + ' = ' + c[k] / n);
});

console.log('Phiên 2–5 lượt — tối đa 2 quà');
test('Vét cạn mọi chuỗi bốc -> tối đa 2 quà, sau 2 quà toàn "Không quà", trước đó đúng kết quả bốc', () => {
  for (let spins = 2; spins <= 5; spins++) {
    const total = Math.pow(5, spins);
    for (let code = 0; code < total; code++) {
      const draws = [];
      for (let k = 0, c = code; k < spins; k++, c = Math.floor(c / 5)) draws.push(IDS[c % 5]);
      const rng = scripted(draws.map((d) => R[d]));
      const { results: res, soldOut } = gen(spins, rng);
      assert.equal(res.length, spins);
      assert.ok(soldOut.every((x) => x === false));
      let won = 0, used = 0;
      for (let i = 0; i < spins; i++) {
        if (won >= 2) { assert.equal(res[i], 'nothing'); continue; }
        assert.equal(res[i], draws[used++]);
        if (isPrize(res[i])) won++;
      }
      assert.ok(res.filter(isPrize).length <= 2);
      assert.equal(rng.used(), used);
    }
  }
});
test('KHÔNG có bảo hiểm lượt cuối: bốc toàn "Không quà" -> 0 quà', () => {
  for (let spins = 2; spins <= 5; spins++) {
    assert.deepEqual(gen(spins, scripted(Array(spins).fill(R.nothing))).results, Array(spins).fill('nothing'));
  }
});
test('Hai lần trúng cùng món vẫn tính là 2 quà', () => {
  assert.deepEqual(gen(4, scripted([R.candy, R.candy])).results, ['candy', 'candy', 'nothing', 'nothing']);
});
test('Trúng món cuối cùng trong kho thì lượt sau món đó coi như hết hàng (không trúng vượt kho)', () => {
  // còn 1 gấu: lượt 1 trúng gấu; lượt 2 cùng giá trị rng -> gấu đã 0%, rơi sang món kế tiếp theo xác suất mới
  const avail = Object.assign({}, FULL, { bear: 1 });
  const r = gen(3, scripted([0.005, 0.005, 0.9]), avail).results;
  assert.equal(r[0], 'bear');
  assert.equal(r[1], 'puzzle'); // [0,10) là Mảnh ghép khi Gấu 0%
  assert.equal(r.filter((x) => x === 'bear').length, 1);
});
test('Hết toàn bộ quà giữa phiên: các lượt còn lại là "Không quà" + đánh dấu hết quà', () => {
  const r = gen(4, scripted([0.1]), { bear: 0, puzzle: 0, sticker: 0, candy: 1 });
  assert.deepEqual(r, { results: ['candy', 'nothing', 'nothing', 'nothing'], soldOut: [false, true, true, true] });
  const all = gen(3, scripted([]), { bear: 0, puzzle: 0, sticker: 0, candy: 0 });
  assert.deepEqual(all.soldOut, [true, true, true]);
});
test('Ngẫu nhiên 20.000 phiên trên kho nhỏ: không bao giờ trúng vượt số còn lại', () => {
  const rng = seeded(77);
  for (let n = 0; n < 20000; n++) {
    const avail = { bear: Math.floor(rng() * 2), puzzle: Math.floor(rng() * 2), sticker: Math.floor(rng() * 2), candy: Math.floor(rng() * 3) };
    const spins = 1 + Math.floor(rng() * 5);
    const { results, soldOut } = gen(spins, rng, avail);
    const c = {};
    results.forEach((id) => { c[id] = (c[id] || 0) + 1; });
    for (const id of PHYSICAL) assert.ok((c[id] || 0) <= avail[id], id);
    assert.ok(results.filter(isPrize).length <= (spins === 1 ? 1 : 2));
    if (spins === 1 && PHYSICAL.some((id) => avail[id] > 0)) assert.notEqual(results[0], 'nothing');
    soldOut.forEach((x, i) => { if (x) assert.equal(results[i], 'nothing'); });
  }
});

console.log('Mở lượt quay');
test('Mỗi lần mở đúng 1 lượt theo thứ tự đã chốt; hết lượt thì từ chối', () => {
  let s = playSession(10, scripted([R.nothing, R.sticker, R.nothing, R.bear]));
  assert.deepEqual(s.gacha.results, ['nothing', 'sticker', 'nothing', 'bear', 'nothing']);
  assert.equal(L.openNextSpin(s).reason, 'wrong-phase');
  assert.equal(L.finishGacha(s).reason, 'wrong-phase');
  s = L.proceedFromResult(s).session;
  assert.equal(s.phase, 'gacha');
  const seen = [];
  for (let i = 0; i < 5; i++) {
    assert.equal(L.finishGacha(s).reason, 'spins-left');
    const r = L.openNextSpin(s);
    assert.ok(r.ok); assert.equal(r.index, i);
    seen.push(r.result); s = r.session;
    assert.deepEqual(L.validateSession(s), []);
  }
  assert.deepEqual(seen, s.gacha.results);
  assert.equal(L.openNextSpin(s).reason, 'no-spins-left');
  s = L.finishGacha(s).session;
  assert.equal(s.phase, 'summary');
  assert.deepEqual(L.groupPrizes(s, L.openedResults(s)), [
    { id: 'bear', name: 'Gấu bông', icon: '🧸', count: 1 }, { id: 'sticker', name: 'Sticker', icon: '⭐', count: 1 }]);
});
test('0 lượt quay -> từ màn kết quả đi thẳng tổng kết', () => {
  const s = L.proceedFromResult(playSession(1)).session;
  assert.equal(s.phase, 'summary');
  assert.deepEqual(L.validateSession(s), []);
});
test('Gộp quà trùng: Kẹo x2', () => {
  let s = L.proceedFromResult(playSession(4, scripted([R.candy, R.candy]))).session;
  s = L.openNextSpin(s).session; s = L.openNextSpin(s).session;
  assert.deepEqual(L.groupPrizes(s, L.openedResults(s)), [{ id: 'candy', name: 'Kẹo', icon: '🍬', count: 2 }]);
});
test('Ô "Không quà": chữ trên vòng quay "Không quà", chữ khi mở "Chúc bạn may mắn lần sau!", mã nội bộ nothing', () => {
  const s = playSession(4, scripted([R.nothing, R.nothing]));
  const p = L.prizeById(s, 'nothing');
  assert.equal(p.name, 'Không quà');
  assert.equal(p.revealName, 'Chúc bạn may mắn lần sau!');
  assert.equal(p.isPrize, false);
});

console.log('Hình học vòng quay');
test('Góc dừng luôn nằm trong đúng ô (10.000 trường hợp ngẫu nhiên, gồm lệch sát mép)', () => {
  const n = CONFIG.PRIZES.length, seg = 360 / n, rng = seeded(5);
  for (let i = 0; i < 10000; i++) {
    const slice = i % n;
    const current = (rng() - 0.5) * 20000;
    const offset = (rng() * 2 - 1) * (seg / 2 - 0.5);
    const turns = 4 + Math.floor(rng() * 4);
    const target = L.spinTarget(current, slice, n, turns, offset);
    assert.ok(target >= current + turns * 360 && target < current + (turns + 1) * 360);
    assert.equal(L.sliceAtPointer(target, n), slice);
  }
  for (let k = 0; k < n; k++) assert.equal(L.sliceAtPointer(L.restRotation(k, n), n), k);
});

console.log('Kiểm tra dữ liệu lưu & lịch sử');
test('validateSession phát hiện dữ liệu bị sửa/hỏng', () => {
  const s = L.proceedFromResult(playSession(6)).session;
  assert.deepEqual(L.validateSession(s), []);
  const t1 = L.clone(s); t1.gacha.opened = 9;
  const t2 = L.clone(s); t2.answers[0].correct = !t2.answers[0].correct;
  const t3 = L.clone(s); t3.gacha.results.pop();
  const t4 = L.clone(s); t4.phase = 'quiz';
  const t5 = L.clone(s); t5.questions[1] = t5.questions[0];
  const t6 = L.clone(s); t6.schema = 1; // phiên của bản cũ
  const t7 = L.clone(s); delete t7.gacha.soldOut;
  for (const t of [t1, t2, t3, t4, t5, t6, t7, null, {}, { schema: 1 }]) assert.ok(L.validateSession(t).length > 0);
});
test('Lịch sử & CSV dùng "Không quà" cho lượt không trúng', () => {
  let s = L.proceedFromResult(playSession(10, scripted([R.puzzle, R.nothing, R.puzzle]))).session;
  for (let i = 0; i < 5; i++) s = L.openNextSpin(s).session;
  const h = L.makeHistoryEntry(s, 'awarded', Date.now());
  assert.equal(h.spinsUsed, 5);
  assert.deepEqual(h.prizes, [{ id: 'puzzle', name: 'Mảnh ghép', count: 2 }]);
  assert.deepEqual(h.openedNames, ['Mảnh ghép', 'Không quà', 'Mảnh ghép', 'Không quà', 'Không quà']);
  const csv = L.historyToCSV([h]);
  assert.match(csv.split('\r\n')[1], /Đã trao quà/);
  assert.match(csv, /Mảnh ghép x2/);
  assert.match(csv, /Không quà/);
  assert.ok(!/Chúc bạn may mắn/.test(csv));
});

console.log('\n' + passed + ' kiểm thử đạt' + (process.exitCode ? ' — CÓ LỖI' : ''));

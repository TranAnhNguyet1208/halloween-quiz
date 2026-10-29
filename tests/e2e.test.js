/*
 * Kiểm thử đầu-cuối trên Chrome thật (headless).
 * 1) Chạy máy chủ:  powershell -ExecutionPolicy Bypass -File tools\server.ps1 -NoBrowser
 * 2) Chạy:          node tests/e2e.test.js            (ảnh chụp lưu vào thư mục tạm, in ra đường dẫn)
 * Biến môi trường: BASE_URL (mặc định http://localhost:8765/), SHOTS_DIR, CHROME_PATH.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Browser, sleep } = require('./cdp.js');
const L = require('../js/game-logic.js');
const Inv = require('../js/inventory.js');
const CONFIG = require('../js/config.js');
const BANK = require('../js/questions-data.js');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const FILE_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'hq-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const KEY = CONFIG.STORAGE_PREFIX + ':event';
const PIN = CONFIG.BTC_PIN;

let passed = 0, failed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n    ' + (e.stack || e).split('\n').slice(0, 9).join('\n    ')); }
}

const getState = (p) => p.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
const getSession = async (p) => (await getState(p)).current;
const setState = (p, st) => p.eval(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(st))})`);
// Thay phiên hiện tại (phiên chưa kết thúc phần hỏi, không có quà giữ chỗ).
async function setSession(p, s) { const st = await getState(p); st.current = s; await setState(p, st); }
const click = (p, sel) => p.eval(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('không thấy ${sel}'); e.click(); return true})()`);
const text = (p, sel) => p.eval(`document.querySelector(${JSON.stringify(sel)}).textContent.trim()`);
const visible = (p, sel) => p.eval(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return !!(e && !e.hidden && e.offsetParent)})()`);
const stock = async (p) => Inv.summary(await getState(p)).byId;

async function freshStart(p, url) {
  await p.goto(url || BASE);
  await p.eval('localStorage.clear()');
  await p.reload();
  await p.waitFor(`document.querySelector('#screen-welcome.active')`, 5000, 'màn chào');
}

async function answer(p, correct) {
  const s = await getSession(p);
  const i = s.answers.length;
  const q = s.questions[i];
  const choice = correct ? q.correctIndex : (q.correctIndex + 1) % 3;
  await click(p, `#answers .answer[data-index="${choice}"]`);
  await click(p, '#btnLock');
  await p.waitFor(`!document.getElementById('btnNext').hidden`, 6000, 'phản hồi câu ' + (i + 1));
  return { i, choice, q };
}

async function playTo(p, correctCount) {
  await click(p, '#btnStart');
  await p.waitFor(`document.querySelector('#screen-quiz.active')`);
  for (let k = 0; k < 10; k++) {
    const ok = k < correctCount;
    await answer(p, ok);
    await click(p, '#btnNext');
    if (!ok) break;
    if (k === 9) break;
    await p.waitFor(`document.querySelector('#screen-quiz.active')`);
  }
  await p.waitFor(`document.querySelector('#screen-result.active')`, 5000, 'màn kết quả');
}

async function spinAll(p) {
  await click(p, '#btnFromResult');
  await p.waitFor(`document.querySelector('#screen-gacha.active') || document.querySelector('#screen-summary.active')`);
  for (;;) {
    const s = await getSession(p);
    if (s.phase !== 'gacha' || s.gacha.opened >= s.gacha.spinsAwarded) break;
    const k = s.gacha.opened;
    await click(p, '#btnSpin');
    await p.waitFor(`!document.getElementById('prizeModal').hidden`, 8000);
    await click(p, '#prizeOk');
    await p.waitFor(`document.getElementById('prizeModal').hidden && document.querySelectorAll('#openedList li:not(.empty)').length===${k + 1}`);
  }
  if ((await getSession(p)).phase === 'gacha') await click(p, '#btnToSummary');
  await p.waitFor(`document.querySelector('#screen-summary.active')`);
}

async function openBtc(p, tab) {
  await click(p, '#btnBtc');
  await p.waitFor(`!document.getElementById('btcPanel').hidden`);
  if (tab) {
    await click(p, `.btc-tab[data-tab="${tab}"]`);
    if (await visible(p, '#pinForm')) {
      await p.eval(`document.getElementById('pinInput').value=${JSON.stringify(PIN)}; document.getElementById('pinForm').requestSubmit(); true`);
    }
    await p.waitFor(`!document.querySelector('.btc-pane[data-pane="${tab}"]').hidden`);
  }
}
async function answerAsk(p, fields) {
  await p.waitFor(`!document.getElementById('askDialog').hidden`);
  await p.eval(`(function(f){ if(f.pin!=null) document.getElementById('askPin').value=f.pin; if(f.reason!=null) document.getElementById('askReason').value=f.reason;
    if(f.typed!=null) document.getElementById('askTyped').value=f.typed; document.getElementById('askForm').requestSubmit(); return true})(${JSON.stringify(fields)})`);
}
async function uploadImport(p, name, content) {
  await p.eval(`(function(){var dt=new DataTransfer(); dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, {type:'application/json'}));
    var i=document.getElementById('importFile'); i.files=dt.files; i.dispatchEvent(new Event('change')); return true})()`);
}

// Kiểm tra bố cục: nút trong khung nhìn, không cuộn ngang, câu hỏi vừa khung, nút góc không đè thẻ nội dung.
const LAYOUT_CHECK = `(function(){
  var vw=innerWidth, vh=innerHeight, issues=[];
  var scr=document.querySelector('.screen.active');
  scr.querySelectorAll('button').forEach(function(b){ if(b.hidden||!b.offsetParent) return; var r=b.getBoundingClientRect();
    if(r.bottom>vh+1||r.right>vw+1||r.top<0||r.left<0) issues.push('Nút ra ngoài màn hình: '+b.textContent.trim()); });
  if(document.documentElement.scrollWidth>vw+1) issues.push('Có cuộn ngang');
  var oy=getComputedStyle(scr).overflowY;
  if((oy==='auto'||oy==='scroll') && scr.scrollHeight>scr.clientHeight+1) issues.push('Màn hình phải cuộn dọc '+scr.scrollHeight+'>'+scr.clientHeight);
  if(scr.id==='screen-quiz'){ var m=document.getElementById('quizMain'); if(m.scrollHeight>m.clientHeight+1) issues.push('Câu hỏi tràn khung '+m.scrollHeight+'>'+m.clientHeight); }
  var ct=document.querySelector('.corner-tools').getBoundingClientRect();
  scr.querySelectorAll('.card, .question, .answer, h1, h2').forEach(function(c){ if(!c.offsetParent) return; var r=c.getBoundingClientRect();
    if(r.left<ct.right&&r.right>ct.left&&r.top<ct.bottom&&r.bottom>ct.top) issues.push('Nút góc đè lên '+(c.id||c.className)); });
  var st=document.getElementById('quizStats').getBoundingClientRect();
  if(scr.id==='screen-quiz' && st.right>ct.left && st.top<ct.bottom) issues.push('Thông số đè nút góc');
  var fs=getComputedStyle(document.getElementById('quizMain')).getPropertyValue('--fs');
  return {issues:issues, fs:fs};
})()`;
const MODAL_CHECK = `(function(){ var r=document.getElementById('prizeCard').getBoundingClientRect(); var b=document.getElementById('prizeOk').getBoundingClientRect();
  return r.top>=0 && r.bottom<=innerHeight+1 && b.bottom<=innerHeight+1 && r.left>=0 && r.right<=innerWidth+1; })()`;

function longestHardSession(answeredCorrect) {
  let s = L.createSession(BANK, CONFIG, Math.random, Date.now());
  const hard = BANK.questions.filter((q) => q.difficulty === 'hard');
  const len = (q) => q.text.length + q.correct.length + q.wrong[0].length + q.wrong[1].length;
  const longest = hard.slice().sort((a, b) => len(b) - len(a))[0];
  const dup = s.questions.findIndex((q, i) => i !== answeredCorrect && q.qid === longest.id);
  if (dup >= 0) {
    const alt = hard.find((q) => q.id !== longest.id && !s.questions.some((x) => x.qid === q.id));
    s.questions[dup] = { qid: alt.id, level: 5, difficulty: 'hard', text: alt.text, options: [alt.correct, alt.wrong[0], alt.wrong[1]], correctIndex: 0 };
  }
  s.questions[answeredCorrect] = { qid: longest.id, level: 5, difficulty: 'hard', text: longest.text, options: [longest.wrong[0], longest.correct, longest.wrong[1]], correctIndex: 1 };
  s = L.startQuiz(s, Date.now()).session;
  for (let i = 0; i < answeredCorrect; i++) s = L.submitAnswer(s, i, s.questions[i].correctIndex, CONFIG, Math.random, Date.now(), {}).session;
  return s;
}

(async function main() {
  console.log('E2E — ' + BASE);
  const browser = await Browser.launch();
  const p = await browser.newPage();
  await p.reducedMotion(true);
  await p.viewport(1366, 768);

  console.log('Khởi tạo & tải lại');
  let first;
  await step('Lần đầu mở: tạo sự kiện 103 phần quà, màn chào có logo + 2 bí ngô giữ tỉ lệ', async () => {
    await freshStart(p);
    const st = await getState(p);
    first = st.current;
    assert.deepEqual(Inv.validateState(st), []);
    assert.equal(st.format, Inv.FORMAT); assert.equal(st.version, Inv.VERSION);
    assert.equal(Inv.summary(st).available, 103);
    assert.equal(first.phase, 'welcome');
    const imgs = await p.eval(`Array.from(document.querySelectorAll('#screen-welcome .welcome-logo img, #screen-welcome .deco-pumpkin')).map(function(i){var r=i.getBoundingClientRect(); return {src:i.getAttribute('src'),w:r.width,h:r.height,nw:i.naturalWidth,nh:i.naturalHeight}})`);
    assert.deepEqual(imgs.map((i) => i.src), ['assets/main-logo.jpg', 'assets/pumpkin-glasses.png', 'assets/pumpkin-clown.png']);
    for (const i of imgs) {
      assert.ok(i.nw > 0, i.src + ' chưa tải');
      assert.ok(Math.abs(i.w / i.h - i.nw / i.nh) < 0.015, i.src + ' bị méo');
    }
    assert.ok(imgs[0].w >= 400, 'logo quá nhỏ ở 1366x768: ' + imgs[0].w);
    // chỉ có MỘT khóa dữ liệu sự kiện
    const keys = await p.eval(`Object.keys(localStorage).filter(function(k){return k.indexOf('hq-halloween')===0 && !/:lock$|:prefs$/.test(k)})`);
    assert.deepEqual(keys, [KEY]);
  });
  await step('Tải lại ở màn chào: giữ nguyên bộ đề và thứ tự đáp án', async () => {
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-welcome.active')`);
    assert.deepEqual(await getSession(p), first);
  });
  await step('Màn người chơi không hiện tồn kho hay công cụ kỹ thuật', async () => {
    const t = await p.eval(`document.getElementById('app').innerText`);
    assert.ok(!/tồn kho|khả dụng|giữ chỗ|PIN|demo|localStorage/i.test(t), t.slice(0, 200));
  });

  console.log('Phần hỏi đáp');
  await step('Bấm nhanh nhiều lần: chỉ chốt 1 đáp án, không đổi được sau khi chốt', async () => {
    await click(p, '#btnStart');
    await click(p, '#btnStart');
    await p.waitFor(`document.querySelector('#screen-quiz.active')`);
    const s = await getSession(p);
    const q = s.questions[0];
    const wrong = (q.correctIndex + 1) % 3;
    await p.eval(`(function(){var a=document.querySelectorAll('#answers .answer'); a[${q.correctIndex}].click();
      for(var i=0;i<6;i++) document.getElementById('btnLock').click();
      a[${wrong}].click(); document.getElementById('btnLock').click(); return true})()`);
    const after = await getSession(p);
    assert.equal(after.answers.length, 1);
    assert.equal(after.answers[0].choice, q.correctIndex);
    await p.waitFor(`!document.getElementById('btnNext').hidden`);
    assert.match(await text(p, '#feedback'), /Chính xác/);
    await p.eval(`document.getElementById('btnNext').click(); document.getElementById('btnNext').click(); true`);
    await p.waitFor(`document.getElementById('qChip').textContent.indexOf('Câu 2')===0`);
    assert.equal((await getSession(p)).answers.length, 1);
  });
  await step('Hiển thị Câu x/10, Level y/5, Lượt quay đã đạt', async () => {
    assert.equal(await text(p, '#statQuestion'), '2/10');
    assert.equal(await text(p, '#statLevel'), '1/5');
    assert.equal(await text(p, '#statSpins'), '0');
  });
  await step('Tải lại khi đang trả lời: khôi phục đúng câu hiện tại, đề không đổi', async () => {
    await answer(p, true);
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-quiz.active')`);
    const s = await getSession(p);
    assert.equal(s.answers.length, 2);
    assert.equal(await text(p, '#qText'), s.questions[2].text);
    assert.equal(await text(p, '#statSpins'), '1');
    assert.deepEqual(s.questions, first.questions);
  });
  let locked;
  await step('Đúng 5 rồi sai câu 6 -> dừng, 2 lượt; kết quả + giữ chỗ quà ghi cùng lúc', async () => {
    for (let k = 2; k < 5; k++) { await answer(p, true); await click(p, '#btnNext'); await p.waitFor(`document.querySelector('#screen-quiz.active')`); }
    const r = await answer(p, false);
    const cls = await p.eval(`Array.from(document.querySelectorAll('#answers .answer')).map(function(b){return b.className})`);
    assert.match(cls[r.choice], /wrong/);
    assert.match(cls[r.q.correctIndex], /correct-reveal/);
    const st = await getState(p);
    locked = st.current;
    assert.equal(locked.phase, 'quizResult');
    assert.equal(locked.gacha.spinsAwarded, 2);
    assert.equal(locked.gacha.results.length, 2);
    const won = locked.gacha.results.filter((x) => x !== 'nothing').length;
    assert.equal(Inv.summary(st).reserved, won);
    assert.equal(Inv.summary(st).available, 103 - won);
    assert.deepEqual(Inv.validateState(st), []);
    await click(p, '#btnNext');
    await p.waitFor(`document.querySelector('#screen-result.active')`);
    assert.equal(await text(p, '#rSpins'), '2');
  });
  await step('Tải lại sau khi sai: vẫn ở màn kết quả, kết quả và kho không đổi', async () => {
    const before = await getState(p);
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-result.active')`);
    const after = await getState(p);
    assert.deepEqual(after.current, locked);
    assert.deepEqual(Inv.available(after), Inv.available(before));
  });

  console.log('Vòng quay triệu hồi');
  let stockBeforeSpin;
  await step('Quay lượt 1 (hiệu ứng đầy đủ): 2–4 giây, bấm 5 lần chỉ mở 1 lượt, dừng đúng ô, thẻ ghi đúng tên', async () => {
    await p.reducedMotion(false);
    stockBeforeSpin = Inv.available(await getState(p));
    await click(p, '#btnFromResult');
    await p.waitFor(`document.querySelector('#screen-gacha.active')`);
    await sleep(400);
    const t0 = Date.now();
    await p.eval(`(function(){for(var i=0;i<5;i++) document.getElementById('btnSpin').click(); return true})()`);
    let s = await getSession(p);
    assert.equal(s.gacha.opened, 1);
    assert.deepEqual(s.gacha.results, locked.gacha.results);
    assert.equal(await p.eval(`document.getElementById('prizeModal').hidden`), true); // chưa công bố khi đang quay
    assert.equal(await text(p, '#openedList'), 'Chưa quay lượt nào.');
    await p.waitFor(`!document.getElementById('prizeModal').hidden`, 6000, 'thẻ kết quả');
    const dt = Date.now() - t0;
    assert.ok(dt >= 2000 && dt <= 4000, 'thời gian tới lúc công bố: ' + dt + 'ms');
    const expected = s.gacha.prizes.findIndex((x) => x.id === s.gacha.results[0]);
    assert.equal(await p.eval(`Number(document.querySelector('.wheel-svg').getAttribute('data-slice'))`), expected);
    const prize = s.gacha.prizes[expected];
    assert.equal(await text(p, '#prizeName'), prize.isPrize ? prize.name : 'Chúc bạn may mắn lần sau!');
    assert.equal(await text(p, '#prizeIcon'), prize.icon);
    assert.equal(await p.eval(`document.getElementById('prizeCard').getAttribute('data-tier')`), prize.tier);
    await sleep(700);
    await p.screenshot(path.join(SHOTS, 'reveal-1366x768.png'));
    await click(p, '#prizeOk');
    assert.equal((await getSession(p)).gacha.opened, 1);
    assert.equal(await text(p, '#gLeft'), '1');
    assert.deepEqual(Inv.available(await getState(p)), stockBeforeSpin); // quay không trừ kho thêm
    await p.reducedMotion(true);
  });
  await step('Bấm vào vòng quay để mở nhanh: vẫn dừng đúng ô đã chốt', async () => {
    // tạo thêm một phiên riêng sẽ làm sau; ở đây kiểm tra trên lượt 2 bằng cách bấm skip ngay
    await p.reducedMotion(false);
    await click(p, '#btnSpin');
    await sleep(150);
    await click(p, '#wheel');
    const t0 = Date.now();
    await p.waitFor(`!document.getElementById('prizeModal').hidden`, 3000);
    assert.ok(Date.now() - t0 < 1500);
    const s = await getSession(p);
    const expected = s.gacha.prizes.findIndex((x) => x.id === s.gacha.results[1]);
    assert.equal(await p.eval(`Number(document.querySelector('.wheel-svg').getAttribute('data-slice'))`), expected);
    await click(p, '#prizeOk');
    await p.reducedMotion(true);
  });
  await step('Ô "Không quà" trên vòng quay; danh sách lượt dùng "Không quà"', async () => {
    const labels = await p.eval(`Array.from(document.querySelectorAll('.wheel-name')).map(function(t){return t.textContent})`);
    assert.deepEqual(labels, ['Gấu bông', 'Mảnh ghép', 'Sticker', 'Kẹo', 'Không quà']);
    const s = await getSession(p);
    const names = await p.eval(`Array.from(document.querySelectorAll('#openedList .ol-name')).map(function(t){return t.textContent})`);
    assert.deepEqual(names, s.gacha.results.map((id) => s.gacha.prizes.find((x) => x.id === id).name));
  });
  await step('Tổng kết: gộp quà, tải lại vẫn ở tổng kết, kho không đổi', async () => {
    await click(p, '#btnToSummary');
    await p.waitFor(`document.querySelector('#screen-summary.active')`);
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-summary.active')`);
    const s = await getSession(p);
    const grouped = L.groupPrizes(s, L.openedResults(s));
    const shown = await p.eval(`Array.from(document.querySelectorAll('#sPrizes li')).map(function(li){return li.textContent})`);
    if (grouped.length) {
      assert.equal(shown.length, grouped.length);
      grouped.forEach((g, i) => assert.ok(shown[i].includes(g.name) && shown[i].includes('× ' + g.count)));
    } else assert.match(await text(p, '#btnClose'), /Kết thúc — Người chơi tiếp theo/);
    assert.deepEqual(Inv.available(await getState(p)), stockBeforeSpin);
  });
  await step('BTC xác nhận trao (bấm nhanh 4 lần): giữ chỗ -> đã trao đúng 1 lần, kho khả dụng không đổi, 1 dòng lịch sử', async () => {
    const before = await getState(p);
    const oldId = before.current.id;
    const won = before.current.gacha.results.filter((x) => x !== 'nothing').length;
    await p.eval(`(function(){for(var i=0;i<4;i++) document.getElementById('btnClose').click(); return true})()`);
    await p.waitFor(`document.querySelector('#screen-welcome.active')`);
    const st = await getState(p);
    assert.equal(st.history.length, 1);
    assert.equal(st.history[0].sessionId, oldId);
    assert.equal(Inv.summary(st).reserved, 0);
    assert.equal(Inv.summary(st).awarded, won);
    assert.deepEqual(Inv.available(st), Inv.available(before));
    assert.notEqual(st.current.id, oldId);
    assert.equal(st.log.length, before.log.length); // không đụng nhật ký/kho
    assert.equal(st.eventId, before.eventId);
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-welcome.active')`);
    assert.equal((await getState(p)).history.length, 1);
  });

  console.log('Công cụ BTC (PIN)');
  await step('Tab Kho quà cần PIN: sai PIN bị từ chối, đúng PIN mở bảng khả dụng / giữ chỗ / đã trao', async () => {
    await click(p, '#btnBtc');
    await p.waitFor(`!document.getElementById('btcPanel').hidden`);
    await click(p, '.btc-tab[data-tab="stock"]');
    assert.equal(await visible(p, '#pinForm'), true);
    assert.equal(await visible(p, '#stockTable'), false);
    await p.eval(`document.getElementById('pinInput').value='0000'; document.getElementById('pinForm').requestSubmit(); true`);
    assert.match(await text(p, '#pinWarn'), /không đúng/);
    assert.equal(await visible(p, '#stockTable'), false);
    await p.eval(`document.getElementById('pinInput').value=${JSON.stringify(PIN)}; document.getElementById('pinForm').requestSubmit(); true`);
    await p.waitFor(`document.querySelector('#stockTable tbody')`);
    const rows = await p.eval(`Array.from(document.querySelectorAll('#stockTable tbody tr')).map(function(r){return Array.from(r.cells).map(function(c){return c.textContent.trim()})})`);
    const sm = await stock(p);
    assert.deepEqual(rows.map((r) => r[0].replace(/^\S+\s/, '')), ['Gấu bông', 'Mảnh ghép', 'Sticker', 'Kẹo']);
    rows.forEach((r, i) => {
      const id = ['bear', 'puzzle', 'sticker', 'candy'][i];
      assert.deepEqual(r.slice(1).map(Number).filter((x, k) => k !== 1), [sm[id].initial, sm[id].available, sm[id].reserved, sm[id].awarded]);
    });
    await p.screenshot(path.join(SHOTS, 'btc-stock.png'));
    await click(p, '#btnBtcClose');
    // đóng bảng thì khóa lại
    await click(p, '#btnBtc'); await click(p, '.btc-tab[data-tab="stock"]');
    assert.equal(await visible(p, '#pinForm'), true);
    await click(p, '#btnBtcClose');
  });
  await step('Điều chỉnh kho: cần lý do; không trừ quá khả dụng; ghi nhật ký', async () => {
    await openBtc(p, 'stock');
    const before = await stock(p);
    await p.eval(`document.getElementById('adjPrize').value='sticker'; document.getElementById('adjQty').value='4'; document.getElementById('adjReason').value=''; true`);
    await click(p, '#btnAdjSub');
    assert.match(await text(p, '#adjWarn'), /lý do/);
    await p.eval(`document.getElementById('adjQty').value='999'; document.getElementById('adjReason').value='Thử trừ quá'; true`);
    await click(p, '#btnAdjSub');
    assert.match(await text(p, '#adjWarn'), /Chỉ còn/);
    assert.equal((await stock(p)).sticker.available, before.sticker.available);
    await p.eval(`document.getElementById('adjQty').value='4'; document.getElementById('adjReason').value='Chuyển sang minigame khác'; true`);
    await click(p, '#btnAdjSub');
    assert.equal((await stock(p)).sticker.available, before.sticker.available - 4);
    await p.eval(`document.getElementById('adjPrize').value='sticker'; document.getElementById('adjQty').value='4'; document.getElementById('adjReason').value='Trả lại'; true`);
    await click(p, '#btnAdjAdd');
    assert.equal((await stock(p)).sticker.available, before.sticker.available);
    const log = (await getState(p)).log.slice(-2);
    assert.deepEqual(log.map((x) => [x.kind, x.prize, x.delta, x.reason]), [['adjust', 'sticker', -4, 'Chuyển sang minigame khác'], ['adjust', 'sticker', 4, 'Trả lại']]);
    assert.match(await text(p, '#logList'), /Chuyển sang minigame khác/);
    await click(p, '#btnBtcClose');
  });
  await step('Hủy phiên có quà giữ chỗ: quà vẫn giữ chỗ; hoàn kho riêng có xác nhận + lý do + nhật ký', async () => {
    // dựng phiên 5 lượt có 2 quà đã giữ chỗ bằng cách chơi thật đến hết phần hỏi
    await playTo(p, 10);
    const st0 = await getState(p);
    const sid = st0.current.id;
    const held = Inv.reservedOf(st0, sid).length;
    const avail0 = Inv.available(st0);
    await click(p, '#btnBtc');
    await p.eval(`document.getElementById('btnCancelSession').click(); true`);
    assert.match(await text(p, '#btcWarn'), held ? /giữ chỗ/ : /hủy phiên/);
    await p.eval(`document.getElementById('btnCancelSession').click(); true`);
    await p.waitFor(`document.querySelector('#screen-welcome.active')`);
    let st = await getState(p);
    assert.equal(st.history[st.history.length - 1].status, 'cancelled');
    assert.deepEqual(Inv.available(st), avail0); // không tự hoàn kho
    if (held) {
      await openBtc(p, 'stock');
      assert.match(await text(p, '#heldList'), new RegExp(sid));
      await click(p, `#heldList [data-held="release"][data-session="${sid}"]`);
      await answerAsk(p, { reason: '' });
      assert.match(await text(p, '#askWarn'), /lý do/);
      await answerAsk(p, { reason: 'Người chơi bỏ về' });
      await p.waitFor(`document.getElementById('askDialog').hidden`);
      st = await getState(p);
      assert.equal(Inv.reservedOf(st, sid).length, 0);
      assert.equal(Inv.summary(st).available, Inv.summary(st0).available + held);
      const e = st.log[st.log.length - 1];
      assert.deepEqual([e.kind, e.sessionId, e.reason], ['release', sid, 'Người chơi bỏ về']);
      await click(p, '#btnBtcClose');
    }
  });
  await step('Tải lại TRONG lúc quay: không bốc lại, không trừ kho lại, không khôi phục lượt đã dùng', async () => {
    await playTo(p, 6);
    const st0 = await getState(p);
    await click(p, '#btnFromResult');
    await p.waitFor(`document.querySelector('#screen-gacha.active')`);
    await p.reducedMotion(false);
    await click(p, '#btnSpin');
    await sleep(300);
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-gacha.active')`);
    await p.reducedMotion(true);
    const st = await getState(p);
    assert.equal(st.current.gacha.opened, 1);
    assert.deepEqual(st.current.gacha.results, st0.current.gacha.results);
    assert.deepEqual(Inv.available(st), Inv.available(st0));
    assert.equal(Inv.summary(st).reserved, Inv.summary(st0).reserved);
    assert.equal(await text(p, '#gLeft'), '2');
    assert.equal(await p.eval(`document.querySelectorAll('#openedList li:not(.empty)').length`), 1);
    await spinAll(p);
    await click(p, '#btnClose');
    await p.waitFor(`document.querySelector('#screen-welcome.active')`);
  });
  await step('Hết toàn bộ quà: tạm dừng bắt đầu phiên mới; BTC cộng kho thì mở lại', async () => {
    const st = await getState(p);
    // trừ hết quà khả dụng bằng công cụ BTC
    await openBtc(p, 'stock');
    for (const [id, r] of Object.entries(Inv.summary(st).byId)) {
      if (!r.available) continue;
      await p.eval(`document.getElementById('adjPrize').value=${JSON.stringify(id)}; document.getElementById('adjQty').value=${JSON.stringify(String(r.available))}; document.getElementById('adjReason').value='Hết giờ phát'; true`);
      await click(p, '#btnAdjSub');
    }
    assert.equal(Inv.summary(await getState(p)).available, 0);
    await click(p, '#btnBtcClose');
    assert.equal(await p.eval(`document.getElementById('btnStart').disabled`), true);
    assert.equal(await visible(p, '#pauseNote'), true);
    await click(p, '#btnStart');
    assert.equal((await getSession(p)).phase, 'welcome');
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-welcome.active')`);
    assert.equal(await p.eval(`document.getElementById('btnStart').disabled`), true);
    await p.screenshot(path.join(SHOTS, 'welcome-paused.png'));
    await openBtc(p, 'stock');
    await p.eval(`document.getElementById('adjPrize').value='candy'; document.getElementById('adjQty').value='1'; document.getElementById('adjReason').value='Bổ sung'; true`);
    await click(p, '#btnAdjAdd');
    await click(p, '#btnBtcClose');
    assert.equal(await p.eval(`document.getElementById('btnStart').disabled`), false);
    // phiên 1 lượt chỉ còn 1 kẹo -> chắc chắn là Kẹo
    await playTo(p, 2);
    const s = await getSession(p);
    assert.deepEqual(s.gacha.results, ['candy']);
    assert.equal(Inv.available(await getState(p)).candy, 0);
  });

  console.log('Sao lưu / nhập / khởi tạo');
  let backupText;
  await step('Xuất sao lưu rồi nhập file sai / bản cũ: bị từ chối, dữ liệu hiện tại giữ nguyên', async () => {
    const st = await getState(p);
    backupText = JSON.stringify(Inv.makeBackup(st, Date.now()));
    await openBtc(p, 'data');
    await click(p, '#btnBackup');
    const raw0 = await p.eval(`localStorage.getItem(${JSON.stringify(KEY)})`);
    for (const [name, content] of [['hong.json', '{"format":"hq-halloween-backup"'], ['cu.json', JSON.stringify({ exportedAt: 'x', sessions: [] })],
      ['sua-tay.json', backupText.replace('"initial":3', '"initial":-3')]]) {
      await uploadImport(p, name, content);
      await p.waitFor(`/Không nhập file/.test(document.getElementById('dataWarn').textContent)`, 3000, 'thông báo từ chối ' + name);
      assert.equal(await p.eval(`localStorage.getItem(${JSON.stringify(KEY)})`), raw0);
    }
    assert.match(await text(p, '#dataWarn'), /KHÔNG thay đổi/);
    await click(p, '#btnBtcClose');
  });
  await step('Khởi tạo sự kiện mới: gõ chữ xác nhận; sau đó nhập lại bản sao lưu khôi phục đúng trạng thái', async () => {
    const old = await getState(p);
    await openBtc(p, 'data');
    await click(p, '#btnResetEvent');
    await answerAsk(p, { typed: 'sai' });
    assert.match(await text(p, '#askWarn'), /chưa đúng/);
    await answerAsk(p, { typed: 'khoi tao' });
    await p.waitFor(`document.querySelector('#screen-welcome.active') && document.getElementById('btcPanel').hidden`);
    let st = await getState(p);
    assert.notEqual(st.eventId, old.eventId);
    assert.equal(Inv.summary(st).available, 103);
    assert.equal(st.history.length, 0);
    await openBtc(p, 'data');
    await uploadImport(p, 'sao-luu.json', backupText);
    await answerAsk(p, { typed: 'NHẬP' });
    await p.waitFor(`document.getElementById('btcPanel').hidden`);
    st = await getState(p);
    assert.equal(st.eventId, old.eventId);
    assert.deepEqual(Inv.available(st), Inv.available(old));
    assert.equal(st.history.length, old.history.length);
    assert.equal(st.log[st.log.length - 1].kind, 'import');
  });

  console.log('Dữ liệu hỏng / bản cũ');
  await step('Dữ liệu bản cũ: chặn bắt đầu, giữ nguyên dữ liệu cũ, BTC sao lưu + PIN để khởi tạo; không tính vào kho mới', async () => {
    await p.eval(`localStorage.clear(); localStorage.setItem('hq-halloween-v1:current','{"schema":1,"id":"P1029-OLD"}');
      localStorage.setItem('hq-halloween-v1:history','[{"sessionId":"P1","prizes":[{"id":"keychain","name":"Móc khóa","count":1}]}]'); true`);
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-error.active')`);
    assert.match(await text(p, '#errorTitle'), /bản cũ/);
    assert.equal(await p.eval(`localStorage.getItem(${JSON.stringify(KEY)})`), null);
    assert.equal(await p.eval(`document.getElementById('btnBlockedInit').disabled`), true);
    await p.screenshot(path.join(SHOTS, 'legacy-blocked.png'));
    await p.eval(`document.querySelector('#errorActions button').click(); true`);
    await click(p, '#btnBlockedInit');
    await answerAsk(p, { pin: '1111', typed: 'KHỞI TẠO' });
    assert.match(await text(p, '#askWarn'), /PIN/);
    await answerAsk(p, { pin: PIN, typed: 'KHỞI TẠO' });
    await p.waitFor(`document.querySelector('#screen-welcome.active')`);
    const st = await getState(p);
    assert.equal(Inv.summary(st).available, 103);
    assert.equal(st.history.length, 0);
    assert.equal(await p.eval(`localStorage.getItem('hq-halloween-v1:current')`), '{"schema":1,"id":"P1029-OLD"}');
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-welcome.active')`);
  });
  await step('Dữ liệu hỏng: báo BTC, KHÔNG tự tạo phiên mới hay reset kho', async () => {
    await p.eval(`localStorage.setItem(${JSON.stringify(KEY)}, '{"format":"hq-halloween-event"')`);
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-error.active')`);
    assert.match(await text(p, '#errorTitle'), /bị lỗi/);
    await p.reload();
    assert.equal(await p.eval(`localStorage.getItem(${JSON.stringify(KEY)})`), '{"format":"hq-halloween-event"');
  });
  await step('Sửa tay dữ liệu (kho âm) bị phát hiện là hỏng', async () => {
    await freshStart(p);
    const st = await getState(p);
    st.log.push({ at: new Date().toISOString(), kind: 'adjust', prize: 'bear', delta: -9, reason: 'x' });
    await setState(p, st);
    await p.reload();
    await p.waitFor(`document.querySelector('#screen-error.active')`);
    assert.match(await text(p, '#errorBody'), /âm/);
  });

  console.log('Hai tab');
  await step('Tab thứ hai bị khóa; tab đầu vẫn chơi được; đóng tab đầu thì tab hai tự mở khóa', async () => {
    await freshStart(p);
    const p2 = await browser.newPage();
    await p2.viewport(1366, 768);
    await p2.goto(BASE);
    await p2.waitFor(`!document.getElementById('lockOverlay').hidden`, 5000, 'lớp khóa tab 2');
    await click(p, '#btnStart');
    await p.waitFor(`document.querySelector('#screen-quiz.active')`);
    assert.equal(await p2.eval(`document.getElementById('lockOverlay').hidden`), false);
    await p.close();
    await p2.waitFor(`document.getElementById('lockOverlay').hidden && document.querySelector('#screen-quiz.active')`, 15000, 'tab 2 tiếp quản');
    assert.deepEqual(p2.errors, []);
    await p2.close();
  });
  const p3 = await browser.newPage();
  await p3.reducedMotion(true);
  await p3.viewport(1366, 768);
  await step('Dữ liệu bị nơi khác ghi đè giữa chừng: thao tác bị từ chối, không cấp quà hai lần', async () => {
    await freshStart(p3);
    await playTo(p3, 1);
    // nơi khác (ví dụ tab khác vừa tiếp quản rồi đóng) đã đổi bản ghi: tăng rev
    const st = await getState(p3);
    st.rev += 5;
    await setState(p3, st);
    const before = await p3.eval(`localStorage.getItem(${JSON.stringify(KEY)})`);
    await click(p3, '#btnFromResult');
    await p3.waitFor(`document.querySelector('#screen-error.active')`);
    assert.match(await text(p3, '#errorTitle'), /thay đổi ở nơi khác/);
    assert.equal(await p3.eval(`localStorage.getItem(${JSON.stringify(KEY)})`), before);
  });

  console.log('Bố cục 1366×768 và 1920×1080');
  for (const [w, h] of [[1366, 768], [1920, 1080], [1366, 657]]) {
    await step(`Bố cục ${w}×${h}: màn chào, câu khó dài nhất, vòng quay, thẻ kết quả, tổng kết`, async () => {
      await p3.viewport(w, h);
      await freshStart(p3);
      let r = await p3.eval(LAYOUT_CHECK); assert.deepEqual(r.issues, [], 'màn chào');
      await p3.screenshot(path.join(SHOTS, `welcome-${w}x${h}.png`));
      await setSession(p3, longestHardSession(8));
      await p3.reload();
      await p3.waitFor(`document.querySelector('#screen-quiz.active')`);
      await sleep(600);
      r = await p3.eval(LAYOUT_CHECK);
      assert.deepEqual(r.issues, [], 'câu hỏi dài');
      assert.ok(parseFloat(r.fs) >= 15, 'chữ quá nhỏ: ' + r.fs);
      console.log('      cỡ chữ cơ sở câu khó dài nhất: ' + r.fs);
      await click(p3, '#answers .answer[data-index="1"]');
      await p3.screenshot(path.join(SHOTS, `quiz-long-${w}x${h}.png`));
      await click(p3, '#btnLock');
      await p3.waitFor(`!document.getElementById('btnNext').hidden`);
      r = await p3.eval(LAYOUT_CHECK); assert.deepEqual(r.issues, [], 'phản hồi');
      await click(p3, '#btnNext');
      await p3.waitFor(`document.querySelector('#screen-quiz.active')`);
      await answer(p3, true); await click(p3, '#btnNext');
      await p3.waitFor(`document.querySelector('#screen-result.active')`);
      await sleep(300);
      r = await p3.eval(LAYOUT_CHECK); assert.deepEqual(r.issues, [], 'kết quả');
      await p3.screenshot(path.join(SHOTS, `result-${w}x${h}.png`));
      await click(p3, '#btnFromResult');
      await p3.waitFor(`document.querySelector('#screen-gacha.active')`);
      r = await p3.eval(LAYOUT_CHECK); assert.deepEqual(r.issues, [], 'vòng quay');
      await p3.screenshot(path.join(SHOTS, `gacha-${w}x${h}.png`));
      for (let k = 0; k < 5; k++) {
        await click(p3, '#btnSpin');
        await p3.waitFor(`!document.getElementById('prizeModal').hidden`, 6000);
        assert.ok(await p3.eval(MODAL_CHECK), 'thẻ kết quả tràn màn hình');
        if (k === 0) await p3.screenshot(path.join(SHOTS, `reveal-${w}x${h}.png`));
        await click(p3, '#prizeOk');
        await p3.waitFor(`document.getElementById('prizeModal').hidden && !document.getElementById('btnSpin').disabled || !document.getElementById('btnToSummary').hidden`);
      }
      r = await p3.eval(LAYOUT_CHECK); assert.deepEqual(r.issues, [], 'vòng quay xong');
      await click(p3, '#btnToSummary');
      await p3.waitFor(`document.querySelector('#screen-summary.active')`);
      r = await p3.eval(LAYOUT_CHECK); assert.deepEqual(r.issues, [], 'tổng kết');
      await p3.screenshot(path.join(SHOTS, `summary-${w}x${h}.png`));
      await openBtc(p3, 'stock');
      const fits = await p3.eval(`(function(){var r=document.querySelector('.btc-card').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight+1})()`);
      assert.ok(fits, 'bảng BTC tràn màn hình');
      await p3.screenshot(path.join(SHOTS, `btc-${w}x${h}.png`));
      await click(p3, '#btnBtcClose');
    });
  }
  await step('Không có yêu cầu mạng ra ngoài máy; không lỗi JavaScript', async () => {
    const external = p3.requests.concat(p.requests).filter((u) => !/^(http:\/\/localhost:8765\/|file:|data:|blob:|about:)/.test(u));
    assert.deepEqual(external, []);
    assert.deepEqual(p3.errors, []);
    assert.deepEqual(p.errors, []);
  });

  console.log('Mở trực tiếp file:// và trình duyệt chặn lưu trữ');
  await step('Mở index.html trực tiếp (file://): chạy được, ảnh tải được, lưu được', async () => {
    const pf = await browser.newPage();
    await pf.viewport(1366, 768);
    await pf.goto(FILE_URL);
    await pf.eval('localStorage.clear()');
    await pf.reload();
    await pf.waitFor(`document.querySelector('#screen-welcome.active')`, 5000);
    const broken = await pf.eval(`Array.from(document.images).filter(function(i){return i.complete && i.naturalWidth===0}).map(function(i){return i.src})`);
    assert.deepEqual(broken, []);
    await click(pf, '#btnStart');
    await pf.waitFor(`document.querySelector('#screen-quiz.active')`);
    await pf.reload();
    await pf.waitFor(`document.querySelector('#screen-quiz.active')`);
    assert.deepEqual(pf.errors, []);
    await pf.close();
  });
  await step('localStorage bị chặn: báo BTC, không cho bắt đầu', async () => {
    const pb = await browser.newPage(`Object.defineProperty(window,'localStorage',{get:function(){throw new DOMException('blocked','SecurityError')}});`);
    await pb.viewport(1366, 768);
    await pb.goto(BASE);
    await pb.waitFor(`document.querySelector('#screen-error.active')`, 5000);
    assert.match(await text(pb, '#errorTitle'), /không lưu được/i);
    assert.equal(await pb.eval(`document.querySelector('#screen-welcome').classList.contains('active')`), false);
    await pb.close();
  });

  await browser.close();
  console.log('\n' + passed + ' đạt, ' + failed + ' lỗi. Ảnh chụp: ' + SHOTS);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });

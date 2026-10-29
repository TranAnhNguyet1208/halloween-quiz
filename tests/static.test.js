/*
 * Kiểm tra tĩnh bản bàn giao. Chạy:  node tests/static.test.js
 * - Logo chính và hai ảnh bí ngô giữ nguyên từng byte.
 * - Mọi tài nguyên được tham chiếu bằng đường dẫn tương đối và có trong thư mục game.
 * - Không còn đường dẫn tuyệt đối của máy lập trình, không tải gì từ Internet.
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { console.error('  ✘ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const RUNTIME = ['index.html', 'css/style.css'].concat(fs.readdirSync(path.join(ROOT, 'js')).map((f) => 'js/' + f));

test('Logo chính và hai ảnh bí ngô không bị thay đổi', () => {
  assert.equal(sha('assets/main-logo.jpg'), '79e11f4c3a2f4cf4bf2a965e996ce6383292097aec3c30c29bfa0fa11ba7b396');
  assert.equal(sha('assets/pumpkin-clown.png'), '3167d60ed0f61075017315d6552deec6d82bb17aa702ebf707fe6e865133c598');
  assert.equal(sha('assets/pumpkin-glasses.png'), '728604c28f485844e08eb65c9fa484559feadff5d3c51974048640cc6a79fffa');
  const html = read('index.html');
  assert.ok(html.includes('src="assets/main-logo.jpg"'));
  assert.ok(html.includes('src="assets/pumpkin-glasses.png"') && html.includes('src="assets/pumpkin-clown.png"'));
});
test('Mọi tài nguyên tham chiếu trong HTML/CSS/JS là đường dẫn tương đối và tồn tại', () => {
  const refs = new Set();
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) refs.add(m[1]);
  for (const m of read('css/style.css').matchAll(/url\("?([^")]+)"?\)/g)) refs.add(path.posix.join('css', m[1]));
  for (const m of read('js/app.js').matchAll(/'assets\/ui\/' \+ (\w+) \+ '\.webp'/g)) refs.add('dynamic:' + m[1]);
  for (const name of ['jack', 'ghost', 'pumpkin-flame']) refs.add('assets/ui/' + name + '.webp');
  for (const r of refs) {
    if (r.startsWith('dynamic:')) continue;
    assert.ok(!/^([a-z]+:|\/)/i.test(r), 'không phải đường dẫn tương đối: ' + r);
    assert.ok(fs.existsSync(path.join(ROOT, r)), 'thiếu file: ' + r);
  }
});
test('Không còn đường dẫn tuyệt đối của máy lập trình, không tải tài nguyên từ Internet', () => {
  for (const f of RUNTIME) {
    const s = read(f);
    assert.ok(!/[A-Za-z]:[\\/](?:halloween|Users|quiz)/i.test(s), 'đường dẫn tuyệt đối trong ' + f);
    assert.ok(!/file:\/\/\//.test(s), 'đường dẫn file:/// trong ' + f);
    const urls = (s.match(/https?:\/\/[^\s"')]+/g) || []).filter((u) => u !== 'http://www.w3.org/2000/svg');
    assert.deepEqual(urls, [], 'URL ngoài trong ' + f);
    assert.ok(!/@import|fonts\.googleapis|cdn\./i.test(s), 'tải từ xa trong ' + f);
  }
});
test('Không dùng video nặng; thư mục assets gọn nhẹ', () => {
  let total = 0;
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else { total += fs.statSync(p).size; assert.ok(!/\.(mp4|webm|mov)$/i.test(f), 'có video: ' + f); }
    }
  })(path.join(ROOT, 'assets'));
  assert.ok(total < 1.2 * 1024 * 1024, 'assets quá nặng: ' + total);
});
test('Ghi công tài nguyên có đủ ba nguồn', () => {
  const c = read('assets/ui/CREDITS.md');
  for (const s of ['sandra-selezen/halloween', 'ngdathd/AiLaTrieuPhu', 'shadorki/genshin-impact-wish-simulator', 'không phải']) assert.ok(c.includes(s), s);
});

console.log('\n' + passed + ' kiểm thử đạt' + (process.exitCode ? ' — CÓ LỖI' : ''));

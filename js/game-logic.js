/*
 * LOGIC GAME (thuần, không đụng tới giao diện hay bộ nhớ trình duyệt).
 * Mọi hàm nhận nguồn ngẫu nhiên `rng` (hàm trả về số trong [0, 1)) để kiểm thử thay thế được.
 * Các hàm thay đổi phiên luôn trả về BẢN SAO mới, không sửa phiên cũ.
 */
(function (root) {
  'use strict';

  var SCHEMA = 2; // 2: danh mục quà mới + tồn kho (bản 1 không tương thích)
  var PHASES = ['welcome', 'quiz', 'quizResult', 'gacha', 'summary'];
  var DIFFICULTY_LABEL = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };

  // ---------- Ngẫu nhiên ----------

  function cryptoRandom() {
    var c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.getRandomValues) {
      var a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  function randomInt(rng, n) {
    var i = Math.floor(rng() * n);
    return i >= n ? n - 1 : i < 0 ? 0 : i;
  }

  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randomInt(rng, i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ---------- Level & lượt quay ----------

  function totalQuestions(plan) {
    return plan.reduce(function (s, p) { return s + p.count; }, 0);
  }

  function levelForIndex(plan, index) {
    var end = 0;
    for (var i = 0; i < plan.length; i++) {
      end += plan[i].count;
      if (index < end) return plan[i].level;
    }
    return plan[plan.length - 1].level;
  }

  function levelsPassed(plan, correctCount) {
    var end = 0, passed = 0;
    for (var i = 0; i < plan.length; i++) {
      end += plan[i].count;
      if (correctCount >= end) passed++;
    }
    return passed;
  }

  function spinsForCorrect(table, correctCount) {
    var n = Math.max(0, Math.min(correctCount, table.length - 1));
    return table[n];
  }

  // ---------- Kiểm tra cấu hình ----------

  function validateConfig(config, bank) {
    var errors = [];
    var plan = config.LEVEL_PLAN || [];
    var total = totalQuestions(plan);
    if (!plan.length) errors.push('LEVEL_PLAN trống.');
    plan.forEach(function (p, i) {
      if (p.level !== i + 1) errors.push('LEVEL_PLAN: level phải đánh số liên tục từ 1 (vị trí ' + (i + 1) + ').');
      if (!DIFFICULTY_LABEL[p.difficulty]) errors.push('LEVEL_PLAN: độ khó không hợp lệ "' + p.difficulty + '".');
      if (!(p.count > 0)) errors.push('LEVEL_PLAN: số câu của level ' + p.level + ' phải > 0.');
    });
    var table = config.SPIN_TABLE || [];
    if (table.length !== total + 1) errors.push('SPIN_TABLE cần đúng ' + (total + 1) + ' giá trị (từ 0 tới ' + total + ' câu đúng).');
    for (var i = 0; i < table.length; i++) {
      if (!(table[i] >= 0) || Math.floor(table[i]) !== table[i]) errors.push('SPIN_TABLE chứa giá trị không hợp lệ.');
      if (i > 0 && table[i] < table[i - 1]) errors.push('SPIN_TABLE phải không giảm.');
    }
    var prizes = config.PRIZES || [];
    var ids = prizes.map(function (p) { return p.id; });
    if (prizes.length < 2) errors.push('PRIZES cần ít nhất 2 ô.');
    if (ids.some(function (id, i) { return typeof id !== 'string' || !id || ids.indexOf(id) !== i; })) errors.push('PRIZES: mã quà (id) phải khác nhau và không để trống.');
    prizes.forEach(function (p) {
      if (!(p.weight >= 0) || Math.floor(p.weight) !== p.weight) errors.push('PRIZES: xác suất của "' + p.name + '" phải là số nguyên % không âm.');
      if (p.isPrize !== false && (!(p.stock >= 0) || Math.floor(p.stock) !== p.stock)) errors.push('PRIZES: tồn kho ban đầu của "' + p.name + '" phải là số nguyên không âm.');
      if (p.isPrize === false && p.stock != null) errors.push('PRIZES: ô "' + p.name + '" không có tồn kho (stock: null).');
    });
    var sum = prizes.reduce(function (s, p) { return s + p.weight; }, 0);
    if (sum !== 100) errors.push('PRIZES: tổng xác suất phải đúng 100% (hiện là ' + sum + '%).');
    var swap = config.SINGLE_SPIN_SWAP;
    var noneCount = prizes.filter(function (p) { return p.isPrize === false; }).length;
    if (noneCount !== 1) errors.push('PRIZES cần đúng một ô "Không quà" (isPrize: false).');
    if (swap && (ids.indexOf(swap.from) < 0 || ids.indexOf(swap.to) < 0)) errors.push('SINGLE_SPIN_SWAP tham chiếu ô không tồn tại.');
    if (!(config.MULTI_SPIN_MAX_PRIZES >= 1)) errors.push('MULTI_SPIN_MAX_PRIZES phải >= 1.');
    if (bank) {
      var need = {};
      plan.forEach(function (p) { need[p.difficulty] = (need[p.difficulty] || 0) + p.count; });
      Object.keys(need).forEach(function (d) {
        var have = bank.questions.filter(function (q) { return q.difficulty === d; }).length;
        if (have < need[d]) errors.push('Ngân hàng chỉ có ' + have + ' câu "' + DIFFICULTY_LABEL[d] + '" nhưng mỗi phiên cần ' + need[d] + '.');
      });
    }
    return errors;
  }

  // ---------- Tạo phiên ----------

  function buildQuestions(bank, plan, rng) {
    var pools = {};
    bank.questions.forEach(function (q) {
      (pools[q.difficulty] = pools[q.difficulty] || []).push(q);
    });
    Object.keys(pools).forEach(function (d) { pools[d] = shuffle(pools[d], rng); });
    var out = [];
    plan.forEach(function (p) {
      for (var k = 0; k < p.count; k++) {
        var q = (pools[p.difficulty] || []).pop();
        if (!q) throw new Error('Không đủ câu hỏi độ khó "' + p.difficulty + '".');
        var options = shuffle([
          { text: q.correct, correct: true },
          { text: q.wrong[0], correct: false },
          { text: q.wrong[1], correct: false }
        ], rng);
        out.push({
          qid: q.id,
          level: p.level,
          difficulty: q.difficulty,
          text: q.text,
          options: options.map(function (o) { return o.text; }),
          correctIndex: options.findIndex(function (o) { return o.correct; })
        });
      }
    });
    return out;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function newSessionId(rng, now) {
    var d = new Date(now);
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var tail = '';
    for (var i = 0; i < 5; i++) tail += chars[randomInt(rng, chars.length)];
    return 'P' + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '-' + tail;
  }

  function createSession(bank, config, rng, now) {
    return {
      schema: SCHEMA,
      id: newSessionId(rng, now),
      createdAt: new Date(now).toISOString(),
      phase: 'welcome',
      questions: buildQuestions(bank, config.LEVEL_PLAN, rng),
      levelPlan: clone(config.LEVEL_PLAN),
      answers: [],
      quiz: { status: 'notStarted', startedAt: null, endedAt: null, correctCount: 0 },
      gacha: {
        prizes: config.PRIZES.map(function (p) {
          return { id: p.id, name: p.name, revealName: p.revealName || p.name, icon: p.icon, isPrize: p.isPrize !== false, tier: p.tier || '', color: p.color };
        }),
        spinsAwarded: 0,
        results: [],
        soldOut: [], // soldOut[i] = true: lượt i là "Không quà" vì toàn bộ quà đã hết
        opened: 0
      }
    };
  }

  // ---------- Phần hỏi đáp ----------

  function startQuiz(session, now) {
    if (session.phase !== 'welcome') return { ok: false, reason: 'wrong-phase' };
    var s = clone(session);
    s.phase = 'quiz';
    s.quiz.status = 'inProgress';
    s.quiz.startedAt = new Date(now).toISOString();
    return { ok: true, session: s };
  }

  // available: số quà còn khả dụng theo mã (từ HQInventory.available) — dùng khi chốt kết quả vòng quay.
  function submitAnswer(session, qIndex, choice, config, rng, now, available) {
    if (session.phase !== 'quiz') return { ok: false, reason: 'wrong-phase' };
    if (qIndex !== session.answers.length) return { ok: false, reason: 'already-answered' };
    var q = session.questions[qIndex];
    if (!q || !(choice >= 0 && choice < q.options.length)) return { ok: false, reason: 'invalid-choice' };

    var s = clone(session);
    var correct = choice === q.correctIndex;
    s.answers.push({ q: qIndex, choice: choice, correct: correct, at: new Date(now).toISOString() });
    if (correct) s.quiz.correctCount++;
    var finished = !correct || s.answers.length === s.questions.length;
    if (finished) {
      s.quiz.status = correct ? 'completed' : 'failed';
      s.quiz.endedAt = new Date(now).toISOString();
      s.gacha.spinsAwarded = spinsForCorrect(config.SPIN_TABLE, s.quiz.correctCount);
      // Chốt toàn bộ kết quả vòng quay NGAY khi kết thúc phần hỏi; quà được giữ chỗ trong cùng lần ghi này.
      var g = generateGachaResults(s.gacha.spinsAwarded, config, rng, available);
      s.gacha.results = g.results;
      s.gacha.soldOut = g.soldOut;
      s.phase = 'quizResult';
    }
    return { ok: true, session: s, correct: correct, finished: finished, correctIndex: q.correctIndex };
  }

  // ---------- Vòng quay ----------

  function pickWeighted(prizes, rng) {
    var total = prizes.reduce(function (s, p) { return s + p.weight; }, 0);
    var r = rng() * total;
    for (var i = 0; i < prizes.length; i++) {
      if (r < prizes[i].weight) return prizes[i].id;
      r -= prizes[i].weight;
    }
    // chỉ xảy ra do sai số làm tròn: lấy ô cuối có trọng số > 0
    for (var j = prizes.length - 1; j >= 0; j--) if (prizes[j].weight > 0) return prizes[j].id;
    return prizes[prizes.length - 1].id;
  }

  function noneIdOf(prizes) {
    return prizes.filter(function (p) { return p.isPrize === false; })[0].id;
  }

  // Xác suất áp dụng khi còn/hết hàng: món hết hàng có xác suất 0, phần đó chuyển hết sang "Không quà"
  // (không chia lại cho các món còn hàng). Tổng vẫn bằng tổng xác suất gốc.
  function effectiveWeights(prizes, available) {
    var noneId = noneIdOf(prizes), moved = 0;
    var out = prizes.map(function (p) {
      if (p.isPrize === false || (available[p.id] || 0) > 0) return { id: p.id, weight: p.weight };
      moved += p.weight;
      return { id: p.id, weight: 0 };
    });
    out.forEach(function (p) { if (p.id === noneId) p.weight += moved; });
    return out;
  }

  /*
   * Sinh trước kết quả cho cả phiên, trên số quà còn khả dụng `available` ({mã: số lượng}):
   * - Tổng 1 lượt: bốc theo xác suất đã xử lý hết hàng; trúng "Không quà" thì đổi thành Kẹo nếu còn Kẹo,
   *   hết Kẹo thì chọn một quà còn hàng theo trọng số gốc chuẩn hóa trong nhóm còn hàng.
   * - Tổng >= 2 lượt: bốc theo xác suất đã xử lý hết hàng cho tới khi đủ MULTI_SPIN_MAX_PRIZES quà,
   *   sau đó các lượt còn lại là "Không quà". Không có bảo hiểm ở lượt cuối.
   * - Mỗi quà trúng trừ ngay vào `available` (bản sao) nên không bao giờ trúng vượt kho.
   * - Toàn bộ quà đã hết: lượt đó là "Không quà" và đánh dấu soldOut.
   */
  function generateGachaResults(spins, config, rng, available) {
    var prizes = config.PRIZES;
    var physical = prizes.filter(function (p) { return p.isPrize !== false; });
    var noneId = noneIdOf(prizes);
    var avail = {};
    physical.forEach(function (p) { avail[p.id] = Math.max(0, (available || {})[p.id] || 0); });
    var results = [], soldOut = [];
    function anyLeft() { return physical.some(function (p) { return avail[p.id] > 0; }); }
    function take(id) { if (id !== noneId) avail[id]--; results.push(id); soldOut.push(false); }
    if (spins <= 0) return { results: results, soldOut: soldOut };
    if (spins === 1) {
      if (!anyLeft()) { results.push(noneId); soldOut.push(true); return { results: results, soldOut: soldOut }; }
      var r = pickWeighted(effectiveWeights(prizes, avail), rng);
      var swap = config.SINGLE_SPIN_SWAP;
      if (swap && r === swap.from) {
        if (avail[swap.to] > 0) r = swap.to;
        else r = pickWeighted(physical.filter(function (p) { return avail[p.id] > 0; }), rng);
      }
      take(r);
      return { results: results, soldOut: soldOut };
    }
    var won = 0;
    for (var i = 0; i < spins; i++) {
      if (won >= config.MULTI_SPIN_MAX_PRIZES) { take(noneId); continue; }
      if (!anyLeft()) { results.push(noneId); soldOut.push(true); continue; }
      var id = pickWeighted(effectiveWeights(prizes, avail), rng);
      if (id !== noneId) won++;
      take(id);
    }
    return { results: results, soldOut: soldOut };
  }

  function proceedFromResult(session) {
    if (session.phase !== 'quizResult') return { ok: false, reason: 'wrong-phase' };
    var s = clone(session);
    s.phase = s.gacha.spinsAwarded > 0 ? 'gacha' : 'summary';
    return { ok: true, session: s };
  }

  function openNextSpin(session) {
    if (session.phase !== 'gacha') return { ok: false, reason: 'wrong-phase' };
    if (session.gacha.opened >= session.gacha.spinsAwarded) return { ok: false, reason: 'no-spins-left' };
    var s = clone(session);
    var index = s.gacha.opened;
    s.gacha.opened++;
    return { ok: true, session: s, index: index, result: s.gacha.results[index] };
  }

  function finishGacha(session) {
    if (session.phase !== 'gacha') return { ok: false, reason: 'wrong-phase' };
    if (session.gacha.opened < session.gacha.spinsAwarded) return { ok: false, reason: 'spins-left' };
    var s = clone(session);
    s.phase = 'summary';
    return { ok: true, session: s };
  }

  function openedResults(session) {
    return session.gacha.results.slice(0, session.gacha.opened);
  }

  function prizeById(session, id) {
    return session.gacha.prizes.filter(function (p) { return p.id === id; })[0];
  }

  // Gộp quà thực nhận (bỏ ô "Không quà"), giữ thứ tự ô trên vòng quay.
  function groupPrizes(session, ids) {
    var counts = {};
    ids.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    return session.gacha.prizes
      .filter(function (p) { return p.isPrize && counts[p.id]; })
      .map(function (p) { return { id: p.id, name: p.name, icon: p.icon, count: counts[p.id] }; });
  }

  // ---------- Hình học vòng quay ----------
  // Ô k chiếm góc [k*seg, (k+1)*seg) theo chiều kim đồng hồ tính từ đỉnh. Kim chỉ ở đỉnh (0°).
  // Quay vòng một góc R (chiều kim đồng hồ) thì điểm dưới kim có góc cục bộ = -R.

  function normAngle(a) {
    return ((a % 360) + 360) % 360;
  }

  function sliceAtPointer(rotationDeg, n) {
    var seg = 360 / n;
    return Math.floor(normAngle(-rotationDeg) / seg) % n;
  }

  function restRotation(sliceIndex, n, offset) {
    var seg = 360 / n;
    return -(sliceIndex * seg + seg / 2 + (offset || 0));
  }

  // offset: lệch khỏi tâm ô (độ), phải nằm trong (-seg/2, seg/2) để vẫn dừng đúng ô.
  function spinTarget(currentRotation, sliceIndex, n, turns, offset) {
    var delta = normAngle(restRotation(sliceIndex, n, offset) - currentRotation);
    return currentRotation + turns * 360 + delta;
  }

  // ---------- Kiểm tra dữ liệu đã lưu ----------

  function validateSession(s) {
    var e = [];
    function bad(msg) { e.push(msg); }
    if (!s || typeof s !== 'object') return ['Không phải đối tượng phiên.'];
    if (s.schema !== SCHEMA) bad('Sai phiên bản dữ liệu.');
    if (typeof s.id !== 'string' || !s.id) bad('Thiếu mã phiên.');
    if (PHASES.indexOf(s.phase) < 0) bad('Giai đoạn không hợp lệ.');
    if (!Array.isArray(s.questions) || !s.questions.length) return e.concat('Thiếu bộ câu hỏi.');
    s.questions.forEach(function (q, i) {
      if (!q || typeof q.text !== 'string' || !Array.isArray(q.options) || q.options.length !== 3 ||
          q.options.some(function (o) { return typeof o !== 'string'; }) ||
          !(q.correctIndex >= 0 && q.correctIndex < 3) || typeof q.level !== 'number') bad('Câu ' + (i + 1) + ' hỏng.');
    });
    var ids = s.questions.map(function (q) { return q && q.qid; });
    if (ids.some(function (id, i) { return ids.indexOf(id) !== i; })) bad('Bộ đề có câu trùng.');
    if (!Array.isArray(s.answers) || s.answers.length > s.questions.length) return e.concat('Danh sách trả lời hỏng.');
    if (!s.quiz || !s.gacha || !Array.isArray(s.gacha.results) || !Array.isArray(s.gacha.prizes) || !Array.isArray(s.gacha.soldOut)) return e.concat('Thiếu dữ liệu phần thi/vòng quay.');
    if (s.gacha.soldOut.length !== s.gacha.results.length || s.gacha.soldOut.some(function (x, i) {
      return typeof x !== 'boolean' || (x && s.gacha.prizes.some(function (p) { return p.id === s.gacha.results[i] && p.isPrize; }));
    })) bad('Đánh dấu hết quà không khớp kết quả.');
    var correct = 0;
    s.answers.forEach(function (a, i) {
      var q = s.questions[i];
      if (!a || a.q !== i || !(a.choice >= 0 && a.choice < 3) || a.correct !== (q && a.choice === q.correctIndex)) bad('Câu trả lời ' + (i + 1) + ' hỏng.');
      if (a && a.correct) correct++;
      if (a && !a.correct && i !== s.answers.length - 1) bad('Có câu trả lời sau câu sai.');
    });
    if (s.quiz.correctCount !== correct) bad('Số câu đúng không khớp.');
    var last = s.answers[s.answers.length - 1];
    var ended = s.answers.length === s.questions.length || (last && !last.correct);
    var g = s.gacha;
    var prizeIds = g.prizes.map(function (p) { return p.id; });
    if (g.results.some(function (r) { return prizeIds.indexOf(r) < 0; })) bad('Kết quả vòng quay chứa ô lạ.');
    if (!(g.opened >= 0 && g.opened <= g.spinsAwarded)) bad('Số lượt đã mở không hợp lệ.');
    if (s.phase === 'welcome' && (s.answers.length || s.quiz.status !== 'notStarted')) bad('Phiên chưa bắt đầu nhưng đã có câu trả lời.');
    if (s.phase === 'quiz' && (ended || s.quiz.status !== 'inProgress')) bad('Trạng thái phần thi không khớp.');
    if (s.phase !== 'welcome' && s.phase !== 'quiz') {
      if (!ended || (s.quiz.status !== 'completed' && s.quiz.status !== 'failed')) bad('Phần thi chưa kết thúc nhưng đã sang giai đoạn sau.');
      if (g.results.length !== g.spinsAwarded) bad('Số kết quả vòng quay không khớp số lượt.');
    } else if (g.results.length || g.opened || g.spinsAwarded) bad('Có kết quả vòng quay trước khi kết thúc phần thi.');
    if ((s.phase === 'quizResult') && g.opened !== 0) bad('Đã mở lượt quay trước màn kết quả.');
    if (s.phase === 'summary' && g.opened !== g.spinsAwarded) bad('Tổng kết khi còn lượt quay.');
    return e;
  }

  // ---------- Lịch sử ----------

  var STATUS_LABEL = { awarded: 'Đã trao quà', 'no-prize': 'Không có quà', cancelled: 'BTC hủy phiên' };

  function makeHistoryEntry(session, status, now) {
    var opened = openedResults(session);
    var plan = session.levelPlan;
    return {
      sessionId: session.id,
      status: status,
      createdAt: session.createdAt,
      startedAt: session.quiz.startedAt,
      quizEndedAt: session.quiz.endedAt,
      closedAt: new Date(now).toISOString(),
      phaseAtClose: session.phase,
      totalQuestions: session.questions.length,
      answered: session.answers.length,
      correctCount: session.quiz.correctCount,
      levelsPassed: levelsPassed(plan, session.quiz.correctCount),
      spinsAwarded: session.gacha.spinsAwarded,
      spinsUsed: session.gacha.opened,
      openedResults: opened,
      openedNames: opened.map(function (id) { var p = prizeById(session, id); return p ? p.name : id; }),
      prizes: groupPrizes(session, opened).map(function (p) { return { id: p.id, name: p.name, count: p.count }; }),
      // quà đã chốt (giữ chỗ) của cả phiên, kể cả lượt chưa mở khi BTC hủy phiên
      lockedPrizes: groupPrizes(session, session.gacha.results).map(function (p) { return { id: p.id, name: p.name, count: p.count }; }),
      questions: session.questions.map(function (q, i) {
        var a = session.answers[i];
        return { qid: q.qid, level: q.level, result: a ? (a.correct ? 'dung' : 'sai') : 'chua-tra-loi' };
      })
    };
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function historyToCSV(list) {
    var header = ['STT', 'Mã phiên', 'Trạng thái', 'Tạo lúc', 'Bắt đầu', 'Kết thúc phần thi', 'Đóng phiên',
      'Số câu đúng', 'Số câu đã trả lời', 'Level đã vượt', 'Lượt quay được cấp', 'Lượt đã quay', 'Kết quả từng lượt',
      'Quà thực nhận', 'Tổng số quà', 'Quà đã chốt (gồm lượt chưa mở)'];
    function names(arr) { return (arr || []).map(function (p) { return p.name + ' x' + p.count; }).join(' | '); }
    var rows = list.map(function (h, i) {
      var total = h.prizes.reduce(function (s, p) { return s + p.count; }, 0);
      return [i + 1, h.sessionId, STATUS_LABEL[h.status] || h.status, h.createdAt, h.startedAt || '', h.quizEndedAt || '',
        h.closedAt, h.correctCount, h.answered, h.levelsPassed, h.spinsAwarded, h.spinsUsed,
        (h.openedNames || h.openedResults || []).join(' | '), names(h.prizes), total, names(h.lockedPrizes)];
    });
    return [header].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  var api = {
    SCHEMA: SCHEMA,
    DIFFICULTY_LABEL: DIFFICULTY_LABEL,
    STATUS_LABEL: STATUS_LABEL,
    cryptoRandom: cryptoRandom,
    randomInt: randomInt,
    shuffle: shuffle,
    clone: clone,
    totalQuestions: totalQuestions,
    levelForIndex: levelForIndex,
    levelsPassed: levelsPassed,
    spinsForCorrect: spinsForCorrect,
    validateConfig: validateConfig,
    buildQuestions: buildQuestions,
    createSession: createSession,
    startQuiz: startQuiz,
    submitAnswer: submitAnswer,
    pickWeighted: pickWeighted,
    effectiveWeights: effectiveWeights,
    generateGachaResults: generateGachaResults,
    csvCell: csvCell,
    proceedFromResult: proceedFromResult,
    openNextSpin: openNextSpin,
    finishGacha: finishGacha,
    openedResults: openedResults,
    prizeById: prizeById,
    groupPrizes: groupPrizes,
    normAngle: normAngle,
    sliceAtPointer: sliceAtPointer,
    restRotation: restRotation,
    spinTarget: spinTarget,
    validateSession: validateSession,
    makeHistoryEntry: makeHistoryEntry,
    historyToCSV: historyToCSV
  };

  root.HQLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

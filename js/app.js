/*
 * ĐIỀU KHIỂN GIAO DIỆN: nối logic (game-logic.js), kho quà (inventory.js), lưu trữ (storage.js), khóa tab (tab-lock.js).
 * Nguyên tắc: mọi thay đổi trạng thái đều LƯU TRƯỚC (một bản ghi duy nhất) rồi mới chạy hiệu ứng.
 */
(function () {
  'use strict';

  var C = window.HQ_CONFIG;
  var BANK = window.HQ_QUESTION_BANK;
  var L = window.HQLogic;
  var Inv = window.HQInventory;
  var Sound = window.HQSound;
  var Fx = window.HQFx;
  var store = C ? new window.HQStorage(C.STORAGE_PREFIX, C.LEGACY_PREFIXES) : null;
  var lock = store ? new window.HQTabLock(store.keys.lock) : null;
  var rng = L ? L.cryptoRandom : null;

  var state = null; // toàn bộ sự kiện (một bản ghi trong localStorage)
  var session = null; // = state.current
  var busy = false; // khóa thao tác trong lúc xử lý / chạy hiệu ứng
  var halted = false; // tab mất quyền hoặc lỗi lưu -> ngừng mọi thao tác
  var selected = null;
  var wheel = null;
  var pollTimer = null; // tab bị khóa: chờ khóa được giải phóng
  var btcUnlocked = false; // đã nhập PIN trong lần mở bảng BTC này
  var btcTab = 'session';

  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function total() { return session.questions.length; }
  function levelCount() { return session.levelPlan.length; }
  function newSession() { return L.createSession(BANK, C, rng, Date.now()); }
  function fmtTime(isoStr) {
    var d = new Date(isoStr);
    if (isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + p(d.getDate()) + '/' + p(d.getMonth() + 1);
  }

  // ---------- Khởi động ----------

  function boot() {
    buildWeb();
    if (!C || !BANK || !L || !Inv || !store) {
      return showError('Thiếu file của game', '<p>Không tải được cấu hình hoặc dữ liệu câu hỏi. Hãy kiểm tra thư mục <code>js/</code> còn đủ các file <code>config.js</code>, <code>questions-data.js</code>, <code>game-logic.js</code>, <code>inventory.js</code>.</p>');
    }
    var cfgErrors = L.validateConfig(C, BANK);
    if (cfgErrors.length) {
      return showError('Cấu hình chưa hợp lệ', '<p>Sửa file <code>js/config.js</code> rồi tải lại trang:</p><ul class="err-list">' +
        cfgErrors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>');
    }
    var probe = store.probe();
    if (!probe.ok) {
      return showError('Trình duyệt không lưu được dữ liệu',
        '<p><b>BTC lưu ý:</b> game cần lưu tiến độ và tồn kho để không mất kết quả khi tải lại trang. Trình duyệt hiện đang chặn bộ nhớ (localStorage).</p>' +
        '<ul class="err-list"><li>Không dùng cửa sổ ẩn danh / InPrivate.</li><li>Kiểm tra cài đặt trình duyệt không chặn dữ liệu trang web (cookie và dữ liệu trang).</li><li>Nên mở bằng Chrome hoặc Edge, qua file <code>start-game.bat</code>.</li></ul>' +
        '<p class="muted">Chi tiết: ' + esc(probe.error) + '</p>',
        [{ label: 'Thử lại', cls: 'btn-primary', onClick: function () { location.reload(); } }]);
    }
    initPrefs();
    bindEvents();
    lock.onLost = function () { haltForLock(); };
    acquireAndLoad();
  }

  function acquireAndLoad() {
    lock.acquire(false).then(function (ok) {
      if (ok) return loadState();
      haltForLock();
    });
  }

  function loadState() {
    var res = store.loadState(C);
    if (res.status === 'corrupt') return showBlocked('corrupt', res);
    if (res.status === 'incompatible') return showBlocked('incompatible', res);
    if (res.status === 'empty') {
      var legacy = store.legacyKeys();
      if (legacy.length) return showBlocked('legacy', { errors: legacy });
      if (!save(Inv.createEvent(C, newSession(), Date.now()))) return;
    } else {
      setState(res.state);
    }
    render();
  }

  function setState(st) { state = st; session = st.current; }

  /*
   * Ghi trạng thái sự kiện mới; chỉ khi ghi thành công mới cập nhật trạng thái trong bộ nhớ.
   * opts.overwrite: BTC chủ động thay toàn bộ (khởi tạo sự kiện / nhập sao lưu).
   */
  function save(next, opts) {
    if (halted) return false;
    if (!lock.isOwner()) { haltForLock(); return false; }
    var r = store.saveState(next, state ? state.rev : null, opts);
    if (!r.ok) {
      halted = true;
      closeModal('btcPanel'); closeModal('askDialog'); closeModal('prizeModal');
      if (r.reason === 'conflict') {
        showError('Dữ liệu vừa được thay đổi ở nơi khác',
          '<p><b>BTC lưu ý:</b> thao tác vừa rồi CHƯA được ghi nhận vì dữ liệu sự kiện đã bị một tab/cửa sổ khác thay đổi. Không có quà nào bị cấp hai lần.</p><p>Tải lại trang để tiếp tục với dữ liệu mới nhất.</p>',
          [{ label: 'Tải lại trang', cls: 'btn-primary', onClick: function () { location.reload(); } }]);
      } else {
        showError('Không lưu được dữ liệu',
          '<p><b>BTC lưu ý:</b> thao tác vừa rồi CHƯA được ghi nhận vì trình duyệt không lưu được dữ liệu (bộ nhớ đầy hoặc bị chặn).</p><p>Tải lại trang để tiếp tục từ lần lưu gần nhất.</p>',
          [{ label: 'Tải lại trang', cls: 'btn-primary', onClick: function () { location.reload(); } }]);
      }
      return false;
    }
    setState(r.state);
    return true;
  }

  function haltForLock() {
    halted = true;
    showLockOverlay();
    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (lock.isFree()) { clearInterval(pollTimer); location.reload(); }
    }, 1500);
  }

  // ---------- Điều hướng màn hình ----------

  function showScreen(id) {
    var prev = document.body.getAttribute('data-screen');
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      var on = screens[i].id === 'screen-' + id;
      screens[i].classList.toggle('active', on);
      screens[i].setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    document.body.setAttribute('data-screen', id);
    if (prev && prev !== 'boot' && prev !== id) Fx.sceneWipe();
  }

  function render() {
    closeModal('prizeModal');
    switch (session.phase) {
      case 'welcome': renderWelcome(); break;
      case 'quiz': renderQuiz(); break;
      case 'quizResult': renderResult(); break;
      case 'gacha': renderGacha(); break;
      case 'summary': renderSummary(); break;
    }
  }

  function renderWelcome() {
    var out = Inv.allOut(state);
    $('pauseNote').hidden = !out;
    $('btnStart').disabled = out;
    showScreen('welcome');
  }

  // ---------- Màn hình câu hỏi ----------

  function renderQuiz() {
    var i = session.answers.length;
    var q = session.questions[i];
    selected = null;
    $('qChip').textContent = 'Câu ' + (i + 1) + ' · Level ' + q.level + ' · ' + L.DIFFICULTY_LABEL[q.difficulty];
    $('qText').textContent = q.text;
    answerButtons().forEach(function (b, k) {
      b.className = 'answer';
      b.disabled = false;
      b.querySelector('.ans-text').textContent = q.options[k];
    });
    $('answers').classList.remove('is-locked');
    $('feedback').textContent = '';
    $('feedback').className = 'feedback';
    $('btnLock').hidden = false;
    $('btnLock').disabled = true;
    $('btnNext').hidden = true;
    updateQuizStats(i);
    renderLadder(i, null);
    showScreen('quiz');
    fitQuiz();
  }

  function answerButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('#answers .answer'));
  }

  function updateQuizStats(index) {
    $('statQuestion').textContent = (index + 1) + '/' + total();
    $('statLevel').textContent = L.levelForIndex(session.levelPlan, index) + '/' + levelCount();
    $('statSpins').textContent = L.spinsForCorrect(C.SPIN_TABLE, session.quiz.correctCount);
  }

  function renderLadder(currentIndex, failedIndex, justPassedLevel) {
    var plan = session.levelPlan, end = 0, html = [];
    var correct = session.quiz.correctCount;
    var items = plan.map(function (p) {
      var start = end; end += p.count;
      var state = correct >= end ? 'passed' : (failedIndex !== null && failedIndex >= start && failedIndex < end) ? 'failed'
        : (currentIndex >= start && currentIndex < end) ? 'current' : 'upcoming';
      return { p: p, start: start, end: end, state: state, reward: L.spinsForCorrect(C.SPIN_TABLE, end) };
    });
    items.reverse().forEach(function (it) {
      var qs = it.p.count > 1 ? 'Câu ' + (it.start + 1) + '–' + it.end : 'Câu ' + it.end;
      var mark = it.state === 'passed' ? '✔' : it.state === 'failed' ? '✖' : it.state === 'current' ? '➤' : '';
      var flash = it.p.level === justPassedLevel ? ' rung-flash' : '';
      html.push('<li class="rung rung-' + it.state + flash + '"><span class="rung-mark">' + mark + '</span>' +
        '<span class="rung-main"><b>Level ' + it.p.level + '</b><small>' + qs + ' · ' + L.DIFFICULTY_LABEL[it.p.difficulty] + '</small></span>' +
        '<span class="rung-reward" title="Tổng lượt quay khi hoàn thành level này">🎁 ' + it.reward + '</span></li>');
    });
    $('ladder').innerHTML = html.join('');
  }

  function onAnswerClick(e) {
    var b = e.currentTarget;
    if (busy || halted || !session || session.phase !== 'quiz' || b.disabled) return;
    selected = Number(b.getAttribute('data-index'));
    answerButtons().forEach(function (x) { x.classList.toggle('selected', x === b); });
    $('btnLock').disabled = false;
    Sound.play('select');
  }

  function lockAnswer() {
    if (busy || halted || selected === null || session.phase !== 'quiz') return;
    busy = true;
    var qIndex = session.answers.length;
    var choice = selected;
    var now = Date.now();
    var r = L.submitAnswer(session, qIndex, choice, C, rng, now, Inv.available(state));
    if (!r.ok) { busy = false; return render(); }
    var next;
    if (r.finished) {
      // Chốt kết quả vòng quay + giữ chỗ quà trong CÙNG một lần ghi.
      var c = Inv.commitQuizEnd(state, r.session, now);
      if (!c.ok) {
        halted = true;
        return showError('Không chốt được kết quả', '<p><b>BTC lưu ý:</b> kết quả vòng quay vượt số quà còn lại (' + esc(c.prizes.join(', ')) + '). Thao tác chưa được ghi nhận.</p>',
          [{ label: 'Tải lại trang', cls: 'btn-primary', onClick: function () { location.reload(); } }]);
      }
      next = c.state;
    } else next = Inv.withCurrent(state, r.session);
    var buttons = answerButtons();
    buttons.forEach(function (b) { b.disabled = true; });
    $('answers').classList.add('is-locked');
    $('btnLock').hidden = true;
    if (!save(next)) return; // giữ busy: đã chuyển sang màn lỗi/khóa
    buttons[choice].classList.add('locked');
    $('feedback').textContent = 'Đã chốt đáp án ' + 'ABC'[choice] + '…';
    $('feedback').className = 'feedback pending';
    Sound.play('lock');
    sleep(C.TIMING.answerSuspense).then(function () {
      buttons[choice].classList.remove('locked');
      var fb = $('feedback');
      var justPassedLevel = null;
      if (r.correct) {
        buttons[choice].classList.add('correct');
        Sound.play('correct');
        var passed = L.levelsPassed(session.levelPlan, session.quiz.correctCount);
        var justPassed = L.levelsPassed(session.levelPlan, session.quiz.correctCount - 1) < passed;
        if (justPassed) justPassedLevel = passed;
        if (r.finished) fb.innerHTML = '<b>Chính xác!</b> Bạn đã hoàn thành cả ' + levelCount() + ' level!';
        else if (justPassed) {
          fb.innerHTML = '<b>Chính xác!</b> Hoàn thành Level ' + passed + ' — bạn đã có ' + L.spinsForCorrect(C.SPIN_TABLE, session.quiz.correctCount) + ' lượt quay.';
          setTimeout(function () { Sound.play('level'); }, 350);
        } else fb.innerHTML = '<b>Chính xác!</b>';
        fb.className = 'feedback ok';
      } else {
        buttons[choice].classList.add('wrong');
        if (C.REVEAL_CORRECT_ON_WRONG) buttons[r.correctIndex].classList.add('correct-reveal');
        Sound.play('wrong');
        fb.innerHTML = '<b>Rất tiếc, chưa chính xác!</b>' + (C.REVEAL_CORRECT_ON_WRONG ? ' Đáp án đúng là ' + 'ABC'[r.correctIndex] + '.' : '');
        fb.className = 'feedback bad';
      }
      $('statSpins').textContent = L.spinsForCorrect(C.SPIN_TABLE, session.quiz.correctCount);
      renderLadder(qIndex, r.correct ? null : qIndex, justPassedLevel);
      $('btnNext').textContent = r.finished ? 'Xem kết quả →' : 'Câu tiếp theo →';
      $('btnNext').hidden = false;
      $('btnNext').focus({ preventScroll: true });
      fitQuiz();
      busy = false;
    });
  }

  function nextFromFeedback() {
    if (busy || halted) return;
    Sound.play('click');
    render(); // phiên đã được lưu sang câu kế tiếp / màn kết quả
  }

  // Thu nhỏ cỡ chữ cho tới khi câu hỏi + đáp án vừa khung (không cắt chữ; nếu vẫn dài thì cuộn).
  function fitQuiz() {
    var box = $('quizMain');
    if (!$('screen-quiz').classList.contains('active')) return;
    var max = Math.max(15, Math.min(30, Math.floor(Math.min(window.innerHeight / 24, window.innerWidth / 48))));
    var size = max;
    box.style.setProperty('--fs', size + 'px');
    while (box.scrollHeight > box.clientHeight + 1 && size > 13) {
      size -= 1;
      box.style.setProperty('--fs', size + 'px');
    }
  }

  // ---------- Kết quả phần hỏi ----------

  function renderResult() {
    var correct = session.quiz.correctCount;
    var passed = L.levelsPassed(session.levelPlan, correct);
    var spins = session.gacha.spinsAwarded;
    var title, sub, art;
    if (session.quiz.status === 'completed') {
      art = 'pumpkin-flame'; title = 'Xuất sắc! Bạn đã chinh phục cả ' + levelCount() + ' level';
      sub = 'Trả lời đúng toàn bộ ' + total() + ' câu hỏi.';
    } else {
      art = spins > 0 ? 'jack' : 'ghost';
      title = 'Dừng chân ở câu ' + session.answers.length;
      sub = correct > 0 ? 'Bạn đã trả lời đúng ' + correct + ' câu trước khi dừng.' : 'Chúc bạn may mắn hơn ở lần sau!';
    }
    $('resultArt').src = 'assets/ui/' + art + '.webp';
    $('resultArt').className = 'result-art art-' + art;
    $('resultTitle').textContent = title;
    $('resultSub').textContent = sub;
    $('rCorrect').textContent = correct;
    $('rLevels').textContent = passed;
    $('rSpins').textContent = spins;
    document.querySelector('#screen-result .big-stats small').textContent = '/' + total();
    $('rLevels').nextElementSibling.textContent = '/' + levelCount();
    $('btnFromResult').textContent = spins > 0 ? 'Đến vòng quay may mắn →' : 'Xem tổng kết →';
    showScreen('result');
    if (session.quiz.status === 'completed') Fx.confetti();
  }

  function fromResult() {
    if (busy || halted) return;
    var r = L.proceedFromResult(session);
    if (!r.ok) return render();
    Sound.play('click');
    if (save(Inv.withCurrent(state, r.session))) render();
  }

  // ---------- Vòng quay triệu hồi ----------

  function sliceIndex(id) {
    return session.gacha.prizes.map(function (p) { return p.id; }).indexOf(id);
  }

  function renderGacha() {
    if (!wheel || wheel.sessionId !== session.id) {
      wheel = new window.HQWheel($('wheel'), session.gacha.prizes);
      wheel.sessionId = session.id;
    }
    var opened = L.openedResults(session);
    if (!wheel.spinning && opened.length) {
      var last = sliceIndex(opened[opened.length - 1]);
      wheel.showSlice(last);
      wheel.highlight(last);
    }
    renderGachaPanel(opened);
    showScreen('gacha');
  }

  function prizeLabel(p) { return p.name; } // ô "Không quà" hiển thị đúng chữ "Không quà" trong danh sách/lịch sử

  function renderGachaPanel(opened) {
    var g = session.gacha;
    var shown = opened.length;
    $('gLeft').textContent = g.spinsAwarded - shown;
    $('gUsed').textContent = shown;
    $('gTotal').textContent = g.spinsAwarded;
    var list = $('openedList');
    if (!opened.length) list.innerHTML = '<li class="empty">Chưa quay lượt nào.</li>';
    else {
      list.innerHTML = opened.map(function (id, i) {
        var p = L.prizeById(session, id);
        return '<li class="' + (p.isPrize ? 'is-prize' : 'is-none') + ' tier-' + esc(p.tier || 'none') + '"><span class="ol-num">Lượt ' + (i + 1) + '</span>' +
          '<span class="ol-icon">' + p.icon + '</span><span class="ol-name">' + esc(prizeLabel(p)) + '</span></li>';
      }).join('');
    }
    var done = g.opened >= g.spinsAwarded;
    $('btnSpin').hidden = done;
    $('btnSpin').disabled = busy;
    $('btnSpin').textContent = busy ? 'Đang quay…' : 'Quay';
    $('btnToSummary').hidden = !done;
  }

  function wheelCenter() {
    var r = $('wheel').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.485 };
  }

  function spin() {
    if (busy || halted || session.phase !== 'gacha' || (wheel && wheel.spinning)) return;
    var r = L.openNextSpin(session);
    if (!r.ok) return render();
    busy = true;
    $('btnSpin').disabled = true;
    $('btnSpin').textContent = 'Đang quay…';
    if (!save(Inv.withCurrent(state, r.session))) return; // đã lưu lượt mở TRƯỚC khi quay: tải lại không quay lại được lượt này
    var before = L.openedResults(session).slice(0, r.index);
    renderGachaPanel(before);
    $('btnSpin').disabled = true;
    $('btnSpin').textContent = 'Đang quay…';
    var prize = L.prizeById(session, r.result);
    var soldOut = !!session.gacha.soldOut[r.index];
    var reduce = Fx.reduced();
    Sound.play('summon');
    Fx.streak();
    $('screen-gacha').classList.add('is-summoning');
    wheel.spinTo(sliceIndex(r.result), reduce ? C.TIMING.spinReduced : C.TIMING.spin, function () { Sound.play('tick'); })
      .then(function () {
        // Thời điểm công bố: từ đây mới dùng màu/hiệu ứng theo loại quà đã chốt.
        $('screen-gacha').classList.remove('is-summoning');
        wheel.highlight(sliceIndex(r.result));
        var c = wheelCenter();
        Fx.burst(prize.tier || (prize.isPrize ? 'common' : 'none'), c.x, c.y);
        return sleep(reduce ? 0 : 260);
      })
      .then(function () { return showPrize(prize, session.gacha.spinsAwarded - session.gacha.opened, soldOut); })
      .then(function () {
        busy = false;
        renderGachaPanel(L.openedResults(session));
        var focusEl = session.gacha.opened >= session.gacha.spinsAwarded ? $('btnToSummary') : $('btnSpin');
        focusEl.focus({ preventScroll: true });
      });
  }

  function showPrize(prize, left, soldOut) {
    var card = $('prizeCard');
    card.setAttribute('data-tier', prize.tier || (prize.isPrize ? 'common' : 'none'));
    $('prizeKicker').textContent = prize.isPrize ? 'Chúc mừng! Bạn nhận được' : 'Lượt này';
    $('prizeIcon').textContent = prize.icon;
    $('prizeName').textContent = prize.isPrize ? prize.name : (prize.revealName || prize.name);
    $('prizeMsg').textContent = left > 0 ? 'Bạn còn ' + left + ' lượt quay.' : 'Bạn đã dùng hết lượt quay.';
    $('prizeSoldout').hidden = !soldOut;
    Sound.play(prize.tier === 'legend' ? 'legend' : prize.isPrize ? 'win' : 'none');
    openModal('prizeModal');
    return new Promise(function (resolve) {
      var ok = $('prizeOk');
      function done() { ok.removeEventListener('click', done); closeModal('prizeModal'); resolve(); }
      ok.addEventListener('click', done);
      setTimeout(function () { ok.focus({ preventScroll: true }); }, 50);
    });
  }

  function toSummary() {
    if (busy || halted) return;
    var r = L.finishGacha(session);
    if (!r.ok) return render();
    Sound.play('click');
    if (save(Inv.withCurrent(state, r.session))) render();
  }

  // ---------- Tổng kết & chuyển người chơi ----------

  function renderSummary() {
    var opened = L.openedResults(session);
    var grouped = L.groupPrizes(session, opened);
    $('sCorrect').textContent = session.quiz.correctCount;
    document.querySelector('#screen-summary .big-stats small').textContent = '/' + total();
    $('sSpins').textContent = session.gacha.opened;
    $('sSpinsTotal').textContent = '/' + session.gacha.spinsAwarded;
    if (grouped.length) {
      $('sPrizeTitle').hidden = false;
      $('sPrizes').innerHTML = grouped.map(function (p) {
        return '<li><span class="pl-icon">' + p.icon + '</span><span class="pl-name">' + esc(p.name) + '</span><span class="pl-count">× ' + p.count + '</span></li>';
      }).join('');
      $('sNote').innerHTML = 'Mời bạn gặp <b>BTC</b> để nhận quà. Cảm ơn bạn đã tham gia!';
      $('btnClose').textContent = 'Đã trao quà — Người chơi tiếp theo';
    } else {
      $('sPrizeTitle').hidden = true;
      $('sPrizes').innerHTML = '<li class="empty"><img class="pl-art" src="assets/ui/ghost.webp" alt=""><span class="pl-name">Lần này bạn chưa nhận được quà.</span></li>';
      $('sNote').innerHTML = 'Cảm ơn bạn đã tham gia Đố Vui Tranh Biện - Halloween! Hẹn gặp lại 🎃';
      $('btnClose').textContent = 'Kết thúc — Người chơi tiếp theo';
    }
    if (session.gacha.soldOut.some(Boolean)) $('sNote').innerHTML += '<br><small class="muted">Quà của sự kiện đã được phát hết.</small>';
    $('btnClose').disabled = false;
    showScreen('summary');
  }

  // Chỉ đóng phiên + mở phiên mới. Tồn kho, nhật ký, cài đặt sự kiện giữ nguyên.
  function closeSession() {
    if (busy || halted || session.phase !== 'summary') return;
    busy = true;
    var hasPrize = L.groupPrizes(session, L.openedResults(session)).length > 0;
    $('btnClose').disabled = true;
    if (!save(Inv.closeCurrent(state, hasPrize ? 'awarded' : 'no-prize', newSession(), Date.now()))) return;
    busy = false;
    wheel = null;
    render();
    toast('Đã ghi nhận. Sẵn sàng cho người chơi tiếp theo!');
  }

  function startQuiz() {
    if (busy || halted || session.phase !== 'welcome') return;
    if (Inv.allOut(state)) return renderWelcome(); // hết toàn bộ quà: tạm dừng nhận phiên mới
    var r = L.startQuiz(session, Date.now());
    if (!r.ok) return render();
    Sound.play('click');
    if (save(Inv.withCurrent(state, r.session))) render();
  }

  // ---------- Bảng BTC ----------

  var PHASE_LABEL = { welcome: 'Chờ người chơi bấm Bắt đầu', quiz: 'Đang trả lời câu hỏi', quizResult: 'Xem kết quả phần hỏi', gacha: 'Đang quay quà', summary: 'Tổng kết — chờ BTC xác nhận' };

  function openBtcPanel() {
    if (halted || !state) return;
    btcUnlocked = !C.BTC_PIN;
    btcTab = 'session';
    renderBtc();
    openModal('btcPanel');
  }

  function closeBtcPanel() {
    btcUnlocked = !C.BTC_PIN;
    $('pinInput').value = '';
    closeModal('btcPanel');
  }

  function renderBtc() {
    var tabs = document.querySelectorAll('.btc-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === btcTab);
    var pane = btcTab !== 'session' && !btcUnlocked ? 'locked' : btcTab;
    var panes = document.querySelectorAll('.btc-pane');
    for (var j = 0; j < panes.length; j++) panes[j].hidden = panes[j].getAttribute('data-pane') !== pane;
    if (pane === 'session') renderBtcInfo();
    if (pane === 'locked') { $('pinWarn').textContent = ''; setTimeout(function () { $('pinInput').focus(); }, 30); }
    if (pane === 'stock') renderStock();
    if (pane === 'data') renderData();
  }

  function heldCount(s) {
    return s.gacha.results.filter(function (id) { var p = L.prizeById(s, id); return p && p.isPrize; }).length;
  }

  function renderBtcInfo() {
    var list = state.history;
    var noneCount = 0;
    var physical = state.catalog.map(function (c) { return c.id; });
    list.forEach(function (e) {
      e.openedResults.forEach(function (id) { if (physical.indexOf(id) < 0) noneCount++; });
    });
    var awarded = Inv.summary(state).list.filter(function (r) { return r.awarded > 0; });
    var prizeText = awarded.length ? awarded.map(function (r) { return esc(r.name) + ' × ' + r.awarded; }).join(', ') : 'chưa có';
    var cur = esc(session.id) + ' — ' + PHASE_LABEL[session.phase];
    var held = heldCount(session);
    if (held && session.phase !== 'welcome' && session.phase !== 'quiz') cur += ' · đang giữ chỗ ' + held + ' quà';
    $('btcInfo').innerHTML = '<dl class="btc-dl">' +
      '<dt>Phiên hiện tại</dt><dd>' + cur + '</dd>' +
      '<dt>Số phiên đã kết thúc</dt><dd>' + list.length + '</dd>' +
      '<dt>Quà đã trao</dt><dd>' + prizeText + '</dd>' +
      '<dt>Lượt "Không quà"</dt><dd>' + noneCount + '</dd>' +
      '<dt>Quà khả dụng còn lại</dt><dd>' + Inv.summary(state).available + ' phần' + (Inv.allOut(state) ? ' — <b>đang tạm dừng nhận người chơi mới</b>' : '') + '</dd>' +
      '<dt>Cách mở hiện tại</dt><dd>' + esc(location.protocol === 'file:' ? 'Mở trực tiếp file (file://)' : location.origin) + '</dd></dl>';
    $('btcWarn').textContent = '';
    $('btnCancelSession').dataset.armed = '';
    $('btnCancelSession').textContent = 'Hủy phiên hiện tại & tạo phiên mới';
  }

  function exportHistory(kind) {
    var stamp = fileStamp();
    if (kind === 'csv') download('lich-su-halloween-' + stamp + '.csv', '﻿' + L.historyToCSV(state.history), 'text/csv;charset=utf-8');
    else download('lich-su-halloween-' + stamp + '.json', JSON.stringify({ exportedAt: new Date().toISOString(), eventId: state.eventId, sessions: state.history }, null, 2), 'application/json');
    toast('Đã xuất ' + state.history.length + ' phiên.');
  }

  function cancelSession() {
    var btn = $('btnCancelSession');
    var held = session.phase === 'welcome' || session.phase === 'quiz' ? 0 : heldCount(session);
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Bấm lần nữa để xác nhận hủy';
      var warn = 'Phiên ' + session.id + ' sẽ được ghi vào lịch sử với trạng thái "BTC hủy phiên".';
      if (session.phase === 'gacha' || session.phase === 'quizResult') warn += ' Người chơi còn ' + (session.gacha.spinsAwarded - session.gacha.opened) + ' lượt quay chưa dùng — các lượt này sẽ bị bỏ.';
      if (held) warn += ' Phiên có ' + held + ' quà đang giữ chỗ: quà VẪN giữ chỗ cho tới khi BTC xử lý ở mục "Kho quà" (đã trao hoặc hoàn kho).';
      if (session.phase === 'summary') warn += ' Nếu người chơi đã nhận quà, hãy dùng nút "Đã trao quà" ở màn tổng kết thay vì hủy.';
      $('btcWarn').textContent = warn;
      return;
    }
    if (busy || halted || (wheel && wheel.spinning)) return toast('Đang có thao tác chạy, thử lại sau.', true);
    var next = session.phase === 'welcome' ? Inv.withCurrent(state, newSession()) : Inv.closeCurrent(state, 'cancelled', newSession(), Date.now());
    if (!save(next)) return;
    wheel = null;
    closeBtcPanel();
    render();
    toast(held ? 'Đã tạo phiên mới. ' + held + ' quà của phiên bị hủy vẫn đang giữ chỗ.' : 'Đã tạo phiên mới.');
  }

  function unlockBtc(e) {
    e.preventDefault();
    if (String($('pinInput').value) === String(C.BTC_PIN)) {
      btcUnlocked = true;
      $('pinInput').value = '';
      renderBtc();
    } else {
      $('pinWarn').textContent = 'Mã PIN không đúng.';
      $('pinInput').select();
    }
  }

  // ----- Kho quà -----

  function renderStock() {
    var sm = Inv.summary(state);
    var head = '<thead><tr><th>Món</th><th>Ban đầu</th><th>Điều chỉnh</th><th>Khả dụng</th><th>Giữ chỗ</th><th>Đã trao</th></tr></thead>';
    var body = sm.list.map(function (r) {
      return '<tr' + (r.available === 0 ? ' class="is-out"' : '') + '><td><span class="pl-icon">' + r.icon + '</span> ' + esc(r.name) + '</td><td>' + r.initial + '</td><td>' + (r.adjust > 0 ? '+' : '') + r.adjust +
        '</td><td class="num-strong">' + r.available + '</td><td>' + r.reserved + '</td><td>' + r.awarded + '</td></tr>';
    }).join('');
    var adjTotal = sm.list.reduce(function (s, r) { return s + r.adjust; }, 0);
    var foot = '<tfoot><tr><td>Tổng</td><td>' + sm.initial + '</td><td>' + (adjTotal > 0 ? '+' : '') + adjTotal + '</td><td class="num-strong">' + sm.available + '</td><td>' + sm.reserved + '</td><td>' + sm.awarded + '</td></tr></tfoot>';
    $('stockTable').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
    var sel = $('adjPrize'), keep = sel.value;
    sel.innerHTML = sm.list.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (khả dụng ' + r.available + ')</option>'; }).join('');
    if (keep) sel.value = keep;
    // Phiên đã đóng còn quà giữ chỗ
    var held = Inv.heldSessions(state);
    var names = {};
    state.catalog.forEach(function (c) { names[c.id] = c.name; });
    $('heldList').innerHTML = held.length ? '<ul class="held-list">' + held.map(function (h) {
      var items = Object.keys(h.counts).map(function (k) { return esc(names[k] || k) + ' × ' + h.counts[k]; }).join(', ');
      return '<li><span><b>' + esc(h.sessionId) + '</b> · ' + esc(L.STATUS_LABEL[h.status] || h.status) + ' · ' + esc(fmtTime(h.closedAt)) + '<br>' + items + '</span>' +
        '<span class="held-actions"><button type="button" class="btn btn-ghost btn-sm" data-held="award" data-session="' + esc(h.sessionId) + '">Đã trao</button>' +
        '<button type="button" class="btn btn-danger btn-sm" data-held="release" data-session="' + esc(h.sessionId) + '">Hoàn kho</button></span></li>';
    }).join('') + '</ul>' : '<p class="muted small">Không có.</p>';
    var cur = session.phase !== 'welcome' && session.phase !== 'quiz' ? heldCount(session) : 0;
    if (cur) $('heldList').innerHTML += '<p class="muted small">Phiên đang chơi (' + esc(session.id) + ') giữ chỗ ' + cur + ' quà — sẽ chuyển sang "đã trao" khi BTC bấm nút ở màn tổng kết.</p>';
    // Nhật ký
    var log = state.log.slice(-40).reverse();
    $('logList').innerHTML = log.map(function (x) {
      var what = x.kind === 'adjust' ? esc(names[x.prize] || x.prize) + ' ' + (x.delta > 0 ? '+' : '') + x.delta + ' (còn ' + x.availableAfter + ')'
        : x.counts ? esc(Object.keys(x.counts).map(function (k) { return (names[k] || k) + ' × ' + x.counts[k]; }).join(', ')) + (x.sessionId ? ' · ' + esc(x.sessionId) : '') : '';
      return '<li><span class="log-time">' + esc(fmtTime(x.at)) + '</span><span class="log-kind">' + esc(Inv.LOG_LABEL[x.kind] || x.kind) + '</span><span>' + what + (x.reason ? ' — <i>' + esc(x.reason) + '</i>' : '') + '</span></li>';
    }).join('');
  }

  function doAdjust(sign) {
    if (halted) return;
    var id = $('adjPrize').value;
    var qty = Number($('adjQty').value);
    var reason = $('adjReason').value;
    var warn = $('adjWarn');
    if (!(qty >= 1) || Math.floor(qty) !== qty) { warn.textContent = 'Số lượng phải là số nguyên từ 1.'; return; }
    var r = Inv.adjust(state, id, sign * qty, reason, Date.now());
    if (!r.ok) {
      warn.textContent = r.reason === 'no-reason' ? 'Hãy nhập lý do điều chỉnh.'
        : r.reason === 'insufficient' ? 'Chỉ còn ' + r.available + ' phần khả dụng — không trừ được quá số này (quà đang giữ chỗ không được lấy).'
          : 'Số lượng không hợp lệ (1–' + Inv.MAX_ADJUST + ').';
      return;
    }
    if (!save(r.state)) return;
    warn.textContent = '';
    $('adjReason').value = '';
    $('adjQty').value = 1;
    renderStock();
    if (session.phase === 'welcome') renderWelcome();
    toast('Đã ' + (sign > 0 ? 'cộng' : 'trừ') + ' ' + qty + ' ' + r.state.catalog.filter(function (c) { return c.id === id; })[0].name + '.');
  }

  function onHeldClick(e) {
    var b = e.target.closest('[data-held]');
    if (!b || halted) return;
    var action = b.getAttribute('data-held'), sid = b.getAttribute('data-session');
    ask({
      title: action === 'release' ? 'Hoàn quà giữ chỗ về kho?' : 'Xác nhận đã trao quà?',
      html: action === 'release'
        ? '<p>Quà đang giữ chỗ của phiên <b>' + esc(sid) + '</b> sẽ trở lại thành quà <b>khả dụng</b>. Chỉ làm khi chắc chắn người chơi KHÔNG nhận quà này.</p>'
        : '<p>Quà đang giữ chỗ của phiên <b>' + esc(sid) + '</b> được ghi là <b>đã trao</b> (không trừ kho thêm).</p>',
      reason: true, okLabel: action === 'release' ? 'Hoàn kho' : 'Đã trao'
    }).then(function (res) {
      if (!res) return;
      var r = Inv.resolveHeld(state, sid, action, res.reason, Date.now());
      if (!r.ok) return toast('Không thực hiện được (' + r.reason + ').', true);
      if (!save(r.state)) return;
      renderStock();
      if (session.phase === 'welcome') renderWelcome();
      toast(action === 'release' ? 'Đã hoàn kho.' : 'Đã ghi nhận đã trao.');
    });
  }

  // ----- Sao lưu & sự kiện -----

  function renderData() {
    $('eventInfo').innerHTML = '<dl class="btc-dl">' +
      '<dt>Mã sự kiện</dt><dd>' + esc(state.eventId) + '</dd>' +
      '<dt>Khởi tạo lúc</dt><dd>' + esc(fmtTime(state.createdAt)) + '</dd>' +
      '<dt>Số lần ghi dữ liệu</dt><dd>' + state.rev + '</dd>' +
      '<dt>Phiên đã kết thúc</dt><dd>' + state.history.length + '</dd></dl>';
    $('dataWarn').innerHTML = '';
  }

  function downloadBackup(tag) {
    download('sao-luu-su-kien-' + (tag ? tag + '-' : '') + fileStamp() + '.json', JSON.stringify(Inv.makeBackup(state, Date.now()), null, 2), 'application/json');
  }

  function onImportFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || halted) return;
    if (busy || (wheel && wheel.spinning)) return toast('Đang có thao tác chạy, thử lại sau.', true);
    var reader = new FileReader();
    reader.onload = function () {
      var r = Inv.parseBackup(String(reader.result), C);
      if (!r.ok) {
        $('dataWarn').innerHTML = '<b>Không nhập file "' + esc(file.name) + '".</b> Dữ liệu hiện tại KHÔNG thay đổi.<ul class="err-list">' +
          r.errors.slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
        return;
      }
      var sm = Inv.summary(r.state);
      ask({
        title: 'Nhập bản sao lưu?',
        html: '<p>Toàn bộ dữ liệu sự kiện hiện tại sẽ được thay bằng bản sao lưu <b>' + esc(r.state.eventId) + '</b> (' + r.state.history.length + ' phiên, khả dụng ' + sm.available + ', giữ chỗ ' + sm.reserved + ', đã trao ' + sm.awarded + ').</p><p>Game sẽ tự tải về bản sao lưu dữ liệu hiện tại trước khi nhập.</p>',
        typed: 'NHẬP', okLabel: 'Nhập dữ liệu'
      }).then(function (res) {
        if (!res) return;
        downloadBackup('truoc-khi-nhap');
        var next = JSON.parse(JSON.stringify(r.state));
        next.log.push({ at: new Date().toISOString(), kind: 'import', reason: 'Nhập từ file ' + file.name.slice(0, 80) + ' (thay cho sự kiện ' + state.eventId + ')' });
        if (!save(next, { overwrite: true })) return;
        wheel = null;
        closeBtcPanel();
        render();
        toast('Đã nhập bản sao lưu.');
      });
    };
    reader.readAsText(file);
  }

  function resetEvent() {
    if (halted) return;
    if (busy || (wheel && wheel.spinning)) return toast('Đang có thao tác chạy, thử lại sau.', true);
    var sm = Inv.summary(state);
    ask({
      title: 'Khởi tạo sự kiện mới?',
      html: '<p>Thao tác này <b>xóa toàn bộ</b> tồn kho, lịch sử và nhật ký của sự kiện <b>' + esc(state.eventId) + '</b> (' + state.history.length + ' phiên; đang giữ chỗ ' + sm.reserved + ', đã trao ' + sm.awarded + '), rồi đặt lại kho theo cấu hình: ' +
        esc(Inv.catalogFrom(C).map(function (c) { return c.name + ' ' + c.initial; }).join(', ')) + '.</p><p>Game sẽ tự tải về bản sao lưu trước khi khởi tạo.</p>',
      typed: 'KHỞI TẠO', okLabel: 'Khởi tạo sự kiện mới'
    }).then(function (res) {
      if (!res) return;
      downloadBackup('truoc-khi-khoi-tao');
      var next = Inv.createEvent(C, newSession(), Date.now(), 'BTC khởi tạo lại sự kiện (thay cho ' + state.eventId + ')');
      if (!save(next, { overwrite: true })) return;
      wheel = null;
      closeBtcPanel();
      render();
      toast('Đã khởi tạo sự kiện mới.');
    });
  }

  // ---------- Hộp xác nhận (PIN / lý do / gõ chữ) ----------

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  var askResolve = null;
  function ask(o) {
    $('askTitle').textContent = o.title;
    $('askBody').innerHTML = o.html + (o.typed ? '<p>Gõ <b>' + esc(o.typed) + '</b> để xác nhận.</p>' : '');
    $('askPin').hidden = !(o.pin && C.BTC_PIN);
    $('askReason').hidden = !o.reason;
    $('askTyped').hidden = !o.typed;
    ['askPin', 'askReason', 'askTyped'].forEach(function (id) { $(id).value = ''; });
    $('askTyped').placeholder = o.typed || '';
    $('askWarn').textContent = '';
    $('askOk').textContent = o.okLabel || 'Xác nhận';
    openModal('askDialog');
    var first = ['askPin', 'askReason', 'askTyped'].filter(function (id) { return !$(id).hidden; })[0];
    setTimeout(function () { (first ? $(first) : $('askOk')).focus(); }, 30);
    return new Promise(function (resolve) {
      askResolve = function (ok) {
        if (!ok) { closeModal('askDialog'); askResolve = null; return resolve(null); }
        if (!$('askPin').hidden && String($('askPin').value) !== String(C.BTC_PIN)) { $('askWarn').textContent = 'Mã PIN không đúng.'; return; }
        if (o.reason && !$('askReason').value.trim()) { $('askWarn').textContent = 'Hãy nhập lý do.'; return; }
        if (o.typed && norm($('askTyped').value) !== norm(o.typed)) { $('askWarn').textContent = 'Chữ xác nhận chưa đúng.'; return; }
        var out = { reason: $('askReason').value.trim() };
        closeModal('askDialog');
        askResolve = null;
        resolve(out);
      };
    });
  }

  // ---------- Dữ liệu hỏng / bản cũ / không tương thích ----------

  function showBlocked(kind, res) {
    var errs = res.errors || [];
    var title, intro, dlLabel, dlData, note;
    if (kind === 'legacy') {
      title = 'Phát hiện dữ liệu của bản cũ';
      intro = '<p><b>BTC lưu ý:</b> trình duyệt còn dữ liệu của phiên bản game trước (danh mục quà cũ, chưa có tồn kho). Dữ liệu này <b>không tương thích</b> với danh mục quà mới, nên game tạm chặn bắt đầu.</p>' +
        '<ul class="err-list"><li>Dữ liệu cũ được <b>giữ nguyên</b> trong trình duyệt, không bị xóa và không bị đổi sang quà mới.</li><li>Lịch sử chơi cũ <b>không</b> được tính vào 103 phần quà của sự kiện mới.</li></ul>' +
        '<p><b>Bước 1:</b> tải bản sao lưu dữ liệu cũ. <b>Bước 2:</b> xác nhận khởi tạo sự kiện mới (cần PIN).</p>';
      dlLabel = 'Bước 1: Tải sao lưu dữ liệu cũ';
      dlData = function () { return { exportedAt: new Date().toISOString(), note: 'Dữ liệu bản cũ (nguyên văn)', keys: store.legacyDump() }; };
      note = 'Khởi tạo sự kiện mới (dữ liệu bản cũ được giữ nguyên trong trình duyệt, không tính vào kho)';
    } else if (kind === 'incompatible') {
      title = 'Dữ liệu sự kiện không tương thích';
      intro = '<p><b>BTC lưu ý:</b> dữ liệu sự kiện đã lưu không khớp phiên bản hoặc danh mục quà trong <code>js/config.js</code>. Game KHÔNG tự đổi quà hay reset kho.</p><ul class="err-list">' +
        errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' +
        '<p>Nếu vừa sửa nhầm <code>config.js</code>, hãy sửa lại rồi tải lại trang. Nếu muốn bắt đầu sự kiện mới: tải bản sao lưu rồi xác nhận khởi tạo (cần PIN).</p>';
      dlLabel = 'Bước 1: Tải bản sao dữ liệu hiện có';
      dlData = function () { return { exportedAt: new Date().toISOString(), event: store.readRaw(store.keys.state) }; };
      note = 'Khởi tạo sự kiện mới (dữ liệu không tương thích đã được sao lưu)';
    } else {
      title = 'Dữ liệu đã lưu bị lỗi';
      intro = '<p><b>BTC lưu ý:</b> game KHÔNG tự tạo phiên mới hay reset kho để tránh mất dữ liệu.</p><ul class="err-list">' +
        errs.slice(0, 8).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' +
        '<p>Hãy tải bản sao dữ liệu lỗi để lưu lại, sau đó BTC có thể khởi tạo sự kiện mới (cần PIN).</p>';
      dlLabel = 'Bước 1: Tải bản sao dữ liệu lỗi';
      dlData = function () { return { exportedAt: new Date().toISOString(), event: store.readRaw(store.keys.state) }; };
      note = 'Khởi tạo sự kiện mới (dữ liệu lỗi đã được sao lưu)';
    }
    var downloaded = false;
    showError(title, intro, [
      { label: dlLabel, cls: 'btn-primary', onClick: function () {
        download('sao-luu-' + kind + '-' + fileStamp() + '.json', JSON.stringify(dlData(), null, 2), 'application/json');
        downloaded = true;
        $('btnBlockedInit').disabled = false;
      } },
      { id: 'btnBlockedInit', label: 'Bước 2: BTC khởi tạo sự kiện mới', cls: 'btn-danger', disabled: true, onClick: function () {
        if (!downloaded) return;
        ask({ title: 'Khởi tạo sự kiện mới?', html: '<p>Kho quà mới: ' + esc(Inv.catalogFrom(C).map(function (c) { return c.name + ' ' + c.initial; }).join(', ')) + '.</p>', pin: true, typed: 'KHỞI TẠO', okLabel: 'Khởi tạo' })
          .then(function (ok) {
            if (!ok) return;
            if (kind !== 'legacy') store.backupRaw();
            state = null;
            if (!save(Inv.createEvent(C, newSession(), Date.now(), note), { overwrite: true })) return;
            render();
            toast('Đã khởi tạo sự kiện mới.');
          });
      } }
    ]);
  }

  function showError(title, bodyHtml, actions) {
    $('errorTitle').textContent = title;
    $('errorBody').innerHTML = bodyHtml;
    var box = $('errorActions');
    box.innerHTML = '';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + a.cls;
      b.textContent = a.label;
      if (a.id) b.id = a.id;
      if (a.disabled) b.disabled = true;
      b.addEventListener('click', a.onClick);
      box.appendChild(b);
    });
    showScreen('error');
  }

  // ---------- Tiện ích giao diện ----------

  function showLockOverlay() {
    closeModal('prizeModal'); closeModal('btcPanel'); closeModal('askDialog');
    openModal('lockOverlay');
  }

  function openModal(id) { $(id).hidden = false; document.body.classList.add('has-modal'); }
  function closeModal(id) {
    $(id).hidden = true;
    if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('has-modal');
  }

  var toastTimer = null;
  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3800);
  }

  function fileStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function download(name, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function initPrefs() {
    var on = store.getPrefs().sound !== false;
    Sound.setEnabled(on);
    syncSoundBtn();
  }

  function syncSoundBtn() {
    var on = Sound.isEnabled();
    $('btnSound').textContent = on ? '🔊' : '🔇';
    $('btnSound').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('btnSound').title = on ? 'Tắt âm thanh' : 'Bật âm thanh';
  }

  function buildWeb() {
    var svg = $('bgWeb');
    if (!svg) return;
    var parts = [], angles = [], r;
    for (var a = 0; a <= 90; a += 15) angles.push(a * Math.PI / 180);
    angles.forEach(function (t) { parts.push('M0 0 L' + (215 * Math.cos(t)).toFixed(1) + ' ' + (215 * Math.sin(t)).toFixed(1)); });
    for (r = 35; r <= 200; r += 33) {
      var d = '';
      for (var i = 0; i < angles.length; i++) {
        var x = r * Math.cos(angles[i]), y = r * Math.sin(angles[i]);
        if (i === 0) d += 'M' + x.toFixed(1) + ' ' + y.toFixed(1);
        else {
          var m = (angles[i] + angles[i - 1]) / 2, rr = r * 0.86;
          d += ' Q' + (rr * Math.cos(m)).toFixed(1) + ' ' + (rr * Math.sin(m)).toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1);
        }
      }
      parts.push(d);
    }
    svg.innerHTML = '<path d="' + parts.join(' ') + '"/><line class="web-thread" x1="120" y1="0" x2="120" y2="150"/><circle class="web-spider" cx="120" cy="156" r="7"/>';
  }

  // ---------- Sự kiện ----------

  function bindEvents() {
    document.addEventListener('pointerdown', function () { Sound.unlock(); }, { capture: true });
    document.addEventListener('keydown', function () { Sound.unlock(); }, { capture: true });
    $('btnStart').addEventListener('click', startQuiz);
    answerButtons().forEach(function (b) { b.addEventListener('click', onAnswerClick); });
    $('btnLock').addEventListener('click', lockAnswer);
    $('btnNext').addEventListener('click', nextFromFeedback);
    $('btnFromResult').addEventListener('click', fromResult);
    $('btnSpin').addEventListener('click', spin);
    $('wheel').addEventListener('click', function () { if (wheel) wheel.skip(); });
    $('btnToSummary').addEventListener('click', toSummary);
    $('btnClose').addEventListener('click', closeSession);
    $('btnBtc').addEventListener('click', openBtcPanel);
    $('btnBtcClose').addEventListener('click', closeBtcPanel);
    Array.prototype.forEach.call(document.querySelectorAll('.btc-tab'), function (t) {
      t.addEventListener('click', function () { btcTab = t.getAttribute('data-tab'); renderBtc(); });
    });
    $('pinForm').addEventListener('submit', unlockBtc);
    $('btnExportCsv').addEventListener('click', function () { exportHistory('csv'); });
    $('btnExportJson').addEventListener('click', function () { exportHistory('json'); });
    $('btnCancelSession').addEventListener('click', cancelSession);
    $('btnAdjAdd').addEventListener('click', function () { doAdjust(1); });
    $('btnAdjSub').addEventListener('click', function () { doAdjust(-1); });
    $('adjustForm').addEventListener('submit', function (e) { e.preventDefault(); });
    $('heldList').addEventListener('click', onHeldClick);
    $('btnExportLog').addEventListener('click', function () {
      download('nhat-ky-kho-' + fileStamp() + '.csv', '﻿' + Inv.logToCSV(state), 'text/csv;charset=utf-8');
    });
    $('btnBackup').addEventListener('click', function () { downloadBackup(''); toast('Đã tải bản sao lưu sự kiện.'); });
    $('importFile').addEventListener('change', onImportFile);
    $('btnResetEvent').addEventListener('click', resetEvent);
    $('askForm').addEventListener('submit', function (e) { e.preventDefault(); if (askResolve) askResolve(true); });
    $('askCancel').addEventListener('click', function () { if (askResolve) askResolve(false); });
    $('btnTakeover').addEventListener('click', function () {
      lock.acquire(true).then(function (got) {
        if (!got) return;
        clearInterval(pollTimer);
        halted = false; busy = false; wheel = null;
        closeModal('lockOverlay');
        loadState();
      });
    });
    $('btnSound').addEventListener('click', function () {
      Sound.setEnabled(!Sound.isEnabled());
      store.setPref('sound', Sound.isEnabled());
      syncSoundBtn();
      Sound.play('click');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('askDialog').hidden) { if (askResolve) askResolve(false); return; }
      if (!$('btcPanel').hidden) closeBtcPanel();
    });
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (session && session.phase === 'quiz') fitQuiz(); }, 80);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();

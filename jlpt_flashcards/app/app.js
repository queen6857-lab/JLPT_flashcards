// JLPT 암기장 (PRD v0.6). 데이터(data.js)와 채점기(grade.js)는 node data/build.js 가 만든다.
(function () {
  'use strict';

  const DATA = window.JLPT_DATA;
  const RANGES = [
    { key: 'n4-vocab', label: 'N4 단어' },
    { key: 'n4-pattern', label: 'N4 문형' },
    { key: 'n5-review', label: 'N5 복습' },
  ];
  const COUNTS = [20, 50, 'all'];
  const ALL = RANGES.flatMap(r => DATA[r.key]);
  const KANJI = /[一-鿿々]/;

  // ---- 저장 (PRD 6.1) ----
  const STORE_KEY = 'jlpt-flashcards';
  const store = (() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { /* 저장소를 못 쓰면 빈 기록으로 시작 */ }
    return {
      progress: saved.progress || {},
      acceptedAnswers: saved.acceptedAnswers || {},
      settings: Object.assign({ range: ['n4-vocab'], count: 20 }, saved.settings),
    };
  })();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 무시 */ }
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---- 도우미 ----
  const app = document.getElementById('app');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = sel => app.querySelector(sel);

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const wrongNote = () => ALL.filter(it => store.progress[it.id] && store.progress[it.id].inWrongNote);
  const rangeItems = range => RANGES.filter(r => range.includes(r.key)).flatMap(r => DATA[r.key]);

  // 안 푼 문제 → 오답 이력 많은 문제 순, 같은 순위 안에서는 무작위 (PRD 4.6)
  function ordered(items) {
    const seen = it => (store.progress[it.id] ? 1 : 0);
    const wrongs = it => (store.progress[it.id] ? store.progress[it.id].wrong : 0);
    return shuffle(items.slice()).sort((a, b) => seen(a) - seen(b) || wrongs(b) - wrongs(a));
  }

  // 히라가나 버튼: 한자 단어는 단어·예문 읽기, 문형은 예문에 한자가 있을 때 예문 읽기
  function hasHint(item) {
    if (item.type === 'vocab') return item.script === 'kanji';
    return !!item.example && KANJI.test(item.example.text);
  }

  // ---- 상태 ----
  let phase = 'home'; // home | question | feedback | result
  let round = null;   // { items, index, wrong: [], correct, retry }
  let q = null;       // 지금 문제의 상태 { item, answer, ok, before }

  // ---- 홈 ----
  function renderHome() {
    phase = 'home';
    const s = store.settings;
    const pool = rangeItems(s.range);
    const learned = pool.filter(it => store.progress[it.id] && store.progress[it.id].correct > 0).length;
    const noteCount = wrongNote().length;
    app.innerHTML = `
      <section class="screen">
        <h1 class="title">JLPT N4 암기장</h1>
        <div>
          <div class="label">출제 범위</div>
          <div class="chips">
            ${RANGES.map(r => `<button class="chip" data-range="${r.key}" aria-pressed="${s.range.includes(r.key)}">${r.label}</button>`).join('')}
          </div>
        </div>
        <div>
          <div class="label">문제 수</div>
          <div class="chips">
            ${COUNTS.map(c => `<button class="chip" data-count="${c}" aria-pressed="${s.count === c}">${c === 'all' ? '전체' : c}</button>`).join('')}
          </div>
        </div>
        <div class="bottom">
          <button class="btn primary" id="start" ${s.range.length ? '' : 'disabled'}>시작하기</button>
          <button class="btn" id="note" ${noteCount ? '' : 'disabled'}>오답만 풀기 (${noteCount})</button>
          <p class="progress-line">학습한 항목 ${learned} / ${pool.length}</p>
        </div>
      </section>`;

    app.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.range;
      s.range = s.range.includes(k) ? s.range.filter(x => x !== k) : RANGES.map(r => r.key).filter(x => x === k || s.range.includes(x));
      save();
      renderHome();
      $(`[data-range="${k}"]`).focus();
    }));
    app.querySelectorAll('[data-count]').forEach(b => b.addEventListener('click', () => {
      s.count = b.dataset.count === 'all' ? 'all' : Number(b.dataset.count);
      save();
      renderHome();
      $(`[data-count="${b.dataset.count}"]`).focus();
    }));
    $('#start').addEventListener('click', () => {
      const items = ordered(rangeItems(s.range));
      startRound(s.count === 'all' ? items : items.slice(0, s.count), false);
    });
    $('#note').addEventListener('click', () => startRound(ordered(wrongNote()), false));
  }

  // ---- 라운드 ----
  function startRound(items, retry) {
    round = { items, index: 0, wrong: [], correct: 0, retry };
    renderQuestion();
  }

  const countText = () => `${round.retry ? '다시 풀기 · ' : ''}${round.index + 1} / ${round.items.length} · 오답 ${round.wrong.length}`;

  function renderQuestion() {
    phase = 'question';
    const item = round.items[round.index];
    q = { item, answer: null, ok: null, before: null };
    const reading = hasHint(item);
    const ex = item.example;
    const len = [...item.display].length;
    const size = len > 9 ? 'xlong' : len > 5 ? 'long' : '';

    app.innerHTML = `
      <section class="screen">
        <div class="topbar">
          <button class="btn link" id="home">← 홈</button>
          <span id="count">${countText()}</span>
        </div>
        <div class="card" id="card">
          <div class="q ${size}" lang="ja">${esc(item.display)}</div>
          ${item.type === 'vocab' && reading ? `<div class="reading hint" lang="ja" hidden>${esc(item.reading)}</div>` : ''}
          ${ex ? `
            <div class="example" lang="ja">${esc(ex.text)}</div>
            ${reading ? `<div class="reading hint" lang="ja" style="font-size:14px" hidden>${esc(ex.reading)}</div>` : ''}` : ''}
        </div>
        <div class="bottom">
          <input class="answer" id="answer" type="text" placeholder="한국어 뜻 입력" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">
          <div id="controls">
            <div class="row">
              ${reading ? '<button class="btn" id="hint"><span lang="ja">あ</span> 히라가나</button>' : ''}
              <button class="btn" id="giveup">한국어 답</button>
            </div>
            <div class="row" style="margin-top:10px"><button class="btn primary" id="check">확인</button></div>
          </div>
        </div>
      </section>`;

    $('#home').addEventListener('click', renderHome);
    if (reading) $('#hint').addEventListener('click', () => {
      app.querySelectorAll('.hint').forEach(el => { el.hidden = false; });
      $('#hint').disabled = true;
      $('#answer').focus();
    });
    $('#giveup').addEventListener('click', () => finish(false, null));
    $('#check').addEventListener('click', submit);
    $('#answer').focus();
  }

  function submit() {
    const input = $('#answer');
    const answer = input.value.trim();
    if (!answer) {
      input.classList.remove('shake');
      void input.offsetWidth; // 애니메이션 다시 시작
      input.classList.add('shake');
      input.focus();
      return;
    }
    const meanings = q.item.meanings.concat(store.acceptedAnswers[q.item.id] || []);
    finish(window.Grader.grade(answer, meanings).ok, answer);
  }

  function finish(ok, answer) {
    const id = q.item.id;
    const p = store.progress[id] || { correct: 0, wrong: 0, lastSeen: '', inWrongNote: false };
    q.before = Object.assign({}, p);
    if (ok) { p.correct++; p.inWrongNote = false; } else { p.wrong++; p.inWrongNote = true; }
    p.lastSeen = today();
    store.progress[id] = p;
    save();

    q.ok = ok;
    q.answer = answer;
    if (ok) round.correct++; else round.wrong.push(q.item);
    renderFeedback();
  }

  function renderFeedback() {
    phase = 'feedback';
    $('#count').textContent = countText();
    const { item, ok, answer } = q;
    const ex = item.example;
    const reading = item.type === 'vocab' && item.script === 'kanji' ? item.reading : null;
    const card = $('#card');
    card.className = 'card ' + (ok ? 'ok' : 'ng');
    card.innerHTML = `
      <div class="verdict ${ok ? 'ok' : 'ng'}">${ok ? '✓ 정답' : '✗ 오답'}</div>
      <div class="q ${$('.q').className.replace('q', '').trim()}" lang="ja">${esc(item.display)}</div>
      ${reading ? `<div class="reading" lang="ja">${esc(reading)}</div>` : ''}
      <dl class="facts">
        ${!ok && answer ? `<dt>내 답</dt><dd class="mine">${esc(answer)}</dd>` : ''}
        <dt>정답</dt><dd>${esc(item.meanings.join(' · '))}</dd>
        ${ex ? `<dt>예문</dt><dd><div class="jp" lang="ja">${esc(ex.text)}</div><div class="reading" lang="ja" style="font-size:14px">${esc(ex.reading)}</div><div class="example-ko">${esc(ex.ko)}</div></dd>` : ''}
      </dl>`;
    const input = $('#answer');
    input.readOnly = true; // 포커스는 그대로 두어 모바일 키보드가 닫히지 않게 하고, 엔터로 다음으로 넘어간다
    $('#controls').innerHTML = `
      ${!ok && answer ? '<div class="row" style="margin-bottom:10px"><button class="btn" id="mine">내 답도 맞음</button></div>' : ''}
      <div class="row"><button class="btn primary" id="next">다음</button></div>`;
    $('#next').addEventListener('click', next);
    if (!ok && answer) $('#mine').addEventListener('click', acceptMine);
    input.focus();
  }

  // [내 답도 맞음]: 정답으로 바꾸고, 그 입력을 허용 답으로 저장 (PRD 4.3)
  function acceptMine() {
    const id = q.item.id;
    const p = store.progress[id];
    p.correct = q.before.correct + 1;
    p.wrong = q.before.wrong;
    p.inWrongNote = false;
    const list = store.acceptedAnswers[id] || (store.acceptedAnswers[id] = []);
    if (!list.includes(q.answer)) list.push(q.answer);
    save();
    round.wrong.pop();
    round.correct++;
    next();
  }

  function next() {
    round.index++;
    if (round.index < round.items.length) renderQuestion();
    else renderResult();
  }

  // ---- 라운드 결과 (PRD 4.7) ----
  function renderResult() {
    phase = 'result';
    const { wrong, correct, items } = round;
    app.innerHTML = `
      <section class="screen">
        <div class="score">${correct} / ${items.length}</div>
        <p class="progress-line">${wrong.length ? `오답 ${wrong.length}개 · 다 맞힐 때까지 다시 풀어요` : '모두 맞혔어요'}</p>
        ${wrong.length ? `<ul class="wrong-list">${wrong.map(it => `
          <li>
            <span class="w-disp" lang="ja">${esc(it.display)}</span>
            ${it.type === 'vocab' && it.script === 'kanji' ? `<span class="w-read" lang="ja">${esc(it.reading)}</span>` : ''}
            <span class="w-mean">${esc(it.meanings.join(' · '))}</span>
          </li>`).join('')}</ul>` : ''}
        <div class="bottom">
          ${wrong.length ? '<button class="btn primary" id="retry">오답 다시 풀기</button>' : ''}
          <button class="btn ${wrong.length ? '' : 'primary'}" id="home">홈으로</button>
        </div>
      </section>`;
    if (wrong.length) $('#retry').addEventListener('click', () => startRound(shuffle(wrong.slice()), true));
    $('#home').addEventListener('click', renderHome);
    (wrong.length ? $('#retry') : $('#home')).focus();
  }

  // ---- 키보드: 엔터로 확인 → 엔터로 다음 ----
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (e.target.tagName === 'BUTTON') return; // 포커스된 버튼은 기본 동작(클릭)
    if (phase === 'question' && e.target.id === 'answer') { e.preventDefault(); submit(); }
    else if (phase === 'feedback') { e.preventDefault(); next(); }
  });

  renderHome();
})();

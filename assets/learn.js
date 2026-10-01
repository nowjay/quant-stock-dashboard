/* =============================================================
   learn.js — '주식 공부' 화면
     목차(단원별 · 검색) · 본문(설명 · 계산식 · 예시 · 그림 · 확인 문제) · 퀴즈 · 학습 진행
   학습 내용(assets/learn/*.js)은 이 화면을 처음 열 때 내려받습니다 — 홈 화면 로딩을 늦추지 않도록.
   주소 #learn/<주제 id> 로 주제를 바로 열 수 있고, 뒤로 가기로 목차에 돌아옵니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  const KEY = 'qt.learn.v1';
  const FILES = ['chapters', 'figs', 'data-basics', 'data-bond', 'data-tech', 'data-value', 'data-macro', 'data-strategy', 'data-product'];
  const VER = (function () { const s = document.currentScript, m = s && /\?v=[\w.-]+/.exec(s.src || ''); return m ? m[0] : ''; })();
  const QUIZ_N = 10;
  /* 처음 공부하는 사람에게 권하는 순서 */
  const PATH = ['stock', 'order', 'candle', 'ma', 'cross', 'rsi', 'per', 'bond', 'baserate', 'diversification', 'lossmath', 'stoploss'];
  const APP = {
    chart:['candlestick-chart', '종목 분석 화면의 차트에서 직접 보기'],
    value:['gem', '가치분석 탭에서 실제 종목의 숫자 보기'],
    macro:['globe', '글로벌 매크로 탭에서 일정 · 뉴스 보기'],
    home:['layout-dashboard', '홈 화면에서 지금 수치 보기']
  };

  let ctx = { go:function () {} }, D = null, F = null, loading = null, bound = false;
  const st = { topic:null, quiz:null, q:'', open:{}, done:{}, last:null, answered:{} };

  function icons(){ if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }
  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function norm(s){ return String(s || '').toLowerCase().replace(/\s+/g, ''); }

  /* ---------------- 저장 (학습 완료 · 마지막으로 본 주제) ---------------- */
  function restore(){
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '{}');
      (v.done || []).forEach(function (id) { st.done[id] = true; });
      st.last = v.last || null;
    } catch (e) {}
  }
  function persist(){
    try { localStorage.setItem(KEY, JSON.stringify({ done:Object.keys(st.done).filter(function (k) { return st.done[k]; }), last:st.last })); } catch (e) {}
  }

  /* ---------------- 학습 내용 내려받기 ---------------- */
  function load(){
    if (loading) return loading;
    loading = FILES.reduce(function (p, f) {
      return p.then(function () {
        return new Promise(function (res, rej) {
          const s = document.createElement('script');
          s.src = 'assets/learn/' + f + '.js' + VER;
          s.onload = res; s.onerror = function () { rej(new Error(f)); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve()).then(function () { D = QT.LearnData; F = QT.LearnFigs; });
    loading.catch(function () { loading = null; });
    return loading;
  }

  /* ---------------- 주소 (#learn · #learn/<id> · #learn/quiz) ---------------- */
  function readHash(){
    const m = /^#learn(?:\/([\w-]+))?$/.exec(location.hash);
    return m ? { id:m[1] || null } : null;
  }
  function hashOf(){ return '#learn' + (st.quiz ? '/quiz' : st.topic ? '/' + st.topic : ''); }
  function setHash(push){
    const h = hashOf();
    if (location.hash === h) return;
    try { history[push ? 'pushState' : 'replaceState'](push ? { lr:1 } : history.state, '', h); } catch (e) {}
  }
  function applyRoute(r){
    if (!r) return;
    if (r.id === 'quiz'){ if (!st.quiz) st.quiz = { scope:null }; st.topic = null; }
    else { st.quiz = null; st.topic = r.id && D.byId[r.id] ? r.id : null; }
  }

  /* ---------------- 진행 ---------------- */
  function chTopics(ch){ return D.topics.filter(function (t) { return t.ch === ch; }); }
  function doneCount(list){ return list.filter(function (t) { return st.done[t.id]; }).length; }
  function setDone(id, on){
    if (on) st.done[id] = true; else delete st.done[id];
    persist(); renderSide();
  }

  /* ---------------- 목차 ---------------- */
  function itemHtml(t, withCh){
    return '<button type="button" class="lr-it' + (t.id === st.topic ? ' on' : '') + (st.done[t.id] ? ' done' : '') + '" data-id="' + t.id + '"' +
      (t.id === st.topic ? ' aria-current="true"' : '') + '>' +
      '<span class="lr-ck" aria-hidden="true"></span><span class="nm">' + t.t + (withCh ? '<small>' + chName(t.ch) + '</small>' : '') + '</span>' +
      '<em class="lr-lv lr-lv' + t.lv + '">' + D.LEVEL[t.lv] + '</em>' + (st.done[t.id] ? '<span class="sr">학습 완료</span>' : '') + '</button>';
  }
  function chName(id){ const c = D.chapters.filter(function (x) { return x.id === id; })[0]; return c ? c.t : ''; }
  /* 검색 — 제목 → 영문 · 검색어 → 한 줄 요약 → 본문 순. 영문 · 숫자 검색어는 낱말의 앞부분과 맞춰 본다
     ('per' 가 'copper' 에 걸리지 않도록), 한글은 띄어쓰기를 무시하고 포함 여부로 본다 */
  function indexOf(t){
    if (t._s) return t._s;
    const low = function (v) { return String(v || '').toLowerCase().replace(/<[^>]+>/g, ' '); };
    const body = low([].concat(t.body, t.read || [], t.warn || [], t.ex ? t.ex.rows : []).join(' '));
    return (t._s = { title:low(t.t), meta:low(t.en + ' ' + t.kw), sum:low(t.sum), body:body });
  }
  function search(raw){
    const q = raw.trim().toLowerCase(), ascii = /^[\x20-\x7e]+$/.test(q), qn = norm(q);
    const re = ascii ? new RegExp('(^|[^a-z0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : null;
    const has = function (text) { return ascii ? re.test(text) : norm(text).indexOf(qn) >= 0; };
    const out = [];
    D.topics.forEach(function (t) {
      const s = indexOf(t);
      const rank = norm(s.title).indexOf(qn) === 0 ? 0 : has(s.title) ? 1 : has(s.meta) ? 2 : has(s.sum) ? 3 : has(s.body) ? 4 : -1;
      if (rank >= 0) out.push({ t:t, rank:rank });
    });
    return out.sort(function (x, y) { return x.rank - y.rank; }).map(function (x) { return x.t; });
  }
  function renderSide(){
    const all = D.topics.length, d = doneCount(D.topics), last = st.last && D.byId[st.last];
    $('#lr-count').textContent = D.chapters.length + '개 단원 · ' + all + '개 주제';
    $('#lr-prog').innerHTML =
      '<div class="lr-prog-t"><span>학습 진행</span><b class="num">' + d + ' / ' + all + '</b></div>' +
      '<div class="lr-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + all + '" aria-valuenow="' + d + '"><i style="width:' + (d / all * 100).toFixed(1) + '%"></i></div>' +
      '<div class="lr-acts">' +
        (last && last.id !== st.topic ? '<button type="button" class="lr-act" data-id="' + last.id + '"><i data-lucide="book-open"></i><span>이어서: ' + last.t + '</span></button>' : '') +
        '<button type="button" class="lr-act" data-quiz-open><i data-lucide="circle-help"></i><span>퀴즈 풀기</span></button>' +
      '</div>';
    const q = norm(st.q), toc = $('#lr-toc');
    if (q){
      const hits = search(st.q);
      toc.innerHTML = hits.length
        ? '<p class="lr-hit">검색 결과 ' + hits.length + '건</p><div class="lr-ch-list">' + hits.map(function (t) { return itemHtml(t, true); }).join('') + '</div>'
        : '<div class="empty">\'' + esc(st.q) + '\'에 해당하는 주제가 없습니다.<br>다른 낱말로 검색해 보세요.</div>';
    } else {
      toc.innerHTML = D.chapters.map(function (c, i) {
        const list = chTopics(c.id), open = !!st.open[c.id];
        return '<section class="lr-ch' + (open ? ' open' : '') + '">' +
          '<button type="button" class="lr-ch-hd" data-ch="' + c.id + '" aria-expanded="' + open + '">' +
            '<span class="no">' + (i + 1) + '</span><span class="tt"><b>' + c.t + '</b><small class="num">' + doneCount(list) + ' / ' + list.length + ' 완료</small></span>' +
            '<i data-lucide="chevron-down" class="chev"></i></button>' +
          (open ? '<div class="lr-ch-list">' + list.map(function (t) { return itemHtml(t); }).join('') + '</div>' : '') +
          '</section>';
      }).join('');
    }
    icons();
  }

  /* ---------------- 본문 ---------------- */
  function sec(icon, title, html, cls){
    return html ? '<section class="lr-sec' + (cls ? ' ' + cls : '') + '"><h3><i data-lucide="' + icon + '"></i>' + title + '</h3>' + html + '</section>' : '';
  }
  function ul(a){ return a && a.length ? '<ul>' + a.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : ''; }
  function tblHtml(t){
    if (!t) return '';
    return '<div class="lr-tblw"><table class="lr-tbl"><thead><tr>' + t.head.map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      t.rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return i ? '<td>' + c + '</td>' : '<th scope="row">' + c + '</th>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' + (t.cap ? '<p class="lr-cap">' + t.cap + '</p>' : '');
  }
  function quizHtml(t, picked, opts){
    const q = t.quiz, done = picked != null;
    return '<p class="q">' + q.q + '</p><div class="opts">' + q.a.map(function (a, i) {
      const cls = !done ? '' : i === q.ok ? ' ok' : i === picked ? ' no' : ' dim';
      return '<button type="button" class="lr-opt' + cls + '" data-pick="' + i + '"' + (done ? ' disabled' : '') + '><span class="n">' + (i + 1) + '</span><span>' + a + '</span></button>';
    }).join('') + '</div>' +
      (done ? '<div class="why ' + (picked === q.ok ? 'ok' : 'no') + '" role="status"><b>' + (picked === q.ok ? '정답입니다' : '아쉬워요 — 정답은 ' + (q.ok + 1) + '번') + '</b><p>' + q.why + '</p>' + ((opts && opts.after) || '') + '</div>' : '');
  }
  function neighbors(id){
    const i = D.topics.indexOf(D.byId[id]);
    return { prev:D.topics[i - 1] || null, next:D.topics[i + 1] || null };
  }
  function topicHtml(t){
    const nb = neighbors(t.id), app = APP[t.app];
    return '<div class="lr-art">' +
      '<div class="lr-top"><button type="button" class="lr-back" data-back><i data-lucide="arrow-left"></i>목차</button>' +
        '<span class="lr-crumb">' + chName(t.ch) + '</span><em class="lr-lv lr-lv' + t.lv + '">' + D.LEVEL[t.lv] + '</em></div>' +
      '<h2 id="lr-title" tabindex="-1">' + t.t + '</h2>' + (t.en ? '<p class="lr-en">' + t.en + '</p>' : '') +
      '<p class="lr-sum">' + t.sum + '</p>' +
      '<div class="lr-body">' + t.body.map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>' +
      tblHtml(t.tbl) +
      sec('sigma', '계산식', t.formula ? '<dl class="lr-fm">' + t.formula.map(function (f) {
        return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>';
      }).join('') + '</dl>' : '') +
      sec('calculator', t.ex ? '예시 — ' + t.ex.t : '', t.ex ? '<ol class="lr-ex">' + t.ex.rows.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ol>' : '') +
      (t.fig ? '<figure class="lr-fig"><div class="lr-figb" data-figkey="' + t.fig + '"></div><figcaption>' + (t.figcap || '') + '</figcaption></figure>' : '') +
      sec('lightbulb', '이렇게 활용해요', ul(t.read)) +
      sec('triangle-alert', '주의할 점', ul(t.warn), 'caution') +
      (t.asof ? '<p class="lr-asof"><i data-lucide="calendar-check"></i>제도 · 세율 · 거래 시간은 ' + D.asOf + ' 기준입니다. 바뀔 수 있으니 실제 거래 전에 확인하세요.</p>' : '') +
      (app ? '<button type="button" class="lr-app" data-app="' + t.app + '"><i data-lucide="' + app[0] + '"></i><span>' + app[1] + '</span><i data-lucide="arrow-right"></i></button>' : '') +
      (t.quiz ? '<section class="lr-quiz" id="lr-quiz"><h3><i data-lucide="circle-help"></i>확인 문제</h3><div id="lr-quiz-b">' + quizHtml(t, st.answered[t.id]) + '</div></section>' : '') +
      (t.rel && t.rel.length ? '<div class="lr-rel"><span>함께 보면 좋은 주제</span>' + t.rel.map(function (id) {
        const r = D.byId[id]; return r ? '<button type="button" data-id="' + id + '">' + r.t + '</button>' : '';
      }).join('') + '</div>' : '') +
      '<div class="lr-foot">' +
        (nb.prev ? '<button type="button" class="lr-nav" data-id="' + nb.prev.id + '"><i data-lucide="chevron-left"></i><span><small>이전</small>' + nb.prev.t + '</span></button>' : '<span></span>') +
        '<button type="button" class="lr-done' + (st.done[t.id] ? ' on' : '') + '" data-done="' + t.id + '" aria-pressed="' + !!st.done[t.id] + '"><i data-lucide="check"></i><span>' + (st.done[t.id] ? '학습 완료' : '학습 완료로 표시') + '</span></button>' +
        (nb.next ? '<button type="button" class="lr-nav next" data-id="' + nb.next.id + '"><span><small>다음</small>' + nb.next.t + '</span><i data-lucide="chevron-right"></i></button>' : '<span></span>') +
      '</div></div>';
  }
  function overviewHtml(){
    const last = st.last && D.byId[st.last];
    return '<div class="lr-art lr-ov">' +
      '<h2 id="lr-title" tabindex="-1">무엇부터 공부할까요?</h2>' +
      '<p class="lr-lead">왼쪽 목차에서 단원을 펼치거나, 궁금한 용어를 검색해 보세요. 주제마다 쉬운 설명 · 계산식 · 숫자 예시 · 확인 문제가 들어 있습니다.</p>' +
      (last ? '<button type="button" class="lr-app" data-id="' + last.id + '"><i data-lucide="book-open"></i><span>이어서 공부하기 — ' + last.t + '</span><i data-lucide="arrow-right"></i></button>' : '') +
      '<div class="lr-cards">' + D.chapters.map(function (c, i) {
        const list = chTopics(c.id), d = doneCount(list);
        return '<button type="button" class="lr-card" data-open-ch="' + c.id + '">' +
          '<span class="ic"><i data-lucide="' + c.icon + '"></i></span>' +
          '<b>' + (i + 1) + '. ' + c.t + '</b><p>' + c.d + '</p>' +
          '<span class="lr-bar"><i style="width:' + (d / list.length * 100).toFixed(1) + '%"></i></span>' +
          '<small class="num">' + list.length + '개 주제 · ' + d + '개 완료</small></button>';
      }).join('') + '</div>' +
      '<section class="lr-sec"><h3><i data-lucide="route"></i>처음이라면 이 순서로</h3><ol class="lr-path">' + PATH.map(function (id) {
        const t = D.byId[id];
        return t ? '<li><button type="button" data-id="' + id + '"' + (st.done[id] ? ' class="done"' : '') + '>' + t.t + '</button></li>' : '';
      }).join('') + '</ol></section>' +
      '<p class="lr-disc">학습용 일반 정보이며 투자 권유나 자문이 아닙니다. 계산 예시의 숫자는 모두 검증 스크립트(tools/verify_learn.js)로 다시 계산해 확인했습니다. 세율 · 거래 시간 등 제도는 ' + D.asOf + ' 기준입니다.</p>' +
      '</div>';
  }

  /* ---------------- 퀴즈 ---------------- */
  function shuffle(a){
    for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function startQuiz(scope){
    const pool = D.topics.filter(function (t) { return t.quiz && (scope === 'all' || t.ch === scope); });
    st.quiz = { scope:scope, ids:shuffle(pool.map(function (t) { return t.id; })).slice(0, QUIZ_N), i:0, picks:[] };
    renderDoc(true);
  }
  function quizModeHtml(){
    const z = st.quiz, head = '<div class="lr-top"><button type="button" class="lr-back" data-back><i data-lucide="arrow-left"></i>목차</button><span class="lr-crumb">퀴즈</span></div>';
    if (!z.scope){
      return '<div class="lr-art">' + head + '<h2 id="lr-title" tabindex="-1">퀴즈 풀기</h2>' +
        '<p class="lr-lead">범위를 고르면 ' + QUIZ_N + '문제가 무작위로 나옵니다. 문제마다 바로 해설을 볼 수 있습니다.</p>' +
        '<div class="lr-scope"><button type="button" data-scope="all"><b>전체 범위</b><small>' + D.topics.length + '문제 중 ' + QUIZ_N + '문제</small></button>' +
        D.chapters.map(function (c) {
          const n = chTopics(c.id).length;
          return '<button type="button" data-scope="' + c.id + '"><b>' + c.t + '</b><small>' + n + '문제 중 ' + Math.min(QUIZ_N, n) + '문제</small></button>';
        }).join('') + '</div></div>';
    }
    const n = z.ids.length;
    if (z.i >= n){
      const score = z.ids.filter(function (id, i) { return z.picks[i] === D.byId[id].quiz.ok; }).length;
      const wrong = z.ids.filter(function (id, i) { return z.picks[i] !== D.byId[id].quiz.ok; });
      return '<div class="lr-art">' + head + '<h2 id="lr-title" tabindex="-1">결과</h2>' +
        '<div class="lr-score"><b class="num">' + score + '</b><span>/ ' + n + '</span><p>' +
          (score === n ? '모두 맞혔습니다. 훌륭해요!' : score >= n * 0.7 ? '잘하셨어요. 틀린 문제의 주제만 다시 보면 충분합니다.' : '틀린 문제의 주제를 읽고 다시 도전해 보세요.') + '</p></div>' +
        (wrong.length ? '<div class="lr-rel"><span>다시 볼 주제</span>' + wrong.map(function (id) { return '<button type="button" data-id="' + id + '">' + D.byId[id].t + '</button>'; }).join('') + '</div>' : '') +
        '<div class="lr-foot"><span></span><button type="button" class="lr-done" data-scope="' + z.scope + '"><i data-lucide="rotate-ccw"></i><span>같은 범위로 다시 풀기</span></button><span></span></div></div>';
    }
    const t = D.byId[z.ids[z.i]], picked = z.picks[z.i];
    return '<div class="lr-art">' + head +
      '<div class="lr-qhd"><span class="num">' + (z.i + 1) + ' / ' + n + '</span><div class="lr-bar"><i style="width:' + ((z.i + (picked != null ? 1 : 0)) / n * 100).toFixed(1) + '%"></i></div></div>' +
      '<section class="lr-quiz big"><h2 id="lr-title" tabindex="-1" class="sr">문제 ' + (z.i + 1) + '</h2><div id="lr-quiz-b">' +
        quizHtml(t, picked, { after:'<button type="button" class="lr-link" data-id="' + t.id + '">\'' + t.t + '\' 공부하기</button>' }) + '</div></section>' +
      (picked != null ? '<div class="lr-foot"><span></span><button type="button" class="lr-done on" data-quiz-next><span>' + (z.i + 1 < n ? '다음 문제' : '결과 보기') + '</span><i data-lucide="arrow-right"></i></button><span></span></div>' : '') +
      '</div>';
  }

  /* ---------------- 그림 ---------------- */
  function mountFigs(){
    $$('#lr-doc .lr-figb').forEach(function (el) {
      const w = el.clientWidth;
      if (!w || +el.dataset.w === w) return;
      el.dataset.w = w;
      el.innerHTML = F.render(el.dataset.figkey, w);
    });
  }
  function figHover(e){
    const plot = e.target.closest && e.target.closest('.lf-plot[data-fig]');
    $$('#lr-doc .lf-plot[data-fig]').forEach(function (p) { if (p !== plot) figOff(p); });
    if (!plot) return;
    const key = plot.dataset.fig, L = F.live[key], svg = $('svg', plot), r = svg.getBoundingClientRect();
    if (!L || !r.width) return;
    const k = L.w / r.width;
    const i = Math.max(0, Math.min(L.n - 1, Math.round(((e.clientX - r.left) * k - L.ml) / L.pw * (L.n - 1))));
    const x = L.ml + L.pw * i / (L.n - 1), tip = F.tip(key, i), box = $('.lf-tip', plot), cross = $('.lf-cross', plot);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    box.innerHTML = '<b>' + tip.title + '</b>' + tip.rows.map(function (row) {
      return '<span><i style="background:' + row[0] + '"></i>' + row[1] + '<em class="num">' + row[2] + '</em></span>';
    }).join('');
    box.hidden = false;
    const px = x / k, bw = box.offsetWidth;
    box.style.left = Math.max(0, Math.min(r.width - bw, px > r.width * 0.55 ? px - bw - 10 : px + 10)) + 'px';
  }
  function figOff(plot){
    const box = $('.lf-tip', plot), cross = $('.lf-cross', plot);
    if (box) box.hidden = true;
    if (cross) cross.setAttribute('visibility', 'hidden');
  }

  /* ---------------- 그리기 ---------------- */
  function renderDoc(focus){
    const el = $('#lr-doc'), t = st.topic && D.byId[st.topic];
    el.innerHTML = st.quiz ? quizModeHtml() : t ? topicHtml(t) : overviewHtml();
    $('#learn').dataset.pane = st.quiz || t ? 'doc' : 'list';
    icons();
    mountFigs();
    if (focus){
      const top = $('#learn').dataset.pane === 'doc' ? el : $('#learn');
      if (top.getBoundingClientRect().top < 0 || window.innerWidth <= 1000) top.scrollIntoView({ block:'start' });
      const h = $('#lr-title'); if (h) h.focus({ preventScroll:true });
    }
  }
  /* 목차가 따로 스크롤되는 넓은 화면에서, 지금 읽는 주제가 목차 안에 보이도록 */
  function revealActive(){
    const toc = $('#lr-toc'), cur = $('.lr-it.on', toc);
    if (!cur || toc.scrollHeight <= toc.clientHeight) return;
    const a = cur.getBoundingClientRect(), b = toc.getBoundingClientRect();
    if (a.top < b.top + 8) toc.scrollTop -= b.top - a.top + 48;
    else if (a.bottom > b.bottom - 8) toc.scrollTop += a.bottom - b.bottom + 48;
  }
  function open(id, push){
    if (!D.byId[id]) return;
    st.topic = id; st.quiz = null; st.last = id; st.open[D.byId[id].ch] = true;
    persist(); setHash(push); renderSide(); renderDoc(true); revealActive();
  }
  function toList(){
    st.topic = null; st.quiz = null;
    setHash(true); renderSide(); renderDoc(true);
  }

  /* ---------------- 이벤트 ---------------- */
  function bind(){
    if (bound) return; bound = true;
    const root = $('#learn');
    root.addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
      const ds = b.dataset;
      if (ds.pick != null){
        const pick = +ds.pick;
        if (st.quiz && st.quiz.ids){ st.quiz.picks[st.quiz.i] = pick; renderDoc(false); return; }
        const t = D.byId[st.topic];
        st.answered[t.id] = pick;
        $('#lr-quiz-b').innerHTML = quizHtml(t, pick);
        if (pick === t.quiz.ok && !st.done[t.id]){ setDone(t.id, true); syncDone(t.id); }
        return;
      }
      if (ds.id){ open(ds.id, true); return; }
      if (ds.ch){ st.open[ds.ch] = !st.open[ds.ch]; renderSide(); return; }
      if (ds.openCh){
        const list = chTopics(ds.openCh), next = list.filter(function (t) { return !st.done[t.id]; })[0] || list[0];
        open(next.id, true); return;
      }
      if (ds.back != null){ toList(); return; }
      if (ds.done){ setDone(ds.done, !st.done[ds.done]); syncDone(ds.done); return; }
      if (ds.app){ ctx.go(ds.app); return; }
      if (ds.quizOpen != null){ st.quiz = { scope:null }; st.topic = null; setHash(true); renderSide(); renderDoc(true); return; }
      if (ds.scope){ startQuiz(ds.scope); return; }
      if (ds.quizNext != null){ st.quiz.i++; renderDoc(true); return; }
    });
    $('#lr-q').addEventListener('input', function (e) { st.q = e.target.value; renderSide(); });
    $('#lr-q').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const first = $('#lr-toc .lr-it'); if (first){ e.preventDefault(); open(first.dataset.id, true); }
    });
    const doc = $('#lr-doc');
    doc.addEventListener('pointermove', figHover);
    doc.addEventListener('pointerdown', figHover);
    doc.addEventListener('pointerleave', function () { $$('.lf-plot[data-fig]', doc).forEach(figOff); });
    let rz = 0;
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (document.body.dataset.view === 'learn') mountFigs(); }, 150); });
  }
  /* 뒤로 · 앞으로 가기 — 주소에 맞춰 화면을 되돌린다 (다른 화면에 있었다면 공부 화면으로 돌아온다) */
  window.addEventListener('popstate', function () {
    const r = readHash(), here = document.body.dataset.view === 'learn';
    if (!r){ if (here && D) setHash(false); return; }
    if (!here){ ctx.go('learn'); return; }
    if (!D) return;
    applyRoute(r);
    if (st.topic){ st.last = st.topic; st.open[D.byId[st.topic].ch] = true; persist(); }
    renderSide(); renderDoc(true); revealActive();
  });
  /* 본문의 '학습 완료' 버튼만 고쳐 그린다 (읽던 위치를 유지) */
  function syncDone(id){
    const b = $('#lr-doc .lr-done[data-done="' + id + '"]');
    if (!b) return;
    b.classList.toggle('on', !!st.done[id]);
    b.setAttribute('aria-pressed', !!st.done[id]);
    $('span', b).textContent = st.done[id] ? '학습 완료' : '학습 완료로 표시';
  }

  /* ---------------- 진입 ---------------- */
  function show(){
    const toc = $('#lr-toc');
    if (!D) toc.innerHTML = '<div class="loading">학습 내용을 불러오는 중…</div>';
    load().then(function () {
      bind();
      const r = readHash();
      if (r) applyRoute(r);
      if (st.topic && !D.byId[st.topic]) st.topic = null;
      if (st.topic){ st.last = st.topic; st.open[D.byId[st.topic].ch] = true; }
      else if (!Object.keys(st.open).length) st.open[(st.last && D.byId[st.last] ? D.byId[st.last].ch : D.chapters[0].id)] = true;
      setHash(false);
      renderSide(); renderDoc(false); revealActive();
    }).catch(function () {
      toc.innerHTML = '<div class="empty">학습 내용을 불러오지 못했습니다.<br>새로고침해 주세요.</div>';
    });
  }

  restore();
  QT.Learn = {
    init:function (c) { ctx = Object.assign(ctx, c || {}); },
    show:show,
    /** 다른 화면(용어 설명 '?')에서 주제를 바로 연다 */
    openTopic:function (id) {
      st.topic = id; st.quiz = null;
      try { history.replaceState(history.state, '', '#learn/' + id); } catch (e) {}
    },
    wantsView:function () { return !!readHash(); }
  };
})(window.QT);

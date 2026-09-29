/* =============================================================
   screener.js — '추천 종목만 보기' 스크리너 (사이드바 관심종목 · 시가총액 상위 탭)
     · 등급   : 강력 매수만(80점↑) / 매수 이상 전체(65점↑)
     · 기준   : 기술적 분석 / 재무 가치분석 / 종합(기술 50 + 재무 50)
     · 기술 · 종합 기준은 실제 일봉이 있는 종목만, 재무 · 종합 기준은 재무 데이터가 있는 종목만 평가
     · 국내 종목은 공공데이터(금융위원회) 일봉 — 시가총액 상위 종목은 스크리너를 켤 때 일봉을 받아 평가
     · 종목별 평가는 signal.js 에 캐시되고, 가격이 바뀐 종목만 다시 계산합니다
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const M = QT.Market, S = QT.Signal, F = QT.Fund;
  const KEY = 'qt.screen.v1';
  const BASIS = { tech:'기술적', fund:'재무 가치', combo:'종합' };
  const $ = function (s, r) { return (r || document).querySelector(s); };

  const cfg = (function () {
    const d = { on:false, grade:'buy', basis:'combo' };
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return Object.assign(d, s); } catch (e) {}
    return d;
  })();
  function save(){ try { localStorage.setItem(KEY, JSON.stringify({ on:cfg.on, grade:cfg.grade, basis:cfg.basis })); } catch (e) {} }

  function fin(v){ return v != null && isFinite(v); }
  function icons(){ if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }
  function price(v, cur){ return !fin(v) ? '—' : cur === 'USD' ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원'; }
  function pct(v){ return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%'; }
  function pct1(v){ return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%'; }
  function cls(v){ return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }

  let ctx = { select:null, current:function () { return null; } };
  let job = { id:0, done:false, list:null, key:null };
  let lastHtml = '', lastRun = 0, fetching = 0;

  /* ---------------- 대상 종목 ---------------- */
  function pool(tab, mkt, watchlist){
    if (tab === 'watch') return watchlist.map(function (c) { return M.BY_CODE[c]; }).filter(Boolean);
    return M.UNIVERSE.filter(function (s) {
      if (!(F && F.has(s.code)) && !M.isReal(s.code) && !M.isKrxTop(s.code)) return false;
      if (mkt === 'ALL') return true;
      if (mkt === 'US') return s.cur === 'USD';
      if (mkt === 'ETF') return s.type === 'etf';
      return s.market === mkt;
    });
  }
  function scoreOf(ev){
    if (!ev) return null;
    if (cfg.basis === 'tech') return ev.tech ? ev.tech.score : null;
    if (cfg.basis === 'fund') return ev.fund ? ev.fund.score : null;
    return ev.combo.total;
  }
  function upsideOf(ev){
    const fv = ev.fund && ev.fund.fv && fin(ev.fund.fv.upside) ? ev.fund.fv.upside : null;
    const tg = ev.target ? ev.target.pct : null;
    if (cfg.basis === 'tech') return tg != null ? { v:tg, by:'기술적 목표가' } : null;
    if (fv != null) return { v:fv, by:'적정주가' };
    return tg != null ? { v:tg, by:'기술적 목표가' } : null;
  }
  function tagsOf(ev){
    const ft = ev.fund ? ev.fund.tags.filter(function (t) { return t.tone === 'good'; }) : [];
    const tt = ev.tech ? ev.tech.tags.filter(function (t) { return t.tone === 'good'; }) : [];
    const list = cfg.basis === 'tech' ? tt : cfg.basis === 'fund' ? ft : interleave(ft, tt);
    return list.slice(0, 4);
  }
  function interleave(a, b){
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++){ if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
    return out;
  }

  /* ---------------- 평가 (여러 프레임에 나눠 실행) ---------------- */
  function run(list, onDone, onProgress){
    const id = ++job.id, out = [];
    let i = 0;
    (function step(){
      if (id !== job.id) return;
      const t0 = performance.now();
      while (i < list.length && performance.now() - t0 < 14){
        try { out.push(S.evaluate(list[i].code)); } catch (e) { console.warn('[QT] 스크리너', list[i].code, e); }
        i++;
      }
      if (i < list.length){ if (onProgress) onProgress(i, list.length); setTimeout(step, 0); }
      else onDone(out.filter(Boolean));
    })();
  }

  function cardHtml(ev, sc, cur){
    const g = S.grade(sc), up = upsideOf(ev), tags = tagsOf(ev);
    const sub = [];
    if (ev.tech) sub.push('기술 ' + ev.tech.score);
    if (ev.fund) sub.push('재무 ' + ev.fund.score);
    return '<div class="scr-card' + (ev.code === cur ? ' on' : '') + '" data-code="' + ev.code + '" role="button" tabindex="0">' +
      '<div class="sc-top"><div class="sc-nm"><b>' + ev.st.name + '</b><span class="code">' + ev.code + '</span></div>' + QT.Value.badge(g, sc, true) + '</div>' +
      '<div class="sc-mid"><span class="sc-px num" data-f="px">' + price(ev.price, ev.st.cur) + '</span><span class="sc-ch num ' + cls(ev.rate) + '" data-f="ch">' + pct(ev.rate || 0) + '</span>' +
        '<span class="sc-up">' + (up ? '<small>' + up.by + '</small><b class="num ' + cls(up.v) + '">' + pct1(up.v) + '</b>' : '<small>상승 여력</small><b>—</b>') + '</span></div>' +
      (tags.length ? '<div class="sc-tags">' + tags.map(function (t) { return '<span>' + t.text + '</span>'; }).join('') + '</div>' : '') +
      '<div class="sc-sub">' + sub.join(' · ') + '</div>' +
    '</div>';
  }

  function paint(el, evs, total){
    const min = cfg.grade === 'sbuy' ? 80 : 65;
    const scored = evs.map(function (ev) { return { ev:ev, sc:scoreOf(ev) }; });
    const valid = scored.filter(function (x) { return fin(x.sc); });
    const hits = valid.filter(function (x) { return x.sc >= min; }).sort(function (a, b) { return b.sc - a.sc || (b.ev.combo.total || 0) - (a.ev.combo.total || 0); });
    const skipped = total - valid.length;
    const why = cfg.basis === 'tech' ? '실제 일봉이 없는' : cfg.basis === 'fund' ? '재무 데이터가 없는' : '일봉 또는 재무 데이터가 없는';
    const head = (fetching ? '<div class="scr-skip">공공데이터 일봉 ' + fetching + '종목을 받는 중 — 받는 대로 다시 평가합니다.</div>' : '') +
      '<div class="scr-head"><b>' + BASIS[cfg.basis] + ' 기준 · ' + (cfg.grade === 'sbuy' ? '강력 매수' : '매수 이상') + '</b>' +
      '<span><em class="num">' + hits.length + '</em>종목 / 분석 ' + valid.length + '종목</span></div>' +
      (skipped ? '<div class="scr-skip">' + why + ' ' + skipped + '종목은 제외했습니다.</div>' : '');
    const cur = ctx.current();
    const body = hits.length ? hits.map(function (x) { return cardHtml(x.ev, x.sc, cur); }).join('')
      : '<div class="empty">조건에 맞는 종목이 없습니다.<br>' + (cfg.grade === 'sbuy' ? '<b>매수 이상 전체</b>로 넓히거나 ' : '') + '분석 기준을 바꿔 보세요.' +
        (valid.length ? '<br><span class="muted">현재 최고 점수: ' + Math.max.apply(null, valid.map(function (x) { return x.sc; })) + '점</span>' : '') + '</div>';
    const html = head + body;
    if (html !== lastHtml){ el.innerHTML = html; lastHtml = html; }
  }

  /** 목록 그리기 — app.js renderList() 에서 호출. 대상 · 조건이 같으면 로딩 표시 없이 조용히 다시 그린다 */
  function render(el, tab, mkt, watchlist){
    const list = pool(tab, mkt, watchlist);
    const key = tab + '|' + mkt + '|' + list.map(function (s) { return s.code; }).join(',') + '|' + cfg.basis + '|' + cfg.grade;
    if (!list.length){
      job.id++; job.key = key;
      el.innerHTML = lastHtml = '<div class="empty">' + (tab === 'watch' ? '관심종목이 비어 있습니다.<br>검색 후 별을 눌러 추가하세요.' : '분석할 종목이 없습니다.') + '</div>';
      return;
    }
    /* 공공데이터 일봉을 아직 안 받은 종목은 받아 온 뒤 다시 평가 (기술 · 종합 기준) */
    if (cfg.basis !== 'fund' && !fetching){
      const need = list.filter(function (s) { return M.needsDaily(s.code); }).map(function (s) { return s.code; });
      if (need.length){
        fetching = need.length;
        M.ensureMany(need, 6).then(function () { fetching = 0; job.key = null; lastHtml = ''; if (cfg.on) ctx.refresh(); });
      }
    }
    const fresh = key !== job.key || !el.firstChild;
    if (fresh){
      lastHtml = '';
      el.innerHTML = '<div class="loading scr-loading">추천 종목을 분석하는 중… <span class="num" id="scr-prog">0 / ' + list.length + '</span></div>';
    }
    job.key = key;
    run(list, function (evs) { paint(el, evs, list.length); lastRun = Date.now(); },
      fresh ? function (i, n) { const p = $('#scr-prog'); if (p) p.textContent = i + ' / ' + n; } : null);
  }
  /** 실시간 — 가격이 바뀐 종목만 다시 평가해 순서 · 등급을 갱신 (3초 간격) */
  function tick(el, tab, mkt, watchlist){
    if (!cfg.on || Date.now() - lastRun < 3000) return;
    lastRun = Date.now();
    render(el, tab, mkt, watchlist);
  }

  /* ---------------- 필터 막대 ---------------- */
  function syncBar(){
    const on = $('#scr-on'); if (!on) return;
    on.checked = cfg.on;
    $('#scr-sum').textContent = BASIS[cfg.basis] + ' · ' + (cfg.grade === 'sbuy' ? '강력 매수' : '매수↑');
    $('#scr-btn').classList.toggle('on', cfg.on);
    document.querySelectorAll('#scr-grade button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === cfg.grade); });
    document.querySelectorAll('#scr-basis button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === cfg.basis); });
  }
  function setOpen(open){
    const p = $('#scr-panel'), b = $('#scr-btn');
    if (!p) return;
    p.hidden = !open;
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function init(c){
    ctx = Object.assign(ctx, c || {});
    syncBar();
    setOpen(cfg.on);
    $('#scr-on').addEventListener('change', function (e) {
      cfg.on = e.target.checked; save(); syncBar();
      if (cfg.on) setOpen(true);
      ctx.refresh();
    });
    $('#scr-btn').addEventListener('click', function () {
      const open = $('#scr-panel').hidden;
      setOpen(open);
    });
    $('#scr-panel').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      if (b.closest('#scr-grade')) cfg.grade = b.dataset.v; else cfg.basis = b.dataset.v;
      cfg.on = true; save(); syncBar(); ctx.refresh();
    });
    $('#wl').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.scr-card'); if (!card) return;
      e.preventDefault(); ctx.select(card.dataset.code);
    });
  }

  QT.Screener = { init:init, render:render, tick:tick, cfg:cfg, invalidate:function () { job.key = null; lastHtml = ''; } };
})(window.QT);

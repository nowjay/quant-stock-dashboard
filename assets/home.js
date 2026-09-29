/* =============================================================
   home.js — 스마트 홈 대시보드
     ① 글로벌 지수 전광판 (전 화면 상단)   ② 환율 · 원자재 · 금리 위젯
     ③ 공포 & 탐욕 (CNN) · 국장 심리지수   ④ 다가오는 매크로 일정 · D-Day
     ⑤ 지표를 누르면 뜨는 추세 차트 팝업
   데이터는 QT.Markets(스냅샷 + CNBC 실시간), 일정은 QT.Events 에서 옵니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const MK = QT.Markets, EV = QT.Events, LWC = window.LightweightCharts;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  const HOUR = 3600000, DAY = 86400000;
  const UP = '#F04438', DOWN = '#3B82F6', FLAT = '#8B95A1';
  let ctx = { select:function () {}, openMacro:function () {}, tip:function () { return ''; } };

  /* ---------------- 포맷 ---------------- */
  function fnum(v, dp){
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('ko-KR', { minimumFractionDigits:dp, maximumFractionDigits:dp });
  }
  function sign(v, dp){ return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + fnum(Math.abs(v), dp); }
  function pct(v){ return v == null || !isFinite(v) ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%'; }
  function cls(v){ return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function pad2(n){ return n < 10 ? '0' + n : '' + n; }
  function hm(t){ const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function ymdStr(n){ const s = String(n); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
  function mdOf(n){ const s = String(n).replace(/\D/g, ''); return (+s.slice(4, 6)) + '/' + (+s.slice(6, 8)); }
  function icons(){ if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }
  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function valText(it, v){
    const d = it.def;
    if (v == null || !isFinite(v)) return '—';
    if (d.k === 'FED' && it.lo != null) return fnum(it.lo, 2) + '~' + fnum(v, 2) + '%';
    if (d.f === 'usd') return '$' + fnum(v, d.dp);
    if (d.f === 'yld' || d.f === 'rate') return fnum(v, d.dp) + '%';
    return fnum(v, d.dp);
  }
  /* 전일 대비 — 금리는 bp, 기준금리는 %p, 나머지는 금액 + 등락률 */
  function chgParts(it){
    const d = it.def;
    if (it.d == null) return { a:'—', b:'' };
    if (d.f === 'yld') return { a:sign(it.d * 100, 1) + 'bp', b:'' };
    if (d.f === 'rate') return { a: it.d ? (it.d > 0 ? '인상 ' : '인하 ') + sign(it.d, 2) + '%p' : '동결', b:'' };
    return { a:sign(it.d, d.dp), b:pct(it.r) };
  }
  const UNIT = { WTI:'$/배럴', GOLD:'$/온스', COPPER:'$/파운드', USDKRW:'원', JPYKRW:'원' };

  /* ---------------- 스파크라인 ---------------- */
  let gid = 0;
  function spark(vals, tone, w, h){
    if (!vals || vals.length < 2) return '<span class="spk"></span>';
    let min = Infinity, max = -Infinity;
    vals.forEach(function (v) { if (v < min) min = v; if (v > max) max = v; });
    const pad = 3, span = (max - min) || 1;
    const pts = vals.map(function (v, i) {
      return (i / (vals.length - 1) * w).toFixed(1) + ',' + (h - pad - (v - min) / span * (h - pad * 2)).toFixed(1);
    });
    const c = tone > 0 ? UP : tone < 0 ? DOWN : FLAT, id = 'spk' + (++gid);
    return '<svg class="spk" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c + '" stop-opacity=".2"/>' +
      '<stop offset="1" stop-color="' + c + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="M' + pts.join('L') + 'L' + w + ',' + h + 'L0,' + h + 'Z" fill="url(#' + id + ')"/>' +
      '<path d="M' + pts.join('L') + '" fill="none" stroke="' + c + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
  }
  /* 기준금리 변경 이력 → 주 단위로 '그 시점 금리'를 표본 추출 (계단 모양 스파크라인) */
  function stepSample(h, years){
    if (!h || !h.length) return [];
    const now = new Date(), start = new Date(now.getTime() - years * 365 * DAY), out = [];
    for (let t = start.getTime(); t <= now.getTime(); t += 7 * DAY){
      const d = new Date(t), day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      let v = null;
      for (let i = 0; i < h.length && h[i][0] <= day; i++) v = h[i][1];
      if (v != null) out.push(v);
    }
    return out;
  }

  /* ---------------- ① 글로벌 지수 전광판 ---------------- */
  const TK_GROUPS = [['kr', '국내'], ['us', '미국'], ['asia', '아시아']];
  function statusText(){
    const s = MK.status;
    if (s.mode === 'live') return '<span class="led"></span>실시간 · ' + hm(s.liveAt) + ' 갱신';
    if (s.mode === 'snapshot'){
      const d = s.snapAt ? new Date(s.snapAt) : null;
      return '<span class="led"></span>' + (d ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm(s.snapAt) + ' 수집 기준' : '수집 데이터');
    }
    if (s.mode === 'error') return '<span class="led"></span>시세 연결 실패';
    return '<span class="led"></span>불러오는 중…';
  }
  function tkCard(it){
    const c = chgParts(it), vals = it.h.slice(-23).map(function (x) { return x[1]; });
    const when = it.t ? hm(it.t) : it.day ? mdOf(it.day) + ' 종가' : '';
    return '<button type="button" class="tk-card" data-k="' + it.k + '" title="' + esc(it.n) + (when ? ' · ' + when : '') + ' — 추세 보기">' +
      '<span class="tk-n">' + it.n + '</span>' +
      '<b class="tk-p num">' + valText(it, it.p) + '</b>' +
      '<span class="tk-c num ' + cls(it.d) + '"><span>' + c.a + '</span>' + (c.b ? '<em>' + c.b + '</em>' : '') + '</span>' +
      spark(vals, it.d, 64, 26) +
    '</button>';
  }
  function renderTicker(){
    const el = $('#tk-list');
    if (!el) return;
    let html = '';
    TK_GROUPS.forEach(function (g) {
      const items = MK.list(g[0]);
      if (!items.length) return;
      const ss = MK.session(g[0]);
      html += '<div class="tk-grp"><b>' + g[1] + '</b>' + (ss ? '<em data-s="' + ss.s + '">' + ss.label + '</em>' : '') + '</div>' +
        items.map(tkCard).join('');
    });
    el.innerHTML = html || '<div class="tk-empty">' + (MK.status.mode === 'error' ? '시장 데이터를 불러오지 못했습니다.' : '시장 데이터를 불러오는 중…') + '</div>';
    const meta = $('#tk-meta');
    meta.innerHTML = statusText();
    meta.dataset.mode = MK.status.mode;
    meta.title = MK.status.error || (MK.status.mode === 'live' ? 'CNBC 시세 (거래소 · 상품에 따라 10~15분 지연) · 코스피200 선물은 네이버 수집값' : '');
    tkArrows();
  }
  function tkArrows(){
    const sc = $('#tk-list');
    if (!sc) return;
    $('#tk-prev').hidden = sc.scrollLeft <= 4;
    $('#tk-next').hidden = sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 4;
  }

  /* ---------------- 오늘의 시장 한 줄 요약 ---------------- */
  function renderBrief(){
    const el = $('#h-brief');
    if (!el) return;
    const g = function (k) { return MK.get(k); };
    const chip = function (it, label) {
      return it ? '<span class="bf ' + cls(it.d) + '">' + (label || it.n) + ' <b class="num">' + pct(it.r) + '</b></span>' : '';
    };
    const parts = [];
    const us = MK.session('us'), kr = MK.session('kr');
    const spx = g('SPX'), ixic = g('IXIC'), nq = g('NQF');
    if (spx && ixic){
      const avg = (spx.r + ixic.r) / 2;
      const word = avg > 0.3 ? '상승' : avg < -0.3 ? '하락' : '보합권';
      parts.push(us && us.s === 'open'
        ? '미국 증시는 장중 ' + word + ' 흐름입니다 ' + chip(ixic) + chip(spx) + '.'
        : '미국 증시는 ' + word + ' 마감했습니다 ' + chip(ixic) + chip(spx) + (nq ? ' · 선물 ' + chip(nq, '나스닥100') : '') + '.');
    }
    const ks = g('KOSPI'), kq = g('KOSDAQ');
    if (ks && kq){
      const word = ks.r > 0.3 ? '강세' : ks.r < -0.3 ? '약세' : '보합';
      parts.push('코스피는 ' + (kr && kr.s === 'open' ? '장중 ' : kr && kr.s === 'pre' ? '개장 전, 직전 거래일 ' : '') + word + '입니다 ' + chip(ks) + chip(kq) + '.');
    }
    const fx = g('USDKRW');
    if (fx) parts.push('원/달러 <b class="num">' + fnum(fx.p, 1) + '원</b><span class="' + cls(fx.d) + '"> (' + sign(fx.d, 1) + ')</span>.');
    const f = MK.fng, k = MK.krs;
    if (f || k){
      parts.push('투자 심리는 ' + [f ? '미국 <b>' + Math.round(f.s) + '</b>(' + RATING[ratingOf(f.s)][0] + ')' : '',
        k ? '국내 <b>' + Math.round(k.s) + '</b>(' + RATING[ratingOf(k.s)][0] + ')' : ''].filter(Boolean).join(' · ') + '.');
    }
    el.innerHTML = parts.length ? parts.join(' ') : '시장 데이터를 불러오는 중…';
    const now = new Date();
    $('#h-date').textContent = (now.getMonth() + 1) + '월 ' + now.getDate() + '일 (' + '일월화수목금토'[now.getDay()] + ') ' + hm(now.getTime()) + ' 기준';
  }

  /* ---------------- ② 환율 · 원자재 · 금리 ---------------- */
  const MI_GROUPS = [['fx', '환율', 'banknote'], ['cmd', '원자재 · 금속', 'fuel'], ['rate', '금리', 'landmark']];
  function miTile(it){
    const d = it.def, c = chgParts(it);
    let vals, tone = it.d, extra = '';
    if (d.policy){
      vals = stepSample(it.h, 3);
      const p = MK.policy || {};
      if (it.k === 'BOK' && p.FED) extra = '한미 금리차 <b class="num">' + sign(p.BOK.v - p.FED.hi, 2) + '%p</b>';
      if (it.k === 'FED') extra = '최근 결정 ' + it.date.slice(2).replace(/-/g, '.');
      tone = it.d || 0;
    } else {
      vals = it.h.slice(-66).map(function (x) { return x[1]; });
    }
    if (it.k === 'US2Y'){
      const t10 = MK.get('US10Y');
      if (t10) extra = '장단기차(10Y−2Y) <b class="num">' + sign((t10.p - it.p) * 100, 0) + 'bp</b>';
    }
    if (it.k === 'US10Y' && it.hi52 != null) extra = '52주 ' + fnum(it.lo52, 2) + ' ~ ' + fnum(it.hi52, 2) + '%';
    if ((it.k === 'USDKRW' || it.k === 'JPYKRW') && it.hi52 != null) extra = '52주 ' + fnum(it.lo52, 0) + ' ~ ' + fnum(it.hi52, 0) + '원';
    if (it.k === 'BOK') extra = (extra ? extra + ' · ' : '') + it.date.slice(2).replace(/-/g, '.');
    return '<button type="button" class="mi-tile" data-k="' + it.k + '" aria-label="' + esc(it.n) + ' 추세 보기">' +
      '<span class="mi-n">' + it.n + (UNIT[it.k] ? '<small>' + UNIT[it.k] + '</small>' : '') + '</span>' +
      '<b class="mi-v num">' + valText(it, it.p) + '</b>' +
      '<span class="mi-c num ' + cls(it.d) + '">' + c.a + (c.b ? ' <em>' + c.b + '</em>' : '') + '</span>' +
      (extra ? '<span class="mi-x">' + extra + '</span>' : '') +
      spark(vals, tone, 120, 28) +
    '</button>';
  }
  function renderIndicators(){
    const el = $('#mi');
    if (!el) return;
    const html = MI_GROUPS.map(function (g) {
      const items = MK.list(g[0]);
      if (!items.length) return '';
      return '<div class="mi-grp"><div class="mi-gl"><i data-lucide="' + g[2] + '"></i>' + g[1] + '</div>' +
        '<div class="mi-grid">' + items.map(miTile).join('') + '</div></div>';
    }).join('');
    el.innerHTML = html || '<div class="loading">' + (MK.status.mode === 'error' ? '시장 데이터를 불러오지 못했습니다.' : '불러오는 중…') + '</div>';
    icons();
  }

  /* ---------------- ③ 공포 & 탐욕 · 국장 심리지수 ---------------- */
  const RATING = {
    'extreme fear':['극심한 공포', 'xf'], 'fear':['공포', 'f'], 'neutral':['중립', 'n'],
    'greed':['탐욕', 'g'], 'extreme greed':['극심한 탐욕', 'xg']
  };
  function ratingOf(s){ return s < 25 ? 'extreme fear' : s < 45 ? 'fear' : s <= 55 ? 'neutral' : s <= 75 ? 'greed' : 'extreme greed'; }
  const BANDS = [[0, 25, '#3B82F6'], [25, 45, '#93B9FB'], [45, 55, '#D1D6DB'], [55, 75, '#F8A29A'], [75, 100, '#F04438']];
  function gaugeSvg(score, title){
    const cx = 130, cy = 122, r = 100;
    const pt = function (s, rr) { const a = Math.PI * (1 - s / 100); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
    const arcs = BANDS.map(function (b) {
      const a = pt(b[0] + (b[0] ? 0.8 : 0), r), z = pt(b[1] - (b[1] < 100 ? 0.8 : 0), r);
      return '<path d="M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' A' + r + ' ' + r + ' 0 0 1 ' + z[0].toFixed(1) + ' ' + z[1].toFixed(1) + '" stroke="' + b[2] + '"/>';
    }).join('');
    const ticks = [0, 25, 50, 75, 100].map(function (s) {
      const p = pt(s, r - 22);
      return '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" text-anchor="middle">' + s + '</text>';
    }).join('');
    const rot = (Math.max(0, Math.min(100, score)) / 100 * 180 - 90).toFixed(1);
    return '<svg class="fg-svg" viewBox="0 0 260 146" role="img" aria-label="' + esc(title) + ' ' + Math.round(score) + '점">' +
      '<g fill="none" stroke-width="16" stroke-linecap="butt">' + arcs + '</g>' +
      '<g class="fg-ticks">' + ticks +
        '<text x="22" y="143" text-anchor="start">극심한 공포</text><text x="238" y="143" text-anchor="end">극심한 탐욕</text></g>' +
      '<g transform="rotate(' + rot + ' 130 122)">' +
        '<path d="M130 122 L126.2 114 L130 40 L133.8 114 Z" fill="#191F28"/><circle cx="130" cy="122" r="8" fill="#191F28"/><circle cx="130" cy="122" r="3.2" fill="#fff"/></g>' +
    '</svg>';
  }
  function rchip(s){ const r = RATING[ratingOf(s)]; return '<span class="fg-chip" data-r="' + r[1] + '">' + r[0] + '</span>'; }
  function prevRow(prev){
    return '<div class="fg-prev">' + [['close', '전일'], ['week', '1주 전'], ['month', '1개월 전'], ['year', '1년 전']].map(function (p) {
      const v = prev && prev[p[0]];
      return '<div><span>' + p[1] + '</span>' + (v != null ? '<b class="num">' + Math.round(v) + '</b>' + rchip(v) : '<b>—</b>') + '</div>';
    }).join('') + '</div>';
  }
  function partBar(s){
    const r = RATING[ratingOf(s)];
    return '<span class="fg-bar"><i data-r="' + r[1] + '" style="left:' + Math.max(0, Math.min(100, s)).toFixed(0) + '%"></i></span>';
  }
  const FNG_PART = {
    market_momentum_sp500:['시장 모멘텀', 'S&P500이 125일 이동평균보다 얼마나 위 · 아래에 있는지'],
    stock_price_strength:['주가 강도', '뉴욕증시 52주 신고가 종목 수와 신저가 종목 수의 차이'],
    stock_price_breadth:['주가 폭', '상승 종목 거래량과 하락 종목 거래량의 차이(맥클렐런 지수)'],
    put_call_options:['풋 · 콜 옵션', '콜옵션 대비 풋옵션 거래 비율 — 하락 대비(풋)가 많으면 공포'],
    market_volatility_vix:['시장 변동성', 'VIX가 50일 평균보다 높으면 공포'],
    junk_bond_demand:['정크본드 수요', '투기등급 회사채와 국채의 금리 차 — 좁을수록 위험 선호(탐욕)'],
    safe_haven_demand:['안전자산 수요', '최근 20거래일 주식과 국채의 수익률 차 — 국채가 앞서면 공포']
  };
  const KRS_PART = {
    momentum:['주가 모멘텀', '코스피가 125일 이동평균보다 얼마나 위 · 아래에 있는지 (최근 1년 분포 대비 백분위)', function (v) { return '125일선 ' + sign(v, 1) + '%'; }],
    strength:['52주 위치', '코스피가 최근 52주 최고 · 최저 범위에서 어디쯤인지', function (v) { return '52주 범위 ' + Math.round(v) + '%'; }],
    rsi:['단기 과열도', '코스피 RSI(14) — 70 이상 과열, 30 이하 침체', function (v) { return 'RSI ' + Math.round(v); }],
    volatility:['변동성', '코스피 20일 실현 변동성(연율) — 최근 1년보다 높을수록 공포', function (v) { return '연 ' + v.toFixed(1) + '%'; }],
    safehaven:['환율 (안전자산)', '원/달러 20일 변화율 — 원화 약세(환율 상승)일수록 공포', function (v) { return '원/달러 ' + sign(v, 1) + '%'; }],
    risk:['위험 선호', '코스닥 20일 수익률 − 코스피 20일 수익률 — 중소형주가 강할수록 탐욕', function (v) { return '코스닥−코스피 ' + sign(v, 1) + '%p'; }]
  };
  function fgHead(title, sub, tipKey){
    return '<div class="card-hd"><i data-lucide="gauge"></i><h2>' + title + '</h2>' + (tipKey ? ctx.tip(tipKey) : '') + '<span class="sub">' + sub + '</span></div>';
  }
  function gaugeBlock(kind, s, title){
    const r = RATING[ratingOf(s)];
    return '<button type="button" class="fg-gauge" data-pop="' + kind + '" aria-label="' + esc(title) + ' 추이 보기">' + gaugeSvg(s, title) +
      '<span class="fg-score num" data-r="' + r[1] + '">' + Math.round(s) + '</span>' +
      '<span class="fg-rating" data-r="' + r[1] + '">' + r[0] + '</span></button>';
  }
  function renderFng(){
    const el = $('#fg-us');
    if (!el) return;
    const f = MK.fng;
    if (!f){ el.innerHTML = fgHead('공포 & 탐욕 지수', '미국 · CNN') + '<div class="loading">' + (MK.status.mode === 'error' ? '데이터가 없습니다.' : '불러오는 중…') + '</div>'; return; }
    const at = f.t ? new Date(Date.parse(f.t)) : null;
    el.innerHTML = fgHead('공포 & 탐욕 지수', '미국 · CNN Business' + (at ? ' · ' + (at.getMonth() + 1) + '/' + at.getDate() : ''), 'fng') +
      gaugeBlock('fng', f.s, 'CNN 공포 & 탐욕 지수') + prevRow(f.prev) +
      '<div class="fg-parts"><div class="fg-parts-hd">세부 지표 7개</div>' + (f.parts || []).map(function (p) {
        const m = FNG_PART[p.k] || [p.k, ''];
        return '<div class="fg-part" title="' + esc(m[1]) + '"><span class="nm">' + m[0] + '</span>' + partBar(p.s) + rchip(p.s) + '</div>';
      }).join('') + '</div>';
    icons();
  }
  function renderKrs(){
    const el = $('#fg-kr');
    if (!el) return;
    const k = MK.krs;
    if (!k){ el.innerHTML = fgHead('국장 심리지수', '코스피 · 코스닥') + '<div class="loading">' + (MK.status.mode === 'error' ? '데이터가 없습니다.' : '불러오는 중…') + '</div>'; return; }
    const b = MK.breadth || {}, fl = MK.flows || {}, snapAt = MK.status.snapAt;
    const breadthRow = function (name, x) {
      if (!x) return '';
      const tot = (x.up + x.down + x.flat) || 1;
      return '<div class="br-row"><span class="nm">' + name + '</span>' +
        '<span class="br-bar"><i class="u" style="width:' + (x.up / tot * 100).toFixed(1) + '%"></i><i class="f" style="width:' + (x.flat / tot * 100).toFixed(1) + '%"></i><i class="d" style="width:' + (x.down / tot * 100).toFixed(1) + '%"></i></span>' +
        '<span class="br-n num"><b class="up">▲' + x.up.toLocaleString('ko-KR') + '</b><b class="down">▼' + x.down.toLocaleString('ko-KR') + '</b></span></div>';
    };
    const flowRow = function (name, x) {
      if (!x) return '';
      return '<div class="fl-r"><span class="nm">' + name + '</span>' + [x.indiv, x.foreign, x.inst].map(function (v) {
        return '<b class="num ' + cls(v || 0) + '">' + sign(v || 0, 0) + '</b>';
      }).join('') + '</div>';
    };
    const v = k.vol;
    el.innerHTML = fgHead('국장 심리지수', 'QUANT 자체 계산 · ' + mdOf(k.date), 'krs') +
      gaugeBlock('krs', k.s, '국장 심리지수') + prevRow(k.prev) +
      '<div class="fg-parts"><div class="fg-parts-hd">구성 지표 6개 <span>최근 1년 대비 백분위</span></div>' + (k.parts || []).map(function (p) {
        const m = KRS_PART[p.k] || [p.k, '', function () { return ''; }];
        return '<div class="fg-part" title="' + esc(m[1]) + '"><span class="nm">' + m[0] + '<small>' + (p.v != null ? m[2](p.v) : '') + '</small></span>' + partBar(p.s) + rchip(p.s) + '</div>';
      }).join('') + '</div>' +
      (v ? '<div class="kr-vol"><div><span>코스피 20일 변동성</span><b class="num">' + v.v20.toFixed(1) + '%</b></div>' +
        '<div><span>1년 평균</span><b class="num">' + v.avg.toFixed(1) + '%</b></div>' +
        '<div><span>1년 중 위치</span><b class="num">' + (v.pct >= 50 ? '상위 ' + (100 - v.pct) : '하위 ' + v.pct) + '%</b></div></div>' : '') +
      ((b.KOSPI || fl.KOSPI) ? '<div class="kr-tape"><div class="fg-parts-hd">등락 종목 · 투자자 순매수 <span>' + (snapAt ? hm(snapAt) + ' 수집 · ' : '') + '억원</span></div>' +
        breadthRow('코스피', b.KOSPI) + breadthRow('코스닥', b.KOSDAQ) +
        ((fl.KOSPI || fl.KOSDAQ) ? '<div class="fl-t"><div class="fl-r hd"><span>순매수</span><span>개인</span><span>외국인</span><span>기관</span></div>' +
          flowRow('코스피', fl.KOSPI) + flowRow('코스닥', fl.KOSDAQ) + '</div>' : '') + '</div>' : '');
    icons();
  }

  /* ---------------- ④ 다가오는 주요 매크로 일정 · D-Day ---------------- */
  const DD = { cat:'', more:false };
  const DD_ICON = { rate:'landmark', inflation:'shopping-basket', jobs:'briefcase', expiry:'alarm-clock', earn:'building-2' };
  function upcoming(){
    const now = Date.now(), to = now + 35 * DAY, from = now - 90 * 60000;
    const macro = DD.cat === 'earn' ? [] : EV.macro({ from:from, to:to }).filter(function (e) { return e.imp >= 2; });
    const earn = DD.cat === 'macro' ? [] : EV.earnings({ from:from, to:to }).map(function (e) {
      return Object.assign({}, e, { cat:'earn', imp:2, isEarn:true });
    });
    return macro.concat(earn).sort(function (a, b) { return a.t - b.t || b.imp - a.imp; });
  }
  function ddays(t){ return EV.dayNo(t) - EV.dayNo(Date.now()); }
  function numOf(s){ const v = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')); return isFinite(v) ? v : null; }
  function cmpHtml(e){
    if (e.isEarn){
      const x = QT.Markets.eps(e.code, e.t);
      if (!x || !x.f) return '';
      const a = numOf(x.ly), b = numOf(x.f), g = a && b != null && a > 0 ? (b / a - 1) * 100 : null;
      return '<span class="dd-cmp"><span class="k">EPS</span>' +
        '<span class="v"><small>전년 동기</small><b class="num">' + esc(x.ly || '—') + '</b></span><i class="ar">→</i>' +
        '<span class="v"><small>예상</small><b class="num ' + (g != null ? cls(g) : '') + '">' + esc(x.f) + '</b></span>' +
        (g != null ? '<em class="' + cls(g) + '">' + (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(0) + '%</em>' : '') + '</span>';
    }
    const c = QT.Markets.consensus(e);
    if (!c) return '';
    const kr = e.country === 'KR', isRate = e.kind === 'fomc' || e.kind === 'bok';
    return c.rows.map(function (r, i) {
      const a = numOf(r.prev), b = numOf(r.fcst);
      const dir = a != null && b != null ? (b > a ? 'up' : b < a ? 'down' : 'flat') : '';
      const fc = r.fcst ? '<b class="num ' + dir + '">' + esc(r.fcst) + '</b>'
        : '<b class="na">' + (kr ? '미제공' : '발표 주간 공개') + '</b>';
      return '<span class="dd-cmp' + (i ? ' sub' : '') + '"><span class="k">' + esc(r.label) + '</span>' +
        '<span class="v"><small>' + (isRate && c.src === 'official' ? '현재' : '직전') + '</small><b class="num">' + esc(r.prev || '—') + '</b></span>' +
        (kr && !r.fcst ? '' : '<i class="ar">→</i><span class="v"><small>예상</small>' + fc + '</span>') +
        (dir && dir !== 'flat' ? '<em class="' + dir + '">' + (dir === 'up' ? '▲' : '▼') + '</em>' : '') +
        (i === 0 && c.note ? '<span class="nt">' + esc(c.note) + '</span>' : '') + '</span>';
    }).join('');
  }
  function ddRow(e){
    const n = ddays(e.t), past = e.t < Date.now();
    const tag = past ? '발표됨' : n <= 0 ? 'D-DAY' : 'D-' + n;
    const tone = past ? 'past' : n <= 0 ? 'now' : n <= 3 ? 'soon' : n <= 7 ? 'near' : '';
    const title = e.isEarn ? e.name + ' ' + e.title : e.title;
    const ref = !e.isEarn && e.detail ? e.detail.split(' · ')[0] : '';
    const meta = EV.fmtMD(e.t) + ' ' + EV.fmtTime(e.t) + (e.isEarn ? ' · ' + e.whenLabel : (/분$|분기$/.test(ref) ? ' · ' + ref : ''));
    const cty = e.country || (/^\d/.test(e.code) ? 'KR' : 'US');
    const link = e.isEarn && QT.Market && QT.Market.BY_CODE[e.code];     // 실적 일정은 누르면 그 종목 차트로
    const tagName = link ? 'button' : 'div';
    return '<' + tagName + (link ? ' type="button" data-code="' + e.code + '" title="' + esc(e.name) + ' 차트 보기"' : '') + ' class="dd-item ' + tone + '" data-cat="' + e.cat + '">' +
      '<span class="dd-tag">' + tag + '</span>' +
      '<span class="dd-body">' +
        '<span class="dd-t"><span class="ic"><i data-lucide="' + (DD_ICON[e.cat] || 'calendar') + '"></i></span><b>' + esc(title) + '</b>' +
          (e.imp >= 3 ? '<span class="dd-key">핵심</span>' : '') +
          '<span class="status-chip" data-s="' + e.status + '">' + e.status + '</span></span>' +
        '<small class="dd-m"><span class="cty" data-c="' + cty + '">' + (cty === 'KR' ? '한국' : '미국') + '</span>' +
          meta + (e.isEarn && e.tag ? ' · ' + esc(e.tag) : '') + '</small>' +
        cmpHtml(e) +
      '</span></' + tagName + '>';
  }
  let ddNext = null;
  function cdText(t){
    const c = EV.countdown(t);
    if (!c) return '발표 시각이 지났습니다';
    return (c.d ? c.d + '일 ' : '') + pad2(c.h) + ':' + pad2(c.m) + ':' + pad2(c.s);
  }
  function renderDday(){
    const el = $('#dd-list');
    if (!el || !EV) return;
    const list = upcoming();
    const shown = DD.more ? list.slice(0, 30) : list.slice(0, 8);
    el.innerHTML = shown.map(ddRow).join('') || '<div class="empty">앞으로 5주 안에 예정된 일정이 없습니다.</div>';
    $('#dd-more').hidden = DD.more || list.length <= shown.length;
    $('#dd-more').textContent = '일정 더 보기 (' + Math.max(0, list.length - shown.length) + '건)';
    const key = EV.macro({ from:Date.now(), to:Date.now() + 60 * DAY }).filter(function (e) { return e.imp >= 3; })[0];
    ddNext = key ? key.t : null;
    $('#dd-next').innerHTML = key
      ? '<span class="eyebrow"><i data-lucide="radar"></i>다음 핵심 이벤트</span><b>' + esc(key.title) + '</b>' +
        '<span class="dd-when">' + EV.dday(key.t) + ' · ' + EV.fmtMD(key.t) + ' ' + EV.fmtTime(key.t) + '</span>' +
        '<span class="dd-cd num" id="dd-cd">' + cdText(key.t) + '</span>'
      : '';
    icons();
  }
  function tickCountdown(){
    if (ddNext == null) return;
    if (ddNext <= Date.now()){ renderDday(); return; }
    const el = $('#dd-cd');
    if (el) el.textContent = cdText(ddNext);
  }

  /* ---------------- ⑤ 추세 차트 팝업 ---------------- */
  const pop = { chart:null, series:null, lines:[], key:null, range:'3M', ro:null, opener:null, long:null };
  const RANGES = { '1M':1, '3M':3, '6M':6, '1Y':12, '3Y':36, '5Y':60, 'ALL':600 };
  function toTime(n){ return ymdStr(n); }
  function popSource(k){
    if (k === 'fng'){ const f = MK.fng; return f ? { n:'공포 & 탐욕 지수 (CNN)', h:f.h, score:true, p:f.s, desc:'CNN Business가 7개 지표(모멘텀 · 주가 강도 · 주가 폭 · 풋/콜 · VIX · 정크본드 · 안전자산)로 계산하는 미국 증시 투자 심리 지수입니다. 0에 가까울수록 공포, 100에 가까울수록 탐욕입니다.' } : null; }
    if (k === 'krs'){ const s = MK.krs; return s ? { n:'국장 심리지수 (QUANT)', h:s.h, score:true, p:s.s, desc:'코스피 모멘텀 · 52주 위치 · RSI · 변동성 · 원/달러 · 코스닥 상대강도 6개 항목을 최근 1년 분포 대비 백분위로 환산해 평균한 자체 지표입니다. 과거 가격만으로 계산한 참고용 수치입니다.' } : null; }
    const it = MK.get(k);
    return it ? { n:it.n, it:it, h:it.h, step:!!it.def.policy, p:it.p, desc:MK.DESC[k] || '' } : null;
  }
  function popRanges(src){
    if (src.step) return ['1Y', '3Y', '5Y', 'ALL'];
    if (src.score) return ['1M', '3M', '6M', '1Y'];
    return ['1M', '3M', '6M', '1Y'].concat(src.it && src.it.def.sym ? ['5Y'] : []);
  }
  const RLABEL = { '1M':'1개월', '3M':'3개월', '6M':'6개월', '1Y':'1년', '3Y':'3년', '5Y':'5년', 'ALL':'전체' };
  function cutoff(range){
    const d = new Date(); d.setMonth(d.getMonth() - RANGES[range]);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function seriesFor(src, range){
    let h = range === '5Y' && pop.long ? pop.long.slice() : (src.h || []).slice();
    if (range === '5Y' && pop.long && src.h && src.h.length){      // 주봉 끝을 최신 일봉으로 이어 붙임
      const last = src.h[src.h.length - 1];
      if (last[0] > h[h.length - 1][0]) h.push(last);
    }
    const from = cutoff(range);
    if (src.step){
      let start = null;
      const out = [];
      h.forEach(function (x) { if (x[0] <= from) start = x[1]; else out.push(x); });
      if (start != null) out.unshift([from, start]);
      const today = new Date(), td = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
      if (out.length) out.push([td, out[out.length - 1][1]]);
      return out;
    }
    return h.filter(function (x) { return x[0] >= from; });
  }
  function popStats(src, data){
    if (!data.length) return '';
    const first = data[0][1], last = data[data.length - 1][1];
    let hi = -Infinity, lo = Infinity;
    data.forEach(function (x) { if (x[1] > hi) hi = x[1]; if (x[1] < lo) lo = x[1]; });
    const it = src.it, f = it ? it.def.f : 'score';
    const vt = function (v) { return it ? valText({ def:it.def, lo:null }, v) : Math.round(v) + ''; };
    let chg;
    if (f === 'yld') chg = sign((last - first) * 100, 0) + 'bp';
    else if (f === 'rate') chg = sign(last - first, 2) + '%p';
    else if (f === 'score') chg = sign(last - first, 0) + 'pt';
    else chg = pct((last / first - 1) * 100);
    return '<div><span>기간 변동</span><b class="num ' + cls(last - first) + '">' + chg + '</b></div>' +
      '<div><span>기간 최고</span><b class="num">' + vt(hi) + '</b></div>' +
      '<div><span>기간 최저</span><b class="num">' + vt(lo) + '</b></div>' +
      (it && it.hi52 != null ? '<div><span>52주 범위</span><b class="num">' + vt(it.lo52) + ' ~ ' + vt(it.hi52) + '</b></div>'
        : '<div><span>시작값</span><b class="num">' + vt(first) + '</b></div>');
  }
  function popHeader(src){
    const it = src.it;
    let px, chg = '', sub;
    if (it){
      const c = chgParts(it);
      px = valText(it, it.p);
      chg = '<span class="num ' + cls(it.d) + '">' + c.a + (c.b ? ' (' + c.b + ')' : '') + '</span>';
      sub = it.def.policy ? (it.src + ' · 최근 결정 ' + it.date)
        : (it.live ? 'CNBC 실시간' : '수집 데이터') + (it.t ? ' · ' + new Date(it.t).toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }) : '');
    } else {
      const r = RATING[ratingOf(src.p)];
      px = Math.round(src.p) + '';
      chg = '<span class="fg-chip" data-r="' + r[1] + '">' + r[0] + '</span>';
      sub = src.n.indexOf('CNN') >= 0 ? 'CNN Business · 일별' : '코스피 · 코스닥 일봉으로 계산 · 일별';
    }
    $('#pop-title').textContent = src.n;
    $('#pop-sub').textContent = sub;
    $('#pop-px').innerHTML = '<b class="num">' + px + '</b>' + chg;
    $('#pop-desc').textContent = src.desc || '';
  }
  function paintPop(fit){
    const src = popSource(pop.key);
    if (!src || !pop.chart) return;
    popHeader(src);
    const data = seriesFor(src, pop.range);
    const first = data.length ? data[0][1] : 0, last = data.length ? data[data.length - 1][1] : 0;
    const c = src.score ? '#191F28' : last > first ? UP : last < first ? DOWN : FLAT;
    pop.series.applyOptions({
      lineColor:c, topColor: src.score ? 'rgba(25,31,40,.10)' : (c === UP ? 'rgba(240,68,56,.18)' : c === DOWN ? 'rgba(59,130,246,.18)' : 'rgba(139,149,161,.15)'),
      bottomColor:'rgba(255,255,255,0)', lineType: src.step ? 1 : 0,
      priceFormat: src.it ? { type:'price', precision:src.it.def.dp, minMove:Math.pow(10, -src.it.def.dp) } : { type:'price', precision:0, minMove:1 }
    });
    pop.series.setData(data.map(function (x) { return { time:toTime(x[0]), value:x[1] }; }));
    pop.lines.forEach(function (l) { pop.series.removePriceLine(l); });
    pop.lines = [];
    if (src.score){
      [[75, '탐욕', UP], [55, '', '#D1D6DB'], [45, '', '#D1D6DB'], [25, '공포', DOWN]].forEach(function (x) {
        pop.lines.push(pop.series.createPriceLine({ price:x[0], color:x[2], lineWidth:1, lineStyle:2, axisLabelVisible:false, title:x[1] }));
      });
    }
    if (fit) pop.chart.timeScale().fitContent();           // 30초 시세 갱신 때는 사용자가 옮긴 범위를 유지
    $('#pop-stats').innerHTML = popStats(src, data);
    $$('#pop-range button').forEach(function (b) { b.classList.toggle('on', b.dataset.r === pop.range); });
  }
  function openPop(key, opener){
    const src = popSource(key);
    if (!src || !LWC) return;
    pop.key = key; pop.long = null; pop.opener = opener || null;
    const ranges = popRanges(src);
    pop.range = src.step ? '5Y' : src.score ? '6M' : '3M';
    $('#pop-range').innerHTML = ranges.map(function (r) { return '<button type="button" data-r="' + r + '">' + RLABEL[r] + '</button>'; }).join('');
    $('#pop-err').hidden = true;
    const box = $('#pop');
    box.classList.add('show');
    document.body.classList.add('pop-open');
    if (!pop.chart){
      const el = $('#pop-chart');
      pop.chart = LWC.createChart(el, {
        width:el.clientWidth, height:el.clientHeight,
        layout:{ background:{ type:'solid', color:'#FFFFFF' }, textColor:'#8B95A1', fontFamily:"'Gothic A1',-apple-system,sans-serif", fontSize:11, attributionLogo:false },
        grid:{ vertLines:{ visible:false }, horzLines:{ color:'#F3F4F6' } },
        rightPriceScale:{ borderVisible:false, scaleMargins:{ top:0.12, bottom:0.08 } },
        timeScale:{ borderVisible:false, fixLeftEdge:true, fixRightEdge:true },
        crosshair:{ mode:LWC.CrosshairMode.Magnet, vertLine:{ color:'#B0B8C1', style:2, labelBackgroundColor:'#191F28' }, horzLine:{ color:'#B0B8C1', style:2, labelBackgroundColor:'#191F28' } },
        handleScroll:{ vertTouchDrag:false }, localization:{ locale:'ko-KR' }
      });
      pop.series = pop.chart.addAreaSeries({ lineWidth:2, priceLineVisible:false, lastValueVisible:true, crosshairMarkerRadius:4 });
      pop.ro = new ResizeObserver(function () { if (pop.chart) pop.chart.applyOptions({ width:el.clientWidth, height:el.clientHeight }); });
      pop.ro.observe(el);
    }
    pop.chart.applyOptions({ width:$('#pop-chart').clientWidth, height:$('#pop-chart').clientHeight });
    paintPop(true);
    setTimeout(function () { $('#pop-close').focus(); }, 30);
  }
  function closePop(){
    const box = $('#pop');
    if (!box.classList.contains('show')) return;
    box.classList.remove('show');
    document.body.classList.remove('pop-open');
    pop.key = null;
    if (pop.opener && pop.opener.focus) pop.opener.focus();
  }
  function setRange(r){
    pop.range = r;
    if (r !== '5Y' || pop.long){ paintPop(true); return; }
    const key = pop.key;
    $$('#pop-range button').forEach(function (b) { b.classList.toggle('on', b.dataset.r === r); });
    $('#pop-err').hidden = false; $('#pop-err').textContent = '5년 주봉을 불러오는 중…';
    MK.fetchLong(key).then(function (h) {
      if (pop.key !== key) return;
      pop.long = h; $('#pop-err').hidden = true; paintPop(true);
    }).catch(function (e) {
      if (pop.key !== key) return;
      $('#pop-err').textContent = '5년 데이터를 불러오지 못했습니다 (' + e.message + '). 1년 차트를 표시합니다.';
      pop.range = '1Y'; paintPop(true);
    });
  }

  /* ---------------- 렌더 · 이벤트 ---------------- */
  /* kind: 'live'(30초 시세)면 시세가 들어가는 곳만, 그 외(스냅샷 · 상태)는 심리지수 카드까지 */
  function renderMarkets(kind){
    renderTicker();
    if (document.body.dataset.view === 'home'){
      renderBrief();
      renderIndicators();
      if (kind !== 'live'){ renderFng(); renderKrs(); }
    }
    if (pop.key) paintPop();
  }
  function renderHome(){
    renderMarkets();
    renderDday();
  }

  function bind(){
    const tk = $('#tk-list');
    tk.addEventListener('scroll', tkArrows, { passive:true });
    window.addEventListener('resize', tkArrows);
    $('#tk-prev').addEventListener('click', function () { tk.scrollBy({ left:-tk.clientWidth * 0.8, behavior:'smooth' }); });
    $('#tk-next').addEventListener('click', function () { tk.scrollBy({ left:tk.clientWidth * 0.8, behavior:'smooth' }); });
    document.addEventListener('click', function (e) {
      const t = e.target.closest('.tk-card, .mi-tile, .fg-gauge');
      if (!t) return;
      openPop(t.dataset.k || t.dataset.pop, t);
    });
    $('#pop-close').addEventListener('click', closePop);
    $('#pop').addEventListener('click', function (e) { if (e.target === $('#pop')) closePop(); });
    $('#pop-range').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) setRange(b.dataset.r); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
    $('#dd-filter').addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      $$('#dd-filter button').forEach(function (x) { x.classList.toggle('on', x === b); });
      DD.cat = b.dataset.cat || ''; DD.more = false; renderDday();
    });
    $('#dd-more').addEventListener('click', function () { DD.more = true; renderDday(); });
    $('#dd-list').addEventListener('click', function (e) { const b = e.target.closest('[data-code]'); if (b) ctx.select(b.dataset.code); });
    $('#dd-all').addEventListener('click', function () { ctx.openMacro(); });
  }

  function init(c){
    ctx = Object.assign(ctx, c || {});
    bind();
    MK.on(function (kind) {
      renderMarkets(kind);
      if (kind === 'snapshot' && document.body.dataset.view === 'home') renderDday();   // 예상치 반영
    });
    MK.init();
    renderHome();
    setInterval(tickCountdown, 1000);
    setInterval(function () { if (!document.hidden && document.body.dataset.view === 'home'){ renderDday(); renderBrief(); } }, 60000);
  }

  QT.Home = {
    init:init, render:renderHome, renderDday:renderDday, closePop:closePop, cmp:cmpHtml,
    get popOpen(){ return !!pop.key; }
  };
})(window.QT);

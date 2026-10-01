/* =============================================================
   learn/figs.js — '주식 공부' 그림 (인라인 SVG)
   지표 그림은 손으로 그리지 않고 QT.Indicators 로 '예시 주가'를 실제 계산해 그립니다
   — 화면의 선과 설명이 어긋나지 않도록 (tools/verify_learn.js 가 그림 속 사건을 다시 확인).
   render(key, width) 는 문자열만 돌려주는 순수 함수라 node 에서도 그대로 검사할 수 있습니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const I = QT.Indicators;
  const INK = '#191F28', INK2 = '#4E5968', GRID = '#EEF0F2', FAINT = '#B0B8C1';
  /* 계열색 — 파랑 · 주황 · 보라 (색각 이상 구분 · 흰 바탕 대비 3:1 검증), 주가는 무채색 */
  const C1 = '#3182F6', C2 = '#DC6803', C3 = '#7A5AF8', PX = '#4E5968', UP = '#F04438', DOWN = '#3B82F6';

  function won(v){ return Math.round(v).toLocaleString('ko-KR'); }
  function f1(v){ return v.toFixed(1); }
  function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  /* ---------------- 예시 주가 (고정 난수 — 언제 그려도 같은 모양) ---------------- */
  function rng(seed){
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const WARM = 80, SHOW = 120;                       // 앞 80일은 이동평균 계산용 (그리지 않음)
  let demoCache = null;
  /** 하락 → 바닥 다지기 → 상승(골든크로스) → 과열 → 조정 순서로 움직이는 예시 종가 200일 */
  function demo(){
    if (demoCache) return demoCache;
    const r = rng(5), phases = [[82, 0.0006], [30, -0.0045], [22, 0.0004], [40, 0.0052], [14, -0.0040], [12, 0.0020]];
    const c = [10000];
    phases.forEach(function (p) {
      for (let k = 0; k < p[0] && c.length < WARM + SHOW; k++) c.push(c[c.length - 1] * (1 + p[1] + (r() - 0.5) * 0.034));
    });
    const bb = I.bollinger(c, 20, 2), md = I.macd(c, 12, 26, 9);
    const cut = function (a) { return a.slice(WARM); };
    demoCache = {
      close:cut(c), ma20:cut(I.sma(c, 20)), ma60:cut(I.sma(c, 60)),
      bbUp:cut(bb.up), bbMid:cut(bb.mid), bbLo:cut(bb.lo), rsi:cut(I.rsi(c, 14)),
      macd:cut(md.line), sig:cut(md.signal), hist:cut(md.hist)
    };
    const d = demoCache;
    /* 그림에 표시할 사건 — 실제 계산 결과에서 찾는다 */
    d.golden = -1; d.dead = -1;
    for (let i = 1; i < SHOW; i++){
      const a = d.ma20[i - 1] - d.ma60[i - 1], b = d.ma20[i] - d.ma60[i];
      if (a <= 0 && b > 0 && d.golden < 0) d.golden = i;
      if (a >= 0 && b < 0 && d.dead < 0) d.dead = i;
    }
    d.rsiMax = d.rsi.indexOf(Math.max.apply(null, d.rsi));
    d.rsiMin = d.rsi.indexOf(Math.min.apply(null, d.rsi));
    d.macdUp = -1;
    for (let i = Math.max(1, d.rsiMin); i < SHOW; i++){
      if (d.macd[i - 1] <= d.sig[i - 1] && d.macd[i] > d.sig[i]){ d.macdUp = i; break; }
    }
    /* 밴드 폭이 가장 좁은 날 (스퀴즈) */
    let w = Infinity; d.squeeze = 0;
    for (let i = 0; i < SHOW; i++){ const bw = (d.bbUp[i] - d.bbLo[i]) / d.bbMid[i]; if (bw < w){ w = bw; d.squeeze = i; } }
    return d;
  }

  /* ---------------- SVG 조각 ---------------- */
  function ln(x1, y1, x2, y2, c, w){ return '<line x1="' + f1(x1) + '" y1="' + f1(y1) + '" x2="' + f1(x2) + '" y2="' + f1(y2) + '" stroke="' + c + '" stroke-width="' + (w || 1) + '"/>'; }
  function tx(x, y, s, cls, anchor){ return '<text x="' + f1(x) + '" y="' + f1(y) + '" class="' + (cls || 'lf-t') + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + esc(s) + '</text>'; }
  function path(vals, x, y){
    let d = '', pen = false;
    for (let i = 0; i < vals.length; i++){
      if (vals[i] == null){ pen = false; continue; }
      d += (pen ? 'L' : 'M') + f1(x(i)) + ' ' + f1(y(vals[i]));
      pen = true;
    }
    return d;
  }
  function dot(x, y, c){ return '<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="4.5" fill="' + c + '" stroke="#fff" stroke-width="2"/>'; }
  function niceRange(arrs, pad){
    let lo = Infinity, hi = -Infinity;
    arrs.forEach(function (a) { a.forEach(function (v) { if (v == null) return; if (v < lo) lo = v; if (v > hi) hi = v; }); });
    const p = (hi - lo) * (pad == null ? 0.08 : pad);
    return [lo - p, hi + p];
  }
  function ticksOf(lo, hi, want){
    const raw = (hi - lo) / want, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag, out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(8));
    return out;
  }
  const live = {};                                    // 마우스 · 터치로 값을 읽기 위한 좌표 정보 (learn.js 가 사용)

  /**
   * 세로로 쌓은 패널형 선 그래프. 패널마다 세로축이 따로 있다 (한 패널에 축을 두 개 쓰지 않는다).
   * o = { n, xl(i), xt[], legend[[색, 이름]], panes[{ h, min, max, ticks, fmt, tag, band, hist, hl[], lines[], marks[] }] }
   */
  function chart(key, w, o){
    const ML = 8, MR = o.mr || 46, GAP = 16, XB = 20, pw = w - ML - MR, n = o.n;
    const x = function (i) { return ML + pw * i / (n - 1); };
    let y0 = 8, body = '';
    const tips = [];
    o.panes.forEach(function (p) {
      const top = y0 + (p.tag ? 16 : 0), ph = p.h;                     // 패널 이름은 그림 위 한 줄에 따로 둔다
      const y = function (v) { return top + ph - (v - p.min) / (p.max - p.min) * ph; };
      p.ticks.forEach(function (t) { body += ln(ML, y(t), ML + pw, y(t), GRID) + tx(ML + pw + 6, y(t) + 3.5, p.fmt(t)); });
      if (p.band){
        let up = '', lo = '';
        for (let i = 0; i < n; i++){
          if (p.band.up[i] == null) continue;
          up += (up ? 'L' : 'M') + f1(x(i)) + ' ' + f1(y(p.band.up[i]));
          lo = 'L' + f1(x(i)) + ' ' + f1(y(p.band.lo[i])) + lo;
        }
        body += '<path d="' + up + lo + 'Z" fill="' + p.band.c + '" fill-opacity=".1"/>';
      }
      if (p.hist){
        const bw = Math.max(1, pw / n - 1.6);
        p.hist.v.forEach(function (v, i) {
          if (v == null) return;
          const ya = y(Math.max(v, 0)), yb = y(Math.min(v, 0));
          body += '<rect x="' + f1(x(i) - bw / 2) + '" y="' + f1(ya) + '" width="' + f1(bw) + '" height="' + f1(Math.max(0.6, yb - ya)) + '" fill="' + (v >= 0 ? UP : DOWN) + '" fill-opacity=".38"/>';
        });
      }
      (p.hl || []).forEach(function (h) {
        body += ln(ML, y(h.v), ML + pw, y(h.v), h.c || FAINT, 1) + tx(ML + 3, y(h.v) + (h.below ? 12 : -4), h.t, 'lf-s');
      });
      p.lines.forEach(function (l) {
        body += '<path d="' + path(l.v, x, y) + '" fill="none" stroke="' + l.c + '" stroke-width="' + (l.w || 2) + '" stroke-linejoin="round" stroke-linecap="round"/>';
      });
      (p.marks || []).forEach(function (m) {
        if (m.i < 0 || m.v == null) return;
        const mx = x(m.i), my = y(m.v), right = m.a ? m.a === 'end' : mx > ML + pw * 0.62;
        body += dot(mx, my, m.c || INK);
        body += tx(mx + (right ? -9 : 9), my + (m.dy == null ? -9 : m.dy), m.t, 'lf-m', right ? 'end' : 'start');
      });
      if (p.tag) body += tx(ML, top - 6, p.tag, 'lf-tag');
      tips.push({ lines:p.lines, fmt:p.tipFmt || p.fmt });
      y0 = top + ph + GAP;
    });
    const axisY = y0 - GAP + 1;
    body += ln(ML, axisY, ML + pw, axisY, '#D1D6DB');
    /* 좁은 화면에서 눈금 글자가 겹치면 건너뛴다 (마지막 눈금은 항상 남긴다) */
    const lastT = o.xt[o.xt.length - 1];
    let prevX = -Infinity;
    o.xt.forEach(function (i) {
      if (i !== lastT && (x(i) - prevX < 30 || x(lastT) - x(i) < 40)) return;
      prevX = x(i);
      body += tx(x(i), axisY + 14, o.xl(i), 'lf-t', i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
    });
    if (o.xTitle) body += tx(ML + pw, axisY + 14 + 13, o.xTitle, 'lf-s', 'end');
    const h = axisY + XB + (o.xTitle ? 12 : 0);
    body += '<line class="lf-cross" x1="0" x2="0" y1="8" y2="' + f1(axisY) + '" stroke="' + INK2 + '" stroke-width="1" visibility="hidden"/>';
    live[key] = { ml:ML, pw:pw, n:n, w:w, xl:o.tipX || o.xl, tips:tips };
    return wrap(key, w, h, body, o.legend, o.alt, true);
  }
  function wrap(key, w, h, body, legend, alt, hover){
    const lg = legend && legend.length ? '<div class="lf-leg">' + legend.map(function (l) {
      return '<span><i style="background:' + l[0] + '"' + (l[2] ? ' class="' + l[2] + '"' : '') + '></i>' + l[1] + '</span>';
    }).join('') + '</div>' : '';
    return lg + '<div class="lf-plot"' + (hover ? ' data-fig="' + key + '"' : '') + '><svg class="lf-svg" viewBox="0 0 ' + w + ' ' + f1(h) +
      '" width="' + w + '" height="' + f1(h) + '" role="img" aria-label="' + esc(alt || '') + '">' + body + '</svg>' +
      (hover ? '<div class="lf-tip" hidden></div>' : '') + '</div>';
  }
  const dayX = function (i) { return (i + 1) + '일'; };
  const DAY_T = [19, 39, 59, 79, 99, 119];

  /* ---------------- 지표 그림 (예시 주가를 실제 계산) ---------------- */
  function pricePane(d, h, extra){
    const all = [d.close].concat((extra.lines || []).map(function (l) { return l.v; }));
    if (extra.band) all.push(extra.band.up, extra.band.lo);
    const r = niceRange(all);
    return Object.assign({ h:h, min:r[0], max:r[1], ticks:ticksOf(r[0], r[1], 4), fmt:won, tag:'주가(원)',
      lines:[{ n:'주가', v:d.close, c:PX, w:1.6 }].concat(extra.lines || []) }, { band:extra.band, marks:extra.marks });
  }
  const FIG = {};

  FIG.ma = function (w) {
    const d = demo();
    return chart('ma', w, { n:SHOW, xl:dayX, xt:DAY_T,
      alt:'예시 주가와 20일 · 60일 이동평균선. 20일선이 60일선을 위로 넘는 골든크로스와 아래로 내려가는 데드크로스가 표시됩니다.',
      legend:[[PX, '주가(종가)', 'thin'], [C1, '20일 이동평균'], [C2, '60일 이동평균']],
      panes:[pricePane(d, 230, {
        lines:[{ n:'20일선', v:d.ma20, c:C1 }, { n:'60일선', v:d.ma60, c:C2 }],
        marks:[{ i:d.dead, v:d.ma20[d.dead], t:'데드크로스', c:INK, dy:-10 }, { i:d.golden, v:d.ma20[d.golden], t:'골든크로스', c:INK, dy:20, a:'start' }]
      })] });
  };
  FIG.bb = function (w) {
    const d = demo();
    return chart('bb', w, { n:SHOW, xl:dayX, xt:DAY_T,
      alt:'예시 주가와 볼린저 밴드(20일, 2 표준편차). 밴드가 좁아진 뒤 주가가 크게 움직입니다.',
      legend:[[PX, '주가(종가)', 'thin'], [C1, '중심선(20일 평균)'], [C3, '상단 · 하단 밴드(±2σ)']],
      panes:[pricePane(d, 230, {
        band:{ up:d.bbUp, lo:d.bbLo, c:C3 },
        lines:[{ n:'상단', v:d.bbUp, c:C3, w:1.4 }, { n:'중심선', v:d.bbMid, c:C1, w:1.6 }, { n:'하단', v:d.bbLo, c:C3, w:1.4 }],
        marks:[{ i:d.squeeze, v:d.bbUp[d.squeeze], t:'스퀴즈 (밴드 폭 최소)', c:INK, dy:-10 }]
      })] });
  };
  FIG.rsi = function (w) {
    const d = demo();
    return chart('rsi', w, { n:SHOW, xl:dayX, xt:DAY_T,
      alt:'위는 예시 주가, 아래는 RSI(14). RSI가 30 아래로 내려간 과매도 구간과 70 위로 올라간 과매수 구간이 표시됩니다.',
      legend:[[PX, '주가(종가)', 'thin'], [C2, 'RSI(14)']],
      panes:[pricePane(d, 150, {}), {
        h:110, min:0, max:100, ticks:[0, 30, 50, 70, 100], fmt:function (v) { return String(Math.round(v)); }, tipFmt:function (v) { return v.toFixed(1); }, tag:'RSI',
        hl:[{ v:70, t:'70 과매수', c:'#F8A29A' }, { v:30, t:'30 과매도', c:'#93B9FB', below:true }],
        lines:[{ n:'RSI', v:d.rsi, c:C2 }],
        marks:[{ i:d.rsiMin, v:d.rsi[d.rsiMin], t:'최저 ' + d.rsi[d.rsiMin].toFixed(0), c:C2, dy:14 }, { i:d.rsiMax, v:d.rsi[d.rsiMax], t:'최고 ' + d.rsi[d.rsiMax].toFixed(0), c:C2, dy:-8 }]
      }] });
  };
  FIG.macd = function (w) {
    const d = demo(), r = niceRange([d.macd, d.sig, d.hist], 0.12);
    return chart('macd', w, { n:SHOW, xl:dayX, xt:DAY_T,
      alt:'위는 예시 주가, 아래는 MACD선 · 시그널선 · 히스토그램. MACD선이 시그널선을 위로 넘는 지점이 표시됩니다.',
      legend:[[PX, '주가(종가)', 'thin'], [C3, 'MACD선(12일 − 26일)'], [C2, '시그널선(9일)'], [UP, '히스토그램 +', 'bar'], [DOWN, '히스토그램 −', 'bar']],
      panes:[pricePane(d, 150, {}), {
        h:120, min:r[0], max:r[1], ticks:ticksOf(r[0], r[1], 3), fmt:won, tag:'MACD',
        hist:{ v:d.hist }, hl:[{ v:0, t:'0선', c:FAINT }],
        lines:[{ n:'MACD', v:d.macd, c:C3 }, { n:'시그널', v:d.sig, c:C2 }],
        marks:[{ i:d.macdUp, v:d.macd[d.macdUp], t:'시그널 상향 돌파', c:INK, dy:16 }]
      }] });
  };

  /* ---------------- 계산 그림 ---------------- */
  /** 연 1회 이자를 주는 채권의 가격 — 현금흐름을 시장금리로 할인한 합 */
  function bondPrice(face, coupon, years, y){
    let p = 0;
    for (let t = 1; t <= years; t++) p += face * coupon / Math.pow(1 + y, t);
    return p + face / Math.pow(1 + y, years);
  }
  FIG.bondprice = function (w) {
    const ys = []; for (let v = 0.5; v <= 7.001; v += 0.25) ys.push(+v.toFixed(2));
    const px = ys.map(function (v) { return bondPrice(10000, 0.03, 10, v / 100); });
    const at = function (v) { return ys.indexOf(v); };
    return chart('bondprice', w, { n:ys.length, xl:function (i) { return ys[i].toFixed(ys[i] % 1 ? 2 : 0) + '%'; }, xt:[at(1), at(2), at(3), at(4), at(5), at(6), at(7)],
      xTitle:'시장금리 (만기수익률)', tipX:function (i) { return '시장금리 ' + ys[i].toFixed(2) + '%'; },
      alt:'표면금리 3%, 만기 10년 채권의 가격. 시장금리가 오를수록 가격이 내려가는 우하향 곡선입니다.',
      panes:[{ h:220, min:7000, max:12600, ticks:[8000, 9000, 10000, 11000, 12000], fmt:won, tag:'채권 가격(원) · 액면 10,000원 · 표면금리 3% · 만기 10년',
        lines:[{ n:'채권 가격', v:px, c:C1 }],
        marks:[{ i:at(2), v:px[at(2)], t:'금리 2% → ' + won(px[at(2)]) + '원', c:C1, dy:-9 },
               { i:at(3), v:px[at(3)], t:'금리 3% → ' + won(px[at(3)]) + '원 (액면가)', c:C1, dy:-9 },
               { i:at(4), v:px[at(4)], t:'금리 4% → ' + won(px[at(4)]) + '원', c:C1, dy:-9 }] }] });
  };
  FIG.compound = function (w) {
    const yrs = []; for (let i = 0; i <= 30; i++) yrs.push(i);
    const comp = yrs.map(function (n) { return 1000 * Math.pow(1.07, n); }), simp = yrs.map(function (n) { return 1000 * (1 + 0.07 * n); });
    const man = function (v) { return won(v) + '만'; };
    return chart('compound', w, { n:31, mr:54, xl:function (i) { return i + '년'; }, xt:[0, 5, 10, 15, 20, 25, 30],
      alt:'1,000만 원을 연 7%로 30년 굴렸을 때 복리와 단리의 차이. 복리는 7,612만 원, 단리는 3,100만 원이 됩니다.',
      legend:[[C1, '복리 (수익을 다시 투자)'], [C2, '단리 (원금에만 수익)']],
      panes:[{ h:220, min:0, max:8200, ticks:[0, 2000, 4000, 6000, 8000], fmt:man, tag:'평가액(원) · 원금 1,000만 원 · 연 7%',
        lines:[{ n:'복리', v:comp, c:C1 }, { n:'단리', v:simp, c:C2 }],
        marks:[{ i:30, v:comp[30], t:man(comp[30]), c:C1, dy:-9 }, { i:30, v:simp[30], t:man(simp[30]), c:C2, dy:-9 },
               { i:10, v:comp[10], t:'10년 ' + man(comp[10]), c:C1, dy:-10, a:'end' }] }] });
  };
  FIG.levetf = function (w) {
    /* 지수가 하루 +5%, 다음 날 −4.76%(제자리)를 30번 되풀이 — 이틀마다 한 점 */
    const idx = [100], lev = [100], dn = 1 / 1.05 - 1;
    for (let k = 1; k <= 30; k++){
      idx.push(idx[k - 1] * 1.05 * (1 + dn));
      lev.push(lev[k - 1] * (1 + 2 * 0.05) * (1 + 2 * dn));
    }
    const p1 = function (v) { return v.toFixed(1); };
    return chart('levetf', w, { n:31, xl:function (i) { return i * 2 + '일'; }, xt:[0, 5, 10, 15, 20, 25, 30],
      alt:'지수가 오르내리다 제자리로 돌아와도 2배 레버리지 ETF는 60거래일 뒤 약 13% 낮아집니다.',
      legend:[[PX, '기초지수 (제자리)'], [C2, '2배 레버리지 ETF']],
      panes:[{ h:200, min:82, max:104, ticks:[85, 90, 95, 100], fmt:function (v) { return String(v); }, tipFmt:p1, tag:'시작 = 100 (지수: +5% → −4.76% 반복)',
        lines:[{ n:'기초지수', v:idx, c:PX }, { n:'2배 ETF', v:lev, c:C2 }],
        marks:[{ i:30, v:idx[30], t:'지수 ' + p1(idx[30]), c:PX, dy:-9 }, { i:30, v:lev[30], t:'2배 ETF ' + p1(lev[30]), c:C2, dy:19 }] }] });
  };
  FIG.yieldcurve = function (w) {
    const mats = ['3개월', '2년', '5년', '10년', '30년'], normal = [2.6, 2.9, 3.2, 3.5, 3.8], inv = [4.6, 4.3, 3.9, 3.7, 3.8];
    const pc = function (v) { return v.toFixed(1) + '%'; };
    return chart('yieldcurve', w, { n:5, xl:function (i) { return mats[i]; }, xt:[0, 1, 2, 3, 4], xTitle:'만기 (숫자는 설명을 위한 예시)',
      alt:'수익률 곡선 예시. 정상 곡선은 만기가 길수록 금리가 높고, 역전 곡선은 단기 금리가 장기 금리보다 높습니다.',
      legend:[[C1, '정상 (우상향) — 장기 금리 > 단기 금리'], [C2, '역전 — 단기 금리 > 장기 금리']],
      panes:[{ h:200, min:2, max:5, ticks:[2, 3, 4, 5], fmt:function (v) { return v + '%'; }, tipFmt:pc, tag:'금리',
        lines:[{ n:'정상', v:normal, c:C1 }, { n:'역전', v:inv, c:C2 }],
        marks:[{ i:1, v:inv[1], t:'2년 ' + pc(inv[1]), c:C2, dy:-10 }, { i:3, v:inv[3], t:'10년 ' + pc(inv[3]), c:C2, dy:-10 },
               { i:1, v:normal[1], t:'2년 ' + pc(normal[1]), c:C1, dy:18 }, { i:3, v:normal[3], t:'10년 ' + pc(normal[3]), c:C1, dy:18 }] }] });
  };
  /** 손실을 메우는 데 필요한 수익률(%) */
  function recoverPct(loss){ return (1 / (1 - loss / 100) - 1) * 100; }
  FIG.recover = function (w) {
    const losses = [10, 20, 30, 40, 50, 60, 70], need = losses.map(recoverPct);
    const ML = 8, MR = 8, top = 26, ph = 170, pw = w - ML - MR, slot = pw / losses.length, bw = Math.min(24, slot * 0.5), max = 250;
    let b = '';
    [0, 100, 200].forEach(function (t) {
      const y = top + ph - t / max * ph;
      b += ln(ML, y, ML + pw, y, t ? GRID : '#D1D6DB') + (t ? tx(ML + 2, y - 4, '+' + t + '%', 'lf-s') : '');
    });
    losses.forEach(function (l, i) {
      const cx = ML + slot * (i + 0.5), hgt = need[i] / max * ph, y = top + ph - hgt, r = Math.min(4, hgt);
      b += '<path d="M' + f1(cx - bw / 2) + ' ' + f1(top + ph) + 'V' + f1(y + r) + 'Q' + f1(cx - bw / 2) + ' ' + f1(y) + ' ' + f1(cx - bw / 2 + r) + ' ' + f1(y) +
        'H' + f1(cx + bw / 2 - r) + 'Q' + f1(cx + bw / 2) + ' ' + f1(y) + ' ' + f1(cx + bw / 2) + ' ' + f1(y + r) + 'V' + f1(top + ph) + 'Z" fill="' + C1 + '">' +
        '<title>' + l + '% 손실 → 원금 회복에 +' + need[i].toFixed(1) + '% 필요</title></path>';
      b += tx(cx, y - 6, '+' + (need[i] >= 100 || slot < 50 ? need[i].toFixed(0) : need[i].toFixed(1)) + '%', 'lf-m', 'middle');   // 좁으면 소수점 생략
      b += tx(cx, top + ph + 15, '−' + l + '%', 'lf-t', 'middle');
    });
    b += tx(ML + pw, top + ph + 30, '손실률', 'lf-s', 'end') + tx(ML + 2, 12, '원금 회복에 필요한 수익률', 'lf-tag');
    return wrap('recover', w, top + ph + 36, b, null, '손실률별로 원금 회복에 필요한 수익률. 10% 손실은 11.1%, 50% 손실은 100%, 70% 손실은 233%가 필요합니다.');
  };

  /* ---------------- 개념 그림 ---------------- */
  FIG.candle = function (w) {
    const h = 250, top = 34, bot = 214;
    const y = function (v) { return bot - (v - 9800) / 900 * (bot - top); };           // 9,800 ~ 10,700원
    const tight = w < 340, bw = tight ? 26 : 34, lead = tight ? 14 : 30;        // 휴대폰 폭에서는 봉과 지시선을 줄여 글자가 잘리지 않게
    function one(cx, o, hi, lo, c, col, name, side, ta){
      const yt = y(Math.max(o, c)), yb = y(Math.min(o, c));
      let s = ln(cx, y(hi), cx, y(lo), col, 2);
      s += '<rect x="' + f1(cx - bw / 2) + '" y="' + f1(yt) + '" width="' + bw + '" height="' + f1(yb - yt) + '" rx="2" fill="' + col + '"/>';
      const lab = function (v, t) {
        const ex = cx + side * (bw / 2 + lead);
        return ln(cx + side * (v === hi || v === lo ? 3 : bw / 2 + 1), y(v), ex, y(v), FAINT) +
          tx(ex + side * 4, y(v) + 4, t + ' ' + won(v), 'lf-m', side > 0 ? 'start' : 'end');
      };
      s += lab(hi, '고가') + lab(lo, '저가') + lab(o, '시가') + lab(c, '종가');
      s += tx(ta === 'middle' ? cx : cx + (ta === 'end' ? 20 : -20), 16, name, 'lf-h', ta);
      return s;
    }
    /* 좁은 화면: 두 봉을 가운데로 모으고 값은 바깥쪽에 적는다 */
    const narrow = w < 470;
    let s = narrow ? one(w * (tight ? 0.4 : 0.37), 10000, 10600, 9900, 10400, UP, '양봉 (종가 > 시가)', -1, 'end')
                   : one(w * 0.25, 10000, 10600, 9900, 10400, UP, '양봉 — 종가가 시가보다 높다', 1, 'middle');
    s += narrow ? one(w * (tight ? 0.6 : 0.63), 10400, 10600, 9900, 10000, DOWN, '음봉 (종가 < 시가)', 1, 'start')
                : one(w * 0.68, 10400, 10600, 9900, 10000, DOWN, '음봉 — 종가가 시가보다 낮다', 1, 'middle');
    s += tx(w / 2, h - 6, '굵은 부분이 몸통(시가~종가), 가는 선이 꼬리(고가 · 저가)', 'lf-s', 'middle');
    return wrap('candle', w, h, s, null, '양봉과 음봉의 구조. 몸통은 시가와 종가 사이, 위아래 꼬리는 고가와 저가를 나타냅니다.');
  };
  FIG.sr = function (w) {
    const pts = [108, 113, 118, 120, 115, 108, 101, 100, 105, 112, 119, 120, 116, 109, 102, 100, 104, 110, 117, 122, 127, 129, 124, 121, 120, 125, 131, 135];
    const ML = 8, MR = 8, top = 16, ph = 190, pw = w - ML - MR, n = pts.length;
    const x = function (i) { return ML + pw * i / (n - 1); }, y = function (v) { return top + ph - (v - 94) / 46 * ph; };
    let s = ln(ML, y(120), ML + pw, y(120), C2, 1.5) + ln(ML, y(100), ML + pw * 0.68, y(100), C1, 1.5);
    s += '<path d="' + path(pts, x, y) + '" fill="none" stroke="' + PX + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    s += tx(ML + 3, y(120) - 6, '저항선 — 두 번 막힘', 'lf-m') + tx(ML + 3, y(100) + 15, '지지선 — 두 번 받침', 'lf-m');
    s += dot(x(19), y(122), INK) + tx(x(19) - 9, y(122) - 9, '돌파', 'lf-m', 'end');
    s += dot(x(24), y(120), INK) + tx(Math.min(x(24) + 56, ML + pw), y(120) + 17, '저항이 지지로 바뀜', 'lf-m', 'end');
    return wrap('sr', w, top + ph + 12, s, [[PX, '주가'], [C2, '저항선'], [C1, '지지선']],
      '주가가 지지선에서 두 번 반등하고 저항선에서 두 번 막힌 뒤, 저항선을 돌파하고 되돌아와 그 선을 지지로 삼는 모습.');
  };

  QT.LearnFigs = {
    KEYS:Object.keys(FIG), live:live, demo:demo, bondPrice:bondPrice, recoverPct:recoverPct,
    has:function (k) { return !!FIG[k]; },
    render:function (k, w) { return FIG[k] ? FIG[k](Math.max(280, Math.min(720, Math.round(w || 640)))) : ''; },
    /** i 번째 점의 값 목록 — { title, rows:[[색, 이름, 값]] } */
    tip:function (k, i) {
      const L = live[k]; if (!L) return null;
      const rows = [];
      L.tips.forEach(function (p) { p.lines.forEach(function (l) { if (l.v[i] != null) rows.push([l.c, l.n, p.fmt(l.v[i])]); }); });
      return { title:L.xl(i), rows:rows };
    }
  };
})(window.QT);

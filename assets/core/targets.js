/* =============================================================
   targets.js — 파동 기반 목표주가 엔진 (보수적 Bear · 기본 Base · 공격적 Bull)

   산정 절차 (항상 일봉 기준 — 기간이 달력 기준이므로)
     1) 후보 레벨 수집
        52주 신고가/신저가 · MA50/MA200 박스 상·하단 · 볼린저 상한선 ·
        피봇 R1/R2(일간 · 주간 5봉 · 월간 21봉) · 전고점/전저점(스윙) ·
        피보나치 되돌림/확장(52주 주파동 + 이후 조정/반등 파동)
     2) 도달 예상 지점 = 현재가 + σ√기간 × (a + b × 추세편향)
        σ: 실현 변동성(60·120봉 혼합), 추세편향: 단기/중기 점수(−1~+1)
     3) 앵커링 — 도달 예상 지점 근처의 가장 유력한 기술적 레벨을 목표가로 채택
        (근처에 레벨이 없으면 변동성 투영값 사용)
     4) 손절가 — 의미 있는 지지선 아래 ATR 버퍼, 없으면 ATR 배수

   목표가 < 현재가 는 뚜렷한 하락 편향일 때 Bear 시나리오에서만 허용합니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const I = QT.Indicators;

  const HORIZON = {
    short: { days:10, label:'1~2주', term:'단기' },
    mid:   { days:42, label:'1~3개월', term:'중장기' }
  };
  /* 시나리오별 도달 배수 k = a + b × 편향 (단위: σ√기간)
     편향 0 → Bear +0.12 · Base +0.5 · Bull +1.1 */
  const REACH = { bear:[0.12, 0.35], base:[0.5, 0.35], bull:[1.1, 0.4] };
  const TOL = 0.45;                                   // 앵커링 허용 거리 (σ√기간 단위)

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function fin(v){ return v != null && isFinite(v); }
  function avg(a){ return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; }
  function sd(a){
    if (a.length < 2) return 0;
    const m = avg(a);
    return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (a.length - 1));
  }
  function median(a){
    if (!a.length) return 0;
    const b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  /* 표준정규 누적분포 (Abramowitz–Stegun 7.1.26) */
  function phi(x){
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return 0.5 * (1 + (x >= 0 ? e : -e));
  }
  /* 기간 내 한 번이라도 도달할 확률 (무추세 랜덤워크 · 반사 원리) */
  function touchProb(dist, em){ return em > 0 ? clamp(2 * (1 - phi(Math.abs(dist) / em)), 0.01, 0.99) : null; }
  function range(bars, from, to){                      // [from, to)
    let h = -Infinity, l = Infinity, hi = -1, li = -1;
    for (let i = Math.max(0, from); i < Math.min(bars.length, to); i++){
      if (bars[i].h > h){ h = bars[i].h; hi = i; }
      if (bars[i].l < l){ l = bars[i].l; li = i; }
    }
    return { h:h, l:l, hi:hi, li:li };
  }
  function pivots(h, l, c){
    const P = (h + l + c) / 3;
    return { P:P, R1:2 * P - l, S1:2 * P - h, R2:P + (h - l), S2:P - (h - l) };
  }
  function pctOf(v, base){ return (v - base) / base * 100; }

  function fmtPrice(v, cur){
    if (!fin(v)) return '—';
    return cur === 'USD' ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원';
  }
  function fmtPct(v){ return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%'; }

  /* 스윙 고점/저점: 좌우 k봉보다 높은(낮은) 봉 */
  function swings(bars, k, lookback){
    const hs = [], ls = [], n = bars.length;
    for (let i = Math.max(k, n - lookback); i < n - k; i++){
      let isH = true, isL = true;
      for (let j = i - k; j <= i + k && (isH || isL); j++){
        if (j === i) continue;
        if (bars[j].h > bars[i].h) isH = false;
        if (bars[j].l < bars[i].l) isL = false;
      }
      if (isH) hs.push({ i:i, v:bars[i].h });
      if (isL) ls.push({ i:i, v:bars[i].l });
    }
    return { highs:hs, lows:ls };
  }

  /* ---------- 파동 구조 (52주 주파동 + 현재 진행 파동) ---------- */
  function waveOf(bars, price){
    const n = bars.length, yr = range(bars, n - 252, n), A = yr.h - yr.l;
    if (!(A > 0)) return null;
    const w = { hi52:yr.h, lo52:yr.l, amp:A, levels:[] };
    function lv(v, label, w8){ if (fin(v) && v > 0) w.levels.push({ v:v, label:label, w:w8 }); }

    if (yr.li < yr.hi){
      /* 저점 → 고점 상승 주파동 */
      w.type = 'up';
      w.from = yr.l; w.to = yr.h;
      const after = range(bars, yr.hi + 1, n);
      w.pull = after.li >= 0 ? after.l : yr.h;           // 고점 이후 조정 저점
      w.depth = (yr.h - price) / A;                       // 주파동 대비 조정 깊이
      [0.236, 0.382, 0.5, 0.618].forEach(function (r) {
        lv(yr.h - A * r, '상승 파동 ' + (r * 100).toFixed(1).replace('.0', '') + '% 되돌림', 0.7);
      });
      const D = yr.h - w.pull;
      if (D > A * 0.08){
        /* 조정 파동의 반등(되돌림) 목표 */
        w.leg = { from:yr.h, to:w.pull };
        [0.382, 0.5, 0.618, 0.786].forEach(function (r) {
          lv(w.pull + D * r, '조정 파동 ' + (r * 100).toFixed(1).replace('.0', '') + '% 반등', 0.75);
        });
      }
      /* 신고가 부근이면 확장 목표: 최근 스윙 저점 → 고점 파동의 1.272 / 1.618 */
      if (price >= yr.h * 0.95){
        const recent = range(bars, n - 60, n);
        const base = recent.l < yr.h ? recent.l : yr.l;
        const amp = yr.h - base;
        if (amp > 0){
          lv(base + amp * 1.272, '파동 1.272 확장', 0.65);
          lv(base + amp * 1.618, '파동 1.618 확장', 0.6);
          w.ext = { from:base, to:yr.h };
        }
      }
    } else {
      /* 고점 → 저점 하락 주파동 */
      w.type = 'down';
      w.from = yr.h; w.to = yr.l;
      const after = range(bars, yr.li + 1, n);
      w.bounce = after.hi >= 0 ? after.h : yr.l;          // 저점 이후 반등 고점
      w.recovered = (price - yr.l) / A;
      [0.236, 0.382, 0.5, 0.618, 0.786].forEach(function (r) {
        lv(yr.l + A * r, '하락 파동 ' + (r * 100).toFixed(1).replace('.0', '') + '% 되돌림', 0.75);
      });
      const U = w.bounce - yr.l;
      if (U > A * 0.08){
        w.leg = { from:yr.l, to:w.bounce };
        [0.382, 0.5, 0.618].forEach(function (r) {
          lv(w.bounce - U * r, '반등 파동 ' + (r * 100).toFixed(1).replace('.0', '') + '% 눌림', 0.6);
        });
      }
    }
    return w;
  }

  /* ---------- 후보 선택 ---------- */
  function near(cands, v, pct){
    return cands.filter(function (c) { return Math.abs(c.v - v) / v * 100 <= pct; });
  }
  /* 합류 레벨 이름 (가중치 높은 순 최대 2개) */
  function basisOf(cands, c){
    const labels = [];
    near(cands, c.v, 0.8).sort(function (a, b) { return b.w - a.w; }).forEach(function (x) {
      if (labels.indexOf(x.label) < 0 && labels.length < 2) labels.push(x.label);
    });
    if (labels.indexOf(c.label) < 0) labels.unshift(c.label);
    return labels.slice(0, 2).join(' · ') + (labels.length > 1 ? ' 합류' : '');
  }
  function choose(cands, R, em, lo, hi){
    let best = null, bs = Infinity;
    cands.forEach(function (c) {
      if (c.v <= lo || c.v >= hi) return;
      const d = Math.abs(c.v - R) / em;
      if (d > TOL) return;
      const s = d - 0.15 * c.w;
      if (s < bs){ bs = s; best = c; }
    });
    return best;
  }

  function scenarioSet(price, em, bias, cands, round, minBase){
    const R = {};
    Object.keys(REACH).forEach(function (k) { R[k] = price + em * (REACH[k][0] + REACH[k][1] * bias); });
    const up = cands.filter(function (c) { return c.v > price; });
    function mk(c, v){
      if (c) return { v:round(c.v), basis:basisOf(cands, c), anchored:true };
      return { v:round(v), basis:'변동성 투영 (σ√기간)', anchored:false };
    }

    /* Base: 현재가 위, 최소 +0.25σ√기간 (중장기는 단기 Base 보다 위) */
    const baseFloor = Math.max(price + em * 0.25, minBase || 0);
    let c = choose(up, Math.max(R.base, baseFloor), em, baseFloor - em * 0.001, price + em * 2.2);
    const base = mk(c, Math.max(R.base, baseFloor));

    /* Bull: Base 보다 0.25σ√기간 이상 위 */
    const bullFloor = base.v + em * 0.25;
    c = choose(up, Math.max(R.bull, bullFloor), em, bullFloor - em * 0.001, price + em * 2.8);
    const bull = mk(c, Math.max(R.bull, bullFloor));

    /* Bear: 뚜렷한 하락 편향(R.bear < 현재가)일 때만 현재가 아래 허용 */
    const bearCeil = base.v - em * 0.2;
    const bearLo = R.bear < price ? price - em * 0.8 : price;
    const bearR = Math.min(R.bear, bearCeil);
    c = choose(cands, bearR, em, bearLo, bearCeil);
    let bear = mk(c, Math.max(bearR, bearLo + em * 0.02));
    if (bear.v >= base.v) bear = mk(null, (price + base.v) / 2);

    [bear, base, bull].forEach(function (s) { s.pct = pctOf(s.v, price); s.prob = touchProb(s.v - price, em); });
    return { bear:bear, base:base, bull:bull, reach:R };
  }

  function stopFrom(sup, price, minD, maxD, buf, round, fallbackD, fallbackLabel){
    const pool = sup.filter(function (s) { const d = price - s.v; return d >= minD && d <= maxD; })
      .sort(function (a, b) { return b.v - a.v; });
    if (pool.length){
      const s = pool[0];
      return { v:round(s.v - buf), level:s.v, basis:basisOf(sup, s) + ' 이탈' };
    }
    return { v:round(price - fallbackD), level:null, basis:fallbackLabel };
  }

  /* 가까운 지지선 2단계 (0.8% 이내 레벨은 하나로 묶음) */
  function keySupports(sup, price, atr, round){
    const pool = sup.filter(function (s) { return price - s.v >= atr * 0.25; })
      .sort(function (a, b) { return b.v - a.v; });
    const out = [];
    for (let i = 0; i < pool.length && out.length < 2; i++){
      const s = pool[i];
      if (out.length && out[out.length - 1].v - s.v < atr * 0.8) continue;
      const v = round(s.v);
      out.push({ v:v, label:basisOf(sup, s), pct:pctOf(v, price) });
    }
    return out;
  }

  /* =============================================================
     build(bars, d, st)
       bars : 일봉, d : Analysis.core(일봉) 결과, st : 종목 정보
     ============================================================= */
  function build(bars, d, st){
    const n = bars.length;
    if (n < 30) return null;
    const cur = st && st.cur, ind = d.ind, price = d.price;
    const tick = QT.Market && QT.Market.TICK_SIZE;
    const round = function (v) { return tick ? tick(v, cur) : v; };
    const fmt = function (v) { return fmtPrice(v, cur); };

    /* ---- 변동성 (이상치에 강한 추정) ----
       60봉 MAD 기반 σ 와 최근 20봉 σ(±3 MAD σ 로 절단)를 절반씩 섞는다.
       급락·급등 하루가 목표가 전체를 부풀리지 않도록 하기 위함 */
    const rets = [];
    for (let i = Math.max(1, n - 60); i < n; i++) if (ind.close[i - 1] > 0) rets.push(Math.log(ind.close[i] / ind.close[i - 1]));
    const sMad = 1.4826 * median(rets.map(function (r) { return Math.abs(r - median(rets)); }));
    const cap = sMad > 0 ? sMad * 3 : Infinity;
    const s20 = sd(rets.slice(-20).map(function (r) { return clamp(r, -cap, cap); }));
    const sigma = clamp(Math.sqrt(0.5 * sMad * sMad + 0.5 * s20 * s20) || (d.atr / price * 0.7), 0.005, 0.05);
    const atr = d.atr;
    const em = { short: price * sigma * Math.sqrt(HORIZON.short.days), mid: price * sigma * Math.sqrt(HORIZON.mid.days) };
    const bias = { short: clamp(d.shortScore / 4.5, -1, 1), mid: clamp(d.midScore / 5, -1, 1) };

    /* ---- 레벨 ---- */
    const prev = bars[n - 2] || bars[n - 1];
    const pd = pivots(prev.h, prev.l, prev.c);
    const wk = range(bars, n - 6, n - 1), pw = pivots(wk.h, wk.l, prev.c);
    const mo = range(bars, n - 22, n - 1), pm = pivots(mo.h, mo.l, prev.c);
    const hi20 = range(bars, n - 20, n), hi60 = range(bars, n - 60, n);
    const wave = waveOf(bars, price);
    const hi52 = wave ? wave.hi52 : hi60.h, lo52 = wave ? wave.lo52 : hi60.l;
    const ma20 = d.ma20, ma50 = d.ma50, ma200 = d.ma200;
    const boxTop = (fin(ma50) && fin(ma200)) ? Math.max(ma50, ma200) : null;
    const boxBot = (fin(ma50) && fin(ma200)) ? Math.min(ma50, ma200) : null;
    const sw = swings(bars, 5, 252);

    const common = [];
    function add(list, v, label, w){ if (fin(v) && v > 0) list.push({ v:v, label:label, w:w }); }
    add(common, hi52, '52주 신고가', 1.0);
    add(common, lo52, '52주 신저가', 0.9);
    add(common, boxTop, 'MA50·200 박스 상단', 0.8);
    add(common, boxBot, 'MA50·200 박스 하단', 0.7);
    add(common, ma20, '20일선', 0.6);
    if (wave) wave.levels.forEach(function (l) { common.push(l); });

    const shortC = common.slice();
    add(shortC, pd.R1, '피봇 R1', 0.45); add(shortC, pd.R2, '피봇 R2', 0.5);
    add(shortC, pd.S1, '피봇 S1', 0.45); add(shortC, pd.S2, '피봇 S2', 0.5);
    add(shortC, pw.R1, '주간 피봇 R1', 0.55); add(shortC, pw.R2, '주간 피봇 R2', 0.6);
    add(shortC, pw.S1, '주간 피봇 S1', 0.55); add(shortC, pw.S2, '주간 피봇 S2', 0.6);
    add(shortC, d.bbUp, '볼린저 상한선', 0.6); add(shortC, d.bbLow, '볼린저 하한선', 0.6);
    add(shortC, hi20.h, '20일 고점', 0.6); add(shortC, hi20.l, '20일 저점', 0.6);
    /* 돌파된 전고점은 지지, 이탈된 전저점은 저항으로 역할이 바뀐다 */
    const hiLabel = function (v) { return v < price ? '전고점(지지 전환)' : '전고점'; };
    const loLabel = function (v) { return v > price ? '전저점(저항 전환)' : '전저점'; };
    sw.highs.filter(function (s) { return s.i >= n - 120; }).forEach(function (s) { add(shortC, s.v, hiLabel(s.v), 0.75); });
    sw.lows.filter(function (s) { return s.i >= n - 120; }).forEach(function (s) { add(shortC, s.v, loLabel(s.v), 0.75); });

    const midC = common.slice();
    add(midC, pm.R1, '월간 피봇 R1', 0.65); add(midC, pm.R2, '월간 피봇 R2', 0.7);
    add(midC, pm.S1, '월간 피봇 S1', 0.65); add(midC, pm.S2, '월간 피봇 S2', 0.7);
    add(midC, pw.R2, '주간 피봇 R2', 0.5); add(midC, pw.S2, '주간 피봇 S2', 0.5);
    add(midC, d.bbUp, '볼린저 상한선', 0.5);
    add(midC, hi60.h, '60일 고점', 0.65); add(midC, hi60.l, '60일 저점', 0.65);
    add(midC, ma50, '50일선', 0.65); add(midC, ma200, '200일선', 0.75);
    sw.highs.forEach(function (s) { add(midC, s.v, hiLabel(s.v), 0.75); });
    sw.lows.forEach(function (s) { add(midC, s.v, loLabel(s.v), 0.75); });

    /* 현재가에 너무 붙은 레벨(±0.25 ATR)은 목표가 아님 */
    function far(list){ return list.filter(function (c) { return Math.abs(c.v - price) >= atr * 0.25; }); }
    const sc = far(shortC), mc = far(midC);

    const short = scenarioSet(price, em.short, bias.short, sc, round);
    const mid = scenarioSet(price, em.mid, bias.mid, mc, round, short.base.v + em.mid * 0.12);
    /* 중장기 Bull 도 단기보다 낮지 않게 */
    ['bull'].forEach(function (k) {
      if (mid[k].v < short[k].v){
        mid[k] = Object.assign({}, short[k]);
        mid[k].pct = pctOf(mid[k].v, price); mid[k].prob = touchProb(mid[k].v - price, em.mid);
      }
    });

    /* ---- 손절가 · 지지선 ---- */
    const supS = sc.filter(function (c) { return c.v < price; });
    const supM = mc.filter(function (c) { return c.v < price; });
    short.stop = stopFrom(supS, price, atr * 0.8, atr * 3.5, atr * 0.3, round, atr * 2, 'ATR 2배 변동성 손절');
    mid.stop = stopFrom(supM, price, Math.max(atr * 1.8, em.mid * 0.3), Math.max(atr * 6, em.mid), atr * 0.5, round,
      Math.max(atr * 3, em.mid * 0.55), 'ATR 3배 변동성 손절');
    if (mid.stop.v > short.stop.v) mid.stop = Object.assign({}, short.stop);
    [short, mid].forEach(function (h) {
      h.stop.pct = pctOf(h.stop.v, price);
      const risk = price - h.stop.v;
      h.rr = risk > 0 ? (h.base.v - price) / risk : null;
    });
    short.em = em.short; mid.em = em.mid;
    short.bias = bias.short; mid.bias = bias.mid;
    short.horizon = HORIZON.short; mid.horizon = HORIZON.mid;
    const supports = keySupports(supS.concat(supM.filter(function (c) { return c.label.indexOf('월간') < 0; })), price, atr, round);

    const t = {
      price:price, cur:cur, sigma:sigma, atr:atr, atrPct:atr / price * 100,
      hi52:hi52, lo52:lo52, boxTop:boxTop, boxBot:boxBot, wave:wave,
      short:short, mid:mid, supports:supports
    };
    t.reasons = explain(t, d, bars, fmt);
    return t;
  }

  /* =============================================================
     산정 근거 문장 — ① 기술적 분석 ② 보조지표 ③ 리스크 · 손절
     ============================================================= */
  function explain(t, d, bars, fmt){
    const ind = d.ind, n = bars.length, price = t.price;
    const tech = [], osc = [], risk = [];

    /* ① 기술적 분석 이유 */
    if (fin(d.ma20)){
      const cross = I.lastCross(ind.close, ind.sma20, 15);
      const gap = pctOf(price, d.ma20);
      const agoTxt = cross ? (cross.ago === 0 ? '오늘' : cross.ago + '봉 전') : '';
      const sb = t.short.base;
      const open = (sb.anchored ? '<b>' + sb.basis + '</b>인 ' : '변동성 기준 기대 도달가인 ') + fmt(sb.v) + '까지 상방이 열려 있습니다.';
      if (price >= d.ma20){
        tech.push({ tone:'bull', html: cross && cross.dir > 0
          ? '주가가 ' + agoTxt + ' <b>20일 이동평균선(' + fmt(d.ma20) + ')을 상향 돌파</b>했으며, ' + open
          : '주가가 20일선(' + fmt(d.ma20) + ') 위 ' + fmtPct(gap) + ' 이격에서 상승 흐름을 유지하고 있어, ' + open });
      } else {
        tech.push({ tone:'bear', html: (cross && cross.dir < 0
          ? '주가가 ' + agoTxt + ' <b>20일선(' + fmt(d.ma20) + ')을 하향 이탈</b>해 단기 추세가 약해졌습니다.'
          : '주가가 20일선(' + fmt(d.ma20) + ') 아래 ' + fmtPct(gap) + '에 머물러 있습니다.') +
          ' 20일선 회복이 1차 관문이며, 회복 시 ' + (t.short.base.anchored ? t.short.base.basis + ' ' : '') + fmt(t.short.base.v) + '까지 반등 여지가 있습니다.' });
      }
    }
    if (fin(t.boxTop)){
      const box = 'MA50·MA200 박스(' + fmt(t.boxBot) + ' ~ ' + fmt(t.boxTop) + ')';
      const alignTxt = d.align === 'up' ? ' 20·50·200일선 정배열로 중기 추세도 우호적입니다.'
        : d.align === 'down' ? ' 다만 이동평균선이 역배열이라 반등 시 저항을 받을 수 있습니다.' : '';
      const lc = d.longCross ? ' (50·200일선 ' + (d.longCross.dir > 0 ? '골든' : '데드') + '크로스 ' + d.longCross.ago + '봉 전)' : '';
      if (price > t.boxTop) tech.push({ tone:'bull', html: box + ' <b>상단 위에 안착</b> — 박스 상단이 중기 지지선 역할을 합니다.' + alignTxt + lc });
      else if (price >= t.boxBot) tech.push({ tone:'neut', html: box + ' 내부에서 등락 중 — <b>박스 상단 ' + fmt(t.boxTop) + ' 돌파</b> 시 중기 상승 추세로 전환됩니다.' + alignTxt + lc });
      else tech.push({ tone:'bear', html: box + ' <b>하단 아래</b> — 박스 하단 ' + fmt(t.boxBot) + ' 회복이 중기 반등의 1차 목표입니다.' + alignTxt + lc });
    }
    const d52 = pctOf(price, t.hi52), u52 = pctOf(price, t.lo52);
    if (price >= t.hi52 * 0.995) tech.push({ tone:'bull', html:'<b>52주 신고가(' + fmt(t.hi52) + ') 경신 구간</b> — 위쪽 매물대가 없어 파동 확장(피보나치 1.272 · 1.618) 레벨을 목표로 적용했습니다.' });
    else if (d52 > -5) tech.push({ tone:'neut', html:'52주 신고가 ' + fmt(t.hi52) + '까지 ' + fmtPct(-d52) + ' 남은 근접 저항 구간 — <b>돌파 시 상방이 추가로 열립니다.</b>' });
    else tech.push({ tone:'neut', html:'52주 신고가 ' + fmt(t.hi52) + ' 대비 ' + fmtPct(d52) + ', 신저가 ' + fmt(t.lo52) + ' 대비 ' + fmtPct(u52) + ' 위치 — 고점까지 ' + fmtPct(-d52) + '의 회복 여력이 남아 있습니다.' });

    const midBasis = '중장기 Base(' + fmt(t.mid.base.v) + ')의 근거는 <b>' + t.mid.base.basis + '</b>, Bull(' + fmt(t.mid.bull.v) + ')의 근거는 <b>' + t.mid.bull.basis + '</b>입니다.';
    const w = t.wave;
    if (w && w.leg){
      const legTxt = w.type === 'up'
        ? '52주 상승 파동(' + fmt(w.from) + ' → ' + fmt(w.to) + ') 이후 조정 파동(' + fmt(w.leg.from) + ' → ' + fmt(w.leg.to) + ')'
        : '52주 하락 파동(' + fmt(w.from) + ' → ' + fmt(w.to) + ') 이후 반등 파동(' + fmt(w.leg.from) + ' → ' + fmt(w.leg.to) + ')';
      tech.push({ tone:'neut', html: legTxt + '을 기준으로 피보나치 레벨을 산출했습니다. ' + midBasis });
    } else {
      tech.push({ tone:'neut', html: midBasis });
    }

    /* ② 보조지표 상태 */
    const rsi = d.rsi;
    if (fin(rsi)){
      const v = rsi.toFixed(0);
      osc.push(rsi > 70 ? { name:'RSI (14)', tag:v + ' · 과매수', tone:'caution', html:'RSI가 ' + v + '로 <b>과매수 구간</b>입니다. 추가 상승보다 단기 숨 고르기 가능성을 열어 두세요.' }
        : rsi >= 55 ? { name:'RSI (14)', tag:v + ' · 강세권', tone:'bull', html:'RSI가 ' + v + '로 과매수(70) 전 강세권 — 상승 탄력이 살아 있고 과열 부담은 크지 않습니다.' }
        : rsi >= 45 ? { name:'RSI (14)', tag:v + ' · 중립', tone:'neut', html:'RSI가 ' + v + '로 과매수 구간이 아니며 중립권 — 방향성 확인이 필요합니다.' }
        : rsi >= 30 ? { name:'RSI (14)', tag:v + ' · 약세권', tone:'neut', html:'RSI가 ' + v + '로 약세권이지만 과매도(30)까지는 여유가 있습니다.' }
        : { name:'RSI (14)', tag:v + ' · 과매도', tone:'bull', html:'RSI가 ' + v + '로 <b>과매도 구간</b> — 기술적 반등 가능성이 높아지는 자리입니다.' });
    }
    if (fin(d.macd) && fin(d.macdSignal)){
      const mc = d.macdCross, hp = ind.macdHist[n - 2];
      const expand = fin(d.macdHist) && fin(hp) ? (Math.abs(d.macdHist) > Math.abs(hp) ? '확대' : '축소') : '';
      const recent = mc && mc.ago <= 10;
      if (d.macd > d.macdSignal){
        osc.push({ name:'MACD', tag: recent ? '골든크로스 ' + (mc.ago === 0 ? '당일' : mc.ago + '봉 전') : '시그널 위', tone:'bull',
          html: recent ? '<b>MACD 골든크로스 발생(' + (mc.ago === 0 ? '당일' : mc.ago + '봉 전') + ')</b>으로 상승 모멘텀이 유효합니다' + (expand ? ' (히스토그램 ' + expand + ' 중).' : '.')
                       : 'MACD가 시그널선 위에서 상승 모멘텀 우위를 유지하고 있습니다' + (expand ? ' (히스토그램 ' + expand + ' 중).' : '.') });
      } else {
        osc.push({ name:'MACD', tag: recent ? '데드크로스 ' + (mc.ago === 0 ? '당일' : mc.ago + '봉 전') : '시그널 아래', tone:'bear',
          html: recent ? '<b>MACD 데드크로스(' + (mc.ago === 0 ? '당일' : mc.ago + '봉 전') + ')</b> — 모멘텀이 약해져 재교차 확인 전까지 보수적 접근이 필요합니다.'
                       : 'MACD가 시그널선 아래로 하락 모멘텀 우위입니다' + (expand === '축소' ? ' — 히스토그램이 줄고 있어 반전 신호를 기다리는 구간입니다.' : '.') });
      }
    }
    const st = ind.stoch[n - 1];
    if (fin(st)){
      osc.push(st > 80 ? { name:'Stochastic', tag:'%K ' + st.toFixed(0) + ' · 과열', tone:'caution', html:'스토캐스틱 %K ' + st.toFixed(0) + ' — 단기 과열권으로 눌림이 나올 수 있습니다.' }
        : st < 20 ? { name:'Stochastic', tag:'%K ' + st.toFixed(0) + ' · 침체', tone:'bull', html:'스토캐스틱 %K ' + st.toFixed(0) + ' — 침체권으로 단기 반등 신호를 기다리는 자리입니다.' }
        : { name:'Stochastic', tag:'%K ' + st.toFixed(0), tone:'neut', html:'스토캐스틱 %K ' + st.toFixed(0) + ' — 과열·침체 없이 중립 구간입니다.' });
    }
    if (fin(d.bbPos)){
      const p = d.bbPos, wd = d.bbWidth;
      const squeeze = fin(wd) && wd < 6 ? ' 밴드폭 ' + wd.toFixed(1) + '%로 수축(스퀴즈) — 곧 변동성 확대가 예상됩니다.' : '';
      osc.push(p > 100 ? { name:'볼린저 %B', tag:p.toFixed(0) + '% · 상단 돌파', tone:'caution', html:'주가가 볼린저 상한선(' + fmt(d.bbUp) + ')을 넘어섰습니다. 강한 추세의 신호이지만 단기 과열에 유의하세요.' + squeeze }
        : p > 80 ? { name:'볼린저 %B', tag:p.toFixed(0) + '% · 상단 근접', tone:'bull', html:'볼린저 상한선(' + fmt(d.bbUp) + ') 근처에서 움직이며 상승 압력이 우세합니다.' + squeeze }
        : p < 0 ? { name:'볼린저 %B', tag:p.toFixed(0) + '% · 하단 이탈', tone:'bull', html:'볼린저 하한선(' + fmt(d.bbLow) + ') 아래로 낙폭 과대 — 밴드 안 복귀 시 반등 신호입니다.' + squeeze }
        : p < 20 ? { name:'볼린저 %B', tag:p.toFixed(0) + '% · 하단 근접', tone:'neut', html:'볼린저 하한선(' + fmt(d.bbLow) + ') 부근으로 지지 여부 확인이 필요합니다.' + squeeze }
        : { name:'볼린저 %B', tag:p.toFixed(0) + '% · 중심권', tone:'neut', html:'볼린저 밴드 중심권에서 등락 중이며 상한선은 ' + fmt(d.bbUp) + '입니다.' + squeeze });
    }
    const v5 = [], v20 = [];
    for (let i = Math.max(0, n - 20); i < n; i++){ if (bars[i].v > 0){ v20.push(bars[i].v); if (i >= n - 5) v5.push(bars[i].v); } }
    if (v5.length && v20.length){
      const vr = (avg(v5) / avg(v20) - 1) * 100;
      const ret5 = n > 6 ? pctOf(price, bars[n - 6].c) : 0;
      osc.push(vr > 25 && ret5 > 0 ? { name:'거래량', tag:'5일 ' + fmtPct(vr), tone:'bull', html:'5일 평균 거래량이 20일 평균보다 ' + fmtPct(vr) + ' 많고 주가도 올라 <b>수급이 개선</b>되고 있습니다.' }
        : vr > 25 ? { name:'거래량', tag:'5일 ' + fmtPct(vr), tone:'bear', html:'하락 구간에서 거래량이 ' + fmtPct(vr) + ' 늘어 매도 압력이 커졌습니다.' }
        : vr < -25 ? { name:'거래량', tag:'5일 ' + fmtPct(vr), tone:'neut', html:'거래량이 20일 평균보다 ' + fmtPct(vr) + ' 적어 추세의 신뢰도가 낮습니다.' }
        : { name:'거래량', tag:'5일 ' + fmtPct(vr), tone:'neut', html:'거래량은 20일 평균 수준(' + fmtPct(vr) + ')입니다.' });
    }

    /* ③ 리스크 */
    const s1 = t.supports[0];
    if ((fin(rsi) && rsi > 70) || (fin(d.bbPos) && d.bbPos > 100))
      risk.push({ tone:'caution', html:'단기 과열 신호 — 추격 매수보다 ' + (s1 ? '1차 지지선 ' + fmt(s1.v) + ' 부근 ' : '') + '눌림목 대기가 유리합니다.' });
    if (t.hi52 > price * 1.005 && t.hi52 < t.short.bull.v)
      risk.push({ tone:'caution', html:'52주 신고가 매물대(' + fmt(t.hi52) + ')가 단기 목표 구간 안에 있습니다. 돌파에 실패하면 Bull 시나리오는 무효입니다.' });
    if (d.align === 'down')
      risk.push({ tone:'caution', html:'이동평균선 역배열 — 반등이 나와도 ' + (fin(t.boxBot) ? fmt(t.boxBot) + ' 부근에서 ' : '') + '저항을 받을 수 있습니다.' });
    if (t.sigma > 0.035)
      risk.push({ tone:'caution', html:'일간 변동성 ' + (t.sigma * 100).toFixed(1) + '%로 높습니다. 비중을 줄이거나 손절폭을 여유 있게 잡으세요.' });
    if (t.short.rr != null && t.short.rr < 1)
      risk.push({ tone:'caution', html:'단기 손익비 1 : ' + t.short.rr.toFixed(2) + ' — 손절폭 대비 기대수익이 작아 신규 진입 매력이 낮습니다.' });

    return { tech:tech, osc:osc, risk:risk };
  }

  QT.Targets = { build:build, HORIZON:HORIZON };
})(window.QT);

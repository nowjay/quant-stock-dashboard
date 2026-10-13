/* =============================================================
   scoring.js — 국면(레짐) 인식 종합 점수

   기존 방식의 문제
     · 이동평균 6개가 같은 정보를 6표로 세어 추세가 과대 반영됨
     · 강한 상승 추세에서도 RSI 70 이상을 무조건 '매도'로 셈

   개선
     · 지표를 추세 · 모멘텀 · 거래량 세 그룹으로 나눠 그룹별 평균(−1~+1)
     · ADX(추세 세기)로 국면을 판단해 가중치를 바꿈
         추세장 : 추세 그룹 비중↑, 과매수/과매도는 '과열 경고' 정도로만
         횡보장 : 오실레이터의 과매수/과매도(되돌림) 신호 비중↑
     · 같은 함수를 과거 모든 봉에 적용할 수 있어 신호 신뢰도 백테스트에 그대로 사용

   시장(종합 지수) 반영
     · 위 지표는 모두 그 종목의 일봉에서 나온다 — 시장 전체가 무너지는 날은 종목 차트만으로 알 수 없다
     · 소속 지수(코스피 · 코스닥 · 나스닥 · S&P 500)가 당일 −2% 이하이거나 3거래일 누적 −3% 이하이면 '시장 급락'으로 보고
       종합 점수를 +54(매수)로 제한한다 — 강력 매수를 내지 않는다
     · 2026-10 측정(tools/verify_ta.js --report ④, 국내 시가총액 상위 200종목 · 약 1년): 강력 매수 다음 날 −5% 이하로 빠진 비율이
       시장 급락 상태 20% · 그 밖 9%. 다만 10일 뒤 수익률은 낮지 않았다 — 하락 예측이 아니라 변동폭 경고이므로
       등급을 매도로 내리지는 않고, 매수 이하 등급은 그대로 둔다. 미국 종목은 표본이 적어 확인하지 못한 채 같은 기준을 쓴다
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function fin(v){ return v != null && isFinite(v); }
  function pct(a, b){ return (a - b) / b * 100; }

  const CATS = { trend:'추세', momentum:'모멘텀', volume:'거래량' };

  /* 시장 급락 기준(%) · 그때의 점수 상한(강력 매수 55 바로 아래) · 지수 일봉이 이보다 오래 비면(달력 일) 판단하지 않음 */
  const MARKET = { day:-2, d3:-3, cap:54, stale:5 };
  function ymd(t){ const d = new Date(t); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
  function dayGap(a, b){
    const ms = function (v) { return Date.UTC(Math.floor(v / 10000), Math.floor(v / 100) % 100 - 1, v % 100); };
    return (ms(b) - ms(a)) / 86400000;
  }
  /**
   * 소속 지수의 상태
   * @param mk   { key, name, h:[[yyyymmdd, 종가], …] 오름차순, r?:실시간 등락률(%), day?:그 시세의 날짜 } — Markets.benchmark()
   * @param day  이 날짜(yyyymmdd)까지의 지수로 판단 (과거 봉 · 미래 데이터 사용 없음)
   * @param now  지수의 가장 최근 값으로 판단 — 화면의 '지금' 의견. 종목 일봉이 하루 이틀 늦어도 시장은 현재 상태를 본다
   * @returns {key, name, day, d1, d3, risk, by:'day'|'d3'|'both'|null} 지수 일봉이 없거나 날짜가 맞지 않으면 null
   */
  function marketAt(mk, day, now){
    const h = mk && mk.h;
    if (!h || h.length < 2) return null;
    let k = h.length - 1;
    if (now){ if (day != null && dayGap(h[k][0], day) > MARKET.stale) return null; }
    else {
      if (day == null || h[0][0] > day) return null;
      let lo = 0;
      while (lo < k){ const m = (lo + k + 1) >> 1; if (h[m][0] <= day) lo = m; else k = m - 1; }
      if (dayGap(h[k][0], day) > MARKET.stale) return null;
    }
    if (k < 1 || !(h[k - 1][1] > 0)) return null;
    /* 스냅샷 일봉이 하루 비어 있어도 당일 등락은 맞도록, 지금 시세에 딸린 등락률이 있으면 그 값을 쓴다 */
    const d1 = now && fin(mk.r) && mk.day === h[k][0] ? mk.r : pct(h[k][1], h[k - 1][1]);
    const d3 = k >= 3 && h[k - 3][1] > 0 ? pct(h[k][1], h[k - 3][1]) : null;
    const byDay = d1 <= MARKET.day, by3 = d3 != null && d3 <= MARKET.d3;
    return { key:mk.key, name:mk.name, day:h[k][0], d1:d1, d3:d3, risk:byDay || by3, by: byDay && by3 ? 'both' : byDay ? 'day' : by3 ? 'd3' : null };
  }

  /** 과매수/과매도 오실레이터: 추세장에서는 방향 확인, 횡보장에서는 되돌림 신호 */
  function osc(v, hi, lo, mid, trendStr, dir){
    const range = v > hi ? -1 : v < lo ? 1 : 0;
    let trend;
    if (dir > 0) trend = v > hi + (100 - hi) * 0.5 ? -0.4 : v >= mid ? 0.6 : v < lo ? -0.2 : -0.3;
    else trend = v < lo * 0.5 ? 0.4 : v <= mid ? -0.6 : v > hi ? 0.2 : 0.3;
    return trendStr * trend + (1 - trendStr) * range;
  }

  /**
   * i 번째 봉 시점의 점수 (미래 데이터 사용 없음)
   * @param opts.open  마지막 봉이 아직 진행 중 — 그 봉의 거래량은 하루(한 주 · 한 달)치가 아니므로
   *                   거래량 그룹은 직전에 끝난 봉까지로 계산한다
   * @param opts.market  소속 지수 일봉 (marketAt 의 mk). 주면 시장 급락 때 점수를 MARKET.cap 으로 제한한다
   * @param opts.now     마지막 봉을 '지금'으로 본다 — 지수는 그 봉의 날짜가 아니라 가장 최근 값으로 판단
   * @returns {score, own, market, capped, regime, adx, trendStr, cats:{trend,momentum,volume}, comps:[{cat,key,name,v,value}]}
   *          own = 시장을 반영하기 전 종목 자체 점수
   */
  function at(bars, ind, i, opts){
    const c = ind.close, p = c[i], comps = [];
    function add(cat, key, name, v, value){ if (fin(v)) comps.push({ cat:cat, key:key, name:name, v:clamp(v, -1, 1), value:value }); }

    const adx = ind.adx[i], pdi = ind.pdi[i], mdi = ind.mdi[i];
    const trendStr = fin(adx) ? clamp((adx - 15) / 20, 0, 1) : 0.3;       // ADX 15 이하 0 → 35 이상 1
    const dir = fin(pdi) && fin(mdi) ? (pdi >= mdi ? 1 : -1) : (fin(ind.sma50[i]) && p >= ind.sma50[i] ? 1 : -1);

    /* ---- 추세 ---- */
    const ma20 = ind.sma20[i], ma50 = ind.sma50[i], ma200 = ind.sma200[i];
    if (fin(ma20)) add('trend', 'ma20', '20일선 대비', pct(p, ma20) / 3, ma20);
    if (fin(ma50)) add('trend', 'ma50', '50일선 대비', pct(p, ma50) / 6, ma50);
    if (fin(ma200)) add('trend', 'ma200', '200일선 대비', pct(p, ma200) / 10, ma200);
    if (fin(ma20) && fin(ma50) && fin(ma200)){
      const al = ma20 > ma50 && ma50 > ma200 ? 1 : ma20 < ma50 && ma50 < ma200 ? -1 : (ma20 > ma50 ? 0.3 : -0.3);
      add('trend', 'align', '이평선 배열', al, al);
    }
    if (fin(ma50) && fin(ind.sma50[i - 20])) add('trend', 'slope', '50일선 기울기', pct(ma50, ind.sma50[i - 20]) / 4, pct(ma50, ind.sma50[i - 20]));
    const m = ind.macd[i], ms = ind.macdSignal[i], h = ind.macdHist[i], hp = ind.macdHist[i - 1];
    if (fin(m) && fin(ms)) add('trend', 'macd', 'MACD', (m > ms ? 0.6 : -0.6) + (fin(h) && fin(hp) ? (h > hp ? 0.4 : -0.4) : 0), m - ms);
    if (fin(adx)) add('trend', 'adx', 'ADX · DMI', dir * trendStr, adx);

    /* ---- 모멘텀 ---- */
    if (fin(ind.rsi[i])) add('momentum', 'rsi', 'RSI (14)', osc(ind.rsi[i], 70, 30, 50, trendStr, dir), ind.rsi[i]);
    if (fin(ind.stoch[i])) add('momentum', 'stoch', 'Stochastic %K', osc(ind.stoch[i], 80, 20, 50, trendStr, dir), ind.stoch[i]);
    if (fin(ind.cci[i])) add('momentum', 'cci', 'CCI (20)', osc((ind.cci[i] + 200) / 4, 75, 25, 50, trendStr, dir), ind.cci[i]);
    if (fin(ind.wr[i])) add('momentum', 'wr', 'Williams %R', osc(ind.wr[i] + 100, 80, 20, 50, trendStr, dir), ind.wr[i]);
    if (fin(ind.mfi[i])) add('momentum', 'mfi', 'MFI (14)', osc(ind.mfi[i], 80, 20, 50, trendStr, dir), ind.mfi[i]);
    if (fin(c[i - 10])) add('momentum', 'mom', '10일 수익률', pct(p, c[i - 10]) / 6, pct(p, c[i - 10]));

    /* ---- 거래량 (거래량 데이터가 있을 때만) ---- */
    const e = opts && opts.open && i === bars.length - 1 ? i - 1 : i;
    let v20 = 0, v5 = 0;
    for (let j = e - 19; j <= e; j++) v20 += ind.vol[j] || 0;
    for (let j = e - 4; j <= e; j++) v5 += ind.vol[j] || 0;
    v20 /= 20; v5 /= 5;
    if (v20 > 0 && e >= 20){
      add('volume', 'obv', 'OBV 추세', (ind.obv[e] - ind.obv[e - 20]) / (v20 * 20) * 2, ind.obv[e] - ind.obv[e - 20]);
      const ratio = v5 / v20, r5 = fin(c[e - 5]) ? pct(c[e], c[e - 5]) : 0;
      add('volume', 'vr', '거래량 동반', ratio > 1.15 ? Math.sign(r5) * Math.min(1, ratio - 1) : 0, ratio);
    }

    const cats = {};
    Object.keys(CATS).forEach(function (k) {
      const xs = comps.filter(function (x) { return x.cat === k; });
      cats[k] = xs.length ? xs.reduce(function (s, x) { return s + x.v; }, 0) / xs.length : null;
    });
    const w = { trend:0.3 + 0.25 * trendStr, momentum:0.45 - 0.2 * trendStr, volume:0.25 };
    let raw = 0, ws = 0;
    Object.keys(w).forEach(function (k) { if (cats[k] != null){ raw += w[k] * cats[k]; ws += w[k]; } });
    const own = ws ? clamp(Math.round(raw / ws * 125), -100, 100) : 0;
    const mkt = opts && opts.market ? marketAt(opts.market, ymd(bars[i].t), !!opts.now && i === bars.length - 1) : null;
    const score = mkt && mkt.risk ? Math.min(own, MARKET.cap) : own;
    return {
      score:score, own:own, market:mkt, capped:score !== own, cats:cats, comps:comps, adx:adx, trendStr:trendStr, dir:dir,
      regime: !fin(adx) ? 'na' : adx >= 25 ? 'trend' : adx < 20 ? 'range' : 'weak',
      weights:w
    };
  }

  function verdictOf(score){
    return score >= 55 ? '강력 매수' : score >= 18 ? '매수' : score > -18 ? '중립' : score > -55 ? '매도' : '강력 매도';
  }
  function classOf(score){ return score >= 55 ? 2 : score >= 18 ? 1 : score > -18 ? 0 : score > -55 ? -1 : -2; }

  QT.Scoring = { at:at, CATS:CATS, MARKET:MARKET, marketAt:marketAt, dayOf:ymd, verdictOf:verdictOf, classOf:classOf };
})(window.QT);

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
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function fin(v){ return v != null && isFinite(v); }
  function pct(a, b){ return (a - b) / b * 100; }

  const CATS = { trend:'추세', momentum:'모멘텀', volume:'거래량' };

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
   * @returns {score, regime, adx, trendStr, cats:{trend,momentum,volume}, comps:[{cat,key,name,v,value}]}
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
    const score = ws ? clamp(Math.round(raw / ws * 125), -100, 100) : 0;
    return {
      score:score, cats:cats, comps:comps, adx:adx, trendStr:trendStr, dir:dir,
      regime: !fin(adx) ? 'na' : adx >= 25 ? 'trend' : adx < 20 ? 'range' : 'weak',
      weights:w
    };
  }

  function verdictOf(score){
    return score >= 55 ? '강력 매수' : score >= 18 ? '매수' : score > -18 ? '중립' : score > -55 ? '매도' : '강력 매도';
  }
  function classOf(score){ return score >= 55 ? 2 : score >= 18 ? 1 : score > -18 ? 0 : score > -55 ? -1 : -2; }

  QT.Scoring = { at:at, CATS:CATS, verdictOf:verdictOf, classOf:classOf };
})(window.QT);

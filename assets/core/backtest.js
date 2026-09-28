/* =============================================================
   backtest.js — 이 종목의 과거 데이터로 신호 · 목표가 신뢰도 검증

   · signals : 과거 각 봉에 오늘과 같은 종합 점수 로직을 적용하고,
               같은 등급(매수/중립/매도…) 신호 뒤 N일 수익률 분포를 집계
   · targets : 과거 시점마다 목표가 엔진을 다시 돌려(그 시점까지의 데이터만 사용)
               기간 내 Base/Bull 목표 도달률과 손절선 선도달률을 집계
   모두 '그 시점에 알 수 있던 정보'만 사용합니다(미래 참조 없음).
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const S = QT.Scoring;

  function stats(rets){
    if (!rets.length) return { n:0, win:null, avg:null, med:null };
    const s = rets.slice().sort(function (a, b) { return a - b; });
    return {
      n:rets.length,
      win:rets.filter(function (r) { return r > 0; }).length / rets.length,
      avg:rets.reduce(function (a, b) { return a + b; }, 0) / rets.length,
      med:s[s.length >> 1]
    };
  }

  /**
   * @param horizon  신호 뒤 수익률을 볼 봉 수 (기본 10 = 약 2주)
   * @returns {horizon, cls, same, base, byClass}
   */
  function signals(bars, ind, horizon){
    const H = horizon || 10, n = bars.length, c = ind.close;
    const start = Math.min(200, Math.max(60, n - 300));
    const by = { '-2':[], '-1':[], '0':[], '1':[], '2':[] }, all = [];
    for (let i = start; i < n - H; i++){
      const r = (c[i + H] - c[i]) / c[i] * 100;
      by[S.classOf(S.at(bars, ind, i).score)].push(r);
      all.push(r);
    }
    const cls = S.classOf(S.at(bars, ind, n - 1).score);
    /* 표본이 적으면 같은 방향(매수 계열/매도 계열)으로 묶어서 본다 */
    let pool = by[cls], label = S.verdictOf([ -70, -30, 0, 30, 70 ][cls + 2]);
    if (pool.length < 15 && cls !== 0){
      pool = cls > 0 ? by['1'].concat(by['2']) : by['-1'].concat(by['-2']);
      label = cls > 0 ? '매수 계열' : '매도 계열';
    }
    const byClass = {};
    Object.keys(by).forEach(function (k) { byClass[k] = stats(by[k]); });
    return { horizon:H, cls:cls, label:label, same:stats(pool), base:stats(all), byClass:byClass, from:bars[start] && bars[start].t };
  }

  /**
   * 목표가 엔진 사후 검증 — step 봉마다 표본 추출
   * @returns {n, base, bull, stopFirst, midN, midBase}  (비율 0~1)
   */
  function targets(bars, st, opts){
    opts = opts || {};
    const n = bars.length, step = opts.step || 5, HS = 10, HM = 42;
    const out = { n:0, base:0, bull:0, stopFirst:0, midN:0, midBase:0 };
    const from = Math.max(260, n - (opts.span || 300));
    for (let i = from; i < n - HS; i += step){
      const slice = bars.slice(0, i + 1);
      const d = QT.Analysis.core(slice, st && st.cur);
      const t = QT.Targets.build(slice, d, st);
      if (!t) continue;
      out.n++;
      let hitBase = -1, hitBull = -1, hitStop = -1;
      for (let j = i + 1; j <= i + HS; j++){
        if (hitBase < 0 && bars[j].h >= t.short.base.v) hitBase = j;
        if (hitBull < 0 && bars[j].h >= t.short.bull.v) hitBull = j;
        if (hitStop < 0 && bars[j].l <= t.short.stop.v) hitStop = j;
      }
      if (hitBase >= 0) out.base++;
      if (hitBull >= 0) out.bull++;
      if (hitStop >= 0 && (hitBase < 0 || hitStop < hitBase)) out.stopFirst++;
      if (i + HM < n){
        out.midN++;
        for (let j = i + 1; j <= i + HM; j++) if (bars[j].h >= t.mid.base.v){ out.midBase++; break; }
      }
    }
    if (out.n){ out.base /= out.n; out.bull /= out.n; out.stopFirst /= out.n; }
    out.midBase = out.midN ? out.midBase / out.midN : null;
    return out;
  }

  QT.Backtest = { signals:signals, targets:targets };
})(window.QT);

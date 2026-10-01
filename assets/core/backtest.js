/* =============================================================
   backtest.js — 이 종목의 과거 데이터로 신호 · 목표가 신뢰도 검증

   · signals : 과거 각 봉에 오늘과 같은 종합 점수 로직을 적용하고,
               같은 등급(매수/중립/매도…) 신호 뒤 N일 수익률 분포를 집계
   · targets : 과거 시점마다 목표가 엔진을 다시 돌려(그 시점까지의 데이터만 사용)
               기간 내 Base/Bull 목표 도달률과 손절선 선도달률을 집계
   모두 '그 시점에 알 수 있던 정보'만 사용합니다(미래 참조 없음).

   신뢰도 판정 (rel)
     매일 표본을 뽑으면 N일 수익률 구간이 서로 겹쳐 같은 움직임을 여러 번 센다 — 신호 60일이 60번의 검증이 아니다.
     그래서 서로 N봉 이상 떨어진 '겹치지 않는 표본 수'(nEff)로 표준오차를 구하고,
     적중률이 기저(아무 날)보다 통계적으로 유의하게(|z| ≥ 1.96) 다를 때만 '잘 맞았다 / 안 맞았다'고 말한다.
     그 밖에는 '우연과 구분되지 않음' — 이전의 '±5%p · 10회 이상' 기준은 이후 구간에서 유지되지 않았다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const S = QT.Scoring;

  const Z_SIG = 1.96, MIN_EFF = 8;

  function stats(rets){
    if (!rets.length) return { n:0, win:null, loss:null, avg:null, med:null };
    const s = rets.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return {
      n:rets.length,
      win:rets.filter(function (r) { return r > 0; }).length / rets.length,
      loss:rets.filter(function (r) { return r < 0; }).length / rets.length,   // 보합(0%)은 상승도 하락도 아님
      avg:rets.reduce(function (a, b) { return a + b; }, 0) / rets.length,
      med:s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    };
  }
  /* 서로 H봉 이상 떨어진 표본 수 (앞에서부터 차례로 고름) */
  function spaced(idx, H){
    let n = 0, last = -Infinity;
    for (let k = 0; k < idx.length; k++) if (idx[k] - last >= H){ n++; last = idx[k]; }
    return n;
  }
  /**
   * 같은 등급 신호가 이 종목에서 방향을 맞혔는지 — 기저(아무 날) 대비 유의성
   * @returns {key:'cls0'|'none'|'few'|'good'|'bad'|'avg', hit, base, diff(%p), z, nEff}
   */
  function reliability(cls, same, base, nEff){
    if (cls === 0) return { key:'cls0', nEff:nEff };
    if (!same.n) return { key:'none', nEff:0 };
    const bear = cls < 0, hit = bear ? same.loss : same.win, p0 = bear ? base.loss : base.win;
    const r = { hit:hit, base:p0, diff:(hit - p0) * 100, nEff:nEff, z:null };
    if (nEff < MIN_EFF){ r.key = 'few'; return r; }
    const se = Math.sqrt(p0 * (1 - p0) / nEff);
    r.z = se > 0 ? (hit - p0) / se : 0;
    r.key = r.z >= Z_SIG ? 'good' : r.z <= -Z_SIG ? 'bad' : 'avg';
    return r;
  }

  /**
   * @param horizon  신호 뒤 수익률을 볼 봉 수 (기본 10 = 약 2주)
   * @param opts.open  마지막 봉이 진행 중 (오늘 등급을 화면과 같은 기준으로 계산)
   * @returns {horizon, cls, label, same, base, byClass, rel, from}
   */
  function signals(bars, ind, horizon, opts){
    const H = horizon || 10, n = bars.length, c = ind.close;
    const start = Math.min(200, Math.max(60, n - 300));
    const by = { '-2':[], '-1':[], '0':[], '1':[], '2':[] }, at = { '-2':[], '-1':[], '0':[], '1':[], '2':[] }, all = [];
    for (let i = start; i < n - H; i++){
      const r = (c[i + H] - c[i]) / c[i] * 100, k = S.classOf(S.at(bars, ind, i).score);
      by[k].push(r); at[k].push(i);
      all.push(r);
    }
    const cls = S.classOf(S.at(bars, ind, n - 1, opts).score);
    /* 표본이 적으면 같은 방향(매수 계열/매도 계열)으로 묶어서 본다 */
    let pool = by[cls], idx = at[cls], label = S.verdictOf([ -70, -30, 0, 30, 70 ][cls + 2]);
    if (pool.length < 15 && cls !== 0){
      pool = cls > 0 ? by['1'].concat(by['2']) : by['-1'].concat(by['-2']);
      idx = (cls > 0 ? at['1'].concat(at['2']) : at['-1'].concat(at['-2'])).sort(function (a, b) { return a - b; });
      label = cls > 0 ? '매수 계열' : '매도 계열';
    }
    const byClass = {};
    Object.keys(by).forEach(function (k) { byClass[k] = stats(by[k]); });
    const same = stats(pool), base = stats(all);
    same.nEff = spaced(idx, H); base.nEff = Math.floor(all.length / H);
    return { horizon:H, cls:cls, label:label, same:same, base:base, byClass:byClass,
             rel:reliability(cls, same, base, same.nEff), from:bars[start] && bars[start].t };
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
      /* 같은 봉에서 목표와 손절이 모두 닿으면 일봉으로는 순서를 알 수 없다 — 보수적으로 손절 먼저로 센다 */
      if (hitStop >= 0 && (hitBase < 0 || hitStop <= hitBase)) out.stopFirst++;
      if (i + HM < n){
        out.midN++;
        for (let j = i + 1; j <= i + HM; j++) if (bars[j].h >= t.mid.base.v){ out.midBase++; break; }
      }
    }
    if (out.n){ out.base /= out.n; out.bull /= out.n; out.stopFirst /= out.n; }
    out.midBase = out.midN ? out.midBase / out.midN : null;
    return out;
  }

  QT.Backtest = { signals:signals, targets:targets, reliability:reliability };
})(window.QT);

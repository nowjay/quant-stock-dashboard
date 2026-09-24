/* =============================================================
   analysis.js — 지표 종합 → 투자 의견 · 지지/저항 · 전망 리포트
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const I = QT.Indicators;

  function hi(bars, n, key){ let m = -Infinity; for (let i = Math.max(0, bars.length - n); i < bars.length; i++) if (bars[i][key] > m) m = bars[i][key]; return m; }
  function lo(bars, n, key){ let m = Infinity; for (let i = Math.max(0, bars.length - n); i < bars.length; i++) if (bars[i][key] < m) m = bars[i][key]; return m; }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function run(bars, st){
    const ind = I.set(bars), n = bars.length;
    const last = bars[n - 1], prev = bars[n - 2] || last, price = last.c;
    const at = function (arr) { return arr[n - 1]; };

    /* ---------- 지표 스코어보드 ---------- */
    const rows = [];
    [['SMA 5', ind.sma5], ['SMA 10', ind.sma10], ['SMA 20', ind.sma20],
     ['SMA 50', ind.sma50], ['SMA 120', ind.sma120], ['EMA 20', ind.ema20]].forEach(function (d) {
      const v = at(d[1]);
      if (v == null){ rows.push({ group:'ma', name:d[0], value:null, signal:0, na:true }); return; }
      const gap = (price - v) / v * 100;
      rows.push({ group:'ma', name:d[0], value:v, signal: gap > 0.15 ? 1 : gap < -0.15 ? -1 : 0 });
    });
    const rsiV = at(ind.rsi), stochV = at(ind.stoch), cciV = at(ind.cci), wrV = at(ind.wr);
    const macdV = at(ind.macd), macdS = at(ind.macdSignal), histV = at(ind.macdHist), histPrev = ind.macdHist[n - 2];
    const mom = price - (ind.close[n - 11] != null ? ind.close[n - 11] : ind.close[0]);
    rows.push({ group:'osc', name:'RSI (14)', value:rsiV, signal: rsiV == null ? 0 : rsiV > 70 ? -1 : rsiV < 30 ? 1 : 0 });
    rows.push({ group:'osc', name:'Stoch %K', value:stochV, signal: stochV == null ? 0 : stochV > 80 ? -1 : stochV < 20 ? 1 : 0 });
    rows.push({ group:'osc', name:'MACD', value:macdV, signal: (macdV == null || macdS == null) ? 0 : macdV > macdS ? 1 : -1 });
    rows.push({ group:'osc', name:'CCI (20)', value:cciV, signal: cciV == null ? 0 : cciV > 100 ? -1 : cciV < -100 ? 1 : 0 });
    rows.push({ group:'osc', name:'Williams %R', value:wrV, signal: wrV == null ? 0 : wrV > -20 ? -1 : wrV < -80 ? 1 : 0 });
    rows.push({ group:'osc', name:'모멘텀 (10)', value:mom, signal: mom > 0 ? 1 : mom < 0 ? -1 : 0 });

    let buy = 0, sell = 0, neutral = 0;
    rows.forEach(function (r) { if (r.na) return; if (r.signal > 0) buy++; else if (r.signal < 0) sell++; else neutral++; });

    const ma20 = at(ind.sma20), ma50 = at(ind.sma50), ma200 = at(ind.sma200);
    let score = Math.round((buy - sell) / (buy + sell + neutral || 1) * 100);
    const align = (ma20 != null && ma50 != null && ma200 != null)
      ? (ma20 > ma50 && ma50 > ma200 ? 'up' : (ma20 < ma50 && ma50 < ma200 ? 'down' : 'mixed')) : 'na';
    if (align === 'up') score += 10; else if (align === 'down') score -= 10;
    if (histV != null && histPrev != null) score += histV > histPrev ? 5 : -5;
    score = clamp(score, -100, 100);

    const verdict = score >= 55 ? '강력 매수' : score >= 18 ? '매수' : score > -18 ? '중립' : score > -55 ? '매도' : '강력 매도';
    const tone = score >= 18 ? 'bull' : score <= -18 ? 'bear' : 'neut';

    /* ---------- 크로스 ---------- */
    const maCross = I.lastCross(ind.sma20, ind.sma50, 60);
    const longCross = I.lastCross(ind.sma50, ind.sma200, 120);
    const macdCross = I.lastCross(ind.macd, ind.macdSignal, 40);

    /* ---------- 볼린저 ---------- */
    const bbU = at(ind.bbUp), bbM = at(ind.bbMid), bbL = at(ind.bbLow);
    const bbPos = (bbU != null && bbL != null && bbU !== bbL) ? (price - bbL) / (bbU - bbL) * 100 : null;
    const bbWidth = (bbU != null && bbM) ? (bbU - bbL) / bbM * 100 : null;

    /* ---------- 피봇 (직전 봉 기준 클래식) ---------- */
    const P = (prev.h + prev.l + prev.c) / 3;
    const pivot = { P:P, R1:2 * P - prev.l, S1:2 * P - prev.h, R2:P + (prev.h - prev.l), S2:P - (prev.h - prev.l) };

    /* ---------- 전망 ---------- */
    const atrV = at(ind.atr) || (price * 0.02);
    const atrPct = atrV / price * 100;
    const hi52 = hi(bars, 252, 'h'), lo52 = lo(bars, 252, 'l');
    const hi20 = hi(bars, 20, 'h'), lo20 = lo(bars, 20, 'l');
    const hi60 = hi(bars, 60, 'h'), lo60 = lo(bars, 60, 'l');

    let shortScore = 0;
    if (rsiV != null) shortScore += rsiV > 70 ? -1.5 : rsiV < 30 ? 1.5 : (rsiV - 50) / 25;
    if (macdV != null && macdS != null) shortScore += macdV > macdS ? 1 : -1;
    if (histV != null && histPrev != null) shortScore += histV > histPrev ? 0.8 : -0.8;
    if (ma20 != null) shortScore += price > ma20 ? 1 : -1;
    if (bbPos != null) shortScore += bbPos > 95 ? -0.8 : bbPos < 5 ? 0.8 : 0;
    const ret5 = ind.close[n - 6] != null ? (price - ind.close[n - 6]) / ind.close[n - 6] * 100 : 0;
    shortScore += clamp(ret5 / 5, -1, 1);

    let midScore = 0;
    if (align === 'up') midScore += 2; else if (align === 'down') midScore -= 2;
    if (longCross) midScore += longCross.dir > 0 ? 1.5 : -1.5;
    if (ma200 != null) midScore += price > ma200 ? 1 : -1;
    const slope = (ma50 != null && ind.sma50[n - 21] != null) ? (ma50 - ind.sma50[n - 21]) / ind.sma50[n - 21] * 100 : 0;
    midScore += clamp(slope / 4, -1.5, 1.5);
    const ret60 = ind.close[n - 61] != null ? (price - ind.close[n - 61]) / ind.close[n - 61] * 100 : 0;
    midScore += clamp(ret60 / 15, -1, 1);

    function dirOf(s){ return s >= 1.2 ? 'up' : s <= -1.2 ? 'down' : 'flat'; }
    const shortDir = dirOf(shortScore), midDir = dirOf(midScore);
    /* 실현 변동성(최근 60봉 일간 수익률 표준편차) 기반 기대 등락폭 */
    const rets = [];
    for (let i = Math.max(1, n - 60); i < n; i++) rets.push((ind.close[i] - ind.close[i-1]) / ind.close[i-1]);
    const mean = rets.reduce(function (s, v) { return s + v; }, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / (rets.length || 1));
    const sigma = sd || (atrV / price * 0.6);
    const bandShort = price * sigma * Math.sqrt(10);             // 약 2주(10영업일)
    const bandMid = price * sigma * Math.sqrt(45);               // 약 2개월

    /* 목표가 · 손절가: 피봇/최근 고저 + ATR 배수 중 더 현실적인 값 */
    const resist = [pivot.R1, pivot.R2, hi20, hi60, hi52].filter(function (v) { return v > price * 1.001; }).sort(function (a, b) { return a - b; });
    const support = [pivot.S1, pivot.S2, lo20, lo60].filter(function (v) { return v < price * 0.999; }).sort(function (a, b) { return b - a; });
    const capUp = price + atrV * 3.2, capDown = price - atrV * 2.6;
    const target1 = resist.length && resist[0] <= capUp ? resist[0] : price + atrV * 1.5;
    const t2pool = resist.filter(function (v) { return v > target1 * 1.002; });
    const target2 = t2pool.length && t2pool[0] <= price + atrV * 6 ? t2pool[0] : price + atrV * 3;
    const stop = support.length && support[0] >= capDown ? support[0] : price - atrV * 1.3;
    const rr = (price - stop) > 0 ? (target1 - price) / (price - stop) : null;

    /* ---------- 문장 ---------- */
    const bandTxt = function (v) { return v; };
    const shortText = (function () {
      const head = shortDir === 'up' ? '단기적으로는 상승 우위 흐름입니다.'
        : shortDir === 'down' ? '단기적으로는 하락 압력이 우세합니다.'
        : '단기적으로는 뚜렷한 방향성 없이 등락하는 흐름입니다.';
      const rsiPart = rsiV == null ? '' :
        rsiV > 70 ? ' RSI가 ' + rsiV.toFixed(0) + '로 과매수 구간이어서 눌림목이 나올 수 있고,'
        : rsiV < 30 ? ' RSI가 ' + rsiV.toFixed(0) + '로 과매도 구간이어서 기술적 반등을 노려볼 수 있으며,'
        : ' RSI ' + rsiV.toFixed(0) + '으로 과열 신호는 없고,';
      const macdPart = (macdV != null && macdS != null)
        ? (macdV > macdS ? ' MACD는 시그널선 위에서 매수 우위를 유지하고 있습니다.' : ' MACD는 시그널선 아래에 머물러 반등 확인이 필요합니다.')
        : '';
      const maPart = ma20 != null ? ' 20일선(' + Math.round(ma20) + ') ' + (price > ma20 ? '위에서 지지받는' : '아래에 놓인') + ' 위치로,' : '';
      return head + maPart + rsiPart + macdPart;
    })();
    const midText = (function () {
      const head = midDir === 'up' ? '중기 추세는 상승 방향으로 정렬돼 있습니다.'
        : midDir === 'down' ? '중기 추세는 아직 하락 국면에 있습니다.'
        : '중기적으로는 추세 전환을 확인하는 횡보 국면입니다.';
      const alignPart = align === 'up' ? ' 20·50·200일선이 정배열을 이루고 있고,'
        : align === 'down' ? ' 이동평균선이 역배열 상태이며,'
        : align === 'mixed' ? ' 이동평균선은 아직 엉켜 있고,' : '';
      const crossPart = longCross ? ' 50일선과 200일선의 ' + (longCross.dir > 0 ? '골든크로스' : '데드크로스') + '가 ' + longCross.ago + '봉 전 발생했습니다.' : ' 장기 이평선 교차는 최근에 없었습니다.';
      const retPart = ' 최근 3개월 수익률은 ' + (ret60 >= 0 ? '+' : '') + ret60.toFixed(1) + '%입니다.';
      return head + alignPart + crossPart + retPart;
    })();

    return {
      ind:ind, price:price, prevClose:prev.c, rows:rows,
      buy:buy, sell:sell, neutral:neutral, score:score, verdict:verdict, tone:tone,
      align:align, maCross:maCross, longCross:longCross, macdCross:macdCross,
      ma20:ma20, ma50:ma50, ma200:ma200,
      rsi:rsiV, macd:macdV, macdSignal:macdS, macdHist:histV,
      bbUp:bbU, bbLow:bbL, bbPos:bbPos, bbWidth:bbWidth,
      pivot:pivot, atr:atrV, atrPct:atrPct,
      hi52:hi52, lo52:lo52, hi20:hi20, lo20:lo20,
      forecast: {
        shortDir:shortDir, midDir:midDir, shortText:shortText, midText:midText,
        shortLow:price - bandShort, shortHigh:price + bandShort,
        midLow:price - bandMid, midHigh:price + bandMid,
        target1:target1, target2:target2, stop:stop, rr:rr,
        target1Pct:(target1 - price) / price * 100,
        target2Pct:(target2 - price) / price * 100,
        stopPct:(stop - price) / price * 100,
        band:bandTxt(bandShort)
      }
    };
  }

  QT.Analysis = { run:run };
})(window.QT);

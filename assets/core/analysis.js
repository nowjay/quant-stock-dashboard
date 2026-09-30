/* =============================================================
   analysis.js — 지표 종합 → 투자 의견 · 지지/저항 · 전망 · 목표주가
     · 종합 의견/지표 리포트 : 화면에서 고른 봉(일·주·월) 기준
     · 전망 · 목표주가       : 기간(1~2주, 1~3개월)이 달력 기준이라 항상 일봉 기준
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const I = QT.Indicators;

  function hi(bars, n, key){ let m = -Infinity; for (let i = Math.max(0, bars.length - n); i < bars.length; i++) if (bars[i][key] > m) m = bars[i][key]; return m; }
  function lo(bars, n, key){ let m = Infinity; for (let i = Math.max(0, bars.length - n); i < bars.length; i++) if (bars[i][key] < m) m = bars[i][key]; return m; }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function money(v, cur){ return cur === 'USD' ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원'; }

  function core(bars, cur){
    const ind = I.set(bars), n = bars.length;
    const last = bars[n - 1], prev = bars[n - 2] || last, price = last.c;
    const at = function (arr) { return arr[n - 1]; };

    /* ---------- 국면 인식 종합 점수 (scoring.js) ---------- */
    const rsiV = at(ind.rsi), macdV = at(ind.macd), macdS = at(ind.macdSignal), histV = at(ind.macdHist), histPrev = ind.macdHist[n - 2];
    const sc = QT.Scoring.at(bars, ind, n - 1);
    const rows = sc.comps;
    let buy = 0, sell = 0, neutral = 0;
    rows.forEach(function (r) { if (r.v > 0.2) buy++; else if (r.v < -0.2) sell++; else neutral++; });

    const ma20 = at(ind.sma20), ma50 = at(ind.sma50), ma200 = at(ind.sma200);
    const align = (ma20 != null && ma50 != null && ma200 != null)
      ? (ma20 > ma50 && ma50 > ma200 ? 'up' : (ma20 < ma50 && ma50 < ma200 ? 'down' : 'mixed')) : 'na';
    const score = sc.score;
    const verdict = QT.Scoring.verdictOf(score);
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

    /* ---------- 방향성 점수 ---------- */
    const atrV = at(ind.atr) || (price * 0.02);
    const atrPct = atrV / price * 100;
    const y52 = n - I.yearStart(bars);
    const hi52 = hi(bars, y52, 'h'), lo52 = lo(bars, y52, 'l');
    const hi20 = hi(bars, 20, 'h'), lo20 = lo(bars, 20, 'l');

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

    /* ---------- 문장 ---------- */
    const shortText = (function () {
      const head = shortDir === 'up' ? '단기적으로는 상승 우위 흐름입니다.'
        : shortDir === 'down' ? '단기적으로는 하락 압력이 우세합니다.'
        : '단기적으로는 뚜렷한 방향성 없이 등락하는 흐름입니다.';
      const maPart = ma20 != null ? ' 20일선(' + money(ma20, cur) + ') ' + (price > ma20 ? '위에서 지지받는' : '아래에 놓인') + ' 위치이고,' : '';
      const rsiPart = rsiV == null ? '' :
        rsiV > 70 ? ' RSI ' + rsiV.toFixed(0) + '로 과매수 구간이라 눌림목이 나올 수 있으며,'
        : rsiV < 30 ? ' RSI ' + rsiV.toFixed(0) + '로 과매도 구간이라 기술적 반등을 노려볼 수 있고,'
        : ' RSI ' + rsiV.toFixed(0) + '로 과열 신호는 없으며,';
      const macdPart = (macdV != null && macdS != null)
        ? (macdV > macdS ? ' MACD는 시그널선 위에서 매수 우위를 유지하고 있습니다.' : ' MACD는 시그널선 아래에 머물러 반등 확인이 필요합니다.')
        : '';
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
      buy:buy, sell:sell, neutral:neutral, score:score, verdict:verdict, tone:tone, scoring:sc,
      adx:sc.adx, regime:sc.regime, cats:sc.cats,
      stoch:at(ind.stoch), mfi:at(ind.mfi), pdi:at(ind.pdi), mdi:at(ind.mdi),
      align:align, maCross:maCross, longCross:longCross, macdCross:macdCross,
      ma20:ma20, ma50:ma50, ma200:ma200,
      rsi:rsiV, macd:macdV, macdSignal:macdS, macdHist:histV,
      bbUp:bbU, bbLow:bbL, bbPos:bbPos, bbWidth:bbWidth,
      pivot:pivot, atr:atrV, atrPct:atrPct,
      hi52:hi52, lo52:lo52, hi20:hi20, lo20:lo20,
      shortScore:shortScore, midScore:midScore, shortDir:shortDir, midDir:midDir,
      shortText:shortText, midText:midText
    };
  }

  /**
   * @param bars  화면 봉 (종합 의견 · 지표 리포트 · 피봇)
   * @param st    종목 정보
   * @param daily 일봉 (전망 · 목표주가). 생략하면 bars 를 일봉으로 간주
   */
  function run(bars, st, daily){
    const cur = st && st.cur;
    const a = core(bars, cur);
    const d = (daily && daily.length && daily !== bars) ? core(daily, cur) : a;
    a.daily = d;                                          // 일봉 기준 분석 (신호 · 체크리스트 · 백테스트)
    a.forecast = { shortDir:d.shortDir, midDir:d.midDir, shortText:d.shortText, midText:d.midText };
    a.events = QT.Patterns ? QT.Patterns.detect(daily || bars, d.ind, 60) : [];
    a.targets = QT.Targets ? QT.Targets.build(daily || bars, d, st) : null;
    return a;
  }

  QT.Analysis = { run:run, core:core };
})(window.QT);

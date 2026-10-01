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

  /**
   * @param opts.open  마지막 봉이 아직 진행 중 (실시간 체결 중인 오늘 봉 · 이번 주/달 봉).
   *                   생략하면 끝난 봉으로 본다 — 과거 시점을 다시 계산하는 백테스트가 이 경우다
   */
  function core(bars, cur, opts){
    const ind = I.set(bars), n = bars.length, open = !!(opts && opts.open);
    const last = bars[n - 1], prev = bars[n - 2] || last, price = last.c;
    const at = function (arr) { return arr[n - 1]; };

    /* ---------- 국면 인식 종합 점수 (scoring.js) ---------- */
    const rsiV = at(ind.rsi), macdV = at(ind.macd), macdS = at(ind.macdSignal), histV = at(ind.macdHist), histPrev = ind.macdHist[n - 2];
    const sc = QT.Scoring.at(bars, ind, n - 1, { open:open });
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

    /* ---------- 피봇 (클래식) ----------
       피봇은 '끝난 봉'의 고가 · 저가 · 종가로 그다음 봉의 지지 · 저항을 만든다.
       마지막 봉이 진행 중이면 그 직전 봉이 기준이고, 이미 끝났으면(종가 데이터) 마지막 봉이 기준이다 —
       끝난 봉에 직전 봉 기준을 쓰면 이미 지나간 날의 선이라, 하락한 날에는 지지선까지 모두 현재가 위에 놓인다 */
    const pb = open ? prev : last;
    const P = (pb.h + pb.l + pb.c) / 3;
    const pivot = { P:P, R1:2 * P - pb.l, S1:2 * P - pb.h, R2:P + (pb.h - pb.l), S2:P - (pb.h - pb.l), t:pb.t, te:pb.te, open:open };

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
      ind:ind, price:price, prevClose:prev.c, rows:rows, open:open,
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

  /* =============================================================
     분석 신뢰도 — 이 일봉으로 계산한 지표 · 의견 · 목표가를 얼마나 믿을 수 있는가 (예측력이 아니라 '입력 데이터'의 품질)
       low  : 실제 차트가 아니거나(시뮬레이션), 거래가 멈췄거나, 봉이 너무 적어 지표가 성립하지 않음
       mid  : 계산은 되지만 일부 지표가 빠지거나 왜곡될 수 있음
       high : 문제 없음
     @param opts.real  실제 일봉인지 (false = 시뮬레이션 경로)
     @returns {level, notes:[{tone:'bad'|'warn', text}], n}
     ============================================================= */
  function quality(bars, opts){
    const n = bars.length, notes = [];
    let level = 'high';
    function note(lv, text){
      notes.push({ tone: lv === 'low' ? 'bad' : 'warn', text:text });
      if (lv === 'low') level = 'low'; else if (level === 'high') level = 'mid';
    }
    if (opts && opts.real === false){
      note('low', '과거 가격 경로가 시뮬레이션입니다 — 지표 · 투자 의견 · 목표가는 실제 차트를 분석한 값이 아닙니다.');
      return { level:level, notes:notes, n:n };
    }
    if (n < 60) note('low', '일봉이 ' + n + '개뿐입니다(신규 상장 등) — 지표가 안정되기 전이라 의견 · 목표가를 믿기 어렵습니다.');
    else if (n < 120) note('mid', '일봉이 ' + n + '개입니다 — 120 · 200일선과 52주 고저가 없어 중장기 판단이 빠져 있습니다.');
    else if (n < 200) note('mid', '일봉이 ' + n + '개라 200일선이 없습니다 — 장기 추세(정배열 · 장기 크로스)는 판단에서 빠집니다.');

    /* 거래가 없는 날: 거래량 0 (거래정지 · 무거래일은 시가 · 고가 · 저가도 종가로 채워져 있다) */
    const w = Math.min(20, n);
    let idle = 0, tail = 0;
    for (let i = n - w; i < n; i++) if (!(bars[i].v > 0)) idle++;
    for (let i = n - 1; i >= 0 && !(bars[i].v > 0); i--) tail++;
    const hasVol = bars.some(function (b) { return b.v > 0; });           // 지수처럼 거래량이 없는 시계열은 제외
    if (hasVol && tail >= 3) note('low', '최근 ' + tail + '거래일 연속 거래가 없습니다(거래정지 추정) — 지표가 멈춰 있어 현재 상태를 반영하지 못합니다.');
    else if (hasVol && idle >= 5) note('low', '최근 ' + w + '거래일 중 ' + idle + '일은 거래가 없었습니다 — 유동성이 부족해 지표 · 캔들 패턴이 성립하지 않습니다.');
    else if (hasVol && idle >= 2) note('mid', '최근 ' + w + '거래일 중 ' + idle + '일은 거래가 없었습니다 — 지표가 왜곡될 수 있습니다.');

    /* 하루 ±30% 를 넘는 변동: 국내 가격제한폭 밖 — 신규 상장 첫날 · 정리매매 · 반영되지 않은 권리락/병합일 수 있다 */
    let jump = 0, jt = null;
    for (let i = Math.max(1, n - 60); i < n; i++){
      const r = bars[i - 1].c > 0 ? bars[i].c / bars[i - 1].c - 1 : 0;
      if (Math.abs(r) > 0.305){ jump++; jt = bars[i].t; }
    }
    if (jump) note('mid', '최근 60거래일 안에 하루 ±30%를 넘는 급변이 ' + jump + '회 있었습니다 — 이동평균 · 변동성 · 목표가가 그 영향을 크게 받습니다.');
    return { level:level, notes:notes, n:n, idle:idle, jumpAt:jt };
  }

  /**
   * @param bars  화면 봉 (종합 의견 · 지표 리포트 · 피봇)
   * @param st    종목 정보
   * @param daily 일봉 (전망 · 목표주가). 생략하면 bars 를 일봉으로 간주
   * @param opts  { open: 화면 봉의 마지막 봉이 진행 중, dailyOpen: 마지막 일봉이 진행 중, real: 실제 일봉 여부 }
   */
  function run(bars, st, daily, opts){
    const cur = st && st.cur, o = opts || {};
    const sameBars = !(daily && daily.length && daily !== bars);
    const a = core(bars, cur, { open:o.open });
    const d = sameBars ? a : core(daily, cur, { open:o.dailyOpen });
    const db = sameBars ? bars : daily;
    a.daily = d;                                          // 일봉 기준 분석 (신호 · 체크리스트 · 백테스트)
    a.forecast = { shortDir:d.shortDir, midDir:d.midDir, shortText:d.shortText, midText:d.midText };
    a.quality = quality(db, { real:o.real });
    /* 믿기 어려운 데이터로는 목표가를 내지 않는다. 가상의 경로에서 나온 크로스 · 돌파도 신호가 아니다 */
    a.events = QT.Patterns && o.real !== false ? QT.Patterns.detect(db, d.ind, 60, { open:d.open }) : [];
    a.targets = QT.Targets && a.quality.level !== 'low' ? QT.Targets.build(db, d, st) : null;
    return a;
  }

  QT.Analysis = { run:run, core:core, quality:quality };
})(window.QT);

/* =============================================================
   signal.js — 종합 매수 신호 (기술 50% + 재무 50%) · 스크리너 평가

   기술 점수 (0~100, 항목당 25점) — 일봉 기준
     · 이동평균선 방향 : 20일선 위 · 20일선 상승 · 20>50일선 · 50>200일선 · 200일선 위 (각 5점)
     · RSI(14)        : 구간 점수 + 5일 전보다 상승하면 가점 (과매도 반등 · 55~70 상승 모멘텀 우대)
     · MACD 시그널    : 시그널선 위 10 · 히스토그램 증가 5 · 0선 위 5 · 최근 10봉 내 골든크로스 5
     · 피봇 저항 돌파 : 전일 기준 피봇 R2 이상 25 · R1 이상 21 · P 이상 14 · S1 이상 7 · 그 아래 2
     · 신호 가감 (−10~+10) : 캔들(연속 봉 · 꼬리 · 장악형 · 장대봉) · 추세추종(이평선 크로스 · 20일 채널 돌파) —
                             종합 의견(scoring.js signals)과 같은 신호. 그쪽은 −100~+100 척도라 여기서는 절반을 더한다
   재무 점수 (0~100) — fundamentals.js (PER · PBR 업종 대비 · ROE · 영업이익 YoY − 재무 위험 감점)
   종합 = 0.5 × 기술 + 0.5 × 재무
     80↑ 강력 매수 · 65~79 매수 · 45~64 중립 · 30~44 매도 · 30 미만 강력 매도
   시장 급락(소속 지수 당일 −2% 이하 · 3거래일 −3% 이하 — scoring.js marketAt) 중에는 기술 · 종합 점수를 각각 79(매수)로 제한한다.
     강력 매수만 거두는 것이라 79점 이하인 점수는 달라지지 않는다. 재무 점수는 매수 시점이 아니라 기업 가치를 보는 값이라 그대로 둔다
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  function fin(v){ return v != null && isFinite(v); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  const MARKET_CAP = 79;                               // 시장 급락 때의 상한 — 강력 매수(80) 바로 아래
  const GRADES = [
    { min:80, key:'sbuy',  label:'강력 매수' },
    { min:65, key:'buy',   label:'매수' },
    { min:45, key:'neut',  label:'중립' },
    { min:30, key:'sell',  label:'매도' },
    { min:-1, key:'ssell', label:'강력 매도' }
  ];
  function grade(score){
    if (!fin(score)) return null;
    for (let i = 0; i < GRADES.length; i++) if (score >= GRADES[i].min) return GRADES[i];
    return GRADES[GRADES.length - 1];
  }

  function crossWithin(a, b, n, from){
    for (let i = from; i > Math.max(0, from - n); i--){
      if (!fin(a[i]) || !fin(b[i]) || !fin(a[i - 1]) || !fin(b[i - 1])) continue;
      if (a[i - 1] <= b[i - 1] && a[i] > b[i]) return { dir:1, ago:from - i };
      if (a[i - 1] >= b[i - 1] && a[i] < b[i]) return { dir:-1, ago:from - i };
    }
    return null;
  }

  /**
   * 일봉 · 지표 세트로 기술 점수 계산
   * @param mkt  소속 지수의 상태 (Scoring.marketAt 결과 · Analysis.core 의 market). 급락이면 점수를 MARKET_CAP 으로 제한
   * @param opts.open  마지막 일봉이 진행 중 — 캔들 · 채널 돌파 신호는 끝난 봉까지만 본다
   * @returns {score, raw, adj, marketCut, market, parts, …}  raw = 항목 합계 + 신호 가감(0~100), marketCut = 시장 급락으로 깎인 점수
   */
  function tech(bars, ind, mkt, opts){
    const n = bars.length;
    if (n < 60 || !ind) return null;
    const i = n - 1, p = bars[i].c, tags = [];
    const tag = function (text, w, tone) { tags.push({ text:text, w:w, tone:tone || 'good' }); };

    /* ① 이동평균선 방향 */
    const ma20 = ind.sma20[i], ma50 = ind.sma50[i], ma200 = ind.sma200[i], ma20p = ind.sma20[i - 5], ma50p = ind.sma50[i - 10];
    const ma = [
      [fin(ma20) && p > ma20, '주가 20일선 위'],
      [fin(ma20) && fin(ma20p) && ma20 > ma20p, '20일선 상승'],
      [fin(ma20) && fin(ma50) && ma20 > ma50, '20일선 > 50일선'],
      fin(ma200) ? [fin(ma50) && ma50 > ma200, '50일선 > 200일선'] : [fin(ma50) && fin(ma50p) && ma50 > ma50p, '50일선 상승'],
      fin(ma200) ? [p > ma200, '주가 200일선 위'] : [fin(ma50) && p > ma50, '주가 50일선 위']
    ];
    const maPts = ma.filter(function (x) { return x[0]; }).length * 5;
    const gc = crossWithin(ind.sma20, ind.sma50, 10, i), lgc = crossWithin(ind.sma50, ind.sma200, 20, i);
    if ((gc && gc.dir > 0) || (lgc && lgc.dir > 0)) tag('#골든크로스발생', 9);
    if ((gc && gc.dir < 0) || (lgc && lgc.dir < 0)) tag('#데드크로스', 7, 'bad');
    if (fin(ma200) && ma20 > ma50 && ma50 > ma200) tag('#정배열', 5);
    const cross20 = fin(ma20) && p > ma20 && bars.slice(-4, -1).some(function (b, k) { const j = i - 3 + k; return fin(ind.sma20[j]) && b.c < ind.sma20[j]; });
    if (cross20) tag('#20일선돌파', 6);

    /* ② RSI */
    const r = ind.rsi[i], r5 = ind.rsi[i - 5];
    let rsiPts = 0, rsiNote = 'RSI 없음';
    if (fin(r)){
      const trendUp = fin(ind.adx[i]) && ind.adx[i] >= 25 && ind.pdi[i] > ind.mdi[i];
      const rising = fin(r5) && r > r5;
      let z;
      if (r < 30) z = 18;
      else if (r < 40) z = fin(r5) && r5 < 30 ? 20 : 12;
      else if (r < 50) z = 12;
      else if (r < 60) z = 16;
      else if (r < 70) z = 20;
      else if (r < 80) z = trendUp ? 17 : 11;
      else z = trendUp ? 10 : 5;
      rsiPts = clamp(z + (rising && r < 80 ? 5 : 0), 0, 25);
      rsiNote = r.toFixed(1) + (r < 30 ? ' 과매도' : r > 70 ? ' 과열' : '') + (fin(r5) ? ' · 5일 전 ' + r5.toFixed(0) + (rising ? ' → 상승' : ' → 하락') : '');
      if (r < 30) tag('#RSI과매도', 8);
      else if (fin(r5) && r5 < 30 && r >= 30) tag('#RSI과매도탈출', 8);
      else if (r > 75) tag('#RSI과열', 4, 'bad');
    }

    /* ③ MACD */
    const m = ind.macd[i], s = ind.macdSignal[i], h = ind.macdHist[i], hp = ind.macdHist[i - 1];
    let macdPts = 0, macdNote = 'MACD 없음';
    if (fin(m) && fin(s)){
      const mc = crossWithin(ind.macd, ind.macdSignal, 10, i);
      macdPts = (m > s ? 10 : 0) + (fin(h) && fin(hp) && h > hp ? 5 : 0) + (m > 0 ? 5 : 0) + (mc && mc.dir > 0 ? 5 : 0);
      macdNote = '시그널선 ' + (m > s ? '위' : '아래') + ' · 히스토그램 ' + (fin(h) && fin(hp) ? (h > hp ? '증가' : '감소') : '—') + ' · 0선 ' + (m > 0 ? '위' : '아래') +
        (mc ? ' · ' + (mc.dir > 0 ? '골든' : '데드') + '크로스 ' + (mc.ago ? mc.ago + '봉 전' : '당일') : '');
      if (mc && mc.dir > 0) tag('#MACD골든크로스', 8);
    }

    /* ④ 피봇 저항선 돌파 (전일 고가 · 저가 · 종가 기준) */
    const pv = bars[i - 1], P = (pv.h + pv.l + pv.c) / 3;
    const piv = { P:P, R1:2 * P - pv.l, S1:2 * P - pv.h, R2:P + (pv.h - pv.l), S2:P - (pv.h - pv.l) };
    const pivPts = p >= piv.R2 ? 25 : p >= piv.R1 ? 21 : p >= piv.P ? 14 : p >= piv.S1 ? 7 : 2;
    const pivNote = p >= piv.R2 ? '2차 저항(R2) 돌파' : p >= piv.R1 ? '1차 저항(R1) 돌파' : p >= piv.P ? '피봇(P) 위 · R1 미돌파' : p >= piv.S1 ? '피봇 아래 · 1차 지지(S1) 위' : '1차 지지(S1) 이탈';
    if (p >= piv.R1) tag('#피봇저항돌파', 7);
    let hi20 = -Infinity;
    for (let k = Math.max(0, i - 20); k < i; k++) if (bars[k].h > hi20) hi20 = bars[k].h;
    if (p > hi20) tag('#20일신고가', 6);

    const parts = [
      { key:'ma', name:'이동평균선 방향', pts:maPts, max:25, note:ma.filter(function (x) { return x[0]; }).map(function (x) { return x[1]; }).join(' · ') || '모든 조건 미충족', checks:ma },
      { key:'rsi', name:'RSI (14)', pts:rsiPts, max:25, note:rsiNote },
      { key:'macd', name:'MACD 시그널', pts:macdPts, max:25, note:macdNote },
      { key:'pivot', name:'피봇 저항선', pts:pivPts, max:25, note:pivNote }
    ];
    /* ⑤ 캔들 · 추세추종 신호 가감 */
    const sg = QT.Scoring.signals(bars, ind, i, opts), half = (sg.candle.pts + sg.follow.pts) / 2;
    const sigs = sg.candle.list.concat(sg.follow.list);
    const adj = { pts:Math.sign(half) * Math.round(Math.abs(half)) || 0, candle:sg.candle, follow:sg.follow,
      note:sigs.map(function (x) { return x.title + (x.ago ? ' ' + x.ago + '봉 전' : ''); }).join(' · ') };
    sg.candle.list.forEach(function (x) {
      if (x.tag && !tags.some(function (t) { return t.text === x.tag; })) tag(x.tag, 6, x.dir > 0 ? 'good' : 'bad');
    });

    const sum = parts.reduce(function (a, x) { return a + x.pts; }, 0), raw = clamp(sum + adj.pts, 0, 100), risk = !!(mkt && mkt.risk);
    adj.pts = raw - sum;                                 // 0~100 을 넘겨 잘린 만큼은 가감에서 뺀다 (항목 합계 + 가감 = raw)
    if (risk) tag('#시장급락', 10, 'bad');
    const score = risk ? Math.min(raw, MARKET_CAP) : raw;
    return { score:score, raw:raw, adj:adj, marketCut:raw - score, market:mkt || null, parts:parts, pivot:piv,
             tags:tags.sort(function (a, b) { return b.w - a.w; }), rsi:r };
  }

  /**
   * 기술 · 재무 결합 — 시장 급락 중에는 종합도 MARKET_CAP 을 넘지 않는다.
   * 종합은 기술 항목 합계(raw)로 계산한 뒤에 제한한다 — 제한된 기술 점수(79)로 합치면 매수 이하 종합 등급까지 따라 내려간다
   * @returns own = 시장을 반영하기 전 종합, capped = 기술 또는 종합이 시장 급락으로 제한됨
   */
  function combine(t, f){
    const ts = t ? t.score : null, fs = f ? f.score : null, both = fin(ts) && fin(fs);
    const own = both ? Math.round(0.5 * t.raw + 0.5 * fs) : null;
    const total = both && t.market && t.market.risk ? Math.min(own, MARKET_CAP) : own;
    return { total:total, own:own, tech:ts, techRaw:t ? t.raw : null, fund:fs, grade:grade(total), techGrade:grade(ts), fundGrade:grade(fs),
             market:t ? t.market : null, capped:!!t && (t.marketCut > 0 || total !== own) };
  }

  /** 신규 위험을 늘릴 수 있는지 평가. 점수와 매매 허용 여부를 함께 표시한다. */
  function entry(st, bars, market, now){
    now = now || Date.now();
    const M = QT.Market, reasons = [], last = bars && bars[bars.length - 1];
    const live = M.liveState && M.liveState(st.code), feed = QT.Feed;
    const realtime = feed && feed.getConfig().provider !== 'static';
    if (!last || !M.isReal(st.code)) reasons.push('실제 일봉 없음');
    else if (now - last.t > 5 * 86400000) reasons.push('일봉이 5일 이상 지연됨');
    if (bars && bars.length && QT.Analysis.quality(bars, { real:M.isReal(st.code), now:now, stock:st.type !== 'index' }).level === 'low') reasons.push('일봉 품질 확인 필요');
    if (live && live.mode === 'mock') reasons.push('모의 시세');
    if (realtime && (!live || now - live.ts > 30000 || live.ts > now + 5000 || now - live.receivedAt > 30000)) reasons.push('종목 시세 수신 확인 필요');
    if (realtime && live && (live.mode !== 'trade' || live.uncertain)) reasons.push('체결·거래량 복구 확인 필요');
    if (feed && realtime && feed.status.mode !== 'live') reasons.push('실시간 연결 확인 필요');
    if (st.type !== 'etf') {
      if (!market || QT.Scoring.dayOf(now - 5 * 86400000) > market.day) reasons.push('시장 지수 확인 필요');
      else {
        if (market.historyGap) reasons.push('시장 지수 이력 공백');
        if (market.risk) reasons.push('시장 급락 중');
        if (market.downtrend) reasons.push('시장 지속 하락 중');
        if (realtime && (!market.timestamp || now - market.timestamp > 120000)) reasons.push('시장 지수가 2분 이상 지연됨');
      }
    }
    return { allowed:reasons.length === 0, reasons:reasons };
  }

  /* ---------------- 스크리너 평가 (종목별 캐시) ---------------- */
  const cache = {};
  function evaluate(code){
    const M = QT.Market, st = M.BY_CODE[code];
    if (!st) return null;
    const q = M.lightQuote(code), price = q && q.price;
    const real = M.isReal(code), open = real && M.barOpen(code, '1D');
    /* 지수는 30초마다 움직이지만 점수를 바꾸는 것은 급락 여부뿐 — 그 여부가 바뀔 때만 다시 계산한다 */
    const mk = QT.Markets && QT.Markets.benchmark ? QT.Markets.benchmark(st) : null;
    const ms = mk ? QT.Scoring.marketAt(mk, null, true) : null;
    let key = code + '|' + (price || 0) + '|' + real + '|' + open + '|' + (QT.Fund ? QT.Fund.meta().updated : '') + '|' + JSON.stringify(ms) + '|' + Math.floor(Date.now() / 10000) + '|' + M.revision(code);
    let d = null;
    if (real){
      d = M.daily(code);
      if (d.length) key += '|' + d.length + '|' + d[d.length - 1].t + '|' + d[d.length - 1].c + '|' + d[d.length - 1].h + '|' + d[d.length - 1].l + '|' + d[d.length - 1].v;
    }
    const c = cache[code];
    if (c && c.key === key) return c.v;

    /* 거래정지 · 무거래 등으로 지표가 성립하지 않는 종목은 기술 점수를 내지 않는다 (추천 목록에서 빠짐) */
    let t = null, tgt = null;
    const ql = real && d && d.length ? QT.Analysis.quality(d, { real:true, now:Date.now(), stock:st.type !== 'index' }) : null;
    if (real && d && d.length >= 60 && ql.level !== 'low'){
      try {
        const confirmed = open ? d.slice(0, -1) : d;
        const core = QT.Analysis.core(confirmed, st.cur, { market:mk });
        t = tech(confirmed, core.ind, ms, { open:false });
        const T = QT.Targets && QT.Targets.build(confirmed, core, st);
        if (T && T.mid && T.mid.base) tgt = { v:T.mid.base.v, pct:T.mid.base.pct };
      } catch (e) { console.warn('[QT] 스크리너 기술 분석 실패', code, e); }
    }
    const f = QT.Fund && price ? QT.Fund.analyze(code, price) : null;
    const v = { code:code, st:st, price:price, rate:q ? q.rate : 0, real:real, tech:t, fund:f, target:tgt, quality:ql, combo:combine(t, f) };
    v.entry = entry(st, d, ms);
    if (ql && ql.level === 'low') { v.entry.allowed = false; v.entry.reasons.push('일봉 품질 확인 필요'); }
    cache[code] = { key:key, v:v };
    return v;
  }
  function invalidate(code){ if (code) delete cache[code]; else Object.keys(cache).forEach(function (k) { delete cache[k]; }); }

  QT.Signal = { tech:tech, combine:combine, grade:grade, GRADES:GRADES, MARKET_CAP:MARKET_CAP, entry:entry, evaluate:evaluate, invalidate:invalidate };
})(window.QT);

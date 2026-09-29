/* =============================================================
   markets.js — 홈 대시보드 시장 데이터
     지수 · 선물 · 환율 · 원자재 · 금리 · 공포/탐욕 · 국장 심리지수 · 지표 예상치

   [데이터 계층]
     1) assets/data/markets.json  수집 스냅샷 (tools/build_markets.py — 1년 일봉 포함)
     2) CNBC 시세 API             CORS 를 허용해 브라우저에서 바로 30초마다 현재가를 덮어씁니다.
                                  실패하면 스냅샷을 그대로 보여 주고 수집 시각을 표기합니다.
     · 코스피200 선물 · 기준금리 · 공포/탐욕 · 심리지수 · 예상치는 스냅샷에서만 옵니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const HOUR = 3600000, DAY = 86400000;
  const QUOTE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol' +
    '?symbols={s}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';
  const CHART_URL = 'https://ts-api.cnbc.com/harmony/app/charts/{r}.json?symbol={s}';
  const POLL_MS = 30000;

  /* 키는 tools/build_markets.py 의 ITEMS 와 같아야 합니다.
     f: idx 지수 · krw 원화 환율 · usd 달러 가격 · yld 금리(%) · rate 기준금리
     dp: 소수 자릿수 · scale: CNBC 값에 곱할 배율 (원/엔은 1엔 기준으로 내려옴) */
  const ITEMS = [
    { k:'KOSPI',  n:'코스피',            g:'kr',   sym:'.KS11',   f:'idx', dp:2 },
    { k:'KOSDAQ', n:'코스닥',            g:'kr',   sym:'.KQ11',   f:'idx', dp:2 },
    { k:'KFUT',   n:'코스피200 선물',     g:'kr',   sym:null,      f:'idx', dp:2, fut:true },
    { k:'IXIC',   n:'나스닥',            g:'us',   sym:'.IXIC',   f:'idx', dp:2 },
    { k:'SPX',    n:'S&P 500',           g:'us',   sym:'.SPX',    f:'idx', dp:2 },
    { k:'DJI',    n:'다우존스',          g:'us',   sym:'.DJI',    f:'idx', dp:2 },
    { k:'NQF',    n:'나스닥100 선물',     g:'us',   sym:'@ND.1',   f:'idx', dp:2, fut:true },
    { k:'ESF',    n:'S&P500 선물',       g:'us',   sym:'@SP.1',   f:'idx', dp:2, fut:true },
    { k:'SOX',    n:'필라델피아 반도체',  g:'us',   sym:'.SOX',    f:'idx', dp:2 },
    { k:'VIX',    n:'VIX 변동성',        g:'us',   sym:'.VIX',    f:'idx', dp:2 },
    { k:'N225',   n:'니케이 225',        g:'asia', sym:'.N225',   f:'idx', dp:2 },
    { k:'SSEC',   n:'상해종합',          g:'asia', sym:'.SSEC',   f:'idx', dp:2 },
    { k:'TWII',   n:'대만 가권',         g:'asia', sym:'.TWII',   f:'idx', dp:2 },
    { k:'USDKRW', n:'원/달러',           g:'fx',   sym:'KRW=',    f:'krw', dp:2, unit:'원' },
    { k:'JPYKRW', n:'원/100엔',          g:'fx',   sym:'JPYKRW=', f:'krw', dp:2, unit:'원', scale:100 },
    { k:'DXY',    n:'달러 인덱스',       g:'fx',   sym:'.DXY',    f:'idx', dp:2 },
    { k:'WTI',    n:'WTI 원유',          g:'cmd',  sym:'@CL.1',   f:'usd', dp:2, unit:'배럴' },
    { k:'GOLD',   n:'국제 금',           g:'cmd',  sym:'@GC.1',   f:'usd', dp:2, unit:'온스' },
    { k:'COPPER', n:'구리',              g:'cmd',  sym:'@HG.1',   f:'usd', dp:3, unit:'파운드' },
    { k:'US10Y',  n:'미국 10년물',       g:'rate', sym:'US10Y',   f:'yld', dp:3 },
    { k:'US2Y',   n:'미국 2년물',        g:'rate', sym:'US2Y',    f:'yld', dp:3 },
    { k:'BOK',    n:'한국 기준금리',     g:'rate', sym:null,      f:'rate', dp:2, policy:true },
    { k:'FED',    n:'미국 기준금리',     g:'rate', sym:null,      f:'rate', dp:2, policy:true }
  ];
  const DEF = {};
  ITEMS.forEach(function (d) { DEF[d.k] = d; });

  /* 지표 설명 (추세 팝업 하단) */
  const DESC = {
    KOSPI:'유가증권시장 전체 시가총액 지수. 삼성전자 · SK하이닉스 비중이 커 반도체 업황에 민감합니다.',
    KOSDAQ:'중소형 성장주 중심 지수. 개인 투자자 비중이 높아 투자 심리가 가장 먼저 반영됩니다.',
    KFUT:'코스피200 최근월물 선물. 야간 거래와 외국인 선물 매매로 현물 지수의 방향을 먼저 보여 줍니다.',
    IXIC:'나스닥 상장 전 종목 지수. 빅테크 · 성장주 흐름의 기준입니다.',
    SPX:'미국 대형주 500개 지수. 글로벌 위험자산 선호의 기준선입니다.',
    DJI:'미국 우량주 30개 가격가중 지수. 경기민감 · 전통 산업 비중이 큽니다.',
    NQF:'나스닥100 선물(CME). 거의 24시간 거래되어 한국 장중 미국 증시 분위기를 가늠할 수 있습니다.',
    ESF:'S&P500 선물(CME). 미국 본장 시작 전 방향을 미리 보여 줍니다.',
    SOX:'필라델피아 반도체 지수. 삼성전자 · SK하이닉스 등 국내 반도체주와 상관관계가 높습니다.',
    VIX:'S&P500 옵션으로 계산한 향후 30일 예상 변동성. 20 이상이면 불안, 30 이상이면 공포 구간으로 봅니다.',
    N225:'일본 대표 225개 종목 지수. 엔화 흐름과 함께 아시아 증시 분위기를 보여 줍니다.',
    SSEC:'상하이 증권거래소 종합지수. 중국 경기 · 정책 기대가 반영됩니다.',
    TWII:'대만 가권지수. TSMC 비중이 커 AI 반도체 수요의 온도계 역할을 합니다.',
    USDKRW:'1달러를 사는 데 필요한 원화. 오르면(원화 약세) 외국인 매도 압력과 수입 물가가 커지고, 수출주에는 우호적입니다.',
    JPYKRW:'100엔당 원화. 엔화가 약하면 일본과 경쟁하는 자동차 · 기계 · 화학 업종에 부담이 됩니다.',
    DXY:'유로 · 엔 등 주요 6개 통화 대비 달러 가치. 달러 강세는 신흥국 증시와 원자재 가격에 부담입니다.',
    WTI:'서부텍사스산 원유 최근월물 선물(달러/배럴). 물가 · 금리 경로와 정유 · 항공 · 화학 업종에 영향을 줍니다.',
    GOLD:'국제 금 선물(달러/온스). 불안 심리 · 달러 약세 · 실질금리 하락 때 강세를 보이는 안전자산입니다.',
    COPPER:'구리 선물(달러/파운드). 산업 전반에 쓰여 경기 선행 지표(닥터 코퍼)로 불립니다.',
    US10Y:'미국 10년 만기 국채 금리. 성장주 밸류에이션 · 주택담보금리 · 글로벌 할인율의 기준입니다.',
    US2Y:'미국 2년 만기 국채 금리. 연준 기준금리 기대를 가장 민감하게 반영합니다. 10년물과의 차이(장단기 금리차)가 음수면 경기 둔화 신호로 봅니다.',
    BOK:'한국은행 기준금리. 금융통화위원회가 연 8회 결정하며 대출 금리 · 원화 가치 · 부동산에 직접 영향을 줍니다.',
    FED:'미국 연방기금금리 목표 범위(상단 기준 차트). FOMC가 연 8회 결정합니다.'
  };

  let SNAP = null;                        // markets.json
  const LIVE = {};                        // 심볼별 CNBC 최신 시세 { p, d, r, t, day, iso }
  const subs = [];
  const status = { mode:'loading', liveAt:null, snapAt:null, error:null };
  let timer = null, fails = 0;

  function on(fn){ subs.push(fn); return api; }
  function emit(kind){ subs.forEach(function (f) { try { f(kind); } catch (e) { console.error(e); } }); }

  /* ---------- 숫자 · 날짜 ---------- */
  function num(s){
    if (s == null) return null;
    const v = parseFloat(String(s).replace(/[,%$]/g, ''));
    return isFinite(v) ? v : null;
  }
  /* 2026-09-29T12:43:40.000+0900 → Date ms (사파리는 +0900 형식을 못 읽음) */
  function parseT(s){
    if (!s) return null;
    s = String(s).replace(/\.\d+/, '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const t = Date.parse(s);
    return isFinite(t) ? t : null;
  }
  function dayOf(s){ const d = String(s || '').replace(/\D/g, '').slice(0, 8); return d.length === 8 ? +d : null; }

  /* ---------- 스냅샷 ---------- */
  function loadSnapshot(){
    return fetch('assets/data/markets.json', { cache:'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        SNAP = j;
        status.snapAt = parseT(j.updated);
        if (QT.Events && QT.Events.supplement){
          const seen = {};
          QT.Events.supplement((j.calendar || []).filter(function (c) {
            if (c.k === 'fomc' || seen[c.k + c.t]) return false;     // FOMC 는 연준 공식 일정이 이미 있음
            return (seen[c.k + c.t] = true);
          }).map(function (c) { return { kind:c.k, t:c.t, status:'확정', source:'ForexFactory' }; }));
        }
        if (status.mode === 'loading') status.mode = 'snapshot';
        emit('snapshot');
        return j;
      })
      .catch(function (e) {
        console.warn('[QT] markets.json', e.message);
        if (status.mode === 'loading'){ status.mode = 'error'; status.error = '시장 데이터를 불러오지 못했습니다.'; emit('status'); }
      });
  }

  /* ---------- CNBC 실시간 ---------- */
  function poll(){
    if (document.hidden){ schedule(POLL_MS); return; }
    const syms = ITEMS.filter(function (d) { return d.sym; }).map(function (d) { return d.sym; });
    const url = QUOTE_URL.replace('{s}', encodeURIComponent(syms.join('|')));
    fetch(url, { cache:'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        const rows = (j && j.FormattedQuoteResult && j.FormattedQuoteResult.FormattedQuote) || [];
        let n = 0;
        rows.forEach(function (q) {
          const last = num(q.last);
          if (q.code !== 0 || last == null) return;
          const prev = num(q.previous_day_closing);
          let chg = num(q.change);
          if (chg == null && prev != null) chg = last - prev;
          const base = chg != null ? last - chg : prev;
          LIVE[q.symbol] = {
            p:last, d:chg, r: chg != null && base ? chg / base * 100 : null,
            t: parseT(q.last_time), day: dayOf(q.last_time), hi52:num(q.yrhiprice), lo52:num(q.yrloprice)
          };
          n++;
        });
        if (!n) throw new Error('시세 없음');
        fails = 0;
        status.mode = 'live'; status.liveAt = Date.now(); status.error = null;
        const fx = get('USDKRW');
        if (fx && fx.live && QT.FX && QT.FX.offer) QT.FX.offer(fx.p, 'CNBC 실시간', fx.t || Date.now());
        emit('live');
        schedule(POLL_MS);
      })
      .catch(function (e) {
        fails++;
        status.mode = SNAP ? 'snapshot' : 'error';
        status.error = '실시간 시세 연결 실패 (' + e.message + ')';
        emit('status');
        schedule(Math.min(POLL_MS * Math.pow(2, fails), 5 * 60000));
      });
  }
  function schedule(ms){ clearTimeout(timer); timer = setTimeout(poll, ms); }

  /* ---------- 항목 조회 (스냅샷 + 실시간 병합) ---------- */
  function policyItem(d){
    const p = SNAP && SNAP.policy && SNAP.policy[d.k];
    if (!p) return null;
    const v = d.k === 'FED' ? p.hi : p.v;
    return {
      def:d, k:d.k, n:d.n, p:v, lo: d.k === 'FED' ? p.lo : null, d:p.chg, r:null,
      date:p.date, t:Date.parse(p.date + 'T00:00:00+09:00'), live:false, src:d.k === 'FED' ? 'federalreserve.gov' : '한국은행',
      h:(p.h || []).map(function (x) { return [dayOf(x[0]), x[1]]; })
    };
  }
  function get(k){
    const d = DEF[k];
    if (!d) return null;
    if (d.policy) return policyItem(d);
    const s = SNAP && SNAP.items && SNAP.items[k];
    const L = d.sym && LIVE[d.sym];
    if (!s && !L) return null;
    const sc = d.scale || 1;
    const h = s && s.h ? s.h.slice() : [];
    const snapDay = s ? dayOf(s.t) || (h.length ? h[h.length - 1][0] : null) : null;
    let out = { def:d, k:k, n:d.n, p:s && s.p, d:s && s.d, r:s && s.r, t:s && parseT(s.t), day:snapDay,
                hi52:s && s.hi52, lo52:s && s.lo52, live:false, src:s && s.src, h:h };
    /* 실시간 값이 스냅샷보다 오래된 날짜가 아니면 덮어쓴다 */
    if (L && (!snapDay || !L.day || L.day >= snapDay)){
      out.p = L.p * sc; out.d = L.d != null ? L.d * sc : null; out.r = L.r;
      out.t = L.t; out.day = L.day || snapDay; out.live = true; out.src = 'cnbc';
      if (L.hi52 != null){ out.hi52 = L.hi52 * sc; out.lo52 = L.lo52 * sc; }
    }
    /* 일봉 끝을 현재가에 맞춘다 (같은 날이면 교체, 다음 날이면 추가) */
    if (out.p != null && h.length && out.day){
      const last = h[h.length - 1];
      if (out.day > last[0]) h.push([out.day, out.p]);
      else if (out.day === last[0]) h[h.length - 1] = [last[0], out.p];
    }
    return out;
  }
  function list(group){
    return ITEMS.filter(function (d) { return !group || d.g === group; })
      .map(function (d) { return get(d.k); }).filter(Boolean);
  }

  /* 추세 팝업용 5년 주봉 — 필요할 때만 CNBC 에서 받는다 */
  const longCache = {};
  function fetchLong(k){
    const d = DEF[k];
    if (!d || !d.sym) return Promise.reject(new Error('장기 차트를 지원하지 않는 지표입니다.'));
    if (longCache[k]) return Promise.resolve(longCache[k]);
    const sc = d.scale || 1;
    return fetch(CHART_URL.replace('{r}', '5Y').replace('{s}', encodeURIComponent(d.sym)))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        const bars = (j && j.barData && j.barData.priceBars) || [];
        const out = bars.map(function (b) { return [dayOf(b.tradeTime), num(b.close) * sc]; })
          .filter(function (x) { return x[0] && x[1] != null && isFinite(x[1]); });
        if (out.length < 20) throw new Error('데이터 없음');
        longCache[k] = out;
        return out;
      });
  }

  /* ---------- 거래 시간 ---------- */
  const FMT = {};
  function zoned(t, tz){
    if (!FMT[tz]) FMT[tz] = new Intl.DateTimeFormat('en-US', { timeZone:tz, hour12:false, weekday:'short', hour:'2-digit', minute:'2-digit', year:'numeric', month:'2-digit', day:'2-digit' });
    const p = {};
    FMT[tz].formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
    return { wd:p.weekday, min:(+p.hour % 24) * 60 + (+p.minute), ymd: p.year + '-' + p.month + '-' + p.day };
  }
  /* kr: 09:00~15:30 KST · us: 프리 04:00 · 본장 09:30~16:00 · 애프터 ~20:00 ET */
  function session(group, t){
    t = t || Date.now();
    if (group === 'kr'){
      const z = zoned(t, 'Asia/Seoul');
      const open = z.wd !== 'Sat' && z.wd !== 'Sun' && (!QT.Events || !QT.Events.krTradingDay || QT.Events.krTradingDay(t));
      if (!open) return { s:'closed', label:'휴장' };
      if (z.min < 540) return { s:'pre', label:'장 시작 전' };
      if (z.min < 930) return { s:'open', label:'장중' };
      return { s:'closed', label:'장 마감' };
    }
    if (group === 'us'){
      const z = zoned(t, 'America/New_York');
      if (z.wd === 'Sat' || z.wd === 'Sun') return { s:'closed', label:'휴장' };
      if (z.min >= 570 && z.min < 960) return { s:'open', label:'장중' };
      if (z.min >= 240 && z.min < 570) return { s:'pre', label:'프리마켓' };
      if (z.min >= 960 && z.min < 1200) return { s:'post', label:'애프터마켓' };
      return { s:'closed', label:'장 마감' };
    }
    return null;
  }

  /* ---------- 지표 예상치 · 직전치 ---------- */
  const FF_LABEL = {
    'CPI y/y':'CPI 전년비', 'Core CPI m/m':'근원 CPI 전월비', 'CPI m/m':'CPI 전월비',
    'PPI m/m':'PPI 전월비', 'Core PPI m/m':'근원 PPI 전월비',
    'Non-Farm Employment Change':'비농업 고용', 'Unemployment Rate':'실업률', 'Average Hourly Earnings m/m':'시간당 임금',
    'Core PCE Price Index m/m':'근원 PCE 전월비', 'Advance GDP q/q':'GDP 속보치(연율)',
    'ISM Manufacturing PMI':'ISM 제조업', 'Federal Funds Rate':'기준금리(상단)'
  };
  const FF_ORDER = ['CPI y/y','Core CPI m/m','CPI m/m','PPI m/m','Core PPI m/m','Non-Farm Employment Change','Unemployment Rate',
                    'Average Hourly Earnings m/m','Core PCE Price Index m/m','Advance GDP q/q','ISM Manufacturing PMI','Federal Funds Rate'];
  function monthLabel(ref){ return ref ? (+ref.slice(5, 7)) + '월분' : ''; }
  function sgn(v, unit){ return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ko-KR') + (unit || ''); }
  function rng(lo, hi){ return lo.toFixed(2) + '~' + hi.toFixed(2) + '%'; }
  /** 일정(e.kind, e.t)의 직전 발표치 · 예상치
      { rows:[{ label, prev, fcst }], src:'ff'|'official', note } 또는 null */
  function consensus(e){
    if (!SNAP || !e) return null;
    const cal = (SNAP.calendar || []).filter(function (c) { return c.k === e.kind && Math.abs(c.t - e.t) < 36 * HOUR; })
      .sort(function (a, b) { return FF_ORDER.indexOf(a.l) - FF_ORDER.indexOf(b.l); });
    const pol = SNAP.policy || {}, ec = SNAP.econ || {};
    if (cal.length){
      const rows = cal.map(function (c) { return { label:FF_LABEL[c.l] || c.l, prev:c.p, fcst:c.f }; });
      if (e.kind === 'fomc' && pol.FED) rows[0].now = '현재 ' + rng(pol.FED.lo, pol.FED.hi);
      return { rows:rows.slice(0, 2), src:'ff' };
    }
    let rows = null, note = '';
    if (e.kind === 'cpi' && ec.cpi){
      rows = [{ label:'CPI 전년비', prev:ec.cpi.v.toFixed(1) + '%' }];
      if (ec.cpi.core != null) rows.push({ label:'근원 CPI 전년비', prev:ec.cpi.core.toFixed(1) + '%' });
      note = monthLabel(ec.cpi.ref) + ' 기준';
    } else if (e.kind === 'ppi' && ec.ppi){
      rows = [{ label:'PPI 전월비', prev:(ec.ppi.v > 0 ? '+' : '') + ec.ppi.v.toFixed(1) + '%' }];
      note = monthLabel(ec.ppi.ref) + ' 기준';
    } else if (e.kind === 'nfp' && ec.nfp){
      rows = [{ label:'비농업 고용', prev:sgn(ec.nfp.v, 'K') }];
      if (ec.nfp.ur != null) rows.push({ label:'실업률', prev:ec.nfp.ur.toFixed(1) + '%' });
      note = monthLabel(ec.nfp.ref) + ' 기준';
    } else if (e.kind === 'kcpi' && ec.kcpi){
      rows = [{ label:'물가 전년비', prev:ec.kcpi.v.toFixed(1) + '%' }];
      note = monthLabel(ec.kcpi.ref) + ' 기준';
    } else if (e.kind === 'fomc' && pol.FED){
      rows = [{ label:'기준금리', prev:rng(pol.FED.lo, pol.FED.hi) }];
      note = '현재 금리';
    } else if (e.kind === 'bok' && pol.BOK){
      rows = [{ label:'기준금리', prev:pol.BOK.v.toFixed(2) + '%' }];
      note = '현재 금리';
    }
    return rows ? { rows:rows, src:'official', note:note } : null;
  }
  /* 실적 발표 EPS 컨센서스 (미국 기업, 발표일 ±3일) */
  function eps(code, t){
    const x = SNAP && SNAP.eps && SNAP.eps[code];
    if (!x) return null;
    if (t && Math.abs(Date.parse(x.date + 'T12:00:00Z') - t) > 3 * DAY) return null;
    return x;
  }

  /* ---------- 공개 API ---------- */
  function init(){
    if (init.done) return api;
    init.done = true;
    loadSnapshot().then(function () { poll(); });
    /* 스냅샷(공포/탐욕 · 금리 · 예상치)은 수집기가 갱신하면 새로 받는다 */
    setInterval(function () { if (!document.hidden) loadSnapshot(); }, 10 * 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && status.liveAt && Date.now() - status.liveAt > POLL_MS) poll();
    });
    return api;
  }

  const api = {
    ITEMS:ITEMS, DEF:DEF, DESC:DESC,
    init:init, on:on, get:get, list:list, fetchLong:fetchLong, session:session,
    consensus:consensus, eps:eps, refresh:poll,
    get status(){ return status; },
    get snap(){ return SNAP; },
    get fng(){ return SNAP && SNAP.fng; },
    get krs(){ return SNAP && SNAP.krs; },
    get breadth(){ return SNAP && SNAP.breadth; },
    get flows(){ return SNAP && SNAP.flows; },
    get policy(){ return SNAP && SNAP.policy; }
  };
  QT.Markets = api;
})(window.QT);

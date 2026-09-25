/* =============================================================
   market-data.js — 종목 마스터 · 시세 · 봉 데이터

   [데이터 계층]
     1) assets/data/symbols.json  국내 전종목(KOSPI/KOSDAQ/ETF) + 미국 S&P500/NASDAQ100 마스터
     2) assets/data/quotes.json   종목별 최근 종가·등락 (수집 시점 기준 실제 값)
     3) assets/data/history.json  대표 종목의 실제 일봉 (네이버 금융 / Yahoo Finance)
     · history 가 없는 종목은 '실제 최근 종가'를 기준점으로 경로만 시뮬레이션하고
       화면에 '시뮬레이션'으로 표기합니다. (가격 수준은 실제와 일치)
     · 분봉은 실시간 체결 연동 전까지 일봉에서 파생한 시뮬레이션입니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  /* ---------- 시드 난수 ---------- */
  function hash32(s){ let h = 2166136261; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r){ let u=0,v=0; while(u===0)u=r(); while(v===0)v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

  /* ---------- 네트워크 없이도 뜨도록 최소 시드 ---------- */
  const SEED = [
    { c:'005930', n:'삼성전자',       m:'KOSPI',  cur:'KRW', p:286500 },
    { c:'000660', n:'SK하이닉스',     m:'KOSPI',  cur:'KRW', p:1863000 },
    { c:'373220', n:'LG에너지솔루션', m:'KOSPI',  cur:'KRW', p:398000 },
    { c:'005380', n:'현대차',         m:'KOSPI',  cur:'KRW', p:243500 },
    { c:'035420', n:'NAVER',          m:'KOSPI',  cur:'KRW', p:172400 },
    { c:'035720', n:'카카오',         m:'KOSPI',  cur:'KRW', p:41250 },
    { c:'068270', n:'셀트리온',       m:'KOSPI',  cur:'KRW', p:184300 },
    { c:'196170', n:'알테오젠',       m:'KOSDAQ', cur:'KRW', p:312000 },
    { c:'AAPL',   n:'Apple Inc.',     m:'NASDAQ100', cur:'USD', p:335.92 },
    { c:'NVDA',   n:'NVIDIA Corp.',   m:'NASDAQ100', cur:'USD', p:178.20 },
    { c:'MSFT',   n:'Microsoft Corp.',m:'NASDAQ100', cur:'USD', p:428.60 },
    { c:'TSLA',   n:'Tesla, Inc.',    m:'NASDAQ100', cur:'USD', p:268.40 }
  ];

  const UNIVERSE = [];
  const BY_CODE = {};
  const QUOTES = {};
  const REAL_BARS = {};
  let META = { symbols:null, quotes:null, history:null, source:'seed' };

  function register(row){
    const st = {
      code: row.c, name: row.n, en: row.e || '', market: row.m,
      sector: row.s || '', type: row.t || 'stock', cur: row.cur || 'KRW'
    };
    st.vol = st.cur === 'USD' ? 0.0185 : (st.market === 'KOSDAQ' ? 0.0265 : st.type === 'etf' ? 0.0105 : 0.0205);
    st.drift = 0.00025;
    UNIVERSE.push(st);
    BY_CODE[st.code] = st;
    return st;
  }

  function base(code){
    const q = QUOTES[code];
    if (q && q.p > 0) return q.p;
    const st = BY_CODE[code];
    return st && st.cur === 'USD' ? 100 : 50000;
  }

  /* ---------- 호가 단위 ---------- */
  function tick(p, cur){
    if (cur === 'USD') return Math.round(p * 100) / 100;
    if (p < 2000) return Math.round(p);
    if (p < 5000) return Math.round(p / 5) * 5;
    if (p < 20000) return Math.round(p / 10) * 10;
    if (p < 50000) return Math.round(p / 50) * 50;
    if (p < 200000) return Math.round(p / 100) * 100;
    if (p < 500000) return Math.round(p / 500) * 500;
    return Math.round(p / 1000) * 1000;
  }

  /* ---------- 시뮬레이션 일봉 (실제 최근 종가에 고정) ---------- */
  const N_DAILY = 520;
  function weekdayStamps(n){
    const out = [], d = new Date(); d.setHours(15, 30, 0, 0);
    while (out.length < n){ const w = d.getDay(); if (w !== 0 && w !== 6) out.push(d.getTime()); d.setDate(d.getDate() - 1); }
    return out.reverse();
  }
  function simulateDaily(st){
    const rnd = mulberry32(hash32(st.code + '|v3')), times = weekdayStamps(N_DAILY), raw = [];
    const target = base(st.code);
    let p = target, trend = 0, regime = 1;
    for (let i = 0; i < N_DAILY; i++){
      if (i % 42 === 0) trend = gauss(rnd) * st.vol * 0.42;
      if (i % 17 === 0) regime = 0.62 + rnd() * 0.95;
      const shock = gauss(rnd) * st.vol * regime;
      const ret = st.drift * 0.75 + trend * 0.35 + shock;
      const o = p * (1 + gauss(rnd) * st.vol * 0.22), c = o * (1 + ret);
      const span = Math.abs(ret) + st.vol * regime * 0.7;
      raw.push({ o:o, c:c, h:Math.max(o, c) * (1 + span * (0.15 + 0.75 * rnd())), l:Math.min(o, c) * (1 - span * (0.15 + 0.75 * rnd())), r:Math.abs(ret), g:regime });
      p = c;
    }
    const k = target / p, q = QUOTES[st.code];
    const vb = (q && q.v) ? q.v : (st.cur === 'USD' ? 20000000 : 1000000);
    return raw.map(function (b, i) {
      const o = tick(b.o * k, st.cur), c = tick(b.c * k, st.cur);
      return {
        t: times[i], o:o, c:c,
        h: Math.max(tick(b.h * k, st.cur), o, c),
        l: Math.min(tick(b.l * k, st.cur), o, c),
        v: Math.round(vb * (0.55 + 0.9 * ((i * 2654435761) % 1000) / 1000) * (1 + b.r / st.vol * 0.55) * b.g)
      };
    });
  }

  /* ---------- 1분봉 (일봉 파생 시뮬레이션) ---------- */
  const M_PER_DAY = 390;
  function buildMinutes(st, daily){
    const days = daily.slice(-5), out = [], rnd = mulberry32(hash32(st.code + '|m1'));
    for (let d = 0; d < days.length; d++){
      const day = days[d], start = new Date(day.t); start.setHours(9, 0, 0, 0);
      const steps = [], rel = []; let acc = 0, cum = 0;
      for (let i = 0; i < M_PER_DAY; i++){ const g = gauss(rnd); steps.push(g); acc += g; }
      for (let i = 0; i < M_PER_DAY; i++){ cum += steps[i]; rel.push(cum - ((i + 1) / M_PER_DAY) * acc); }
      let mx = 0, mn = 0, mxi = 0, mni = 0;
      for (let i = 0; i < M_PER_DAY; i++){ if (rel[i] > mx){ mx = rel[i]; mxi = i; } if (rel[i] < mn){ mn = rel[i]; mni = i; } }
      const amp = (day.h - day.l) * 0.46 / Math.max(mx - mn, 1e-9), path = [];
      for (let i = 0; i < M_PER_DAY; i++){
        const v = day.o + (day.c - day.o) * ((i + 1) / M_PER_DAY) + rel[i] * amp;
        path.push(Math.min(day.h, Math.max(day.l, v)));
      }
      path[M_PER_DAY - 1] = day.c; path[mxi] = day.h; path[mni] = day.l;
      let prev = day.o;
      for (let i = 0; i < M_PER_DAY; i++){
        const o = prev, c = path[i], j = i / (M_PER_DAY - 1), wob = (day.h - day.l) * 0.02 * rnd();
        out.push({
          t: start.getTime() + i * 60000,
          o: tick(o, st.cur), h: tick(Math.min(day.h, Math.max(o, c) + wob), st.cur),
          l: tick(Math.max(day.l, Math.min(o, c) - wob), st.cur), c: tick(c, st.cur),
          v: Math.max(1, Math.round(day.v / M_PER_DAY * (1.65 - 2.2 * j + 2.2 * j * j) * (0.55 + rnd())))
        });
        prev = c;
      }
    }
    return out;
  }

  /* ---------- 집계 ---------- */
  function bucketKey(t, tf){
    const d = new Date(t);
    if (tf === '5m') return Math.floor(t / 300000);
    if (tf === '1W'){ const w = new Date(d); w.setDate(w.getDate() - ((w.getDay() + 6) % 7)); return w.getFullYear() + '-' + w.getMonth() + '-' + w.getDate(); }
    return d.getFullYear() + '-' + d.getMonth();
  }
  function aggregate(bars, tf){
    const out = []; let cur = null, key = null;
    for (let i = 0; i < bars.length; i++){
      const b = bars[i], k = bucketKey(b.t, tf);
      if (k !== key){ if (cur) out.push(cur); cur = { t:b.t, o:b.o, h:b.h, l:b.l, c:b.c, v:b.v }; key = k; }
      else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
    }
    if (cur) out.push(cur);
    return out;
  }

  /* ---------- 캐시 ---------- */
  const DAILY = {}, MIN = {}, DERIVED = {};
  function daily(code){
    if (DAILY[code]) return DAILY[code];
    const st = BY_CODE[code];
    if (!st) return [];
    if (REAL_BARS[code]){
      DAILY[code] = REAL_BARS[code].map(function (r) { return { t:r[0], o:r[1], h:r[2], l:r[3], c:r[4], v:r[5] }; });
    } else {
      DAILY[code] = simulateDaily(st);
    }
    return DAILY[code];
  }
  function minutes(code){ if (!MIN[code]) MIN[code] = buildMinutes(BY_CODE[code], daily(code)); return MIN[code]; }
  function series(code, tf){
    if (tf === '1D') return daily(code);
    if (tf === '1m') return minutes(code);
    const key = code + '|' + tf;
    if (!DERIVED[key]) DERIVED[key] = aggregate(tf === '5m' ? minutes(code) : daily(code), tf);
    return DERIVED[key];
  }
  function dropDerived(code){ ['5m','1W','1M'].forEach(function (tf) { delete DERIVED[code + '|' + tf]; }); }
  function isReal(code){ return !!REAL_BARS[code]; }
  /* 시세가 수집된 종목인지 — 없으면 화면에서 값을 만들어내지 않습니다 */
  function hasData(code){ return !!REAL_BARS[code] || !!(QUOTES[code] && QUOTES[code].p > 0); }

  /* ---------- 실시간 틱 반영 ---------- */
  function applyTick(code, price, volDelta){
    const st = BY_CODE[code]; if (!st) return;
    const d = daily(code); if (!d.length) return;
    const last = d[d.length - 1], p = tick(price, st.cur);
    last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p);
    last.v += Math.max(0, Math.round(volDelta || 0));
    const q = QUOTES[code];
    if (q){ const prev = d[d.length - 2]; q.p = p; if (prev){ q.d = p - prev.c; q.r = (p - prev.c) / prev.c * 100; } }
    const m = MIN[code];
    if (m && m.length){
      const lastM = m[m.length - 1], now = Date.now();
      if (now - lastM.t >= 60000){
        m.push({ t: lastM.t + 60000, o:p, h:p, l:p, c:p, v: Math.max(1, Math.round(volDelta || 0)) });
        if (m.length > M_PER_DAY * 6) m.shift();
      } else {
        lastM.c = p; lastM.h = Math.max(lastM.h, p); lastM.l = Math.min(lastM.l, p);
        lastM.v += Math.max(0, Math.round(volDelta || 0));
      }
    }
    dropDerived(code);
  }

  /* 목록 렌더링용 경량 시세 — 히스토리를 만들지 않고 수집된 종가만 사용 */
  function lightQuote(code){
    if (DAILY[code]) return snapshot(code);
    const st = BY_CODE[code], q = QUOTES[code];
    if (!st) return null;
    if (!q) return { st:st, code:code, price:null, diff:0, rate:0, volume:0, spark:null, real:isReal(code) };
    return { st:st, code:code, price:q.p, prevClose:q.p - (q.d || 0), diff:q.d || 0, rate:q.r || 0,
             volume:q.v || 0, spark:null, real:isReal(code) };
  }

  function snapshot(code){
    const st = BY_CODE[code], d = daily(code);
    if (!st || !d.length) return null;
    const last = d[d.length - 1], prev = d[d.length - 2] || last;
    return {
      st:st, code:code, price:last.c, prevClose:prev.c,
      diff:last.c - prev.c, rate: prev.c ? (last.c - prev.c) / prev.c * 100 : 0,
      open:last.o, high:last.h, low:last.l, volume:last.v,
      real: isReal(code),
      spark: d.slice(-30).map(function (b) { return b.c; })
    };
  }

  /* ---------- 데이터 로딩 ---------- */
  function jget(path){
    return fetch(path, { cache:'default' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
      return r.json();
    });
  }
  const lateSubs = [];
  function onLate(fn){ lateSubs.push(fn); }
  function emitLate(kind){ lateSubs.forEach(function (f) { try { f(kind); } catch (e) { console.error(e); } }); }

  /* 1단계: 종목 마스터 + 시세 (화면을 먼저 띄운다)
     2단계: 일봉/일정은 뒤따라 로드하고 도착하면 다시 그린다 */
  function init(baseDir){
    const dir = baseDir || 'assets/data/';
    return Promise.all([
      jget(dir + 'symbols.json').catch(function () { return null; }),
      jget(dir + 'quotes.json').catch(function () { return null; })
    ]).then(function (res) {
      const sym = res[0], q = res[1];
      if (q && q.items) Object.keys(q.items).forEach(function (k) { QUOTES[k] = q.items[k]; });
      if (sym && sym.items && sym.items.length){
        sym.items.forEach(register);
        META = { source:'bundle', symbols:sym.updated, quotes:q && q.updated, count:sym.items.length, real:0 };
      } else {
        SEED.forEach(function (r) { register(r); if (!QUOTES[r.c]) QUOTES[r.c] = { p:r.p, d:0, r:0, v:0 }; });
        META = { source:'seed', count:SEED.length, real:0 };
      }

      jget(dir + 'history.json').then(function (h) {
        if (!h || !h.items) return;
        Object.keys(h.items).forEach(function (k) {
          REAL_BARS[k] = h.items[k];
          delete DAILY[k]; delete MIN[k]; dropDerived(k);        // 시뮬레이션 캐시 무효화
        });
        META.history = h.updated; META.real = Object.keys(REAL_BARS).length;
        emitLate('history');
      }).catch(function () {});

      jget(dir + 'events.json').then(function (ev) {
        if (!ev) return;
        if (QT.Events) QT.Events.load(ev);
        META.events = ev.updated;
        emitLate('events');
      }).catch(function () {});

      return META;
    });
  }

  QT.Market = {
    UNIVERSE:UNIVERSE, BY_CODE:BY_CODE, QUOTES:QUOTES, TICK_SIZE:tick,
    init:init, daily:daily, series:series, aggregate:aggregate,
    applyTick:applyTick, snapshot:snapshot, lightQuote:lightQuote, isReal:isReal, hasData:hasData, onLate:onLate,
    meta: function (){ return META; }
  };
})(window.QT);

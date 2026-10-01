/* =============================================================
   market-data.js — 종목 마스터 · 시세 · 봉 데이터

   [데이터 계층]
     1) assets/data/symbols.json  국내 전종목(KOSPI/KOSDAQ/ETF) + 미국 S&P500/NASDAQ100 마스터
     2) assets/data/quotes.json   종목별 최근 종가·등락 (수집 시점 기준 실제 값)
     3) assets/data/krx/          공공데이터포털 '금융위원회_주식시세정보' (배포 워크플로가 생성)
          quotes.json   최근 거래일 전 종목 종가 — 국내 종목의 시세는 이 값이 우선
          d/<코드>.json  종목별 수정주가 일봉 — 종목을 열 때 받는다 (ensureDaily)
        토스증권이 연결되면 공공데이터 마지막 날 이후의 거래일과 실시간 체결만 덧붙인다 (appendDaily)
     4) assets/data/history.json  대표 종목의 실제 일봉 (네이버 금융 / Yahoo Finance) — 공공데이터가 없는 종목용
     5) assets/data/fundamentals.json  재무 · 가치분석 (fundamentals.js 가 사용)
     · 일봉이 없는 종목은 '실제 최근 종가'를 기준점으로 경로만 시뮬레이션하고
       화면에 '시뮬레이션'으로 표기합니다. (가격 수준은 실제와 일치)
     · 분봉은 토스증권 연결 시 실제 1분봉, 그 외에는 일봉에서 파생한 시뮬레이션입니다.
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
  const REAL_SRC = {};                 // 실제 일봉 출처: 'krx'(공공데이터) | 'krx+toss' | 'bundle'(history.json) | 'toss'
  let META = { symbols:null, quotes:null, history:null, source:'seed' };

  /* 공공데이터포털 금융위원회 시세 — items: 최근 거래일 종가, top: 스크리너 대상(시가총액 상위) */
  const KRX = { dir:'', basDt:null, first:null, source:'', etf:false, count:0,
                items:{}, top:{}, loaded:{}, failed:{}, pending:{}, lastT:{}, bundle:{} };
  const KRX_TOP = { stock:150, etf:40 };

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

  /* ---------- 집계 ----------
     일봉은 UTC 날짜가 곧 거래일이라(아래 '거래일' 규칙) 주 · 월 구분도 UTC 로 해야
     한국 밖에서 열어도 같은 주봉 · 월봉이 나온다. te = 묶인 마지막 봉 시각 (주봉 기간 표시용) */
  function bucketKey(t, tf){
    if (tf === '5m') return Math.floor(t / 300000);
    const d = new Date(t);
    if (tf === '1W') return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000) - (d.getUTCDay() + 6) % 7;
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }
  function aggregate(bars, tf){
    const out = []; let cur = null, key = null;
    for (let i = 0; i < bars.length; i++){
      const b = bars[i], k = bucketKey(b.t, tf);
      if (k !== key){ if (cur) out.push(cur); cur = { t:b.t, te:b.t, o:b.o, h:b.h, l:b.l, c:b.c, v:b.v }; key = k; }
      else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; cur.te = b.t; }
    }
    if (cur) out.push(cur);
    return out;
  }

  /* ---------- 캐시 ---------- */
  const DAILY = {}, MIN = {}, MIN_SRC = {}, DERIVED = {};
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
  /* 일봉이 바뀌면 파생 데이터를 다시 만든다 (토스에서 받은 실제 분봉은 그대로 둠) */
  function resetDaily(code){ delete DAILY[code]; if (!MIN_SRC[code]) delete MIN[code]; dropDerived(code); }
  function quoteFromBars(code, rows){
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    QUOTES[code] = { p:last[4], d: prev ? last[4] - prev[4] : 0, r: prev ? (last[4] - prev[4]) / prev[4] * 100 : 0, v:last[5] };
  }
  function isReal(code){ return !!REAL_BARS[code]; }
  function realSource(code){ return REAL_SRC[code] || null; }
  /* 시세가 수집된 종목인지 — 없으면 화면에서 값을 만들어내지 않습니다 */
  function hasData(code){ return !!REAL_BARS[code] || !!(QUOTES[code] && QUOTES[code].p > 0); }

  /* ---------- 거래일 ----------
     일봉 시각 규칙: 국내 15:30 KST(= 06:30 UTC), 미국 0시 UTC — 둘 다 UTC 날짜가 곧 거래일 */
  const DAY_FMT = {};
  function marketDay(ts, us){
    const tz = us ? 'America/New_York' : 'Asia/Seoul';
    const f = DAY_FMT[tz] || (DAY_FMT[tz] = new Intl.DateTimeFormat('en-CA', { timeZone:tz, year:'numeric', month:'2-digit', day:'2-digit' }));
    return f.format(new Date(ts));
  }
  function barDay(t){ return new Date(t).toISOString().slice(0, 10); }
  function dayStamp(day, us){
    const y = +day.slice(0, 4), m = +day.slice(5, 7) - 1, d = +day.slice(8, 10);
    return us ? Date.UTC(y, m, d) : Date.UTC(y, m, d, 6, 30);
  }

  /* ---------- 진행 중인 봉 ----------
     마지막 봉이 아직 끝나지 않았는지 — 피봇(끝난 봉으로 다음 봉의 선을 만든다) · 거래량 비교 · 캔들 패턴은
     끝난 봉으로만 계산해야 한다. 공공데이터 · 번들 일봉은 항상 끝난 봉이고, 실시간 체결이 붙은 오늘 봉만 진행 중이다.
     국내 일봉 시각(15:30 KST)은 곧 정규장 마감 시각, 미국 일봉(0시 UTC)은 그날 16:00 뉴욕 시각에 끝난다. */
  const NY_HOUR = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', hour:'numeric', hourCycle:'h23' });
  function closeTime(t, us){
    if (!us) return t;
    const at = t + 20 * 3600000;                       // 서머타임 16:00 · 표준시 15:00 (뉴욕)
    return +NY_HOUR.format(new Date(at)) >= 16 ? at : at + 3600000;
  }
  /* 지금 열려 있거나 다음에 열릴 거래일의 일봉 시각 (휴장일은 모름 — 주말만 건너뜀) */
  function sessionStamp(now, us){
    let t = dayStamp(marketDay(now, us), us);
    if (now >= closeTime(t, us)) t += 86400000;
    while (new Date(t).getUTCDay() % 6 === 0) t += 86400000;
    return t;
  }
  /** code 의 tf('1D' · '1W' · '1M') 마지막 봉이 진행 중인지 */
  function barOpen(code, tf, now){
    const st = BY_CODE[code];
    if (!st || needsDaily(code)) return false;
    const d = daily(code);
    if (!d.length) return false;
    const us = st.cur === 'USD', last = d[d.length - 1], t = now || Date.now();
    if (t < closeTime(last.t, us)) return true;
    if (tf !== '1W' && tf !== '1M') return false;
    return bucketKey(sessionStamp(t, us), tf) === bucketKey(last.t, tf);   // 이번 주 · 달에 거래일이 더 남았다
  }

  /* ---------- 실시간 틱 반영 ----------
     live: 증권사 실제 체결 — 체결 시각의 거래일로 봉을 고른다. 마지막 봉보다 새 거래일이면 봉을 새로 연다
           (공공데이터는 전 영업일까지만 있어서 오늘 체결을 어제 봉에 덮어쓰면 안 됨)
     모의 시세는 예전처럼 마지막 봉만 움직인다. */
  function applyTick(code, price, volDelta, ts, live){
    const st = BY_CODE[code]; if (!st) return;
    if (needsDaily(code)){                             // 공공데이터 일봉을 받기 전 — 시세만 (대비는 공공데이터 종가 기준)
      const it = KRX.items[code], q = QUOTES[code];
      if (q && it && it.p){ q.p = price; q.d = price - it.p; q.r = (price - it.p) / it.p * 100; }
      return;
    }
    const d = daily(code); if (!d.length) return;
    let last = d[d.length - 1];
    const p = price;                                   // 실제 체결가는 그대로 (모의 시세는 생성 시 호가 단위로 맞춤)
    if (live){
      const us = st.cur === 'USD', day = marketDay(ts || Date.now(), us), lastDay = barDay(last.t);
      if (day < lastDay) return;                       // 이전 거래일의 늦은 체결
      if (day > lastDay){
        last = { t:dayStamp(day, us), o:p, h:p, l:p, c:p, v:0 };
        d.push(last);
        dropDerived(code);
      } else if (KRX.lastT[code] && last.t <= KRX.lastT[code]) {
        return;                                        // 공공데이터 확정 종가는 건드리지 않는다
      }
    }
    last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p);
    last.v += Math.max(0, Math.round(volDelta || 0));
    const q = QUOTES[code];
    if (q){ const prev = d[d.length - 2]; q.p = p; if (prev){ q.d = p - prev.c; q.r = (p - prev.c) / prev.c * 100; } }
    const m = MIN[code];
    if (m && m.length){
      const lastM = m[m.length - 1], mt = Math.floor((live && ts ? ts : Date.now()) / 60000) * 60000;
      if (mt < lastM.t) { dropDerived(code); return; }
      if (mt > lastM.t){
        m.push({ t: live ? mt : lastM.t + 60000, o:p, h:p, l:p, c:p, v: Math.max(1, Math.round(volDelta || 0)) });
        if (m.length > M_PER_DAY * 6) m.shift();
      } else {
        lastM.c = p; lastM.h = Math.max(lastM.h, p); lastM.l = Math.min(lastM.l, p);
        lastM.v += Math.max(0, Math.round(volDelta || 0));
      }
    }
    dropDerived(code);
  }

  /* 증권사 API 에서 받은 실제 일봉으로 교체 — [{t,o,h,l,c,v}] 오래된 순 */
  function setDaily(code, bars, source){
    if (!BY_CODE[code] || !bars || !bars.length) return false;
    REAL_BARS[code] = bars.map(function (b) { return [b.t, b.o, b.h, b.l, b.c, b.v]; });
    REAL_SRC[code] = source || 'api';
    resetDaily(code);
    quoteFromBars(code, REAL_BARS[code]);
    return true;
  }

  /* ---------- 공공데이터 일봉 ---------- */
  function hasKrx(code){ return !!KRX.items[code]; }
  function isKrxTop(code){ return !!KRX.top[code]; }
  function needsDaily(code){ return !!KRX.items[code] && !KRX.loaded[code] && !KRX.failed[code]; }
  /** 종목별 공공데이터 일봉을 받아 둔다 — 이미 있거나 대상이 아니면 바로 끝남 */
  function ensureDaily(code){
    if (!needsDaily(code)) return Promise.resolve(false);
    if (KRX.pending[code]) return KRX.pending[code];
    const p = jget(KRX.dir + 'd/' + encodeURIComponent(code) + '.json').then(function (rows) {
      if (!Array.isArray(rows) || rows.length < 2) throw new Error('일봉 없음');
      REAL_BARS[code] = rows; REAL_SRC[code] = 'krx';
      KRX.loaded[code] = true;
      KRX.lastT[code] = rows[rows.length - 1][0];
      resetDaily(code);
      quoteFromBars(code, rows);
      const it = KRX.items[code];
      if (it) QUOTES[code] = { p:it.p, d:it.d, r:it.r, v:it.v };   // 전일 대비는 거래소 공식 값
      return true;
    }).catch(function (e) {
      KRX.failed[code] = true;
      console.warn('[QT] 공공데이터 일봉 없음', code, e.message);
      if (KRX.bundle[code] && !REAL_BARS[code]){           // 미뤄 둔 번들 일봉으로 대체
        REAL_BARS[code] = KRX.bundle[code]; REAL_SRC[code] = 'bundle'; resetDaily(code);
      }
      return false;
    }).then(function (ok) { delete KRX.pending[code]; return ok; });
    KRX.pending[code] = p;
    return p;
  }
  /** 여러 종목을 동시에 limit 개씩 */
  function ensureMany(codes, limit){
    const todo = codes.filter(needsDaily);
    let i = 0;
    function next(){ return i < todo.length ? ensureDaily(todo[i++]).then(next) : Promise.resolve(); }
    const workers = [];
    for (let k = 0; k < Math.min(limit || 6, todo.length); k++) workers.push(next());
    return Promise.all(workers).then(function () { return todo.length; });
  }
  /** 공공데이터 일봉 뒤에 증권사 일봉을 잇는다 — 공공데이터 마지막 거래일 이후 봉만 사용 */
  function appendDaily(code, bars, source){
    const base = REAL_BARS[code], lastT = KRX.lastT[code];
    if (!KRX.loaded[code] || !base || !lastT || !bars) return false;
    const keep = base.filter(function (r) { return r[0] <= lastT; });
    const add = bars.filter(function (b) { return b.t > lastT && b.c > 0; })
      .map(function (b) { return [b.t, b.o, b.h, b.l, b.c, b.v]; });
    REAL_BARS[code] = keep.concat(add);
    REAL_SRC[code] = add.length ? 'krx+' + (source || 'api') : 'krx';
    resetDaily(code);
    if (add.length) quoteFromBars(code, REAL_BARS[code]);
    return true;
  }
  function applyKrx(kx, dir){
    KRX.dir = dir + 'krx/'; KRX.basDt = kx.basDt; KRX.first = kx.first; KRX.source = kx.source || '';
    KRX.etf = !!kx.etf; KRX.count = kx.count || 0;
    const rank = { stock:[], etf:[] };
    Object.keys(kx.items).forEach(function (code) {
      const it = kx.items[code];
      if (!BY_CODE[code]) register({ c:code, n:it.n, m:it.m, t:it.t, cur:'KRW' });   // 마스터에 없는 신규 상장
      KRX.items[code] = it;
      QUOTES[code] = { p:it.p, d:it.d, r:it.r, v:it.v };
      (rank[it.t] || rank.stock).push(code);
    });
    Object.keys(rank).forEach(function (t) {
      rank[t].sort(function (a, b) { return (KRX.items[b].mc || 0) - (KRX.items[a].mc || 0); })
        .slice(0, KRX_TOP[t]).forEach(function (c) { KRX.top[c] = true; });
    });
  }
  function krxMeta(){ return KRX.basDt ? { basDt:KRX.basDt, first:KRX.first, source:KRX.source, etf:KRX.etf, count:KRX.count } : null; }

  /* 토스증권 실제 1분봉 — [{t,o,h,l,c,v}] 오래된 순 */
  function setMinutes(code, bars, source){
    if (!BY_CODE[code] || !bars || !bars.length) return false;
    MIN[code] = bars.map(function (b) { return { t:b.t, o:b.o, h:b.h, l:b.l, c:b.c, v:b.v }; });
    MIN_SRC[code] = source || 'api';
    dropDerived(code);
    return true;
  }
  function minuteSource(code){ return MIN_SRC[code] || null; }

  /* 목록 렌더링용 경량 시세 — 히스토리를 만들지 않고 수집된 종가만 사용 */
  function quoteOnly(code){
    const st = BY_CODE[code], q = QUOTES[code];
    if (!st) return null;
    if (!q) return { st:st, code:code, price:null, diff:0, rate:0, volume:0, spark:null, real:isReal(code) };
    const it = KRX.items[code];
    return { st:st, code:code, price:q.p, prevClose:q.p - (q.d || 0), diff:q.d || 0, rate:q.r || 0,
             open: it && it.o, high: it && it.h, low: it && it.l,
             volume:q.v || 0, spark:null, real:isReal(code) };
  }
  function lightQuote(code){
    if (DAILY[code] && !needsDaily(code)) return snapshot(code);
    return quoteOnly(code);
  }

  function snapshot(code){
    /* 공공데이터 일봉을 받기 전에는 시뮬레이션 경로로 대비 · 스파크라인을 만들지 않는다
       (관심종목에 가짜 등락률이 뜨던 문제) — 거래소 공식 종가 · 대비만 쓴다 */
    if (needsDaily(code)) return quoteOnly(code);
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
      jget(dir + 'quotes.json').catch(function () { return null; }),
      jget(dir + 'krx/quotes.json').catch(function () { return null; })   // 배포본에만 있음
    ]).then(function (res) {
      const sym = res[0], q = res[1], kx = res[2];
      if (q && q.items) Object.keys(q.items).forEach(function (k) { QUOTES[k] = q.items[k]; });
      if (sym && sym.items && sym.items.length){
        sym.items.forEach(register);
        META = { source:'bundle', symbols:sym.updated, quotes:q && q.updated, count:sym.items.length, real:0 };
      } else {
        SEED.forEach(function (r) { register(r); if (!QUOTES[r.c]) QUOTES[r.c] = { p:r.p, d:0, r:0, v:0 }; });
        META = { source:'seed', count:SEED.length, real:0 };
      }
      if (kx && kx.items){ applyKrx(kx, dir); META.krx = krxMeta(); META.count = UNIVERSE.length; }

      jget(dir + 'history.json').then(function (h) {
        if (!h || !h.items) return;
        Object.keys(h.items).forEach(function (k) {
          if (REAL_SRC[k] && REAL_SRC[k] !== 'bundle') return;  // 이미 API 일봉을 받았으면 유지
          if (KRX.items[k] && !KRX.failed[k]){ KRX.bundle[k] = h.items[k]; return; }   // 국내 종목은 공공데이터 일봉 우선
          REAL_BARS[k] = h.items[k]; REAL_SRC[k] = 'bundle';
          resetDaily(k);                                         // 시뮬레이션 캐시 무효화
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

      jget(dir + 'fundamentals.json').then(function (fd) {
        if (!fd || !QT.Fund) return;
        QT.Fund.load(fd);
        META.fundamentals = fd.updated;
        emitLate('fundamentals');
      }).catch(function () {});

      return META;
    });
  }

  QT.Market = {
    UNIVERSE:UNIVERSE, BY_CODE:BY_CODE, QUOTES:QUOTES, TICK_SIZE:tick,
    init:init, daily:daily, series:series, aggregate:aggregate,
    applyTick:applyTick, snapshot:snapshot, lightQuote:lightQuote, isReal:isReal, hasData:hasData, onLate:onLate, barOpen:barOpen,
    setDaily:setDaily, realSource:realSource,
    hasKrx:hasKrx, isKrxTop:isKrxTop, needsDaily:needsDaily, ensureDaily:ensureDaily, ensureMany:ensureMany,
    appendDaily:appendDaily, krxMeta:krxMeta, setMinutes:setMinutes, minuteSource:minuteSource,
    meta: function (){ return META; }
  };
})(window.QT);

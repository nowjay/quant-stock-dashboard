/* =============================================================
   market-data.js — 종목 유니버스 · 히스토리 · 봉 집계
   히스토리는 종목코드 시드 기반으로 재현 가능하게 생성합니다.
   실 데이터 연동 시 QT.Market.loadHistory() 만 교체하면 됩니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  /* ---------- 시드 난수 ---------- */
  function hash32(s){ let h = 2166136261; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r){ let u=0,v=0; while(u===0)u=r(); while(v===0)v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

  /* ---------- 종목 유니버스 ---------- */
  const UNIVERSE = [
    { code:'005930', name:'삼성전자',          en:'Samsung Electronics',  market:'KOSPI',  sector:'반도체',     cur:'KRW', base:78600,  vol:0.0160, drift:0.00042, vb:14200000 },
    { code:'000660', name:'SK하이닉스',        en:'SK hynix',             market:'KOSPI',  sector:'반도체',     cur:'KRW', base:196500, vol:0.0235, drift:0.00098, vb:4100000 },
    { code:'373220', name:'LG에너지솔루션',    en:'LG Energy Solution',   market:'KOSPI',  sector:'2차전지',    cur:'KRW', base:352000, vol:0.0248, drift:-0.00052, vb:520000 },
    { code:'207940', name:'삼성바이오로직스',  en:'Samsung Biologics',    market:'KOSPI',  sector:'바이오',     cur:'KRW', base:812000, vol:0.0205, drift:0.00061, vb:118000 },
    { code:'005380', name:'현대차',            en:'Hyundai Motor',        market:'KOSPI',  sector:'자동차',     cur:'KRW', base:243500, vol:0.0180, drift:0.00048, vb:980000 },
    { code:'000270', name:'기아',              en:'Kia',                  market:'KOSPI',  sector:'자동차',     cur:'KRW', base:104800, vol:0.0188, drift:0.00035, vb:1450000 },
    { code:'068270', name:'셀트리온',          en:'Celltrion',            market:'KOSPI',  sector:'바이오',     cur:'KRW', base:184300, vol:0.0222, drift:-0.00018, vb:620000 },
    { code:'035420', name:'NAVER',             en:'NAVER',                market:'KOSPI',  sector:'인터넷',     cur:'KRW', base:172400, vol:0.0208, drift:-0.00035, vb:760000 },
    { code:'035720', name:'카카오',            en:'Kakao',                market:'KOSPI',  sector:'인터넷',     cur:'KRW', base:41250,  vol:0.0242, drift:-0.00068, vb:2350000 },
    { code:'005490', name:'POSCO홀딩스',       en:'POSCO Holdings',       market:'KOSPI',  sector:'철강',       cur:'KRW', base:328000, vol:0.0215, drift:-0.00042, vb:410000 },
    { code:'051910', name:'LG화학',            en:'LG Chem',              market:'KOSPI',  sector:'화학',       cur:'KRW', base:298500, vol:0.0228, drift:-0.00055, vb:330000 },
    { code:'006400', name:'삼성SDI',           en:'Samsung SDI',          market:'KOSPI',  sector:'2차전지',    cur:'KRW', base:286000, vol:0.0240, drift:-0.00061, vb:380000 },
    { code:'012330', name:'현대모비스',        en:'Hyundai Mobis',        market:'KOSPI',  sector:'자동차부품', cur:'KRW', base:236500, vol:0.0168, drift:0.00028, vb:290000 },
    { code:'105560', name:'KB금융',            en:'KB Financial',         market:'KOSPI',  sector:'금융',       cur:'KRW', base:86400,  vol:0.0152, drift:0.00082, vb:1620000 },
    { code:'055550', name:'신한지주',          en:'Shinhan Financial',    market:'KOSPI',  sector:'금융',       cur:'KRW', base:58900,  vol:0.0148, drift:0.00074, vb:1980000 },
    { code:'028260', name:'삼성물산',          en:'Samsung C&T',          market:'KOSPI',  sector:'지주',       cur:'KRW', base:148200, vol:0.0172, drift:0.00036, vb:520000 },
    { code:'096770', name:'SK이노베이션',      en:'SK Innovation',        market:'KOSPI',  sector:'에너지',     cur:'KRW', base:112600, vol:0.0225, drift:-0.00046, vb:690000 },
    { code:'012450', name:'한화에어로스페이스',en:'Hanwha Aerospace',     market:'KOSPI',  sector:'방산',       cur:'KRW', base:328500, vol:0.0262, drift:0.00135, vb:880000 },
    { code:'011200', name:'HMM',               en:'HMM',                  market:'KOSPI',  sector:'해운',       cur:'KRW', base:18420,  vol:0.0268, drift:0.00052, vb:5600000 },
    { code:'034020', name:'두산에너빌리티',    en:'Doosan Enerbility',    market:'KOSPI',  sector:'원전',       cur:'KRW', base:23150,  vol:0.0272, drift:0.00112, vb:7300000 },
    { code:'009150', name:'삼성전기',          en:'Samsung Electro-Mech', market:'KOSPI',  sector:'전자부품',   cur:'KRW', base:139800, vol:0.0205, drift:0.00022, vb:640000 },
    { code:'066570', name:'LG전자',            en:'LG Electronics',       market:'KOSPI',  sector:'가전',       cur:'KRW', base:92300,  vol:0.0192, drift:-0.00026, vb:780000 },
    { code:'247540', name:'에코프로비엠',      en:'EcoPro BM',            market:'KOSDAQ', sector:'2차전지',    cur:'KRW', base:168400, vol:0.0318, drift:-0.00092, vb:1240000 },
    { code:'196170', name:'알테오젠',          en:'Alteogen',             market:'KOSDAQ', sector:'바이오',     cur:'KRW', base:312000, vol:0.0305, drift:0.00142, vb:640000 },
    { code:'086520', name:'에코프로',          en:'EcoPro',               market:'KOSDAQ', sector:'2차전지',    cur:'KRW', base:76800,  vol:0.0330, drift:-0.00085, vb:1860000 },
    { code:'035900', name:'JYP Ent.',          en:'JYP Entertainment',    market:'KOSDAQ', sector:'엔터',       cur:'KRW', base:62400,  vol:0.0262, drift:-0.00032, vb:520000 },
    { code:'058470', name:'리노공업',          en:'Leeno Industrial',     market:'KOSDAQ', sector:'반도체장비', cur:'KRW', base:182500, vol:0.0248, drift:0.00058, vb:210000 },
    { code:'091990', name:'셀트리온헬스케어',  en:'Celltrion Healthcare', market:'KOSDAQ', sector:'바이오',     cur:'KRW', base:71300,  vol:0.0255, drift:-0.00024, vb:880000 },
    { code:'AAPL',   name:'애플',              en:'Apple Inc.',           market:'NASDAQ', sector:'IT',         cur:'USD', base:232.50, vol:0.0142, drift:0.00068, vb:52000000 },
    { code:'NVDA',   name:'엔비디아',          en:'NVIDIA Corp.',         market:'NASDAQ', sector:'반도체',     cur:'USD', base:178.20, vol:0.0268, drift:0.00185, vb:210000000 },
    { code:'MSFT',   name:'마이크로소프트',    en:'Microsoft Corp.',      market:'NASDAQ', sector:'소프트웨어', cur:'USD', base:428.60, vol:0.0135, drift:0.00072, vb:19000000 },
    { code:'TSLA',   name:'테슬라',            en:'Tesla Inc.',           market:'NASDAQ', sector:'전기차',     cur:'USD', base:268.40, vol:0.0295, drift:0.00042, vb:88000000 }
  ];
  const BY_CODE = {};
  UNIVERSE.forEach(function (s) { BY_CODE[s.code] = s; });

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

  /* ---------- 일봉 생성 ---------- */
  const N_DAILY = 780;
  function weekdayStamps(n){
    const out = [], d = new Date(); d.setHours(15, 30, 0, 0);
    while (out.length < n){ const w = d.getDay(); if (w !== 0 && w !== 6) out.push(d.getTime()); d.setDate(d.getDate() - 1); }
    return out.reverse();
  }
  function loadHistory(st){
    const rnd = mulberry32(hash32(st.code + '|qt2'));
    const times = weekdayStamps(N_DAILY), raw = [];
    let p = st.base, trend = 0, regime = 1;
    for (let i = 0; i < N_DAILY; i++){
      if (i % 42 === 0) trend = gauss(rnd) * st.vol * 0.42;
      if (i % 17 === 0) regime = 0.62 + rnd() * 0.95;
      const shock = gauss(rnd) * st.vol * regime;
      const ret = st.drift * 0.75 + trend * 0.35 + shock;
      const o = p * (1 + gauss(rnd) * st.vol * 0.22);
      const c = o * (1 + ret);
      const span = Math.abs(ret) + st.vol * regime * 0.7;
      raw.push({ o:o, c:c,
        h: Math.max(o, c) * (1 + span * (0.15 + 0.75 * rnd())),
        l: Math.min(o, c) * (1 - span * (0.15 + 0.75 * rnd())),
        r: Math.abs(ret), g: regime });
      p = c;
    }
    const k = st.base / p;
    return raw.map(function (b, i) {
      const o = tick(b.o * k, st.cur), c = tick(b.c * k, st.cur);
      const h = Math.max(tick(b.h * k, st.cur), o, c), l = Math.min(tick(b.l * k, st.cur), o, c);
      const vm = (0.55 + 0.9 * ((i * 2654435761) % 1000) / 1000) * (1 + b.r / st.vol * 0.55) * b.g;
      return { t: times[i], o:o, h:h, l:l, c:c, v: Math.round(st.vb * vm) };
    });
  }

  /* ---------- 1분봉 생성 (최근 5영업일 · 브라운 브리지) ---------- */
  const M_PER_DAY = 390;                                   // 09:00~15:30
  function buildMinutes(st, daily){
    const days = daily.slice(-5), out = [], rnd = mulberry32(hash32(st.code + '|m1'));
    for (let d = 0; d < days.length; d++){
      const day = days[d], base = new Date(day.t); base.setHours(9, 0, 0, 0);
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
        const o = prev, c = path[i], j = i / (M_PER_DAY - 1);
        const wob = (day.h - day.l) * 0.02 * rnd();
        out.push({
          t: base.getTime() + i * 60000,
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
    return d.getFullYear() + '-' + d.getMonth();            // 1M
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
  function daily(code){ if (!DAILY[code]) DAILY[code] = loadHistory(BY_CODE[code]); return DAILY[code]; }
  function minutes(code){ if (!MIN[code]) MIN[code] = buildMinutes(BY_CODE[code], daily(code)); return MIN[code]; }
  function series(code, tf){
    if (tf === '1D') return daily(code);
    if (tf === '1m') return minutes(code);
    const key = code + '|' + tf;
    if (!DERIVED[key]) DERIVED[key] = aggregate(tf === '5m' ? minutes(code) : daily(code), tf);
    return DERIVED[key];
  }
  function dropDerived(code){ ['5m','1W','1M'].forEach(function (tf) { delete DERIVED[code + '|' + tf]; }); }

  /* ---------- 실시간 틱 반영 ---------- */
  function applyTick(code, price, volDelta){
    const st = BY_CODE[code]; if (!st) return;
    const d = daily(code), last = d[d.length - 1];
    const p = tick(price, st.cur);
    last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p);
    last.v += Math.max(0, Math.round(volDelta || 0));

    const m = minutes(code), lastM = m[m.length - 1], now = Date.now();
    if (now - lastM.t >= 60000){
      m.push({ t: lastM.t + 60000, o:p, h:p, l:p, c:p, v: Math.max(1, Math.round(volDelta || 0)) });
      if (m.length > M_PER_DAY * 6) m.shift();
    } else {
      lastM.c = p; lastM.h = Math.max(lastM.h, p); lastM.l = Math.min(lastM.l, p);
      lastM.v += Math.max(0, Math.round(volDelta || 0));
    }
    dropDerived(code);
  }

  /* ---------- 스냅샷 ---------- */
  function snapshot(code){
    const st = BY_CODE[code], d = daily(code);
    const last = d[d.length - 1], prev = d[d.length - 2];
    return {
      st:st, code:code, price:last.c, prevClose:prev.c,
      diff:last.c - prev.c, rate:(last.c - prev.c) / prev.c * 100,
      open:last.o, high:last.h, low:last.l, volume:last.v,
      spark: d.slice(-30).map(function (b) { return b.c; })
    };
  }

  QT.Market = {
    UNIVERSE:UNIVERSE, BY_CODE:BY_CODE, TICK_SIZE:tick,
    loadHistory:loadHistory, daily:daily, series:series, aggregate:aggregate,
    applyTick:applyTick, snapshot:snapshot
  };
})(window.QT);

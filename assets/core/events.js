/* =============================================================
   events.js — 글로벌 매크로 일정 · 실적 시즌 캘린더

   상태 배지
     · 확정 : assets/data/events.json 에 수집된 공식 일정 (FOMC · BLS 발표일 · 기업 공지 실적일)
     · 규칙 : 제도상 날짜가 정해지는 일정 (파생 만기, FOMC 의사록 = 회의 3주 뒤)
     · 예상 : 과거 발표 패턴으로 추정한 일정 (CPI · PPI · 고용 · 금통위 · 실적 발표일)
   시각은 실제 발표 순간(UTC ms)으로 계산하고 화면에는 한국시간(KST)으로 표기합니다.
   미국 발표는 동부시간 기준이라 서머타임(3월 둘째 일요일 ~ 11월 첫째 일요일)을 반영합니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const DAY = 86400000, HOUR = 3600000, KST = 9 * HOUR;

  let DB = { macro:[], earnings:[], symbols:{} };
  function load(db){ if (db) DB = { macro:db.macro || [], earnings:db.earnings || [], symbols:db.symbols || {} }; }

  /* ---------- 달력 연산 (UTC 기준 날짜 객체 {y, m, d}) ---------- */
  function ymd(y, m, d){ const x = new Date(Date.UTC(y, m, d)); return { y:x.getUTCFullYear(), m:x.getUTCMonth(), d:x.getUTCDate() }; }
  function dowOf(x){ return new Date(Date.UTC(x.y, x.m, x.d)).getUTCDay(); }
  function key(x){ return x.y + '-' + (x.m < 9 ? '0' : '') + (x.m + 1) + '-' + (x.d < 10 ? '0' : '') + x.d; }
  function shift(x, n){ return ymd(x.y, x.m, x.d + n); }
  function nthDow(y, m, wd, nth){ const f = dowOf(ymd(y, m, 1)); return ymd(y, m, 1 + ((wd - f + 7) % 7) + (nth - 1) * 7); }
  function lastDow(y, m, wd){ const l = ymd(y, m + 1, 0); return shift(l, -((dowOf(l) - wd + 7) % 7)); }
  /* from 일(월 경계 초과 허용) 이후 첫 wd 요일 */
  function onOrAfter(y, m, from, wd){ const s = ymd(y, m, from); return shift(s, (wd - dowOf(s) + 7) % 7); }
  function weekend(x){ const w = dowOf(x); return w === 0 || w === 6; }

  /* 국내 휴장일 (2026~2027, 대체공휴일 포함) */
  const KR_HOLI = {};
  ['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-02','2026-05-01','2026-05-05','2026-05-25','2026-06-03',
   '2026-08-17','2026-09-24','2026-09-25','2026-10-05','2026-10-09','2026-12-25','2026-12-31',
   '2027-01-01','2027-02-08','2027-02-09','2027-03-01','2027-05-05','2027-05-13','2027-06-07','2027-08-16',
   '2027-09-14','2027-09-15','2027-09-16','2027-10-04','2027-10-11','2027-12-27','2027-12-31'].forEach(function (k) { KR_HOLI[k] = 1; });
  function krOpen(x){ return !weekend(x) && !KR_HOLI[key(x)]; }
  function krPrevOpen(x){ while (!krOpen(x)) x = shift(x, -1); return x; }
  function krNthOpen(y, m, n){ let x = ymd(y, m, 1), c = 0; for (;;){ if (krOpen(x) && ++c === n) return x; x = shift(x, 1); } }

  /* 미국 연방 공휴일 중 지표 발표에 영향을 주는 날 */
  function usHoliday(x){
    const k = (x.m + 1) * 100 + x.d, w = dowOf(x);
    if (k === 101 || k === 619 || k === 704 || k === 1225) return true;
    if ((k === 102 || k === 620 || k === 705 || k === 1226) && w === 1) return true;          // 일요일 → 월요일 대체
    if ((k === 1231 || k === 618 || k === 703 || k === 1224) && w === 5) return true;         // 토요일 → 금요일 대체
    if (x.m === 8 && key(x) === key(nthDow(x.y, 8, 1, 1))) return true;                       // 노동절
    if (x.m === 10 && key(x) === key(nthDow(x.y, 10, 4, 4))) return true;                     // 추수감사절
    return false;
  }
  function usFirstOpen(y, m){ let x = ymd(y, m, 1); while (weekend(x) || usHoliday(x)) x = shift(x, 1); return x; }
  function usPrevOpen(x){ while (weekend(x) || usHoliday(x)) x = shift(x, -1); return x; }

  /* ---------- 시각 변환 ---------- */
  function usDst(x){
    if (x.m > 2 && x.m < 10) return true;
    if (x.m < 2 || x.m > 10) return false;
    return x.m === 2 ? x.d >= nthDow(x.y, 2, 0, 2).d : x.d < nthDow(x.y, 10, 0, 1).d;
  }
  function atET(x, hh, mm){ return Date.UTC(x.y, x.m, x.d, hh + (usDst(x) ? 4 : 5), mm || 0); }
  function atKST(x, hh, mm){ return Date.UTC(x.y, x.m, x.d, hh, mm || 0) - KST; }
  function kst(t){
    const d = new Date(t + KST);
    return { y:d.getUTCFullYear(), m:d.getUTCMonth(), d:d.getUTCDate(), w:d.getUTCDay(), hh:d.getUTCHours(), mm:d.getUTCMinutes() };
  }
  const WD = ['일','월','화','수','목','금','토'];
  function pad(n){ return n < 10 ? '0' + n : '' + n; }
  function fmtDate(t){ const p = kst(t); return (p.m + 1) + '월 ' + p.d + '일 (' + WD[p.w] + ')'; }
  function fmtMD(t){ const p = kst(t); return (p.m + 1) + '/' + p.d + ' (' + WD[p.w] + ')'; }
  function fmtTime(t){ const p = kst(t); return pad(p.hh) + ':' + pad(p.mm); }
  function dayNo(t){ return Math.floor((t + KST) / DAY); }
  function dday(t){
    const n = dayNo(t) - dayNo(Date.now());
    return n === 0 ? 'D-DAY' : n > 0 ? 'D-' + n : 'D+' + (-n);
  }
  function countdown(t){
    let ms = t - Date.now();
    if (ms <= 0) return null;
    const d = Math.floor(ms / DAY); ms -= d * DAY;
    const h = Math.floor(ms / HOUR); ms -= h * HOUR;
    const m = Math.floor(ms / 60000); const s = Math.floor((ms - m * 60000) / 1000);
    return { d:d, h:h, m:m, s:s, text:(d > 0 ? d + '일 ' : '') + pad(h) + ':' + pad(m) + ':' + pad(s) };
  }
  function monthName(m){ return (((m % 12) + 12) % 12 + 1) + '월'; }

  /* =============================================================
     매크로 일정 규칙
       when(y, m) → 발표 시각(UTC ms) 또는 null, m = 발표월
     ============================================================= */
  /* 분류(cat): rate 금리 · inflation 물가 · jobs 고용·경기 · expiry 만기 */
  function nfpRelease(y, refM){
    /* 기준 주(12일이 포함된 주)가 끝난 뒤 세 번째 금요일 */
    const d12 = ymd(y, refM, 12), sat = shift(d12, 6 - dowOf(d12));
    let x = shift(sat, 20);
    if (usHoliday(x)) x = shift(x, x.m === 6 ? -1 : 7);
    return x;
  }
  function cpiDay(y, m){ return onOrAfter(y, m, 10, 3); }          // 10~16일 중 수요일

  const RULES = [
    { kind:'cpi', cat:'inflation', country:'US', imp:3, title:'미국 CPI (소비자물가지수)', ref:-1, src:'BLS',
      when:function (y, m) { return atET(cpiDay(y, m), 8, 30); },
      why:'인플레이션 둔화 여부를 확인하는 핵심 지표 — 예상치를 웃돌면 금리 인하 기대가 후퇴해 성장주에 부담입니다.' },
    { kind:'ppi', cat:'inflation', country:'US', imp:2, title:'미국 PPI (생산자물가지수)', ref:-1, src:'BLS',
      when:function (y, m) { return atET(shift(cpiDay(y, m), 1), 8, 30); },
      why:'CPI에 선행하는 생산 단계 물가 — 기업 마진과 향후 소비자물가 방향을 가늠합니다.' },
    { kind:'nfp', cat:'jobs', country:'US', imp:3, title:'미국 고용보고서 (비농업 고용 · 실업률)', ref:-1, src:'BLS',
      when:function (y, m) { const x = nfpRelease(y, m - 1); return x.m === ((m % 12) + 12) % 12 ? atET(x, 8, 30) : null; },
      why:'경기 연착륙·침체 판단의 기준 — 고용이 과열되면 금리 인하가 늦어지고, 급격히 식으면 경기 우려가 커집니다.' },
    { kind:'pce', cat:'inflation', country:'US', imp:2, title:'미국 PCE 물가 (개인소비지출)', ref:-1, src:'BEA',
      when:function (y, m) { return atET(usPrevOpen(lastDow(y, m, 5)), 8, 30); },
      why:'연준이 목표치(2%) 판단에 쓰는 물가 지표 — 근원 PCE 추이가 금리 경로에 직결됩니다.' },
    { kind:'gdp', cat:'jobs', country:'US', imp:2, title:'미국 GDP 속보치', ref:-3, months:[0, 3, 6, 9], quarter:true, src:'BEA',
      when:function (y, m) { return atET(lastDow(y, m, 4), 8, 30); },
      why:'직전 분기 성장률 첫 발표 — 경기 모멘텀과 기업 이익 전망의 기준선입니다.' },
    { kind:'ism', cat:'jobs', country:'US', imp:2, title:'미국 ISM 제조업 PMI', ref:-1, src:'ISM',
      when:function (y, m) { return atET(usFirstOpen(y, m), 10, 0); },
      why:'50을 기준으로 제조업 경기 확장·위축을 보여 주는 선행 지표 — 반도체·경기민감주에 영향이 큽니다.' },
    { kind:'bok', cat:'rate', country:'KR', imp:3, title:'한국은행 기준금리 결정 (금통위)', months:[0, 1, 3, 4, 6, 7, 9, 10], src:'한국은행',
      when:function (y, m) {
        const x = m === 0 ? nthDow(y, 0, 4, 3) : m === 3 ? nthDow(y, 3, 4, 3) : m === 6 ? nthDow(y, 6, 4, 2)
          : m === 9 ? nthDow(y, 9, 4, 4) : lastDow(y, m, 4);
        return atKST(x, 10, 0);
      },
      why:'국내 기준금리 — 원/달러 환율, 은행·내수주, 부동산 관련주에 직접 영향을 줍니다.' },
    { kind:'kcpi', cat:'inflation', country:'KR', imp:2, title:'한국 소비자물가 (통계청)', ref:-1, src:'통계청',
      when:function (y, m) { return atKST(krNthOpen(y, m, 2), 8, 0); },
      why:'국내 물가 흐름 — 한국은행 금리 결정의 핵심 변수입니다.' },
    { kind:'export', cat:'jobs', country:'KR', imp:2, title:'한국 수출입동향', ref:-1, src:'산업통상자원부',
      when:function (y, m) { return atKST(ymd(y, m, 1), 9, 0); },
      why:'반도체 수출 증감이 코스피 이익의 선행 지표 역할을 합니다.' },
    { kind:'expiry-kr', cat:'expiry', country:'KR', imp:1, title:'국내 지수 옵션 만기일', status:'규칙', src:'KRX',
      when:function (y, m) { return atKST(krPrevOpen(nthDow(y, m, 4, 2)), 15, 20); },
      quad:function (m) { return [2, 5, 8, 11].indexOf(m) >= 0; },
      why:'파생상품 만기 — 장 마감 동시호가에 프로그램 매매가 몰려 변동성이 커질 수 있습니다.' },
    { kind:'expiry-us', cat:'expiry', country:'US', imp:1, title:'미국 분기 만기 (쿼드러플 위칭)', months:[2, 5, 8, 11], status:'규칙', src:'CBOE',
      when:function (y, m) { return atET(nthDow(y, m, 5, 3), 16, 0); },
      why:'주가지수·개별주 선물·옵션 동시 만기 — 거래량 급증과 지수 리밸런싱이 겹칩니다.' }
  ];

  function refLabel(m, ref, quarter){
    if (quarter){ const q = Math.floor(((((m + ref) % 12) + 12) % 12) / 3) + 1; return q + '분기'; }
    return monthName(m + ref) + '분';
  }

  /* events.json 의 확정 일정 → 공통 형식 */
  function fromDB(e){
    const isFomc = e.kind === 'fomc' || (e.kind === 'macro' && /FOMC/.test(e.title || ''));
    if (isFomc){
      let x;
      if (e.date){ const p = e.date.split('-'); x = ymd(+p[0], +p[1] - 1, +p[2]); }
      else { const p = kst(e.t); x = ymd(p.y, p.m, p.d); }
      const sep = e.sep != null ? !!e.sep : [2, 5, 8, 11].indexOf(x.m) >= 0;
      const start = shift(x, -1);
      return [{
        kind:'fomc', cat:'rate', country:'US', imp:3, status:e.status || '확정', src:e.source || 'federalreserve.gov',
        title:'FOMC 기준금리 결정', t:atET(x, 14, 0),
        detail:(start.m + 1) + '/' + start.d + '~' + x.d + ' 회의 · 성명서 발표 후 의장 기자회견' + (sep ? ' · 경제전망(SEP)·점도표 공개' : ''),
        why:'미국 기준금리와 향후 경로 신호 — 달러·국채금리·성장주 밸류에이션에 가장 큰 영향을 주는 이벤트입니다.'
      }, {
        kind:'fomc-minutes', cat:'rate', country:'US', imp:2, status:'규칙', src:'federalreserve.gov',
        title:'FOMC 의사록 공개', t:atET(shift(x, 21), 14, 0),
        detail:(x.m + 1) + '월 회의 의사록 · 회의 3주 뒤 공개',
        why:'위원들의 금리 인하·인상 논의 온도를 확인할 수 있어 금리 선물 가격이 움직입니다.'
      }];
    }
    if (!e.kind || !isFinite(e.t)) return [];
    const rule = RULES.filter(function (r) { return r.kind === e.kind; })[0] || {};
    const ref = e.ref || (rule.ref != null ? refLabel(kst(e.t).m, rule.ref, rule.quarter) : '');
    return [{
      kind:e.kind, cat:e.cat || rule.cat || 'jobs', country:e.country || rule.country || 'US', imp:e.imp || rule.imp || 2,
      status:e.status || '확정', src:e.source || rule.src || '', title:e.title || rule.title || e.kind, t:e.t,
      detail:e.detail || ((ref ? ref + ' · ' : '') + '공식 발표 일정'), why:e.why || rule.why || ''
    }];
  }

  function macro(opts){
    opts = opts || {};
    const now = Date.now();
    const from = opts.from != null ? opts.from : (dayNo(now) * DAY - KST);          // 오늘 0시(KST)
    const to = opts.to != null ? opts.to : now + 120 * DAY;
    const out = [], confirmed = {};
    function mkey(kind, t){ const p = kst(t); return kind + '|' + p.y + '-' + p.m; }

    DB.macro.forEach(function (e) {
      fromDB(e).forEach(function (x) { confirmed[mkey(x.kind, x.t)] = 1; if (x.t >= from && x.t < to) out.push(x); });
    });

    const base = kst(now);
    for (let i = -1; i <= 5; i++){
      const y = base.y + Math.floor((base.m + i) / 12), m = ((base.m + i) % 12 + 12) % 12;
      RULES.forEach(function (r) {
        if (r.months && r.months.indexOf(m) < 0) return;
        const t = r.when(y, m);
        if (t == null || t < from || t >= to || confirmed[mkey(r.kind, t)]) return;
        const quad = r.quad && r.quad(m);
        out.push({
          kind:r.kind, cat:r.cat, country:r.country, imp:quad ? 2 : r.imp, status:r.status || '예상', src:r.src,
          title: quad ? '국내 선물·옵션 동시 만기일 (네 마녀의 날)' : r.title, t:t,
          detail:(r.ref != null ? refLabel(m, r.ref, r.quarter) + ' · ' : '') + (r.status === '규칙' ? '거래소 규정' : '과거 발표 패턴 기준 추정'),
          why:r.why
        });
      });
    }
    return out.filter(function (e) { return !opts.cat || e.cat === opts.cat; })
      .sort(function (a, b) { return a.t - b.t || b.imp - a.imp; });
  }

  /* =============================================================
     실적 시즌 캘린더 — 시장 주도 대형주
       rules: [발표월, 요일(0=일), 기준일] — 기준일 이후 첫 해당 요일
       when : bmo(미국 장 전) · amc(미국 장 마감 후) · tw(대만 오후) · eu(유럽 장 전) · kr(국내, 시각)
     ============================================================= */
  const EARN = [
    { code:'JPM',    name:'JP모건',          when:'bmo', tag:'대형은행 · 실적 시즌 개막', rules:[[0,2,11],[3,2,11],[6,2,11],[9,2,11]] },
    { code:'ASML',   name:'ASML',            when:'eu',  tag:'반도체 장비 수주',          rules:[[0,3,22],[3,3,13],[6,3,13],[9,3,13]] },
    { code:'TSM',    name:'TSMC',            when:'tw',  tag:'AI 반도체 파운드리 수요',    rules:[[0,4,14],[3,4,14],[6,4,14],[9,4,14]] },
    { code:'NFLX',   name:'넷플릭스',        when:'amc', tag:'빅테크 첫 타자',            rules:[[0,2,15],[3,2,15],[6,2,15],[9,2,15]] },
    { code:'TSLA',   name:'테슬라',          when:'amc', tag:'전기차 · 로보택시',         rules:[[0,3,22],[3,2,20],[6,3,20],[9,3,20]] },
    { code:'INTC',   name:'인텔',            when:'amc', tag:'파운드리 · PC 수요',        rules:[[0,4,22],[3,4,22],[6,4,22],[9,4,22]] },
    { code:'GOOGL',  name:'알파벳',          when:'amc', tag:'검색 · 클라우드',           rules:[[1,2,1],[3,4,22],[6,3,22],[9,3,24]] },
    { code:'MSFT',   name:'마이크로소프트',  when:'amc', tag:'Azure AI 클라우드',         rules:[[0,3,24],[3,3,24],[6,3,24],[9,3,24]] },
    { code:'META',   name:'메타',            when:'amc', tag:'광고 · AI 설비투자',        rules:[[0,3,24],[3,3,24],[6,3,24],[9,3,24]] },
    { code:'AAPL',   name:'애플',            when:'amc', tag:'아이폰 · 서비스',           rules:[[0,4,24],[3,4,28],[6,4,24],[9,4,24]] },
    { code:'AMZN',   name:'아마존',          when:'amc', tag:'AWS · 커머스',              rules:[[1,4,1],[3,4,28],[6,4,24],[9,4,24]] },
    { code:'PLTR',   name:'팔란티어',        when:'amc', tag:'AI 소프트웨어',             rules:[[1,1,1],[4,1,1],[7,1,1],[10,1,1]] },
    { code:'AMD',    name:'AMD',             when:'amc', tag:'AI GPU 경쟁',               rules:[[1,2,1],[4,2,1],[7,2,1],[10,2,1]] },
    { code:'NVDA',   name:'엔비디아',        when:'amc', tag:'AI 반도체 대장주',          rules:[[1,3,20],[4,3,22],[7,3,22],[10,3,15]], fiscal:true },
    { code:'AVGO',   name:'브로드컴',        when:'amc', tag:'AI ASIC · 네트워크',        rules:[[2,4,6],[5,4,6],[8,4,4],[11,4,8]], fiscal:true },
    { code:'ORCL',   name:'오라클',          when:'amc', tag:'AI 클라우드 수주잔고',      rules:[[2,2,9],[5,3,10],[8,2,8],[11,3,8]], fiscal:true },
    { code:'MU',     name:'마이크론',        when:'amc', tag:'HBM · 메모리 업황',         rules:[[2,3,18],[5,3,23],[8,3,20],[11,3,15]], fiscal:true },
    { code:'005930', name:'삼성전자',        when:'kr', at:8,  tag:'메모리 업황 선행지표', rules:[[0,2,5],[3,2,5],[6,2,5],[9,2,5]], prelim:true },
    { code:'373220', name:'LG에너지솔루션',  when:'kr', at:8,  tag:'2차전지 업황',     rules:[[0,1,6],[3,1,6],[6,1,6],[9,1,6]], prelim:true },
    { code:'000660', name:'SK하이닉스',      when:'kr', at:8,  tag:'HBM 실적 · 반도체 투톱',      rules:[[0,4,22],[3,4,22],[6,4,22],[9,4,22]] },
    { code:'005380', name:'현대차',          when:'kr', at:14, tag:'환율 · 관세 영향',            rules:[[0,4,22],[3,4,22],[6,4,24],[9,4,24]] }
  ];
  const WHEN_LABEL = { bmo:'장 시작 전', amc:'장 마감 후', tw:'대만 장 마감 후', eu:'유럽 장 시작 전' };

  function earnTime(e, x){
    if (e.when === 'bmo') return atET(x, 7, 0);
    if (e.when === 'amc') return atET(x, 16, 5);
    if (e.when === 'eu') return atET(x, 1, 0);          // 07:00 CET 전후
    if (e.when === 'tw') return atKST(x, 15, 0);        // 14:00 대만
    return atKST(x, e.at || 9, 0);
  }
  /* 발표월 기준 직전에 끝난 분기 (10·11월 → 3분기, 1·2월 → 4분기) */
  function quarterOf(m){ return Math.floor(((m + 11) % 12 + 1) / 3) || 4; }

  function earnings(opts){
    opts = opts || {};
    const now = Date.now();
    const from = opts.from != null ? opts.from : (dayNo(now) - 1) * DAY - KST;
    const to = opts.to != null ? opts.to : now + (opts.days || 75) * DAY;
    const fixed = {};
    (DB.earnings || []).forEach(function (e) { if (e.code && (isFinite(e.t) || e.date)) (fixed[e.code] = fixed[e.code] || []).push(e); });
    /* 수집 일정은 t(발표 시각) 또는 date(YYYY-MM-DD)+when 으로 들어온다 */
    function fixedT(f, e){
      if (isFinite(f.t)) return f.t;
      const p = String(f.date).split('-');
      return earnTime({ when:f.when || e.when, at:e.at }, ymd(+p[0], +p[1] - 1, +p[2]));
    }
    const base = kst(now), out = [];
    EARN.forEach(function (e) {
      for (let i = -1; i <= 4; i++){
        const y = base.y + Math.floor((base.m + i) / 12), m = ((base.m + i) % 12 + 12) % 12;
        e.rules.forEach(function (r) {
          if (r[0] !== m) return;
          let t = earnTime(e, onOrAfter(y, m, r[2], r[1])), status = '예상';
          const hit = (fixed[e.code] || []).filter(function (f) { return Math.abs(fixedT(f, e) - t) < 25 * DAY; })[0];
          if (hit){ t = fixedT(hit, e); status = hit.status || '확정'; }
          if (t < from || t >= to) return;
          const q = quarterOf(m);
          const when = hit && hit.when || e.when;
          /* 미국 기업은 현지(동부) 발표일도 함께 — 장 마감 후 발표는 한국시간으로 다음 날 새벽 */
          const loc = (when === 'bmo' || when === 'amc') ? kst(t - 14 * HOUR) : null;
          out.push({
            code:e.code, name:e.name, tag:e.tag, when:when, t:t, status:status,
            local: loc ? (loc.m + 1) + '/' + loc.d : null,
            title: e.fiscal ? '분기 실적 발표' : (e.prelim ? q + '분기 잠정실적' : q + '분기 실적 발표'),
            whenLabel: when === 'kr' ? ((e.at || 9) < 9 ? '장 시작 전' : '장 중') : (WHEN_LABEL[when] || '')
          });
        });
      }
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  /* 주 단위 묶음 (월요일 시작, KST) */
  function weekOf(t){
    const p = kst(t), mon = shift(ymd(p.y, p.m, p.d), -((p.w + 6) % 7)), sun = shift(mon, 6);
    const nth = Math.floor((mon.d - 1) / 7) + 1;
    return { key:key(mon), label:(mon.m + 1) + '월 ' + nth + '주차', range:(mon.m + 1) + '/' + mon.d + ' ~ ' + (sun.m + 1) + '/' + sun.d };
  }

  function consensus(code){
    const s = DB.symbols[code];
    if (!s || !s.targetMean) return null;
    const v = +String(s.targetMean).replace(/,/g, '');
    return isFinite(v) && v > 0 ? { target:v, recomm:s.recommMean, asOf:s.asOf } : null;
  }

  QT.Events = {
    load:load, macro:macro, earnings:earnings, weekOf:weekOf, consensus:consensus,
    fmtDate:fmtDate, fmtMD:fmtMD, fmtTime:fmtTime, dday:dday, countdown:countdown
  };
})(window.QT);

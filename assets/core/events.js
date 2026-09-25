/* =============================================================
   events.js — 주요 일정 (실적 · 배당 · 액면분할 · 주총 · 증시 일정)

   데이터 출처
     · 확정 : assets/data/events.json (FOMC 공시 일정, 야후 실제 배당 이력)
     · 규칙 : 거래소 규정으로 날짜가 정해지는 일정 (옵션만기, 분기보고서 법정기한, 배당락)
     · 예상 : 과거 패턴으로 추정한 일정 (실적 발표일, 정기주총) — 화면에 '예상'으로 표기
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const DAY = 86400000;

  let DB = { macro: [], symbols: {} };
  function load(db){ if (db) DB = { macro: db.macro || [], symbols: db.symbols || {} }; }

  function isWeekend(d){ const w = d.getDay(); return w === 0 || w === 6; }
  function prevBusiness(d){ const x = new Date(d); do { x.setDate(x.getDate() - 1); } while (isWeekend(x)); return x; }
  function lastBusinessOfMonth(y, m){ const x = new Date(y, m + 1, 0); while (isWeekend(x)) x.setDate(x.getDate() - 1); return x; }
  function nthWeekday(y, m, weekday, nth){
    const x = new Date(y, m, 1);
    let count = 0;
    while (true){
      if (x.getDay() === weekday){ count++; if (count === nth) return new Date(x); }
      x.setDate(x.getDate() + 1);
    }
  }
  function nextBusiness(d){ const x = new Date(d); while (isWeekend(x)) x.setDate(x.getDate() + 1); return x; }
  function atNoon(d){ const x = nextBusiness(d); x.setHours(9, 0, 0, 0); return x.getTime(); }
  /* 국내 증시는 12월 31일 휴장 — 연말 마지막 거래일 */
  function lastTradingDayOfYear(y){
    let d = lastBusinessOfMonth(y, 11);
    if (d.getMonth() === 11 && d.getDate() === 31) d = prevBusiness(d);
    return d;
  }
  function fmtDate(t){
    const d = new Date(t), w = ['일','월','화','수','목','금','토'][d.getDay()];
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + w + ')';
  }
  function dday(t){
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const n = Math.round((t - today.getTime()) / DAY);
    return n === 0 ? 'D-DAY' : n > 0 ? 'D-' + n : 'D+' + (-n);
  }

  /* ---------- 종목별 일정 ---------- */
  function forSymbol(st, limit){
    const now = Date.now(), out = [];
    const kr = st.cur !== 'USD';
    const saved = DB.symbols[st.code] || {};
    const y = new Date().getFullYear();

    /* 1) 실적 발표 (예상) — 분기 종료 후 KR 약 45일 / US 약 30일 */
    const lag = kr ? 45 : 30;
    [2, 5, 8, 11].forEach(function (qEndMonth) {
      [y - 1, y, y + 1].forEach(function (yy) {
        const qEnd = new Date(yy, qEndMonth + 1, 0);
        const t = atNoon(new Date(qEnd.getTime() + lag * DAY));
        if (t < now || t > now + 400 * DAY) return;
        const q = Math.floor(qEndMonth / 3) + 1;
        out.push({
          t:t, kind:'earnings', title:(yy + '년 ' + q + '분기 실적 발표'),
          detail: kr ? '12월 결산 기준 · 통상 분기 종료 후 6주 내외' : '분기 종료 후 3~5주 내외 발표',
          status:'예상'
        });
      });
    });

    /* 2) 분기·사업보고서 법정 제출기한 (국내, 규칙) */
    if (kr){
      [[4, 15, '1분기 보고서'], [7, 14, '반기 보고서'], [10, 14, '3분기 보고서'], [2, 31, '사업보고서(연간)']].forEach(function (r) {
        [y, y + 1].forEach(function (yy) {
          const t = atNoon(new Date(yy, r[0], r[1]));
          if (t < now || t > now + 400 * DAY) return;
          out.push({ t:t, kind:'filing', title:r[2] + ' 제출기한', detail:'자본시장법상 법정 공시 기한', status:'규칙' });
        });
      });
    }

    /* 3) 배당 */
    if (kr){
      [y, y + 1].forEach(function (yy) {
        const base = lastTradingDayOfYear(yy);                     // 12월 결산법인 배당기준일(연말 마지막 거래일)
        const ex = prevBusiness(base);
        const t = atNoon(ex);
        if (t < now || t > now + 400 * DAY) return;
        out.push({ t:t, kind:'dividend', title:'결산 배당락일 (예상)',
          detail:'배당기준일 ' + (base.getMonth() + 1) + '/' + base.getDate() + ' · 이 날 이후 매수 시 배당 권리 없음', status:'예상' });
      });
    } else if (saved.dividends && saved.dividends.length){
      const ds = saved.dividends, last = ds[ds.length - 1];
      const yieldTxt = (saved.yield ? ' · 배당수익률 ' + saved.yield : '') + (saved.annual ? ' · 연 $' + saved.annual : '');
      /* 공시된 다음 배당락일이 있으면 확정으로, 없으면 주기로 추정 */
      const declared = saved.nextEx ? Date.parse(saved.nextEx.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2')) : NaN;
      if (isFinite(declared) && declared >= now - DAY){
        out.push({ t:atNoon(new Date(declared)), kind:'dividend', title:'배당락일 (공시)',
          detail:'주당 $' + last.amount.toFixed(2) + (saved.nextPay ? ' · 지급 예정 ' + saved.nextPay : '') + yieldTxt,
          status:'확정' });
      } else {
        let gap = 91;
        if (ds.length >= 2) gap = Math.round((last.t - ds[ds.length - 2].t) / DAY) || 91;
        let next = last.t;
        while (next < now) next += gap * DAY;
        out.push({ t:atNoon(new Date(next)), kind:'dividend', title:'배당락일 (예상)',
          detail:'직전 배당 $' + last.amount.toFixed(2) + ' · ' + gap + '일 주기 추정' + yieldTxt, status:'예상' });
      }
      out.push({ t:last.t, kind:'dividend-past', title:'직전 배당락 · 주당 $' + last.amount.toFixed(2),
        detail:'실제 지급 이력' + (last.pay ? ' · 지급일 ' + last.pay : ''), status:'확정', past:true });
    }

    /* 4) 액면분할 이력 (미국, 실제) */
    if (saved.splits && saved.splits.length){
      const s = saved.splits[saved.splits.length - 1];
      out.push({ t:s.t, kind:'split', title:'액면분할 ' + s.ratio, detail:'실제 분할 이력', status:'확정', past:true });
    }

    /* 5) 정기 주주총회 (국내, 예상) */
    if (kr){
      [y, y + 1].forEach(function (yy) {
        const t = atNoon(nthWeekday(yy, 2, 5, 4));                // 3월 넷째 금요일
        if (t < now || t > now + 400 * DAY) return;
        out.push({ t:t, kind:'meeting', title:'정기 주주총회 (예상)', detail:'12월 결산법인 · 통상 3월 말 집중', status:'예상' });
      });
    }

    const upcoming = out.filter(function (e) { return !e.past; }).sort(function (a, b) { return a.t - b.t; });
    const past = out.filter(function (e) { return e.past; }).sort(function (a, b) { return b.t - a.t; });
    return upcoming.slice(0, limit || 6).concat(past.slice(0, 2));
  }

  /* ---------- 증시 공통 일정 ---------- */
  function market(limit){
    const now = Date.now(), out = [];
    DB.macro.forEach(function (m) {
      if (m.t >= now - DAY && m.t < now + 400 * DAY) out.push(Object.assign({ kind:'macro' }, m));
    });
    const y = new Date().getFullYear();
    for (let i = 0; i < 14; i++){
      const d = new Date(y, new Date().getMonth() + i, 1);
      const thu = nthWeekday(d.getFullYear(), d.getMonth(), 4, 2);  // 둘째 목요일
      const t = atNoon(thu);
      if (t < now || t > now + 400 * DAY) continue;
      const quad = [2, 5, 8, 11].indexOf(thu.getMonth()) >= 0;
      out.push({ t:t, kind:'expiry',
        title: quad ? '선물·옵션 동시 만기일 (네 마녀의 날)' : '지수 옵션 만기일',
        detail:'KRX 규정 · 매월 둘째 주 목요일' + (quad ? ' · 분기 동시만기로 변동성 확대 구간' : ''),
        status:'규칙' });
    }
    return out.sort(function (a, b) { return a.t - b.t; }).slice(0, limit || 8);
  }

  function consensus(code){
    const s = DB.symbols[code];
    return (s && s.targetMean) ? { target:s.targetMean, recomm:s.recommMean, asOf:s.asOf } : null;
  }

  QT.Events = { load:load, forSymbol:forSymbol, market:market, consensus:consensus, fmtDate:fmtDate, dday:dday };
})(window.QT);

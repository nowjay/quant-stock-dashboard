#!/usr/bin/env node
/* =============================================================
   verify_ta.js — 기술적 분석 검증 (브라우저 없이 node 로 assets/core 를 그대로 실행)

   node tools/verify_ta.js            ① 계산 검증만 (수 초) — 실패하면 종료 코드 1
   node tools/verify_ta.js --report   ② + 신뢰도 리포트 (과거 데이터로 실제 적중률 측정, 수십 초)
   node tools/verify_ta.js --report --n 300   리포트 대상 국내 종목 수 (시가총액 상위, 기본 150)

   ① 계산 검증
      · 지표: 교과서 RSI 예제 + 정의대로 다시 짠 참조 구현과 전 구간 비교 (SMA · EMA · RSI · MACD · 볼린저 · ATR · ADX)
      · 피봇 기준 봉(끝난 봉 / 진행 중인 봉) · 달력 주 · 월 피봇 · 봉 마감 시각 · 진행 중인 봉의 거래량 제외
      · 분석 신뢰도(데이터 품질) 판정 · 도달확률 · 신호 신뢰도 판정(겹치지 않는 표본 · 유의성)
      · 시장(종합 지수) 반영 — 급락 판단 · 점수 상한 · 과거 봉에 미래 지수를 쓰지 않는지
      · 평단가 기준 포지션 판단 — 손절선 · 익절선 · 추가 매수 조건
      · 캔들(연속 봉 · 꼬리 · 장악형 · 장대봉) 판정 · 추세추종 신호 · 점수 가감 (지표 점수 + 가감 = 종합 점수, 미래 봉 · 진행 중인 봉 미사용)
   ② 신뢰도 리포트 — '그 시점까지의 데이터만' 써서 과거 각 시점에 같은 계산을 적용
      · 종합 점수 등급별 10거래일 뒤 수익률 (같은 날 종목 평균 대비)
      · 목표가 · 손절가의 표시 도달확률 vs 실제 도달률 (보정 상태)
      · 종목별 '신호 신뢰도' 판정 분포
      · 시장 급락 상태별 강력 매수 다음 거래일 성적 (점수 상한의 근거 — assets/data/markets.json 의 지수 일봉 약 1년)
      · 평단가 기준 손절 2 ATR · 익절 3 ATR — 아무 날 종가에 샀을 때 어느 선에 먼저 닿았나
      · 캔들 · 추세추종 신호별 이후 수익률 (신호 가감의 근거 — 같은 날 종목 평균 대비)
   데이터: assets/data/krx/d (공공데이터 일봉, 있으면) + assets/data/history.json (번들 일봉)
   ============================================================= */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), REPORT = args.indexOf('--report') >= 0;
const N = +(args[args.indexOf('--n') + 1]) > 0 && args.indexOf('--n') >= 0 ? +args[args.indexOf('--n') + 1] : 150;

const win = { QT:{} };
const ctx = vm.createContext({ window:win, console:console, Intl:Intl, Date:Date, Math:Math, isFinite:isFinite,
  fetch:function () { return Promise.reject(new Error('fetch 없음')); } });
['market-data', 'indicators', 'candles', 'scoring', 'position', 'patterns', 'targets', 'analysis', 'backtest', 'signal'].forEach(function (m) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/core', m + '.js'), 'utf8'), ctx, { filename:m + '.js' });
});
const QT = win.QT, I = QT.Indicators, M = QT.Market;

function toBars(rows){ return rows.map(function (r) { return { t:r[0], o:r[1], h:r[2], l:r[3], c:r[4], v:r[5] }; }); }
function readJson(p){ try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { return null; } }
const HIST = (readJson('assets/data/history.json') || { items:{} }).items;
const KRX = readJson('assets/data/krx/quotes.json');
function universe(){
  const out = [];
  if (KRX) Object.keys(KRX.items).filter(function (c) { return KRX.items[c].t === 'stock'; })
    .sort(function (a, b) { return KRX.items[b].mc - KRX.items[a].mc; }).slice(0, N).forEach(function (c) {
      const rows = readJson('assets/data/krx/d/' + c + '.json');
      if (rows && rows.length >= 300) out.push({ code:c, cur:'KRW', bars:toBars(rows) });
    });
  Object.keys(HIST).forEach(function (c) {
    if (KRX && KRX.items[c]) return;
    if (HIST[c].length >= 300) out.push({ code:c, cur:/^[A-Z.]+$/.test(c) ? 'USD' : 'KRW', bars:toBars(HIST[c]) });
  });
  return out;
}

/* ---------------- ① 계산 검증 ---------------- */
let passed = 0;
function check(name, fn){
  try { fn(); passed++; }
  catch (e) { console.error('✗ ' + name + '\n  ' + (e.message || e).split('\n')[0]); process.exitCode = 1; }
}
function near(a, b, tol, msg){
  assert.strictEqual(a.length, b.length, msg + ' 길이');
  for (let i = 0; i < a.length; i++){
    if (a[i] == null || b[i] == null){ assert.ok(a[i] == null && b[i] == null, msg + ' [' + i + '] 값 유무'); continue; }
    assert.ok(Math.abs(a[i] - b[i]) <= tol * Math.max(1, Math.abs(b[i])), msg + ' [' + i + '] ' + a[i] + ' ≠ ' + b[i]);
  }
}
/* 참조 구현 — 정의를 그대로 옮긴 느리고 단순한 버전 */
const REF = {
  sma:function (a, p) { return a.map(function (_, i) { return i < p - 1 ? null : a.slice(i - p + 1, i + 1).reduce(function (s, v) { return s + v; }, 0) / p; }); },
  ema:function (a, p) {
    const out = new Array(a.length).fill(null); if (a.length < p) return out;
    out[p - 1] = a.slice(0, p).reduce(function (s, v) { return s + v; }, 0) / p;
    for (let i = p; i < a.length; i++) out[i] = out[i - 1] + 2 / (p + 1) * (a[i] - out[i - 1]);
    return out;
  },
  wilder:function (a, p, st) {
    const out = new Array(a.length).fill(null); st = st || 0; if (a.length - st < p) return out;
    out[st + p - 1] = a.slice(st, st + p).reduce(function (s, v) { return s + v; }, 0) / p;
    for (let i = st + p; i < a.length; i++) out[i] = out[i - 1] + (a[i] - out[i - 1]) / p;
    return out;
  },
  rsi:function (c, p) {
    const up = c.map(function (v, i) { return i ? Math.max(v - c[i - 1], 0) : 0; }), dn = c.map(function (v, i) { return i ? Math.max(c[i - 1] - v, 0) : 0; });
    const au = REF.wilder(up, p, 1), ad = REF.wilder(dn, p, 1);
    return c.map(function (_, i) { return au[i] == null ? null : ad[i] === 0 ? (au[i] === 0 ? 50 : 100) : 100 - 100 / (1 + au[i] / ad[i]); });
  },
  tr:function (b) { return b.map(function (x, i) { return i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l; }); },
  adx:function (b, p) {
    const n = b.length, T = REF.tr(b), pd = new Array(n).fill(0), md = new Array(n).fill(0); T[0] = 0;
    for (let i = 1; i < n; i++){ const u = b[i].h - b[i - 1].h, d = b[i - 1].l - b[i].l; pd[i] = u > d && u > 0 ? u : 0; md[i] = d > u && d > 0 ? d : 0; }
    const st = REF.wilder(T, p, 1), sp = REF.wilder(pd, p, 1), sm = REF.wilder(md, p, 1), dx = new Array(n).fill(0);
    let first = -1;
    for (let i = 0; i < n; i++) if (st[i]){ const a = sp[i] / st[i] * 100, c = sm[i] / st[i] * 100; dx[i] = a + c ? Math.abs(a - c) / (a + c) * 100 : 0; if (first < 0) first = i; }
    return REF.wilder(dx, p, first);
  }
};
function day(d, o, h, l, c, v){ return { t:Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 6, 30), o:o, h:h, l:l, c:c, v:v == null ? 1000 : v }; }

const sample = HIST['005930'] ? toBars(HIST['005930']) : (universe()[0] || {}).bars;
if (!sample){ console.error('검증할 일봉이 없습니다 (assets/data/history.json)'); process.exit(1); }
const cl = sample.map(function (b) { return b.c; }), ind = I.set(sample);

check('RSI 교과서 예제 (Wilder 14)', function () {
  const tb = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  /* vm 안에서 만든 배열은 프로토타입이 달라 Array.from 으로 옮겨서 비교한다 */
  assert.deepStrictEqual(Array.from(I.rsi(tb, 14).slice(14), function (v) { return +v.toFixed(2); }), [70.46, 66.25, 66.48, 69.35, 66.29, 57.92]);
});
check('지표 = 참조 구현 (전 구간)', function () {
  near(ind.sma20, REF.sma(cl, 20), 1e-9, 'SMA20'); near(ind.sma200, REF.sma(cl, 200), 1e-9, 'SMA200');
  near(ind.ema20, REF.ema(cl, 20), 1e-9, 'EMA20'); near(ind.rsi, REF.rsi(cl, 14), 1e-9, 'RSI');
  const f = REF.ema(cl, 12), s = REF.ema(cl, 26), line = cl.map(function (_, i) { return s[i] == null ? null : f[i] - s[i]; });
  near(ind.macd, line, 1e-9, 'MACD');
  const off = line.findIndex(function (v) { return v != null; });
  near(ind.macdSignal, new Array(off).fill(null).concat(REF.ema(line.slice(off), 9)), 1e-9, 'MACD 시그널');
  near(ind.atr, REF.wilder(REF.tr(sample), 14), 1e-9, 'ATR'); near(ind.adx, REF.adx(sample, 14), 1e-9, 'ADX');
  const up = cl.map(function (_, i) { if (i < 19) return null; const w = cl.slice(i - 19, i + 1), m = w.reduce(function (a, b) { return a + b; }, 0) / 20; return m + 2 * Math.sqrt(w.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / 20); });
  near(ind.bbUp, up, 1e-9, '볼린저 상단');
});
check('RSI — 무변동 구간은 50', function () { assert.strictEqual(I.rsi(new Array(30).fill(100), 14)[20], 50); });
check('피봇 — 끝난 봉이면 마지막 봉, 진행 중이면 직전 봉이 기준', function () {
  const last = sample[sample.length - 1], prev = sample[sample.length - 2];
  let c = QT.Analysis.core(sample, 'KRW');
  assert.strictEqual(c.pivot.P, (last.h + last.l + last.c) / 3); assert.strictEqual(c.pivot.t, last.t);
  assert.ok(c.pivot.S2 <= c.price && c.pivot.R2 >= c.price, '끝난 봉 기준이면 S2 ≤ 종가 ≤ R2');
  c = QT.Analysis.core(sample, 'KRW', { open:true });
  assert.strictEqual(c.pivot.P, (prev.h + prev.l + prev.c) / 3);
});
check('주간 · 월간 피봇 — 직전에 끝난 달력 주 · 월', function () {
  const b = [day('2026-08-28', 10, 12, 9, 11), day('2026-08-31', 11, 13, 10, 12), day('2026-09-01', 12, 14, 11, 13),
    day('2026-09-21', 20, 25, 19, 24), day('2026-09-22', 24, 26, 22, 23), day('2026-09-23', 23, 24, 18, 19), day('2026-09-24', 19, 21, 17, 20), day('2026-09-25', 20, 22, 19, 21),
    day('2026-09-28', 21, 23, 20, 22)];
  const hlc = function (x) { return x && [x.h, x.l, x.c]; };
  assert.deepStrictEqual(hlc(I.prevPeriod(b, '1W', false)), [26, 17, 21]);               // 월요일 마감 → 지난주
  assert.deepStrictEqual(hlc(I.prevPeriod(b.slice(0, 8), '1W', false)), [26, 17, 21]);   // 금요일 마감 → 방금 끝난 주
  assert.deepStrictEqual(hlc(I.prevPeriod(b.slice(0, 8), '1W', true)), [14, 10, 13]);    // 금요일 장중 → 그 전 주
  assert.deepStrictEqual(hlc(I.prevPeriod(b, '1M', false)), [13, 9, 12]);                // 9월 진행 중 → 8월
  const eom = b.concat([day('2026-09-29', 22, 23, 21, 22), day('2026-09-30', 22, 30, 21, 29)]);
  assert.deepStrictEqual(hlc(I.prevPeriod(eom, '1M', false)), [30, 11, 29]);             // 9월 말일 마감 → 9월
  assert.deepStrictEqual(hlc(I.prevPeriod(eom, '1M', true)), [13, 9, 12]);
  assert.strictEqual(I.prevPeriod(b.slice(0, 2), '1M', true), null);
});
check('봉 마감 시각 — 국내 15:30 KST · 미국 16:00 뉴욕(서머타임 반영)', function () {
  M.BY_CODE.__KR = { code:'__KR', cur:'KRW' }; M.BY_CODE.__US = { code:'__US', cur:'USD' };
  const kr = Date.UTC(2026, 8, 30, 6, 30), H = 3600000;
  M.setDaily('__KR', [day('2026-09-29', 1, 2, 1, 2), { t:kr, o:2, h:3, l:2, c:3, v:10 }], 'test');
  assert.strictEqual(M.barOpen('__KR', '1D', kr - 60000), true); assert.strictEqual(M.barOpen('__KR', '1D', kr), false);
  assert.strictEqual(M.barOpen('__KR', '1W', kr + H), true);                              // 수요일 마감 — 이번 주는 진행 중
  assert.strictEqual(M.barOpen('__KR', '1M', kr + H), false);                             // 9월 마지막 거래일 마감
  [[Date.UTC(2026, 8, 30), 20], [Date.UTC(2026, 11, 15), 21]].forEach(function (x) {       // 서머타임 20시 · 표준시 21시 (UTC)
    M.setDaily('__US', [{ t:x[0] - 86400000, o:1, h:2, l:1, c:2, v:1 }, { t:x[0], o:2, h:3, l:2, c:3, v:10 }], 'test');
    assert.strictEqual(M.barOpen('__US', '1D', x[0] + (x[1] - 0.5) * H), true); assert.strictEqual(M.barOpen('__US', '1D', x[0] + x[1] * H), false);
  });
  const fri = Date.UTC(2026, 8, 25, 6, 30);
  M.setDaily('__KR', [day('2026-09-24', 1, 2, 1, 2), { t:fri, o:2, h:3, l:2, c:3, v:10 }], 'test');
  assert.strictEqual(M.barOpen('__KR', '1W', fri + H), false); assert.strictEqual(M.barOpen('__KR', '1W', fri - H), true);
});
check('진행 중인 봉의 거래량은 점수에 넣지 않는다', function () {
  const tiny = sample.map(function (x) { return Object.assign({}, x); }), n = sample.length; tiny[n - 1].v = 1;
  const a = QT.Scoring.at(sample, ind, n - 1, { open:true }), b = QT.Scoring.at(tiny, I.set(tiny), n - 1, { open:true });
  assert.strictEqual(a.cats.volume, b.cats.volume);
  assert.strictEqual(QT.Scoring.at(sample, ind, 300, { open:true }).score, QT.Scoring.at(sample, ind, 300).score);   // 과거 봉은 그대로
});
check('분석 신뢰도(데이터 품질) 판정', function () {
  const q = QT.Analysis.quality, n = sample.length;
  assert.strictEqual(q(sample, { real:true }).level, 'high'); assert.strictEqual(q(sample, { real:false }).level, 'low');
  assert.strictEqual(q(sample.slice(-50), { real:true }).level, 'low'); assert.strictEqual(q(sample.slice(-150), { real:true }).level, 'mid');
  const halt = sample.map(function (x) { return Object.assign({}, x); });
  for (let i = n - 4; i < n; i++){ halt[i].v = 0; halt[i].o = halt[i].h = halt[i].l = halt[i].c = halt[i - 1].c; }
  assert.strictEqual(q(halt, { real:true }).level, 'low');
  assert.strictEqual(QT.Analysis.run(halt, { cur:'KRW' }, halt, { real:true }).targets, null);     // 낮음이면 목표가를 내지 않는다
  assert.strictEqual(QT.Analysis.run(sample, { cur:'KRW' }, sample, { real:false }).events.length, 0);
});
check('도달확률 — 0~1, 먼 목표일수록 낮고, 손절에도 표시', function () {
  const t = QT.Analysis.run(sample, { cur:'KRW' }, sample, { real:true }).targets;
  ['short', 'mid'].forEach(function (k) {
    ['bear', 'base', 'bull'].forEach(function (s) { assert.ok(t[k][s].prob > 0 && t[k][s].prob < 1); });
    assert.ok(t[k].bull.prob <= t[k].base.prob); assert.ok(t[k].stop.prob > 0 && t[k].stop.prob < 1);
  });
  assert.ok(t.sigmaP >= t.sigma);
});
check('신호 신뢰도 — 겹치지 않는 표본 · 유의성', function () {
  const R = QT.Backtest.reliability, h = { win:.5, loss:.5 };
  assert.strictEqual(R(0, { n:50, win:.6, loss:.4 }, h, 10).key, 'cls0'); assert.strictEqual(R(1, { n:0 }, h, 0).key, 'none');
  assert.strictEqual(R(1, { n:40, win:.7, loss:.3 }, h, 5).key, 'few');
  assert.strictEqual(R(1, { n:60, win:.6, loss:.4 }, h, 9).key, 'avg');                    // +10%p 여도 표본 9회면 우연 범위
  assert.strictEqual(R(1, { n:200, win:.75, loss:.25 }, h, 20).key, 'good');
  assert.strictEqual(R(-1, { n:200, win:.75, loss:.2 }, { win:.5, loss:.45 }, 20).key, 'bad');
  const s = QT.Backtest.signals(sample, ind, 10);
  assert.ok(s.rel && s.same.nEff <= s.same.n && s.base.nEff > 0);
});
/* 표본과 날짜가 같은 가상의 지수 — 하루 +0.1% 씩 오르다가 마지막 drops.length 일은 drops(%) 만큼 움직인다 */
function fakeIndex(drops, upto){
  const m = upto == null ? sample.length : upto, st = m - drops.length;
  let v = 1000;
  return { key:'KOSPI', name:'코스피', h:sample.slice(0, m).map(function (b, i) { v *= 1 + (i >= st ? drops[i - st] : 0.1) / 100; return [QT.Scoring.dayOf(b.t), v]; }) };
}
check('시장 반영 — 급락 판단 (당일 −2% · 3거래일 −3%) · 그 날짜까지의 지수만 사용', function () {
  const S = QT.Scoring, n = sample.length, dOf = function (i) { return S.dayOf(sample[i].t); };
  const calm = S.marketAt(fakeIndex([]), dOf(n - 1));
  assert.strictEqual(calm.risk, false); assert.ok(Math.abs(calm.d1 - 0.1) < 1e-9); assert.strictEqual(calm.day, dOf(n - 1));
  const crash = fakeIndex([-2.5]);
  assert.deepStrictEqual([S.marketAt(crash, dOf(n - 1)).risk, S.marketAt(crash, dOf(n - 1)).by], [true, 'day']);
  assert.strictEqual(S.marketAt(crash, dOf(n - 2)).risk, false);                             // 전날에는 아직 모르는 일
  assert.strictEqual(S.marketAt(crash, dOf(n - 2), true).risk, true);                        // '지금' 은 가장 최근 지수
  const slide = S.marketAt(fakeIndex([-1.2, -1.2, -1.2]), dOf(n - 1));
  assert.deepStrictEqual([slide.risk, slide.by], [true, 'd3']); assert.ok(slide.d1 > S.MARKET.day && slide.d3 <= S.MARKET.d3);
  assert.strictEqual(S.marketAt(fakeIndex([-1.2, -1.2]), dOf(n - 1)).risk, false);           // 이틀 −2.4% 는 기준 미달
  assert.strictEqual(S.marketAt(fakeIndex([], n - 30), dOf(n - 1)), null);                   // 지수 일봉이 한 달 비면 판단하지 않는다
  assert.strictEqual(S.marketAt(fakeIndex([], n - 30), dOf(n - 1), true), null);
  assert.strictEqual(S.marketAt({ key:'KOSPI', name:'코스피', h:fakeIndex([]).h.slice(100) }, dOf(50)), null);
  assert.strictEqual(S.marketAt(null, dOf(n - 1)), null);
  const live = Object.assign(fakeIndex([-0.5]), { r:-2.3, day:dOf(n - 1) });                 // 실시간 등락률이 일봉 계산보다 우선
  assert.strictEqual(S.marketAt(live, dOf(n - 1), true).d1, -2.3); assert.ok(Math.abs(S.marketAt(live, dOf(n - 1)).d1 + 0.5) < 1e-9);
});
check('시장 반영 — 급락이면 종합 점수 상한 +54 · 스크리너 기술 · 종합 79 (매수 이하는 그대로)', function () {
  const S = QT.Scoring, n = sample.length;
  let hi = -1, lo = -1;
  for (let i = n - 2; i >= 200 && (hi < 0 || lo < 0); i--){ const v = S.at(sample, ind, i).score; if (hi < 0 && v >= 55) hi = i; if (lo < 0 && v < 55) lo = i; }
  assert.ok(hi > 0 && lo > 0, '표본에 강력 매수인 날과 아닌 날이 모두 있어야 합니다');
  const own = S.at(sample, ind, hi), crash = fakeIndex([-3], hi + 1), calm = fakeIndex([], hi + 1);
  const cut = S.at(sample, ind, hi, { market:crash });
  assert.deepStrictEqual([cut.score, cut.own, cut.capped, S.verdictOf(cut.score)], [S.MARKET.cap, own.score, true, '매수']);
  assert.strictEqual(own.capped, false); assert.strictEqual(own.market, null);
  assert.deepStrictEqual([S.at(sample, ind, hi, { market:calm }).score, S.at(sample, ind, hi, { market:calm }).capped], [own.score, false]);
  const low = S.at(sample, ind, lo, { market:fakeIndex([-3], lo + 1) });
  assert.deepStrictEqual([low.score, low.capped, low.market.risk], [S.at(sample, ind, lo).score, false, true]);
  /* 다음 날의 급락: 과거 봉은 모르고, '지금'(now)으로 보는 마지막 봉만 가장 최근 지수를 쓴다 */
  const late = fakeIndex([-3], hi + 2), upto = sample.slice(0, hi + 1);
  assert.strictEqual(S.at(upto, ind, hi, { market:late }).capped, false);
  assert.strictEqual(S.at(upto, ind, hi, { market:late, now:true }).capped, true);
  assert.strictEqual(S.at(sample, ind, hi, { market:late, now:true }).capped, false);        // 마지막 봉이 아니면 그 날짜 기준
  const a = QT.Analysis.core(sample.slice(0, hi + 1), 'KRW', { market:crash });
  assert.deepStrictEqual([a.score, a.verdict, a.ownScore, a.ownVerdict, a.capped, a.market.risk], [S.MARKET.cap, '매수', own.score, '강력 매수', true, true]);
  /* 스크리너 */
  const G = QT.Signal;
  let ti = -1;
  for (let i = n - 1; i >= 200 && ti < 0; i--){ const t = G.tech(sample.slice(0, i + 1), ind); if (t && t.score >= 80) ti = i; }
  assert.ok(ti > 0, '표본에 기술 점수 80 이상인 날이 있어야 합니다');
  const bars = sample.slice(0, ti + 1), t0 = G.tech(bars, ind), t1 = G.tech(bars, ind, { key:'KOSPI', name:'코스피', d1:-3, d3:-4, risk:true });
  assert.deepStrictEqual([t1.score, t1.raw, t1.marketCut, G.grade(t1.score).key], [G.MARKET_CAP, t0.score, t0.score - G.MARKET_CAP, 'buy']);
  assert.deepStrictEqual([t0.marketCut, t0.raw, G.tech(bars, ind, { risk:false }).score], [0, t0.score, t0.score]);
  assert.ok(t1.tags.some(function (x) { return x.text === '#시장급락' && x.tone === 'bad'; }) && !t0.tags.some(function (x) { return x.text === '#시장급락'; }));
  const c1 = G.combine(t1, { score:100 }), c0 = G.combine(t0, { score:100 });
  assert.deepStrictEqual([c1.total, c1.own, c1.capped, c1.grade.key], [G.MARKET_CAP, c0.total, true, 'buy']);
  assert.deepStrictEqual([c0.capped, c0.own, G.combine(null, { score:90 }).capped, G.combine(t1, null).capped], [false, c0.total, false, true]);
  /* 종합이 매수 이하이면 기술 점수의 상한이 종합을 끌어내리지 않는다 (종합은 항목 합계로 계산) */
  const m1 = G.combine(t1, { score:40 }), m0 = G.combine(t0, { score:40 });
  assert.ok(m0.total < 80); assert.deepStrictEqual([m1.total, m1.own, m1.techRaw, m1.tech, m1.capped], [m0.total, m0.total, t0.score, G.MARKET_CAP, true]);
});
check('시장 반영 — 신호 신뢰도 백테스트도 같은 등급 기준', function () {
  const always = fakeIndex(sample.map(function () { return -2.5; }));                       // 매일 급락 → 강력 매수인 날이 없어야 한다
  const s = QT.Backtest.signals(sample, ind, 10, { market:always }), plain = QT.Backtest.signals(sample, ind, 10);
  assert.strictEqual(s.byClass['2'].n, 0); assert.ok(s.cls <= 1);
  assert.strictEqual(s.byClass['1'].n, plain.byClass['1'].n + plain.byClass['2'].n);
  assert.deepStrictEqual(QT.Backtest.signals(sample, ind, 10, { market:fakeIndex([]) }).byClass['2'].n, plain.byClass['2'].n);
});
check('평단가 기준 포지션 판단 — 손절선 · 익절선 · 추가 매수 조건', function () {
  const P = QT.Position, calm = { risk:false }, crash = { risk:true };
  const J = function (price, o) { return P.judge(Object.assign({ avg:10000, price:price, atr:500, score:40, market:calm }, o)); };
  const j = J(10000);
  assert.deepStrictEqual([j.stop.v, j.take.v, j.rule.stop, j.rule.take, j.pnl, j.pnlAtr], [9000, 11500, 2, 3, 0, 0]);       // 평단 − 2 ATR · + 3 ATR
  assert.ok(Math.abs(j.stop.pctAvg + 10) < 1e-9 && Math.abs(j.take.pctAvg - 15) < 1e-9 && Math.abs(j.avgPos - 0.4) < 1e-9 && Math.abs(j.pos - 0.4) < 1e-9);
  /* 선에 닿으면(같아도) 매도 */
  assert.deepStrictEqual([J(9000).action, J(9001).action === 'cut', J(8000).action, J(11500).action, J(11499).action === 'take', J(15000).action], ['cut', false, 'cut', 'take', false, 'take']);
  assert.deepStrictEqual([J(9000).label, J(11500).label, J(10000).label, J(11000).label], ['매도 · 손절', '매도 · 익절', '추가 매수 가능', '보유']);
  /* 추가 매수: 추세(매수 이상) · 시장 급락 아님 · 남은 폭(익절 ≥ 손절) 을 모두 만족할 때만 */
  const ok = function (x) { return Array.from(x.conds, function (c) { return c.ok; }); };       // vm 안의 배열은 프로토타입이 달라 옮겨서 비교
  assert.deepStrictEqual([J(10250).action, ok(J(10250))], ['add', [true, true, true]]);                                     // 익절까지 1250 = 손절까지 1250
  assert.deepStrictEqual([J(10251).action, ok(J(10251))], ['hold', [true, true, false]]);
  assert.deepStrictEqual([J(9500, { score:17 }).action, ok(J(9500, { score:17 })), J(9500, { score:18 }).action], ['hold', [false, true, true], 'add']);
  assert.deepStrictEqual([J(9500, { market:crash }).action, ok(J(9500, { market:crash })), J(9500, { market:null }).action], ['hold', [true, false, true], 'add']);
  assert.strictEqual(J(8900, { score:90 }).action, 'cut');                                                                  // 등급이 좋아도 손절선 아래면 손절
  /* 선까지 0.5 ATR 이내면 근접 */
  assert.deepStrictEqual([J(9250).near, J(9251).near, J(11250).near, J(11249).near, J(9000).near], ['stop', null, 'take', null, null]);
  /* 배수 조정 (0.5 단위 · 0.5~10) · 수량 */
  const w = J(10000, { rule:{ stop:1.5, take:6 }, qty:10 });
  assert.deepStrictEqual([w.stop.v, w.take.v, w.amount, J(10700, { qty:10 }).amount, J(10000).amount], [9250, 13000, 0, 7000, null]);
  assert.deepStrictEqual([P.mult(0.2, 2), P.mult(99, 2), P.mult(2.3, 2), P.mult(0, 2), P.mult(NaN, 3), P.mult(-1, 3)], [0.5, 10, 2.5, 2, 3, 3]);
  assert.deepStrictEqual([P.judge({ avg:0, price:100, atr:5 }), P.judge({ avg:100, price:100, atr:0 }), P.judge({ avg:100, price:null, atr:5 }), P.judge(null)], [null, null, null, null]);
  /* 실제 일봉: 분석 결과를 그대로 넣어도 같은 규칙 */
  const a = QT.Analysis.core(sample, 'KRW'), r = P.judge({ avg:a.price, price:a.price, atr:a.atr, score:a.score, market:a.market });
  assert.ok(Math.abs(r.stop.v - (a.price - 2 * a.atr)) < 1e-6 && Math.abs(r.take.v - (a.price + 3 * a.atr)) < 1e-6 && (r.action === 'add') === (a.score >= 18));
});
/* 캔들 검증용 일봉: 시가 = 종가 100 · 고저 ±1 인 봉 40개(ATR 2 · 20일선 100) 뒤에 rows([시, 고, 저, 종]) 를 붙인다 */
function candles(rows){
  const b = [];
  for (let i = 0; i < 40; i++) b.push([100, 101, 99, 100]);
  return b.concat(rows).map(function (r, i) { return { t:Date.UTC(2026, 0, 5, 6, 30) + i * 86400000, o:r[0], h:r[1], l:r[2], c:r[3], v:1000 }; });
}
/* 마지막 봉이 만든 key 신호 → [방향, 세기, 제목] (없으면 null) */
function candleSig(rows, key){
  const b = candles(rows), s = Array.from(QT.Candles.read(b, I.set(b), b.length - 1)).filter(function (x) { return x.key === key; })[0];
  return s ? [s.dir, +s.v.toFixed(2), s.title] : null;
}
const UP3 = [[100, 102, 100, 102], [102, 104, 102, 104], [104, 106, 104, 106]], DOWN3 = [[100, 100, 98, 98], [98, 98, 96, 96], [96, 96, 94, 94]];
check('캔들 — 연속 음봉 · 양봉 (3개부터 · 자리에 따라 세기 · 종가가 같은 방향으로 움직였을 때만)', function () {
  const top = [[100, 104, 100, 104], [104, 108, 104, 108], [108, 108.5, 106.5, 107], [107, 107.5, 105.5, 106]];
  assert.strictEqual(candleSig(top, 'run'), null);                                                        // 음봉 2개는 신호가 아니다
  assert.deepStrictEqual(candleSig(top.concat([[106, 106.5, 104.5, 105]]), 'run'), [-1, 0.6, '음봉 3연속 (흑삼병)']);     // 20일선 위 = 꺾이는 자리
  assert.deepStrictEqual(candleSig(top.concat([[106, 106.5, 104.5, 105], [105, 105.5, 103.5, 104]]), 'run'), [-1, 0.8, '음봉 4연속 (흑삼병)']);
  assert.deepStrictEqual(candleSig([[100, 100.5, 98.5, 99], [99, 99.5, 97.5, 98], [98, 98.5, 96.5, 97]], 'run'), [-1, 0.3, '음봉 3연속 (흑삼병)']);   // 20일선 아래 = 절반
  assert.deepStrictEqual(candleSig([[100, 100.5, 99.5, 99.9], [99.9, 100.4, 99.4, 99.8], [99.8, 100.3, 99.3, 99.7]], 'run'), [-1, 0.3, '음봉 3연속']);   // 몸통이 작으면 삼병은 아니다
  assert.strictEqual(candleSig([[101, 101.5, 100.2, 100.5], [102, 102.5, 101, 101.5], [103, 103.5, 102, 102.5]], 'run'), null);    // 갭으로 올라 종가는 오른 음봉들
  assert.deepStrictEqual(candleSig([[100, 100, 95, 95], [95, 95, 90, 90], [90, 91.5, 89.8, 91], [91, 92.5, 90.8, 92], [92, 93.5, 91.8, 93]], 'run'), [1, 0.6, '양봉 3연속 (적삼병)']);
  assert.deepStrictEqual(candleSig([[100, 101.5, 99.8, 101], [101, 102.5, 100.8, 102], [102, 103.5, 101.8, 103]], 'run'), [1, 0.3, '양봉 3연속 (적삼병)']);
  /* 시가 = 종가인 봉에서 끊긴다 */
  assert.deepStrictEqual(Array.from([0, 1].map(function (k) { const b = candles(top.concat([[106, 107, 105, 106], [106, 106.5, 104.5, 105]])); return QT.Candles.run(b, b.length - 1 - k).n; })), [1, 0]);
});
check('캔들 — 꼬리 (봉 길이의 절반 이상 · 직전 흐름에 따라 유성형 · 망치형 · 신호 없음)', function () {
  assert.deepStrictEqual(candleSig(UP3.concat([[106, 110, 105.8, 106.2]]), 'wick'), [-1, 0.8, '유성형 캔들 (긴 위꼬리)']);
  assert.deepStrictEqual(candleSig([[100, 104, 99.8, 100.2]], 'wick'), [-1, 0.5, '긴 위꼬리']);
  assert.strictEqual(candleSig(DOWN3.concat([[94, 98, 93.8, 94.2]]), 'wick'), null);                      // 하락 뒤 위꼬리(역망치형)
  assert.deepStrictEqual(candleSig(DOWN3.concat([[94, 94.2, 90, 93.8]]), 'wick'), [1, 0.8, '망치형 캔들 (긴 아래꼬리)']);
  assert.deepStrictEqual(candleSig([[100, 100.2, 96, 99.8]], 'wick'), [1, 0.5, '긴 아래꼬리']);
  assert.strictEqual(candleSig(UP3.concat([[106, 106.2, 102, 105.8]]), 'wick'), null);                    // 상승 뒤 아래꼬리(교수형)
  assert.strictEqual(candleSig([[100, 100.6, 99.9, 100]], 'wick'), null);                                 // 봉이 너무 짧다 (0.7 ATR 미만)
  assert.strictEqual(candleSig([[100, 102, 98, 100.1]], 'wick'), null);                                   // 양쪽 꼬리가 모두 길다
  assert.strictEqual(candleSig([[100, 103, 99, 102]], 'wick'), null);                                     // 꼬리가 봉 길이의 절반 미만
});
check('캔들 — 장악형 · 장대봉 · 도지', function () {
  assert.deepStrictEqual(candleSig([[100, 100.2, 98, 98.2], [98, 101.2, 97.8, 101]], 'body'), [1, 0.8, '상승 장악형 캔들']);
  assert.deepStrictEqual(candleSig(UP3.concat([[106, 108, 105.8, 107.8], [108, 108.2, 104.8, 105]]), 'body'), [-1, 0.8, '하락 장악형 캔들']);
  assert.deepStrictEqual(candleSig([[100, 104.2, 99.9, 104]], 'body'), [1, 0.5, '장대양봉']);
  assert.deepStrictEqual(candleSig([[100, 100.1, 95.8, 96]], 'body'), [-1, 0.5, '장대음봉']);
  assert.strictEqual(candleSig([[100, 103, 99.5, 102]], 'body'), null);                                   // 몸통 2 = 1 ATR — 장대봉 기준(1.5 ATR) 미달
  assert.deepStrictEqual(candleSig(UP3.concat([[106, 107, 105, 106.05]]), 'doji'), [0, 0, '도지 캔들']);
  assert.strictEqual(candleSig([[100, 101, 99, 100.05]], 'doji'), null);                                  // 직전 흐름이 없으면 도지도 보지 않는다
});
check('캔들 점수 — 연속 봉은 지금 상태, 꼬리 · 몸통은 3봉 동안 1 · 0.6 · 0.3', function () {
  const flat = [106, 107, 105, 106], star = UP3.concat([[106.2, 110, 105.8, 106]]);                      // 유성형(음봉) 뒤 시가 = 종가인 봉
  const vOf = function (rows) { const b = candles(rows), a = QT.Candles.at(b, I.set(b), b.length - 1); return [+a.v.toFixed(2), a.list.length]; };
  assert.deepStrictEqual([vOf(star), vOf(star.concat([flat])), vOf(star.concat([flat, flat])), vOf(star.concat([flat, flat, flat]))], [[-0.8, 1], [-0.48, 1], [-0.24, 1], [0, 0]]);
  /* 방향이 엇갈리면 서로 지우고, 합은 ±1 을 넘지 않는다 */
  const mix = candles([[100, 100.2, 98, 98.2], [98, 101.2, 97.8, 101], [101, 105, 100.8, 101.2]]), m = QT.Candles.at(mix, I.set(mix), mix.length - 1);
  assert.deepStrictEqual(Array.from(m.comps, function (c) { return [c.key, +c.v.toFixed(2)]; }), [['run', 0], ['wick', -0.5], ['body', 0.48]]);
  assert.strictEqual(+m.v.toFixed(2), -0.02);
  const many = candles([[100, 104, 100, 104], [104, 108, 104, 108], [108, 112, 107.8, 108.2], [108.2, 112, 106.2, 106.4], [106.4, 110, 104.8, 105]]);
  assert.strictEqual(QT.Candles.at(many, I.set(many), many.length - 1).v, -1);
});
check('추세추종 신호 — 크로스(20 · 60봉) · 20일 채널 돌파(10봉)에 걸쳐 약해짐', function () {
  const S = QT.Scoring, n = sample.length, W = S.SIGNAL.w;
  /* 참조 구현: 정의대로 뒤에서부터 훑는다 */
  function refCross(a, b, i, span){
    for (let j = i; j > i - span && j >= 1; j--){
      if (a[j] == null || b[j] == null || a[j - 1] == null || b[j - 1] == null) continue;
      if (a[j - 1] <= b[j - 1] && a[j] > b[j]) return W * (1 - (i - j) / span);
      if (a[j - 1] >= b[j - 1] && a[j] < b[j]) return -W * (1 - (i - j) / span);
    }
    return 0;
  }
  function refChan(i){
    for (let j = i; j > i - 10; j--){
      const w = sample.slice(j - 20, j), hi = Math.max.apply(null, w.map(function (x) { return x.h; })), lo = Math.min.apply(null, w.map(function (x) { return x.l; }));
      if (sample[j].c > hi) return W * (1 - (i - j) / 10); if (sample[j].c < lo) return -W * (1 - (i - j) / 10);
    }
    return 0;
  }
  const seen = { cross:0, xlong:0, chan:0 };
  for (let i = 210; i < n; i++){
    const f = S.signals(sample, ind, i).follow, v = {};
    f.comps.forEach(function (c) { v[c.key] = c.v; if (c.v) seen[c.key]++; });
    const ref = { cross:refCross(ind.sma20, ind.sma50, i, 20), xlong:refCross(ind.sma50, ind.sma200, i, 60), chan:refChan(i) };
    Object.keys(ref).forEach(function (k) { assert.ok(Math.abs(v[k] - ref[k]) < 1e-9, k + ' [' + i + '] ' + v[k] + ' ≠ ' + ref[k]); });
    const sum = Math.max(-1, Math.min(1, ref.cross + ref.xlong + ref.chan)), tr = ind.adx[i] == null ? 0.3 : Math.max(0, Math.min(1, (ind.adx[i] - 15) / 20));
    assert.ok(Math.abs(f.v - sum) < 1e-9); assert.ok(Math.abs(f.regime - (0.5 + 0.5 * tr)) < 1e-9);
    assert.ok(f.pts === Math.sign(sum) * Math.round(Math.abs(10 * sum * f.regime)), '추세추종 가감 [' + i + '] ' + f.pts);
    assert.strictEqual(f.list.length, f.comps.filter(function (c) { return c.v !== 0 || c.value === 0; }).length);
  }
  assert.ok(seen.cross && seen.chan, '표본에 20·50일선 크로스와 채널 돌파가 있어야 합니다 ' + JSON.stringify(seen));
});
check('신호 가감 — 지표 점수 + 캔들 · 추세추종 = 종합 점수 · 미래 봉 · 진행 중인 봉을 쓰지 않는다', function () {
  const S = QT.Scoring, n = sample.length;
  let moved = 0, same = 0;
  for (let i = 200; i < n; i++){
    const s = S.at(sample, ind, i), g = s.signals;
    /* 지표 점수(base)는 세 그룹의 가중 평균만으로 다시 계산해도 같다 — 신호 그룹이 섞여 들어가지 않는다 */
    let raw = 0, ws = 0;
    Object.keys(s.weights).forEach(function (k) { if (s.cats[k] != null){ raw += s.weights[k] * s.cats[k]; ws += s.weights[k]; } });
    assert.strictEqual(s.base, Math.max(-100, Math.min(100, Math.round(raw / ws * 125))));
    assert.strictEqual(s.own, Math.max(-100, Math.min(100, s.base + g.candle.pts + g.follow.pts)));
    assert.strictEqual(g.pts, g.candle.pts + g.follow.pts);
    assert.ok(g.candle.pts === Math.sign(g.candle.v) * Math.round(Math.abs(10 * g.candle.v)), '캔들 가감 [' + i + '] ' + g.candle.pts);
    assert.ok(Math.abs(g.candle.pts) <= S.SIGNAL.candle && Math.abs(g.follow.pts) <= S.SIGNAL.follow);
    assert.deepStrictEqual([s.cats.candle, s.cats.follow], [g.candle.v, g.follow.v]);
    if (g.pts) moved++; else { same++; assert.ok(s.own === s.base); }                                    // 신호가 없는 날은 지표 점수 그대로
  }
  assert.ok(moved && same, '표본에 신호가 있는 날과 없는 날이 모두 있어야 합니다');
  /* 과거 봉의 점수는 그 뒤의 봉이 있든 없든 같다 */
  [220, 300, n - 30, n - 2].forEach(function (i) {
    const cut = sample.slice(0, i + 1);
    assert.strictEqual(S.at(cut, I.set(cut), i).own, S.at(sample, ind, i).own);
  });
  /* 진행 중인 마지막 봉: 캔들 · 채널 돌파는 직전에 끝난 봉까지 — 그 봉의 시가 · 고가 · 저가가 어떻든 같다 */
  const live = sample.map(function (x) { return Object.assign({}, x); }), z = live[n - 1];
  z.o = z.l = z.c * 0.8; z.h = z.c;                                                                       // 꼬리 없는 +25% 양봉
  const a = S.signals(sample, ind, n - 1, { open:true }), b = S.signals(live, I.set(live), n - 1, { open:true });
  assert.strictEqual(a.candle.v, QT.Candles.at(sample, ind, n - 2).v);
  assert.deepStrictEqual([b.candle.v, b.candle.pts], [a.candle.v, a.candle.pts]);
  assert.strictEqual(Array.from(b.follow.comps).filter(function (c) { return c.key === 'chan'; })[0].v, Array.from(a.follow.comps).filter(function (c) { return c.key === 'chan'; })[0].v);
  assert.ok(Array.from(QT.Candles.read(live, I.set(live), n - 1)).some(function (x) { return x.key === 'body' && x.dir > 0; }));   // 끝난 봉이었다면 신호다
  /* 분석 결과 · 신호 카드 · 스크리너 기술 점수도 같은 신호 */
  const an = QT.Analysis.core(sample, 'KRW');
  assert.deepStrictEqual([an.score, an.scoring.base + an.scoring.signals.pts], [S.at(sample, ind, n - 1).score, an.ownScore]);
  for (let i = n - 60; i < n; i++){
    const cut = sample.slice(0, i + 1), t = QT.Signal.tech(cut, ind), g = S.signals(cut, ind, i), sum = t.parts.reduce(function (q, x) { return q + x.pts; }, 0);
    const half = (g.candle.pts + g.follow.pts) / 2, want = Math.sign(half) * Math.round(Math.abs(half));
    assert.strictEqual(t.raw, Math.max(0, Math.min(100, sum + want))); assert.strictEqual(t.adj.pts, t.raw - sum);
    assert.ok(Math.abs(t.adj.pts) <= 10);
  }
});
check('최근 신호 카드 — 캔들은 점수와 같은 판정 · 연속 봉은 마지막 날만 · 진행 중인 봉 제외', function () {
  const b = candles([[100, 104, 100, 104], [104, 108, 104, 108], [108, 108.5, 106.5, 107], [107, 107.5, 105.5, 106], [106, 106.5, 104.5, 105], [105, 105.5, 103.5, 104]]);
  const titles = function (bars, o) { return Array.from(QT.Patterns.detect(bars, I.set(bars), 60, o)).filter(function (e) { return e.kind === 'candle'; }).map(function (e) { return e.title + '@' + (bars.length - 1 - e.i); }); };
  assert.deepStrictEqual(titles(b), ['음봉 4연속 (흑삼병)@0', '장대양봉@4']);                               // 최근 5봉 · 3연속이던 전날은 남기지 않는다
  assert.deepStrictEqual(titles(b, { open:true }), ['음봉 3연속 (흑삼병)@1', '장대양봉@4']);
  const ev = Array.from(QT.Patterns.detect(b, I.set(b), 60)).filter(function (e) { return e.kind === 'candle' && e.dir < 0; })[0];
  assert.deepStrictEqual([ev.weight, ev.dir], [2, -1]);                                                    // 세기 0.8 이상은 차트 마커로도 표시
});
console.log(process.exitCode ? '계산 검증 실패' : '계산 검증 통과 (' + passed + '개 항목)');
if (!REPORT || process.exitCode) return;

/* ---------------- ② 신뢰도 리포트 ---------------- */
function mean(a){ return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : NaN; }
function pc(v){ return (v * 100).toFixed(1) + '%'; }
const uni = universe(), H = 10;
console.log('\n신뢰도 리포트 — ' + uni.length + '종목 (' + (KRX ? '공공데이터 시가총액 상위 + 번들' : '번들 일봉') + '), 그 시점까지의 데이터만 사용\n');

/* 종합 점수 등급 → 10거래일 뒤 수익률. 날짜가 같은 종목끼리 평균을 빼서 시장 전체 등락을 제거 */
(function () {
  const byDay = {}, rows = [];
  uni.forEach(function (u) {
    const b = u.bars, n = b.length, x = I.set(b);
    for (let i = 200; i < n - H; i++){
      const r = (b[i + H].c - b[i].c) / b[i].c * 100, k = u.cur + b[i].t;
      (byDay[k] = byDay[k] || []).push(r);
      const sc = QT.Scoring.at(b, x, i);
      rows.push({ k:k, r:r, c:QT.Scoring.classOf(sc.score), c0:QT.Scoring.classOf(sc.base) });
    }
  });
  const avg = {}; Object.keys(byDay).forEach(function (k) { avg[k] = mean(byDay[k]); });
  function table(key){
    [2, 1, 0, -1, -2].forEach(function (c) {
      const a = rows.filter(function (x) { return x[key] === c; });
      if (!a.length) return;
      console.log('   ' + (QT.Scoring.verdictOf([-70, -30, 0, 30, 70][c + 2]) + '      ').slice(0, 6) + ' n=' + String(a.length).padStart(6) +
        '  평균 ' + mean(a.map(function (x) { return x.r; })).toFixed(2).padStart(6) + '%  상승 ' + pc(a.filter(function (x) { return x.r > 0; }).length / a.length) +
        '  같은 날 종목 평균 대비 ' + mean(a.map(function (x) { return x.r - avg[x.k]; })).toFixed(2) + '%p');
    });
  }
  console.log('① 종합 점수 등급별 ' + H + '거래일 뒤 수익률 (종목 자체 점수 — 시장 반영 전)');
  table('c');
  console.log('   (비교) 캔들 · 추세추종 신호를 더하기 전 — 지표 점수만으로 매긴 등급');
  table('c0');
  console.log('   → 등급이 높을수록 초과수익이 커야 예측력이 있는 것. 차이가 작거나 뒤집혀 있으면 등급은 "현재 추세 상태"로만 읽어야 합니다.\n');
})();

/* 목표가 · 손절가: 표시 도달확률 vs 실제 */
(function () {
  const cal = {}, verdicts = {};
  function add(key, p, hit){ const c = cal[key] = cal[key] || { n:0, p:0, h:0 }; c.n++; c.p += p; c.h += hit ? 1 : 0; }
  uni.forEach(function (u) {
    const b = u.bars, n = b.length, st = { cur:u.cur };
    for (let i = Math.max(260, n - 220); i < n - H; i += 5){
      const slice = b.slice(0, i + 1), d = QT.Analysis.core(slice, u.cur), t = QT.Targets.build(slice, d, st);
      if (!t) continue;
      [['short', 10, '단기  '], ['mid', 42, '중장기']].forEach(function (z) {
        if (i + z[1] >= n) return;
        let hi = -Infinity, lo = Infinity;
        for (let j = i + 1; j <= i + z[1]; j++){ hi = Math.max(hi, b[j].h); lo = Math.min(lo, b[j].l); }
        ['bear', 'base', 'bull'].forEach(function (s) { const x = t[z[0]][s]; add(z[2] + ' ' + (s + ' ').slice(0, 4), x.prob, x.v >= t.price ? hi >= x.v : lo <= x.v); });
        add(z[2] + ' 손절', t[z[0]].stop.prob, lo <= t[z[0]].stop.v);
      });
    }
    const sig = QT.Backtest.signals(b, I.set(b), H);
    verdicts[sig.rel.key] = (verdicts[sig.rel.key] || 0) + 1;
  });
  console.log('② 목표가 · 손절가 도달확률 보정 (표시한 확률 평균 → 실제 도달률)');
  Object.keys(cal).forEach(function (k) { const c = cal[k]; console.log('   ' + k + '  n=' + String(c.n).padStart(5) + '  ' + pc(c.p / c.n).padStart(6) + ' → ' + pc(c.h / c.n)); });
  console.log('   → 도달확률은 추세를 넣지 않은 값이라, 시장이 오른 기간에는 위쪽 목표의 실제 도달률이 더 높고 손절은 더 낮게 나옵니다.\n');
  console.log('③ 종목별 신호 신뢰도 판정 분포 (오늘 등급 기준)');
  console.log('   ' + JSON.stringify(verdicts) + '\n   good/bad = 기저와 유의하게 다름, avg = 우연 범위, few = 겹치지 않는 표본 8회 미만, cls0 = 중립 등급');
})();

/* 시장(종합 지수) 반영의 근거 — 종목 자체 점수가 강력 매수인 날을 그날의 지수 상태로 나눠 다음 거래일을 본다 */
(function () {
  const MK = (readJson('assets/data/markets.json') || { items:{} }).items, S = QT.Scoring;
  const SYM = {}; ((readJson('assets/data/symbols.json') || {}).items || []).forEach(function (x) { SYM[x.c] = x.m; });
  const BENCH = { KOSPI:'KOSPI', KOSDAQ:'KOSDAQ', NASDAQ100:'IXIC', 'S&P500':'SPX', US:'IXIC' }, NAME = { KOSPI:'코스피', KOSDAQ:'코스닥', IXIC:'나스닥', SPX:'S&P 500' };
  const g = {};
  uni.forEach(function (u) {
    const k = BENCH[(KRX && KRX.items[u.code] && KRX.items[u.code].m) || SYM[u.code]], it = k && MK[k];
    if (!it || !it.h) return;
    const mk = { key:k, name:NAME[k], h:it.h }, b = u.bars, n = b.length, x = I.set(b);
    for (let i = 200; i < n - 1; i++){
      const sc = S.at(b, x, i, { market:mk });
      if (sc.own < 55) continue;
      const key = (u.cur === 'USD' ? '미국' : '국내') + ' · ' + (!sc.market ? '지수 일봉 없음' : sc.market.risk ? '시장 급락    ' : '그 밖        ');
      (g[key] = g[key] || []).push({ r1:(b[i + 1].c / b[i].c - 1) * 100, r10:i + H < n ? (b[i + H].c / b[i].c - 1) * 100 : null });
    }
  });
  console.log('\n④ 시장(종합 지수) 반영 — 종목 자체 점수가 강력 매수인 날의 다음 거래일 (급락 = 소속 지수 당일 ≤ ' + S.MARKET.day + '% 또는 3거래일 ≤ ' + S.MARKET.d3 + '%)');
  Object.keys(g).sort().forEach(function (k) {
    const a = g[k], r10 = a.filter(function (q) { return q.r10 != null; }).map(function (q) { return q.r10; });
    console.log('   ' + k + ' n=' + String(a.length).padStart(6) + '  −5% 이하 ' + pc(a.filter(function (q) { return q.r1 <= -5; }).length / a.length).padStart(6) +
      '  +5% 이상 ' + pc(a.filter(function (q) { return q.r1 >= 5; }).length / a.length).padStart(6) + '  평균 ' + mean(a.map(function (q) { return q.r1; })).toFixed(2).padStart(6) + '%' +
      '  · ' + H + '거래일 뒤 평균 ' + mean(r10).toFixed(2).padStart(6) + '%');
  });
  console.log('   → 급락 상태의 −5% 이하 비율이 그 밖보다 뚜렷이 높아야 점수 상한(강력 매수 → 매수)의 근거가 있습니다.\n' +
    '     ' + H + '거래일 뒤 수익률까지 낮지는 않다면 하락 예측이 아니라 변동폭 경고입니다 — 등급을 매도로 내리지 않는 이유입니다.');
})();

/* 평단가 기준 손절 · 익절(core/position.js)의 기본 배수가 실제로 어떤 폭인지 — 아무 날 종가에 사서 그 가격을 평단가로 둔다.
   앱은 '지금'의 ATR 로 선을 다시 긋지만 여기서는 산 날의 ATR 로 고정한다(나중 변동성을 미리 알 수 없으므로) */
(function () {
  const R = QT.Position.RULE, S = QT.Scoring, W = [10, 20, 60], g = {};
  function add(key, o){ const x = g[key] = g[key] || { n:0, stop:0, take:0, none:0, ret:0, hold:0, gap:0 }; x.n++; x[o.hit]++; x.ret += o.ret; x.hold += o.hold; x.gap += o.gap; }
  uni.forEach(function (u) {
    if (u.cur !== 'KRW') return;
    const b = u.bars, n = b.length, x = I.set(b);
    for (let i = 200; i < n - W[W.length - 1]; i += 3){
      const p = b[i].c, atr = x.atr[i]; if (!(atr > 0)) continue;
      const stop = p - R.stop * atr, take = p + R.take * atr, strong = S.at(b, x, i).score >= 55;
      W.forEach(function (w) {
        const hold = (b[i + w].c / p - 1) * 100;
        let hit = 'none', ret = hold;
        /* 같은 봉에서 두 선에 모두 닿으면 일봉으로는 순서를 알 수 없다 — 보수적으로 손절 먼저 */
        for (let k = i + 1; k <= i + w && hit === 'none'; k++){ if (b[k].l <= stop){ hit = 'stop'; ret = (stop / p - 1) * 100; } else if (b[k].h >= take){ hit = 'take'; ret = (take / p - 1) * 100; } }
        const o = { hit:hit, ret:ret, hold:hold, gap:atr / p * 100 };
        add(w + '|전체          ', o); if (strong) add(w + '|강력 매수인 날에 삼', o);
      });
    }
  });
  console.log('\n⑤ 평단가 기준 손절 ' + R.stop + ' ATR · 익절 ' + R.take + ' ATR — 국내 종목을 아무 날 종가에 샀을 때 (먼저 닿은 선에서 판 것으로 계산)');
  Object.keys(g).sort(function (a, b) { return parseInt(a) - parseInt(b) || (a < b ? -1 : 1); }).forEach(function (k) {
    const x = g[k], z = k.split('|');
    console.log('   ' + z[0].padStart(2) + '거래일 안 · ' + z[1] + ' n=' + String(x.n).padStart(6) + '  손절선 먼저 ' + pc(x.stop / x.n).padStart(6) + '  익절선 먼저 ' + pc(x.take / x.n).padStart(6) +
      '  둘 다 안 닿음 ' + pc(x.none / x.n).padStart(6) + '  평균 손익 ' + (x.ret / x.n).toFixed(2).padStart(6) + '%  · 선 없이 그냥 보유 ' + (x.hold / x.n).toFixed(2).padStart(6) + '%  (ATR 평균 ' + (x.gap / x.n).toFixed(1) + '%)');
  });
  console.log('   → 손절선이 익절선보다 가까워(2 대 3) 추세가 없다면 손절 60% · 익절 40% 로 닿는 것이 기대값입니다. 평균 손익이 그냥 보유보다 높지 않다면\n' +
    '     이 규칙은 수익을 늘리는 장치가 아니라 한 번의 손실 · 이익 폭을 미리 정해 두는 장치입니다. 상승장 구간의 수치라 다른 장세에서는 달라집니다.');
})();

/* 캔들 · 추세추종 신호 뒤의 수익률 — 신호 가감(scoring.js SIGNAL · candles.js)의 방향과 크기를 정한 근거.
   같은 날 여러 종목에서 나온 신호는 한 표본으로 묶고(시장이 함께 움직이므로), 기간이 겹치는 만큼 √일수 로 나눠 t 를 보수적으로 잡는다 */
(function () {
  const HS = [1, 5, 10], S = QT.Scoring, byDay = {}, g = {}, order = [];
  let all = 0, moved = 0, flip = 0;
  function add(name, k, rs){ if (!g[name]){ g[name] = []; order.push(name); } g[name].push({ k:k, r:rs }); }
  function sd(a){ const m = mean(a); return Math.sqrt(a.reduce(function (q, v) { return q + (v - m) * (v - m); }, 0) / Math.max(1, a.length - 1)); }
  uni.forEach(function (u) {
    const b = u.bars, n = b.length, x = I.set(b);
    for (let i = 200; i < n - HS[2]; i++){
      const k = u.cur + b[i].t, rs = HS.map(function (h) { return (b[i + h].c / b[i].c - 1) * 100; });
      (byDay[k] = byDay[k] || []).push(rs);
      const sc = S.at(b, x, i), sg = sc.signals;
      all++; if (sg.pts){ moved++; if (S.classOf(sc.own) !== S.classOf(sc.base)) flip++; }
      QT.Candles.read(b, x, i).forEach(function (c) {
        /* 연속 봉은 자리(20일선 위 · 아래)에 따라 세기가 다르다 — 세기 0.6 이상이 '흐름이 바뀌는 자리' */
        const name = c.key !== 'run' ? c.title : (c.dir < 0 ? '음봉' : '양봉') + ' 3연속 이상 · 20일선 ' + ((c.v >= 0.6) === (c.dir < 0) ? '위' : '아래');
        add('캔들     ' + name, k, rs);
      });
      sg.follow.list.forEach(function (f) { if (f.ago === 0) add('추세추종 ' + f.title + ' 당일', k, rs); });
      const reg = sc.regime === 'trend' ? '추세장(ADX 25↑)' : sc.regime === 'range' ? '횡보장(ADX 20↓)' : null;
      sg.follow.list.forEach(function (f) { if (f.key === 'cross' && reg) add('추세추종 ' + f.title + ' 20봉 안 · ' + reg, k, rs); });
      [['캔들 가감', sg.candle.pts, 5], ['추세추종 가감', sg.follow.pts, 5], ['가감 합계', sg.pts, 8]].forEach(function (z) {
        if (Math.abs(z[1]) >= z[2]) add('점수     ' + z[0] + (z[1] > 0 ? ' +' : ' −') + z[2] + '점 ' + (z[1] > 0 ? '이상' : '이하'), k, rs);
      });
    }
  });
  const avg = {};
  Object.keys(byDay).forEach(function (k) { avg[k] = HS.map(function (_, h) { return mean(byDay[k].map(function (r) { return r[h]; })); }); });
  const width = function (t) { return t.replace(/[^\x00-\xff]/g, 'xx').length; };
  console.log('\n⑥ 캔들 · 추세추종 신호 뒤의 수익률 — 같은 날 종목 평균 대비 (%p), 괄호는 t (|t| 2 미만이면 우연과 구분되지 않음)');
  console.log('   신호 가감이 0 이 아닌 날 ' + pc(moved / all) + ' · 그 때문에 등급이 바뀐 날 ' + pc(flip / all) + ' (전체 ' + all + '봉)');
  console.log('   ' + ' '.repeat(54) + '      n   ' + HS.map(function (h) { const t = h + '거래일 뒤'; return ' '.repeat(15 - width(t)) + t; }).join('  '));
  order.sort().forEach(function (name) {
    const a = g[name];
    console.log('   ' + name + ' '.repeat(Math.max(1, 54 - width(name))) + String(a.length).padStart(7) + '   ' + HS.map(function (h, hi) {
      const d = {}; a.forEach(function (q) { (d[q.k] = d[q.k] || []).push(q.r[hi] - avg[q.k][hi]); });
      const dm = Object.keys(d).map(function (k) { return mean(d[k]); }), ex = mean(a.map(function (q) { return q.r[hi] - avg[q.k][hi]; }));
      const t = dm.length > 2 ? mean(dm) / (sd(dm) / Math.sqrt(dm.length)) / Math.sqrt(h) : NaN;
      return ((ex >= 0 ? '+' : '') + ex.toFixed(2)).padStart(7) + (' (' + (isFinite(t) ? t.toFixed(1) : '—') + ')').padStart(8);
    }).join('  '));
  });
  console.log('   → 신호의 방향(음봉 연속 · 위꼬리 · 데드크로스 = 감점, 그 반대 = 가점)은 통상적인 해석을 따른 것입니다. 위 표에서 |t| 가 2 를 넘지 못하면\n' +
    '     그 신호가 수익률을 가른다는 증거는 없다는 뜻이라, 가감 폭을 그룹별 ±' + S.SIGNAL.candle + '점(등급 한 칸 37점의 4분의 1 남짓)으로 묶어 둡니다.\n' +
    '     표가 20개가 넘어 우연히 |t| 2 를 넘는 줄이 한둘 나올 수 있습니다 — 한 줄만 보고 판단하지 마세요.');
})();

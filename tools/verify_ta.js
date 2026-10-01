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
   ② 신뢰도 리포트 — '그 시점까지의 데이터만' 써서 과거 각 시점에 같은 계산을 적용
      · 종합 점수 등급별 10거래일 뒤 수익률 (같은 날 종목 평균 대비)
      · 목표가 · 손절가의 표시 도달확률 vs 실제 도달률 (보정 상태)
      · 종목별 '신호 신뢰도' 판정 분포
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
['market-data', 'indicators', 'scoring', 'patterns', 'targets', 'analysis', 'backtest', 'signal'].forEach(function (m) {
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
      rows.push({ k:k, r:r, c:QT.Scoring.classOf(QT.Scoring.at(b, x, i).score) });
    }
  });
  const avg = {}; Object.keys(byDay).forEach(function (k) { avg[k] = mean(byDay[k]); });
  console.log('① 종합 점수 등급별 ' + H + '거래일 뒤 수익률');
  [2, 1, 0, -1, -2].forEach(function (c) {
    const a = rows.filter(function (x) { return x.c === c; });
    if (!a.length) return;
    console.log('   ' + (QT.Scoring.verdictOf([-70, -30, 0, 30, 70][c + 2]) + '      ').slice(0, 6) + ' n=' + String(a.length).padStart(6) +
      '  평균 ' + mean(a.map(function (x) { return x.r; })).toFixed(2).padStart(6) + '%  상승 ' + pc(a.filter(function (x) { return x.r > 0; }).length / a.length) +
      '  같은 날 종목 평균 대비 ' + mean(a.map(function (x) { return x.r - avg[x.k]; })).toFixed(2) + '%p');
  });
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

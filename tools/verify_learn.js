#!/usr/bin/env node
/* =============================================================
   verify_learn.js — '주식 공부' 학습 내용 검증 (브라우저 없이 node 로 assets/learn 을 그대로 실행)

   node tools/verify_learn.js        실패하면 종료 코드 1

   ① 구조      주제 id 중복 · 단원 · 난이도 · 관련 주제 · 그림 · 앱 연결 · 확인 문제(보기 4개 · 정답 번호) · 태그 짝
   ② 숫자 예시  본문에 적힌 계산 결과를 여기서 다시 계산해, 같은 숫자가 본문에 실제로 적혀 있는지 확인
   ③ 앱과 일치  지표 설명(기간 · 계산식)이 assets/core 의 실제 계산과 같은지 — 같은 입력으로 앱 함수를 돌려 비교
   ④ 그림      예시 주가 그림에 설명한 사건(골든크로스 · 과매수/과매도 · 스퀴즈)이 실제로 들어 있는지
   ⑤ 실제 데이터 "볼린저 밴드 안에 종가의 약 90%" 를 번들 일봉으로 측정
   ⑥ 제도 수치  세율 · 가격제한폭 · 결제일 등 검토를 마친 문구가 바뀌지 않았는지 (바꿀 때는 아래 FACTS 도 함께 고친다)
   ============================================================= */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

const win = { QT:{} };
const ctx = vm.createContext({ window:win, console:console, Math:Math });
['assets/core/indicators.js', 'assets/learn/chapters.js', 'assets/learn/figs.js', 'assets/learn/data-basics.js', 'assets/learn/data-bond.js',
 'assets/learn/data-tech.js', 'assets/learn/data-value.js', 'assets/learn/data-macro.js', 'assets/learn/data-strategy.js', 'assets/learn/data-product.js']
  .forEach(function (f) { vm.runInContext(read(f), ctx, { filename:f }); });
const QT = win.QT, D = QT.LearnData, F = QT.LearnFigs, I = QT.Indicators;

let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); passed++; }
  catch (e) { failed++; console.error('✗ ' + name + '\n  ' + String(e.message || e).split('\n')[0]); process.exitCode = 1; }
}
const won = function (v) { return Math.round(v).toLocaleString('ko-KR'); };
const textOf = function (id) { assert.ok(D.byId[id], '주제 없음: ' + id); return JSON.stringify(D.byId[id]); };
/** 주제 본문에 이 문자열들이 적혀 있는가 */
function says(id){
  const t = textOf(id);
  Array.prototype.slice.call(arguments, 1).forEach(function (s) { assert.ok(t.indexOf(s) >= 0, id + ': 본문에 "' + s + '" 가 없습니다'); });
}
/** 확인 문제의 정답 보기가 이 값인가 */
function answer(id, s){
  const q = D.byId[id].quiz;
  assert.strictEqual(q.a[q.ok], s, id + ' 확인 문제 정답: "' + q.a[q.ok] + '" ≠ "' + s + '"');
}
const near = function (a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol == null ? 1e-9 : tol), (msg || '') + ' ' + a + ' ≠ ' + b); };

/* ================= ① 구조 ================= */
check('단원 · 주제 구성', function () {
  assert.strictEqual(D.chapters.length, 8);
  assert.ok(D.topics.length >= 80, '주제 수 ' + D.topics.length);
  const seen = {};
  D.topics.forEach(function (t) { assert.ok(!seen[t.id], 'id 중복: ' + t.id); seen[t.id] = 1; assert.ok(/^[a-z]+$/.test(t.id), 'id 형식: ' + t.id); });
  D.chapters.forEach(function (c) { assert.ok(D.topics.some(function (t) { return t.ch === c.id; }), '빈 단원: ' + c.id); });
});
D.topics.forEach(function (t) {
  check('구조: ' + t.id, function () {
    assert.ok(D.chapters.some(function (c) { return c.id === t.ch; }), '단원');
    assert.ok([1, 2, 3].indexOf(t.lv) >= 0, '난이도');
    ['t', 'sum', 'kw'].forEach(function (k) { assert.ok(typeof t[k] === 'string' && t[k].length > 1, k); });
    assert.ok(Array.isArray(t.body) && t.body.length >= 2, '본문 문단');
    (t.rel || []).forEach(function (r) { assert.ok(D.byId[r], '관련 주제 없음: ' + r); assert.notStrictEqual(r, t.id, '자기 자신을 가리킴'); });
    assert.ok(t.rel && t.rel.length >= 2, '관련 주제 2개 이상');
    if (t.fig) assert.ok(F.has(t.fig), '그림 없음: ' + t.fig);
    if (t.fig) assert.ok(t.figcap, '그림 설명');
    if (t.app) assert.ok(['chart', 'value', 'macro', 'home'].indexOf(t.app) >= 0, 'app');
    (t.formula || []).forEach(function (f) { assert.ok(f.length === 2 && f[1], '계산식 형식'); });
    if (t.ex) assert.ok(t.ex.t && t.ex.rows.length, '예시');
    if (t.tbl) t.tbl.rows.forEach(function (r) { assert.strictEqual(r.length, t.tbl.head.length, '표 열 수'); });
    const q = t.quiz;
    assert.ok(q && q.q && q.why, '확인 문제');
    assert.strictEqual(q.a.length, 4, '보기 4개');
    assert.strictEqual(new Set(q.a).size, 4, '보기 중복');
    assert.ok(Number.isInteger(q.ok) && q.ok >= 0 && q.ok < 4, '정답 번호');
    const s = JSON.stringify(t);
    assert.ok(!/undefined|NaN|Infinity/.test(s), 'undefined/NaN');
    assert.strictEqual((s.match(/<b>/g) || []).length, (s.match(/<\/b>/g) || []).length, '<b> 짝');
    assert.ok(!/<(?!\/?(b|br)>)/.test(s.replace(/\\u003c/g, '<').replace(/ < | > /g, ' ')), '허용하지 않은 태그');
  });
});
check('정답 번호가 한쪽으로 쏠리지 않음', function () {
  const n = [0, 0, 0, 0];
  D.topics.forEach(function (t) { n[t.quiz.ok]++; });
  n.forEach(function (v, i) { assert.ok(v >= D.topics.length * 0.08, (i + 1) + '번 정답이 너무 적음: ' + n.join(' / ')); });
});
check('화면이 가리키는 주제 id', function () {
  const learn = read('assets/learn.js'), app = read('assets/app.js');
  const pathIds = /const PATH = \[([^\]]+)\]/.exec(learn)[1].match(/'([a-z]+)'/g).map(function (s) { return s.slice(1, -1); });
  pathIds.forEach(function (id) { assert.ok(D.byId[id], '권장 순서: ' + id); });
  const map = /const LEARN_OF = \{([\s\S]*?)\};/.exec(app)[1];
  (map.match(/:'([a-z]+)'/g) || []).forEach(function (s) { assert.ok(D.byId[s.slice(2, -1)], "용어 설명 '?' 연결: " + s); });
  const files = /const FILES = \[([^\]]+)\]/.exec(learn)[1].match(/'([\w-]+)'/g).map(function (s) { return s.slice(1, -1); });
  files.forEach(function (f) { assert.ok(fs.existsSync(path.join(ROOT, 'assets/learn', f + '.js')), '파일 없음: ' + f); });
  fs.readdirSync(path.join(ROOT, 'assets/learn')).forEach(function (f) { assert.ok(files.indexOf(f.replace(/\.js$/, '')) >= 0, '화면이 불러오지 않는 파일: ' + f); });
});

/* ================= ② 숫자 예시 ================= */
check('주가지수 · 시가총액 · 가격제한폭', function () {
  says('index', '+' + (50 / 2500 * 100).toFixed(1) + '%', '+' + (50 / 5000 * 100).toFixed(1) + '%');
  assert.strictEqual(100000 * 1e7, 1e12); assert.strictEqual(10000 * 5e8, 5e12);
  says('mktcap', '1조 원', '5조 원'); assert.strictEqual(20000 * 5e7, 1e12); answer('mktcap', '1조 원');
  says('limit', won(10000 * 1.3) + '원', won(10000 * 0.7) + '원', '+' + ((10000 / 7000 - 1) * 100).toFixed(1) + '%');
  answer('limit', won(50000 * 1.3) + '원');
  answer('order', '수요일');                                          // 월요일 체결 + 2영업일
});
check('배당 · 증자 · 세금', function () {
  const gross = 100 * 2000, tax = gross * 0.154;
  says('dividend', (2000 / 50000 * 100).toFixed(1) + '%', won(gross) + '원', won(tax) + '원', won(gross - tax) + '원');
  near(0.14 + 0.014, 0.154, 1e-12);
  says('capital', won(20000 / 2) + '원', '200만 원');
  says('tax', won(1e7 * 0.002) + '원', ((1000 - 250) * 0.22).toFixed(0) + '만 원', (0.20 * 12).toFixed(1) + '%');
  near(0.05 + 0.15, 0.20, 1e-12); near(0.20 + 0.02, 0.22, 1e-12);
  answer('tax', ((500 - 250) * 0.22).toFixed(0) + '만 원');
});
check('채권: 이자 · 가격 · 수익률 · 듀레이션', function () {
  says('bond', won(10000 * 0.04) + '원', won(10000 * 0.04 * 3 + 10000) + '원'); answer('bond', won(10000 * 0.05) + '원');
  const p3 = F.bondPrice(10000, 0.03, 10, 0.03), p4 = F.bondPrice(10000, 0.03, 10, 0.04), p2 = F.bondPrice(10000, 0.03, 10, 0.02);
  /* 닫힌 식(연금 현가)으로 따로 계산해 그림의 계산과 대조 */
  const closed = function (y) { return 300 * (1 - Math.pow(1 + y, -10)) / y + 10000 * Math.pow(1 + y, -10); };
  near(p3, 10000, 1e-6); near(p4, closed(0.04), 1e-6); near(p2, closed(0.02), 1e-6);
  says('bondprice', won(p3) + '원', won(p4) + '원', won(p2) + '원', '(−' + ((1 - p4 / p3) * 100).toFixed(1) + '%)', '(+' + ((p2 / p3 - 1) * 100).toFixed(1) + '%)');
  says('ytm', won(p4) + '원', (300 / Math.round(p4) * 100).toFixed(2) + '%', '차익 ' + won(10000 - Math.round(p4)) + '원');
  /* 맥컬리 듀레이션 = Σ t × 현금흐름의 현재가치 ÷ 가격, 수정 듀레이션 = 맥컬리 ÷ (1 + y) */
  let mac = 0; for (let t = 1; t <= 10; t++) mac += t * (300 + (t === 10 ? 10000 : 0)) / Math.pow(1.03, t);
  const mod = mac / p3 / 1.03;
  says('duration', '약 <b>' + mod.toFixed(1) + '</b>', '−' + ((1 - p4 / p3) * 100).toFixed(1) + '%');
  assert.ok(mod > (1 - p4 / p3) * 100, '볼록성: 실제 하락폭이 듀레이션 어림보다 작아야 함');
  says('credit', Math.round((3.6 - 3.0) * 100) + 'bp'); near(0.01 * 100, 1, 1e-12);
  says('baserate', ((3.25 - 3.00)).toFixed(2) + '%p(' + Math.round((3.25 - 3.00) * 100) + 'bp)');
  const pv5 = 1000 / Math.pow(1.05, 10), pv8 = 1000 / Math.pow(1.08, 10);
  says('ratestock', won(pv5) + '만 원', won(pv8) + '만 원', '약 25%');
  near((1 - pv8 / pv5) * 100, 25, 1);
});
check('기술적 분석: 캔들 · 이동평균 · 볼린저 · RSI · MACD', function () {
  says('candle', '몸통 ' + (10400 - 10000) + '원', '위꼬리 ' + (10600 - 10400) + '원', '아래꼬리 ' + (10000 - 9900) + '원');
  const c = [10000, 10200, 10100, 10400, 10300, 10600], sma = I.sma(c, 5);
  says('ma', won(sma[4]) + '원', won(sma[5]) + '원', won(c.slice(0, 5).reduce(function (s, v) { return s + v; }, 0)), won(c.slice(1).reduce(function (s, v) { return s + v; }, 0)));
  answer('ma', I.sma([100, 110, 120], 3)[2] + '원');
  const up = 10000 + 2 * 300, lo = 10000 - 2 * 300;
  says('bb', won(up) + '원', won(lo) + '원', String((10450 - lo) / (up - lo)), ((up - lo) / 10000 * 100) + '%');
  says('rsi', '<b>' + (100 - 100 / (1 + 300 / 100)) + '</b>'); answer('rsi', String(100 - 100 / (1 + 1)));
  says('macd', '+' + (10350 - 10200), '+' + (150 - 120));
  says('stoch', '<b>' + ((10800 - 10000) / (11000 - 10000) * 100) + '</b>', '<b>−' + ((11000 - 10800) / (11000 - 10000) * 100) + '</b>');
  answer('stoch', String((18500 - 18000) / (20000 - 18000) * 100));
});
check('기술적 분석: ATR · 피봇 · 피보나치 · 기대값 · OBV', function () {
  const tr = Math.max(10500 - 10100, Math.abs(10500 - 9900), Math.abs(10100 - 9900));
  says('atr', 'TR = <b>' + tr + '원</b>', won(20000 - 2 * 500) + '원');
  const H = 10500, L = 10100, C = 10400, P = (H + L + C) / 3;
  says('pivot', won(H + L + C) + ' ÷ 3 = <b>' + won(P) + '원</b>', won(2 * P - L) + '원', won(2 * P - H) + '원', won(P + (H - L)) + '원', won(P - (H - L)) + '원');
  answer('pivot', String((110 + 90 + 100) / 3));
  says('fib', won(15000 - 5000 * 0.382) + '원', won(15000 - 5000 * 0.5) + '원', won(15000 - 5000 * 0.618) + '원');
  near(0.618 * 0.618, 0.382, 0.0005); near(Math.pow(0.618, 3), 0.236, 0.0005); near(Math.sqrt(0.618), 0.786, 0.0005);
  near(13 / 21, 0.618, 0.002);                                         // 피보나치 이웃 항의 비율
  answer('fib', won(30000 - 10000 * 0.5) + '원');
  says('backtest', '+' + (0.4 * 9 - 0.6 * 3).toFixed(1) + '%', '−' + Math.abs(0.7 * 2 - 0.3 * 6).toFixed(1) + '%');
  answer('backtest', '+' + (0.3 * 10 - 0.7 * 2).toFixed(1) + '%');
  says('volind', '+100만', '+40만', '+120만');
});
check('가치 분석: 예시 회사의 숫자가 단원 전체에서 서로 맞는가', function () {
  const co = { sales:1000, cogs:600, sga:250, nonop:-10, tax:30, assets:1000, debt:400, equity:600, shares:1000, price:22000,
               borrow:300, cash:100, da:50, ocf:180, capex:80, curA:300, curL:200, interest:15 };   // 억 원, 주식 수는 만 주
  const gp = co.sales - co.cogs, op = gp - co.sga, ni = op + co.nonop - co.tax;
  assert.strictEqual(co.assets, co.debt + co.equity);
  const eps = ni * 1e8 / (co.shares * 1e4), bps = co.equity * 1e8 / (co.shares * 1e4), cap = co.price * co.shares * 1e4 / 1e8;
  says('fs', '자산 1,000억 원 = 부채 400억 원 + 자본 600억 원'); answer('fs', (500 - 200) + '억 원');
  says('income', '<b>' + gp + '억</b>', '<b>' + op + '억</b>', '영업이익률 ' + (op / co.sales * 100) + '%', '<b>' + ni + '억</b>', '순이익률 ' + (ni / co.sales * 100) + '%');
  answer('income', ((200 - 120 - 50) / 200 * 100) + '%');
  says('eps', won(eps) + '원', won(bps) + '원'); answer('eps', won(50e8 / 500e4) + '원');
  const per = co.price / eps, pbr = co.price / bps, roe = ni / co.equity * 100;
  says('per', '<b>' + per + '배</b>', '<b>' + (eps / co.price * 100) + '%</b>'); answer('per', (30000 / 2000) + '배');
  says('pbr', '<b>' + pbr.toFixed(2) + '배</b>', 'PER 20배 × ROE 18.3% = 3.67배'); near(per * roe / 100, pbr, 1e-9, 'PBR = PER × ROE');
  says('roe', '<b>' + roe.toFixed(1) + '%</b>', '<b>' + (ni / co.assets * 100) + '%</b>', (co.assets / co.equity).toFixed(2) + '배');
  near((ni / co.sales) * (co.sales / co.assets) * (co.assets / co.equity) * 100, roe, 1e-9, '듀퐁');
  const ev = cap + co.borrow - co.cash, ebitda = op + co.da;
  assert.strictEqual(cap, 2200);
  says('ev', '<b>' + won(ev) + '억 원</b>', '<b>' + ebitda + '억 원</b>', '<b>' + (ev / ebitda) + '배</b>'); answer('ev', won(1000 + 500 - 200) + '억 원');
  says('peg', '<b>' + (20 / 25) + '</b>', '<b>' + (10 / 5).toFixed(1) + '</b>', '<b>' + (cap / co.sales) + '배</b>'); answer('peg', (30 / 30).toFixed(1));
  const fcf = co.ocf - co.capex;
  says('cashflow', 'FCF <b>' + fcf + '억 원</b>', '<b>' + (fcf / cap * 100).toFixed(1) + '%</b>'); answer('cashflow', (300 - 120) + '억 원');
  says('health', '<b>' + (co.debt / co.equity * 100).toFixed(1) + '%</b>', '<b>' + (co.curA / co.curL * 100) + '%</b>', '<b>' + (op / co.interest) + '배</b>');
  assert.ok(D.byId.health.quiz.a[D.byId.health.quiz.ok].indexOf((20 / 40) + '배') === 0);
});
check('가치 분석: DCF · S-RIM', function () {
  const v8 = 100 / (0.08 - 0.02), v9 = 100 / (0.09 - 0.02);
  says('dcf', '<b>' + won(v8) + '억 원</b>', '<b>' + won(v9) + '억 원</b>', '<b>' + Math.round((1 - v9 / v8) * 100) + '%</b>', '<b>' + (3.0 + 1.2 * 5.5).toFixed(1) + '%</b>');
  /* 앱(fundamentals.js)과 같은 식: B × [1 + (ROE − Ke) × ω ÷ (1 + Ke − ω)] */
  const rim = function (w) { return 1000 * (1 + (0.12 - 0.08) * w / (1 + 0.08 - w)); };
  says('rim', '<b>' + (1000 * (0.12 - 0.08)).toFixed(0) + '억 원</b>', '<b>' + won(rim(1)) + '억 원</b>', '<b>' + won(rim(0.9)) + '억 원</b>', '<b>' + won(rim(0.8)) + '억 원</b>');
  near(rim(1), 1000 + 40 / 0.08, 1e-9);
});
check('거시경제: 물가 · 성장률 · 환율 · VIX', function () {
  says('inflation', '<b>' + ((309 - 300) / 300 * 100).toFixed(1) + '%</b>', '실질금리 <b>' + (4 - 3) + '%</b>'); answer('inflation', '−' + Math.abs(3 - 4) + '%');
  says('indicators', '약 <b>' + ((Math.pow(1.005, 4) - 1) * 100).toFixed(1) + '%</b>');
  says('fx', won(100 * 1400) + '원', won(110 * 1330) + '원', '<b>+' + ((110 * 1330 / (100 * 1400) - 1) * 100).toFixed(1) + '%</b>');
  near(1.10 * (1330 / 1400), 110 * 1330 / (100 * 1400), 1e-12); near((1330 / 1400 - 1) * 100, -5, 1e-9);
  says('sentiment', '±' + (20 / Math.sqrt(12)).toFixed(1) + '%');
});
check('전략: 복리 · 손실 회복 · 리밸런싱 · 적립식', function () {
  const fv = function (n) { return 1000 * Math.pow(1.07, n); };
  says('compound', won(fv(10)) + '만 원', won(fv(20)) + '만 원', won(fv(30)) + '만 원', won(1000 * (1 + 0.07 * 30)) + '만 원', (72 / 7).toFixed(1) + '년', (Math.log(2) / Math.log(1.07)).toFixed(1) + '년', '약 <b>25%</b>');
  near((1 - Math.pow(1.06, 30) / Math.pow(1.07, 30)) * 100, 25, 1);
  assert.ok(1000 * (1 + 0.07 * 30) < fv(30) / 2, '단리가 복리의 절반 미만');
  answer('compound', (72 / 6) + '년');
  const rec = F.recoverPct;
  says('lossmath', '+' + rec(10).toFixed(1) + '%', '+' + rec(20).toFixed(0) + '%', '+' + rec(50).toFixed(0) + '%', '+' + rec(70).toFixed(0) + '%', '<b>−' + ((1 - 1.5 * 0.5) * 100) + '%</b>');
  answer('lossmath', '약 ' + rec(40).toFixed(1) + '%');
  const stock = 600 * 1.3, total = stock + 400;
  says('allocation', won(stock) + '만 원', won(total) + '만 원', '<b>' + (stock / total * 100).toFixed(1) + '%</b>', won(total * 0.6) + '만 원', '<b>' + won(stock - total * 0.6) + '만 원</b>');
  const sh = 300000 / 10000 + 300000 / 7500 + 300000 / 15000;
  says('dca', '<b>' + sh + '주</b>', '<b>' + won(900000 / sh) + '원</b>', '<b>' + won((10000 + 7500 + 15000) / 3) + '원</b>');
  answer('dca', won(200000 / (100000 / 5000 + 100000 / 10000)) + '원');
  says('riskreturn', '<b>−' + ((1 - 650 / 1000) * 100) + '%</b>');
});
check('전략: 손익비 · 포지션 크기 · 레버리지 · 샤프지수', function () {
  const rr = (22000 - 20000) / (20000 - 19000);
  says('stoploss', '<b>' + rr + '</b>', '<b>' + (1 / (1 + rr) * 100).toFixed(1) + '%</b>'); answer('stoploss', String((11500 - 10000) / (10000 - 9500)));
  const qty = 2000e4 * 0.01 / (20000 - 19000);
  says('position', '<b>' + qty + '주</b>', won(qty * 20000 / 1e4) + '만 원어치', '자산의 ' + (qty * 20000 / 2000e4 * 100) + '%',
    '<b>−' + ((1 - Math.pow(0.99, 10)) * 100).toFixed(1) + '%</b>', '<b>−' + ((1 - Math.pow(0.9, 10)) * 100).toFixed(1) + '%</b>');
  answer('position', (1000e4 * 0.02 / (50000 - 48000)) + '주');
  says('leverage', '<b>' + won(2000 * 0.75 - 1000) + '만 원</b> (−' + ((1 - (2000 * 0.75 - 1000) / 1000) * 100) + '%)', '<b>' + (2000 * 0.5 - 1000) + '원</b>');
  answer('leverage', (0.2 * 2 * 100) + '%');
  says('beta', '<b>' + ((12 - 3) / 18) + '</b>', '<b>' + ((9 - 3) / 10) + '</b>'); answer('beta', '−' + (1.5 * 10) + '%');
});
check('상품: ETF · 레버리지 · 옵션 · 공매도 · CB · 공모주 · 연금', function () {
  says('etf', '<b>+' + ((10050 - 10000) / 10000 * 100) + '%</b>'); answer('etf', '−' + Math.abs((19800 - 20000) / 20000 * 100) + '%');
  const dn = 100 / 110 - 1, lev = 100 * 1.2 * (1 + 2 * dn), inv = 100 * 0.9 * (1 - dn);
  near(110 * (1 + dn), 100, 1e-9);
  says('levetf', '(−' + (-dn * 100).toFixed(2) + '%)', lev.toFixed(2) + '(−' + (-2 * dn * 100).toFixed(2) + '%)', inv.toFixed(2) + '(+' + (-dn * 100).toFixed(2) + '%)', '<b>−' + (100 - lev).toFixed(1) + '%</b>');
  near(lev, inv, 1e-9, '2배와 인버스가 같은 값');
  answer('levetf', '−' + Math.round((1 - 1.2 * 0.8) * 100) + '%'); near(1.1 * 0.9, 0.99, 1e-12);
  says('derivatives', '<b>+' + (120 - 100 - 5) + '</b>', '<b>−5</b>', '<b>' + (100 + 5) + '</b>');
  says('shortsell', '<b>+' + won(10000 - 8000) + '원</b>(+' + ((10000 - 8000) / 10000 * 100) + '%)', '<b>−' + won(13000 - 10000) + '원</b>(−' + ((13000 - 10000) / 10000 * 100) + '%)');
  says('cb', '<b>' + (100e8 / 10000 / 1e4) + '만 주</b>', '<b>' + (100 / 1100 * 100).toFixed(1) + '%</b>');
  says('ipo', '<b>' + won(20000 * 0.6) + '원</b>', '<b>' + won(20000 * 4) + '원</b>'); answer('ipo', won(10000 * 4) + '원');
  says('account', '148만 5천 원'); near(900 * 0.165, 148.5, 1e-9);
});

/* ================= ③ 앱의 실제 계산과 일치 ================= */
check('지표 기간 · 방식이 앱(indicators.js)과 같음', function () {
  const src = read('assets/core/indicators.js');
  ['bollinger(c, 20, 2)', 'macd(c, 12, 26, 9)', 'rsi(c,14)', 'stochastic(bars,14,3)', 'atr(bars,14)', 'adx(bars, 14)', 'mfi(bars,14)'].forEach(function (s) {
    assert.ok(src.indexOf(s) >= 0, '앱 계산이 바뀜: ' + s);
  });
  says('bb', '20일', '2배'); says('rsi', '14일', '와일더'); says('macd', '12일', '26일', '9일'); says('stoch', '14일', '3일'); says('atr', '14일');
  assert.ok(read('index.html').indexOf('MA 20/50/200') >= 0); says('ma', '20 · 50 · 200일선');
  const an = read('assets/core/analysis.js');
  assert.ok(an.indexOf('I.lastCross(ind.sma20, ind.sma50') >= 0 && an.indexOf('I.lastCross(ind.sma50, ind.sma200') >= 0);
  says('cross', '20일 · 50일선 교차와 50일 · 200일선 교차');
  assert.ok(an.indexOf('R1:2 * P - pb.l, S1:2 * P - pb.h, R2:P + (pb.h - pb.l), S2:P - (pb.h - pb.l)') >= 0, '피봇 공식');
  const fu = read('assets/core/fundamentals.js');
  assert.ok(fu.indexOf('ps.bps * (1 + (roeExp / 100 - ke) * w / (1 + ke - w))') >= 0, 'S-RIM 공식');
  assert.ok(fu.indexOf("KRW:{ rf:3.0, erp:5.5") >= 0, '할인율 가정'); says('rim', 'ω = 0.8 · 0.9 · 1.0');
});
check('본문 예시를 앱 함수에 넣어도 같은 값', function () {
  /* RSI: 14일 동안 +600원 7번, −200원 7번 → 평균 상승 300 · 평균 하락 100 → 75 */
  const c = [10000]; for (let i = 0; i < 14; i++) c.push(c[i] + (i % 2 ? -200 : 600));
  near(I.rsi(c, 14)[14], 75, 1e-9, 'RSI');
  const flat = [100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100];
  near(I.rsi(flat, 14)[14], 50, 1e-9, 'RSI 균형');
  /* 볼린저: 평균 10,000 · 표준편차 300 인 20일 */
  const b = []; for (let i = 0; i < 20; i++) b.push(i % 2 ? 10300 : 9700);
  const bb = I.bollinger(b, 20, 2); near(bb.up[19], 10600, 1e-6); near(bb.lo[19], 9400, 1e-6); near(bb.mid[19], 10000, 1e-6);
  /* MACD = EMA12 − EMA26, 히스토그램 = MACD − 시그널 */
  const d = F.demo().close, m = I.macd(d, 12, 26, 9), e12 = I.ema(d, 12), e26 = I.ema(d, 26);
  for (let i = 40; i < d.length; i++){ near(m.line[i], e12[i] - e26[i], 1e-9, 'MACD'); near(m.hist[i], m.line[i] - m.signal[i], 1e-9, '히스토그램'); }
  near(I.ema([1, 2, 3, 4], 3)[3], 4 * (2 / 4) + 2 * (1 - 2 / 4), 1e-12, 'EMA k = 2/(N+1)');       // 첫 값은 3일 평균(2), k = 2 ÷ (3 + 1)
  /* 스토캐스틱 · 윌리엄스 %R */
  const bars = []; for (let i = 0; i < 16; i++) bars.push({ h:11000, l:10000, c:10800, v:1 });
  near(I.stochastic(bars, 14, 3)[15], 80, 1e-9); near(I.williamsR(bars, 14)[15], -20, 1e-9);
  /* TR (갭 상승) · OBV */
  near(I.atr([{ h:9950, l:9850, c:9900 }, { h:10500, l:10100, c:10400 }], 1)[1], 600, 1e-9, 'TR');
  const ob = I.obv([{ c:100, v:0 }, { c:101, v:100 }, { c:100, v:60 }, { c:102, v:80 }]);
  assert.deepStrictEqual(Array.from(ob), [0, 100, 40, 120]);
});

/* ================= ④ 그림 ================= */
check('그림이 모두 그려짐 (넓은 화면 · 좁은 화면)', function () {
  F.KEYS.forEach(function (k) {
    [720, 640, 340, 280].forEach(function (w) {
      const s = F.render(k, w);
      assert.ok(s.indexOf('<svg') >= 0 && s.indexOf('aria-label="') >= 0, k + ' ' + w);
      assert.ok(!/NaN|undefined|Infinity/.test(s), k + ' ' + w + ' 에 NaN');
    });
    assert.ok(D.topics.some(function (t) { return t.fig === k; }), '쓰이지 않는 그림: ' + k);
  });
});
check('예시 주가 그림에 설명한 사건이 실제로 있음', function () {
  const d = F.demo(), n = d.close.length, min = Math.min.apply(null, d.close), minAt = d.close.indexOf(min);
  assert.ok(d.dead > 0 && d.golden > d.dead, '데드크로스 → 골든크로스 순서');
  assert.ok(d.close[d.golden] > min * 1.04, '골든크로스 때는 이미 바닥에서 오른 뒤');                       // cross 그림 설명
  assert.ok(Math.max.apply(null, d.close.slice(d.golden)) > d.close[d.golden] * 1.05, '골든크로스 뒤 상승');
  assert.ok(Math.min.apply(null, d.close.slice(d.dead)) < d.close[d.dead] * 0.95, '데드크로스 뒤 하락');
  const first30 = d.rsi.findIndex(function (v) { return v < 30; });
  assert.ok(first30 >= 0 && d.rsi[d.rsiMax] > 70, 'RSI 과매도 · 과매수 구간');
  assert.ok(minAt > first30 && min < d.close[first30] * 0.97, 'RSI 30 이탈 뒤에도 더 하락');                // rsi 그림 설명
  assert.ok(Math.max.apply(null, d.close.slice(d.squeeze)) > d.close[d.squeeze] * 1.1, '스퀴즈 뒤 큰 움직임');   // bb 그림 설명
  let ride = 0; for (let i = d.squeeze; i < n; i++) if (d.close[i] >= d.bbUp[i] * 0.99) ride++;
  assert.ok(ride >= 5, '밴드 타기 ' + ride + '일');
  assert.ok(d.macdUp > 0, 'MACD 시그널 상향 돌파');
  assert.ok(d.macd.slice(d.macdUp).some(function (v, i, a) { return i && a[i - 1] <= 0 && v > 0; }), '그 뒤 0선 돌파');   // macd 그림 설명
  /* 레버리지 그림: 60거래일 뒤 약 13% 낮아짐 */
  const dn = 1 / 1.05 - 1; let lev = 100; for (let k = 0; k < 30; k++) lev *= 1.10 * (1 + 2 * dn);
  near(100 - lev, 13, 0.5); says('levetf', '약 13%');
  assert.ok(F.render('levetf', 640).indexOf('2배 ETF ' + lev.toFixed(1)) >= 0);
  assert.ok(F.render('bondprice', 640).indexOf('9,189원') >= 0 && F.render('compound', 640).indexOf('7,612만') >= 0);
  assert.ok(F.render('recover', 640).indexOf('+233%') >= 0 && F.render('recover', 640).indexOf('+11.1%') >= 0);
});

/* ================= ⑤ 실제 데이터 ================= */
check('볼린저 밴드(20, 2) 안에 종가의 약 90% — 번들 일봉으로 측정', function () {
  let hist; try { hist = JSON.parse(read('assets/data/history.json')).items; } catch (e) { hist = null; }
  if (!hist){ console.log('  (history.json 없음 — 건너뜀)'); return; }
  let inside = 0, total = 0, n = 0;
  Object.keys(hist).forEach(function (c) {
    const cl = hist[c].map(function (r) { return r[4]; }); if (cl.length < 300) return;
    n++;
    const b = I.bollinger(cl, 20, 2);
    for (let i = 0; i < cl.length; i++){ if (b.up[i] == null) continue; total++; if (cl[i] <= b.up[i] && cl[i] >= b.lo[i]) inside++; }
  });
  const pct = inside / total * 100;
  console.log('  볼린저 밴드 안 비율: ' + pct.toFixed(1) + '% (' + n + '종목 · ' + total.toLocaleString('ko-KR') + '일)');
  assert.ok(pct > 85 && pct < 93, '밴드 안 비율 ' + pct.toFixed(1) + '%');
  says('bb', '약 <b>90%</b>');
});

/* ================= ⑥ 제도 수치 (검토 완료 문구 잠금) =================
   2026-10-01 확인. 출처: 한국거래소 · 넥스트레이드 시장 안내, 국세청 · 기획재정부 세법 개정 안내(2026년 시행), 금융위원회 보도자료,
   미국 SEC(T+1 결제) · 재무부(국채 종류) · 연준(FOMC 일정). 제도가 바뀌면 본문과 이 표를 함께 고칩니다. */
const FACTS = {
  market:['09:00 ~ 15:30', '16:00 ~ 20:00 (2026년 9월 도입)', '08:00 ~ 20:00', '23:30 ~ 06:00 (서머타임 22:30 ~ 05:00)', '2025년 3월'],
  index:['1980년 1월 4일 = 100', '1996년 7월 1일 = 1,000'],
  mktcap:['1~100위', '101~300위'],
  order:['08:30~09:00', '15:20~15:30', '2영업일 뒤(T+2)', '2024년 5월부터 1영업일 뒤(T+1)', '50만 원 이상'],
  limit:['±30%', '2분', '5% 이상 변동해 1분간', '8% · 15%', '20분간', '<b>20%</b> 이상'],
  dividend:['15.4%', '2영업일 전까지'],
  tax:['0.20%', '거래세 0.05% + 농어촌특별세 0.15%', '50억 원 이상', '15.4%', '소득세 14% + 지방소득세 1.4%', '2,000만 원', '250만 원', '22%', '양도소득세 20% + 지방소득세 2%', '5월', '15%'],
  disclosure:['90일', '45일', '10-K', '10-Q', '8-K'],
  treasury:['2 · 3 · 5 · 10 · 20 · 30 · 50년', '1년 이하', '2 · 3 · 5 · 7 · 10년', '20 · 30년'],
  credit:['BBB− 이상', 'BB+ 이하', '1bp = 0.01%p'],
  baserate:['1년에 8번', '2%', '3 · 6 · 9 · 12월'],
  expiry:['매월 둘째 목요일', '3 · 6 · 9 · 12월 둘째 목요일', '매월 셋째 금요일'],
  health:['3년'],
  sentiment:['30일', '7가지'],
  indicators:['50보다 높으면 경기 확장', '매월 1일'],
  jobs:['첫째 금요일', '매주 목요일'],
  leverage:['140%', '2영업일 뒤'],
  shortsell:['2023년 11월', '2025년 3월 31일'],
  ipo:['공모가의 60~400%', '절반 이상'],
  reits:['90% 이상'],
  account:['3년 이상', '900만 원', '600만 원', '55세', '3.3~5.5%', '13.2% 또는 16.5%', '16.5%의 기타소득세'],
  etf:['15.4%', '22%'],
  scam:['fine.fss.or.kr', '1332']
};
check('제도 수치 — 검토한 문구 그대로', function () {
  Object.keys(FACTS).forEach(function (id) { says.apply(null, [id].concat(FACTS[id])); });
});
check("제도 주제에는 '기준 시점' 안내가 붙음", function () {
  ['market', 'dividend', 'tax', 'etf', 'shortsell', 'ipo', 'account'].forEach(function (id) { assert.ok(D.byId[id].asof, id); });
  assert.ok(/^\d{4}년 \d{1,2}월$/.test(D.asOf));
});

console.log((failed ? '✗ ' : '✓ ') + '주식 공부 검증: ' + passed + '개 통과' + (failed ? ', ' + failed + '개 실패' : '') +
  ' — 주제 ' + D.topics.length + '개 · 확인 문제 ' + D.topics.filter(function (t) { return t.quiz; }).length + '개 · 그림 ' + F.KEYS.length + '개');

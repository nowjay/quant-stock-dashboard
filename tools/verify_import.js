#!/usr/bin/env node
/* =============================================================
   verify_import.js — '잔고 가져오기' 검증 (브라우저 없이 node 로 assets/core/holdings.js 를 그대로 실행)

   node tools/verify_import.js        실패하면 종료 코드 1

   ① 숫자 · 구분자      '65,000원' 같은 표기, 탭 · 쉼표 · 세미콜론 · | · 공백 구분 (천 단위 쉼표를 구분자로 착각하지 않는지)
   ② 표 읽기           증권사마다 다른 열 제목 · 순서, 평균단가가 없을 때 매입금액 ÷ 수량, 합계 줄, A005930 코드, 같은 종목 합치기
   ③ 간단 입력          '종목 평단가 수량', 이름에 숫자가 든 종목, 숫자가 많아 알 수 없는 줄
   ④ 파일              엑셀(.xlsx — zip 을 직접 풀어 읽음), 표(HTML)로 저장된 .xls, EUC-KR · UTF-16 텍스트, 구형 .xls 거절
   실제 증권사 파일은 저장소에 두지 않는다 — 여기 예시는 형식만 흉내 낸 가짜 잔고다.
   ============================================================= */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
global.window = { QT:{} };
require(path.join(__dirname, '..', 'assets/core/holdings.js'));
const H = global.window.QT.Holdings;

/* 가짜 종목 마스터 — importer.js 의 lookup 과 같은 약속: (코드, 이름) → {code, name, cur} | null */
const UNI = [['005930', '삼성전자', 'KRW'], ['403870', 'HPSP', 'KRW'], ['069500', 'KODEX 200', 'KRW'], ['000660', 'SK하이닉스', 'KRW'], ['NVDA', 'Nvidia', 'USD'], ['0001A0', '덕양에너젠', 'KRW']];
const key = function (s) { return String(s || '').toUpperCase().replace(/[\s.]/g, ''); };
function lookup(code, name){
  const u = UNI.filter(function (x) { return x[0] === code || (/^A[0-9A-Z]{6}$/.test(code) && x[0] === code.slice(1)); })[0] || UNI.filter(function (x) { return name && key(x[1]) === key(name); })[0];
  return u ? { code:u[0], name:u[1], cur:u[2] } : null;
}
const got = function (res) { return res.items.map(function (x) { return [x.code, x.avg, x.qty]; }); };
const read = function (text) { return H.parse(H.rows(text), lookup); };
const cells = function (text) { return Array.from(H.rows(text)); };          // rows() 는 배열에 loose 표시를 달아 준다 — 칸만 비교

let passed = 0;
const jobs = [];
function check(name, fn){
  jobs.push(Promise.resolve().then(fn).then(function () { passed++; }, function (e) {
    console.error('✗ ' + name + '\n  ' + String(e && e.message || e).split('\n')[0]); process.exitCode = 1;
  }));
}

/* ---------------- ① 숫자 · 구분자 ---------------- */
check('숫자 표기', function () {
  assert.deepStrictEqual(['65,000', '65,000원', ' 1,234.5 ', '$182.50', '10주', '(1,200)', '−300', '0', 65000].map(H.num), [65000, 65000, 1234.5, 182.5, 10, -1200, -300, 0, 65000]);
  assert.deepStrictEqual(['', null, '12.5%', 'HPSP', '200A', '1.2.3', '−', NaN].map(H.num), [null, null, null, null, null, null, null, null]);
});
check('구분자 — 탭 · 쉼표(따옴표) · 세미콜론 · | · 공백', function () {
  assert.deepStrictEqual(cells('종목명\t평균단가\nHPSP\t65,000\n'), [['종목명', '평균단가'], ['HPSP', '65,000']]);
  assert.deepStrictEqual(cells('﻿종목명,보유수량,평균단가\r\n"삼성전자",12,"262,000"\r\n"a ""b""",1,2'), [['종목명', '보유수량', '평균단가'], ['삼성전자', '12', '262,000'], ['a "b"', '1', '2']]);
  assert.deepStrictEqual(cells('종목명;평균단가\nHPSP;65000'), [['종목명', '평균단가'], ['HPSP', '65000']]);
  assert.deepStrictEqual(cells('종목명 | 평균단가\nHPSP | 65,000'), [['종목명', '평균단가'], ['HPSP', '65,000']]);
  /* 천 단위 쉼표는 구분자가 아니다 */
  const loose = H.rows('HPSP 10 65,000\n삼성전자 12 262,000');
  assert.deepStrictEqual(Array.from(loose), [['HPSP', '10', '65,000'], ['삼성전자', '12', '262,000']]); assert.strictEqual(loose.loose, true);
  const wide = H.rows('KODEX 200    35,000    10\nHPSP         65,000    3');
  assert.deepStrictEqual(Array.from(wide), [['KODEX 200', '35,000', '10'], ['HPSP', '65,000', '3']]); assert.strictEqual(wide.loose, false);
  assert.deepStrictEqual(cells('  \n\n'), []);
});

/* ---------------- ② 표 읽기 ---------------- */
check('표 — 열 제목으로 찾기 (순서 · 이름이 달라도)', function () {
  const a = read('종목명\t종목코드\t보유수량\t매도가능수량\t평균단가\t현재가\t평가금액\t평가손익\t수익률\n삼성전자\tA005930\t12\t12\t262,000\t270,000\t3,240,000\t96,000\t3.05%\nHPSP\tA403870\t10\t10\t65,000\t57,800\t578,000\t-72,000\t-11.08%');
  assert.strictEqual(a.mode, 'table'); assert.strictEqual(a.error, null);
  assert.deepStrictEqual(got(a), [['005930', 262000, 12], ['403870', 65000, 10]]);
  assert.deepStrictEqual([a.used.name, a.used.code, a.used.avg, a.used.qty], ['종목명', '종목코드', '평균단가', '보유수량']);          // 매도가능수량 · 현재가 · 평가금액을 고르지 않는다
  /* 다른 증권사 표기 · 열 순서 */
  assert.deepStrictEqual(got(read('구분,종목,잔고수량,매입단가(원),평가금액\n현금,SK하이닉스,3,"1,650,000","5,304,000"')), [['000660', 1650000, 3]]);
  assert.deepStrictEqual(got(read('상품명\t평단가\t수량\nKODEX 200\t35,120\t40')), [['069500', 35120, 40]]);
  assert.deepStrictEqual(got(read('Symbol,Name,Quantity,Average Cost\nNVDA,NVIDIA Corp,3.5,182.40')), [['NVDA', 182.4, 3.5]]);
  /* 제목 줄 위에 다른 줄(계좌 · 조회일)이 있어도 */
  assert.deepStrictEqual(got(read('잔고 현황\t2026-10-13\n\n종목명\t평균단가\nHPSP\t65,000')), [['403870', 65000, null]]);
  /* '종목별 평균단가 현황' 같은 제목 한 칸은 열 제목 줄이 아니다 */
  assert.deepStrictEqual(got(read('종목별 평균단가 현황\n종목명\t평균단가\nHPSP\t65,000')), [['403870', 65000, null]]);
});
check('표 — 매입금액 ÷ 수량 · 합계 줄 · 영문자 코드 · 못 찾은 종목', function () {
  const a = read('종목명\t보유수량\t매입금액\t평가금액\n삼성전자\t10\t2,620,000\t2,700,000\n합계\t10\t2,620,000\t2,700,000');
  assert.deepStrictEqual(got(a), [['005930', 262000, 10]]); assert.strictEqual(a.used.amount, '매입금액');
  assert.deepStrictEqual(got(read('종목코드\t평균단가\n0001A0\t12,300\n\'005930\t262,000')), [['0001A0', 12300, null], ['005930', 262000, null]]);
  const b = read('종목명\t평균단가\t보유수량\n엔비디아\t182.4\t3\nHPSP\t65,000\t10\n없는종목\t0\t5');
  assert.deepStrictEqual(got(b), [['403870', 65000, 10]]);
  assert.deepStrictEqual(b.unmatched.map(function (x) { return [x.name, x.avg, x.qty]; }), [['엔비디아', 182.4, 3]]);                       // 평단가 0 인 줄은 버린다
  assert.strictEqual(read('종목명\t현재가\nHPSP\t57,800').mode, 'simple');                                                                // 평균단가 열이 없으면 표로 읽지 않는다
});
check('표 — 같은 종목 합치기 (수량 가중평균)', function () {
  const a = read('종목명\t구분\t보유수량\t평균단가\nHPSP\t현금\t10\t60,000\nHPSP\t신용\t30\t70,000\n삼성전자\t현금\t1\t262,000');
  assert.deepStrictEqual(got(a), [['403870', 67500, 40], ['005930', 262000, 1]]); assert.strictEqual(a.items[0].lines, 2);
  assert.deepStrictEqual(got(read('종목명\t평균단가\nHPSP\t60,000\nHPSP\t70,000')), [['403870', 65000, null]]);                            // 수량이 없으면 단순평균
});
check('표 — 공백으로만 나뉜 글 (종목명에 공백)', function () {
  assert.deepStrictEqual(got(read('종목명 보유수량 평균단가\nKODEX 200 40 35,120\nHPSP 10 65,000')), [['069500', 35120, 40], ['403870', 65000, 10]]);
});

/* ---------------- ③ 간단 입력 ---------------- */
check('간단 입력 — 종목 평단가 [수량]', function () {
  const a = read('HPSP 65,000 10\n삼성전자 262000\n005930 250,000 3\nKODEX 200 35,120 40\nNVDA $182.40 3.5\n메모: 10월 매수분');
  assert.strictEqual(a.mode, 'simple'); assert.strictEqual(a.used, null);
  assert.deepStrictEqual(got(a), [['403870', 65000, 10], ['005930', 256000, null], ['069500', 35120, 40], ['NVDA', 182.4, 3.5]]);           // 삼성전자 두 줄(수량 없는 줄 포함) → 단순평균
  assert.deepStrictEqual(got(read('HPSP,65000,10')), [['403870', 65000, 10]]);
  assert.deepStrictEqual(got(read('HPSP\t65,000\t10\t-11.1%')), [['403870', 65000, 10]]);                                                  // 퍼센트는 숫자로 세지 않는다
  const b = read('엔비디아 182.4 3');
  assert.deepStrictEqual([b.items.length, b.unmatched[0].name, b.unmatched[0].avg], [0, '엔비디아', 182.4]);
});
check('간단 입력 — 숫자가 많으면 읽지 않는다', function () {
  const a = read('HPSP 10 65,000 57,800 578,000\n삼성전자 12 262,000 270,000 3,240,000');
  assert.deepStrictEqual([a.error, a.items.length, a.unmatched.length], ['nocols', 0, 0]);
  assert.strictEqual(read('').error, 'empty');
  assert.strictEqual(read('안녕하세요\n잔고입니다').error, 'nodata');
});

/* ---------------- ④ 파일 ---------------- */
/* 최소한의 zip — 항목마다 압축(deflate) 또는 저장(stored) */
function zip(entries){
  const parts = [], dir = [];
  let at = 0;
  entries.forEach(function (e) {
    const name = Buffer.from(e.name), raw = Buffer.from(e.text), data = e.stored ? raw : zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.stored ? 0 : 8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.stored ? 0 : 8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(at, 42);
    parts.push(lh, name, data); dir.push(ch, name);
    at += 30 + name.length + data.length;
  });
  const d = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(d.length, 12); end.writeUInt32LE(at, 16);
  const all = Buffer.concat(parts.concat([d, end]));
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}
const SHEET = '<?xml version="1.0"?><worksheet><sheetData>' +
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
  '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" s="1"/><c r="C2"><v>10</v></c><c r="D2"><v>65000</v></c></row>' +
  '<row r="3"/>' +
  '<row r="4"><c r="A4" t="inlineStr"><is><t>삼성전자</t></is></c><c r="C4"><v>12</v></c><c r="D4"><f>B4*2</f><v>262000.5</v></c></row>' +
  '<row r="5"><c r="A5" t="s"><v>5</v></c><c r="B5" t="str"><v>A069500</v></c><c r="C5"><v>40</v></c><c r="D5"><v>35120</v></c></row>' +
  '</sheetData></worksheet>';
const SST = '<sst><si><t>종목명</t></si><si><t>종목코드</t></si><si><t xml:space="preserve">보유 수량</t></si><si><r><rPr><b/></rPr><t>평균</t></r><r><t>단가</t></r></si><si><t>HPSP</t></si><si><t>K&amp;T 없는종목</t></si></sst>';
function xlsx(extra){
  return zip([
    { name:'[Content_Types].xml', text:'<Types/>', stored:true },
    { name:'xl/workbook.xml', text:'<workbook><sheets><sheet name="잔고" sheetId="1" r:id="rId3"/></sheets></workbook>' },
    { name:'xl/_rels/workbook.xml.rels', text:'<Relationships><Relationship Id="rId1" Type="x" Target="styles.xml"/><Relationship Id="rId3" Type="y" Target="worksheets/sheet7.xml"/></Relationships>' },
    { name:'xl/sharedStrings.xml', text:SST },
    { name:'xl/worksheets/sheet7.xml', text:SHEET }
  ].concat(extra || []));
}
check('엑셀(.xlsx) — 공유 문자열 · 인라인 문자열 · 빈 칸 · 수식 값 · 첫 시트 찾기', async function () {
  const rows = await H.xlsxRows(xlsx([{ name:'xl/worksheets/sheet1.xml', text:'<worksheet><sheetData><row><c t="inlineStr"><is><t>다른 시트</t></is></c></row></sheetData></worksheet>' }]));
  assert.deepStrictEqual(rows, [['종목명', '종목코드', '보유 수량', '평균단가'], ['HPSP', '', '10', '65000'], ['삼성전자', '', '12', '262000.5'], ['K&T 없는종목', 'A069500', '40', '35120']]);
  const res = H.parse(rows, lookup);
  assert.deepStrictEqual(got(res), [['403870', 65000, 10], ['005930', 262000.5, 12], ['069500', 35120, 40]]);                                // 코드가 있으면 이름이 달라도 코드로 찾는다
  const f = await H.fileRows(xlsx());
  assert.strictEqual(f.kind, 'xlsx'); assert.strictEqual(f.rows.length, 4);
  await assert.rejects(H.xlsxRows(new Uint8Array([0x50, 0x4B, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]).buffer));
});
check('파일 — 표(HTML)로 저장된 .xls · EUC-KR · UTF-16 · 구형 .xls 거절', async function () {
  const html = '<html><body><table><tr><td>계좌</td></tr></table><TABLE border=1><tr><th>종목명</th><th>평균&nbsp;단가</th><th>보유수량</th></tr>' +
    '<tr><td><a href="#">HPSP</a></td><td align=right>65,000</td><td>10</td></tr><tr><td>SK하이닉스</td><td>1,650,000<br></td><td>3</td></tr></TABLE></body></html>';
  const a = await H.fileRows(new TextEncoder().encode(html).buffer);
  assert.strictEqual(a.kind, 'html'); assert.deepStrictEqual(got(H.parse(a.rows, lookup)), [['403870', 65000, 10], ['000660', 1650000, 3]]);
  /* EUC-KR: '종목명,평균단가\r\n삼성전자,262000' */
  const euc = Buffer.concat([Buffer.from('c1beb8f1b8ed2cc6f2b1d5b4dcb0a1', 'hex'), Buffer.from('\r\n'), Buffer.from('bbefbcbac0fcc0da', 'hex'), Buffer.from(',262000\r\nHPSP,65000')]);
  const b = await H.fileRows(euc.buffer.slice(euc.byteOffset, euc.byteOffset + euc.length));
  assert.strictEqual(b.kind, 'text'); assert.deepStrictEqual(got(H.parse(b.rows, lookup)), [['005930', 262000, null], ['403870', 65000, null]]);
  /* 엑셀의 '유니코드 텍스트' = UTF-16LE + BOM + 탭 */
  const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('종목명\t평균단가\r\nHPSP\t65000\r\n', 'utf16le')]);
  assert.deepStrictEqual(got(H.parse((await H.fileRows(u16.buffer.slice(u16.byteOffset, u16.byteOffset + u16.length))).rows, lookup)), [['403870', 65000, null]]);
  await assert.rejects(H.fileRows(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).buffer), function (e) { return e.code === 'xls'; });
});

Promise.all(jobs).then(function () {
  console.log(process.exitCode ? '잔고 가져오기 검증 실패' : '✓ 잔고 가져오기 검증: ' + passed + '개 통과');
});

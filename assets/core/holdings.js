/* =============================================================
   holdings.js — 증권사 잔고(보유 종목 · 평균단가) 읽기: 붙여 넣은 글 · 파일 → 종목별 평단가

   계좌 조회 API 가 없는 증권사(미래에셋증권 등)는 잔고 화면의 표를 복사하거나 파일로 내려받아 가져온다.
   증권사 · 화면마다 열 이름과 순서가 달라 '열 제목'으로 찾는다 — 형식을 하나로 정해 두지 않는다.

   읽는 순서
     1) 글 · 파일 → 행렬      rows(text) · htmlRows(html) · xlsxRows(bytes) · fileRows(bytes)
          탭 · 쉼표 · 세미콜론 · | 구분, 엑셀(.xlsx), 표(HTML)로 저장된 .xls, UTF-8 · UTF-16 · EUC-KR
     2) 행렬 → 보유 종목       parse(rows, lookup)
          · 표: 열 제목 줄을 찾아 종목명 · 종목코드 · 평균단가 · 보유수량 열을 고른다 (평균단가가 없으면 매입금액 ÷ 수량)
          · 간단 입력: 열 제목이 없으면 한 줄을 '종목 평단가 [수량]' 으로 읽는다 (숫자가 3개 이상이면 어느 것이 평단가인지 알 수 없어 읽지 않는다)
          · 같은 종목이 여러 줄이면(현금 · 신용, 계좌 여러 개) 수량을 더하고 평단가는 수량 가중평균
   숫자가 어느 통화인지는 알 수 없다 — 현재가와 터무니없이 다른 값은 화면(importer.js)에서 걸러 보여 준다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  /* ---------------- 숫자 ---------------- */
  /** '65,000원' · '$182.50' · '(1,200)' → 숫자. 퍼센트 · 글자가 섞인 값은 null */
  function num(s){
    if (typeof s === 'number') return isFinite(s) ? s : null;
    let t = String(s == null ? '' : s).trim();
    if (!t || t.indexOf('%') >= 0) return null;
    const neg = /^\(.*\)$/.test(t) || /^[-−–]/.test(t);
    t = t.replace(/KRW|USD/gi, '').replace(/[₩￦$원주,\s]/g, '').replace(/^[(\-−–+]+|\)$/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    return neg ? -parseFloat(t) : parseFloat(t);
  }

  /* ---------------- 글 → 행렬 ---------------- */
  function splitLine(line, d){
    if (d === '\t') return line.split('\t');
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++){
      const c = line[i];
      if (q){ if (c === '"'){ if (line[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"' && !cur.trim()){ q = true; cur = ''; }
      else if (c === d){ out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  /* 쉼표가 구분자인가 — '65,000' 의 쉼표(양옆이 숫자)는 세지 않는다. 글자 · 따옴표 옆의 쉼표가 줄의 절반 이상에 있거나 첫 줄(열 제목)에 둘 이상이면 CSV */
  function commaSeparated(lines){
    const hard = function (l) { return (l.match(/[^\d\s],|,[^\d\s]/g) || []).length; };
    return hard(lines[0]) >= 2 || lines.filter(function (l) { return hard(l) > 0; }).length >= lines.length / 2;
  }
  function consistent(lines, d){
    const n = lines.map(function (l) { return splitLine(l, d).length; }), by = {};
    n.forEach(function (c) { by[c] = (by[c] || 0) + 1; });
    const top = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })[0];
    return +top >= 2 && by[top] >= lines.length * 0.7;
  }
  /**
   * @returns 행렬(문자열). rows.loose = 공백으로만 나뉜 글이라 칸 경계가 확실하지 않음 (종목명에 공백이 있으면 칸 수가 늘어난다)
   */
  function rows(text){
    const lines = String(text == null ? '' : text).replace(/^﻿/, '').split(/\r\n|\r|\n/).filter(function (l) { return l.trim(); });
    let out, loose = false;
    if (!lines.length) out = [];
    else if (lines.some(function (l) { return l.indexOf('\t') >= 0; })) out = lines.map(function (l) { return splitLine(l, '\t'); });
    else {
      const d = commaSeparated(lines) ? ',' : [';', '|'].filter(function (c) { return consistent(lines, c); })[0];
      if (d) out = lines.map(function (l) { return splitLine(l, d); });
      else {
        const wide = lines.filter(function (l) { return l.trim().split(/\s{2,}/).length >= 2; }).length >= lines.length * 0.6;
        out = lines.map(function (l) { return l.trim().split(wide ? /\s{2,}/ : /\s+/); });
        loose = !wide;
      }
    }
    out = out.map(function (r) { return r.map(function (c) { return String(c).trim(); }); });
    out.loose = loose;
    return out;
  }

  /* ---------------- 표(HTML) → 행렬 : '엑셀 저장'이 실제로는 HTML 표인 .xls ---------------- */
  const ENT = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };
  function unescapeXml(s){
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
    });
  }
  function htmlRows(html){
    const tables = String(html).match(/<table[\s\S]*?<\/table>/gi) || [];
    let best = [];
    tables.forEach(function (t) {
      const r = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map(function (tr) {
        return (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(function (c) {
          return unescapeXml(c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        });
      }).filter(function (x) { return x.length; });
      if (r.length > best.length) best = r;
    });
    return best;
  }

  /* ---------------- 엑셀(.xlsx) → 행렬 : zip 안의 XML 을 직접 읽는다 (첫 번째 시트) ---------------- */
  function colOf(ref){ let n = 0; for (let i = 0; i < ref.length; i++){ const c = ref.charCodeAt(i); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; }
  function sheetRows(xml, shared){
    const out = [];
    (xml.match(/<row[\s>][\s\S]*?<\/row>/g) || []).forEach(function (row) {
      const cells = [];
      let next = 0;
      (row.match(/<c(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (c) {
        const ref = /\sr="([A-Z]+)\d+"/.exec(c), type = /\st="(\w+)"/.exec(c), v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(c);
        const at = ref ? colOf(ref[1]) : next;
        let val = '';
        if (type && type[1] === 's') val = v ? shared[+v[1]] || '' : '';
        else if (type && type[1] === 'inlineStr') val = unescapeXml((c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join(''));
        else val = v ? unescapeXml(v[1]) : '';
        cells[at] = val.trim();
        next = at + 1;
      });
      for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
      if (cells.some(function (x) { return x; })) out.push(cells);
    });
    return out;
  }
  /** @param buf ArrayBuffer (.xlsx). 압축 해제는 브라우저 · node 의 DecompressionStream('deflate-raw') */
  async function xlsxRows(buf){
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), td = new TextDecoder();
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;                 // 중앙 디렉터리 끝 레코드
    if (e < 0) throw new Error('zip');
    const files = {};
    let p = dv.getUint32(e + 16, true);
    for (let i = dv.getUint16(e + 10, true); i > 0 && dv.getUint32(p, true) === 0x02014b50; i--){
      const nl = dv.getUint16(p + 28, true);
      files[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { method:dv.getUint16(p + 10, true), size:dv.getUint32(p + 20, true), at:dv.getUint32(p + 42, true) };
      p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    async function read(name){
      const f = files[name];
      if (!f) return null;
      const from = f.at + 30 + dv.getUint16(f.at + 26, true) + dv.getUint16(f.at + 28, true), data = u8.subarray(from, from + f.size);
      if (f.method === 0) return td.decode(data);
      if (f.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('inflate');
      return td.decode(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
    const sst = await read('xl/sharedStrings.xml'), shared = [];
    if (sst) (sst.match(/<si>[\s\S]*?<\/si>|<si\/>/g) || []).forEach(function (si) {
      shared.push(unescapeXml((si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('')));
    });
    /* 통합 문서의 첫 시트 — 관계 파일에서 경로를 찾고, 못 찾으면 번호가 가장 작은 시트 */
    let path = null;
    const wb = await read('xl/workbook.xml'), rel = await read('xl/_rels/workbook.xml.rels');
    const rid = wb && /<sheet\s[^>]*r:id="([^"]+)"/.exec(wb);
    if (rid && rel){
      const m = new RegExp('<Relationship\\s[^>]*Id="' + rid[1] + '"[^>]*>').exec(rel), t = m && /Target="([^"]+)"/.exec(m[0]);
      if (t) path = t[1][0] === '/' ? t[1].slice(1) : 'xl/' + t[1];
    }
    if (!path || !files[path]) path = Object.keys(files).filter(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); })
      .sort(function (a, b) { return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10); })[0];
    const xml = path && await read(path);
    if (!xml) throw new Error('sheet');
    return sheetRows(xml, shared);
  }

  /**
   * 파일 내용 → 행렬. 확장자가 아니라 내용으로 형식을 가린다 (.xls 라는 이름의 HTML · 텍스트가 흔하다)
   * @returns {rows, kind:'xlsx'|'html'|'text'}   구형 .xls(BIFF)는 { code:'xls' } 로 던진다
   */
  async function fileRows(buf){
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0x50 && u8[1] === 0x4B) return { rows:await xlsxRows(buf), kind:'xlsx' };
    if (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) throw Object.assign(new Error('xls'), { code:'xls' });
    let text;
    if (u8[0] === 0xFF && u8[1] === 0xFE) text = new TextDecoder('utf-16le').decode(u8);
    else {
      try { text = new TextDecoder('utf-8', { fatal:true }).decode(u8); }
      catch (e) { text = new TextDecoder('euc-kr').decode(u8); }                // 국내 HTS 의 CSV · 엑셀 저장은 대개 EUC-KR(CP949)
    }
    return /<table[\s>]/i.test(text) ? { rows:htmlRows(text), kind:'html' } : { rows:rows(text), kind:'text' };
  }

  /* ---------------- 행렬 → 보유 종목 ---------------- */
  /* 열 제목 후보 (앞쪽이 우선). bad = 그 글자가 들어 있으면 다른 열이다 */
  const COLS = {
    name:   { keys:['종목명', '상품명', '종목', '품목', 'name', 'stock'], bad:/코드|번호|구분|code|symbol|ticker/ },
    code:   { keys:['종목코드', '단축코드', '상품코드', '종목번호', '코드', '심볼', '티커', 'symbol', 'ticker', 'code'], bad:/계좌|지점|통화/ },
    avg:    { keys:['평균단가', '평균매입가', '매입평균가', '평균매수가', '매수평균가', '매입단가', '매수단가', '평단가', '평균가', '취득단가', '장부단가', '매입가', '매수가', 'avgprice', 'averageprice', 'avgcost', 'average', 'cost'],
              bad:/금액|현재|평가|손익|수익|가능|체결/ },
    qty:    { keys:['보유수량', '잔고수량', '보유량', '보유주수', '결제잔고', '잔고', '수량', 'quantity', 'qty', 'shares'], bad:/가능|미체결|주문|금액|평가|손익|단가|비중|대출/ },
    amount: { keys:['매입금액', '매수금액', '취득금액', '장부금액', '투자금액', '매입원가'], bad:/평가|손익/ }
  };
  const TOTAL = /^(합계|총계|소계|계|total|sum)$/i;
  function headKey(s){ return String(s == null ? '' : s).toLowerCase().replace(/[^a-z가-힣]/g, ''); }
  function pick(cells, def){
    let best = -1, rank = Infinity;
    cells.forEach(function (c, i) {
      if (!c || def.bad.test(c)) return;
      for (let k = 0; k < def.keys.length && k < rank; k++) if (c.indexOf(def.keys[k]) >= 0){ rank = k; best = i; break; }
    });
    return best;
  }
  function columns(row){
    const cells = row.map(headKey), c = {};
    Object.keys(COLS).forEach(function (k) { c[k] = pick(cells, COLS[k]); });
    if (!((c.name >= 0 || c.code >= 0) && (c.avg >= 0 || (c.amount >= 0 && c.qty >= 0)))) return null;
    /* '종목별 평균단가 현황' 같은 제목 한 칸이 종목 열이자 평단가 열로 잡히면 열 제목 줄이 아니다 */
    const used = [c.name, c.code, c.avg, c.qty, c.amount].filter(function (i) { return i >= 0; });
    return used.every(function (i, k) { return used.indexOf(i) === k; }) ? c : null;
  }
  /** 종목코드 표기 정리 — 따옴표 · 공백 제거, 대문자. 'A005930' 의 A 는 lookup 이 떼고 다시 찾는다 */
  function codeKey(s){ return String(s == null ? '' : s).replace(/['"`\s]/g, '').replace(/\.(KS|KQ)$/i, '').toUpperCase(); }

  /**
   * @param table   rows() · htmlRows() · xlsxRows() 의 행렬
   * @param lookup  function (code, name) → { code, name, cur } | null   — 종목 마스터에서 찾는다 (importer.js)
   * @returns { mode:'table'|'simple', used:{name,code,avg,qty,amount: 열 제목|null}, items:[{code,name,cur,avg,qty,lines}],
   *            unmatched:[{name,code,avg,qty}], error:null|'empty'|'nocols'|'nodata' }
   */
  function parse(table, lookup){
    const res = { mode:'simple', used:null, items:[], unmatched:[], error:null };
    const data = (table || []).filter(function (r) { return r && r.some(function (c) { return c; }); });
    if (!data.length){ res.error = 'empty'; return res; }
    const found = [];
    function take(name, code, avg, qty){
      if (!(avg > 0) || (!name && !code)) return false;
      const st = lookup(codeKey(code), name || '');
      const q = qty > 0 ? qty : null;
      if (st) found.push({ code:st.code, name:st.name, cur:st.cur, avg:avg, qty:q });
      else res.unmatched.push({ name:name || '', code:code || '', avg:avg, qty:q });
      return true;
    }

    let hi = -1, col = null;
    for (let i = 0; i < Math.min(data.length, 15) && !col; i++){ col = columns(data[i]); if (col) hi = i; }
    if (col){
      res.mode = 'table';
      const head = data[hi];
      res.used = {};
      Object.keys(col).forEach(function (k) { res.used[k] = col[k] >= 0 ? head[col[k]] : null; });
      const first = col.name >= 0 ? col.name : col.code;
      for (let i = hi + 1; i < data.length; i++){
        let r = data[i];
        /* 공백으로만 나뉜 글: 종목명에 공백이 있어 칸이 늘어난 줄은 종목명 칸으로 다시 합친다 */
        const extra = r.length - head.length;
        if (table.loose && extra > 0) r = r.slice(0, first).concat([r.slice(first, first + extra + 1).join(' ')], r.slice(first + extra + 1));
        const name = col.name >= 0 ? r[col.name] || '' : '', code = col.code >= 0 ? r[col.code] || '' : '';
        if (TOTAL.test(name.replace(/\s/g, '')) || TOTAL.test(code.replace(/\s/g, ''))) continue;
        const qty = col.qty >= 0 ? num(r[col.qty]) : null, amount = col.amount >= 0 ? num(r[col.amount]) : null;
        let avg = col.avg >= 0 ? num(r[col.avg]) : null;
        if (!(avg > 0) && amount > 0 && qty > 0) avg = amount / qty;
        take(name, code, avg, qty);
      }
    } else {
      /* 간단 입력 — '종목 평단가 [수량]'. 종목명에 숫자가 들어간 경우(KODEX 200)를 위해 긴 이름부터 종목을 찾아 본다 */
      let wide = 0;
      data.forEach(function (r) {
        const t = r.join(' ').split(/\s+/).filter(function (x) { return x && x.indexOf('%') < 0; });
        let done = false;
        for (let k = t.length - 1; k >= 1 && !done; k--){
          const rest = t.slice(k).map(num), name = t.slice(0, k).join(' ');
          if (rest.length > 2 || rest.some(function (v) { return v == null; })) continue;
          if (lookup(codeKey(name), name)) done = take(name, name, rest[0], rest[1]);
        }
        if (done) return;
        let k = t.length;
        while (k > 0 && num(t[k - 1]) != null) k--;                              // 끝에서부터 숫자
        const nums = t.slice(k).map(num), name = t.slice(0, k).join(' ');
        if (!name || !nums.length) return;
        if (nums.length > 2){ wide++; return; }
        take(name, name, nums[0], nums[1]);
      });
      if (!found.length && !res.unmatched.length){ res.error = wide ? 'nocols' : 'nodata'; return res; }
    }

    /* 같은 종목 합치기 — 수량 가중평균 (수량이 없는 줄이 섞이면 단순평균) */
    const by = {};
    found.forEach(function (x) {
      const m = by[x.code];
      if (!m){ by[x.code] = Object.assign({ lines:1 }, x); res.items.push(by[x.code]); return; }
      if (m.qty && x.qty){ m.avg = (m.avg * m.qty + x.avg * x.qty) / (m.qty + x.qty); m.qty += x.qty; }
      else { m.avg = (m.avg * m.lines + x.avg) / (m.lines + 1); m.qty = null; }
      m.lines++;
    });
    if (!res.items.length && !res.unmatched.length) res.error = 'nodata';
    return res;
  }

  QT.Holdings = { num:num, rows:rows, htmlRows:htmlRows, xlsxRows:xlsxRows, fileRows:fileRows, parse:parse, codeKey:codeKey };
})(window.QT);

/* =============================================================
   importer.js — '잔고 가져오기' 창 (내 포지션 카드 → 여러 종목의 평단가를 한 번에)
     · 붙여 넣기 : 증권사 잔고 화면의 표를 열 제목 줄까지 복사해 그대로, 또는 한 줄에 '종목 평단가 수량'
     · 파일     : CSV · TXT · 엑셀(.xlsx) · 표로 저장된 .xls — 창에 끌어다 놓아도 된다
     · 읽은 결과를 표로 먼저 보여 주고, 체크한 종목만 저장한다 (저장소는 app.js 의 내 포지션)
     · 붙여 넣은 글과 파일은 이 브라우저 안에서만 읽는다 — 어디에도 보내지 않는다
   읽는 규칙은 core/holdings.js. 여기서는 종목 마스터에서 종목을 찾고, 현재가와 터무니없이 다른 값을 걸러 보여 준다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const M = QT.Market, H = QT.Holdings;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const MAX_BYTES = 5 * 1024 * 1024, FAR = 20;           // 파일 크기 한도 · 현재가와 이 배수 넘게 다르면 '확인 필요'

  let ctx = { apply:function () {}, get:function () { return null; }, count:function () { return 0; } };
  let view = { res:null, off:{}, timer:0, seq:0 };       // off = 사용자가 체크를 푼 종목

  function fin(v){ return v != null && isFinite(v); }
  function icons(){ if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function price(v, cur){ return !fin(v) ? '—' : cur === 'USD' ? '$' + v.toFixed(2) : (Math.round(v * 100) / 100).toLocaleString('ko-KR') + '원'; }
  function pct1(v){ return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%'; }
  function cls(v){ return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }

  /* ---------------- 종목 찾기 ----------------
     종목코드 열이 따로 있으면 코드가 우선이다. 이름 하나만 있을 때는 이름으로 먼저 찾는다 —
     'KT' 처럼 국내 종목명이 미국 티커와 같은 경우 국내 종목이 맞을 가능성이 훨씬 크다 */
  let byName = null, byEn = null;
  function nameKey(s){ return String(s == null ? '' : s).toUpperCase().replace(/[\s.,·&()\-_'"\/]/g, ''); }
  function better(a, b){ return (a.cur === 'KRW') - (b.cur === 'KRW') || (a.type !== 'etf') - (b.type !== 'etf'); }
  function index(){
    byName = {}; byEn = {};
    M.UNIVERSE.forEach(function (s) {
      [[byName, s.name], [byEn, s.en]].forEach(function (z) {
        const k = nameKey(z[1]);
        if (k && (!z[0][k] || better(s, z[0][k]) > 0)) z[0][k] = s;
      });
    });
  }
  function byCode(code){ return code ? M.BY_CODE[code] || (/^A[0-9A-Z]{6}$/.test(code) ? M.BY_CODE[code.slice(1)] : null) : null; }
  function lookup(code, name){
    if (!byName) index();
    const k = nameKey(name), named = k ? byName[k] || byEn[k] : null;
    const same = nameKey(code) === k, krCode = /^A?\d[0-9A-Z]{5}$/.test(code);
    const st = same && !krCode ? named || byCode(code) : byCode(code) || named;
    return st ? { code:st.code, name:st.name, cur:st.cur } : null;
  }

  /* ---------------- 읽은 결과 다듬기 ---------------- */
  function annotate(res){
    res.items.forEach(function (it) {
      const q = M.lightQuote(it.code), p = q && q.price > 0 ? q.price : null;
      const far = function (v) { return p != null && (v / p > FAR || v / p < 1 / FAR); };
      /* 간단 입력에서 '종목 수량 평단가' 순서로 적은 경우 — 첫 숫자는 현재가와 동떨어지고 둘째 숫자는 맞으면 바꿔 읽는다 */
      if (res.mode === 'simple' && it.qty && far(it.avg) && !far(it.qty)){ const t = it.avg; it.avg = it.qty; it.qty = t; it.swapped = true; }
      it.avg = Math.round(it.avg * 1e4) / 1e4;
      it.price = p; it.far = far(it.avg);
      it.pnl = p != null ? (p / it.avg - 1) * 100 : null;
      const old = ctx.get(it.code);
      it.old = old;
      it.status = !old ? 'new' : Math.abs(old.avg - it.avg) < 1e-6 && (old.qty || null) === (it.qty || null) ? 'same' : 'changed';
      if (it.far && view.off[it.code] == null) view.off[it.code] = true;        // 확인이 필요한 값은 기본으로 뺀다
    });
    return res;
  }
  function picked(){ return view.res ? view.res.items.filter(function (it) { return !view.off[it.code]; }) : []; }

  /* ---------------- 그리기 ---------------- */
  const ERR = {
    nocols:'숫자가 여러 개인데 열 제목이 없어 어느 값이 평균단가인지 알 수 없습니다. 표의 <b>열 제목 줄</b>(종목명 · 평균단가 …)까지 함께 복사해 주세요.',
    nodata:'종목과 평균단가를 찾지 못했습니다. 열 제목에 <b>종목명</b>(또는 종목코드)과 <b>평균단가</b>(매입단가 · 평단가 · 매입금액+수량)가 있어야 합니다.',
    xls:'구형 엑셀(.xls) 파일은 읽지 못합니다. 엑셀에서 <b>다른 이름으로 저장 → .xlsx 또는 CSV</b>로 바꾸거나, 표를 복사해 위 칸에 붙여 넣어 주세요.',
    file:'파일을 읽지 못했습니다. 표를 복사해 위 칸에 붙여 넣어 보세요.',
    big:'파일이 너무 큽니다(5MB 초과). 잔고 표만 들어 있는 파일을 골라 주세요.'
  };
  function message(kind, html){ return '<div class="imp-msg ' + kind + '">' + html + '</div>'; }
  function render(error){
    const res = view.res, out = $('#imp-out');
    let html = '';
    if (error) html = message('bad', ERR[error] || ERR.file);
    else if (res && res.error && res.error !== 'empty') html = message('bad', ERR[res.error]);
    else if (res && !res.error){
      const u = res.used;
      html = message('ok', res.mode === 'table'
        ? '열 제목 ' + ['name', 'code', 'avg', 'amount', 'qty'].filter(function (k) { return u[k] && (k !== 'amount' || !u.avg); }).map(function (k) { return '<b>' + esc(u[k]) + '</b>'; }).join(' · ') + ' 을(를) 읽었습니다.'
        : '열 제목이 없어 한 줄씩 <b>종목 · 평단가 · 수량</b> 순서로 읽었습니다.');
      if (res.items.length){
        html += '<div class="imp-t"><div class="imp-r hd"><span></span><span>종목</span><span>평단가</span><span>수량</span><span>현재 수익률</span><span>상태</span></div>' +
          res.items.map(function (it) {
            const notes = [];
            if (it.far) notes.push('현재가 ' + price(it.price, it.cur) + '와 차이가 큼 — 통화 · 액면분할 확인');
            if (it.swapped) notes.push('수량 · 평단가 순서로 읽음');
            if (it.lines > 1) notes.push(it.lines + '줄 합산');
            const st = it.status === 'new' ? '<em class="imp-tag new">신규</em>' : it.status === 'same' ? '<em class="imp-tag">같음</em>'
              : '<em class="imp-tag chg">변경</em><small>' + price(it.old.avg, it.cur) + ' →</small>';
            return '<label class="imp-r' + (it.far ? ' far' : '') + '"><input type="checkbox" data-code="' + esc(it.code) + '"' + (view.off[it.code] ? '' : ' checked') + '>' +
              '<span class="nm"><b>' + esc(it.name) + '</b><small>' + esc(it.code) + '</small>' + (notes.length ? '<i>' + notes.join(' · ') + '</i>' : '') + '</span>' +
              '<span class="num">' + price(it.avg, it.cur) + '</span><span class="num">' + (it.qty ? it.qty.toLocaleString('ko-KR') : '—') + '</span>' +
              '<span class="num ' + (it.pnl != null ? cls(it.pnl) : 'flat') + '">' + (it.pnl != null && !it.far ? pct1(it.pnl) : '—') + '</span><span class="st">' + st + '</span></label>';
          }).join('') + '</div>';
      }
      if (res.unmatched.length){
        html += message('miss', '<b>종목을 찾지 못한 줄 ' + res.unmatched.length + '개</b> — 종목코드나 정식 종목명으로 적으면 찾을 수 있습니다.<ul>' +
          res.unmatched.slice(0, 8).map(function (x) { return '<li>' + esc(x.name || x.code) + ' · ' + esc(x.avg.toLocaleString('ko-KR')) + (x.qty ? ' · ' + esc(x.qty.toLocaleString('ko-KR')) + '주' : '') + '</li>'; }).join('') +
          (res.unmatched.length > 8 ? '<li>… 외 ' + (res.unmatched.length - 8) + '개</li>' : '') + '</ul>');
      }
    }
    out.innerHTML = html;
    sync();
  }
  /* 저장 버튼 · 옵션 */
  function sync(){
    const n = picked().length, saved = ctx.count(), has = !!(view.res && view.res.items.length);
    const btn = $('#imp-apply');
    btn.disabled = !n;
    btn.textContent = n ? n + '종목 저장' : '저장';
    $('#imp-opts').hidden = !has;
    $('#imp-replace-wrap').hidden = !saved;
    $('#imp-replace-n').textContent = saved ? '(지금 ' + saved + '종목 저장됨)' : '';
  }

  /* ---------------- 입력 ---------------- */
  function analyze(table){
    view.off = {};
    view.res = annotate(H.parse(table, lookup));
    render();
  }
  function onText(){
    clearTimeout(view.timer);
    view.timer = setTimeout(function () {
      view.seq++;                                        // 읽고 있던 파일이 있으면 그 결과는 버린다
      $('#imp-file-name').textContent = FILE_HINT;
      const text = $('#imp-text').value;
      if (!text.trim()){ view.res = null; render(); return; }
      analyze(H.rows(text));
    }, 150);
  }
  const FILE_HINT = 'CSV · TXT · 엑셀(.xlsx) — 이 창에 끌어다 놓아도 됩니다';
  function onFile(file){
    if (!file) return;
    const seq = ++view.seq;
    clearTimeout(view.timer);
    $('#imp-text').value = '';
    $('#imp-file-name').textContent = file.name;
    if (file.size > MAX_BYTES){ view.res = null; render('big'); return; }
    file.arrayBuffer().then(H.fileRows).then(function (r) {
      if (seq === view.seq) analyze(r.rows);
    }).catch(function (e) {
      if (seq !== view.seq) return;
      console.warn('[QT] 잔고 파일', e);
      view.res = null; render(e && e.code === 'xls' ? 'xls' : 'file');
    });
  }

  function open(){
    view = { res:null, off:{}, timer:0, seq:view.seq + 1 };
    $('#imp-text').value = ''; $('#imp-file-in').value = ''; $('#imp-file-name').textContent = FILE_HINT;
    $('#imp-replace').checked = false;
    render();
    $('#imp').classList.add('show');
    document.body.classList.add('modal-lock');
    $('#imp .m-body').scrollTop = 0;
    icons();
    $('#imp-text').focus();
  }
  function close(){ $('#imp').classList.remove('show'); document.body.classList.remove('modal-lock'); }

  function init(c){
    ctx = Object.assign(ctx, c || {});
    const box = $('#imp');
    if (!box) return;
    $('#imp-text').addEventListener('input', onText);
    $('#imp-file-in').addEventListener('change', function (e) { onFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    box.addEventListener('dragover', function (e) { e.preventDefault(); });
    box.addEventListener('drop', function (e) { e.preventDefault(); onFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
    $('#imp-out').addEventListener('change', function (e) {
      const cb = e.target.closest('input[data-code]'); if (!cb) return;
      view.off[cb.dataset.code] = !cb.checked;
      sync();
    });
    $('#imp-apply').addEventListener('click', function () {
      const list = picked().map(function (it) { return { code:it.code, avg:it.avg, qty:it.qty }; });
      if (!list.length) return;
      ctx.apply(list, { watch:$('#imp-wl').checked, replace:$('#imp-replace').checked });
      close();
    });
    $('#imp-cancel').addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box.classList.contains('show')) close(); });
  }

  QT.Importer = { init:init, open:open, lookup:lookup };
})(window.QT);

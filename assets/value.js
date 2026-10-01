/* =============================================================
   value.js — '가치분석' 탭 (종합 매수 신호 · AI 가치분석 요약 · 밸류에이션 ·
              실적 추이 · 재무 건전성 · 적정주가 · 가치 체크리스트)
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const M = QT.Market, F = QT.Fund, S = QT.Signal;
  const $ = function (s, r) { return (r || document).querySelector(s); };

  function fin(v){ return v != null && isFinite(v); }
  function icons(){ if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }
  function price(v, cur){
    if (!fin(v)) return '—';
    return cur === 'USD' ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원';
  }
  function pct1(v){ return fin(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%' : '—'; }
  /** 증감률 — 100% 이상은 정수 · 천 단위 구분 (+1,814%) */
  function gpct(v){
    const a = Math.abs(v);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + (a >= 100 ? Math.round(a).toLocaleString('ko-KR') : a.toFixed(1)) + '%';
  }
  function cls(v){ return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function x1(v, dp){ return fin(v) ? v.toFixed(dp == null ? 1 : dp) : '—'; }

  let ctx = { select:null, tip:function () { return ''; } };
  const view = { code:null, perf:'annual', band:'per', lastFull:0, visible:false, a:null, st:null };

  /* ---------------- 등급 배지 ---------------- */
  function badge(g, score, sm){
    if (!g) return '<span class="gbadge none' + (sm ? ' sm' : '') + '">판단 불가</span>';
    return '<span class="gbadge ' + g.key + (sm ? ' sm' : '') + '">' + g.label + (score != null ? ' <b class="num">' + score + '</b>' : '') + '</span>';
  }
  function tagChips(tags, n){
    return (tags || []).slice(0, n || 6).map(function (t) { return '<span class="vtag ' + t.tone + '">' + t.text + '</span>'; }).join('');
  }

  /* ---------------- ⓪ 종합 매수 신호 ---------------- */
  function scaleBar(score){
    const zones = [[0, 30, 'ssell'], [30, 45, 'sell'], [45, 65, 'neut'], [65, 80, 'buy'], [80, 100, 'sbuy']];
    return '<div class="gscale" aria-hidden="true">' + zones.map(function (z) {
      return '<i class="' + z[2] + '" style="left:' + z[0] + '%;width:' + (z[1] - z[0]) + '%"></i>';
    }).join('') + (fin(score) ? '<span class="mk" style="left:' + Math.max(0, Math.min(100, score)) + '%"></span>' : '') +
      '</div><div class="gscale-l"><span>0</span><span style="left:30%">30</span><span style="left:45%">45</span><span style="left:65%">65</span><span style="left:80%">80</span><span style="left:100%">100</span></div>';
  }
  function partRows(parts, extra){
    return parts.map(function (p) {
      return '<div class="pt"><span class="pt-n">' + p.name + '</span><span class="pt-b"><i style="width:' + (p.pts / p.max * 100) + '%"></i></span>' +
        '<b class="num">' + p.pts + '<small>/' + p.max + '</small></b><small class="pt-note">' + p.note + '</small></div>';
    }).join('') + (extra || '');
  }
  function signalCard(st, a, fa, t){
    const c = S.combine(t, fa);
    const techPts = t ? t.score : null, fundPts = fa ? fa.score : null;
    const tags = (fa ? fa.tags : []).concat(t ? t.tags : []).sort(function (x, y) { return y.w - x.w; });
    const tgt = a && a.targets && M.isReal(st.code) ? a.targets.mid.base : null;     // 시뮬레이션 경로의 목표가는 쓰지 않는다
    /* 기술 · 재무가 모두 있으면 종합, 한쪽만 있으면 그 점수로 표시 */
    const one = c.total != null ? null : techPts != null ? ['tech', techPts, c.techGrade, '기술만'] : fundPts != null ? ['fund', fundPts, c.fundGrade, '재무만'] : null;
    const shown = c.total != null ? c.total : one ? one[1] : null;
    let head;
    if (c.total != null) head = badge(c.grade) + '<div class="sg-score"><b class="num">' + c.total + '</b><span>/ 100</span></div>';
    else head = badge(one ? one[2] : null) + '<div class="sg-score"><b class="num">' + (one ? one[1] : '—') + '</b><span>/ 100' + (one ? ' · ' + one[3] : '') + '</span></div>';
    const up = fa && fa.fv && fin(fa.fv.upside) ? fa.fv.upside : null;
    return '<div class="card-hd"><i data-lucide="radar"></i><h2>종합 매수 신호</h2><span class="sub">기술 50% + 재무 50%' + ctx.tip('signal') + '</span></div>' +
      '<div class="sg">' +
        '<div class="sg-top">' + head + '</div>' +
        scaleBar(shown) +
        '<div class="sg-duo">' +
          '<div class="sg-half"><div class="sg-h"><span>기술 점수</span>' + badge(c.techGrade, techPts, true) + '</div>' +
            (t ? partRows(t.parts) : '<p class="muted sm">실제 일봉이 부족해 계산하지 않았습니다.</p>') + '</div>' +
          '<div class="sg-half"><div class="sg-h"><span>재무 점수</span>' + badge(c.fundGrade, fundPts, true) + '</div>' +
            (fa ? partRows(fa.scoring.parts, fa.scoring.penalty ? '<div class="pt pen"><span class="pt-n">재무 위험 감점</span><span></span><b class="num down">−' + fa.scoring.penalty + '</b><small class="pt-note">' + fa.scoring.penaltyNote + '</small></div>' : '')
               : '<p class="muted sm">재무 데이터가 수집되지 않은 종목입니다' + (st.type === 'etf' ? ' (ETF)' : '') + '.</p>') + '</div>' +
        '</div>' +
        (tags.length ? '<div class="vtags">' + tagChips(tags.filter(function (x) { return x.tone === 'good'; }), 5) + tagChips(tags.filter(function (x) { return x.tone === 'bad'; }), 3) + '</div>' : '') +
        '<div class="sg-foot">' +
          '<div><span>적정주가 기준 상승 여력</span><b class="num ' + cls(up) + '">' + (up != null ? pct1(up) : '—') + '</b>' + (fa && fa.fv && fin(fa.fv.value) ? '<small>' + price(fa.fv.value, st.cur) + '</small>' : '') + '</div>' +
          '<div><span>기술적 목표가 (1~3개월)</span><b class="num ' + cls(tgt ? tgt.pct : 0) + '">' + (tgt ? pct1(tgt.pct) : '—') + '</b>' + (tgt ? '<small>' + price(tgt.v, st.cur) + '</small>' : '') + '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- ① AI 가치분석 요약 ---------------- */
  function summaryCard(st, fa, t, c){
    const lines = fa.summary.slice();
    if (t){
      const tp = t.parts;
      lines.push({ tone: t.score >= 65 ? 'good' : t.score >= 45 ? 'neut' : 'bad',
        html:'기술적으로는 ' + (tp[0].pts ? tp[0].note.split(' · ').slice(0, 2).join(', ') : '이동평균선이 모두 하락 배열') +
          ', RSI ' + (fin(t.rsi) ? t.rsi.toFixed(0) : '—') + ', ' + tp[3].note + ' 상태로 기술 점수 <b>' + t.score + '점</b>입니다.' });
    }
    const g = c.total != null ? c.grade : c.fundGrade;
    const verdict = c.total != null
      ? '기술(' + c.tech + ')과 재무(' + c.fund + ')를 합친 종합 점수는 <b>' + c.total + '점 · ' + g.label + '</b>입니다.'
      : '재무 점수만으로는 <b>' + fa.score + '점 · ' + g.label + '</b>입니다.';
    return '<div class="card-hd"><i data-lucide="sparkles"></i><h2>AI 가치분석 요약</h2><span class="sub">' + (fa.asOf ? String(fa.asOf).slice(0, 10) + ' 재무 수집' : '') + '</span></div>' +
      '<div class="vsum">' +
        '<div class="vsum-head">' + badge(g) + '<p>' + verdict + '</p></div>' +
        '<ul class="rs-list">' + lines.map(function (l) { return '<li class="' + (l.tone === 'good' ? 'bull' : l.tone === 'bad' ? 'caution' : 'neut') + '">' + l.html + '</li>'; }).join('') + '</ul>' +
        '<p class="sum-note">수집된 재무제표와 현재가로 계산한 참고 정보이며 투자 권유가 아닙니다.</p>' +
      '</div>';
  }

  /* ---------------- ② 밸류에이션 지표 ---------------- */
  function tile(label, value, sub, chip, tipKey){
    return '<div class="vt"><div class="vt-l">' + label + ctx.tip(tipKey) + '</div>' +
      '<div class="vt-row"><span class="vt-v num">' + value + '</span>' + (chip ? '<span class="vchip2 ' + chip[0] + '">' + chip[1] + '</span>' : '') + '</div>' +
      (sub ? '<div class="vt-s">' + sub + '</div>' : '') + '</div>';
  }
  function relChip(v, ref, lowGood){
    if (!fin(v) || !fin(ref)) return null;
    const r = v / ref;
    if (lowGood) return r <= 0.8 ? ['good', '저평가'] : r <= 1.1 ? ['neut', '적정'] : r <= 1.4 ? ['warn', '다소 고평가'] : ['bad', '고평가'];
    return r >= 1.2 ? ['good', '우수'] : r >= 0.9 ? ['neut', '보통'] : ['bad', '미흡'];
  }
  function valuationCard(st, fa){
    const v = fa.v, cur = st.cur;
    const per = fin(v.per)
      ? tile('PER', x1(v.per) + '배', fin(v.indPer) ? '업종 ' + x1(v.indPer) + '배 <small>(' + (v.perBasis || '') + ')</small>' : 'EPS ' + price(v.epsTTM, cur), relChip(v.per, v.indPer, true), 'per')
      : tile('PER', '적자', 'EPS ' + price(v.epsTTM, cur), ['bad', '산출 불가'], 'per');
    const fper = tile('선행 PER', fin(v.fwdPer) ? x1(v.fwdPer) + '배' : '—', v.fwdLabel ? v.fwdLabel : '컨센서스 없음',
      fin(v.fwdPer) && fin(v.per) ? (v.fwdPer < v.per * 0.9 ? ['good', '이익↑ 예상'] : v.fwdPer > v.per * 1.1 ? ['warn', '이익↓ 예상'] : ['neut', '비슷']) : null, 'fper');
    const pbr = tile('PBR', fin(v.pbr) ? x1(v.pbr, 2) + '배' : '—', fin(v.indPbr) ? '비교 ' + x1(v.indPbr, 2) + '배 <small>(' + v.pbrBasis + ')</small>' : 'BPS ' + price(v.bps, cur),
      fin(v.pbr) && v.pbr < 1 && fin(v.roe) && v.roe > 0 ? ['good', '청산가치 이하'] : relChip(v.pbr, v.indPbr, true), 'pbr');
    const roe = tile('ROE', fin(v.roe) ? x1(v.roe) + '%' : '—', '최근 4분기 순이익 ÷ 자기자본',
      !fin(v.roe) ? null : v.roe >= 15 ? ['good', '우수'] : v.roe >= 10 ? ['good', '양호'] : v.roe >= 5 ? ['neut', '보통'] : ['bad', '미흡'], 'roe');
    const ev = tile('EV/EBITDA', fin(v.evEbitda) ? x1(v.evEbitda) + '배' : '—', fin(v.evEbitdaHist) ? '과거 5년 중앙값 ' + x1(v.evEbitdaHist) + '배' : '기업가치 ÷ 현금창출력',
      relChip(v.evEbitda, v.evEbitdaHist, true), 'ev');
    const dy = tile('배당수익률', fin(v.dy) ? x1(v.dy, 2) + '%' : '—', fin(v.dps) && v.dps > 0 ? '주당배당금 ' + price(v.dps, cur) : '배당 없음',
      !fin(v.dy) ? null : v.dy >= (cur === 'USD' ? 2.5 : 3) ? ['good', '고배당'] : v.dy >= 1 ? ['neut', '보통'] : ['neut', '낮음'], 'dy');
    const peg = tile('PEG', fin(v.peg) ? x1(v.peg, 2) : '—', fin(v.epsGrowth) ? '이익 성장률 ' + pct1(v.epsGrowth) : '성장률 없음',
      !fin(v.peg) ? null : v.peg < 1 ? ['good', '저평가'] : v.peg < 2 ? ['neut', '적정'] : ['warn', '고평가'], 'peg');
    const fcf = tile('FCF 수익률', fin(v.fcfYield) ? x1(v.fcfYield) + '%' : '—', '잉여현금흐름 ÷ 시가총액',
      !fin(v.fcfYield) ? null : v.fcfYield >= 6 ? ['good', '우수'] : v.fcfYield >= 2 ? ['neut', '보통'] : ['bad', '낮음'], 'fcf');
    return '<div class="card-hd"><i data-lucide="scale"></i><h2>밸류에이션 지표</h2><span class="sub">현재가 ' + price(v.price, cur) + ' 기준</span></div>' +
      '<div class="vtiles">' + per + fper + pbr + roe + ev + dy + peg + fcf + '</div>';
  }

  /* ---------------- ③ 실적 추이 (막대 + 꺾은선) ---------------- */
  const SER = [
    { k:'rev', name:'매출액', color:'#2a78d6', kind:'bar' },
    { k:'op', name:'영업이익', color:'#eb6834', kind:'line' },
    { k:'ni', name:'당기순이익', color:'#1baf7a', kind:'line' }
  ];
  function niceTicks(lo, hi, n){
    const span = (hi - lo) || Math.abs(hi) || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), e = raw / mag;
    const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
    for (let v = a; v <= b + step * 0.01; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    return out;
  }
  function axisMoney(v, cur){
    if (v === 0) return '0';
    if (cur === 'USD') return Math.abs(v) >= 1000 ? (v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'B' : Math.round(v) + 'M';
    return Math.abs(v) >= 10000 ? (v / 10000).toFixed(Math.abs(v) >= 100000 ? 0 : 1).replace(/\.0$/, '') + '조' : Math.round(v).toLocaleString('ko-KR') + '억';
  }
  function perfData(f, mode){
    const B = mode === 'quarter' ? f.quarter : f.annual;
    if (!B || !B.p || !B.p.length) return null;
    const lab = B.p.map(function (p, i) {
      const e = B.e && B.e[i] ? 'E' : '';
      return mode === 'quarter' ? p.slice(2).replace('.', '.') + e : p + e;
    });
    return { lab:lab, e:B.e || [], rev:B.rev || [], op:B.op || [], ni:B.ni || [], opm:B.opm || [], p:B.p };
  }
  function perfSvg(f, mode, w){
    const d = perfData(f, mode);
    if (!d) return '<div class="empty">' + (mode === 'quarter' ? '분기' : '연간') + ' 실적이 없습니다.</div>';
    const n = d.lab.length, h = 188, pl = 46, pr = 10, pt = 12, pb = 24, pw = w - pl - pr, ph = h - pt - pb;
    const vals = [];
    SER.forEach(function (s) { d[s.k].forEach(function (v) { if (fin(v)) vals.push(v); }); });
    if (!vals.length) return '<div class="empty">표시할 실적이 없습니다.</div>';
    const ticks = niceTicks(Math.min(0, Math.min.apply(null, vals)), Math.max(0, Math.max.apply(null, vals)), 4);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const y = function (v) { return pt + (hi - v) / (hi - lo) * ph; };
    const bw = pw / n, cx = function (i) { return pl + bw * (i + 0.5); }, barW = Math.min(24, bw * 0.46), y0 = y(0);
    let g = '';
    ticks.forEach(function (t) {
      g += '<line x1="' + pl + '" x2="' + (w - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="' + (t === 0 ? '#D1D6DB' : '#F3F4F6') + '" stroke-width="1"/>' +
        '<text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" class="ax">' + axisMoney(t, f.cur) + '</text>';
    });
    /* 매출액 막대 — 위쪽(데이터 끝) 4px 둥글게, 기준선 쪽은 각지게 */
    d.rev.forEach(function (v, i) {
      if (!fin(v)) return;
      const x0 = cx(i) - barW / 2, x1_ = x0 + barW, yt = y(v), r = Math.min(4, Math.abs(y0 - yt));
      const path = v >= 0
        ? 'M' + x0 + ',' + y0 + 'V' + (yt + r) + 'Q' + x0 + ',' + yt + ' ' + (x0 + r) + ',' + yt + 'H' + (x1_ - r) + 'Q' + x1_ + ',' + yt + ' ' + x1_ + ',' + (yt + r) + 'V' + y0 + 'Z'
        : 'M' + x0 + ',' + y0 + 'V' + (yt - r) + 'Q' + x0 + ',' + yt + ' ' + (x0 + r) + ',' + yt + 'H' + (x1_ - r) + 'Q' + x1_ + ',' + yt + ' ' + x1_ + ',' + (yt - r) + 'V' + y0 + 'Z';
      g += '<path d="' + path + '" fill="' + SER[0].color + '"' + (d.e[i] ? ' fill-opacity=".38"' : '') + '/>';
    });
    /* 영업이익 · 순이익 꺾은선 (추정치 구간은 점선) */
    SER.slice(1).forEach(function (s) {
      const pts = d[s.k].map(function (v, i) { return fin(v) ? [cx(i), y(v), !!d.e[i]] : null; });
      for (let i = 1; i < pts.length; i++){
        if (!pts[i] || !pts[i - 1]) continue;
        g += '<line x1="' + pts[i - 1][0].toFixed(1) + '" y1="' + pts[i - 1][1].toFixed(1) + '" x2="' + pts[i][0].toFixed(1) + '" y2="' + pts[i][1].toFixed(1) +
          '" stroke="' + s.color + '" stroke-width="2" stroke-linecap="round"' + (pts[i][2] ? ' stroke-dasharray="4 4"' : '') + '/>';
      }
      pts.forEach(function (p) {
        if (!p) return;
        g += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="' + (p[2] ? '#fff' : s.color) + '" stroke="' + (p[2] ? s.color : '#fff') + '" stroke-width="2"/>';
      });
    });
    d.lab.forEach(function (l, i) {
      g += '<text x="' + cx(i).toFixed(1) + '" y="' + (h - 7) + '" text-anchor="middle" class="ax' + (d.e[i] ? ' est' : '') + '">' + l + '</text>';
      g += '<rect class="hit" data-i="' + i + '" x="' + (pl + bw * i).toFixed(1) + '" y="' + pt + '" width="' + bw.toFixed(1) + '" height="' + ph + '" fill="transparent"/>';
    });
    return '<svg class="vsvg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + (mode === 'quarter' ? '분기' : '연간') + ' 매출액 · 영업이익 · 당기순이익 추이">' + g + '</svg>';
  }
  function yoyCell(cur, prev){
    if (!fin(cur) || !fin(prev) || prev === 0) return '';
    if (prev < 0 && cur > 0) return '<em class="up">흑전</em>';
    if (prev > 0 && cur < 0) return '<em class="down">적전</em>';
    if (prev < 0) return '';
    const v = (cur - prev) / prev * 100;
    return '<em class="' + cls(v) + '">' + gpct(v) + '</em>';
  }
  function perfTable(f, mode){
    const d = perfData(f, mode);
    if (!d) return '';
    const Fm = function (v) { return F.money(v, f.cur); };
    const step = mode === 'quarter' ? 4 : 1;
    const row = function (k, name, fmt, withYoy) {
      return '<tr><th>' + name + '</th>' + d[k].map(function (v, i) {
        return '<td class="num' + (d.e[i] ? ' est' : '') + '">' + fmt(v) + (withYoy && i >= step ? yoyCell(v, d[k][i - step]) : '') + '</td>';
      }).join('') + '</tr>';
    };
    return '<div class="ptable-wrap"><table class="ptable"><thead><tr><th></th>' + d.lab.map(function (l, i) { return '<th class="' + (d.e[i] ? 'est' : '') + '">' + l + '</th>'; }).join('') + '</tr></thead><tbody>' +
      row('rev', '매출액', Fm, true) + row('op', '영업이익', Fm, true) + row('ni', '순이익', Fm, false) +
      row('opm', '영업이익률', function (v) { return fin(v) ? v.toFixed(1) + '%' : '—'; }, false) +
      '</tbody></table></div><p class="ptable-note">' + (mode === 'quarter' ? '증감은 전년 동기 대비' : '증감은 전년 대비') + ' · E는 증권사 컨센서스 추정치 · 단위 ' + (f.cur === 'USD' ? '달러(B=10억 · M=백만)' : '원') + '</p>';
  }
  function perfCard(st, fa){
    const f = fa.f, g = fa.g, hasQ = !!(f.quarter && f.quarter.p && f.quarter.p.length);
    if (!hasQ) view.perf = 'annual';
    const notes = [];
    if (fin(g.revCagr)) notes.push('매출 연평균 ' + pct1(g.revCagr));
    if (fin(g.opCagr)) notes.push('영업이익 연평균 ' + pct1(g.opCagr));
    if (g.opmRising) notes.push('<b class="good">영업이익률 3년 연속 상승</b>');
    else if (g.opmFalling) notes.push('<b class="bad">영업이익률 3년 연속 하락</b>');
    if (g.q && g.q.opYoY) notes.push(g.q.label + ' 영업이익 YoY ' + g.q.opYoY.text);
    return '<div class="card-hd"><i data-lucide="chart-column"></i><h2>실적 추이</h2>' +
        '<div class="seg mini" id="v-perf-seg" role="group" aria-label="기간">' +
          '<button data-m="annual"' + (view.perf === 'annual' ? ' class="on"' : '') + '>연간</button>' +
          (hasQ ? '<button data-m="quarter"' + (view.perf === 'quarter' ? ' class="on"' : '') + '>분기</button>' : '') + '</div></div>' +
      '<div class="vlegend">' + SER.map(function (s) { return '<span><i class="' + s.kind + '" style="background:' + s.color + '"></i>' + s.name + '</span>'; }).join('') + '</div>' +
      '<div class="vchart" id="v-perf-chart" data-kind="perf"></div>' +
      (notes.length ? '<div class="vnotes">' + notes.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' : '') +
      '<div id="v-perf-table"></div>';
  }

  /* ---------------- ④ 재무 건전성 ---------------- */
  function healthCard(st, fa){
    const h = fa.h;
    if (h.score == null) return '<div class="card-hd"><i data-lucide="shield-check"></i><h2>재무 건전성</h2></div><div class="empty">' +
      (h.financial ? '금융업은 예금 · 보험부채가 영업 자산이라 부채비율 · 이자보상배율로 건전성을 평가하지 않습니다.' + (fin(h.debt) ? '<br>참고: 부채비율 ' + Math.round(h.debt) + '%' : '')
        : '건전성 지표가 없습니다.') + '</div>';
    const T = h.trend || {};
    const trendRow = function (key, name, fmt) {
      const arr = T[key]; if (!arr || !arr.some(fin)) return '';
      return '<tr><th>' + name + '</th>' + arr.map(function (v) { return '<td class="num">' + (fin(v) ? fmt(v) : '—') + '</td>'; }).join('') + '</tr>';
    };
    return '<div class="card-hd"><i data-lucide="shield-check"></i><h2>재무 건전성</h2><span class="sub">안정성 진단' + ctx.tip('health') + '</span></div>' +
      '<div class="hl">' +
        '<div class="hl-top"><div class="hl-score"><b class="num">' + h.score + '</b><span>/ 100</span></div><span class="hl-grade ' + h.tone + '">' + h.grade + '</span>' +
          (h.financial ? '<small class="muted">금융업 — 부채비율 · 이자보상배율 제외</small>' : '') + '</div>' +
        '<div class="meter ' + h.tone + '"><i style="width:' + h.score + '%"></i></div>' +
        '<div class="hl-items">' + h.items.map(function (x) {
          return '<div class="hi ' + (x.good == null ? 'na' : x.good ? 'ok' : 'ng') + '"><span class="hi-ic"><i data-lucide="' + (x.good == null ? 'minus' : x.good ? 'check' : 'alert-triangle') + '"></i></span>' +
            '<div><b>' + x.name + ctx.tip(x.key === 'icr' ? 'icr' : x.key === 'reserve' ? 'reserve' : x.key === 'debt' ? 'debt' : '') + '<em class="num">' + x.fmt + '</em></b><small>' + x.note + '</small></div></div>';
        }).join('') + '</div>' +
        (T.p && T.p.length ? '<div class="ptable-wrap"><table class="ptable sm"><thead><tr><th></th>' + T.p.map(function (p) { return '<th>' + p + '</th>'; }).join('') + '</tr></thead><tbody>' +
          trendRow('debt', '부채비율', function (v) { return Math.round(v) + '%'; }) +
          trendRow('icr', '이자보상', function (v) { return (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) + '배'; }) +
          trendRow('reserve', '유보율', function (v) { return v >= 10000 ? (v / 1000).toFixed(0) + '천%' : Math.round(v).toLocaleString('ko-KR') + '%'; }) +
          '</tbody></table></div>' : '') +
      '</div>';
  }

  /* ---------------- ⑤ 적정주가 · 본질가치 ---------------- */
  function fairCard(st, fa){
    const fv = fa.fv, v = fa.v, cur = st.cur;
    const ok = fv.methods.filter(function (m) { return !m.skip; });
    const pts = [v.price];
    ok.forEach(function (m) { pts.push(m.lo, m.hi); });
    if (fv.consensus) pts.push(fv.consensus.v);
    const lo = Math.min.apply(null, pts.filter(fin)) * 0.92, hi = Math.max.apply(null, pts.filter(fin)) * 1.05;
    const X = function (x) { return Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)).toFixed(1); };
    const row = function (name, m, extra) {
      return '<div class="ff-r"><span class="ff-n">' + name + '</span><span class="ff-t">' +
        (m ? '<i class="rng" style="left:' + X(m.lo) + '%;width:' + Math.max(1.5, X(m.hi) - X(m.lo)) + '%"></i><i class="dot" style="left:' + X(m.base) + '%"></i>' : '') +
        (extra || '') + '</span>' +
        '<b class="num">' + (m ? price(m.base, cur) : '—') + '</b><em class="num ' + cls(m ? m.base - v.price : 0) + '">' + (m ? pct1((m.base / v.price - 1) * 100) : '') + '</em></div>';
    };
    const nowLine = '<i class="now" style="left:' + X(v.price) + '%"></i>';
    const fair = fin(fv.value) ? '<i class="fair" style="left:' + X(fv.value) + '%"></i>' : '';
    const verdict = !fin(fv.upside) ? null : fv.upside >= 30 ? ['good', '저평가'] : fv.upside >= 10 ? ['good', '다소 저평가'] : fv.upside > -10 ? ['neut', '적정'] : fv.upside > -30 ? ['warn', '다소 고평가'] : ['bad', '고평가'];
    return '<div class="card-hd"><i data-lucide="gem"></i><h2>적정주가 · 본질가치</h2><span class="sub">PER·PBR 밴드 · S-RIM · DCF' + ctx.tip('fair') + '</span></div>' +
      '<div class="fv">' +
        (fin(fv.value)
          ? '<div class="fv-hero"><div><span>종합 적정주가 <em class="conf" data-c="' + fv.confidence + '" title="적용된 방법 ' + fv.used.length + '개 · 방법 간 최대/최소 ' + fv.spread.toFixed(1) + '배">신뢰도 ' + fv.confidence + '</em></span>' +
              '<b class="num">' + price(fv.value, cur) + '</b><small>범위 ' + price(fv.lo, cur) + ' ~ ' + price(fv.hi, cur) + '</small></div>' +
              '<div class="fv-up"><span>현재가 대비</span><b class="num ' + cls(fv.upside) + '">' + pct1(fv.upside) + '</b>' + (verdict ? '<span class="vchip2 ' + verdict[0] + '">' + verdict[1] + '</span>' : '') + '</div></div>'
          : '<div class="empty">적용 가능한 가치평가 방법이 없습니다.</div>') +
        '<div class="ff">' +
          '<div class="ff-leg"><span><i class="k-rng"></i>방법별 범위</span><span><i class="k-dot"></i>기본값</span><span><i class="k-now"></i>현재가</span>' + (fair ? '<span><i class="k-fair"></i>종합</span>' : '') + '</div>' +
          fv.methods.map(function (m) { return m.skip ? '' : row(m.name, m, nowLine + fair); }).join('') +
          (fv.consensus ? '<div class="ff-r ref"><span class="ff-n">컨센서스<small>참고용</small></span><span class="ff-t">' + nowLine + fair + '<i class="dot cons" style="left:' + X(fv.consensus.v) + '%"></i></span>' +
            '<b class="num">' + price(fv.consensus.v, cur) + '</b><em class="num ' + cls(fv.consensus.upside) + '">' + pct1(fv.consensus.upside) + '</em></div>' : '') +
        '</div>' +
        '<div class="fv-meth">' + fv.methods.map(function (m) {
          return '<div class="fm' + (m.skip ? ' skip' : '') + '"><b>' + m.name + (m.skip ? ' <em>제외</em>' : ' <em>가중 ' + Math.round(m.w * 100) + '%</em>') + '</b><p>' + (m.skip || m.detail) + '</p></div>';
        }).join('') + '</div>' +
        '<div class="fv-band"><div class="fv-band-hd"><b>밸류에이션 밴드</b><small>과거 배수 × 최근 4분기 EPS · BPS</small><div class="seg mini" id="v-band-seg" role="group" aria-label="밴드 종류">' +
          '<button data-b="per"' + (view.band === 'per' ? ' class="on"' : '') + '>PER</button><button data-b="pbr"' + (view.band === 'pbr' ? ' class="on"' : '') + '>PBR</button></div></div>' +
          '<div class="vlegend" id="v-band-leg"></div><div class="vchart" id="v-band-chart" data-kind="band"></div></div>' +
        '<p class="fv-assume">요구수익률(Ke) ' + fv.ke.ke.toFixed(1) + '% = ' + fv.ke.a.label.replace('β', 'β ' + fv.ke.beta.toFixed(2) + (fv.ke.betaReal ? '' : '(가정)')) +
          ' · 영구성장률 ' + fv.ke.a.gT.toFixed(1) + '% · 가중치 PER 35 · S-RIM 30 · PBR 20 · DCF 15 (적용 가능한 방법만 재배분)</p>' +
      '</div>';
  }

  /* 밴드 기준값 시계열 — 결산 · 분기 말 시점의 최근 4분기(Trailing) EPS 또는 BPS 를 이어 붙이고 사이는 선형 보간.
     (연도별 EPS 를 계단식으로 쓰면 결산이 바뀌는 날 밴드가 급변해 읽기 어렵다) */
  function periodEnd(y, m){ return new Date(y, m, 0, 15, 30).getTime(); }     // m월 말일
  function trailingPoints(f, kind){
    const H = f.hist || {}, A = f.annual || {}, Q = f.quarter || {}, key = kind === 'per' ? 'eps' : 'bps', pts = {};
    const fye = f.fye || 12;
    const yEnd = function (y) { return periodEnd(+y, fye); };
    (H.p || []).forEach(function (p, i) { if (H[key] && fin(H[key][i])) pts[yEnd(p)] = H[key][i]; });
    (A.p || []).forEach(function (p, i) { if (!(A.e || [])[i] && A[key] && fin(A[key][i])) pts[yEnd(p)] = A[key][i]; });
    if (Q.p && Q[key]){
      const qi = [];
      Q.p.forEach(function (p, i) { if (!(Q.e || [])[i]) qi.push(i); });
      qi.forEach(function (i, k) {
        const m = /^(\d{4})\.(\d{2})/.exec(Q.p[i]); if (!m) return;
        if (key === 'bps'){ if (fin(Q.bps[i])) pts[periodEnd(+m[1], +m[2])] = Q.bps[i]; return; }
        if (k < 3) return;
        const four = [qi[k - 3], qi[k - 2], qi[k - 1], i].map(function (j) { return Q.eps[j]; });
        if (four.every(fin)) pts[periodEnd(+m[1], +m[2])] = four.reduce(function (s, v) { return s + v; }, 0);
      });
    }
    /* 미국: 최근 분기 말 기준 TTM EPS · BPS */
    if (f.cur === 'USD' && f.ttm && Q.p && Q.p.length){
      const m = /^(\d{4})\.(\d{2})/.exec(Q.p[Q.p.length - 1]);
      const v = key === 'eps' ? f.ttm.eps : f.ttm.bps;
      if (m && fin(v)) pts[periodEnd(+m[1], +m[2])] = v;
    }
    return Object.keys(pts).map(Number).sort(function (a, b) { return a - b; }).map(function (t) { return { t:t, v:pts[t] }; });
  }
  function interp(pts, t){
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++){
      if (t <= pts[i].t){ const a = pts[i - 1], b = pts[i]; return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t); }
    }
    return pts[pts.length - 1].v;
  }

  /* 밴드 차트 — 실제 일봉 × 과거 PER/PBR 분위 배수 × Trailing EPS/BPS */
  function bandSvg(code, fa, kind, w){
    const f = fa.f;
    const mult = (fa.fv.methods.filter(function (m) { return m.key === kind; })[0] || {}).mult;
    if (!M.isReal(code)) return { svg:'<div class="empty">실제 일봉이 없는 종목이라 밴드 차트를 그리지 않습니다.</div>' };
    if (!mult) return { svg:'<div class="empty">과거 ' + kind.toUpperCase() + ' 이력이 부족해 밴드를 만들 수 없습니다.</div>' };
    const pts = trailingPoints(f, kind);
    if (pts.length < 2) return { svg:'<div class="empty">밴드 기준값이 부족합니다.</div>' };
    const valAt = function (t) { return interp(pts, t); };
    const bars = M.daily(code).slice(-500);
    const h = 200, pl = 8, pr = 64, pt = 10, pb = 22, pw = w - pl - pr, ph = h - pt - pb;
    const lines = [['lo', '#9DBEF7'], ['mid', '#3182F6'], ['hi', '#1B4FB0']];
    const rows = bars.map(function (b) { const e = valAt(b.t); return { t:b.t, c:b.c, e:e }; });
    let min = Infinity, max = -Infinity;
    rows.forEach(function (r) {
      [r.c, r.e * mult.lo, r.e * mult.hi].forEach(function (x) { if (fin(x) && x > 0){ if (x < min) min = x; if (x > max) max = x; } });
    });
    min *= 0.95; max *= 1.03;
    const X = function (i) { return pl + i / (rows.length - 1) * pw; };
    const Y = function (v) { return pt + (max - v) / (max - min) * ph; };
    let g = '';
    niceTicks(min, max, 4).forEach(function (t) {
      if (t < min || t > max) return;
      g += '<line x1="' + pl + '" x2="' + (w - pr) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="#F3F4F6"/>';
    });
    const labelY = [];
    lines.forEach(function (l) {
      const m = mult[l[0]];
      let d = '', pen = false;
      rows.forEach(function (r, i) {
        const v = r.e * m;
        if (!(v > 0)){ pen = false; return; }                // 적자 구간은 선을 끊는다
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(Math.max(min, Math.min(max, v))).toFixed(1);
        pen = true;
      });
      g += '<path d="' + d + '" fill="none" stroke="' + l[1] + '" stroke-width="1.5" stroke-linejoin="round"/>';
      const lv = rows[rows.length - 1].e * m;
      if (lv > 0) labelY.push({ y:Y(Math.max(min, Math.min(max, lv))), text:(l[0] === 'lo' ? '하단 ' : l[0] === 'mid' ? '중앙 ' : '상단 ') + m.toFixed(kind === 'per' ? 1 : 2) + '배' });
    });
    /* 오른쪽 라벨이 겹치면 아래로 12px 씩 밀고, 선 끝과는 가는 연결선으로 잇는다 */
    labelY.sort(function (a, b) { return a.y - b.y; });
    let prevY = -Infinity;
    labelY.forEach(function (lb) {
      lb.ty = Math.max(lb.y, prevY + 12); prevY = lb.ty;
      if (lb.ty !== lb.y) g += '<line x1="' + (w - pr + 1) + '" y1="' + lb.y.toFixed(1) + '" x2="' + (w - pr + 5) + '" y2="' + lb.ty.toFixed(1) + '" stroke="#D1D6DB"/>';
      g += '<text x="' + (w - pr + 6) + '" y="' + (lb.ty + 3.5).toFixed(1) + '" class="ax lbl">' + lb.text + '</text>';
    });
    g += '<path d="' + rows.map(function (r, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(r.c).toFixed(1); }).join('') + '" fill="none" stroke="#191F28" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    const lr = rows[rows.length - 1];
    g += '<circle cx="' + X(rows.length - 1).toFixed(1) + '" cy="' + Y(lr.c).toFixed(1) + '" r="4" fill="#191F28" stroke="#fff" stroke-width="2"/>';
    /* 연도 눈금 */
    let lastY = null;
    rows.forEach(function (r, i) {
      const yy = new Date(r.t).getFullYear();
      if (lastY != null && yy !== lastY){
        g += '<line x1="' + X(i).toFixed(1) + '" x2="' + X(i).toFixed(1) + '" y1="' + pt + '" y2="' + (h - pb) + '" stroke="#F3F4F6"/>' +
          '<text x="' + X(i).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle" class="ax">' + yy + '</text>';
      }
      lastY = yy;
    });
    g += '<line class="xh" x1="0" x2="0" y1="' + pt + '" y2="' + (h - pb) + '" stroke="#B0B8C1" stroke-width="1" visibility="hidden"/>' +
      '<rect class="hitall" x="' + pl + '" y="' + pt + '" width="' + pw + '" height="' + ph + '" fill="transparent"/>';
    return { svg:'<svg class="vsvg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + kind.toUpperCase() + ' 밴드 차트">' + g + '</svg>',
             rows:rows, X:X, pl:pl, pw:pw, mult:mult, lines:lines };
  }

  /* ---------------- ⑥ 가치 체크리스트 ---------------- */
  function checksCard(fa){
    const ok = fa.checks.filter(function (c) { return c[0]; }).length;
    return '<div class="card-hd"><i data-lucide="list-checks"></i><h2>가치 체크리스트</h2><span class="sub">' + ok + ' / ' + fa.checks.length + ' 충족</span></div>' +
      '<div class="vchecks">' + fa.checks.map(function (c) {
        return '<div class="ck ' + (c[0] ? 'on' : 'off') + '"><i data-lucide="' + (c[0] ? 'check' : 'x') + '"></i><span>' + c[1] + '</span></div>';
      }).join('') + '</div>';
  }

  /* ---------------- 차트 그리기 · 툴팁 ---------------- */
  let band = null;
  function widthOf(el){ return Math.max(260, Math.floor((el && el.clientWidth) || 320)); }
  function paintPerf(fa){
    const box = $('#v-perf-chart'); if (!box) return;
    box.innerHTML = perfSvg(fa.f, view.perf, widthOf(box)) + '<div class="vtip" hidden></div>';
    $('#v-perf-table').innerHTML = perfTable(fa.f, view.perf);
  }
  function paintBand(code, fa){
    const box = $('#v-band-chart'); if (!box) return;
    band = bandSvg(code, fa, view.band, widthOf(box));
    box.innerHTML = band.svg + '<div class="vtip" hidden></div>';
    $('#v-band-leg').innerHTML = band.rows ? '<span><i class="line" style="background:#191F28"></i>주가</span>' +
      band.lines.map(function (l) { return '<span><i class="line" style="background:' + l[1] + '"></i>' + (l[0] === 'lo' ? '하단(20%)' : l[0] === 'mid' ? '중앙값' : '상단(80%)') + '</span>'; }).join('') : '';
  }
  function showTip(box, html, x){
    const tipEl = box.querySelector('.vtip'); if (!tipEl) return;
    tipEl.innerHTML = html; tipEl.hidden = false;
    const w = tipEl.offsetWidth, bw = box.clientWidth;
    tipEl.style.left = Math.max(0, Math.min(bw - w, x - w / 2)) + 'px';
  }
  function hideTip(box){
    const t = box && box.querySelector('.vtip'); if (t) t.hidden = true;
    const xh = box && box.querySelector('.xh'); if (xh) xh.setAttribute('visibility', 'hidden');
  }
  function onChartMove(e){
    const box = e.target.closest('.vchart'); if (!box || !view.fa) return;
    const fa = view.fa, cur = fa.f.cur;
    const pt = e.touches ? e.touches[0] : e;
    const svg = box.querySelector('svg'); if (!svg) return;
    const r = svg.getBoundingClientRect(), sx = (pt.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
    if (box.dataset.kind === 'perf'){
      const hit = e.target.closest('.hit');
      if (!hit){ hideTip(box); return; }
      const i = +hit.dataset.i, d = perfData(fa.f, view.perf), step = view.perf === 'quarter' ? 4 : 1;
      const yo = function (k) {
        const a = d[k][i], b = d[k][i - step];
        if (!fin(a) || !fin(b) || b === 0) return '';
        if (b < 0 && a > 0) return ' <em>흑자전환</em>';
        if (b > 0 && a < 0) return ' <em>적자전환</em>';
        return b > 0 ? ' <em>' + gpct((a - b) / b * 100) + '</em>' : '';
      };
      showTip(box, '<b>' + d.lab[i] + (d.e[i] ? ' (추정)' : '') + '</b>' + SER.map(function (s) {
        return '<div><i style="background:' + s.color + '"></i>' + s.name + '<span>' + F.money(d[s.k][i], cur) + yo(s.k) + '</span></div>';
      }).join('') + (fin(d.opm[i]) ? '<div class="sub">영업이익률 ' + d.opm[i].toFixed(1) + '%</div>' : ''), sx);
    } else if (band && band.rows){
      const n = band.rows.length, i = Math.max(0, Math.min(n - 1, Math.round((sx - band.pl) / band.pw * (n - 1))));
      const row = band.rows[i], dt = new Date(row.t);
      const xh = box.querySelector('.xh');
      if (xh){ xh.setAttribute('x1', band.X(i)); xh.setAttribute('x2', band.X(i)); xh.setAttribute('visibility', 'visible'); }
      const m = row.e > 0 ? row.c / row.e : null;
      showTip(box, '<b>' + dt.getFullYear() + '.' + (dt.getMonth() + 1) + '.' + dt.getDate() + '</b>' +
        '<div><i style="background:#191F28"></i>주가<span>' + price(row.c, cur) + '</span></div>' +
        '<div><i style="background:#3182F6"></i>' + (view.band === 'per' ? 'PER' : 'PBR') + '<span>' + (m ? m.toFixed(view.band === 'per' ? 1 : 2) + '배' : '—') + '</span></div>' +
        '<div class="sub">기준 ' + (view.band === 'per' ? 'EPS ' : 'BPS ') + price(row.e, cur) + '</div>', sx);
    }
  }

  /* ---------------- 렌더 ---------------- */
  function emptyPanel(st, a, t){
    return '<section class="card sg-card">' + signalCard(st, a, null, t) + '</section>' +
      '<section class="card"><div class="empty v-empty"><i data-lucide="file-question"></i><b>재무 데이터가 없는 종목입니다</b>' +
        (st.type === 'etf' ? 'ETF는 개별 기업 재무제표가 없어 가치분석을 하지 않습니다. 위 점수는 기술적 분석만 반영합니다.'
          : '재무 데이터는 시가총액 상위 · 대표 종목 위주로 수집됩니다(<code>tools/build_fundamentals.py</code>).<br>종목 코드를 인자로 넘기면 이 종목도 수집할 수 있습니다.') +
        '</div></section>';
  }
  function techOf(code, a){
    if (!a || !a.daily || !M.isReal(code)) return null;
    if (a.quality && a.quality.level === 'low') return null;       // 거래정지 · 봉 부족 — 스크리너(signal.js)와 같은 기준
    return S.tech(M.daily(code), a.daily.ind);
  }
  function render(force){
    const el = $('#panel-value'), st = view.st, a = view.a;
    if (!el || !st) return;
    const snap = M.lightQuote(st.code), p = snap && snap.price;
    const t = techOf(st.code, a);
    const fa = F && p ? F.analyze(st.code, p) : null;
    view.fa = fa;
    const full = force || view.code !== st.code || !$('#v-sg');
    if (!fa){ el.innerHTML = emptyPanel(st, a, t); view.code = st.code; icons(); return; }
    const c = S.combine(t, fa);
    if (full){
      el.innerHTML =
        '<section class="card sg-card" id="v-sg"></section>' +
        '<section class="card vsum-card" id="v-sum"></section>' +
        '<section class="card vval-card" id="v-val"></section>' +
        '<section class="card vperf-card" id="v-perf">' + perfCard(st, fa) + '</section>' +
        '<section class="card" id="v-health">' + healthCard(st, fa) + '</section>' +
        '<section class="card vfair-card" id="v-fair"></section>' +
        '<section class="card" id="v-checks"></section>' +
        '<div class="note" id="v-note"></div>';
    }
    $('#v-sg').innerHTML = signalCard(st, a, fa, t);
    $('#v-sum').innerHTML = summaryCard(st, fa, t, c);
    $('#v-val').innerHTML = valuationCard(st, fa);
    $('#v-fair').innerHTML = fairCard(st, fa);
    $('#v-checks').innerHTML = checksCard(fa);
    $('#v-note').innerHTML = '재무 출처: ' + (st.cur === 'USD' ? 'nasdaq.com (연간 4개년 · 최근 4분기, 업종 비교는 수집 종목 중앙값)' : '네이버 금융 · WiseReport (WICS 업종 PER, 연간 3개년 + 추정, 최근 5분기)') +
      ' · 수집 ' + String(fa.asOf || '').slice(0, 10) + '. 주가에 연동되는 지표는 현재가로 다시 계산합니다. 투자 판단의 책임은 이용자에게 있습니다.';
    if (full) paintPerf(fa);
    paintBand(st.code, fa);
    view.code = st.code;
    view.lastFull = Date.now();
    icons();
  }

  /** app.js 에서 분석이 갱신될 때마다 호출 — 탭이 보일 때만 그린다 (실시간 틱은 3초에 한 번) */
  function update(st, a, opts){
    view.st = st; view.a = a;
    renderStrip(st, a);
    if (!view.visible) return;
    const force = opts && opts.force;
    if (!force && view.code === st.code && Date.now() - view.lastFull < 3000) return;
    render(force);
  }
  function setVisible(on){
    view.visible = on;
    if (on && view.st) render(true);
  }

  /* AI 분석 탭 게이지 카드 아래 — 종합 신호 한 줄 요약 (누르면 가치분석 탭) */
  function renderStrip(st, a){
    const el = $('#combo-strip'); if (!el) return;
    const snap = M.lightQuote(st.code), p = snap && snap.price;
    const t = techOf(st.code, a), fa = F && p ? F.analyze(st.code, p) : null, c = S.combine(t, fa);
    const g = c.total != null ? c.grade : c.techGrade || c.fundGrade;
    el.hidden = !g;
    if (!g) return;
    el.innerHTML = '<span class="cs-l">종합 매수 신호</span>' + badge(g, c.total != null ? c.total : c.tech != null ? c.tech : c.fund, true) +
      '<span class="cs-d">' + (c.total != null ? '기술 ' + c.tech + ' · 재무 ' + c.fund : c.tech != null ? '기술만 · 재무 데이터 없음' : M.isReal(st.code) ? '재무만 · 기술 분석 신뢰도 낮음' : '재무만 · 실제 일봉 없음') + '</span><i data-lucide="chevron-right"></i>';
  }

  function init(c){
    ctx = Object.assign(ctx, c || {});
    const el = $('#panel-value');
    if (!el) return;
    el.addEventListener('click', function (e) {
      const pb = e.target.closest('#v-perf-seg button');
      if (pb){ view.perf = pb.dataset.m; el.querySelectorAll('#v-perf-seg button').forEach(function (b) { b.classList.toggle('on', b === pb); }); if (view.fa) paintPerf(view.fa); return; }
      const bb = e.target.closest('#v-band-seg button');
      if (bb){ view.band = bb.dataset.b; el.querySelectorAll('#v-band-seg button').forEach(function (b) { b.classList.toggle('on', b === bb); }); if (view.fa) paintBand(view.st.code, view.fa); }
    });
    el.addEventListener('mousemove', onChartMove);
    el.addEventListener('touchstart', onChartMove, { passive:true });
    el.addEventListener('mouseleave', function () { el.querySelectorAll('.vchart').forEach(hideTip); });
    el.addEventListener('mouseout', function (e) { const b = e.target.closest && e.target.closest('.vchart'); if (b && !b.contains(e.relatedTarget)) hideTip(b); });
    let rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (view.visible && view.fa){ paintPerf(view.fa); paintBand(view.st.code, view.fa); } }, 150);
    });
    if (F) F.onLoad(function () { if (view.st) update(view.st, view.a, { force:true }); });
  }

  QT.Value = { init:init, update:update, setVisible:setVisible, badge:badge, tagChips:tagChips };
})(window.QT);

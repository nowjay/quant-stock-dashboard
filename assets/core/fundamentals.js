/* =============================================================
   fundamentals.js — 재무 · 가치분석 (assets/data/fundamentals.json)

   수집값(연간 · 분기 실적, 5개년 투자지표, 현금흐름)에 '현재가'를 넣어
   밸류에이션 · 성장성 · 재무 건전성 · 적정주가 · 펀더멘털 점수를 계산합니다.
     · 금액 단위: 국내 억원 · 미국 백만 달러 (주당 값은 가격 통화)
     · 주가에 따라 바뀌는 값(PER · PBR · 배당수익률 · EV/EBITDA · 괴리율)은 매번 현재가로 다시 계산
     · 업종 PER: 국내는 WiseReport WICS 업종 PER(1~100배만), 미국 · 그 밖에는 수집 종목 중 같은 업종 → 같은 섹터 중앙값
     · 업종 PBR: 수집 종목 중 같은 업종(자기 제외 2종목↑) → 같은 시장 업종 · 섹터(3종목↑) 중앙값, 없으면 절대 수준으로 평가
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  const DB = {}, META = { updated:null, count:0 };
  const listeners = [];

  function fin(v){ return v != null && isFinite(v); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function last(arr, pred){
    if (!arr) return null;
    for (let i = arr.length - 1; i >= 0; i--) if (fin(arr[i]) && (!pred || pred(i))) return arr[i];
    return null;
  }
  function median(xs){
    const a = xs.filter(fin).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function quantile(xs, q){
    const a = xs.filter(fin).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }

  /* ---------------- 할인율 가정 ---------------- */
  const ASSUME = {
    KRW:{ rf:3.0, erp:5.5, gT:2.0, label:'국고채 3.0% + β × 위험프리미엄 5.5%' },
    USD:{ rf:4.2, erp:5.0, gT:2.5, label:'미 국채 4.2% + β × 위험프리미엄 5.0%' }
  };
  const W = { per:0.35, pbr:0.20, rim:0.30, dcf:0.15 };        // 적정주가 가중치 (적용 가능한 방법만 재정규화)

  function isFinancial(f){
    return /은행|증권|보험|금융|카드|캐피탈/.test(f.ind || '') || /Finance/i.test(f.sector || '') ||
      /Bank|Insur|Capital Markets|Brokerage|Credit/i.test(f.ind || '');
  }

  /* ---------------- 로딩 ---------------- */
  function load(json){
    if (!json || !json.items) return;
    Object.keys(json.items).forEach(function (k) { DB[k] = json.items[k]; });
    META.updated = json.updated;
    META.count = Object.keys(DB).length;
    peerCache = {};
    listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
  }
  function has(code){ return !!DB[code]; }
  function raw(code){ return DB[code] || null; }
  function onLoad(fn){ listeners.push(fn); }

  /* ---------------- 주당 값 ---------------- */
  function unitMul(f){ return f.cur === 'USD' ? 1e6 : 1e8; }
  function actualIdx(block){ const out = []; if (!block) return out; (block.p || []).forEach(function (_, i) { if (!(block.e || [])[i]) out.push(i); }); return out; }
  function lastActual(block, key){
    if (!block || !block[key]) return null;
    const idx = actualIdx(block);
    for (let j = idx.length - 1; j >= 0; j--) if (fin(block[key][idx[j]])) return block[key][idx[j]];
    return null;
  }
  function perShare(f){
    const A = f.annual || {}, T = f.ttm || {};
    const epsTTM = fin(T.eps) ? T.eps : lastActual(A, 'eps');
    const bps = fin(T.bps) ? T.bps : lastActual(A, 'bps');
    let epsFwd = null, fwdLabel = null;
    if (f.cur === 'USD'){
      if (f.fwd && fin(f.fwd.eps)){ epsFwd = f.fwd.eps; fwdLabel = 'FY ' + (f.fwd.fy || '') + ' 컨센서스'; }
    } else {
      const ei = (A.e || []).indexOf(1);
      if (f.cons && fin(f.cons.eps) && (f.cons.n || 0) >= 3){ epsFwd = f.cons.eps; fwdLabel = (A.p && ei >= 0 ? A.p[ei] : '') + 'E 컨센서스 (' + f.cons.n + '곳)'; }
      else if (ei >= 0 && fin(A.eps[ei])){ epsFwd = A.eps[ei]; fwdLabel = A.p[ei] + 'E 컨센서스'; }
    }
    let dps = null;
    if (f.cur === 'USD') dps = f.div && fin(f.div.dps) ? f.div.dps : null;
    else dps = last((f.hist || {}).dps) != null ? last(f.hist.dps) : lastActual(A, 'dps');
    return { epsTTM:epsTTM, bps:bps, epsFwd:epsFwd, fwdLabel:fwdLabel, dps:dps };
  }
  function roeTTM(f, ps){
    if (fin(ps.epsTTM) && fin(ps.bps) && ps.bps > 0) return ps.epsTTM / ps.bps * 100;
    return lastActual(f.annual, 'roe');
  }

  /* ---------------- 업종 비교 (수집 종목 중앙값) ---------------- */
  let peerCache = {};
  function quoteOf(code){
    const q = QT.Market && QT.Market.lightQuote(code);
    return q && fin(q.price) && q.price > 0 ? q.price : null;
  }
  function peerStats(code){
    const f = DB[code];
    if (!f) return null;
    const now = Date.now(), c = peerCache[code];
    if (c && now - c.at < 60000) return c.v;
    /* 업종이 다른 종목까지 섞은 시장 전체 중앙값은 은행 · 보험처럼 배수가 구조적으로 낮은 업종을 왜곡하므로 쓰지 않는다 */
    const groups = f.cur === 'KRW'
      ? [['ind', f.ind, '같은 업종(' + (f.ind || '') + ')'], ['mktInd', f.mktInd, '같은 업종(' + (f.mktInd || '') + ')']]
      : [['ind', f.ind, '같은 업종(' + (f.ind || '') + ')'], ['sector', f.sector, '같은 섹터(' + (f.sector || '') + ')']];
    function collect(key, val){
      const per = [], pbr = [];
      Object.keys(DB).forEach(function (k) {
        const g = DB[k];
        if (k === code || g.cur !== f.cur || !val || g[key] !== val) return;       // 자기 자신은 비교군에서 뺀다
        const p = quoteOf(k); if (!p) return;
        const ps = perShare(g);
        if (fin(ps.epsTTM) && ps.epsTTM > 0){ const x = p / ps.epsTTM; if (x < 150) per.push(x); }
        if (fin(ps.bps) && ps.bps > 0){ const y = p / ps.bps; if (y < 60) pbr.push(y); }
      });
      return { per:per, pbr:pbr };
    }
    let perV = null, perN = 0, perBasis = null, pbrV = null, pbrN = 0, pbrBasis = null;
    for (let i = 0; i < groups.length && (perV == null || pbrV == null); i++){
      const g = groups[i], s = collect(g[0], g[1]), need = i === 0 ? 2 : 3;      // 가장 좁은 업종은 2종목부터
      if (perV == null && s.per.length >= need){ perV = median(s.per); perN = s.per.length; perBasis = g[2]; }
      if (pbrV == null && s.pbr.length >= need){ pbrV = median(s.pbr); pbrN = s.pbr.length; pbrBasis = g[2]; }
    }
    const v = { per:perV, perN:perN, perBasis:perBasis, pbr:pbrV, pbrN:pbrN, pbrBasis:pbrBasis };
    peerCache[code] = { at:now, v:v };
    return v;
  }

  /* ---------------- 성장성 ---------------- */
  function yoyOf(cur, prev){
    if (!fin(cur) || !fin(prev)) return null;
    if (prev <= 0 && cur > 0) return { kind:'turn', v:null, text:'흑자전환' };
    if (prev > 0 && cur <= 0) return { kind:'loss', v:null, text:'적자전환' };
    if (prev <= 0 && cur <= 0) return { kind:'deficit', v:null, text:'적자지속' };
    const v = (cur - prev) / prev * 100, a = Math.abs(v);
    return { kind:'num', v:v, text:(v >= 0 ? '+' : '−') + (a >= 100 ? Math.round(a).toLocaleString('ko-KR') : a.toFixed(1)) + '%' };
  }
  function growth(f){
    const A = f.annual || {}, Q = f.quarter, ai = actualIdx(A);
    const out = { years:ai.map(function (i) { return A.p[i]; }) };
    const pick = function (k) { return ai.map(function (i) { return A[k] ? A[k][i] : null; }); };
    const rev = pick('rev'), op = pick('op'), ni = pick('ni'), opm = pick('opm');
    out.rev = rev; out.op = op; out.ni = ni; out.opm = opm;
    const n = rev.length;
    if (n >= 2 && fin(rev[0]) && fin(rev[n - 1]) && rev[0] > 0 && rev[n - 1] > 0) out.revCagr = (Math.pow(rev[n - 1] / rev[0], 1 / (n - 1)) - 1) * 100;
    if (n >= 2 && fin(op[0]) && fin(op[n - 1]) && op[0] > 0 && op[n - 1] > 0) out.opCagr = (Math.pow(op[n - 1] / op[0], 1 / (n - 1)) - 1) * 100;
    const m3 = opm.slice(-3).filter(fin);
    out.opmRising = m3.length === 3 && m3[0] < m3[1] && m3[1] < m3[2];
    out.opmFalling = m3.length === 3 && m3[0] > m3[1] && m3[1] > m3[2];
    out.opmLast3 = m3;
    out.revYoY = n >= 2 ? yoyOf(rev[n - 1], rev[n - 2]) : null;
    out.opYoYAnnual = n >= 2 ? yoyOf(op[n - 1], op[n - 2]) : null;

    /* 최근 분기 영업이익 전년 동기 대비 — 분기 라벨 'YYYY.MM' 에서 1년 전 같은 달을 찾는다 */
    out.q = null;
    if (Q && Q.p){
      const qi = actualIdx(Q);
      if (qi.length){
        const i = qi[qi.length - 1], lab = Q.p[i], m = /^(\d{4})\.(\d{2})/.exec(lab);
        const j = m ? Q.p.indexOf((+m[1] - 1) + '.' + m[2]) : -1;
        out.q = { label:lab, op:Q.op[i], rev:Q.rev[i], ni:Q.ni[i],
                  opYoY: j >= 0 ? yoyOf(Q.op[i], Q.op[j]) : null, revYoY: j >= 0 ? yoyOf(Q.rev[i], Q.rev[j]) : null,
                  opQoQ: qi.length >= 2 ? yoyOf(Q.op[i], Q.op[qi[qi.length - 2]]) : null, prevLabel: j >= 0 ? Q.p[j] : null };
      }
    }
    /* 분기 전년 동기 값이 없으면(미국 — 최근 4분기만 제공) 연간 증감으로 대신한다 */
    out.opYoY = out.q && out.q.opYoY ? out.q.opYoY : out.opYoYAnnual;
    out.opYoYBasis = out.q && out.q.opYoY ? (out.q.label + ' 분기 · 전년 동기 대비') : (out.years.length ? out.years[out.years.length - 1] + ' 연간 · 전년 대비' : '');
    return out;
  }

  /* ---------------- 재무 건전성 ---------------- */
  function health(f){
    const H = f.hist || {}, Q = f.quarter || {}, fi = isFinancial(f);
    let debt, reserve, icr, current;
    if (f.cur === 'USD'){
      const bs = f.bs || {};
      debt = fin(bs.liab) && fin(bs.eq) && bs.eq > 0 ? bs.liab / bs.eq * 100 : last(H.debt);
      icr = f.ttm && fin(f.ttm.icr) ? f.ttm.icr : last(H.icr);
      current = last(H.current);
      reserve = null;
    } else {
      debt = lastActual(Q, 'debt'); if (debt == null) debt = last(H.debt);
      reserve = lastActual(Q, 'reserve'); if (reserve == null) reserve = last(H.reserve);
      icr = last(H.icr);
      current = last(H.current);
    }
    const netCash = f.cur === 'USD' ? (f.bs && fin(f.bs.cash) && fin(f.bs.debt) ? f.bs.cash > f.bs.debt : null)
      : (last(H.netDebt) != null ? last(H.netDebt) < 0 : null);
    const items = [];
    function add(key, name, v, w, pts, fmt, note, good){
      items.push({ key:key, name:name, v:v, w:w, pts:pts, fmt:fmt, note:note, good:good });
    }
    if (fi) add('debt', '부채비율', debt, 0, null, fin(debt) ? Math.round(debt) + '%' : '—', '금융업은 예금·보험부채가 영업 자산이라 점수에서 제외', null);
    else if (fin(debt)){
      const p = debt <= 50 ? 1 : debt <= 100 ? 0.85 : debt <= 150 ? 0.62 : debt <= 200 ? 0.42 : debt <= 300 ? 0.2 : 0.06;
      add('debt', '부채비율', debt, 30, p, Math.round(debt) + '%', debt <= 100 ? '100% 이하 — 안정' : debt <= 200 ? '100~200% — 보통' : '200% 초과 — 부채 부담', p >= 0.62);
    }
    if (fin(icr)){
      const p = icr >= 10 ? 1 : icr >= 5 ? 0.85 : icr >= 3 ? 0.62 : icr >= 1.5 ? 0.35 : icr >= 1 ? 0.18 : 0;
      add('icr', '이자보상배율', icr, fi ? 0 : 30, fi ? null : p, (icr >= 100 ? Math.round(icr) : icr.toFixed(1)) + '배',
        icr >= 3 ? '영업이익으로 이자를 ' + (icr >= 10 ? '넉넉히' : '충분히') + ' 감당' : icr >= 1 ? '이자는 내지만 여유가 적음' : '영업이익으로 이자를 못 냄', p >= 0.62);
    } else if (netCash){
      add('icr', '이자보상배율', null, fi ? 0 : 30, fi ? null : 1, '무차입', '이자비용이 거의 없고 현금이 차입금보다 많음', true);
    }
    if (fin(reserve)){
      const p = reserve >= 1000 ? 1 : reserve >= 500 ? 0.8 : reserve >= 200 ? 0.5 : reserve >= 100 ? 0.3 : 0.1;
      add('reserve', '유보율', reserve, 20, p, Math.round(reserve).toLocaleString('ko-KR') + '%', reserve >= 500 ? '쌓아 둔 이익잉여금이 자본금의 ' + Math.round(reserve / 100) + '배' : '내부 유보가 적은 편', p >= 0.5);
    }
    if (fin(current) && !fi){
      const p = current >= 200 ? 1 : current >= 150 ? 0.8 : current >= 100 ? 0.5 : current >= 80 ? 0.25 : 0.1;
      add('current', '유동비율', current, 20, p, Math.round(current) + '%', current >= 150 ? '1년 안에 갚을 빚보다 유동자산이 넉넉' : current >= 100 ? '단기 지급 능력 보통' : '단기 유동성 주의', p >= 0.5);
    }
    let sw = 0, sp = 0;
    items.forEach(function (x) { if (x.w && x.pts != null){ sw += x.w; sp += x.w * x.pts; } });
    const score = sw ? Math.round(sp / sw * 100) : null;
    const grade = score == null ? null : score >= 80 ? '매우 안정' : score >= 65 ? '안정' : score >= 45 ? '보통' : score >= 30 ? '주의' : '위험';
    const tone = score == null ? 'neut' : score >= 65 ? 'good' : score >= 45 ? 'neut' : 'bad';
    return { score:score, grade:grade, tone:tone, items:items, debt:debt, icr:icr, reserve:reserve, current:current,
             netCash:netCash, financial:fi, trend:{ p:H.p, debt:H.debt, icr:H.icr, reserve:H.reserve } };
  }

  /* ---------------- 적정주가 ---------------- */
  function keOf(f){
    const a = ASSUME[f.cur] || ASSUME.KRW, beta = fin(f.beta) ? clamp(f.beta, 0.5, 2) : 1;
    return { ke:clamp(a.rf + beta * a.erp, 7, 13), beta:beta, betaReal:fin(f.beta), a:a };
  }
  function band(values, lim){
    let xs = (values || []).filter(function (v) { return fin(v) && v > 0 && v < lim; });
    /* 이익 저점 해의 PER 처럼 중앙값의 3배를 넘는 값은 배수가 아니라 분모(이익)가 작아진 것이라 뺀다 */
    const md = median(xs);
    xs = xs.filter(function (v) { return v <= md * 3; });
    if (xs.length < 2) return null;
    return { lo:quantile(xs, 0.2), mid:median(xs), hi:quantile(xs, 0.8), n:xs.length, min:Math.min.apply(null, xs), max:Math.max.apply(null, xs) };
  }
  function fairValue(f, price, ps, roe, g){
    const H = f.hist || {}, A = f.annual || {}, out = { methods:[] }, K = keOf(f), ke = K.ke / 100;
    out.ke = K;

    /* ① PER 밴드 — 최근 5개년 연말 PER 의 20% · 중앙 · 80% 분위 × 기준 EPS */
    const pb = band(H.per, 150);
    if (pb){
      let eps = null, basis = null;
      const t = ps.epsTTM, fw = ps.epsFwd;
      if (fin(fw) && fw > 0 && fin(t) && t > 0){
        const r = fw / t;
        if (r >= 0.6 && r <= 1.8){ eps = fw; basis = '선행 EPS (' + ps.fwdLabel + ')'; }
        else { eps = Math.sqrt(fw * t); basis = '최근 4분기 EPS와 선행 EPS의 기하평균 (이익 ' + (r > 1 ? '급증' : '급감') + ' 예상 구간 완충)'; }
      } else if (fin(t) && t > 0){ eps = t; basis = '최근 4분기 EPS'; }
      /* 최근 4분기가 적자면 과거 배수(대개 이익 저점에서 부풀려진 값)에 추정 이익만 곱하게 되어 쓰지 않는다 */
      if (eps){
        out.methods.push({ key:'per', name:'PER 밴드', w:W.per, lo:pb.lo * eps, base:pb.mid * eps, hi:pb.hi * eps,
          detail:'과거 ' + pb.n + '년 PER ' + pb.lo.toFixed(1) + ' · ' + pb.mid.toFixed(1) + ' · ' + pb.hi.toFixed(1) + '배 × ' + basis,
          mult:pb, eps:eps });
      } else {
        out.methods.push({ key:'per', name:'PER 밴드', skip:'최근 4분기 이익이 적자라 PER 밴드를 쓰지 않았습니다.', mult:pb });
      }
    }
    /* ② PBR 밴드 */
    const bb = band(H.pbr, 60);
    if (bb && fin(ps.bps) && ps.bps > 0){
      out.methods.push({ key:'pbr', name:'PBR 밴드', w:W.pbr, lo:bb.lo * ps.bps, base:bb.mid * ps.bps, hi:bb.hi * ps.bps,
        detail:'과거 ' + bb.n + '년 PBR ' + bb.lo.toFixed(2) + ' · ' + bb.mid.toFixed(2) + ' · ' + bb.hi.toFixed(2) + '배 × BPS', mult:bb });
    }
    /* ③ S-RIM (잔여이익모델) — 자기자본 + 초과이익(ROE − Ke) 이 ω 비율로 지속된다고 가정 */
    const roeA = actualIdx(A).map(function (i) { return A.roe ? A.roe[i] : null; }).filter(fin).slice(-3);
    const cands = [];
    if (roeA.length){
      const ws = roeA.map(function (_, i) { return i + 1; });
      cands.push(roeA.reduce(function (s, v, i) { return s + v * ws[i]; }, 0) / ws.reduce(function (s, v) { return s + v; }, 0));
    }
    if (fin(roe)) cands.push(roe);
    if (fin(ps.epsFwd) && fin(ps.bps) && ps.bps > 0) cands.push(ps.epsFwd / ps.bps * 100);
    const roeExp = cands.length ? cands.reduce(function (s, v) { return s + v; }, 0) / cands.length : null;
    if (fin(roeExp) && fin(ps.bps) && ps.bps > 0){
      const pbr = price / ps.bps;
      const rim = function (w) { return ps.bps * (1 + (roeExp / 100 - ke) * w / (1 + ke - w)); };
      const m = { key:'rim', name:'S-RIM', w:W.rim, lo:Math.min(rim(0.8), rim(1)), base:rim(0.9), hi:Math.max(rim(0.8), rim(1)),
        detail:'BPS × [1 + (기대 ROE ' + roeExp.toFixed(1) + '% − 요구수익률 ' + K.ke.toFixed(1) + '%) × ω / (1 + Ke − ω)], ω = 0.8 · 0.9 · 1.0',
        roe:roeExp };
      /* 적용 여부는 현재가와 무관한 기준(기대 ROE)만으로 정한다 — 시세에 따라 방법이 들락날락하지 않도록 */
      if (roeExp > 35) m.skip = '자기자본 대비 이익이 매우 커(기대 ROE ' + roeExp.toFixed(0) + '%, 현재 PBR ' + pbr.toFixed(1) + '배) 장부가 기반 모델이 맞지 않아 종합에서 제외';
      else if (roeExp <= 0) m.skip = '기대 ROE가 0 이하라 초과이익이 없습니다.';
      if (m.base <= 0) m.skip = m.skip || '계산값이 0 이하';
      out.methods.push(m);
    }
    /* ④ DCF (잉여현금흐름 2단계) — 최근 3년 FCF 중앙값(한 해 급등락에 휘둘리지 않도록), 5년간 성장률이 영구성장률로 수렴
          금융업은 예금 · 보험료 유출입이 영업현금흐름에 섞여 FCF 가 의미 없으므로 제외 */
    const fcf = (H.ocf || []).map(function (o, i) { return fin(o) && fin((H.capex || [])[i]) ? o - H.capex[i] : null; });
    const f3 = fcf.filter(fin).slice(-3);
    if (isFinancial(f) && f3.length){
      out.methods.push({ key:'dcf', name:'DCF (FCF)', skip:'금융업은 영업현금흐름에 예금 · 보험료 흐름이 섞여 DCF를 적용하지 않습니다.' });
    } else if (f3.length >= 2 && fin(f.shares) && f.shares > 0){
      const avg = median(f3);
      const pos = f3.filter(function (v) { return v > 0; }).length;
      /* 연결 FCF 에는 자회사 소수주주 몫이 섞여 있다 — 지배주주순이익 비중만큼만 주주 몫으로 본다 (지주사 과대평가 방지) */
      let ctrl = 1;
      const ai = actualIdx(A).slice(-3);
      if (A.nic && A.ni){
        let sc = 0, sn = 0;
        ai.forEach(function (i) { if (fin(A.nic[i]) && fin(A.ni[i]) && A.ni[i] > 0 && A.nic[i] > 0){ sc += A.nic[i]; sn += A.ni[i]; } });
        if (sn > 0) ctrl = clamp(sc / sn, 0.2, 1);
      }
      const fcfPS = avg * ctrl * unitMul(f) / f.shares;
      const gT = (ASSUME[f.cur] || ASSUME.KRW).gT / 100;
      const g1 = clamp(fin(g.revCagr) ? g.revCagr / 100 : 0.03, 0, 0.2);
      /* 설비투자가 몰린 기업은 FCF 가 이익의 극히 일부라 FCF 할인값이 기업가치를 대표하지 못한다 */
      const conv = fin(ps.epsTTM) && ps.epsTTM > 0 ? fcfPS / ps.epsTTM : null;
      if (avg > 0 && pos >= 2 && conv != null && conv < 0.3){
        out.methods.push({ key:'dcf', name:'DCF (FCF)', skip:'최근 3년 잉여현금흐름이 순이익의 ' + Math.round(conv * 100) + '%에 그쳐(설비투자 집중) FCF 할인값이 기업가치를 대표하지 못해 제외했습니다.' });
      } else if (avg > 0 && pos >= 2 && ke > gT){
        let v = 0, cf = fcfPS;
        for (let t = 1; t <= 5; t++){
          const gt = g1 + (gT - g1) * (t - 1) / 4;
          cf *= 1 + gt;
          v += cf / Math.pow(1 + ke, t);
        }
        const tv = cf * (1 + gT) / (ke - gT) / Math.pow(1 + ke, 5);
        const base = v + tv;
        out.methods.push({ key:'dcf', name:'DCF (FCF)', w:W.dcf, lo:base * 0.8, base:base, hi:base * 1.2,
          detail:'주당 FCF ' + fmtPS(fcfPS, f.cur) + ' (최근 3년 중앙값' + (ctrl < 0.97 ? ' × 지배주주 몫 ' + Math.round(ctrl * 100) + '%' : '') + ') · 성장률 ' +
            (g1 * 100).toFixed(1) + '% → ' + (gT * 100).toFixed(1) + '% (5년) · 할인율 ' + K.ke.toFixed(1) + '%',
          fcfPS:fcfPS, g1:g1 });
      } else {
        out.methods.push({ key:'dcf', name:'DCF (FCF)', skip:'최근 3년 잉여현금흐름이 ' + (avg <= 0 ? '적자' : '들쭉날쭉') + '해 DCF를 적용하지 않았습니다.' });
      }
    }
    /* 이상치 제거 — 3개 이상 적용될 때, 전체 중앙값에서 가장 멀리(4배 초과) 떨어진 방법을 하나씩 뺀다.
       현재가가 아니라 방법끼리 비교하므로, 시세가 움직여도 적용 방법이 바뀌지 않는다 */
    for (;;){
      const live = out.methods.filter(function (m) { return !m.skip && fin(m.base) && m.base > 0; });
      if (live.length < 3) break;
      const md = median(live.map(function (m) { return m.base; }));
      const worst = live.map(function (m) { return { m:m, d:Math.abs(Math.log(m.base / md)) }; }).sort(function (a, b) { return b.d - a.d; })[0];
      if (worst.d <= Math.log(4)) break;
      const r = worst.m.base / md;
      worst.m.skip = '다른 방법들과 크게 벌어져(' + fmtPS(worst.m.base, f.cur) + ', 방법별 중앙값 ' + fmtPS(md, f.cur) + '의 ' +
        (r > 1 ? r.toFixed(1) + '배' : (1 / r).toFixed(1) + '분의 1') + ') 종합에서 제외했습니다. 계산식: ' + worst.m.detail;
    }
    /* 종합 — 적용 가능한 방법의 가중평균 */
    const ok = out.methods.filter(function (m) { return !m.skip && fin(m.base) && m.base > 0; });
    if (ok.length){
      const ws = ok.reduce(function (s, m) { return s + m.w; }, 0);
      out.value = ok.reduce(function (s, m) { return s + m.base * m.w; }, 0) / ws;
      out.lo = Math.min.apply(null, ok.map(function (m) { return m.lo; }));
      out.hi = Math.max.apply(null, ok.map(function (m) { return m.hi; }));
      out.upside = (out.value / price - 1) * 100;
      out.used = ok.map(function (m) { return m.name; });
      /* 신뢰도 — 살아남은 방법 수와 방법 간 편차(최대/최소) */
      const spread = Math.max.apply(null, ok.map(function (m) { return m.base; })) / Math.min.apply(null, ok.map(function (m) { return m.base; }));
      out.confidence = ok.length >= 3 && spread <= 2.5 ? '높음' : ok.length >= 2 && spread <= 4 ? '보통' : '낮음';
      out.spread = spread;
    }
    if (f.cons && fin(f.cons.target)) out.consensus = { v:f.cons.target, opinion:f.cons.opinion, n:f.cons.n, upside:(f.cons.target / price - 1) * 100 };
    return out;
  }
  function fmtPS(v, cur){ return cur === 'USD' ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원'; }

  /* ---------------- 펀더멘털 점수 (0~100) ----------------
       PER 업종 대비 25 · PBR 업종 대비 25 · ROE 25 · 최근 분기 영업이익 YoY 25 − 재무 위험 감점 */
  function ratioPts(r){ return r <= 0.5 ? 25 : r <= 0.7 ? 22 : r <= 0.85 ? 18 : r <= 1.0 ? 14 : r <= 1.2 ? 9 : r <= 1.5 ? 5 : 2; }
  function scoreOf(v, g, h){
    const parts = [];
    /* PER */
    if (!fin(v.per)) parts.push({ key:'per', name:'PER 업종 대비', pts:0, max:25, note:'최근 4분기 적자 — PER 산출 불가' });
    else if (fin(v.indPer)) parts.push({ key:'per', name:'PER 업종 대비', pts:ratioPts(v.per / v.indPer), max:25,
      note:v.per.toFixed(1) + '배 vs 업종 ' + v.indPer.toFixed(1) + '배 (' + pctGap(v.per, v.indPer) + ')' });
    else parts.push({ key:'per', name:'PER 수준', pts:v.per <= 8 ? 20 : v.per <= 12 ? 16 : v.per <= 20 ? 11 : v.per <= 30 ? 6 : 2, max:25, note:v.per.toFixed(1) + '배 (업종 비교값 없음 · 절대 수준)' });
    /* PBR */
    if (!fin(v.pbr)) parts.push({ key:'pbr', name:'PBR 업종 대비', pts:0, max:25, note:'자본잠식 — PBR 산출 불가' });
    else {
      let pts, note;
      if (fin(v.indPbr)){ pts = ratioPts(v.pbr / v.indPbr); note = v.pbr.toFixed(2) + '배 vs ' + (v.pbrBasis || '업종') + ' ' + v.indPbr.toFixed(2) + '배 (' + pctGap(v.pbr, v.indPbr) + ')'; }
      else { pts = v.pbr <= 0.7 ? 20 : v.pbr <= 1 ? 16 : v.pbr <= 2 ? 11 : v.pbr <= 4 ? 6 : 2; note = v.pbr.toFixed(2) + '배 (절대 수준)'; }
      if (fin(v.roe) && v.roe < 0){ pts = Math.min(pts, 8); note += ' · 적자 기업이라 저PBR 가점 제한'; }
      parts.push({ key:'pbr', name:'PBR 업종 대비', pts:pts, max:25, note:note });
    }
    /* ROE */
    const r = v.roe;
    parts.push({ key:'roe', name:'ROE 10% 이상', max:25,
      pts:!fin(r) ? 0 : r >= 20 ? 25 : r >= 15 ? 22 : r >= 10 ? 18 : r >= 7 ? 11 : r >= 3 ? 6 : r >= 0 ? 3 : 0,
      note:fin(r) ? 'ROE ' + r.toFixed(1) + '% (최근 4분기)' + (r >= 10 ? ' — 기준 충족' : ' — 10% 미만') : 'ROE 없음' });
    /* 영업이익 YoY */
    const y = g.opYoY;
    let yp = 0;
    if (y){
      if (y.kind === 'turn') yp = 22; else if (y.kind === 'loss') yp = 0; else if (y.kind === 'deficit') yp = 1;
      else yp = y.v >= 50 ? 25 : y.v >= 20 ? 22 : y.v >= 10 ? 19 : y.v > 0 ? 15 : y.v >= -10 ? 8 : 3;
    }
    parts.push({ key:'yoy', name:'영업이익 YoY', pts:yp, max:25, note:y ? y.text + ' (' + g.opYoYBasis + ')' : '비교 가능한 실적 없음' });

    const raw = parts.reduce(function (s, p) { return s + p.pts; }, 0);
    const penalty = h.score == null ? 0 : h.score < 30 ? 10 : h.score < 45 ? 5 : 0;
    return { score:clamp(raw - penalty, 0, 100), raw:raw, parts:parts, penalty:penalty,
             penaltyNote:penalty ? '재무 건전성 ' + h.grade + ' (' + h.score + '점) — ' + penalty + '점 감점' : null };
  }
  function pctGap(a, b){ const d = (a / b - 1) * 100; return Math.abs(d).toFixed(0) + '% ' + (d <= 0 ? '할인' : '할증'); }

  /* ---------------- 태그 · 체크리스트 · 요약 ---------------- */
  function tagsOf(v, g, h, fv){
    const t = [];
    const push = function (text, w, tone) { t.push({ text:text, w:w, tone:tone || 'good' }); };
    if (fin(v.per) && fin(v.indPer) && v.per / v.indPer <= 0.8) push('#PER저평가', 9);
    if (fin(v.pbr) && ((fin(v.indPbr) && v.pbr / v.indPbr <= 0.8) || (v.pbr < 1 && fin(v.roe) && v.roe > 5))) push('#PBR저평가', 7);
    if (fin(v.roe) && v.roe >= 15) push('#고ROE', 7); else if (fin(v.roe) && v.roe >= 10) push('#ROE10%↑', 5);
    const y = g.opYoY;
    if (y && y.kind === 'turn') push('#흑자전환', 9);
    else if (y && y.kind === 'num' && y.v >= 10) push('#영업이익성장', y.v >= 30 ? 8 : 6);
    if (g.opmRising) push('#이익률개선', 5);
    if (fin(v.dy) && v.dy >= (v.cur === 'USD' ? 2.5 : 3)) push('#배당매력', 5);
    if (h.score != null && h.score >= 80) push('#재무건전', 4);
    if (fv && fin(fv.upside) && fv.upside >= 20) push('#적정가대비저평가', 8);
    if (fin(v.peg) && v.peg > 0 && v.peg < 1) push('#PEG1미만', 5);
    /* 주의 태그 */
    if (!fin(v.per)) push('#적자', 6, 'bad');
    if (y && y.kind === 'loss') push('#적자전환', 6, 'bad');
    if (h.score != null && h.score < 45) push('#재무주의', 6, 'bad');
    if (fin(v.per) && fin(v.indPer) && v.per / v.indPer >= 1.5) push('#PER고평가', 4, 'bad');
    return t.sort(function (a, b) { return b.w - a.w; });
  }
  function checklist(v, g, h, f){
    const H = f.hist || {};
    const fcfLast = (function () {
      const o = last(H.ocf), c = last(H.capex);
      return fin(o) && fin(c) ? o - c : null;
    })();
    const opm = g.opm.filter(fin);
    return [
      [fin(v.epsTTM) && v.epsTTM > 0, '최근 4분기 흑자'],
      [fin(v.roe) && v.roe >= 10, 'ROE 10% 이상'],
      [opm.length >= 2 && opm[opm.length - 1] > opm[opm.length - 2], '영업이익률 전년보다 개선'],
      [!!g.opYoY && (g.opYoY.kind === 'turn' || (g.opYoY.kind === 'num' && g.opYoY.v > 0)), '영업이익 전년 대비 증가'],
      [h.financial ? null : fin(h.debt) && h.debt <= 100, '부채비율 100% 이하' + (h.financial ? ' (금융업 제외)' : '')],
      [h.financial ? null : (fin(h.icr) ? h.icr >= 3 : !!h.netCash), '이자보상배율 3배 이상'],
      [fcfLast == null ? null : fcfLast > 0, '잉여현금흐름(FCF) 흑자'],
      [fin(v.per) && fin(v.indPer) ? v.per <= v.indPer : null, 'PER 업종 평균 이하'],
      [fin(v.dy) ? v.dy > 0 : null, '배당 지급']
    ].filter(function (c) { return c[0] !== null; });
  }
  function money(v, f){
    if (!fin(v)) return '—';
    if (f.cur === 'USD'){
      const a = Math.abs(v), s = v < 0 ? '−' : '';
      return a >= 1000 ? s + '$' + (a / 1000).toFixed(a >= 100000 ? 0 : 1) + 'B' : s + '$' + Math.round(a) + 'M';
    }
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    return a >= 10000 ? s + (a / 10000).toFixed(a >= 1000000 ? 0 : 1) + '조' : s + Math.round(a).toLocaleString('ko-KR') + '억';
  }
  function summary(v, g, h, fv, sc, f){
    const out = [];
    /* 밸류에이션 */
    if (!fin(v.per)) out.push({ tone:'bad', html:'최근 4분기 순이익이 <b>적자</b>라 PER로 평가할 수 없습니다. 실적 회복 여부가 주가의 핵심 변수입니다.' });
    else if (fin(v.indPer)){
      const d = (v.per / v.indPer - 1) * 100;
      const judge = d <= -20 ? '저평가' : d <= -5 ? '다소 저평가' : d < 10 ? '업종 평균 수준' : d < 40 ? '다소 고평가' : '고평가';
      let s = 'PER <b>' + v.per.toFixed(1) + '배</b>로 ' + (v.perLabel || '동일 업종 평균') + '(' + v.indPer.toFixed(1) + '배) 대비 ' +
        (Math.abs(d) < 5 ? '비슷한' : Math.abs(d).toFixed(0) + '% ' + (d < 0 ? '낮은' : '높은')) + ' <b>' + judge + '</b> 상태입니다.';
      if (fin(v.fwdPer) && v.fwdPer < v.per * 0.8) s += ' 선행 PER은 ' + v.fwdPer.toFixed(1) + '배로, 예상 이익 증가가 반영되면 부담이 줄어듭니다.';
      else if (fin(v.fwdPer) && v.fwdPer > v.per * 1.15) s += ' 다만 선행 PER이 ' + v.fwdPer.toFixed(1) + '배로 올라가, 이익 감소가 예상됩니다.';
      out.push({ tone: d <= -5 ? 'good' : d < 10 ? 'neut' : 'bad', html:s });
    } else {
      out.push({ tone:'neut', html:'PER <b>' + v.per.toFixed(1) + '배</b> · PBR <b>' + (fin(v.pbr) ? v.pbr.toFixed(2) : '—') + '배</b>입니다 (업종 비교값 없음).' });
    }
    /* 수익성 · 성장성 */
    const opm = g.opmLast3;
    if (g.opmRising) out.push({ tone:'good', html:'최근 3년 영업이익률이 ' + opm.map(function (x) { return x.toFixed(1) + '%'; }).join(' → ') + '로 <b>3년 연속 상승</b> 중(우수)입니다.' });
    else if (g.opmFalling) out.push({ tone:'bad', html:'최근 3년 영업이익률이 ' + opm.map(function (x) { return x.toFixed(1) + '%'; }).join(' → ') + '로 <b>3년 연속 하락</b>해 수익성이 약해지고 있습니다.' });
    const y = g.opYoY;
    if (y){
      const basis = g.q && g.q.opYoY ? '최근 분기(' + g.q.label + ') 영업이익은 전년 동기 대비 ' : '최근 연간 영업이익은 전년 대비 ';
      out.push({ tone: y.kind === 'turn' || (y.kind === 'num' && y.v > 0) ? 'good' : 'bad',
        html: basis + (y.kind === 'num' ? '<b>' + y.text + '</b> ' + (y.v >= 0 ? '증가' : '감소') + '했습니다.' : '<b>' + y.text + '</b>했습니다.') +
          (fin(g.revCagr) ? ' 매출은 최근 ' + (g.years.length - 1) + '년간 연평균 ' + g.revCagr.toFixed(1) + '% ' + (g.revCagr >= 0 ? '성장' : '감소') + '했습니다.' : '') });
    }
    if (fin(v.roe)) out.push({ tone: v.roe >= 10 ? 'good' : v.roe >= 5 ? 'neut' : 'bad', html:'ROE <b>' + v.roe.toFixed(1) + '%</b>로 ' + (v.roe >= 15 ? '자본을 매우 효율적으로 굴리고' : v.roe >= 10 ? '투자 기준(10%)을 넘는 수익성을 내고' : '투자 기준(10%)에 못 미치는 수익성을 보이고') + ' 있습니다.' });
    /* 재무 건전성 */
    if (h.score != null){
      const bits = [];
      if (fin(h.debt) && !h.financial) bits.push('부채비율 ' + Math.round(h.debt) + '%');
      if (fin(h.icr) && !h.financial) bits.push('이자보상배율 ' + (h.icr >= 100 ? Math.round(h.icr) : h.icr.toFixed(1)) + '배');
      else if (h.netCash && !h.financial) bits.push('순현금 상태');
      out.push({ tone:h.tone, html:(bits.length ? bits.join(', ') + '로 ' : '') + '재무 안정성은 <b>' + h.grade + '</b>(' + h.score + '점) 등급입니다.' });
    }
    /* 적정주가 */
    if (fv && fin(fv.value)){
      out.push({ tone: fv.upside >= 10 ? 'good' : fv.upside > -10 ? 'neut' : 'bad',
        html:'적정주가(' + fv.used.join(' · ') + ' 가중평균)는 <b>' + fmtPS(fv.value, f.cur) + '</b>, 현재가 대비 <b>' + (fv.upside >= 0 ? '+' : '−') + Math.abs(fv.upside).toFixed(1) + '%</b>로 ' +
          (fv.upside >= 10 ? '상승 여력이 있습니다.' : fv.upside > -10 ? '적정 가격권입니다.' : '본질가치보다 비싸게 거래되고 있습니다.') });
    }
    return out;
  }

  /* ---------------- 종합 분석 ---------------- */
  function analyze(code, price){
    const f = DB[code];
    if (!f || !fin(price) || price <= 0) return null;
    const ps = perShare(f), peers = peerStats(code) || {};
    const roe = roeTTM(f, ps);
    const v = {
      cur:f.cur, price:price, epsTTM:ps.epsTTM, epsFwd:ps.epsFwd, fwdLabel:ps.fwdLabel, bps:ps.bps, dps:ps.dps, roe:roe,
      per: fin(ps.epsTTM) && ps.epsTTM > 0 ? price / ps.epsTTM : null,
      fwdPer: fin(ps.epsFwd) && ps.epsFwd > 0 ? price / ps.epsFwd : null,
      pbr: fin(ps.bps) && ps.bps > 0 ? price / ps.bps : null,
      dy: fin(ps.dps) && ps.dps > 0 ? ps.dps / price * 100 : (fin(ps.dps) ? 0 : null)
    };
    /* 업종 PER · PBR */
    /* WiseReport 업종 PER 은 업종 이익이 0 근처면 수천 배로 튀므로 1~100배만 신뢰 */
    if (f.cur === 'KRW' && fin(f.indPer) && f.indPer >= 1 && f.indPer <= 100){ v.indPer = f.indPer; v.perBasis = 'WICS ' + (f.ind || '업종'); v.perLabel = v.perBasis + ' 평균'; }
    else if (fin(peers.per)){ v.indPer = peers.per; v.perBasis = peers.perBasis + ' 비교 ' + peers.perN + '종목 중앙값'; v.perLabel = v.perBasis; }
    if (fin(peers.pbr)){ v.indPbr = peers.pbr; v.pbrBasis = peers.pbrBasis + ' 비교 ' + peers.pbrN + '종목 중앙값'; }
    /* EV/EBITDA — 현재 시가총액 + 순차입금 */
    const H = f.hist || {}, mul = unitMul(f);
    if (fin(f.shares) && f.shares > 0){
      let nd = null, ebitda = null;
      if (f.cur === 'USD'){
        if (f.bs && fin(f.bs.debt) && fin(f.bs.cash)) nd = (f.bs.debt - f.bs.cash) * mul;
        ebitda = f.ttm && fin(f.ttm.ebitda) ? f.ttm.ebitda : last(H.ebitda);
      } else {
        const ndr = last(H.netDebt);
        if (fin(ndr) && fin(ps.bps)) nd = ndr / 100 * ps.bps * f.shares;
        ebitda = last(H.ebitda);
      }
      if (fin(ebitda) && ebitda > 0) v.evEbitda = (price * f.shares + (nd || 0)) / (ebitda * mul);
      v.mcap = price * f.shares / mul;
    }
    if (!fin(v.evEbitda) && fin(f.evEbitda)) v.evEbitda = f.evEbitda;
    const evh = (H.evEbitda || []).filter(function (x) { return fin(x) && x > 0 && x < 100; });
    v.evEbitdaHist = evh.length >= 3 ? median(evh) : null;
    /* PEG — 선행 EPS 성장률 (없으면 영업이익 연평균 성장률) */
    const g = growth(f);
    const epsG = fin(ps.epsFwd) && fin(ps.epsTTM) && ps.epsTTM > 0 && ps.epsFwd > 0 ? (ps.epsFwd / ps.epsTTM - 1) * 100 : g.opCagr;
    if (fin(v.per) && fin(epsG) && epsG > 0) v.peg = v.per / Math.min(epsG, 50);     // 일시적 급증(턴어라운드)은 50%로 제한
    v.epsGrowth = epsG;
    /* FCF 수익률 */
    const o = last(H.ocf), c = last(H.capex);
    if (fin(o) && fin(c) && fin(f.shares) && f.shares > 0) v.fcfYield = (o - c) * mul / f.shares / price * 100;

    const h = health(f);
    const fv = fairValue(f, price, ps, roe, g);
    const sc = scoreOf(v, g, h);
    const tags = tagsOf(v, g, h, fv);
    return {
      code:code, f:f, v:v, g:g, h:h, fv:fv, score:sc.score, scoring:sc, tags:tags,
      checks:checklist(v, g, h, f), summary:summary(v, g, h, fv, sc, f),
      financial:isFinancial(f), asOf:META.updated
    };
  }

  QT.Fund = { load:load, has:has, raw:raw, analyze:analyze, onLoad:onLoad, money:money, fmtPS:fmtPS,
    ASSUME:ASSUME, WEIGHTS:W, meta:function () { return META; } };
})(window.QT);

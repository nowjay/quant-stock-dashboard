/* =============================================================
   app.js — 화면 조립 (사이드바 · 차트 · 분석 · 일정)
   ============================================================= */
(function (QT) {
  'use strict';
  const M = QT.Market, A = QT.Analysis, FX = QT.FX, EV = QT.Events, LWC = window.LightweightCharts;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- 통화 · 포맷 ---------------- */
  function won(v){ return Math.round(v).toLocaleString('ko-KR') + '원'; }
  function usd(v){ return '$' + v.toFixed(2); }
  /** 통화를 명시한 가격 (72,500원 / $182.50) */
  function price(v, cur){
    if (v == null || !isFinite(v)) return '—';
    return cur === 'USD' ? usd(v) : won(v);
  }
  /** 축·레전드용 단위 없는 숫자 */
  function plain(v, cur){
    if (v == null || !isFinite(v)) return '—';
    return cur === 'USD' ? v.toFixed(2) : Math.round(v).toLocaleString('ko-KR');
  }
  function signed(v, cur){
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + price(Math.abs(v), cur);
  }
  /** 미국 주식의 원화 환산 문자열 */
  function krwOf(v, cur){
    if (cur !== 'USD' || v == null || !FX) return null;
    return '≈ ' + won(FX.toKRW(v));
  }
  function pct(v){ return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%'; }
  function vol(v){
    if (v == null) return '—';
    if (v >= 100000000) return (v / 100000000).toFixed(1) + '억';
    if (v >= 10000) return Math.round(v / 10000).toLocaleString('ko-KR') + '만';
    return Math.round(v).toLocaleString('ko-KR');
  }
  function cls(v){ return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function icons(){ if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }
  function sec(t){ return Math.floor(t / 1000); }
  function pad2(n){ return n < 10 ? '0' + n : '' + n; }
  function hhmmss(t){ const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }

  /* ---------------- 상태 ---------------- */
  const WL_KEY = 'qt.watchlist.v2';
  const DEFAULT_WL = ['005930','000660','373220','035420','005380','196170','NVDA','AAPL'];
  const state = {
    code: '005930', tf:'1D', tab:'watch', mkt:'ALL', q:'', panel:'analysis',
    watchlist: (function () {
      try { const s = JSON.parse(localStorage.getItem(WL_KEY)); if (Array.isArray(s) && s.length) return s; } catch (e) {}
      return DEFAULT_WL.slice();
    })(),
    ind: { ma:true, bb:false, rsi:true, macd:true },
    ac: { open:false, items:[], sel:-1 }
  };
  function saveWL(){ try { localStorage.setItem(WL_KEY, JSON.stringify(state.watchlist)); } catch (e) {} }

  /* ---------------- 차트 ---------------- */
  const COLORS = {
    up:'#F04438', down:'#3B82F6', upFill:'rgba(240,68,56,.32)', downFill:'rgba(59,130,246,.32)',
    ma20:'#3182F6', ma50:'#12B76A', ma200:'#7A5AF8', bb:'#B0B8C1',
    rsi:'#F59E0B', macd:'#3182F6', macdSig:'#F04438', grid:'#F3F4F6', text:'#8B95A1'
  };
  const LAYOUT = { background:{ type:'solid', color:'#FFFFFF' }, textColor:COLORS.text, fontFamily:"'Gothic A1',-apple-system,sans-serif", fontSize:11 };
  function baseOptions(h){
    return {
      height:h, layout:Object.assign({}, LAYOUT),
      grid:{ vertLines:{ color:COLORS.grid }, horzLines:{ color:COLORS.grid } },
      rightPriceScale:{ borderVisible:false, scaleMargins:{ top:0.12, bottom:0.06 } },
      timeScale:{ borderVisible:false, timeVisible:true, secondsVisible:false, rightOffset:3, minBarSpacing:1.5 },
      crosshair:{
        mode: LWC ? LWC.CrosshairMode.Normal : 0,
        vertLine:{ color:'#B0B8C1', width:1, style:2, labelBackgroundColor:'#191F28' },
        horzLine:{ color:'#B0B8C1', width:1, style:2, labelBackgroundColor:'#191F28' }
      },
      handleScale:{ axisPressedMouseMove:{ time:true, price:false } },
      localization:{ locale:'ko-KR' }
    };
  }
  const chart = { price:null, rsi:null, macd:null, series:{}, ready:false };
  let syncing = false, timeIndex = new Map(), bars = [], ind = null, analysis = null;

  function buildCharts(){
    if (!LWC){
      $('.chart-stack').innerHTML = '<div class="lib-fallback">차트 라이브러리를 불러오지 못했습니다.<br>네트워크 확인 후 새로고침해 주세요.</div>';
      return;
    }
    chart.price = LWC.createChart($('#pane-price'), baseOptions($('#pane-price').clientHeight));
    chart.rsi = LWC.createChart($('#pane-rsi'), Object.assign(baseOptions($('#pane-rsi').clientHeight), {
      layout: Object.assign({}, LAYOUT, { attributionLogo:false }),
      rightPriceScale:{ borderVisible:false, scaleMargins:{ top:0.08, bottom:0.08 } },
      timeScale:{ visible:false, borderVisible:false }
    }));
    chart.macd = LWC.createChart($('#pane-macd'), Object.assign(baseOptions($('#pane-macd').clientHeight), {
      layout: Object.assign({}, LAYOUT, { attributionLogo:false }),
      rightPriceScale:{ borderVisible:false, scaleMargins:{ top:0.18, bottom:0.18 } }
    }));

    chart.series.candle = chart.price.addCandlestickSeries({
      upColor:COLORS.up, downColor:COLORS.down, borderVisible:false, wickUpColor:COLORS.up, wickDownColor:COLORS.down
    });
    chart.series.volume = chart.price.addHistogramSeries({ priceFormat:{ type:'volume' }, priceScaleId:'vol', lastValueVisible:false, priceLineVisible:false });
    chart.price.priceScale('vol').applyOptions({ scaleMargins:{ top:0.84, bottom:0 } });
    ['ma20','ma50','ma200'].forEach(function (k) {
      chart.series[k] = chart.price.addLineSeries({ color:COLORS[k], lineWidth:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    });
    ['bbUp','bbLow'].forEach(function (k) {
      chart.series[k] = chart.price.addLineSeries({ color:COLORS.bb, lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    });
    chart.series.rsi = chart.rsi.addLineSeries({
      color:COLORS.rsi, lineWidth:2, priceLineVisible:false, lastValueVisible:true,
      priceFormat:{ type:'price', precision:1, minMove:0.1 },
      autoscaleInfoProvider: function () { return { priceRange:{ minValue:0, maxValue:100 } }; }
    });
    [70, 50, 30].forEach(function (lv) {
      chart.series.rsi.createPriceLine({ price:lv, color: lv === 50 ? '#F3F4F6' : '#E5E7EB', lineWidth:1, lineStyle:2, axisLabelVisible:lv !== 50, title:'' });
    });
    chart.series.macdHist = chart.macd.addHistogramSeries({ priceLineVisible:false, lastValueVisible:false });
    chart.series.macdLine = chart.macd.addLineSeries({ color:COLORS.macd, lineWidth:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    chart.series.macdSignal = chart.macd.addLineSeries({ color:COLORS.macdSig, lineWidth:1.5, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });

    const list = [chart.price, chart.rsi, chart.macd];
    list.forEach(function (src) {
      src.timeScale().subscribeVisibleLogicalRangeChange(function (r) {
        if (!r || syncing) return;
        syncing = true;
        list.forEach(function (c) { if (c !== src) c.timeScale().setVisibleLogicalRange(r); });
        syncing = false;
      });
    });
    chart.price.subscribeCrosshairMove(function (param) {
      renderLegend(param && param.time != null ? param.time : null);
      [chart.rsi, chart.macd].forEach(function (c) {
        if (!param || param.time == null){ if (c.clearCrosshairPosition) c.clearCrosshairPosition(); return; }
        if (c.setCrosshairPosition){
          const s = c === chart.rsi ? chart.series.rsi : chart.series.macdLine;
          const i = timeIndex.get(param.time);
          const v = c === chart.rsi ? (ind && ind.rsi[i]) : (ind && ind.macd[i]);
          if (v != null) c.setCrosshairPosition(v, param.time, s);
        }
      });
    });
    chart.ready = true;

    ['price','rsi','macd'].forEach(function (k) {
      $('#pane-' + k).addEventListener('wheel', function (e) {
        if (e.ctrlKey || e.metaKey){ e.preventDefault(); return; }
        e.stopPropagation();
      }, { capture:true, passive:false });
    });
    const ro = new ResizeObserver(function () {
      if (!chart.ready) return;
      ['price','rsi','macd'].forEach(function (k) {
        const el = $('#pane-' + k);
        if (el && chart[k]) chart[k].applyOptions({ width: el.clientWidth, height: el.clientHeight });
      });
    });
    ['price','rsi','macd'].forEach(function (k) { ro.observe($('#pane-' + k)); });
  }

  function lineData(arr){
    const out = [];
    for (let i = 0; i < bars.length; i++) if (arr[i] != null) out.push({ time: sec(bars[i].t), value: arr[i] });
    return out;
  }
  function paintChart(resetView){
    if (!chart.ready) return;
    const st = M.BY_CODE[state.code];
    chart.series.candle.applyOptions({ priceFormat:{ type:'price', precision: st.cur === 'USD' ? 2 : 0, minMove: st.cur === 'USD' ? 0.01 : 1 } });
    chart.price.applyOptions({ localization:{ locale:'ko-KR', priceFormatter: function (v) { return plain(v, st.cur); } } });

    timeIndex = new Map();
    bars.forEach(function (b, i) { timeIndex.set(sec(b.t), i); });
    chart.series.candle.setData(bars.map(function (b) { return { time:sec(b.t), open:b.o, high:b.h, low:b.l, close:b.c }; }));
    chart.series.volume.setData(bars.map(function (b) { return { time:sec(b.t), value:b.v, color: b.c >= b.o ? COLORS.upFill : COLORS.downFill }; }));
    chart.series.ma20.setData(state.ind.ma ? lineData(ind.sma20) : []);
    chart.series.ma50.setData(state.ind.ma ? lineData(ind.sma50) : []);
    chart.series.ma200.setData(state.ind.ma ? lineData(ind.sma200) : []);
    chart.series.bbUp.setData(state.ind.bb ? lineData(ind.bbUp) : []);
    chart.series.bbLow.setData(state.ind.bb ? lineData(ind.bbLow) : []);
    chart.series.rsi.setData(lineData(ind.rsi));
    chart.series.macdLine.setData(lineData(ind.macd));
    chart.series.macdSignal.setData(lineData(ind.macdSignal));
    chart.series.macdHist.setData(bars.reduce(function (acc, b, i) {
      const v = ind.macdHist[i];
      if (v != null) acc.push({ time:sec(b.t), value:v, color: v >= 0 ? COLORS.upFill : COLORS.downFill });
      return acc;
    }, []));

    const showTime = state.tf === '1m' || state.tf === '5m';
    const stack = [{ c:chart.price, on:true }, { c:chart.rsi, on:state.ind.rsi }, { c:chart.macd, on:state.ind.macd }];
    const bottom = stack.filter(function (x) { return x.on; }).pop();
    stack.forEach(function (x) { x.c.applyOptions({ timeScale:{ visible: x === bottom, timeVisible:showTime, secondsVisible:false } }); });

    if (resetView){
      const span = { '1m':180, '5m':160, '1D':140, '1W':120, '1M':84 }[state.tf] || 140;
      const to = bars.length + 2, from = Math.max(0, bars.length - span);
      syncing = true;
      [chart.price, chart.rsi, chart.macd].forEach(function (c) { c.timeScale().setVisibleLogicalRange({ from:from, to:to }); });
      syncing = false;
    }
    $('#pane-rsi').style.display = state.ind.rsi ? '' : 'none';
    $('#pane-macd').style.display = state.ind.macd ? '' : 'none';
  }
  function pushLastBar(){
    if (!chart.ready || !bars.length) return;
    const b = bars[bars.length - 1], t = sec(b.t);
    chart.series.candle.update({ time:t, open:b.o, high:b.h, low:b.l, close:b.c });
    chart.series.volume.update({ time:t, value:b.v, color: b.c >= b.o ? COLORS.upFill : COLORS.downFill });
  }

  /* ---------------- 레전드 ---------------- */
  function labelOf(t){
    const d = new Date(t);
    const ymd = d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
    return (state.tf === '1m' || state.tf === '5m') ? ymd + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : ymd;
  }
  function renderLegend(time){
    if (!bars.length || !ind) return;
    const st = M.BY_CODE[state.code];
    let i = bars.length - 1;
    if (time != null && timeIndex.has(time)) i = timeIndex.get(time);
    const b = bars[i], prev = bars[i - 1] || b;
    const ch = prev.c ? (b.c - prev.c) / prev.c * 100 : 0;
    const unit = st.cur === 'USD' ? '$' : '₩';
    const parts = [
      '<span><span class="k">' + labelOf(b.t) + '</span></span>',
      '<span><span class="k">시</span>' + plain(b.o, st.cur) + '</span>',
      '<span class="up"><span class="k">고</span>' + plain(b.h, st.cur) + '</span>',
      '<span class="down"><span class="k">저</span>' + plain(b.l, st.cur) + '</span>',
      '<span class="' + cls(b.c - b.o) + '"><span class="k">종</span>' + plain(b.c, st.cur) + ' <small>' + unit + '</small></span>',
      '<span class="' + cls(ch) + '">' + pct(ch) + '</span>',
      '<span class="opt"><span class="k">거래량</span>' + vol(b.v) + '</span>'
    ];
    if (state.ind.ma){
      if (ind.sma20[i] != null) parts.push('<span class="ma" style="color:' + COLORS.ma20 + '"><span class="k">MA20</span>' + plain(ind.sma20[i], st.cur) + '</span>');
      if (ind.sma50[i] != null) parts.push('<span class="ma" style="color:' + COLORS.ma50 + '"><span class="k">MA50</span>' + plain(ind.sma50[i], st.cur) + '</span>');
      if (ind.sma200[i] != null) parts.push('<span class="ma" style="color:' + COLORS.ma200 + '"><span class="k">MA200</span>' + plain(ind.sma200[i], st.cur) + '</span>');
    }
    $('#legend').innerHTML = parts.join('');
    if (ind.rsi[i] != null) $('#tag-rsi').innerHTML = 'RSI (14) <em>' + ind.rsi[i].toFixed(1) + '</em>';
    if (ind.macd[i] != null) $('#tag-macd').innerHTML = 'MACD (12, 26, 9) <em>' + ind.macd[i].toFixed(2) + ' / ' + (ind.macdSignal[i] != null ? ind.macdSignal[i].toFixed(2) : '—') + '</em>';
  }

  /* ---------------- 사이드바 ---------------- */
  function sparkline(values, up){
    if (!values || values.length < 2) return '<span class="spark"></span>';
    let min = Infinity, max = -Infinity;
    values.forEach(function (v) { if (v < min) min = v; if (v > max) max = v; });
    const w = 56, h = 26, pad = 3, span = (max - min) || 1;
    const pts = values.map(function (v, i) {
      return ((i / (values.length - 1)) * w).toFixed(1) + ',' + (h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1);
    }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + (up ? '#F04438' : '#3B82F6') + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/></svg>';
  }
  function rowHtml(st, withSpark){
    const q = withSpark ? M.snapshot(st.code) : M.lightQuote(st.code);
    if (!q) return '';
    const on = state.watchlist.indexOf(st.code) >= 0;
    const krw = krwOf(q.price, st.cur);
    return '<div class="wl-row' + (st.code === state.code ? ' on' : '') + '" data-code="' + st.code + '">' +
      '<div><div class="nm">' + st.name + '</div><div class="mk"><span class="code">' + st.code + '</span>' +
        (withSpark ? sparkline(q.spark, q.rate >= 0) : '<span class="chip">' + st.market + '</span>') + '</div></div>' +
      '<div><div class="px num" data-f="px">' + price(q.price, st.cur) + '</div>' +
        '<div class="ch num ' + cls(q.rate) + '" data-f="ch">' + pct(q.rate) + '</div>' +
        (krw ? '<div class="sub-krw" data-f="krw">' + krw + '</div>' : '') + '</div>' +
      '<button class="star' + (on ? ' on' : '') + '" data-star="' + st.code + '" aria-label="관심종목 ' + (on ? '해제' : '추가') + '"><i data-lucide="star"></i></button>' +
    '</div>';
  }
  function renderList(){
    const el = $('#wl');
    $('#mkt').hidden = state.tab !== 'all';
    let pool, withSpark;
    if (state.tab === 'watch'){
      pool = state.watchlist.map(function (c) { return M.BY_CODE[c]; }).filter(Boolean);
      withSpark = true;
    } else {
      withSpark = false;
      pool = M.UNIVERSE.filter(function (s) {
        if (state.mkt === 'ALL') return true;
        if (state.mkt === 'US') return s.cur === 'USD';
        return s.market === state.mkt;
      }).slice(0, 60);
    }
    if (!pool.length){
      el.innerHTML = '<div class="empty">' + (state.tab === 'watch'
        ? '관심종목이 비어 있습니다.<br>검색 후 별을 눌러 추가하세요.' : '표시할 종목이 없습니다.') + '</div>';
      return;
    }
    el.innerHTML = pool.map(function (s) { return rowHtml(s, withSpark); }).join('');
    icons();
    $('#acct-count').textContent = state.watchlist.length + ' 종목';
  }
  function refreshRowPrices(){
    $$('#wl .wl-row').forEach(function (row) {
      const st = M.BY_CODE[row.dataset.code]; if (!st) return;
      const q = M.lightQuote(st.code); if (!q) return;
      const px = row.querySelector('[data-f="px"]'), ch = row.querySelector('[data-f="ch"]'), kw = row.querySelector('[data-f="krw"]');
      if (px) px.textContent = price(q.price, st.cur);
      if (ch){ ch.textContent = pct(q.rate); ch.className = 'ch num ' + cls(q.rate); }
      if (kw) kw.textContent = krwOf(q.price, st.cur) || '';
    });
  }

  /* ---------------- 자동완성 ---------------- */
  function renderAC(){
    const box = $('#ac'), q = state.q.trim();
    if (!q){ box.hidden = true; state.ac.open = false; $('#q').setAttribute('aria-expanded', 'false'); return; }
    const items = QT.Search.query(q, 12);
    state.ac.items = items; state.ac.sel = items.length ? 0 : -1;
    if (!items.length){
      box.innerHTML = '<div class="ac-empty">검색 결과가 없습니다.<br>종목명 · 초성(ㅅㅅㅈㅈ) · 코드(005930) · 티커(AAPL)로 검색해 보세요.</div>';
    } else {
      box.innerHTML = items.map(function (it, i) {
        const st = M.BY_CODE[it.code];
        const lq = st ? M.lightQuote(it.code) : null;
        const cur = it.cur;
        return '<div class="ac-item' + (i === 0 ? ' sel' : '') + '" role="option" data-code="' + it.code + '" data-i="' + i + '">' +
          '<div><div class="nm">' + QT.Search.highlight(it.name, q) + '</div>' +
            '<div class="meta"><span class="code">' + it.code + '</span><span class="chip">' + it.market + '</span>' +
            (it.type === 'etf' ? '<span class="chip">ETF</span>' : '') + '</div></div>' +
          '<div>' + (lq && lq.price != null
            ? '<div class="px">' + price(lq.price, cur) + '</div><div class="ch ' + cls(lq.rate) + '">' + pct(lq.rate) + '</div>'
            : '<div class="ch">—</div>') + '</div>' +
        '</div>';
      }).join('') +
      '<div class="ac-foot"><span>전체 ' + QT.Search.items.length.toLocaleString('ko-KR') + '종목 검색</span>' +
        '<span><span class="kbd">↑↓</span> 이동 <span class="kbd">Enter</span> 선택</span></div>';
    }
    box.hidden = false; state.ac.open = true;
    $('#q').setAttribute('aria-expanded', 'true');
  }
  function closeAC(){ $('#ac').hidden = true; state.ac.open = false; $('#q').setAttribute('aria-expanded', 'false'); }
  function moveAC(delta){
    const items = state.ac.items; if (!items.length) return;
    state.ac.sel = (state.ac.sel + delta + items.length) % items.length;
    $$('#ac .ac-item').forEach(function (el, i) { el.classList.toggle('sel', i === state.ac.sel); });
    const sel = $('#ac .ac-item.sel'); if (sel) sel.scrollIntoView({ block:'nearest' });
  }
  function pickAC(code){
    closeAC();
    $('#q').value = ''; state.q = '';
    select(code);
  }

  /* ---------------- 시세 헤더 ---------------- */
  function renderQuote(){
    const st = M.BY_CODE[state.code], snap = M.snapshot(state.code);
    if (!snap) return;
    $('#q-name').textContent = st.name;
    $('#q-code').textContent = st.code + (st.en ? ' · ' + st.en : '');
    $('#q-market').textContent = st.market;
    const sector = $('#q-sector');
    sector.textContent = st.sector || (st.type === 'etf' ? 'ETF' : st.cur === 'USD' ? '미국 주식' : '국내 주식');
    const src = $('#q-src');
    src.textContent = snap.real ? '실제 일봉' : '시뮬레이션 경로';
    src.dataset.kind = snap.real ? 'real' : 'sim';
    src.title = snap.real
      ? '네이버 금융 / Yahoo Finance 에서 수집한 실제 일봉입니다.'
      : '최근 종가는 실제 값이며, 과거 경로는 시뮬레이션입니다.';

    const p = $('#q-price'), d = $('#q-delta'), fx = $('#q-fx');
    p.textContent = price(snap.price, st.cur);
    p.className = 'now num ' + cls(snap.rate);
    const krw = krwOf(snap.price, st.cur);
    if (krw){
      fx.hidden = false;
      fx.textContent = krw + '  ·  $1 = ' + Math.round(FX.rate).toLocaleString('ko-KR') + '원' + (FX.stale ? ' (캐시)' : '');
      fx.title = 'ID 환율 출처: ' + FX.source + (FX.quotedAt ? ' · 기준 ' + FX.quotedAt : '');
    } else fx.hidden = true;
    d.className = 'dt num ' + cls(snap.rate);
    d.innerHTML = '<i data-lucide="' + (snap.rate > 0 ? 'trending-up' : snap.rate < 0 ? 'trending-down' : 'minus') + '"></i>' +
      signed(snap.diff, st.cur) + ' (' + pct(snap.rate) + ')';
    $('#s-open').textContent = price(snap.open, st.cur);
    $('#s-high').textContent = price(snap.high, st.cur);
    $('#s-low').textContent = price(snap.low, st.cur);
    $('#s-vol').textContent = vol(snap.volume);
    const daily = M.daily(state.code).slice(-252);
    let h = -Infinity, l = Infinity;
    daily.forEach(function (b) { if (b.h > h) h = b.h; if (b.l < l) l = b.l; });
    $('#s-52').textContent = price(h, st.cur) + ' · ' + price(l, st.cur);
    icons();
  }

  /* ---------------- 분석 패널 ---------------- */
  function renderAnalysis(){
    const st = M.BY_CODE[state.code], a = analysis;
    $('#g-needle').setAttribute('transform', 'rotate(' + (a.score / 100 * 90).toFixed(1) + ' 132 128)');
    const gs = $('#g-score');
    gs.textContent = '기술적 점수 ' + (a.score > 0 ? '+' : '') + a.score;
    gs.style.color = a.tone === 'bull' ? '#F04438' : a.tone === 'bear' ? '#3B82F6' : '#4E5968';
    const v = $('#verdict');
    v.textContent = a.verdict;
    v.className = 'verdict ' + (a.tone === 'bull' ? 'up' : a.tone === 'bear' ? 'down' : 'flat');
    $('#verdict-why').textContent = '12개 지표 중 매수 ' + a.buy + ' · 매도 ' + a.sell + ' 우세';
    $('#t-buy').textContent = a.buy; $('#t-neut').textContent = a.neutral; $('#t-sell').textContent = a.sell;
    $('#basis').textContent = ({ '1m':'일봉 기준', '5m':'일봉 기준', '1D':'일봉 기준', '1W':'주봉 기준', '1M':'월봉 기준' })[state.tf];

    const sigs = [];
    const cross = a.maCross;
    sigs.push({
      tone: cross ? (cross.dir > 0 ? 'bull' : 'bear') : (a.align === 'up' ? 'bull' : a.align === 'down' ? 'bear' : 'neut'),
      icon: cross ? (cross.dir > 0 ? 'git-merge' : 'git-pull-request-closed') : 'chart-spline',
      title:'이동평균선 크로스',
      tag: cross ? (cross.dir > 0 ? '골든크로스' : '데드크로스') + ' ' + (cross.ago === 0 ? '당일' : cross.ago + '봉 전') : '교차 없음',
      desc: (a.align === 'up' ? '20 · 50 · 200일선 정배열' : a.align === 'down' ? '20 · 50 · 200일선 역배열' : a.align === 'mixed' ? '이동평균선 혼조 배열' : '데이터 부족') +
        ' · 현재가는 20일선 ' + (a.ma20 != null && a.price >= a.ma20 ? '위' : '아래') + ', 200일선 ' + (a.ma200 != null ? (a.price >= a.ma200 ? '위' : '아래') : '—') + '에 위치합니다.'
    });
    sigs.push({
      tone: a.rsi == null ? 'neut' : a.rsi > 70 ? 'bear' : a.rsi < 30 ? 'bull' : 'neut',
      icon:'gauge', title:'RSI (14)', tag: a.rsi != null ? a.rsi.toFixed(1) : '—',
      desc: a.rsi == null ? '데이터가 충분하지 않습니다.'
        : a.rsi > 70 ? '70을 넘어선 과매수 구간입니다. 단기 조정 가능성을 감안해 분할 접근이 필요합니다.'
        : a.rsi < 30 ? '30 아래 과매도 구간입니다. 기술적 반등 시도가 나타날 수 있는 자리입니다.'
        : '30~70 중립 구간으로 과열·침체 신호는 없습니다.'
    });
    sigs.push({
      tone: (a.macd != null && a.macdSignal != null) ? (a.macd > a.macdSignal ? 'bull' : 'bear') : 'neut',
      icon:'waves', title:'MACD (12, 26, 9)',
      tag: a.macdCross ? (a.macdCross.dir > 0 ? '골든크로스' : '데드크로스') + ' ' + (a.macdCross.ago === 0 ? '당일' : a.macdCross.ago + '봉 전') : '교차 없음',
      desc: a.macd == null ? '데이터가 충분하지 않습니다.'
        : 'MACD ' + a.macd.toFixed(2) + ' / 시그널 ' + a.macdSignal.toFixed(2) + ' · 히스토그램 ' + (a.macdHist >= 0 ? '+' : '') + a.macdHist.toFixed(2) +
          ' — 시그널선 ' + (a.macd > a.macdSignal ? '위에서 상승 모멘텀 우위' : '아래에서 하락 모멘텀 우위') + '입니다.'
    });
    sigs.push({
      tone: a.bbPos == null ? 'neut' : a.bbPos > 95 ? 'bear' : a.bbPos < 5 ? 'bull' : 'neut',
      icon:'move-vertical', title:'볼린저 밴드 (20, 2)', tag: a.bbPos != null ? a.bbPos.toFixed(0) + '%' : '—',
      desc: a.bbPos == null ? '데이터가 충분하지 않습니다.'
        : '상단 ' + price(a.bbUp, st.cur) + ' · 하단 ' + price(a.bbLow, st.cur) + ' · 밴드폭 ' + a.bbWidth.toFixed(1) + '%' +
          (a.bbPos > 95 ? ' — 상단 밀착으로 과열 신호' : a.bbPos < 5 ? ' — 하단 밀착으로 낙폭 과대' : ' — 밴드 중심권에서 등락 중')
    });
    $('#signals').innerHTML = sigs.map(function (s) {
      return '<div class="sig ' + s.tone + '"><div class="ic"><i data-lucide="' + s.icon + '"></i></div>' +
        '<div class="tx"><b>' + s.title + '<em>' + s.tag + '</em></b><p>' + s.desc + '</p></div></div>';
    }).join('');

    const pv = a.pivot;
    const levels = [{ k:'R2', v:pv.R2 }, { k:'R1', v:pv.R1 }, { k:'P', v:pv.P }, { k:'S1', v:pv.S1 }, { k:'S2', v:pv.S2 }];
    let maxd = 0;
    levels.forEach(function (l) { l.d = (l.v - a.price) / a.price * 100; maxd = Math.max(maxd, Math.abs(l.d)); });
    const nearest = levels.reduce(function (m, l) { return Math.abs(l.d) < Math.abs(m.d) ? l : m; }, levels[0]);
    $('#levels').innerHTML = levels.map(function (l) {
      const w = maxd ? Math.abs(l.d) / maxd * 48 : 0, c = l.d >= 0 ? '#F04438' : '#3B82F6';
      const bar = l.d >= 0 ? '<i style="left:50%;width:' + w + '%;background:' + c + '"></i>' : '<i style="right:50%;width:' + w + '%;background:' + c + '"></i>';
      const tagStyle = l.k === 'P' ? 'background:#F3F4F6;color:#4E5968' : (l.d >= 0 ? 'background:#FEF0EF;color:#F04438' : 'background:#EEF4FF;color:#3B82F6');
      return '<div class="lv' + (l === nearest ? ' now' : '') + '">' +
        '<span class="tag" style="' + tagStyle + '">' + l.k + '</span><span class="track">' + bar + '</span>' +
        '<span class="vx">' + price(l.v, st.cur) + '</span><span class="pc ' + cls(l.d) + '">' + pct(l.d) + '</span></div>';
    }).join('');

    const f = a.forecast;
    const dirWord = function (d) { return d === 'up' ? '상승 우위' : d === 'down' ? '하락 우위' : '중립 · 횡보'; };
    const dirIcon = function (d) { return d === 'up' ? 'trending-up' : d === 'down' ? 'trending-down' : 'move-horizontal'; };
    const dirCls = function (d) { return d === 'up' ? 'up' : d === 'down' ? 'down' : 'flat'; };
    $('#forecast').innerHTML =
      '<div class="fc"><div class="hd"><span class="term">단기</span>1~2주 전망' +
        '<span class="dirn ' + dirCls(f.shortDir) + '"><i data-lucide="' + dirIcon(f.shortDir) + '"></i>' + dirWord(f.shortDir) + '</span></div>' +
        '<p>' + f.shortText + '</p>' +
        '<div class="band"><i data-lucide="move-horizontal"></i>예상 등락 범위 <b>' + price(f.shortLow, st.cur) + ' ~ ' + price(f.shortHigh, st.cur) + '</b></div></div>' +
      '<div class="fc"><div class="hd"><span class="term">중기</span>1~3개월 전망' +
        '<span class="dirn ' + dirCls(f.midDir) + '"><i data-lucide="' + dirIcon(f.midDir) + '"></i>' + dirWord(f.midDir) + '</span></div>' +
        '<p>' + f.midText + '</p>' +
        '<div class="band"><i data-lucide="move-horizontal"></i>예상 등락 범위 <b>' + price(f.midLow, st.cur) + ' ~ ' + price(f.midHigh, st.cur) + '</b></div></div>' +
      '<div class="targets">' +
        '<div class="tg buy"><span><i data-lucide="target"></i>1차 목표가</span><b>' + price(f.target1, st.cur) + '</b>' +
          '<small>' + pct(f.target1Pct) + ' · 2차 ' + price(f.target2, st.cur) + '</small></div>' +
        '<div class="tg stop"><span><i data-lucide="shield"></i>손절가</span><b>' + price(f.stop, st.cur) + '</b>' +
          '<small>' + pct(f.stopPct) + ' · ATR ' + a.atrPct.toFixed(1) + '%</small></div></div>' +
      '<div class="rr"><span>손익비 (1차 목표 기준)</span><b>' + (f.rr != null ? '1 : ' + f.rr.toFixed(2) : '—') + '</b></div>';
    $('#fc-updated').textContent = hhmmss(Date.now()).slice(0, 5) + ' 갱신';
    icons();
  }

  /* ---------------- 일정 패널 ---------------- */
  const EV_ICON = { earnings:'file-text', filing:'file-check', dividend:'coins', 'dividend-past':'coins',
                    split:'split', meeting:'users', macro:'landmark', expiry:'alarm-clock' };
  function evHtml(e){
    const d = new Date(e.t), soon = e.t - Date.now() < 7 * 86400000 && !e.past;
    return '<div class="tl' + (e.past ? ' past' : soon ? ' soon' : '') + '" data-kind="' + e.kind + '">' +
      '<div class="when"><div class="dd">' + EV.dday(e.t) + '</div><div class="md">' + (d.getMonth() + 1) + '/' + d.getDate() + '</div></div>' +
      '<div class="body"><b><span class="ic"><i data-lucide="' + (EV_ICON[e.kind] || 'calendar') + '"></i></span>' + e.title +
        '<span class="status-chip" data-s="' + e.status + '">' + e.status + '</span></b>' +
        '<p>' + EV.fmtDate(e.t) + ' · ' + e.detail + '</p></div></div>';
  }
  function renderEvents(){
    const st = M.BY_CODE[state.code];
    $('#ev-symbol').textContent = st.name;
    const mine = EV.forSymbol(st, 6);
    const con = EV.consensus(st.code);
    $('#ev-symbol-list').innerHTML =
      (con ? '<div class="consensus"><i data-lucide="users-round"></i><span>애널리스트 컨센서스 목표주가 <b>' + con.target + '원</b>' +
        (con.recomm ? ' · 투자의견 <b>' + con.recomm + '</b>/5' : '') + (con.asOf ? ' <span style="color:var(--faint)">(' + con.asOf + ')</span>' : '') + '</span></div>' : '') +
      (mine.length ? mine.map(evHtml).join('') : '<div class="empty">표시할 일정이 없습니다.</div>');
    $('#ev-market-list').innerHTML = EV.market(8).map(evHtml).join('') || '<div class="empty">일정 데이터를 불러오지 못했습니다.</div>';
    const meta = M.meta();
    $('#ev-note').innerHTML = 'FOMC 일정과 미국 배당 이력은 공시·거래소 데이터(확정)이며, 실적 발표일·주주총회·배당락일은 ' +
      '과거 패턴으로 추정한 <b>예상</b> 일정입니다. 정확한 일정은 각 기업 IR 공시를 확인해 주세요.' +
      (meta.events ? '<br>일정 데이터 수집 시각 ' + meta.events.slice(0, 10) : '');
    icons();
  }

  /* ---------------- 로드 · 렌더 ---------------- */
  function computeAnalysis(){
    ind = QT.Indicators.set(bars);
    const analysisBars = (state.tf === '1W' || state.tf === '1M') ? bars : M.daily(state.code);
    analysis = A.run(analysisBars, M.BY_CODE[state.code]);
  }
  function showNoData(on){
    $('#no-data').hidden = !on;
    $('.chart-stack').hidden = on;
    $('#legend').hidden = on;
    $('#panel-analysis').style.opacity = on ? '.45' : '';
    $('#panel-analysis').style.pointerEvents = on ? 'none' : '';
  }
  function loadSymbol(resetView){
    const st = M.BY_CODE[state.code];
    if (!M.hasData(state.code)){
      showNoData(true);
      $('#q-name').textContent = st.name;
      $('#q-code').textContent = st.code + (st.en ? ' · ' + st.en : '');
      $('#q-market').textContent = st.market;
      $('#q-sector').textContent = st.cur === 'USD' ? '미국 주식' : '국내 주식';
      $('#q-src').textContent = '시세 미수집'; $('#q-src').dataset.kind = 'sim';
      $('#q-price').textContent = '—'; $('#q-price').className = 'now num flat';
      $('#q-fx').hidden = true;
      $('#q-delta').textContent = '—'; $('#q-delta').className = 'dt num flat';
      ['#s-open','#s-high','#s-low','#s-vol','#s-52'].forEach(function (id) { $(id).textContent = '—'; });
      if (state.panel === 'events') renderEvents();
      return;
    }
    showNoData(false);
    bars = M.series(state.code, state.tf);
    computeAnalysis();
    paintChart(resetView);
    renderLegend(null);
    renderQuote();
    renderAnalysis();
    if (state.panel === 'events') renderEvents();
  }
  function refreshLive(){
    if (!M.hasData(state.code)) return;
    bars = M.series(state.code, state.tf);
    computeAnalysis();
    pushLastBar();
    const i = bars.length - 1, t = sec(bars[i].t);
    if (state.ind.ma){
      if (ind.sma20[i] != null) chart.series.ma20.update({ time:t, value:ind.sma20[i] });
      if (ind.sma50[i] != null) chart.series.ma50.update({ time:t, value:ind.sma50[i] });
      if (ind.sma200[i] != null) chart.series.ma200.update({ time:t, value:ind.sma200[i] });
    }
    if (state.ind.bb){
      if (ind.bbUp[i] != null) chart.series.bbUp.update({ time:t, value:ind.bbUp[i] });
      if (ind.bbLow[i] != null) chart.series.bbLow.update({ time:t, value:ind.bbLow[i] });
    }
    if (ind.rsi[i] != null) chart.series.rsi.update({ time:t, value:ind.rsi[i] });
    if (ind.macd[i] != null) chart.series.macdLine.update({ time:t, value:ind.macd[i] });
    if (ind.macdSignal[i] != null) chart.series.macdSignal.update({ time:t, value:ind.macdSignal[i] });
    if (ind.macdHist[i] != null) chart.series.macdHist.update({ time:t, value:ind.macdHist[i], color: ind.macdHist[i] >= 0 ? COLORS.upFill : COLORS.downFill });
    renderLegend(null);
    renderQuote();
    renderAnalysis();
  }
  function select(code){
    if (!M.BY_CODE[code]) return;
    state.code = code;
    renderList(); loadSymbol(true); subscribeAll();
    if (window.innerWidth <= 900) closeDrawer();
  }

  /* ---------------- 이벤트 ---------------- */
  $('#wl').addEventListener('click', function (e) {
    const star = e.target.closest('[data-star]');
    if (star){
      e.stopPropagation();
      const code = star.dataset.star, at = state.watchlist.indexOf(code);
      if (at >= 0) state.watchlist.splice(at, 1); else state.watchlist.push(code);
      saveWL(); renderList(); subscribeAll();
      return;
    }
    const row = e.target.closest('.wl-row');
    if (row) select(row.dataset.code);
  });
  const qEl = $('#q');
  qEl.addEventListener('input', function (e) { state.q = e.target.value; renderAC(); });
  qEl.addEventListener('focus', function () { if (state.q) renderAC(); });
  qEl.addEventListener('keydown', function (e) {
    if (!state.ac.open){
      if (e.key === 'ArrowDown' && state.q) renderAC();
      return;
    }
    if (e.key === 'ArrowDown'){ e.preventDefault(); moveAC(1); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); moveAC(-1); }
    else if (e.key === 'Enter'){
      const it = state.ac.items[state.ac.sel];
      if (it){ e.preventDefault(); pickAC(it.code); }
    } else if (e.key === 'Escape'){ closeAC(); }
  });
  $('#ac').addEventListener('mousedown', function (e) {
    const it = e.target.closest('.ac-item');
    if (it){ e.preventDefault(); pickAC(it.dataset.code); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.search')) closeAC();
  });

  $('#tabs').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab;
    $$('#tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    renderList();
  });
  $('#mkt').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    state.mkt = b.dataset.mkt;
    $$('#mkt button').forEach(function (x) { x.classList.toggle('on', x === b); });
    renderList();
  });
  $('#side-tabs').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    state.panel = b.dataset.panel;
    $$('#side-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    $('#panel-analysis').hidden = state.panel !== 'analysis';
    $('#panel-events').hidden = state.panel !== 'events';
    if (state.panel === 'events') renderEvents();
  });
  $('#tf-seg').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    state.tf = b.dataset.tf;
    $$('#tf-seg button').forEach(function (x) { x.classList.toggle('on', x === b); });
    loadSymbol(true);
  });
  $('#ind-seg').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.ind;
    state.ind[k] = !state.ind[k];
    b.classList.toggle('on', state.ind[k]);
    paintChart(false); renderLegend(null);
  });

  function openDrawer(){ $('#side').classList.add('open'); $('#scrim').classList.add('show'); }
  function closeDrawer(){ $('#side').classList.remove('open'); $('#scrim').classList.remove('show'); }
  $('#menu-btn').addEventListener('click', function () { $('#side').classList.contains('open') ? closeDrawer() : openDrawer(); });
  $('#scrim').addEventListener('click', closeDrawer);

  /* ---------------- 연결 설정 ---------------- */
  function openModal(){
    const c = QT.Feed.getConfig();
    $('#f-provider').value = c.provider;
    const p = c.provider === 'kis' ? c.kis : c.toss;
    $('#f-proxy').value = p.proxyBase || '';
    $('#f-token').value = (c.provider === 'kis' ? c.kis.approvalKey : c.toss.token) || '';
    $('#f-ws').value = p.wsUrl || '';
    $('#modal').classList.add('show');
  }
  function closeModal(){ $('#modal').classList.remove('show'); }
  $('#settings-btn').addEventListener('click', openModal);
  $('#connect-btn').addEventListener('click', openModal);
  $('#m-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', function (e) { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  $('#m-save').addEventListener('click', function () {
    const provider = $('#f-provider').value;
    const proxy = $('#f-proxy').value.trim(), token = $('#f-token').value.trim(), ws = $('#f-ws').value.trim();
    QT.Feed.applyConfig(provider === 'kis'
      ? { provider:provider, kis:{ proxyBase:proxy, approvalKey:token, wsUrl:ws } }
      : { provider:provider, toss:{ proxyBase:proxy, token:token, wsUrl:ws } });
    closeModal();
  });

  /* ---------------- 피드 ---------------- */
  function subscribeAll(){
    const codes = state.watchlist.slice();
    if (codes.indexOf(state.code) < 0) codes.push(state.code);
    QT.Feed.subscribe(codes);
  }
  const FEED_TEXT = { live:'실시간 수신 중', mock:'모의 시세', connecting:'연결 중', error:'연결 실패' };
  QT.Feed.on('status', function (s) {
    const pill = $('#feed-pill'), tag = $('#live-tag');
    pill.dataset.mode = s.mode;
    $('#feed-text').textContent = s.mode === 'live' ? '실시간' : FEED_TEXT[s.mode] || s.mode;
    pill.title = s.reason || '';
    tag.dataset.mode = s.mode;
    $('#live-tag-text').textContent = FEED_TEXT[s.mode] || s.mode;
    tag.title = s.reason || '';
    $('#acct-state').textContent = s.mode === 'live' ? '실시간 연결됨' : s.mode === 'mock' ? '모의 데이터 모드' : (s.reason || '연결 중');
    $('#acct-source').textContent = s.source || '—';
    $('#connect-btn').innerHTML = s.mode === 'live' ? '<i data-lucide="settings-2"></i>연결 설정 변경' : '<i data-lucide="plug-zap"></i>실시간 시세 연결';
    icons();
  });

  let dirty = false, lastPanel = 0;
  QT.Feed.on('tick', function (t) { if (t.code === state.code) dirty = true; });
  setInterval(function () {
    if (document.hidden) return;
    const now = Date.now();
    refreshRowPrices();
    if (dirty && now - lastPanel > 1000){ dirty = false; lastPanel = now; refreshLive(); }
    const at = QT.Feed.lastTickAt;
    $('#live-tag-time').textContent = at ? hhmmss(at) : '--:--:--';
    const ago = at ? Math.round((now - at) / 1000) : null;
    $('#acct-latency').textContent = ago == null ? '—' : (ago < 2 ? '방금 전' : ago + '초 전');
  }, 700);

  /* ---------------- 시작 ---------------- */
  function boot(){
    icons();
    buildCharts();
    $('#wl').innerHTML = '<div class="loading">종목 데이터를 불러오는 중…</div>';
    M.init().then(function (meta) {
      QT.Search.build(M.UNIVERSE.map(function (s) {
        return { c:s.code, n:s.name, e:s.en, m:s.market, t:s.type, cur:s.cur };
      }));
      if (!M.BY_CODE[state.code]) state.code = M.UNIVERSE[0].code;
      FX.onChange(function () {
        renderQuote();
        refreshRowPrices();
      }).init();
      renderList();
      loadSymbol(true);
      subscribeAll();
      QT.Feed.start();
      /* 일봉·일정은 뒤늦게 도착 — 도착 시 현재 종목을 다시 그린다 */
      M.onLate(function (kind) {
        if (kind === 'history'){ renderList(); loadSymbol(true); }
        else if (kind === 'events' && state.panel === 'events') renderEvents();
        const m = M.meta();
        if (m.real) console.info('[QT] 실제 일봉 ' + m.real + '종목 로드');
      });
      const src = meta.source === 'bundle'
        ? meta.count.toLocaleString('ko-KR') + '종목 · 실제 일봉 ' + meta.real + '종목'
        : '오프라인 시드 데이터';
      $('#acct-universe') && ($('#acct-universe').textContent = src);
      console.info('[QT] 데이터셋', meta);
    }).catch(function (e) {
      console.error(e);
      $('#wl').innerHTML = '<div class="empty">데이터를 불러오지 못했습니다.<br>새로고침해 주세요.</div>';
    });
  }
  boot();
})(window.QT);

/* =============================================================
   app.js — 화면 조립 (사이드바 · 차트 · 분석 패널)
   ============================================================= */
(function (QT) {
  'use strict';
  const M = QT.Market, A = QT.Analysis, LWC = window.LightweightCharts;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- 포맷 ---------------- */
  function price(v, cur){
    if (v == null || !isFinite(v)) return '—';
    return cur === 'USD' ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR');
  }
  function signed(v, cur){
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + price(Math.abs(v), cur);
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

  /* ---------------- 상태 ---------------- */
  const WL_KEY = 'qt.watchlist.v1';
  const DEFAULT_WL = ['005930','000660','373220','035420','005380','196170','NVDA','AAPL'];
  const state = {
    code: '005930',
    tf: '1D',
    tab: 'watch',
    q: '',
    watchlist: (function () {
      try { const s = JSON.parse(localStorage.getItem(WL_KEY)); if (Array.isArray(s) && s.length) return s; } catch (e) {}
      return DEFAULT_WL.slice();
    })(),
    ind: { ma:true, bb:false, rsi:true, macd:true }
  };
  function saveWL(){ try { localStorage.setItem(WL_KEY, JSON.stringify(state.watchlist)); } catch (e) {} }

  /* ---------------- 차트 ---------------- */
  const COLORS = {
    up:'#F04438', down:'#3B82F6', upFill:'rgba(240,68,56,.32)', downFill:'rgba(59,130,246,.32)',
    ma20:'#3182F6', ma50:'#12B76A', ma200:'#7A5AF8', bb:'#B0B8C1',
    rsi:'#F59E0B', macd:'#3182F6', macdSig:'#F04438', grid:'#F3F4F6', text:'#8B95A1'
  };
  const baseOptions = function (h) {
    return {
      height: h,
      layout: { background:{ type:'solid', color:'#FFFFFF' }, textColor:COLORS.text, fontFamily:"'Gothic A1',-apple-system,sans-serif", fontSize:11 },
      grid: { vertLines:{ color:COLORS.grid }, horzLines:{ color:COLORS.grid } },
      rightPriceScale: { borderVisible:false, scaleMargins:{ top:0.12, bottom:0.06 } },
      timeScale: { borderVisible:false, timeVisible:true, secondsVisible:false, rightOffset:3, minBarSpacing:1.5 },
      crosshair: {
        mode: LWC ? LWC.CrosshairMode.Normal : 0,
        vertLine:{ color:'#B0B8C1', width:1, style:2, labelBackgroundColor:'#191F28' },
        horzLine:{ color:'#B0B8C1', width:1, style:2, labelBackgroundColor:'#191F28' }
      },
      handleScale: { axisPressedMouseMove:{ time:true, price:false } },
      localization: { locale:'ko-KR' }
    };
  };

  const chart = { price:null, rsi:null, macd:null, series:{}, ready:false };
  let syncing = false, timeIndex = new Map(), bars = [], ind = null, analysis = null;

  function priceFormatter(cur){
    return function (v) { return cur === 'USD' ? v.toFixed(2) : Math.round(v).toLocaleString('ko-KR'); };
  }

  function buildCharts(){
    if (!LWC){
      $('.chart-stack').innerHTML = '<div class="lib-fallback">차트 라이브러리를 불러오지 못했습니다.<br>네트워크 연결을 확인한 뒤 새로고침해 주세요.<br><span class="code">lightweight-charts@4.2.3 · jsDelivr</span></div>';
      return;
    }
    chart.price = LWC.createChart($('#pane-price'), baseOptions($('#pane-price').clientHeight));
    chart.rsi = LWC.createChart($('#pane-rsi'), Object.assign(baseOptions($('#pane-rsi').clientHeight), {
      layout:{ background:{ type:'solid', color:'#FFFFFF' }, textColor:COLORS.text, fontFamily:"'Gothic A1',-apple-system,sans-serif", fontSize:11, attributionLogo:false },
      rightPriceScale:{ borderVisible:false, scaleMargins:{ top:0.08, bottom:0.08 } },
      timeScale:{ visible:false, borderVisible:false }
    }));
    chart.macd = LWC.createChart($('#pane-macd'), Object.assign(baseOptions($('#pane-macd').clientHeight), {
      layout:{ background:{ type:'solid', color:'#FFFFFF' }, textColor:COLORS.text, fontFamily:"'Gothic A1',-apple-system,sans-serif", fontSize:11, attributionLogo:false },
      rightPriceScale:{ borderVisible:false, scaleMargins:{ top:0.18, bottom:0.18 } }
    }));

    chart.series.candle = chart.price.addCandlestickSeries({
      upColor:COLORS.up, downColor:COLORS.down, borderVisible:false,
      wickUpColor:COLORS.up, wickDownColor:COLORS.down
    });
    chart.series.volume = chart.price.addHistogramSeries({ priceFormat:{ type:'volume' }, priceScaleId:'vol', lastValueVisible:false, priceLineVisible:false });
    chart.price.priceScale('vol').applyOptions({ scaleMargins:{ top:0.84, bottom:0 } });

    chart.series.ma20 = chart.price.addLineSeries({ color:COLORS.ma20, lineWidth:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    chart.series.ma50 = chart.price.addLineSeries({ color:COLORS.ma50, lineWidth:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    chart.series.ma200 = chart.price.addLineSeries({ color:COLORS.ma200, lineWidth:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    chart.series.bbUp = chart.price.addLineSeries({ color:COLORS.bb, lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    chart.series.bbLow = chart.price.addLineSeries({ color:COLORS.bb, lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });

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

    /* 시간축 동기화 */
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

    /* 휠은 페이지 스크롤 우선 — 확대/축소는 Ctrl(⌘) + 휠 */
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

  function lineData(arr, from){
    const out = [];
    for (let i = from || 0; i < bars.length; i++) if (arr[i] != null) out.push({ time: sec(bars[i].t), value: arr[i] });
    return out;
  }

  function paintChart(resetView){
    if (!chart.ready) return;
    const st = M.BY_CODE[state.code];
    const fmt = { type:'price', precision: st.cur === 'USD' ? 2 : 0, minMove: st.cur === 'USD' ? 0.01 : 1 };
    chart.series.candle.applyOptions({ priceFormat: fmt });
    chart.price.applyOptions({ localization:{ locale:'ko-KR', priceFormatter: priceFormatter(st.cur) } });

    timeIndex = new Map();
    bars.forEach(function (b, i) { timeIndex.set(sec(b.t), i); });

    chart.series.candle.setData(bars.map(function (b) {
      return { time: sec(b.t), open:b.o, high:b.h, low:b.l, close:b.c };
    }));
    chart.series.volume.setData(bars.map(function (b) {
      return { time: sec(b.t), value:b.v, color: b.c >= b.o ? COLORS.upFill : COLORS.downFill };
    }));
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
      if (v != null) acc.push({ time: sec(b.t), value:v, color: v >= 0 ? COLORS.upFill : COLORS.downFill });
      return acc;
    }, []));

    const showTime = state.tf === '1m' || state.tf === '5m';
    const stack = [{ c:chart.price, on:true }, { c:chart.rsi, on:state.ind.rsi }, { c:chart.macd, on:state.ind.macd }];
    const bottom = stack.filter(function (x) { return x.on; }).pop();
    stack.forEach(function (x) {
      x.c.applyOptions({ timeScale:{ visible: x === bottom, timeVisible:showTime, secondsVisible:false } });
    });

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
  function renderLegend(time){
    if (!bars.length) return;
    const st = M.BY_CODE[state.code];
    let i = bars.length - 1;
    if (time != null && timeIndex.has(time)) i = timeIndex.get(time);
    const b = bars[i], prev = bars[i - 1] || b;
    const ch = (b.c - prev.c) / prev.c * 100;
    const parts = [
      '<span><span class="k">' + labelOf(b.t) + '</span></span>',
      '<span><span class="k">시</span>' + price(b.o, st.cur) + '</span>',
      '<span class="up"><span class="k">고</span>' + price(b.h, st.cur) + '</span>',
      '<span class="down"><span class="k">저</span>' + price(b.l, st.cur) + '</span>',
      '<span class="' + cls(b.c - b.o) + '"><span class="k">종</span>' + price(b.c, st.cur) + '</span>',
      '<span class="' + cls(ch) + '">' + pct(ch) + '</span>',
      '<span><span class="k">거래량</span>' + vol(b.v) + '</span>'
    ];
    if (state.ind.ma){
      if (ind.sma20[i] != null) parts.push('<span style="color:' + COLORS.ma20 + '"><span class="k">MA20</span>' + price(ind.sma20[i], st.cur) + '</span>');
      if (ind.sma50[i] != null) parts.push('<span style="color:' + COLORS.ma50 + '"><span class="k">MA50</span>' + price(ind.sma50[i], st.cur) + '</span>');
      if (ind.sma200[i] != null) parts.push('<span style="color:' + COLORS.ma200 + '"><span class="k">MA200</span>' + price(ind.sma200[i], st.cur) + '</span>');
    }
    $('#legend').innerHTML = parts.join('');
    if (ind.rsi[i] != null) $('#tag-rsi').innerHTML = 'RSI (14) <em>' + ind.rsi[i].toFixed(1) + '</em>';
    if (ind.macd[i] != null) $('#tag-macd').innerHTML = 'MACD (12, 26, 9) <em>' + ind.macd[i].toFixed(2) + ' / ' + (ind.macdSignal[i] != null ? ind.macdSignal[i].toFixed(2) : '—') + '</em>';
  }
  function labelOf(t){
    const d = new Date(t), p = function (n) { return n < 10 ? '0' + n : '' + n; };
    const ymd = d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
    return (state.tf === '1m' || state.tf === '5m') ? ymd + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : ymd;
  }

  /* ---------------- 사이드바 ---------------- */
  function sparkline(values, up){
    if (!values || values.length < 2) return '';
    let min = Infinity, max = -Infinity;
    values.forEach(function (v) { if (v < min) min = v; if (v > max) max = v; });
    const w = 56, h = 26, pad = 3, span = (max - min) || 1;
    const pts = values.map(function (v, i) {
      const x = (i / (values.length - 1)) * w;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const color = up ? '#F04438' : '#3B82F6';
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/></svg>';
  }

  function listRows(){
    const q = state.q.trim().toLowerCase();
    let pool = state.tab === 'watch'
      ? state.watchlist.map(function (c) { return M.BY_CODE[c]; }).filter(Boolean)
      : M.UNIVERSE.slice();
    if (q) pool = pool.filter(function (s) {
      return s.name.toLowerCase().indexOf(q) >= 0 || s.en.toLowerCase().indexOf(q) >= 0 || s.code.toLowerCase().indexOf(q) >= 0;
    });
    return pool;
  }
  function renderList(){
    const el = $('#wl'), pool = listRows();
    if (!pool.length){
      el.innerHTML = '<div class="empty">' + (state.tab === 'watch'
        ? '관심종목이 비어 있습니다.<br>전체종목 탭에서 별을 눌러 추가하세요.'
        : '검색 결과가 없습니다.') + '</div>';
      return;
    }
    el.innerHTML = pool.map(function (s) {
      const snap = M.snapshot(s.code), on = state.watchlist.indexOf(s.code) >= 0;
      return '<div class="wl-row' + (s.code === state.code ? ' on' : '') + '" data-code="' + s.code + '">' +
        '<div><div class="nm">' + s.name + '</div><div class="mk"><span class="code">' + s.code + '</span>' +
          sparkline(snap.spark, snap.rate >= 0) + '</div></div>' +
        '<div><div class="px num" data-f="px">' + price(snap.price, s.cur) + '</div>' +
          '<div class="ch num ' + cls(snap.rate) + '" data-f="ch">' + pct(snap.rate) + '</div></div>' +
        '<button class="star' + (on ? ' on' : '') + '" data-star="' + s.code + '" aria-label="관심종목 ' + (on ? '해제' : '추가') + '">' +
          '<i data-lucide="star"></i></button>' +
      '</div>';
    }).join('');
    icons();
    $('#acct-count').textContent = state.watchlist.length + ' 종목';
  }
  function refreshRowPrices(){
    $$('#wl .wl-row').forEach(function (row) {
      const code = row.dataset.code, s = M.BY_CODE[code];
      if (!s) return;
      const snap = M.snapshot(code);
      const px = row.querySelector('[data-f="px"]'), ch = row.querySelector('[data-f="ch"]');
      if (px) px.textContent = price(snap.price, s.cur);
      if (ch){ ch.textContent = pct(snap.rate); ch.className = 'ch num ' + cls(snap.rate); }
    });
  }

  /* ---------------- 시세 헤더 ---------------- */
  function renderQuote(){
    const st = M.BY_CODE[state.code], snap = M.snapshot(state.code);
    $('#q-name').textContent = st.name;
    $('#q-code').textContent = st.code + ' · ' + st.en;
    $('#q-market').textContent = st.market;
    $('#q-sector').textContent = st.sector;
    const p = $('#q-price'), d = $('#q-delta');
    p.textContent = price(snap.price, st.cur);
    p.className = 'now num ' + cls(snap.rate);
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

    /* 핵심 지표 리포트 */
    const sigs = [];
    const cross = a.maCross;
    sigs.push({
      tone: cross ? (cross.dir > 0 ? 'bull' : 'bear') : (a.align === 'up' ? 'bull' : a.align === 'down' ? 'bear' : 'neut'),
      icon: cross ? (cross.dir > 0 ? 'git-merge' : 'git-pull-request-closed') : 'chart-spline',
      title: '이동평균선 크로스',
      tag: cross ? (cross.dir > 0 ? '골든크로스' : '데드크로스') + ' ' + (cross.ago === 0 ? '당일' : cross.ago + '봉 전') : '교차 없음',
      desc: (a.align === 'up' ? '20 · 50 · 200일선 정배열' : a.align === 'down' ? '20 · 50 · 200일선 역배열' : a.align === 'mixed' ? '이동평균선 혼조 배열' : '데이터 부족') +
        ' · 현재가는 20일선 ' + (a.ma20 != null && a.price >= a.ma20 ? '위' : '아래') + ', 200일선 ' + (a.ma200 != null ? (a.price >= a.ma200 ? '위' : '아래') : '—') + '에 위치합니다.'
    });
    sigs.push({
      tone: a.rsi == null ? 'neut' : a.rsi > 70 ? 'bear' : a.rsi < 30 ? 'bull' : 'neut',
      icon: 'gauge',
      title: 'RSI (14)',
      tag: a.rsi != null ? a.rsi.toFixed(1) : '—',
      desc: a.rsi == null ? '데이터가 충분하지 않습니다.'
        : a.rsi > 70 ? '70을 넘어선 과매수 구간입니다. 단기 조정 가능성을 감안해 분할 접근이 필요합니다.'
        : a.rsi < 30 ? '30 아래 과매도 구간입니다. 기술적 반등 시도가 나타날 수 있는 자리입니다.'
        : '30~70 중립 구간으로 과열·침체 신호는 없습니다.'
    });
    sigs.push({
      tone: (a.macd != null && a.macdSignal != null) ? (a.macd > a.macdSignal ? 'bull' : 'bear') : 'neut',
      icon: 'waves',
      title: 'MACD (12, 26, 9)',
      tag: a.macdCross ? (a.macdCross.dir > 0 ? '골든크로스' : '데드크로스') + ' ' + (a.macdCross.ago === 0 ? '당일' : a.macdCross.ago + '봉 전') : '교차 없음',
      desc: a.macd == null ? '데이터가 충분하지 않습니다.'
        : 'MACD ' + a.macd.toFixed(2) + ' / 시그널 ' + a.macdSignal.toFixed(2) + ' · 히스토그램 ' + (a.macdHist >= 0 ? '+' : '') + a.macdHist.toFixed(2) +
          ' — 시그널선 ' + (a.macd > a.macdSignal ? '위에서 상승 모멘텀 우위' : '아래에서 하락 모멘텀 우위') + '입니다.'
    });
    sigs.push({
      tone: a.bbPos == null ? 'neut' : a.bbPos > 95 ? 'bear' : a.bbPos < 5 ? 'bull' : 'neut',
      icon: 'move-vertical',
      title: '볼린저 밴드 (20, 2)',
      tag: a.bbPos != null ? a.bbPos.toFixed(0) + '%' : '—',
      desc: a.bbPos == null ? '데이터가 충분하지 않습니다.'
        : '상단 ' + price(a.bbUp, st.cur) + ' · 하단 ' + price(a.bbLow, st.cur) + ' · 밴드폭 ' + a.bbWidth.toFixed(1) + '%' +
          (a.bbPos > 95 ? ' — 상단 밀착으로 과열 신호' : a.bbPos < 5 ? ' — 하단 밀착으로 낙폭 과대' : ' — 밴드 중심권에서 등락 중')
    });
    $('#signals').innerHTML = sigs.map(function (s) {
      return '<div class="sig ' + s.tone + '"><div class="ic"><i data-lucide="' + s.icon + '"></i></div>' +
        '<div class="tx"><b>' + s.title + '<em>' + s.tag + '</em></b><p>' + s.desc + '</p></div></div>';
    }).join('');

    /* 지지 · 저항 */
    const pv = a.pivot, levels = [
      { k:'R2', v:pv.R2 }, { k:'R1', v:pv.R1 }, { k:'P', v:pv.P }, { k:'S1', v:pv.S1 }, { k:'S2', v:pv.S2 }
    ];
    let maxd = 0;
    levels.forEach(function (l) { l.d = (l.v - a.price) / a.price * 100; maxd = Math.max(maxd, Math.abs(l.d)); });
    const nearest = levels.reduce(function (m, l) { return Math.abs(l.d) < Math.abs(m.d) ? l : m; }, levels[0]);
    $('#levels').innerHTML = levels.map(function (l) {
      const w = maxd ? Math.abs(l.d) / maxd * 48 : 0;
      const c = l.d >= 0 ? '#F04438' : '#3B82F6';
      const bar = l.d >= 0 ? '<i style="left:50%;width:' + w + '%;background:' + c + '"></i>'
                           : '<i style="right:50%;width:' + w + '%;background:' + c + '"></i>';
      const tagStyle = l.k === 'P' ? 'background:#F3F4F6;color:#4E5968' : (l.d >= 0 ? 'background:#FEF0EF;color:#F04438' : 'background:#EEF4FF;color:#3B82F6');
      return '<div class="lv' + (l === nearest ? ' now' : '') + '">' +
        '<span class="tag" style="' + tagStyle + '">' + l.k + '</span>' +
        '<span class="track">' + bar + '</span>' +
        '<span class="vx">' + price(l.v, st.cur) + '</span>' +
        '<span class="pc ' + cls(l.d) + '">' + pct(l.d) + '</span></div>';
    }).join('');

    /* AI 전망 */
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
          '<small>' + pct(f.stopPct) + ' · ATR ' + a.atrPct.toFixed(1) + '%</small></div>' +
      '</div>' +
      '<div class="rr"><span>손익비 (1차 목표 기준)</span><b>' + (f.rr != null ? '1 : ' + f.rr.toFixed(2) : '—') + '</b></div>';
    $('#fc-updated').textContent = new Date().toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' }) + ' 갱신';
    icons();
  }

  /* ---------------- 데이터 로드 ---------------- */
  function loadSymbol(resetView){
    bars = M.series(state.code, state.tf);
    ind = QT.Indicators.set(bars);
    const analysisBars = (state.tf === '1W' || state.tf === '1M') ? bars : M.daily(state.code);
    analysis = A.run(analysisBars, M.BY_CODE[state.code]);
    paintChart(resetView);
    renderLegend(null);
    renderQuote();
    renderAnalysis();
  }
  function refreshLive(){
    bars = M.series(state.code, state.tf);
    ind = QT.Indicators.set(bars);
    const analysisBars = (state.tf === '1W' || state.tf === '1M') ? bars : M.daily(state.code);
    analysis = A.run(analysisBars, M.BY_CODE[state.code]);
    pushLastBar();
    if (state.ind.ma){
      const i = bars.length - 1, t = sec(bars[i].t);
      if (ind.sma20[i] != null) chart.series.ma20.update({ time:t, value:ind.sma20[i] });
      if (ind.sma50[i] != null) chart.series.ma50.update({ time:t, value:ind.sma50[i] });
      if (ind.sma200[i] != null) chart.series.ma200.update({ time:t, value:ind.sma200[i] });
    }
    if (state.ind.bb){
      const i = bars.length - 1, t = sec(bars[i].t);
      if (ind.bbUp[i] != null) chart.series.bbUp.update({ time:t, value:ind.bbUp[i] });
      if (ind.bbLow[i] != null) chart.series.bbLow.update({ time:t, value:ind.bbLow[i] });
    }
    const i = bars.length - 1, t = sec(bars[i].t);
    if (ind.rsi[i] != null) chart.series.rsi.update({ time:t, value:ind.rsi[i] });
    if (ind.macd[i] != null) chart.series.macdLine.update({ time:t, value:ind.macd[i] });
    if (ind.macdSignal[i] != null) chart.series.macdSignal.update({ time:t, value:ind.macdSignal[i] });
    if (ind.macdHist[i] != null) chart.series.macdHist.update({ time:t, value:ind.macdHist[i], color: ind.macdHist[i] >= 0 ? COLORS.upFill : COLORS.downFill });
    renderLegend(null);
    renderQuote();
    renderAnalysis();
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
    if (!row) return;
    state.code = row.dataset.code;
    renderList(); loadSymbol(true); subscribeAll();
    if (window.innerWidth <= 900) closeDrawer();
  });
  $('#q').addEventListener('input', function (e) {
    state.q = e.target.value;
    if (state.q && state.tab === 'watch'){ state.tab = 'all'; syncTabs(); }
    renderList();
  });
  $('#tabs').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab; syncTabs(); renderList();
  });
  function syncTabs(){ $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === state.tab); }); }

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
    paintChart(false);
    renderLegend(null);
  });

  function openDrawer(){ $('#side').classList.add('open'); $('#scrim').classList.add('show'); }
  function closeDrawer(){ $('#side').classList.remove('open'); $('#scrim').classList.remove('show'); }
  $('#menu-btn').addEventListener('click', function () { $('#side').classList.contains('open') ? closeDrawer() : openDrawer(); });
  $('#scrim').addEventListener('click', closeDrawer);

  /* ---------------- 연결 설정 모달 ---------------- */
  function openModal(){
    const c = QT.Feed.getConfig();
    $('#f-provider').value = c.provider;
    $('#f-proxy').value = c.toss.proxyBase || '';
    $('#f-token').value = c.toss.token || '';
    $('#f-ws').value = c.toss.wsUrl || '';
    $('#modal').classList.add('show');
  }
  function closeModal(){ $('#modal').classList.remove('show'); }
  $('#settings-btn').addEventListener('click', openModal);
  $('#connect-btn').addEventListener('click', openModal);
  $('#m-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', function (e) { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  $('#m-save').addEventListener('click', function () {
    QT.Feed.applyConfig({
      provider: $('#f-provider').value,
      toss: {
        proxyBase: $('#f-proxy').value.trim(),
        token: $('#f-token').value.trim(),
        wsUrl: $('#f-ws').value.trim()
      }
    });
    closeModal();
  });

  /* ---------------- 피드 연결 ---------------- */
  function subscribeAll(){
    const codes = state.watchlist.slice();
    if (codes.indexOf(state.code) < 0) codes.push(state.code);
    QT.Feed.subscribe(codes);
  }
  const FEED_TEXT = { live:'실시간', mock:'모의 시세', connecting:'연결 중', error:'연결 실패' };
  QT.Feed.on('status', function (s) {
    const pill = $('#feed-pill');
    pill.dataset.mode = s.mode;
    $('#feed-text').textContent = FEED_TEXT[s.mode] || s.mode;
    pill.title = s.reason || '';
    $('#acct-state').textContent = s.mode === 'live' ? '실시간 연결됨' : s.mode === 'mock' ? '모의 데이터 모드' : (s.reason || '연결 중');
    $('#acct-source').textContent = s.source || '—';
    $('#connect-btn').innerHTML = s.mode === 'live'
      ? '<i data-lucide="settings-2"></i>연결 설정 변경'
      : '<i data-lucide="plug-zap"></i>토스증권 API 연결';
    icons();
  });

  let dirty = false, lastPanel = 0;
  QT.Feed.on('tick', function (t) {
    if (t.code === state.code) dirty = true;
  });
  setInterval(function () {
    if (document.hidden) return;
    refreshRowPrices();
    const now = Date.now();
    if (dirty && now - lastPanel > 1000){ dirty = false; lastPanel = now; refreshLive(); }
    const ago = QT.Feed.lastTickAt ? Math.round((now - QT.Feed.lastTickAt) / 1000) : null;
    $('#acct-latency').textContent = ago == null ? '—' : (ago < 2 ? '방금 전' : ago + '초 전');
  }, 700);

  /* ---------------- 시작 ---------------- */
  icons();
  buildCharts();
  syncTabs();
  renderList();
  loadSymbol(true);
  subscribeAll();
  QT.Feed.start();
})(window.QT);

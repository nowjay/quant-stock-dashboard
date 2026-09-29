/* =============================================================
   app.js — 화면 조립 (사이드바 · 차트 · AI 분석 · 글로벌 매크로)
   ============================================================= */
(function (QT) {
  'use strict';
  const M = QT.Market, A = QT.Analysis, FX = QT.FX, EV = QT.Events, NEWS = QT.News, LWC = window.LightweightCharts;
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
  function pct1(v){ return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%'; }
  /** 외부(뉴스 피드) 텍스트 이스케이프 */
  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
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
  const WL_KEY = 'qt.watchlist.v2', VIEW_KEY = 'qt.view.v1';
  const DEFAULT_WL = ['005930','000660','373220','035420','005380','196170','NVDA','AAPL'];
  const state = {
    code: '005930', tf:'1D', tab:'watch', mkt:'ALL', q:'', panel:'analysis',
    view: (function () { try { return localStorage.getItem(VIEW_KEY) === 'stock' ? 'stock' : 'home'; } catch (e) { return 'home'; } })(),
    mcCat:'', mcMore:false, earnMore:false, newsCat:'',
    watchlist: (function () {
      try { const s = JSON.parse(localStorage.getItem(WL_KEY)); if (Array.isArray(s) && s.length) return s; } catch (e) {}
      return DEFAULT_WL.slice();
    })(),
    ind: { ma:true, bb:false, rsi:true, macd:true, tgt:true, sig:true },
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
      rightPriceScale:{ borderVisible:false, minimumWidth:76, scaleMargins:{ top:0.12, bottom:0.06 } },
      timeScale:{ borderVisible:false, timeVisible:true, secondsVisible:false, rightOffset:3, minBarSpacing:1.5 },
      crosshair:{
        mode: LWC ? LWC.CrosshairMode.Normal : 0,
        vertLine:{ color:'#B0B8C1', width:1, style:2, labelBackgroundColor:'#191F28' },
        horzLine:{ color:'#B0B8C1', width:1, style:2, labelBackgroundColor:'#191F28' }
      },
      /* 휠 확대는 직접 처리(onWheel) — 평소엔 페이지 스크롤을 막지 않고, ⌘/Ctrl·핀치·전체화면에서만 확대 */
      handleScroll:{ mouseWheel:false, pressedMouseMove:true, horzTouchDrag:true, vertTouchDrag:false },
      handleScale:{ mouseWheel:false, pinch:true, axisPressedMouseMove:{ time:true, price:true }, axisDoubleClickReset:{ time:true, price:true } },
      localization:{ locale:'ko-KR' }
    };
  }
  const chart = { price:null, rsi:null, macd:null, series:{}, ready:false };
  let tgtLines = [], tgtKey = null, tgtRange = null, markKey = null;
  /* 종목별 백테스트 결과 (종목 · 마지막 일봉 날짜가 같으면 재사용) */
  let bt = { key:null, sig:null, tgt:null, pending:false };
  let syncing = false, timeIndex = new Map(), bars = [], ind = null, analysis = null;

  function buildCharts(){
    if (!LWC){
      chart.failed = true;
      $('.chart-stack').innerHTML = '<div class="lib-fallback">차트 라이브러리를 불러오지 못했습니다.<br>네트워크 확인 후 새로고침해 주세요.</div>';
      return;
    }
    chart.price = LWC.createChart($('#pane-price'), baseOptions($('#pane-price').clientHeight));
    chart.rsi = LWC.createChart($('#pane-rsi'), Object.assign(baseOptions($('#pane-rsi').clientHeight), {
      layout: Object.assign({}, LAYOUT, { attributionLogo:false }),
      rightPriceScale:{ borderVisible:false, minimumWidth:76, scaleMargins:{ top:0.08, bottom:0.08 } },
      timeScale:{ visible:false, borderVisible:false }
    }));
    chart.macd = LWC.createChart($('#pane-macd'), Object.assign(baseOptions($('#pane-macd').clientHeight), {
      layout: Object.assign({}, LAYOUT, { attributionLogo:false }),
      rightPriceScale:{ borderVisible:false, minimumWidth:76, scaleMargins:{ top:0.18, bottom:0.18 } }
    }));

    chart.series.candle = chart.price.addCandlestickSeries({
      upColor:COLORS.up, downColor:COLORS.down, borderVisible:false, wickUpColor:COLORS.up, wickDownColor:COLORS.down,
      /* 목표·손절 표시 중에는 단기 목표가/손절가가 화면 안에 들어오도록 축을 넓힌다 */
      autoscaleInfoProvider: function (orig) {
        const r = orig();
        if (!r || !r.priceRange || !tgtRange) return r;
        r.priceRange.minValue = Math.min(r.priceRange.minValue, tgtRange.min);
        r.priceRange.maxValue = Math.max(r.priceRange.maxValue, tgtRange.max);
        return r;
      }
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
      $('#pane-' + k).addEventListener('wheel', onWheel, { passive:false });
    });
    chart.price.timeScale().subscribeVisibleLogicalRangeChange(zoomLabel);
    const ro = new ResizeObserver(resizeCharts);
    ['price','rsi','macd'].forEach(function (k) { ro.observe($('#pane-' + k)); });
  }
  function resizeCharts(){
    if (!chart.ready) return;
    ['price','rsi','macd'].forEach(function (k) {
      const el = $('#pane-' + k);
      if (el && chart[k] && el.clientWidth) chart[k].applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
  }

  /* ---------------- 차트 확대 · 축소 · 전체화면 ---------------- */
  const SPAN = { '1m':180, '5m':160, '1D':140, '1W':120, '1M':84 };
  const MIN_BARS = 12;
  let pendingReset = false, pendingRange = null, rangeSeq = 0;
  /* 기본 보기: 시간대별 기본 봉 수 + 가격축 자동 맞춤 */
  function defaultRange(){
    if (!chart.ready || !bars.length) return;
    if (state.view !== 'stock'){ pendingReset = true; return; }   // 숨겨진 차트는 폭이 0이라 보일 때 다시 맞춘다
    const span = SPAN[state.tf] || 140;
    const to = bars.length + 2, from = Math.max(0, bars.length - span);
    pendingRange = null; rangeSeq++;
    syncing = true;
    [chart.price, chart.rsi, chart.macd].forEach(function (c) {
      c.timeScale().setVisibleLogicalRange({ from:from, to:to });
      c.priceScale('right').applyOptions({ autoScale:true });
    });
    syncing = false;
    zoomLabel();
  }
  /* 차트는 보이는 범위를 다음 프레임에 반영하므로, 한 프레임에 휠 · 핀치 이벤트가 여러 번 오면
     직전에 요청한 범위를 기준으로 이어서 계산해야 확대가 끊기지 않는다 */
  function currentRange(){ return pendingRange || (chart.ready && chart.price.timeScale().getVisibleLogicalRange()); }
  function applyRange(from, to){
    const id = ++rangeSeq;
    pendingRange = { from:from, to:to };
    chart.price.timeScale().setVisibleLogicalRange(pendingRange);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (id === rangeSeq) pendingRange = null; }); });
  }
  function plotWidth(){ return Math.max(1, $('#pane-price').clientWidth - chart.price.priceScale('right').width()); }
  /* factor < 1 확대, > 1 축소. anchorX(px)가 있으면 그 지점을 고정, 없으면 최신 봉(오른쪽 끝) 기준 */
  function zoomBy(factor, anchorX){
    if (!chart.ready || !bars.length) return;
    const r = currentRange();
    if (!r) return;
    const span = r.to - r.from;
    const next = Math.max(MIN_BARS, Math.min(bars.length + 40, span * factor));
    if (Math.abs(next - span) < 0.01) return;
    const anchor = anchorX != null ? r.from + Math.max(0, Math.min(1, anchorX / plotWidth())) * span
      : r.to >= bars.length - 1 ? r.to : (r.from + r.to) / 2;
    const from = anchor - (anchor - r.from) / span * next;
    applyRange(from, from + next);
  }
  function panBy(px){
    if (!chart.ready) return;
    const r = currentRange();
    if (!r) return;
    const d = (r.to - r.from) * px / plotWidth();
    applyRange(r.from + d, r.to + d);
  }
  function onWheel(e){
    if (!chart.ready) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    /* ⌘/Ctrl + 휠, 트랙패드 핀치(ctrlKey), 전체화면의 휠 → 커서 위치 기준 확대 · 축소 */
    if (e.ctrlKey || e.metaKey || (isFs() && !horizontal && !e.shiftKey)){
      e.preventDefault();
      const dy = Math.max(-240, Math.min(240, e.deltaY * unit));
      zoomBy(Math.exp(dy * 0.0024), e.clientX - e.currentTarget.getBoundingClientRect().left);
      return;
    }
    /* 트랙패드 좌우 스와이프 · Shift + 휠 → 과거/최근으로 이동. 세로 휠은 페이지 스크롤 */
    if (horizontal || e.shiftKey){
      e.preventDefault();
      panBy((horizontal ? e.deltaX : e.deltaY) * unit);
    }
  }
  function zoomLabel(){
    const r = chart.ready && chart.price.timeScale().getVisibleLogicalRange();
    const el = $('#zoom-lvl');
    if (!el || !r || !bars.length) return;
    const n = Math.max(0, Math.min(bars.length - 1, Math.floor(r.to)) - Math.max(0, Math.ceil(r.from)) + 1);
    el.textContent = n + '봉';
  }
  function isFs(){ return $('#chart-card').classList.contains('fs'); }
  function setFs(on){
    const card = $('#chart-card');
    if (on === isFs() || (on && !chart.ready)) return;
    card.classList.toggle('fs', on);
    document.body.classList.toggle('fs-lock', on);
    if (on){
      /* 브라우저 전체화면 — 지원하지 않으면(아이폰 사파리 등) 화면을 가득 채우는 모드로만 동작 */
      if (card.requestFullscreen && !document.fullscreenElement) card.requestFullscreen().catch(function () {});
    } else if (document.fullscreenElement){
      document.exitFullscreen().catch(function () {});
    }
    const btn = $('#fs-btn');
    btn.innerHTML = on ? '<i data-lucide="minimize"></i><span>닫기</span>' : '<i data-lucide="maximize"></i><span>전체화면</span>';
    btn.setAttribute('aria-label', on ? '전체화면 닫기' : '차트 전체화면');
    btn.title = on ? '전체화면 닫기 (Esc)' : '전체화면 (F)';
    $('#zoom-hint').textContent = on ? '휠 확대 · 드래그 이동 · +/− · 0 초기화 · Esc 닫기' : '⌘/Ctrl + 휠 · 핀치 확대 · 축 드래그 배율';
    [chart.price, chart.rsi, chart.macd].forEach(function (c) { c.applyOptions({ handleScroll:{ vertTouchDrag:on } }); });
    icons();
    resizeCharts();
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

    if (resetView) defaultRange();
    $('#pane-rsi').style.display = state.ind.rsi ? '' : 'none';
    $('#pane-macd').style.display = state.ind.macd ? '' : 'none';
    tgtKey = null; markKey = null;
    paintTargetLines();
    paintMarkers();
  }
  /* 차트 위 기술적 신호 마커 (골든/데드크로스 · 다이버전스 · 캔들 · 돌파) — 일·주·월봉 */
  const MARK_TEXT = { cross:'크로스', div:'다이버전스', candle:'캔들', break:'돌파', volume:'거래량', macd:'MACD' };
  function paintMarkers(){
    if (!chart.ready) return;
    const on = state.ind.sig && ind && (state.tf === '1D' || state.tf === '1W' || state.tf === '1M');
    const evs = on ? QT.Patterns.detect(bars, ind, 150).filter(function (e) { return e.weight >= 2; }) : [];
    const key = evs.map(function (e) { return e.i + e.kind + e.dir; }).join(',') + '|' + state.code + state.tf;
    if (key === markKey) return;
    markKey = key;
    chart.series.candle.setMarkers(evs.slice().sort(function (a, b) { return a.t - b.t; }).map(function (e) {
      const txt = e.kind === 'break' ? (e.dir > 0 ? '돌파' : '이탈') : e.kind === 'cross' ? (e.dir > 0 ? '골든' : '데드') : MARK_TEXT[e.kind];
      return { time:sec(e.t), position: e.dir < 0 ? 'aboveBar' : 'belowBar', shape: e.dir > 0 ? 'arrowUp' : e.dir < 0 ? 'arrowDown' : 'circle',
               color: e.dir > 0 ? COLORS.up : e.dir < 0 ? COLORS.down : '#8B95A1', text:txt };
    }));
  }
  /* 차트 위 목표가(단기·중장기 Base) · 단기 손절가 가이드선 */
  function paintTargetLines(){
    if (!chart.ready) return;
    const t = analysis && analysis.targets;
    const on = state.ind.tgt && t;
    const key = on ? [t.short.base.v, t.mid.base.v, t.short.stop.v].join('|') : '';
    if (key === tgtKey) return;
    tgtKey = key;
    tgtLines.forEach(function (l) { chart.series.candle.removePriceLine(l); });
    tgtLines = [];
    const daily = state.tf === '1D' || state.tf === '1W' || state.tf === '1M';
    tgtRange = on && daily ? { min:t.short.stop.v, max:t.short.base.v } : null;
    if (!on) return;
    [[t.short.base.v, COLORS.up, '단기 목표'], [t.mid.base.v, '#F97066', '중장기 목표'], [t.short.stop.v, COLORS.down, '손절']].forEach(function (d) {
      tgtLines.push(chart.series.candle.createPriceLine({ price:d[0], color:d[1], lineWidth:1, lineStyle:2, axisLabelVisible:true, title:d[2] }));
    });
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
    $('#acct-count').textContent = state.watchlist.length + ' 종목';
    if (QT.Screener && QT.Screener.cfg.on){ QT.Screener.render(el, state.tab, state.mkt, state.watchlist); return; }
    let pool, withSpark;
    if (state.tab === 'watch'){
      pool = state.watchlist.map(function (c) { return M.BY_CODE[c]; }).filter(Boolean);
      withSpark = true;
    } else {
      withSpark = false;
      pool = M.UNIVERSE.filter(function (s) {
        if (state.mkt === 'ALL') return true;
        if (state.mkt === 'US') return s.cur === 'USD';
        if (state.mkt === 'ETF') return s.type === 'etf';
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
  /* 차트 데이터 출처 배지 — 공공데이터(금융위원회) · 토스증권 · 번들 · 시뮬레이션 */
  function sourceInfo(code, snap){
    const kx = M.krxMeta(), rs = M.realSource(code);
    if (state.tf === '1m' || state.tf === '5m'){
      return M.minuteSource(code) === 'toss'
        ? { text:'토스 실제 분봉', real:true, title:'토스증권 Open API 1분봉 + 실시간 체결입니다.' }
        : { text:'분봉 시뮬레이션', real:false, title:'일봉에서 만든 가상의 분봉입니다. 토스증권을 연결하면 실제 1분봉으로 바뀝니다.' };
    }
    const asOf = kx ? kx.basDt : '';
    if (rs === 'krx') return { text:'공공데이터 일봉', real:true,
      title:'공공데이터포털 금융위원회_주식시세정보 (' + asOf + ' 기준 · 수정주가). 전 영업일 시세가 다음 날 오후 1시 이후 갱신됩니다.' };
    if (rs === 'krx+toss') return { text:'공공데이터 + 토스 실시간', real:true,
      title:'과거 일봉은 공공데이터포털 금융위원회_주식시세정보(' + asOf + '까지), 그 이후 거래일과 실시간 체결은 토스증권 Open API 입니다.' };
    if (rs === 'toss') return { text:'토스증권 일봉', real:true, title:'토스증권 Open API 에서 방금 받은 실제 일봉입니다.' };
    if (snap && snap.real) return { text:'실제 일봉', real:true, title:'네이버 금융 / Yahoo Finance 에서 수집한 실제 일봉입니다.' };
    return { text:'시뮬레이션 경로', real:false, title:'최근 종가는 실제 값이며, 과거 경로는 시뮬레이션입니다.' };
  }
  function renderQuote(){
    const st = M.BY_CODE[state.code], snap = M.snapshot(state.code);
    if (!snap) return;
    $('#q-name').textContent = st.name;
    $('#q-code').textContent = st.code + (st.en ? ' · ' + st.en : '');
    $('#q-market').textContent = st.market;
    const sector = $('#q-sector');
    sector.textContent = st.sector || (st.type === 'etf' ? 'ETF' : st.cur === 'USD' ? '미국 주식' : '국내 주식');
    const src = $('#q-src'), info = sourceInfo(state.code, snap);
    src.textContent = info.text;
    src.dataset.kind = info.real ? 'real' : 'sim';
    src.title = info.title;
    if (feedMode() === 'static') $('#live-tag-time').textContent = lastBarDay();

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

  /* ---------------- 용어 설명 (? 버튼) ---------------- */
  const GLOSS = {
    score:'종합 점수: 추세 · 모멘텀 · 거래량 지표를 −100~+100으로 합산합니다. 추세가 뚜렷할 때(ADX 높음)는 추세 지표 비중을, 횡보장에서는 과매수·과매도 지표 비중을 높입니다.',
    rsi:'RSI(상대강도지수): 최근 14일 상승폭과 하락폭의 비율(0~100). 70 이상 과매수, 30 이하 과매도. 강한 상승 추세에서는 70 이상이 오래 이어지기도 합니다.',
    macd:'MACD: 12일과 26일 지수이동평균의 차이. 시그널선(9일 평균)을 위로 뚫으면 상승 힘이 붙는 것, 아래로 뚫으면 힘이 빠지는 것으로 봅니다.',
    bb:'볼린저 밴드: 20일 평균 ± 표준편차×2. 주가의 약 95%가 밴드 안에서 움직이며, 밴드가 좁아지면 곧 큰 움직임이 나올 가능성이 큽니다.',
    adx:'ADX: 추세의 "세기"(0~100). 25 이상이면 추세가 뚜렷하고 20 이하면 횡보입니다. 방향은 +DI(상승 힘)와 −DI(하락 힘) 중 큰 쪽으로 판단합니다.',
    mfi:'MFI(자금흐름지수): 거래량까지 반영한 RSI. 80 이상은 돈이 과하게 몰린 과열, 20 이하는 빠져나간 침체로 봅니다.',
    obv:'OBV: 오른 날의 거래량은 더하고 내린 날은 빼서 누적한 값. 주가보다 먼저 방향을 바꾸는 경우가 많아 수급 확인에 씁니다.',
    ma:'이동평균선: 최근 N일 종가의 평균. 20일(약 한 달)·50일·200일(약 1년)선이 짧은 것부터 위에 놓이면 정배열(상승 추세)입니다.',
    stoch:'스토캐스틱: 최근 14일 가격 범위에서 현재가가 어디쯤인지(0~100). 80 이상 과열, 20 이하 침체.',
    cross:'골든크로스: 짧은 이동평균이 긴 이동평균을 위로 뚫는 것(상승 신호). 반대로 아래로 뚫으면 데드크로스입니다.',
    div:'다이버전스: 주가와 지표가 반대로 움직이는 현상. 추세가 힘을 잃고 있다는 경고로 자주 쓰입니다.',
    pivot:'피봇: 전날 고가·저가·종가로 계산한 오늘의 저항(R)·지지(S) 기준선입니다.',
    mtf:'시간대별 비교: 같은 종목을 일봉·주봉·월봉으로 따로 분석합니다. 세 시간대가 같은 방향이면 추세의 신뢰도가 높습니다.',
    bt:'백테스트: 같은 계산을 이 종목의 과거 날짜마다 적용해, 비슷한 신호 뒤 실제 주가가 어떻게 움직였는지 집계한 값입니다. 과거 성과가 미래를 보장하지는 않습니다.',
    fng:'공포 & 탐욕 지수(CNN): 미국 증시의 투자 심리를 0~100으로 나타냅니다. 25 미만 극심한 공포 · 45 미만 공포 · 55 이하 중립 · 75 이하 탐욕 · 그 이상 극심한 탐욕. 극단적인 공포는 저가 매수 기회, 극단적인 탐욕은 과열 경고로 보는 역발상 지표로도 씁니다.',
    krs:'국장 심리지수(QUANT 자체 계산): 코스피 125일선 괴리 · 52주 위치 · RSI · 20일 변동성 · 원/달러 20일 변화 · 코스닥 상대강도를 최근 1년 분포 대비 백분위(0~100)로 바꿔 평균했습니다. 단계 기준은 CNN 지수와 같습니다(25 · 45 · 55 · 75).',
    signal:'종합 매수 신호: 기술 점수(이동평균선 방향 · RSI · MACD · 피봇 저항 돌파, 각 25점)와 재무 점수(업종 대비 PER · PBR, ROE 10% 이상, 영업이익 전년 대비 증가, 각 25점)를 반씩 합친 0~100점입니다. 80점 이상 강력 매수 · 65~79 매수 · 45~64 중립 · 30~44 매도 · 30 미만 강력 매도. 재무 건전성이 낮으면 재무 점수에서 최대 10점을 뺍니다.',
    per:'PER(주가수익비율): 주가 ÷ 최근 4분기 주당순이익. 이익 대비 몇 배에 거래되는지를 뜻하며, 같은 업종 평균보다 낮으면 상대적으로 싸다고 봅니다.',
    fper:'선행 PER: 주가 ÷ 증권사들이 예상한 올해(회계연도) 주당순이익. 현재 PER보다 낮으면 앞으로 이익이 늘 것으로 기대된다는 뜻입니다.',
    pbr:'PBR(주가순자산비율): 주가 ÷ 주당순자산. 1배 미만이면 회사가 가진 순자산보다 싸게 거래되는 상태입니다. 다만 이익을 못 내는 회사는 계속 싸게 머물 수 있습니다.',
    roe:'ROE(자기자본이익률): 순이익 ÷ 자기자본. 주주 돈으로 1년에 몇 %를 벌었는지로, 10% 이상이면 양호, 15% 이상이면 우수로 봅니다.',
    ev:'EV/EBITDA: 기업가치(시가총액 + 순차입금) ÷ 세금·이자·감가상각 전 영업이익. 회사를 통째로 살 때 현금창출력의 몇 년치인지를 뜻하며, 낮을수록 싸다고 봅니다.',
    dy:'배당수익률: 주당배당금 ÷ 현재가. 주식을 사서 1년간 받는 배당금 비율입니다.',
    peg:'PEG: PER ÷ 이익 성장률(%). 1 미만이면 성장 속도에 비해 주가가 싸다고 봅니다.',
    fcf:'FCF 수익률: 잉여현금흐름(영업현금흐름 − 설비투자) ÷ 시가총액. 회사가 실제로 남긴 현금이 주가 대비 얼마나 되는지입니다.',
    health:'재무 건전성: 부채비율(30) · 이자보상배율(30) · 유보율(20) · 유동비율(20)을 점수화했습니다. 80점 이상 매우 안정 · 65 안정 · 45 보통 · 30 주의 · 그 아래 위험. 금융업은 부채비율 · 이자보상배율을 제외합니다.',
    debt:'부채비율: 부채 ÷ 자기자본. 100% 이하면 안정적, 200%를 넘으면 빚 부담이 큰 편입니다(업종에 따라 다름).',
    icr:'이자보상배율: 영업이익 ÷ 이자비용. 1배 미만이면 영업으로 번 돈으로 이자도 못 내는 상태, 3배 이상이면 안정적입니다.',
    reserve:'유보율: (이익잉여금 + 자본잉여금) ÷ 자본금. 회사가 벌어서 쌓아 둔 돈이 자본금의 몇 배인지로, 높을수록 위기 대응 여력이 큽니다.',
    fair:'적정주가: ① PER 밴드(과거 5년 PER 분포 × 기준 EPS) ② PBR 밴드(과거 PBR 분포 × BPS) ③ S-RIM(자기자본 + 초과이익의 현재가치) ④ DCF(잉여현금흐름 할인)를 가중평균했습니다. 모델이 맞지 않는 경우(예: 적자, 현금흐름 불안정, 자본 대비 이익이 과도)는 제외합니다.'
  };
  function tip(k){ return GLOSS[k] ? '<button type="button" class="tip" aria-label="용어 설명" data-tip="' + GLOSS[k] + '">?</button>' : ''; }
  (function initTips(){
    const box = document.createElement('div');
    box.className = 'tipbox'; box.setAttribute('role', 'tooltip'); box.hidden = true;
    document.body.appendChild(box);
    let owner = null;
    function show(btn){
      owner = btn; box.textContent = btn.dataset.tip; box.hidden = false;
      const r = btn.getBoundingClientRect(), w = Math.min(280, window.innerWidth - 24);
      box.style.width = w + 'px';
      const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
      box.style.left = left + 'px';
      const below = r.bottom + 8, h = box.offsetHeight;
      box.style.top = (below + h > window.innerHeight - 8 ? r.top - h - 8 : below) + 'px';
    }
    function hide(){ owner = null; box.hidden = true; }
    document.addEventListener('click', function (e) {
      const b = e.target.closest('.tip');
      if (b){ e.stopPropagation(); show(b); return; }           // 마우스 오버로 이미 열려 있어도 닫지 않음
      if (!e.target.closest('.tipbox')) hide();
    });
    document.addEventListener('mouseover', function (e) { const b = e.target.closest && e.target.closest('.tip'); if (b && b !== owner) show(b); });
    document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('.tip') && owner) hide(); });
    window.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  })();

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
    const reg = a.regime === 'trend' ? '추세장' : a.regime === 'range' ? '횡보장' : a.regime === 'weak' ? '약한 추세' : '국면 판단 불가';
    $('#verdict-why').innerHTML = '<span class="regime" data-r="' + a.regime + '">' + reg + (a.adx != null ? ' · ADX ' + a.adx.toFixed(0) : '') + '</span>' +
      a.rows.length + '개 지표 중 매수 ' + a.buy + ' · 매도 ' + a.sell + tip('score');
    $('#cats').innerHTML = Object.keys(QT.Scoring.CATS).map(function (k) {
      const v = a.cats[k];
      if (v == null) return '';
      const sc = Math.round(v * 100), w = Math.min(50, Math.abs(sc) / 2);
      return '<div class="cat"><span>' + QT.Scoring.CATS[k] + '</span><span class="bar"><i class="' + (sc >= 0 ? 'pos' : 'neg') + '" style="' +
        (sc >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w + '%"></i></span><b class="num ' + cls(sc) + '">' + (sc > 0 ? '+' : '') + sc + '</b></div>';
    }).join('');
    $('#t-buy').textContent = a.buy; $('#t-neut').textContent = a.neutral; $('#t-sell').textContent = a.sell;
    $('#basis').textContent = ({ '1m':'일봉 기준', '5m':'일봉 기준', '1D':'일봉 기준', '1W':'주봉 기준', '1M':'월봉 기준' })[state.tf];

    const sigs = [];
    const cross = a.maCross;
    sigs.push({
      tone: cross ? (cross.dir > 0 ? 'bull' : 'bear') : (a.align === 'up' ? 'bull' : a.align === 'down' ? 'bear' : 'neut'),
      icon: cross ? (cross.dir > 0 ? 'git-merge' : 'git-pull-request-closed') : 'chart-spline',
      title:'이동평균선 크로스' + tip('ma'),
      tag: cross ? (cross.dir > 0 ? '골든크로스' : '데드크로스') + ' ' + (cross.ago === 0 ? '당일' : cross.ago + '봉 전') : '교차 없음',
      desc: (a.align === 'up' ? '20 · 50 · 200일선 정배열' : a.align === 'down' ? '20 · 50 · 200일선 역배열' : a.align === 'mixed' ? '이동평균선 혼조 배열' : '데이터 부족') +
        ' · 현재가는 20일선 ' + (a.ma20 != null && a.price >= a.ma20 ? '위' : '아래') + ', 200일선 ' + (a.ma200 != null ? (a.price >= a.ma200 ? '위' : '아래') : '—') + '에 위치합니다.'
    });
    sigs.push({
      tone: a.rsi == null ? 'neut' : a.rsi > 70 ? 'bear' : a.rsi < 30 ? 'bull' : 'neut',
      icon:'gauge', title:'RSI (14)' + tip('rsi'), tag: a.rsi != null ? a.rsi.toFixed(1) : '—',
      desc: a.rsi == null ? '데이터가 충분하지 않습니다.'
        : a.rsi > 70 ? '70을 넘어선 과매수 구간입니다. 단기 조정 가능성을 감안해 분할 접근이 필요합니다.'
        : a.rsi < 30 ? '30 아래 과매도 구간입니다. 기술적 반등 시도가 나타날 수 있는 자리입니다.'
        : '30~70 중립 구간으로 과열·침체 신호는 없습니다.'
    });
    sigs.push({
      tone: (a.macd != null && a.macdSignal != null) ? (a.macd > a.macdSignal ? 'bull' : 'bear') : 'neut',
      icon:'waves', title:'MACD (12, 26, 9)' + tip('macd'),
      tag: a.macdCross ? (a.macdCross.dir > 0 ? '골든크로스' : '데드크로스') + ' ' + (a.macdCross.ago === 0 ? '당일' : a.macdCross.ago + '봉 전') : '교차 없음',
      desc: (a.macd == null || a.macdSignal == null || a.macdHist == null) ? '데이터가 충분하지 않습니다.'
        : 'MACD ' + a.macd.toFixed(2) + ' / 시그널 ' + a.macdSignal.toFixed(2) + ' · 히스토그램 ' + (a.macdHist >= 0 ? '+' : '') + a.macdHist.toFixed(2) +
          ' — 시그널선 ' + (a.macd > a.macdSignal ? '위에서 상승 모멘텀 우위' : '아래에서 하락 모멘텀 우위') + '입니다.'
    });
    sigs.push({
      tone: a.bbPos == null ? 'neut' : a.bbPos > 95 ? 'bear' : a.bbPos < 5 ? 'bull' : 'neut',
      icon:'move-vertical', title:'볼린저 밴드 (20, 2)' + tip('bb'), tag: a.bbPos != null ? a.bbPos.toFixed(0) + '%' : '—',
      desc: a.bbPos == null ? '데이터가 충분하지 않습니다.'
        : '상단 ' + price(a.bbUp, st.cur) + ' · 하단 ' + price(a.bbLow, st.cur) + ' · 밴드폭 ' + a.bbWidth.toFixed(1) + '%' +
          (a.bbPos > 95 ? ' — 상단 밀착으로 과열 신호' : a.bbPos < 5 ? ' — 하단 밀착으로 낙폭 과대' : ' — 밴드 중심권에서 등락 중')
    });
    if (a.adx != null){
      const up = a.pdi >= a.mdi;
      sigs.push({
        tone: a.adx < 20 ? 'neut' : up ? 'bull' : 'bear', icon:'compass', title:'ADX · DMI (14)' + tip('adx'),
        tag:'ADX ' + a.adx.toFixed(0) + (a.adx >= 25 ? ' · 강한 추세' : a.adx < 20 ? ' · 횡보' : ' · 약한 추세'),
        desc:(a.adx >= 25 ? '추세가 뚜렷합니다. ' : a.adx < 20 ? '뚜렷한 추세가 없는 횡보 국면으로, 박스권 매매 신호가 더 잘 맞는 구간입니다. ' : '추세가 형성되는 중입니다. ') +
          '+DI ' + a.pdi.toFixed(0) + ' / −DI ' + a.mdi.toFixed(0) + ' — ' + (up ? '상승' : '하락') + ' 쪽 힘이 더 큽니다.'
      });
    }
    const obvC = a.rows.filter(function (r) { return r.key === 'obv'; })[0];
    if (a.mfi != null || obvC){
      const tone = obvC ? (obvC.v > 0.2 ? 'bull' : obvC.v < -0.2 ? 'bear' : 'neut') : 'neut';
      sigs.push({
        tone:tone, icon:'bar-chart-3', title:'수급 (MFI · OBV)' + tip('obv'),
        tag:(a.mfi != null ? 'MFI ' + a.mfi.toFixed(0) : '') + (obvC ? ' · OBV ' + (obvC.v > 0.2 ? '상승' : obvC.v < -0.2 ? '하락' : '보합') : ''),
        desc:(obvC ? (obvC.v > 0.2 ? '최근 20일 동안 오른 날 거래가 더 많아 매수세가 우위입니다. ' : obvC.v < -0.2 ? '최근 20일 동안 내린 날 거래가 더 많아 매도세가 우위입니다. ' : '매수·매도 거래량이 비슷합니다. ') : '') +
          (a.mfi != null ? (a.mfi > 80 ? 'MFI가 80을 넘어 자금 유입이 과열됐습니다.' : a.mfi < 20 ? 'MFI가 20 아래로 자금이 과하게 빠져나갔습니다.' : 'MFI는 과열·침체 없이 정상 범위입니다.') : '')
      });
    }
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

    ensureBacktest(st);
    renderSummary(st, a);
    renderTargets(st, a);
    renderReasons(st, a);
    renderEventList(a);
    renderMTF(st, a);
    $('#tgt-updated').textContent = '일봉 기준 · ' + hhmmss(Date.now()).slice(0, 5) + ' 갱신';
    paintTargetLines();
    paintMarkers();
    if (QT.Value) QT.Value.update(st, a);
    icons();
  }

  /* ---------------- 백테스트 (종목당 1회, 화면을 막지 않도록 지연 실행) ---------------- */
  function ensureBacktest(st){
    const daily = M.daily(st.code);
    if (daily.length < 120) { bt = { key:null, sig:null, tgt:null, pending:false }; return; }
    const d = new Date(daily[daily.length - 1].t);
    const key = st.code + '|' + daily.length + '|' + d.getFullYear() + d.getMonth() + d.getDate();
    if (bt.key === key) return;
    bt = { key:key, sig:null, tgt:null, pending:true };
    setTimeout(function () {
      if (bt.key !== key) return;
      try {
        const bars0 = M.daily(st.code), ind0 = QT.Indicators.set(bars0);
        bt.sig = QT.Backtest.signals(bars0, ind0, 10);
        bt.tgt = QT.Backtest.targets(bars0, st);
      } catch (e) { console.error(e); }
      bt.pending = false;
      if (bt.key === key && analysis && state.code === st.code){ renderSummary(st, analysis); renderTargets(st, analysis); icons(); }
    }, 60);
  }

  /* ---------------- 한눈에 보기 ---------------- */
  function renderSummary(st, a){
    const d = a.daily, t = a.targets, p = d.price;
    const heat = (d.rsi != null && d.rsi > 70) || (d.bbPos != null && d.bbPos > 100) ? 'hot' : (d.rsi != null && d.rsi < 30) ? 'cold' : '';
    const trend = d.align === 'up' ? '중기 상승 추세' : d.align === 'down' ? '중기 하락 추세' : d.align === 'mixed' ? '방향을 탐색하는 혼조 구간' : '추세 판단에 필요한 데이터가 부족한 구간';
    const strength = d.adx == null ? '' : d.adx >= 25 ? '로 추세가 뚜렷하고' : d.adx < 20 ? '이지만 추세 힘은 약하고(횡보)' : '이며 추세가 형성되는 중이고';
    const heatTxt = heat === 'hot' ? ' 단기적으로는 과열 신호가 있습니다.' : heat === 'cold' ? ' 단기적으로는 과매도 구간입니다.' : ' 단기 과열·침체 신호는 없습니다.';
    const head = trend + strength + (strength ? ',' : '') + heatTxt;

    const s1 = t && t.supports[0], base = t && t.short.base, stop = t && t.short.stop;
    let guide = '';
    if (t){
      if (d.score >= 18 && heat !== 'hot') guide = '상승 흐름을 따라가는 구간입니다. ' + (s1 ? '1차 지지선 <b>' + price(s1.v, st.cur) + '</b>을 지키는지 확인하고, ' : '') + '<b>' + price(stop.v, st.cur) + '</b> 아래로 내려가면 손절을 고려하세요.';
      else if (d.score >= 18) guide = '추세는 좋지만 단기 과열입니다. 추격 매수보다 ' + (s1 ? '<b>' + price(s1.v, st.cur) + '</b> 부근까지 ' : '') + '눌림을 기다리는 편이 유리합니다.';
      else if (d.score <= -18) guide = '하락 흐름입니다. 반등이 나와도 <b>' + price(base.v, st.cur) + '</b> 부근은 저항이 될 수 있어, 신규 매수는 추세 전환을 확인한 뒤가 안전합니다.';
      else guide = '방향이 정해지지 않았습니다. <b>' + price(base.v, st.cur) + '</b> 위로 올라서면 상승, ' + (s1 ? '<b>' + price(s1.v, st.cur) + '</b> 아래로 내려가면 하락 신호로 보고 대응하세요.' : '지지선 이탈 시 하락 신호로 보고 대응하세요.');
    }

    const obvC = d.rows.filter(function (r) { return r.key === 'obv'; })[0];
    const checks = [
      [d.ma20 != null && p > d.ma20, '주가가 20일선 위', 'ma'],
      [d.align === 'up', '이평선 정배열 (20 > 50 > 200일)', 'ma'],
      [d.adx != null && d.adx >= 25 && d.pdi > d.mdi, '상승 추세가 뚜렷함 (ADX 25↑)', 'adx'],
      [d.macd != null && d.macdSignal != null && d.macd > d.macdSignal, 'MACD가 시그널선 위', 'macd'],
      [d.rsi != null && d.rsi >= 30 && d.rsi <= 70, 'RSI 과열·침체 아님 (30~70)', 'rsi'],
      [!!obvC && obvC.v > 0, '거래량이 상승을 뒷받침 (OBV↑)', 'obv']
    ];
    const ok = checks.filter(function (c) { return c[0]; }).length;

    let rel;
    if (!M.isReal(st.code)) rel = '<div class="rel caution">과거 가격 경로가 시뮬레이션이라 신호 신뢰도를 계산하지 않았습니다.</div>';
    else if (bt.pending || !bt.sig) rel = '<div class="rel">이 종목의 과거 데이터로 신호 신뢰도를 계산하는 중…</div>';
    else {
      const b = bt.sig, bear = b.cls < 0, n = b.same.n;
      const hit = n ? (bear ? 1 - b.same.win : b.same.win) : null, baseHit = bear ? 1 - b.base.win : b.base.win;
      const diff = hit != null ? (hit - baseHit) * 100 : 0;
      const verdict = b.cls === 0 ? ['neut', '중립 신호는 방향을 예측하는 신호가 아니라 참고용 통계입니다.']
        : n < 10 ? ['neut', '표본이 적어 판단 보류'] : diff >= 5 ? ['good', '이 종목에서 비교적 잘 맞았던 신호'] : diff <= -5 ? ['bad', '이 종목에서는 잘 맞지 않았던 신호 — 참고만 하세요'] : ['neut', '평균 수준의 신뢰도'];
      rel = '<div class="rel ' + verdict[0] + '"><b>신호 신뢰도' + tip('bt') + '</b>' +
        (n ? '최근 약 ' + Math.round(b.base.n / 250 * 12) + '개월간 <b>' + b.label + '</b> 신호 ' + n + '회 → ' + b.horizon + '거래일 뒤 ' +
          (bear ? '하락' : '상승') + ' <b>' + Math.round(hit * 100) + '%</b> · 평균 수익률 <b class="' + cls(b.same.avg) + '">' + pct1(b.same.avg) + '</b>' +
          ' <span class="muted">(같은 기간 아무 날이나 샀을 때 ' + (bear ? '하락' : '상승') + ' 비율 ' + Math.round(baseHit * 100) + '%)</span>'
          : '같은 등급 신호가 과거에 없었습니다.') +
        '<em>' + verdict[1] + '</em></div>';
    }

    $('#summary').innerHTML =
      '<div class="sum-head"><span class="vchip ' + d.tone + '">' + d.verdict + '</span><p>' + head + '</p></div>' +
      (guide ? '<div class="guide"><i data-lucide="navigation"></i><p>' + guide + '</p></div>' : '') +
      '<div class="checks"><div class="checks-hd"><b>체크리스트</b><span>' + ok + ' / ' + checks.length + ' 충족</span></div>' +
        checks.map(function (c) {
          return '<div class="ck ' + (c[0] ? 'on' : 'off') + '"><i data-lucide="' + (c[0] ? 'check' : 'x') + '"></i><span>' + c[1] + '</span>' + tip(c[2]) + '</div>';
        }).join('') + '</div>' + rel +
      '<p class="sum-note">기술적 지표에 기반한 참고 정보이며 투자 권유가 아닙니다.</p>';
  }

  /* ---------------- 최근 기술적 신호 ---------------- */
  const EV_KIND_TIP = { cross:'cross', div:'div', macd:'macd' };
  function renderEventList(a){
    const evs = (a.events || []).slice(0, 8), n = M.daily(state.code).length;
    $('#events').innerHTML = evs.length ? evs.map(function (e) {
      const ago = n - 1 - e.i, d = new Date(e.t);
      return '<div class="evt ' + (e.dir > 0 ? 'bull' : e.dir < 0 ? 'bear' : 'neut') + '">' +
        '<span class="ic"><i data-lucide="' + (e.dir > 0 ? 'arrow-up-right' : e.dir < 0 ? 'arrow-down-right' : 'minus') + '"></i></span>' +
        '<div><b>' + e.title + tip(EV_KIND_TIP[e.kind]) + '</b><small>' + (ago === 0 ? '오늘' : ago + '거래일 전') + ' · ' + (d.getMonth() + 1) + '/' + d.getDate() + '</small>' +
        '<p>' + e.desc + '</p></div></div>';
    }).join('') : '<div class="empty">최근 60거래일 동안 눈에 띄는 기술적 신호가 없습니다.</div>';
  }

  /* ---------------- 시간대별 추세 비교 ---------------- */
  function renderMTF(st, a){
    const rows = [['일봉', a.daily]];
    ['1W', '1M'].forEach(function (tf) {
      const b = M.series(st.code, tf);
      if (b.length >= 15) rows.push([tf === '1W' ? '주봉' : '월봉', A.core(b, st.cur)]);
    });
    const dirOf = function (x) { return x.score >= 18 ? 1 : x.score <= -18 ? -1 : 0; };
    const ups = rows.filter(function (r) { return dirOf(r[1]) > 0; }).length, downs = rows.filter(function (r) { return dirOf(r[1]) < 0; }).length;
    const head = ups === rows.length ? ['bull', rows.length + '개 시간대 모두 상승 우위 — 추세 신뢰도가 높습니다.']
      : downs === rows.length ? ['bear', rows.length + '개 시간대 모두 하락 우위 — 반등이 나와도 짧을 수 있습니다.']
      : !downs && ups ? ['bull', '하락 신호는 없고 ' + rows.length + '개 중 ' + ups + '개 시간대가 상승 우위입니다' + (dirOf(rows[0][1]) === 0 ? ' — 일봉은 숨 고르기 중입니다.' : '.')]
      : !ups && downs ? ['bear', '상승 신호는 없고 ' + rows.length + '개 중 ' + downs + '개 시간대가 하락 우위입니다.']
      : dirOf(rows[0][1]) > 0 && downs ? ['neut', '일봉은 상승이지만 큰 흐름(주·월봉)은 약합니다 — 단기 반등 성격일 수 있습니다.']
      : dirOf(rows[0][1]) < 0 && ups ? ['neut', '일봉은 약하지만 큰 흐름은 상승입니다 — 상승 추세 속 조정일 수 있습니다.']
      : ['neut', '시간대별 방향이 엇갈립니다 — 방향이 정해질 때까지 신중하게 보세요.'];
    $('#mtf').innerHTML = '<p class="mtf-head ' + head[0] + '">' + head[1] + tip('mtf') + '</p>' +
      '<div class="mtf-t"><div class="mtf-r hd"><span>시간대</span><span>이평선</span><span>RSI</span><span>MACD</span><span>의견</span></div>' +
      rows.map(function (r) {
        const x = r[1];
        const al = x.align === 'up' ? ['up', '정배열'] : x.align === 'down' ? ['down', '역배열'] : x.ma20 != null ? (x.price >= x.ma20 ? ['up', '20선 위'] : ['down', '20선 아래']) : ['flat', '—'];
        const macd = x.macd != null && x.macdSignal != null ? (x.macd > x.macdSignal ? ['up', '위'] : ['down', '아래']) : ['flat', '—'];
        return '<div class="mtf-r"><span>' + r[0] + '</span><span class="' + al[0] + '">' + al[1] + '</span>' +
          '<span class="num">' + (x.rsi != null ? x.rsi.toFixed(0) : '—') + '</span><span class="' + macd[0] + '">' + macd[1] + '</span>' +
          '<span><em class="vchip sm ' + x.tone + '">' + x.verdict + '</em></span></div>';
      }).join('') + '</div>';
  }

  /* ---------------- AI 목표주가 ---------------- */
  const SCN = [['bear', '보수적', 'Bear'], ['base', '기본', 'Base'], ['bull', '공격적', 'Bull']];
  function dirWord(d){ return d === 'up' ? '상승 우위' : d === 'down' ? '하락 우위' : '중립 · 횡보'; }
  function dirIcon(d){ return d === 'up' ? 'trending-up' : d === 'down' ? 'trending-down' : 'move-horizontal'; }
  function dirCls(d){ return d === 'up' ? 'up' : d === 'down' ? 'down' : 'flat'; }

  function btLine(which){
    const b = bt.tgt;
    if (bt.pending) return '<div class="bt-line">과거 적중률 계산 중…</div>';
    if (!b || !b.n) return '';
    const few = b.n < 20 ? ' <span class="muted">(표본 ' + b.n + '회로 적음)</span>' : '';
    if (which === 'short') return '<div class="bt-line"><b>과거 적중률' + tip('bt') + '</b>같은 방식의 단기 목표가를 과거 ' + b.n + '개 시점에 적용했더니, 10거래일 안에 Base 도달 <b>' +
      Math.round(b.base * 100) + '%</b> · Bull 도달 <b>' + Math.round(b.bull * 100) + '%</b> · 목표 전 손절선 먼저 <b class="down">' + Math.round(b.stopFirst * 100) + '%</b>' + few + '</div>';
    return b.midBase != null ? '<div class="bt-line"><b>과거 적중률' + tip('bt') + '</b>과거 ' + b.midN + '개 시점 기준, 42거래일(약 2개월) 안에 중장기 Base 도달 <b>' + Math.round(b.midBase * 100) + '%</b>' + (b.midN < 20 ? ' <span class="muted">(표본 적음)</span>' : '') + '</div>' : '';
  }
  function horizonHtml(h, dir, text, st, t){
    const lo = Math.min(h.stop.v, h.bear.v), hi = h.bull.v, span = (hi - lo) || 1;
    const x = function (v) { return Math.max(0, Math.min(100, (v - lo) / span * 100)).toFixed(1); };
    const krw = krwOf(h.base.v, st.cur);
    return '<div class="hz">' +
      '<div class="hz-hd"><span class="term">' + h.horizon.term + '</span><b>' + h.horizon.label + ' 목표가</b>' +
        '<span class="dirn ' + dirCls(dir) + '"><i data-lucide="' + dirIcon(dir) + '"></i>' + dirWord(dir) + '</span></div>' +
      '<div class="hz-main"><span>기본(Base) 목표가</span><b class="num">' + price(h.base.v, st.cur) + '</b>' +
        '<em class="num ' + cls(h.base.pct) + '">' + pct1(h.base.pct) + '</em>' + (krw ? '<small class="num">' + krw + '</small>' : '') + '</div>' +
      '<div class="ladder" aria-hidden="true"><div class="bar">' +
        '<i class="risk" style="left:0;width:' + x(t.price) + '%"></i>' +
        '<i class="gain" style="left:' + x(t.price) + '%;right:0"></i>' +
        '<span class="mk stop" style="left:' + x(h.stop.v) + '%"></span>' +
        '<span class="mk now" style="left:' + x(t.price) + '%"><em>현재</em></span>' +
        SCN.map(function (s) { return '<span class="mk ' + s[0] + '" style="left:' + x(h[s[0]].v) + '%"></span>'; }).join('') +
      '</div><div class="ends"><span class="down">손절 ' + pct1(h.stop.pct) + '</span><span class="up">Bull ' + pct1(h.bull.pct) + '</span></div></div>' +
      '<div class="scn">' + SCN.map(function (s) {
        const v = h[s[0]];
        return '<div class="sc ' + s[0] + '"><span class="nm">' + s[1] + ' <em>' + s[2] + '</em></span>' +
          '<b class="num">' + price(v.v, st.cur) + '</b>' +
          '<span class="upside num ' + cls(v.pct) + '">' + pct1(v.pct) + '</span>' +
          '<small class="basis" title="' + v.basis + '">' + v.basis + '</small>' +
          (v.prob != null ? '<small class="prob" title="변동성(σ√기간) 기준, 추세 미반영">도달확률 ~' + Math.round(v.prob * 100) + '%</small>' : '') +
        '</div>';
      }).join('') + '</div>' +
      btLine(h === t.short ? 'short' : 'mid') +
      '<p class="hz-txt">' + text + '</p>' +
      '<div class="hz-foot"><span><i data-lucide="shield"></i>손절 <b class="num">' + price(h.stop.v, st.cur) + '</b> <em class="down num">' + pct1(h.stop.pct) + '</em></span>' +
        '<span>손익비 <b class="num">' + (h.rr != null ? '1 : ' + h.rr.toFixed(2) : '—') + '</b></span></div>' +
    '</div>';
  }
  function renderTargets(st, a){
    const t = a.targets, f = a.forecast;
    if (!t){ $('#targets').innerHTML = '<div class="empty">일봉 데이터가 부족해 목표주가를 계산할 수 없습니다.</div>'; return; }
    $('#targets').innerHTML =
      horizonHtml(t.short, f.shortDir, f.shortText, st, t) +
      horizonHtml(t.mid, f.midDir, f.midText, st, t) +
      '<div class="tgt-meta"><span>현재가 <b class="num">' + price(t.price, st.cur) + '</b></span>' +
        '<span>일간 변동성 σ <b class="num">' + (t.sigma * 100).toFixed(1) + '%</b></span>' +
        '<span>ATR <b class="num">' + t.atrPct.toFixed(1) + '%</b></span></div>';
  }

  /* 매크로 · 실적 일정과 데이터 품질에서 오는 리스크 */
  function eventRisks(st){
    const out = [], now = Date.now();
    EV.macro({ from:now, to:now + 7 * 86400000 }).filter(function (e) { return e.imp >= 3; }).slice(0, 2).forEach(function (e) {
      out.push({ tone:'caution', html:'<b>' + EV.dday(e.t) + ' ' + e.title + '</b> 발표 예정(' + EV.fmtMD(e.t) + ' ' + EV.fmtTime(e.t) + ') — 발표 전후 변동성 확대에 유의하세요.' });
    });
    EV.earnings({ from:now, to:now + 14 * 86400000 }).filter(function (e) { return e.code === st.code; }).slice(0, 1).forEach(function (e) {
      out.push({ tone:'caution', html:'<b>' + EV.dday(e.t) + ' ' + e.title + '</b>' + (e.status === '예상' ? ' (예상일)' : '') + ' — 실적 발표 전후로 갭 변동이 커질 수 있습니다.' });
    });
    if (!M.isReal(st.code)) out.push({ tone:'caution', html:'이 종목은 과거 가격 경로가 시뮬레이션이라 목표가의 신뢰도가 낮습니다.' });
    return out;
  }
  function renderReasons(st, a){
    const t = a.targets;
    if (!t){ $('#reasons').innerHTML = '<div class="empty">데이터가 부족해 산정 근거를 만들 수 없습니다.</div>'; return; }
    const r = t.reasons, risks = r.risk.concat(eventRisks(st));
    const li = function (x) { return '<li class="' + x.tone + '">' + x.html + '</li>'; };
    const sec = function (no, title, body) { return '<div class="rs-sec"><div class="rs-hd"><span class="no">' + no + '</span>' + title + '</div>' + body + '</div>'; };
    const stop = function (label, h) {
      return '<div class="stp"><span>' + label + '</span><b class="num">' + price(h.stop.v, st.cur) + '</b>' +
        '<em class="down num">' + pct1(h.stop.pct) + '</em><small>' + h.stop.basis + '</small></div>';
    };
    const con = EV.consensus(st.code);
    $('#reasons').innerHTML =
      sec('①', '기술적 분석 이유', '<ul class="rs-list">' + r.tech.map(li).join('') + '</ul>') +
      sec('②', '보조지표 상태', '<div class="osc">' + r.osc.map(function (o) {
        return '<div class="os ' + o.tone + '"><div class="os-hd"><b>' + o.name + '</b><em>' + o.tag + '</em></div><p>' + o.html + '</p></div>';
      }).join('') + '</div>') +
      sec('③', '리스크 및 손절가',
        '<div class="stops">' + stop('단기 손절가 · 1~2주', t.short) + stop('중장기 손절가 · 1~3개월', t.mid) + '</div>' +
        (t.supports.length ? '<div class="sups">' + t.supports.map(function (s, i) {
          return '<div class="sup"><span class="tag">' + (i + 1) + '차 지지선</span><b class="num">' + price(s.v, st.cur) + '</b>' +
            '<em class="down num">' + pct1(s.pct) + '</em><small>' + s.label + '</small></div>';
        }).join('') + '</div>' : '') +
        '<ul class="rs-list risk">' + (risks.length ? risks.map(li).join('')
          : '<li class="neut">뚜렷한 과열·역배열 신호가 없습니다. 손절가를 지키는 전제에서 계획대로 대응하세요.</li>') + '</ul>') +
      (con ? '<div class="consensus"><i data-lucide="users-round"></i><span>증권사 컨센서스 목표주가 <b>' + price(con.target, st.cur) + '</b> ' +
        '<em class="' + cls(con.target - t.price) + '">(' + pct1((con.target - t.price) / t.price * 100) + ')</em>' +
        (con.recomm ? ' · 투자의견 <b>' + con.recomm + '</b>/5' : '') +
        (con.asOf ? ' <span class="asof">' + con.asOf + ' 기준</span>' : '') + '</span></div>' : '');
  }

  /* ---------------- 글로벌 매크로 패널 ---------------- */
  const CAT_ICON = { rate:'landmark', inflation:'shopping-basket', jobs:'briefcase', expiry:'alarm-clock' };
  const COUNTRY = { US:'미국', KR:'한국' };
  function impDots(n){
    return '<span class="imp" title="중요도 ' + n + '/3">' + [1, 2, 3].map(function (i) { return '<i' + (i <= n ? ' class="on"' : '') + '></i>'; }).join('') + '</span>';
  }
  function macroRow(e){
    const now = Date.now(), past = e.t < now, soon = !past && e.t - now < 3 * 86400000;
    return '<div class="tl' + (past ? ' past' : soon ? ' soon' : '') + '" data-kind="' + e.cat + '">' +
      '<div class="when"><div class="dd">' + (past ? '발표됨' : EV.dday(e.t)) + '</div><div class="md">' + EV.fmtMD(e.t).split(' ')[0] + '</div>' + impDots(e.imp) + '</div>' +
      '<div class="body"><b><span class="ic"><i data-lucide="' + (CAT_ICON[e.cat] || 'calendar') + '"></i></span>' +
        '<span class="tt">' + e.title + '</span><span class="status-chip" data-s="' + e.status + '">' + e.status + '</span></b>' +
        '<p><span class="cty" data-c="' + e.country + '">' + COUNTRY[e.country] + '</span>' + EV.fmtDate(e.t) + ' <b class="tm">' + EV.fmtTime(e.t) + '</b> · ' + e.detail + '</p>' +
        (QT.Home ? QT.Home.cmp(e) : '') +
        (e.imp >= 3 && e.why ? '<p class="why">' + e.why + '</p>' : '') +
      '</div></div>';
  }
  function cdHtml(t){
    const c = EV.countdown(t);
    if (!c) return '<div class="cd-done">발표 시각이 지났습니다</div>';
    return [[c.d, '일'], [c.h, '시간'], [c.m, '분'], [c.s, '초']].map(function (x) {
      return '<div><b class="num">' + pad2(x[0]) + '</b><span>' + x[1] + '</span></div>';
    }).join('');
  }
  let heroAt = null;
  function renderHero(){
    const list = EV.macro({ from:Date.now() }).filter(function (e) { return e.imp >= 3; });
    const e = list[0];
    heroAt = e ? e.t : null;
    if (!e){ $('#mc-hero').innerHTML = '<div class="empty">예정된 핵심 이벤트가 없습니다.</div>'; return; }
    $('#mc-hero').innerHTML =
      '<div class="hero-top"><span class="eyebrow"><i data-lucide="radar"></i>다음 핵심 이벤트</span>' +
        '<span class="status-chip" data-s="' + e.status + '">' + e.status + '</span></div>' +
      '<h3 class="hero-title"><span class="cty" data-c="' + e.country + '">' + COUNTRY[e.country] + '</span>' + e.title + '</h3>' +
      '<div class="hero-when"><b>' + EV.dday(e.t) + '</b>' + EV.fmtDate(e.t) + ' ' + EV.fmtTime(e.t) + ' · 한국시간</div>' +
      '<div class="cd" id="mc-cd" role="timer">' + cdHtml(e.t) + '</div>' +
      '<p class="hero-why">' + e.why + '</p>' +
      (list.length > 1 ? '<div class="hero-next">' + list.slice(1, 4).map(function (x) {
        return '<div><em>' + EV.dday(x.t) + '</em><span>' + x.title + '</span><small>' + EV.fmtMD(x.t) + ' ' + EV.fmtTime(x.t) + '</small></div>';
      }).join('') + '</div>' : '');
  }
  function tickHero(){
    if (state.panel !== 'macro' || heroAt == null) return;
    if (heroAt <= Date.now()){ renderMacro(); return; }
    const el = $('#mc-cd'); if (el) el.innerHTML = cdHtml(heroAt);
  }
  function renderMacroList(){
    const list = EV.macro({ cat: state.mcCat || null });
    const shown = state.mcMore ? list : list.slice(0, 10);
    $('#mc-list').innerHTML = shown.map(macroRow).join('') || '<div class="empty">이 분류의 예정 일정이 없습니다.</div>';
    $('#mc-more').hidden = state.mcMore || list.length <= shown.length;
    $('#mc-more').textContent = '일정 더 보기 (' + (list.length - shown.length) + '건)';
    icons();
  }
  function earnRow(e){
    const st = M.BY_CODE[e.code], mine = state.watchlist.indexOf(e.code) >= 0;
    const now = Date.now(), past = e.t < now, soon = !past && e.t - now < 3 * 86400000;
    const tag = st ? 'button' : 'div', md = EV.fmtMD(e.t).split(' ');
    return '<' + tag + ' class="er' + (past ? ' past' : '') + (e.code === state.code ? ' on' : '') + '"' +
        (st ? ' type="button" data-code="' + e.code + '" title="' + e.name + ' 차트 보기"' : '') + '>' +
      '<span class="er-d"><b class="num">' + md[0] + '</b><small>' + md[1].replace(/[()]/g, '') + '</small></span>' +
      '<span class="er-n"><b>' + (mine ? '<i data-lucide="star" class="mine" aria-label="관심종목"></i>' : '') + e.name + ' <span class="code">' + e.code + '</span></b>' +
        '<small>' + e.title + ' · ' + (e.local ? '현지 ' + e.local + ' ' : '') + e.whenLabel + '</small>' +
        '<small class="tag">' + e.tag + '</small>' + (QT.Home ? QT.Home.cmp(Object.assign({ isEarn:true }, e)) : '') + '</span>' +
      '<span class="er-r"><span class="er-top"><span class="status-chip" data-s="' + e.status + '">' + e.status + '</span>' +
        '<em class="dd' + (soon ? ' soon' : '') + '">' + (past ? '발표됨' : EV.dday(e.t)) + '</em></span>' +
        '<small>한국 ' + EV.fmtTime(e.t) + '</small></span>' +
    '</' + tag + '>';
  }
  function renderEarnings(){
    const groups = [];
    EV.earnings({ days:80 }).forEach(function (e) {
      const w = EV.weekOf(e.t), g = groups[groups.length - 1];
      if (g && g.key === w.key) g.items.push(e);
      else groups.push({ key:w.key, label:w.label, range:w.range, items:[e] });
    });
    const shown = state.earnMore ? groups : groups.slice(0, 4);
    $('#earn-list').innerHTML = shown.map(function (g) {
      return '<div class="wk"><div class="wk-hd"><b>' + g.label + '</b><span>' + g.range + '</span><em>' + g.items.length + '개 기업</em></div>' +
        g.items.map(earnRow).join('') + '</div>';
    }).join('') || '<div class="empty">표시할 실적 일정이 없습니다.</div>';
    $('#earn-more').hidden = state.earnMore || groups.length <= shown.length;
    icons();
  }
  function ago(t){
    if (!isFinite(t)) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    if (m < 1440) return Math.floor(m / 60) + '시간 전';
    return EV.fmtMD(t);
  }
  function renderNews(){
    if (!NEWS) return;
    const s = NEWS.status, el = $('#news-state');
    el.dataset.mode = s.mode;
    el.textContent = s.mode === 'loading' ? '불러오는 중…'
      : s.mode === 'live' ? '실시간 · ' + hhmmss(s.updatedAt).slice(0, 5) + ' 갱신'
      : s.mode === 'snapshot' ? '스냅샷' + (NEWS.snapshotAt ? ' · ' + String(NEWS.snapshotAt).slice(5, 16).replace('T', ' ') + ' 수집' : '')
      : s.mode === 'error' ? '연결 실패' : s.mode === 'off' ? '수신 꺼짐' : '—';
    el.title = [s.source, s.message].filter(Boolean).join(' · ');
    $$('#news-filter button').forEach(function (b) {
      const n = NEWS.list(b.dataset.cat).length;
      b.textContent = (b.dataset.cat ? NEWS.CATS[b.dataset.cat] : '전체') + (NEWS.items.length ? ' ' + n : '');
    });
    const items = NEWS.list(state.newsCat).slice(0, 24);
    let html;
    if (!items.length){
      html = s.mode === 'loading' ? '<div class="loading">뉴스를 불러오는 중…</div>'
        : NEWS.items.length ? '<div class="empty">이 분류에 해당하는 뉴스가 없습니다.</div>'
        : '<div class="empty">' + esc(s.message || '뉴스가 없습니다.') + '<br>브라우저는 언론사 RSS를 직접 읽을 수 없어(CORS) 중계가 필요합니다.<br>' +
          '우상단 <b>설정 → 뉴스 피드</b>에서 프록시를 지정하거나 <code>tools/build_news.py</code>로 스냅샷을 수집해 주세요.</div>';
    } else {
      html = items.map(function (it) {
        const inner = '<div class="nw-top"><span class="cat" data-c="' + it.cat + '">' + NEWS.CATS[it.cat] + '</span>' +
            '<span class="src">' + esc(it.src) + (isFinite(it.t) ? ' · ' + ago(it.t) : '') + '</span></div>' +
          '<b>' + esc(it.title) + '</b>' + (it.desc ? '<p>' + esc(it.desc) + '</p>' : '');
        return it.link ? '<a class="nw" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
                       : '<div class="nw">' + inner + '</div>';
      }).join('');
    }
    $('#news-list').innerHTML = html;
    $('#news-refresh').classList.toggle('spin', s.mode === 'loading');
  }
  function renderMacro(){
    renderHero();
    renderMacroList();
    renderEarnings();
    renderNews();
    const meta = M.meta();
    $('#mc-note').innerHTML = '<b>확정</b> 연준·통계기관 공식 일정 · <b>규칙</b> 거래소 규정/회의 3주 뒤 의사록 · ' +
      '<b>예상</b> 과거 발표 패턴 기반 추정입니다. CPI·PPI·고용·금통위·실적 발표일은 BLS · 한국은행 · 각 기업 IR 공지로 최종 확인하세요.' +
      (meta.events ? '<br>일정 데이터 수집 ' + String(meta.events).slice(0, 10) : '');
    icons();
  }

  /* ---------------- 로드 · 렌더 ---------------- */
  function computeAnalysis(){
    ind = QT.Indicators.set(bars);
    const daily = M.daily(state.code);
    const analysisBars = (state.tf === '1W' || state.tf === '1M') ? bars : daily;
    analysis = A.run(analysisBars, M.BY_CODE[state.code], daily);
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
    /* 공공데이터 일봉을 아직 안 받은 국내 종목 — 받은 뒤 다시 그린다 (이전 차트는 흐리게 유지) */
    if (M.needsDaily(state.code)){
      const code = state.code;
      $('#chart-card').classList.add('is-loading');
      $('#q-name').textContent = st.name;
      $('#q-code').textContent = st.code + (st.en ? ' · ' + st.en : '');
      $('#q-market').textContent = st.market;
      $('#q-src').textContent = '공공데이터 불러오는 중'; $('#q-src').dataset.kind = 'real';
      M.ensureDaily(code).then(function () { if (code === state.code) loadSymbol(resetView); });
      return;
    }
    $('#chart-card').classList.remove('is-loading');
    if ((state.tf === '1m' || state.tf === '5m') && feedMode() === 'static'){ setTf('1D'); return; }
    if (state.tf === '1m' || state.tf === '5m') loadRealMinutes(state.code);
    if (!M.hasData(state.code)){
      showNoData(true);
      $('#q-name').textContent = st.name;
      $('#q-code').textContent = st.code + (st.en ? ' · ' + st.en : '');
      $('#q-market').textContent = st.market;
      $('#q-sector').textContent = st.type === 'etf' ? 'ETF' : st.cur === 'USD' ? '미국 주식' : '국내 주식';
      $('#q-src').textContent = '시세 미수집'; $('#q-src').dataset.kind = 'sim';
      $('#q-price').textContent = '—'; $('#q-price').className = 'now num flat';
      $('#q-fx').hidden = true;
      $('#q-delta').textContent = '—'; $('#q-delta').className = 'dt num flat';
      ['#s-open','#s-high','#s-low','#s-vol','#s-52'].forEach(function (id) { $(id).textContent = '—'; });
      analysis = null; paintTargetLines();
      $('#targets').innerHTML = $('#reasons').innerHTML = '<div class="empty">시세 데이터가 없어 목표주가를 계산할 수 없습니다.</div>';
      $('#summary').innerHTML = $('#events').innerHTML = $('#mtf').innerHTML = '<div class="empty">시세 데이터가 없어 분석할 수 없습니다.</div>';
      markKey = null; if (chart.ready) chart.series.candle.setMarkers([]);
      $('#tgt-updated').textContent = '—';
      if (QT.Value) QT.Value.update(st, null, { force:true });
      icons();
      if (state.panel === 'macro') renderEarnings();
      loadRealDaily(state.code);
      return;
    }
    showNoData(false);
    bars = M.series(state.code, state.tf);
    computeAnalysis();
    paintChart(resetView);
    renderLegend(null);
    renderQuote();
    renderAnalysis();
    if (state.panel === 'macro') renderEarnings();
    loadRealDaily(state.code);
  }

  /* 증권사 API(토스)가 연결돼 있으면
       · 공공데이터 일봉이 있는 국내 종목: 공공데이터 마지막 거래일 이후 봉(전 영업일 · 오늘)만 토스 일봉으로 잇는다
       · 그 외 종목(미국 등): 실제 일봉 400개로 번들 · 시뮬레이션 일봉을 교체 */
  const realDaily = {};
  function loadRealDaily(code){
    if (realDaily[code] || !QT.Feed.canFetchCandles()) return Promise.resolve();
    realDaily[code] = true;
    return M.ensureDaily(code).then(function () {
      const krx = M.hasKrx(code) && M.isReal(code) && /^krx/.test(M.realSource(code) || '');
      return QT.Feed.fetchCandles(code, '1d', krx ? 20 : 400).then(function (list) {
        if (!(krx ? M.appendDaily(code, list, 'toss') : M.setDaily(code, list, 'toss'))) return;
        if (code === state.code && state.tf !== '1m' && state.tf !== '5m') loadSymbol(false);
        refreshRowPrices();
      });
    }).catch(function (e) {
      delete realDaily[code];
      console.warn('[QT] 일봉 조회 실패', code, e.message);
    });
  }
  /* 분봉 — 토스 연결 시 실제 1분봉 약 2거래일치 (공공데이터는 일봉만 제공) */
  const realMin = {};
  function loadRealMinutes(code){
    if (realMin[code] || !QT.Feed.canFetchCandles()) return;
    realMin[code] = true;
    QT.Feed.fetchCandles(code, '1m', 800).then(function (list) {
      if (!M.setMinutes(code, list, 'toss')) return;
      if (code === state.code && (state.tf === '1m' || state.tf === '5m')) loadSymbol(true);
    }).catch(function (e) {
      delete realMin[code];
      console.warn('[QT] 분봉 조회 실패', code, e.message);
    });
  }
  /* 관심종목도 전일 대비가 맞도록 한 종목씩 차례로 받는다 (차트 API 초당 20회 한도) */
  function loadRealDailyAll(){
    state.watchlist.reduce(function (p, code) {
      return p.then(function () { return loadRealDaily(code); });
    }, loadRealDaily(state.code));
  }
  function refreshLive(){
    if (!M.hasData(state.code) || M.needsDaily(state.code)) return;
    bars = M.series(state.code, state.tf);
    computeAnalysis();
    if (chart.ready) updateLastPoints();
    renderLegend(null);
    renderQuote();
    renderAnalysis();
  }
  function updateLastPoints(){
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
  }
  function select(code){
    if (!M.BY_CODE[code]) return;
    state.code = code;
    setView('stock');
    renderList(); loadSymbol(true); subscribeAll();
    if (window.innerWidth <= 900) closeDrawer();
  }

  /* ---------------- 화면 전환 (홈 ↔ 종목 분석) ---------------- */
  function setView(v){
    if (v !== 'home' && v !== 'stock') return;
    const changed = state.view !== v;
    state.view = v;
    document.body.dataset.view = v;
    $$('#vnav button').forEach(function (b) {
      const on = b.dataset.view === v;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    if (v === 'stock'){
      /* 차트는 종목 분석 화면을 처음 열 때 만든다 — 홈에서 시작하면 차트 작업을 미루고, 폭 0인 상태로 만들지 않도록 */
      if (!chart.ready && !chart.failed){
        buildCharts();
        if (bars.length && ind){ paintChart(true); renderLegend(null); }
      } else {
        resizeCharts();
        if (pendingReset){ pendingReset = false; defaultRange(); }
      }
    } else {
      if (isFs()) setFs(false);
      if (QT.Home) QT.Home.render();
    }
    if (changed) window.scrollTo(0, 0);
  }
  /* 홈의 '전체 일정 · 증시 뉴스' → 종목 분석 화면의 글로벌 매크로 탭 */
  function openMacro(){
    setView('stock');
    const b = $('#side-tabs button[data-panel="macro"]');
    if (b) b.click();
    const aside = $('.aside');
    if (aside && aside.getBoundingClientRect().top > window.innerHeight * 0.5) aside.scrollIntoView({ behavior:'smooth', block:'start' });
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
    const row = e.target.closest('.wl-row, .scr-card');
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
    $('#panel-value').hidden = state.panel !== 'value';
    $('#panel-macro').hidden = state.panel !== 'macro';
    if (QT.Value) QT.Value.setVisible(state.panel === 'value');
    if (NEWS) NEWS.active = state.panel === 'macro';
    if (state.panel === 'macro'){
      renderMacro();
      if (NEWS) NEWS.start().refresh();
    }
  });
  function chipGroup(sel, onPick){
    $(sel).addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      $$(sel + ' button').forEach(function (x) { x.classList.toggle('on', x === b); });
      onPick(b.dataset.cat || '');
    });
  }
  chipGroup('#mc-filter', function (c) { state.mcCat = c; state.mcMore = false; renderMacroList(); });
  chipGroup('#news-filter', function (c) { state.newsCat = c; renderNews(); });
  $('#mc-more').addEventListener('click', function () { state.mcMore = true; renderMacroList(); });
  $('#earn-more').addEventListener('click', function () { state.earnMore = true; renderEarnings(); });
  $('#earn-list').addEventListener('click', function (e) {
    const row = e.target.closest('[data-code]');
    if (row) select(row.dataset.code);
  });
  $('#news-refresh').addEventListener('click', function () { if (NEWS) NEWS.refresh(true); });
  $('#combo-strip').addEventListener('click', function () {
    const b = $('#side-tabs button[data-panel="value"]');
    if (b) b.click();
    $('#side-tabs').scrollIntoView({ behavior:'smooth', block:'nearest' });
  });
  if (NEWS) NEWS.on(function () { if (state.panel === 'macro') renderNews(); });
  function setTf(tf){
    state.tf = tf;
    $$('#tf-seg button').forEach(function (x) { x.classList.toggle('on', x.dataset.tf === tf); });
    loadSymbol(true);
  }
  $('#tf-seg').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    setTf(b.dataset.tf);
  });
  /* 공공데이터 종가 모드에서는 분봉이 없다 — 토스증권 연결 시 실제 1분봉 */
  function feedMode(){ return (QT.Feed.status && QT.Feed.status.mode) || 'connecting'; }
  function syncTfAvail(){
    const off = feedMode() === 'static';
    $$('#tf-seg button[data-tf="1m"], #tf-seg button[data-tf="5m"]').forEach(function (b) {
      b.disabled = off;
      b.title = off ? '공공데이터는 일봉만 제공합니다 — 분봉은 토스증권 실시간 연결 시 표시됩니다' : '';
    });
    if (off && (state.tf === '1m' || state.tf === '5m')) setTf('1D');
  }
  $('#ind-seg').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.ind;
    state.ind[k] = !state.ind[k];
    b.classList.toggle('on', state.ind[k]);
    if (k === 'tgt'){ paintTargetLines(); chart.price && chart.price.priceScale('right').applyOptions({ autoScale:true }); return; }
    if (k === 'sig'){ paintMarkers(); return; }
    paintChart(false); renderLegend(null);
  });

  $('#vnav').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view);
  });
  $('#chart-ctl').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'fs-btn') return setFs(!isFs());
    if (b.dataset.z === 'in') zoomBy(0.8);
    else if (b.dataset.z === 'out') zoomBy(1.25);
    else if (b.dataset.z === 'reset') defaultRange();
  });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && isFs()) setFs(false);    // 브라우저에서 Esc 로 나간 경우
  });
  document.addEventListener('keydown', function (e) {
    if (state.view !== 'stock' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || $('#modal').classList.contains('show') || (QT.Home && QT.Home.popOpen)) return;
    const fs = isFs();
    if (e.key === 'Escape' && fs){ setFs(false); return; }
    if (e.key === 'f' || e.key === 'F'){ e.preventDefault(); setFs(!fs); return; }
    if (e.key === '+' || e.key === '='){ e.preventDefault(); zoomBy(0.8); }
    else if (e.key === '-' || e.key === '_'){ e.preventDefault(); zoomBy(1.25); }
    else if (e.key === '0'){ e.preventDefault(); defaultRange(); }
    else if (fs && e.key === 'ArrowLeft'){ e.preventDefault(); panBy(-120); }
    else if (fs && e.key === 'ArrowRight'){ e.preventDefault(); panBy(120); }
  });

  function openDrawer(){ $('#side').classList.add('open'); $('#scrim').classList.add('show'); }
  function closeDrawer(){ $('#side').classList.remove('open'); $('#scrim').classList.remove('show'); }
  $('#menu-btn').addEventListener('click', function () { $('#side').classList.contains('open') ? closeDrawer() : openDrawer(); });
  $('#scrim').addEventListener('click', closeDrawer);

  /* ---------------- 연결 설정 ---------------- */
  function fillModal(provider){
    const c = QT.Feed.getConfig(), toss = provider === 'toss', remote = provider === 'toss' || provider === 'kis';
    const p = provider === 'kis' ? c.kis : c.toss;
    $('#fld-proxy').hidden = $('#fld-ws').hidden = !remote;
    $('#m-save').textContent = remote ? '연결하기' : '저장';
    $('#f-proxy').value = p.proxyBase || (toss ? QT.TOSS_DEFAULT_PROXY : '');
    $('#f-proxy').placeholder = toss ? QT.TOSS_DEFAULT_PROXY : 'https://my-server.com/kis';
    $('#f-token').value = provider === 'kis' ? (c.kis.approvalKey || '') : (c.toss.key || '');
    $('#f-token').placeholder = toss ? '이 PC의 프록시는 비워 두세요' : 'KIS approval_key';
    $('#f-token-label').textContent = toss ? '프록시 접속 키 (원격 서버일 때)' : 'KIS approval_key (개발용)';
    $('#f-ws').value = p.wsUrl || '';
    $('#f-ws').placeholder = toss ? '비우면 프록시 주소 + /ws' : 'wss://... (미입력 시 REST 1초 폴링)';
    $('#fld-token').hidden = !remote;
    $('#toss-guide').hidden = !toss;
  }
  /* 연결 링크 — #toss=<프록시 주소>&key=<접속 키> (tools/server/setup.sh 가 출력)
     바로 연결하지 않고 설정창에 채워 보여준다 — 남이 보낸 링크로 모르는 서버에 붙지 않도록.
     키가 방문 기록에 남지 않게 주소창에서는 즉시 지운다. */
  function readConnectLink(){
    const h = new URLSearchParams(location.hash.slice(1)), proxy = h.get('toss');
    if (!proxy) return null;
    history.replaceState(null, '', location.pathname + location.search);
    if (!/^https?:\/\/[^\s]+$/.test(proxy)) return null;
    return { proxy:proxy.replace(/\/$/, ''), key:h.get('key') || '' };
  }
  const connectLink = readConnectLink();

  function openModal(prefill){
    const c = QT.Feed.getConfig(), provider = prefill ? 'toss' : c.provider;
    $('#f-provider').value = provider;
    fillModal(provider);
    if (prefill){ $('#f-proxy').value = prefill.proxy; $('#f-token').value = prefill.key; $('#f-ws').value = ''; }
    $('#link-note').hidden = !prefill;
    $('#link-note-url').textContent = prefill ? prefill.proxy : '';
    if (NEWS){
      const n = NEWS.getConfig();
      $('#f-news-mode').value = n.mode;
      $('#f-news-proxy').value = n.proxy || '';
      $('#f-news-proxy-wrap').hidden = n.mode !== 'proxy';
    }
    $('#modal').classList.add('show');
  }
  $('#f-provider').addEventListener('change', function () { fillModal(this.value); });
  function closeModal(){ $('#modal').classList.remove('show'); }
  $('#settings-btn').addEventListener('click', function () { openModal(); });
  $('#connect-btn').addEventListener('click', function () { openModal(); });
  $('#m-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', function (e) { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  $('#f-news-mode').addEventListener('change', function (e) { $('#f-news-proxy-wrap').hidden = e.target.value !== 'proxy'; });
  $('#m-save').addEventListener('click', function () {
    if (NEWS){
      const prev = NEWS.getConfig(), mode = $('#f-news-mode').value, proxy = $('#f-news-proxy').value.trim();
      if (prev.mode !== mode || (prev.proxy || '') !== proxy) NEWS.applyConfig({ mode:mode, proxy:proxy });
    }
    const provider = $('#f-provider').value;
    const proxy = $('#f-proxy').value.trim(), token = $('#f-token').value.trim(), ws = $('#f-ws').value.trim();
    QT.Feed.applyConfig(provider === 'kis'
      ? { provider:provider, kis:{ proxyBase:proxy, approvalKey:token, wsUrl:ws } }
      : { provider:provider, toss:{ proxyBase:proxy, wsUrl:ws, key:token } });
    closeModal();
  });

  /* ---------------- 피드 ---------------- */
  function subscribeAll(){
    const codes = state.watchlist.slice();
    if (codes.indexOf(state.code) < 0) codes.push(state.code);
    QT.Feed.subscribe(codes);
    loadRealDailyAll();
  }
  const FEED_TEXT = { live:'실시간 수신 중', mock:'모의 시세 (데모)', connecting:'연결 중', error:'연결 실패', static:'종가 기준' };
  QT.Feed.on('status', function (s) {
    if (s.mode === 'live') loadRealDailyAll();
    const pill = $('#feed-pill'), tag = $('#live-tag');
    pill.dataset.mode = s.mode;
    $('#feed-text').textContent = s.mode === 'live' ? '실시간' : s.mode === 'static' ? '공공데이터' : FEED_TEXT[s.mode] || s.mode;
    pill.title = s.reason || '';
    tag.dataset.mode = s.mode;
    $('#live-tag-text').textContent = FEED_TEXT[s.mode] || s.mode;
    tag.title = s.reason || '';
    $('#acct-state').textContent = s.mode === 'live' ? '실시간 연결됨' : s.mode === 'mock' ? '모의 데이터 모드'
      : s.mode === 'static' ? '공공데이터 종가 모드' : (s.reason || '연결 중');
    $('#acct-source').textContent = s.source || '—';
    $('#connect-btn').innerHTML = s.mode === 'live' ? '<i data-lucide="settings-2"></i>연결 설정 변경' : '<i data-lucide="plug-zap"></i>토스증권 실시간 연결';
    syncTfAvail();
    if (analysis && !M.needsDaily(state.code)) renderQuote();
    icons();
  });

  setInterval(tickHero, 1000);
  let dirty = false, lastPanel = 0;
  QT.Feed.on('tick', function (t) { if (t.code === state.code) dirty = true; });
  setInterval(function () {
    if (document.hidden) return;
    const now = Date.now();
    if (QT.Screener && QT.Screener.cfg.on) QT.Screener.tick($('#wl'), state.tab, state.mkt, state.watchlist);
    else refreshRowPrices();
    if (dirty && now - lastPanel > 1000){ dirty = false; lastPanel = now; refreshLive(); }
    const at = QT.Feed.lastTickAt;
    $('#live-tag-time').textContent = feedMode() === 'static' ? lastBarDay() : at ? hhmmss(at) : '--:--:--';
    const ago = at ? Math.round((now - at) / 1000) : null;
    $('#acct-latency').textContent = ago == null ? '—' : (ago < 2 ? '방금 전' : ago + '초 전');
  }, 700);

  /* 종가 기준 모드에서 차트 우상단에 보여 줄 마지막 일봉 날짜 */
  function lastBarDay(){
    const d = M.hasData(state.code) && !M.needsDaily(state.code) ? M.daily(state.code) : null;
    if (!d || !d.length) return '';
    const t = new Date(d[d.length - 1].t);
    return pad2(t.getUTCMonth() + 1) + '.' + pad2(t.getUTCDate());
  }

  /* ---------------- 시작 ---------------- */
  function boot(){
    icons();
    if (QT.Home) QT.Home.init({ select:select, openMacro:openMacro, tip:tip });
    if (QT.Value) QT.Value.init({ select:select, tip:tip });
    if (QT.Screener) QT.Screener.init({ select:select, refresh:renderList, current:function () { return state.code; } });
    setView(state.view);                              // 종목 분석 화면이면 여기서 차트를 만든다
    /* 시장 스냅샷(예상치 · 이번 주 확정 일정)이 도착하면 매크로 탭 일정도 다시 그린다 */
    if (QT.Markets) QT.Markets.on(function (kind) {
      if (kind === 'snapshot' && state.panel === 'macro'){ renderMacroList(); renderEarnings(); }
    });
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
      if (connectLink) openModal(connectLink);
      /* 일봉·일정은 뒤늦게 도착 — 도착 시 현재 종목을 다시 그린다 */
      M.onLate(function (kind) {
        if (kind === 'history'){ renderList(); loadSymbol(true); }
        else if (kind === 'fundamentals'){ if (QT.Screener && QT.Screener.cfg.on){ QT.Screener.invalidate(); renderList(); } }
        else if (kind === 'events'){
          if (state.panel === 'macro') renderMacro();
          if (analysis) renderAnalysis();
          if (QT.Home) QT.Home.renderDday();
        }
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

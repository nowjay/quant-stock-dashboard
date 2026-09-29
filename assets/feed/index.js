/* =============================================================
   index.js — MarketFeed 파사드
   우선순위:  WebSocket 실시간(KIS/토스)  →  REST 1초 폴링  →  공공데이터 종가(틱 없음)
   · 기본값은 공공데이터 종가 모드 — 공공데이터포털(금융위원회) 일봉을 그대로 보여 주고 값을 만들어내지 않음
   · 모의 시세(Random Walk)는 설정에서 직접 고를 때만 (데모용)
   · 연결 실패·끊김은 지수 백오프로 자동 재연결
   · 15초 이상 체결 수신이 없으면 워치독이 재연결을 트리거
   · UI 는 이 객체만 사용합니다.
       QT.Feed.on('tick'|'status', fn) / subscribe(codes) / start() / applyConfig(cfg)
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const LS_KEY = 'qt.feed.config.v3';
  const LS_OLD = 'qt.feed.config.v2';                   // 예전 기본값 'mock' 은 공공데이터 종가로 옮긴다
  const STALE_MS = 15000;
  const STATIC_SOURCE = '공공데이터포털 · 금융위원회';

  const DEFAULTS = {
    provider: 'static',                                 // static | toss | kis | mock
    kis:  { approvalKey:'', proxyBase:'', wsUrl:'', demo:false },
    toss: { proxyBase:'http://127.0.0.1:8778', wsUrl:'', key:'', pollMs:1000 }   // tools/toss_proxy.py
  };

  function readConfig(){
    const file = window.QT_CONFIG || {};
    let saved = {};
    try {
      const cur = localStorage.getItem(LS_KEY);
      if (cur) saved = JSON.parse(cur);
      else {
        saved = JSON.parse(localStorage.getItem(LS_OLD) || '{}');
        if (saved.provider === 'mock') delete saved.provider;
      }
    } catch (e) {}
    return {
      provider: saved.provider || file.provider || DEFAULTS.provider,
      kis: Object.assign({}, DEFAULTS.kis, file.kis || {}, saved.kis || {}),
      toss: Object.assign({}, DEFAULTS.toss, file.toss || {}, saved.toss || {})
    };
  }

  function MarketFeed(){
    QT.Emitter.call(this);
    this.cfg = readConfig();
    this.codes = [];
    this.impl = null;
    this.status = { mode:'connecting', source:'—', reason:'' };
    this.lastTickAt = 0;
    this.tickCount = 0;
    this._watchdog = null;
  }
  MarketFeed.prototype = Object.create(QT.Emitter.prototype);
  MarketFeed.prototype.constructor = MarketFeed;

  MarketFeed.prototype.getConfig = function (){ return JSON.parse(JSON.stringify(this.cfg)); };
  MarketFeed.prototype.applyConfig = function (patch){
    this.cfg = {
      provider: patch.provider || this.cfg.provider,
      kis: Object.assign({}, this.cfg.kis, patch.kis || {}),
      toss: Object.assign({}, this.cfg.toss, patch.toss || {})
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.cfg)); } catch (e) {}
    return this.start();
  };

  MarketFeed.prototype._setStatus = function (s){ this.status = s; this.emit('status', s); };

  /* live: 증권사 실제 체결(거래일 인식) · false: 모의 시세 */
  MarketFeed.prototype._onTick = function (t, live){
    this.lastTickAt = Date.now();
    this.tickCount++;
    QT.Market.applyTick(t.code, t.price, t.volume, t.ts || Date.now(), !!live);
    this.emit('tick', t);
  };

  /* 공공데이터 종가 — 체결을 만들어내지 않고 수집된 일봉 · 종가만 보여 준다 */
  MarketFeed.prototype._useStatic = function (reason){
    clearInterval(this._watchdog);
    if (this.impl){ try { this.impl.disconnect(); } catch (e) {} this.impl = null; }
    this.lastTickAt = 0;
    this._setStatus({ mode:'static', source:STATIC_SOURCE, reason: reason || '공공데이터포털(금융위원회) 종가 기준 — 실시간 시세는 토스증권 연결 시' });
    return Promise.resolve(false);
  };

  MarketFeed.prototype._useMock = function (reason){
    const self = this;
    if (this.impl) this.impl.disconnect();
    const mock = new QT.MockFeed({ intervalMs: 1000 });
    this.impl = mock;
    mock.on('tick', function (t) { self._onTick(t, false); });
    mock.on('status', function (s) { self._setStatus({ mode:'mock', source:'모의 시세 생성기', reason: reason || s.reason }); });
    mock.subscribe(this.codes);
    return mock.connect();
  };

  MarketFeed.prototype.start = function (){
    const self = this;
    clearInterval(this._watchdog);
    if (this.impl){ this.impl.disconnect(); this.impl = null; }

    const provider = this.cfg.provider;
    if (provider === 'mock') return this._useMock('모의 시세 생성기로 동작 중 (데모 — 실제 시세 아님)');
    if (provider !== 'kis' && provider !== 'toss') return this._useStatic();

    const impl = provider === 'kis'
      ? new QT.KisFeed(this.cfg.kis)
      : new QT.TossFeed(this.cfg.toss);
    impl.on('tick', function (t) { if (self.impl === impl) self._onTick(t, true); });
    impl.on('status', function (s) { if (self.impl === impl) self._setStatus(s); });
    impl.on('error', function (e) { if (self.impl === impl) self._useStatic(self._reason(e) + ' — 공공데이터 종가로 표시'); });
    impl.subscribe(this.codes);
    this.impl = impl;

    /* 체결이 끊기면 재연결 시도 */
    this._watchdog = setInterval(function () {
      if (self.status.mode !== 'live' || document.hidden) return;
      if (Date.now() - self.lastTickAt < STALE_MS) return;
      if (impl.healthy && impl.healthy()) return;          // 장외 시간처럼 체결만 없는 경우
      self._setStatus({ mode:'connecting', source:impl.name, reason:'수신 지연 감지 — 재연결 중' });
      try { impl.disconnect(); } catch (e) {}
      impl.connect().catch(function (e) { if (self.impl === impl) self._useStatic(self._reason(e) + ' — 공공데이터 종가로 표시'); });
    }, 5000);

    return impl.connect().catch(function (e) {
      console.warn('[QT] 실시간 연결 실패:', e.message);
      if (self.impl === impl) return self._useStatic(self._reason(e) + ' — 공공데이터 종가로 표시');
    });
  };

  MarketFeed.prototype._reason = function (e){
    const m = (e && e.message) || '';
    if (/Failed to fetch|NetworkError|CORS/i.test(m)) return '브라우저에서 증권사 API 직접 호출은 CORS 로 차단됩니다. 프록시 주소가 필요합니다';
    if (/Mixed Content|ws:\/\//i.test(m)) return 'HTTPS 페이지에서는 ws:// 연결이 차단됩니다. wss:// 프록시가 필요합니다';
    return '연결 실패 (' + m + ')';
  };

  /* 실제 과거 봉 — 증권사 API 가 연결돼 있을 때만 (토스: 1d · 1m) */
  MarketFeed.prototype.canFetchCandles = function (){
    return this.status.mode === 'live' && !!this.impl && typeof this.impl.fetchCandles === 'function';
  };
  MarketFeed.prototype.fetchCandles = function (code, interval, count){
    if (!this.canFetchCandles()) return Promise.reject(new Error('실시간 연결 없음'));
    return this.impl.fetchCandles(code, interval, count);
  };

  MarketFeed.prototype.subscribe = function (codes){
    this.codes = codes.slice();
    if (this.impl) this.impl.subscribe(this.codes);
  };

  QT.Feed = new MarketFeed();
})(window.QT);

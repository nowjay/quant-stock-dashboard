/* =============================================================
   index.js — MarketFeed 파사드
   우선순위:  WebSocket 실시간(KIS/토스)  →  REST 1초 폴링  →  모의 시세
   · 연결 실패·끊김은 지수 백오프로 자동 재연결
   · 15초 이상 체결 수신이 없으면 워치독이 재연결을 트리거
   · UI 는 이 객체만 사용합니다.
       QT.Feed.on('tick'|'status', fn) / subscribe(codes) / start() / applyConfig(cfg)
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const LS_KEY = 'qt.feed.config.v2';
  const STALE_MS = 15000;

  const DEFAULTS = {
    provider: 'mock',                                   // mock | kis | toss
    kis:  { approvalKey:'', proxyBase:'', wsUrl:'', demo:false },
    toss: { token:'', proxyBase:'', restBase:'https://openapi.tossinvest.com', wsUrl:'', pollMs:1000 }
  };

  function readConfig(){
    const file = window.QT_CONFIG || {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
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

  MarketFeed.prototype._onTick = function (t){
    this.lastTickAt = Date.now();
    this.tickCount++;
    QT.Market.applyTick(t.code, t.price, t.volume);
    this.emit('tick', t);
  };

  MarketFeed.prototype._useMock = function (reason){
    const self = this;
    if (this.impl) this.impl.disconnect();
    const mock = new QT.MockFeed({ intervalMs: 1000 });
    this.impl = mock;
    mock.on('tick', function (t) { self._onTick(t); });
    mock.on('status', function (s) { self._setStatus({ mode:'mock', source:'모의 시세 생성기', reason: reason || s.reason }); });
    mock.subscribe(this.codes);
    return mock.connect();
  };

  MarketFeed.prototype.start = function (){
    const self = this;
    clearInterval(this._watchdog);
    if (this.impl){ this.impl.disconnect(); this.impl = null; }

    const provider = this.cfg.provider;
    if (provider !== 'kis' && provider !== 'toss') return this._useMock('모의 시세 생성기로 동작 중');

    const impl = provider === 'kis'
      ? new QT.KisFeed(this.cfg.kis)
      : new QT.TossFeed(this.cfg.toss);
    impl.on('tick', function (t) { self._onTick(t); });
    impl.on('status', function (s) { self._setStatus(s); });
    impl.on('error', function (e) { self._useMock(self._reason(e) + ' — 모의 시세로 대체'); });
    impl.subscribe(this.codes);
    this.impl = impl;

    /* 체결이 끊기면 재연결 시도 */
    this._watchdog = setInterval(function () {
      if (self.status.mode !== 'live' || document.hidden) return;
      if (Date.now() - self.lastTickAt < STALE_MS) return;
      self._setStatus({ mode:'connecting', source:impl.name, reason:'수신 지연 감지 — 재연결 중' });
      try { impl.disconnect(); } catch (e) {}
      impl.connect().catch(function (e) { self._useMock(self._reason(e) + ' — 모의 시세로 대체'); });
    }, 5000);

    return impl.connect().catch(function (e) {
      console.warn('[QT] 실시간 연결 실패:', e.message);
      return self._useMock(self._reason(e) + ' — 모의 시세로 대체');
    });
  };

  MarketFeed.prototype._reason = function (e){
    const m = (e && e.message) || '';
    if (/Failed to fetch|NetworkError|CORS/i.test(m)) return '브라우저에서 증권사 API 직접 호출은 CORS 로 차단됩니다. 프록시 주소가 필요합니다';
    if (/Mixed Content|ws:\/\//i.test(m)) return 'HTTPS 페이지에서는 ws:// 연결이 차단됩니다. wss:// 프록시가 필요합니다';
    return '연결 실패 (' + m + ')';
  };

  MarketFeed.prototype.subscribe = function (codes){
    this.codes = codes.slice();
    if (this.impl) this.impl.subscribe(this.codes);
  };

  QT.Feed = new MarketFeed();
})(window.QT);

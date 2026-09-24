/* =============================================================
   index.js — MarketFeed 파사드
   설정(provider/token/proxy/ws)을 읽어 실제 피드를 고르고,
   실패하면 MockFeed 로 자동 폴백합니다. UI 는 이 객체만 사용합니다.

     QT.Feed.on('tick'|'status', fn)
     QT.Feed.subscribe(['005930', ...])
     QT.Feed.start() / QT.Feed.applyConfig({...})
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const LS_KEY = 'qt.feed.config.v1';

  const DEFAULTS = {
    provider: 'mock',
    toss: { token:'', proxyBase:'', restBase:'https://openapi.tossinvest.com', wsUrl:'', pollMs:2000 }
  };

  function readConfig(){
    const fromFile = window.QT_CONFIG || {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { saved = {}; }
    return {
      provider: saved.provider || fromFile.provider || DEFAULTS.provider,
      toss: Object.assign({}, DEFAULTS.toss, fromFile.toss || {}, saved.toss || {})
    };
  }
  function writeConfig(cfg){
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function MarketFeed(){
    QT.Emitter.call(this);
    this.cfg = readConfig();
    this.codes = [];
    this.impl = null;
    this.status = { mode:'connecting', source:'—', reason:'' };
    this.lastTickAt = 0;
  }
  MarketFeed.prototype = Object.create(QT.Emitter.prototype);
  MarketFeed.prototype.constructor = MarketFeed;

  MarketFeed.prototype.getConfig = function (){ return JSON.parse(JSON.stringify(this.cfg)); };
  MarketFeed.prototype.applyConfig = function (patch){
    this.cfg = { provider: patch.provider || this.cfg.provider, toss: Object.assign({}, this.cfg.toss, patch.toss || {}) };
    writeConfig(this.cfg);
    return this.start();
  };

  MarketFeed.prototype._setStatus = function (s){
    this.status = s;
    this.emit('status', s);
  };

  MarketFeed.prototype._useMock = function (reason){
    const self = this;
    if (this.impl) this.impl.disconnect();
    const mock = new QT.MockFeed();
    this.impl = mock;
    mock.on('tick', function (t) { self._onTick(t); });
    mock.on('status', function (s) { self._setStatus({ mode:'mock', source:'Mock Feed', reason: reason || s.reason }); });
    mock.subscribe(this.codes);
    return mock.connect();
  };

  MarketFeed.prototype._onTick = function (t){
    this.lastTickAt = Date.now();
    QT.Market.applyTick(t.code, t.price, t.volume);
    this.emit('tick', t);
  };

  MarketFeed.prototype.start = function (){
    const self = this;
    if (this.impl){ this.impl.disconnect(); this.impl = null; }
    if (this.cfg.provider !== 'toss') return this._useMock('모의 시세 생성기로 동작 중');

    const live = new QT.TossFeed(this.cfg.toss);
    live.on('tick', function (t) { self._onTick(t); });
    live.on('status', function (s) { self._setStatus(s); });
    live.on('error', function (e) { self._useMock('실시간 연결 실패 — ' + e.message); });
    live.subscribe(this.codes);
    this.impl = live;

    return live.connect().catch(function (e) {
      const msg = /Failed to fetch|NetworkError|CORS/i.test(e.message)
        ? '브라우저에서 증권사 API를 직접 호출하면 CORS로 차단됩니다. 프록시 서버 주소를 설정하세요.'
        : '연결 실패 (' + e.message + ')';
      console.warn('[QT] 실시간 연결 실패:', e.message);
      return self._useMock(msg + ' — 모의 시세로 대체');
    });
  };

  MarketFeed.prototype.subscribe = function (codes){
    this.codes = codes.slice();
    if (this.impl) this.impl.subscribe(this.codes);
  };

  QT.Feed = new MarketFeed();
})(window.QT);

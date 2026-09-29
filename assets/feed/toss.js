/* =============================================================
   toss.js — 토스증권 Open API 시세 어댑터
   문서: https://developers.tossinvest.com/docs (스펙: openapi.json · asyncapi.json)

   ● 브라우저는 토스증권을 직접 호출할 수 없어 로컬 프록시(tools/toss_proxy.py)를 거칩니다.
       - REST 응답에 CORS 헤더가 없어 fetch 가 차단됨
       - 웹소켓 handshake 에 Authorization 헤더가 필요한데 브라우저 WebSocket 은 헤더를 못 붙임
       - client_secret 을 브라우저에 두면 페이지를 여는 누구에게나 노출됨

   ● 원격 프록시 (다른 기기에서 보기 — tools/server/setup.sh)
       https:// 주소 + '프록시 접속 키'. 키는 REST 는 X-Proxy-Key 헤더, 웹소켓은 첫 메시지로 보냅니다.

   ● 연결 순서
       1) GET {proxy}/health           토큰 발급 · 허용 IP 점검
       2) GET {proxy}/api/v1/prices    현재가 스냅샷 (웹소켓은 구독 직후 초기값을 주지 않음)
       3) WS  {proxy}/ws               trade:kr / trade:us 실시간 체결 구독
     웹소켓이 안 되면 REST 폴링으로 전환하고, 그것도 실패하면 상위(MarketFeed)가 모의 시세로 폴백합니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  const DEFAULT_PROXY = 'http://127.0.0.1:8778';
  const API = {
    health: '/health',
    prices: '/api/v1/prices',        // GET ?symbols=005930,AAPL (최대 200개)
    candles: '/api/v1/candles',      // GET ?symbol=005930&interval=1d|1m&count=1~200&before=
    ws: '/ws'
  };
  const MAX_SYMBOLS = 200;           // 현재가 다건 조회 한도
  const MAX_TOPICS = 100;            // 웹소켓 연결당 구독 한도
  const PING_MS = 30000;

  /* 종목 마스터의 통화로 시장을 가른다 — 토스 웹소켓은 trade:kr / trade:us 를 구분해 선언해야 함 */
  function marketOf(code){
    const st = QT.Market && QT.Market.BY_CODE[code];
    if (st) return st.cur === 'USD' ? 'us' : 'kr';
    return /^\d/.test(code) ? 'kr' : 'us';
  }

  /* 일봉 시각은 history.json 과 같은 규칙으로 맞춘다 (국내 15:30 KST, 미국 0시 UTC) */
  function dayStamp(iso, us){
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1, d = +iso.slice(8, 10);
    return us ? Date.UTC(y, m, d) : Date.UTC(y, m, d, 6, 30);
  }

  function TossFeed(cfg){
    QT.Emitter.call(this);
    this.cfg = Object.assign({ proxyBase:'', wsUrl:'', key:'', pollMs:1000 }, cfg || {});
    this.codes = [];
    this.bad = {};                   // 토스 종목 마스터에 없는 심볼 (다시 요청하지 않음)
    this.ws = null;
    this.timer = null;
    this.pinger = null;
    this.retryTimer = null;
    this.gen = 0;                    // disconnect 마다 증가 — 이전 연결의 늦은 콜백을 무시
    this.polling = false;
    this.pollFails = 0;
    this.retries = 0;
    this.closed = false;
    this.name = '토스증권 Open API';
    this.mode = 'live';
    this.lastAt = 0;                 // 마지막 시세 수신
    this.lastFrameAt = 0;            // 마지막 웹소켓 프레임 (pong 포함)
  }
  TossFeed.prototype = Object.create(QT.Emitter.prototype);
  TossFeed.prototype.constructor = TossFeed;

  TossFeed.prototype.base = function (){ return (this.cfg.proxyBase || DEFAULT_PROXY).replace(/\/$/, ''); };
  TossFeed.prototype.wsUrl = function (){ return this.cfg.wsUrl || this.base().replace(/^http/, 'ws') + API.ws; };

  TossFeed.prototype.isLocal = function (){ return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(this.base()); };

  /* retries: 429(요청 한도 초과)일 때 Retry-After 만큼 기다렸다 다시 시도할 횟수 */
  TossFeed.prototype._get = function (path, retries){
    const self = this, base = this.base(), headers = { 'Accept':'application/json' };
    if (this.cfg.key) headers['X-Proxy-Key'] = this.cfg.key;
    return fetch(base + path, { headers:headers, credentials:'omit', cache:'no-store' })
      .catch(function () {
        throw new Error('프록시(' + base + ')에 연결할 수 없습니다 — ' + (self.isLocal()
          ? '.venv/bin/python tools/toss_proxy.py 를 실행하세요'
          : '서버가 켜져 있는지, 주소가 맞는지 확인하세요'));
      })
      .then(function (r) {
        if (r.status === 429 && retries > 0){
          const wait = (Number(r.headers.get('Retry-After')) || 1) * 1000 + Math.random() * 300;
          return new Promise(function (ok) { setTimeout(ok, wait); })
            .then(function () { return self._get(path, retries - 1); });
        }
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          const e = new Error((j.error && j.error.message) || ('HTTP ' + r.status));
          e.status = r.status; e.code = j.error && j.error.code;
          throw e;
        });
      });
  };

  TossFeed.prototype._tick = function (t){ this.lastAt = Date.now(); this.emit('tick', t); };

  /* ---------- 연결 ---------- */
  TossFeed.prototype.connect = function (){
    const self = this, gen = this.gen;
    this.closed = false;
    this.emit('status', { mode:'connecting', source:this.name, reason:'프록시 점검 중' });
    /* HTTPS 페이지(배포본)는 http:// 원격 주소를 부를 수 없다 — localhost 만 예외 */
    if (location.protocol === 'https:' && /^http:/.test(this.base()) && !this.isLocal())
      return Promise.reject(new Error('HTTPS 페이지에서는 http:// 프록시에 연결할 수 없습니다 — https:// 주소를 입력하세요'));
    return this._get(API.health)
      .then(function (h) {
        if (!h.ok) throw new Error((h.error && h.error.message) || '프록시가 토스증권에 연결하지 못했습니다');
        return self._pollOnce();
      })
      .then(function () {
        return self._connectWS().catch(function (e) {
          console.warn('[QT] 토스 웹소켓 실패 — REST 폴링으로 전환:', e.message);
          if (gen === self.gen) self._retry();
        });
      })
      .then(function () { return true; });
  };

  TossFeed.prototype._connectWS = function (){
    const self = this;
    return new Promise(function (resolve, reject) {
      let settled = false, opened = false, ws;
      try { ws = new WebSocket(self.wsUrl()); } catch (e) { reject(e); return; }
      self.ws = ws;
      const guard = setTimeout(function () { fail(new Error('웹소켓 연결 시간 초과')); }, 8000);
      function fail(e){
        if (settled) return;
        settled = true; clearTimeout(guard);
        try { ws.close(); } catch (x) {}
        reject(e);
      }

      ws.onopen = function (){
        self.lastFrameAt = Date.now();
        /* 브라우저 WebSocket 은 헤더를 못 붙이므로 접속 키는 첫 메시지로 보낸다 */
        if (self.cfg.key) ws.send(JSON.stringify({ type:'auth', key:self.cfg.key }));
        self._declare();
        clearInterval(self.pinger);
        self.pinger = setInterval(function () { if (ws.readyState === 1) ws.send('PING'); }, PING_MS);
      };
      ws.onmessage = function (ev){
        self.lastFrameAt = Date.now();
        let f; try { f = JSON.parse(ev.data); } catch (e) { return; }
        if (f.type === 'message'){
          const t = self._fromTrade(f);
          if (t) self._tick(t);
        } else if (f.type === 'proxy-status'){
          /* 프록시 ↔ 토스 구간 상태. 끊긴 동안은 REST 폴링으로 메운다 */
          if (f.upstream === 'open'){
            if (!settled){ settled = opened = true; clearTimeout(guard); self.retries = 0; resolve(true); }
            self._stopPolling();
            self.emit('status', { mode:'live', source:self.name, reason:'웹소켓 실시간 체결 수신' });
          } else if (settled && f.upstream !== 'idle'){
            self._startPolling('토스 웹소켓 재연결 중 — REST 폴링으로 대체 (' + (f.message || f.upstream) + ')');
          } else if (f.upstream === 'error'){
            console.warn('[QT] 토스 웹소켓:', f.message);
          }
        } else if (f.type === 'subscriptions'){
          (f.rejected || []).forEach(function (r) {
            const code = String(r.target || '').split(':').slice(2).join(':');
            if (r.code === 'stock-not-found' && code) self.bad[code] = true;
            console.warn('[QT] 토스 구독 거부', r.target, r.code, r.message);
          });
        } else if (f.type === 'error'){
          console.warn('[QT] 토스 웹소켓 오류', f.error);
          if (f.error && /^proxy-key/.test(f.error.code)) fail(new Error(f.error.message));
        }
      };
      ws.onerror = function (){ fail(new Error('프록시 웹소켓 오류')); };
      ws.onclose = function (){
        clearInterval(self.pinger);
        if (!opened){ fail(new Error('프록시 웹소켓이 닫혔습니다')); return; }   // 재시도는 호출한 쪽이 한다
        if (self.ws === ws && !self.closed) self._retry();
      };
    });
  };

  /* 선언형 구독 — 보낼 때마다 전체 목록이 기존 구독을 대체한다 */
  TossFeed.prototype._declare = function (){
    if (!this.ws || this.ws.readyState !== 1) return;
    const self = this, groups = { 'trade:kr':[], 'trade:us':[] };
    this.codes.filter(function (c) { return !self.bad[c]; }).slice(0, MAX_TOPICS)
      .forEach(function (c) { groups['trade:' + marketOf(c)].push(c); });
    const decl = Object.keys(groups)
      .filter(function (k) { return groups[k].length; })
      .map(function (k) { return { type:k, codes:groups[k] }; });
    this.ws.send(JSON.stringify(decl));
  };

  /* {type:'message', topic:'trade:kr:005930', data:{price, volume, timestamp, currency}} */
  TossFeed.prototype._fromTrade = function (f){
    const parts = String(f.topic || '').split(':');
    if (parts[0] !== 'trade' || !f.data) return null;
    const price = Number(f.data.price);
    if (!isFinite(price) || price <= 0) return null;
    return {
      code: parts.slice(2).join(':'),
      price: price,
      volume: Number(f.data.volume) || 0,
      ts: Date.parse(f.data.timestamp) || Date.now()
    };
  };

  TossFeed.prototype._retry = function (){
    const self = this, gen = this.gen;
    this._startPolling('웹소켓 재연결 중 — REST ' + this.cfg.pollMs + 'ms 폴링으로 대체');
    /* 폴링으로 버티면서 웹소켓은 계속 다시 시도 (1s → 2s → … 최대 30s) */
    const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(this.retries++, 5)));
    clearTimeout(this.retryTimer);                  // 재시도 예약은 항상 1개만
    this.retryTimer = setTimeout(function () {
      if (gen !== self.gen) return;
      self._connectWS().catch(function (e) {
        console.warn('[QT] 토스 웹소켓 재연결 실패:', e.message);
        if (gen === self.gen) self._retry();
      });
    }, wait);
  };

  /* ---------- REST 현재가 ---------- */
  TossFeed.prototype._pricesOf = function (codes){
    return this._get(API.prices + '?symbols=' + codes.map(encodeURIComponent).join(','))
      .then(function (j) { return j.result || []; });
  };

  TossFeed.prototype._pollOnce = function (){
    const self = this;
    const codes = this.codes.filter(function (c) { return !self.bad[c]; }).slice(0, MAX_SYMBOLS);
    if (!codes.length) return Promise.resolve(0);
    return this._pricesOf(codes)
      .catch(function (e) {
        /* 한 종목이라도 토스에 없으면 전체가 404 일 수 있어 — 종목별로 다시 조회해 걸러낸다 */
        if (e.status !== 404 || codes.length === 1) throw e;
        return Promise.all(codes.map(function (c) {
          return self._pricesOf([c]).catch(function (err) {
            if (err.status === 404){ self.bad[c] = true; console.warn('[QT] 토스 미지원 종목', c); return []; }
            throw err;
          });
        })).then(function (lists) { return [].concat.apply([], lists); });
      })
      .then(function (rows) {
        let got = 0;
        rows.forEach(function (row) {
          const price = Number(row.lastPrice);
          if (!row.symbol || !isFinite(price) || price <= 0) return;
          got++;
          self._tick({ code:row.symbol, price:price, volume:0, ts:Date.parse(row.timestamp) || Date.now() });
        });
        return got;
      });
  };

  TossFeed.prototype._startPolling = function (reason){
    const self = this;
    this.emit('status', { mode:'live', source:this.name, reason:reason });
    if (this.timer) return;
    this.pollFails = 0;
    this.timer = setInterval(function () {
      if (document.hidden || self.polling) return;
      self.polling = true;
      self._pollOnce()
        .then(function () { self.pollFails = 0; })
        .catch(function (e) {
          if (++self.pollFails < 5) return;
          self._stopPolling();
          self.emit('error', e);
        })
        .then(function () { self.polling = false; });
    }, this.cfg.pollMs);
  };
  TossFeed.prototype._stopPolling = function (){ clearInterval(this.timer); this.timer = null; };

  /* 체결이 없는 장외 시간에도 연결이 살아 있으면 워치독이 재연결하지 않도록 */
  TossFeed.prototype.healthy = function (){
    if (this.timer) return Date.now() - this.lastAt < 15000;
    return !!this.ws && this.ws.readyState === 1 && Date.now() - this.lastFrameAt < PING_MS * 2.5;
  };

  TossFeed.prototype.subscribe = function (codes){
    const added = codes.some(function (c) { return this.codes.indexOf(c) < 0; }, this);
    this.codes = codes.slice();
    this._declare();
    /* 새로 추가된 종목은 다음 체결까지 값이 없으므로 현재가를 한 번 받아 둔다 */
    if (added && this.ws && this.ws.readyState === 1) this._pollOnce().catch(function () {});
  };

  TossFeed.prototype.disconnect = function (){
    this.closed = true;
    this.gen++;
    this._stopPolling();
    clearInterval(this.pinger);
    clearTimeout(this.retryTimer);
    if (this.ws){ try { this.ws.onclose = null; this.ws.close(); } catch (e) {} this.ws = null; }
  };

  /* ---------- 과거 봉 ----------
     한 번에 최대 200개, nextBefore 로 과거 페이지를 이어 받는다 (before 는 inclusive 라 경계 봉 중복 제거).
     1m 봉의 timestamp 는 봉 종료 시각이라 시작 시각으로 당긴다. */
  TossFeed.prototype.fetchCandles = function (code, interval, count){
    const self = this, want = count || 200, seen = {}, rows = [];
    function page(before){
      const q = '?symbol=' + encodeURIComponent(code) + '&interval=' + interval +
                '&count=' + Math.min(200, want - rows.length + (before ? 1 : 0)) +
                (before ? '&before=' + encodeURIComponent(before) : '');
      return self._get(API.candles + q, 3).then(function (j) {
        const r = j.result || {}, list = r.candles || [];
        let fresh = 0;
        list.forEach(function (b) { if (!seen[b.timestamp]){ seen[b.timestamp] = 1; rows.push(b); fresh++; } });
        if (r.nextBefore && fresh && rows.length < want) return page(r.nextBefore);
      });
    }
    return page(null).then(function () {
      const us = marketOf(code) === 'us';
      return rows.map(function (b) {
        return {
          t: interval === '1d' ? dayStamp(b.timestamp, us) : Date.parse(b.timestamp) - 60000,
          o: Number(b.openPrice), h: Number(b.highPrice), l: Number(b.lowPrice), c: Number(b.closePrice),
          v: Number(b.volume) || 0
        };
      }).filter(function (b) { return isFinite(b.t) && b.c > 0; })
        .sort(function (a, b) { return a.t - b.t; });           // 토스는 최신순 → 오래된 순으로
    });
  };

  QT.TossFeed = TossFeed;
  QT.TOSS_DEFAULT_PROXY = DEFAULT_PROXY;
})(window.QT);

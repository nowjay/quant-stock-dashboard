/* =============================================================
   toss.js — 토스증권 Open API(및 OpenAPI 표준) 시세 어댑터

   ● 연결 우선순위
     1) wsUrl 이 있으면 WebSocket 실시간 구독
     2) 없으면 REST 폴링 (토스 실시간 WebSocket 미공개 구간 대응)
     3) 실패하면 상위(MarketFeed)가 MockFeed 로 자동 폴백

   ● 인증
     - proxyBase 를 쓰면 토큰은 서버가 보관하고 브라우저는 프록시만 호출합니다(권장).
     - token 직접 사용 시 Authorization: Bearer <token> 헤더로 전송합니다.

   ⚠️ 엔드포인트 경로(ENDPOINTS)는 기관 문서에 맞춰 바꿔 주세요.
      응답 형태가 달라도 normalize() 가 대표적인 필드명을 흡수합니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  const ENDPOINTS = {
    quote: '/api/v1/market/quotes',        // GET ?codes=005930,000660
    candles: '/api/v1/market/candles',     // GET ?code=005930&interval=1d&count=300
    wsSubscribe: 'SUBSCRIBE'               // WebSocket 구독 메시지 타입
  };

  function pick(o){
    for (let i = 1; i < arguments.length; i++){
      const k = arguments[i];
      if (o && o[k] != null) return o[k];
    }
    return null;
  }

  function TossFeed(cfg){
    QT.Emitter.call(this);
    this.cfg = Object.assign({ token:'', proxyBase:'', restBase:'https://openapi.tossinvest.com', wsUrl:'', pollMs:2000 }, cfg || {});
    this.codes = [];
    this.ws = null;
    this.timer = null;
    this.retries = 0;
    this.name = '토스증권 Open API';
    this.mode = 'live';
    this.lastAt = 0;
  }
  TossFeed.prototype = Object.create(QT.Emitter.prototype);
  TossFeed.prototype.constructor = TossFeed;

  TossFeed.prototype.base = function (){ return (this.cfg.proxyBase || this.cfg.restBase || '').replace(/\/$/, ''); };
  TossFeed.prototype.headers = function (){
    const h = { 'Accept':'application/json' };
    if (!this.cfg.proxyBase && this.cfg.token) h['Authorization'] = 'Bearer ' + this.cfg.token;
    return h;
  };

  /* 다양한 응답 스키마를 {code, price, volume, ts} 로 정규화 */
  TossFeed.prototype.normalize = function (raw){
    if (!raw || typeof raw !== 'object') return null;
    const code = pick(raw, 'code', 'symbol', 'stockCode', 'isuSrtCd', 'shortCode');
    const price = pick(raw, 'price', 'closePrice', 'currentPrice', 'trdPrc', 'last', 'tradePrice');
    if (code == null || price == null) return null;
    return {
      code: String(code).replace(/^A/, ''),
      price: Number(price),
      volume: Number(pick(raw, 'volumeDelta', 'tradeVolume', 'accTrdVol', 'volume') || 0),
      ts: Number(pick(raw, 'timestamp', 'ts', 'tradeTime') || Date.now())
    };
  };

  TossFeed.prototype.connect = function (){
    const self = this;
    this.emit('status', { mode:'connecting', source:this.name, reason:'인증 및 세션 수립 중' });
    if (!this.cfg.proxyBase && !this.cfg.token){
      return Promise.reject(new Error('토큰 또는 프록시 주소가 필요합니다.'));
    }
    if (this.cfg.wsUrl) return this._connectWS();
    return this._pollOnce().then(function (ok) {
      if (!ok) throw new Error('시세 응답을 해석하지 못했습니다.');
      self.emit('status', { mode:'live', source:self.name, reason:'REST 폴링 ' + self.cfg.pollMs + 'ms' });
      clearInterval(self.timer);
      self.timer = setInterval(function () { if (!document.hidden) self._pollOnce(); }, self.cfg.pollMs);
      return true;
    });
  };

  TossFeed.prototype._connectWS = function (){
    const self = this;
    return new Promise(function (resolve, reject) {
      let settled = false;
      let ws;
      try { ws = new WebSocket(self.cfg.wsUrl); } catch (e) { reject(e); return; }
      self.ws = ws;
      const guard = setTimeout(function () { if (!settled){ settled = true; try { ws.close(); } catch (e) {} reject(new Error('WebSocket 연결 시간 초과')); } }, 6000);

      ws.onopen = function (){
        clearTimeout(guard); settled = true; self.retries = 0;
        if (!self.cfg.proxyBase && self.cfg.token) ws.send(JSON.stringify({ type:'AUTH', token:self.cfg.token }));
        self._sendSubscribe();
        self.emit('status', { mode:'live', source:self.name, reason:'WebSocket 실시간 수신' });
        resolve(true);
      };
      ws.onmessage = function (ev){
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        const list = Array.isArray(msg) ? msg : (msg.data || msg.body || msg.quotes || [msg]);
        (Array.isArray(list) ? list : [list]).forEach(function (raw) {
          const t = self.normalize(raw);
          if (t){ self.lastAt = Date.now(); self.emit('tick', t); }
        });
      };
      ws.onerror = function (){ if (!settled){ clearTimeout(guard); settled = true; reject(new Error('WebSocket 오류')); } };
      ws.onclose = function (){
        if (!settled){ clearTimeout(guard); settled = true; reject(new Error('WebSocket 종료')); return; }
        self._retry();
      };
    });
  };

  TossFeed.prototype._sendSubscribe = function (){
    if (!this.ws || this.ws.readyState !== 1 || !this.codes.length) return;
    this.ws.send(JSON.stringify({ type:ENDPOINTS.wsSubscribe, codes:this.codes }));
  };

  TossFeed.prototype._pollOnce = function (){
    const self = this;
    if (!this.codes.length) return Promise.resolve(true);
    const url = this.base() + ENDPOINTS.quote + '?codes=' + encodeURIComponent(this.codes.join(','));
    return fetch(url, { headers:this.headers(), credentials:'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        const list = Array.isArray(json) ? json : (json.data || json.result || json.quotes || []);
        let got = 0;
        (Array.isArray(list) ? list : [list]).forEach(function (raw) {
          const t = self.normalize(raw);
          if (t){ got++; self.lastAt = Date.now(); self.emit('tick', t); }
        });
        return got > 0;
      });
  };

  TossFeed.prototype._retry = function (){
    const self = this;
    if (this.retries >= 4){
      this.emit('error', new Error('재연결 실패 — 모의 시세로 전환합니다.'));
      return;
    }
    const wait = Math.min(8000, 800 * Math.pow(2, this.retries++));
    this.emit('status', { mode:'connecting', source:this.name, reason:(wait / 1000) + '초 후 재연결 (' + this.retries + '/4)' });
    setTimeout(function () { self._connectWS().catch(function (e) { self.emit('error', e); }); }, wait);
  };

  TossFeed.prototype.subscribe = function (codes){
    this.codes = codes.slice();
    this._sendSubscribe();
  };
  TossFeed.prototype.disconnect = function (){
    clearInterval(this.timer); this.timer = null;
    if (this.ws){ try { this.ws.onclose = null; this.ws.close(); } catch (e) {} this.ws = null; }
  };

  /* 과거 봉 조회 — 연동 시 QT.Market.loadHistory 대체용 */
  TossFeed.prototype.fetchCandles = function (code, interval, count){
    const url = this.base() + ENDPOINTS.candles + '?code=' + encodeURIComponent(code) +
                '&interval=' + encodeURIComponent(interval) + '&count=' + (count || 300);
    return fetch(url, { headers:this.headers(), credentials:'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) {
        const list = Array.isArray(json) ? json : (json.data || json.candles || []);
        return list.map(function (b) {
          return {
            t: Number(pick(b, 'timestamp', 'ts', 'time', 'dt')),
            o: Number(pick(b, 'open', 'openPrice', 'o')),
            h: Number(pick(b, 'high', 'highPrice', 'h')),
            l: Number(pick(b, 'low', 'lowPrice', 'l')),
            c: Number(pick(b, 'close', 'closePrice', 'c')),
            v: Number(pick(b, 'volume', 'accTrdVol', 'v') || 0)
          };
        }).filter(function (b) { return isFinite(b.t) && isFinite(b.c); });
      });
  };

  QT.TossFeed = TossFeed;
  QT.TOSS_ENDPOINTS = ENDPOINTS;
})(window.QT);

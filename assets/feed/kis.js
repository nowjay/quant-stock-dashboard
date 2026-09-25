/* =============================================================
   kis.js — 한국투자증권 KIS Open API 실시간 체결가 어댑터 (H0STCNT0)

   접속
     실전 ws://ops.koreainvestment.com:21000   모의 ws://ops.koreainvestment.com:31000
     ※ HTTPS 페이지에서는 ws:// 를 열 수 없습니다(Mixed Content).
        배포 환경에서는 wss:// 프록시를 두고 wsUrl 에 지정하세요.

   인증
     approvalKey  : POST /oauth2/Approval 로 발급한 실시간 접속키
     proxyBase    : 서버가 키를 보관하고 중계하는 경우 이 주소만 사용

   체결 데이터 형식
     0|H0STCNT0|001|005930^093017^72500^2^700^0.98^...   (^ 구분, 레코드당 46필드)
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  const TR_ID = 'H0STCNT0';
  const FIELDS = 46;                         // H0STCNT0 레코드 필드 수
  const F = { CODE:0, TIME:1, PRICE:2, SIGN:3, DIFF:4, RATE:5, OPEN:7, HIGH:8, LOW:9, CNTG_VOL:12, ACML_VOL:13 };

  function KisFeed(cfg){
    QT.Emitter.call(this);
    this.cfg = Object.assign({
      approvalKey:'', proxyBase:'', wsUrl:'', demo:false, pollMs:1000,
      restBase:'https://openapi.koreainvestment.com:9443'
    }, cfg || {});
    this.codes = [];
    this.ws = null;
    this.timer = null;
    this.retries = 0;
    this.closing = false;
    this.name = '한국투자 KIS';
    this.mode = 'live';
    this.lastAt = 0;
  }
  KisFeed.prototype = Object.create(QT.Emitter.prototype);
  KisFeed.prototype.constructor = KisFeed;

  KisFeed.prototype.endpoint = function (){
    if (this.cfg.wsUrl) return this.cfg.wsUrl;
    const port = this.cfg.demo ? 31000 : 21000;
    return 'ws://ops.koreainvestment.com:' + port;
  };

  KisFeed.prototype.connect = function (){
    const self = this;
    this.closing = false;
    this.emit('status', { mode:'connecting', source:this.name, reason:'실시간 세션 수립 중' });
    if (!this.cfg.approvalKey && !this.cfg.proxyBase){
      return Promise.reject(new Error('approval_key 또는 프록시 주소가 필요합니다.'));
    }
    const url = this.endpoint();
    if (location.protocol === 'https:' && url.indexOf('ws://') === 0){
      return Promise.reject(new Error('HTTPS 페이지에서는 ws:// 직접 연결이 차단됩니다. wss:// 프록시를 지정하세요.'));
    }
    return this._open(url);
  };

  KisFeed.prototype._open = function (url){
    const self = this;
    return new Promise(function (resolve, reject) {
      let settled = false, ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      self.ws = ws;
      const guard = setTimeout(function () {
        if (settled) return;
        settled = true; try { ws.close(); } catch (e) {}
        reject(new Error('WebSocket 연결 시간 초과'));
      }, 7000);

      ws.onopen = function (){
        clearTimeout(guard); settled = true; self.retries = 0;
        self._subscribeAll('1');
        self.emit('status', { mode:'live', source:self.name, reason:'WebSocket 실시간 체결가 수신' });
        resolve(true);
      };
      ws.onmessage = function (ev){ self._onMessage(ev.data); };
      ws.onerror = function (){
        if (!settled){ clearTimeout(guard); settled = true; reject(new Error('WebSocket 오류')); }
      };
      ws.onclose = function (){
        if (!settled){ clearTimeout(guard); settled = true; reject(new Error('WebSocket 종료')); return; }
        if (!self.closing) self._retry();
      };
    });
  };

  KisFeed.prototype._subscribeAll = function (trType){
    const self = this;
    if (!this.ws || this.ws.readyState !== 1) return;
    this.codes.filter(function (c) { return /^\d{6}$/.test(c); }).forEach(function (code) {
      self.ws.send(JSON.stringify({
        header: { approval_key: self.cfg.approvalKey, custtype:'P', tr_type: trType, 'content-type':'utf-8' },
        body: { input: { tr_id: TR_ID, tr_key: code } }
      }));
    });
  };

  KisFeed.prototype._onMessage = function (raw){
    if (typeof raw !== 'string') return;
    /* 제어 메시지(JSON): 구독 결과 · PINGPONG */
    if (raw.charAt(0) === '{'){
      let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
      const trId = msg.header && msg.header.tr_id;
      if (trId === 'PINGPONG' && this.ws && this.ws.readyState === 1) this.ws.send(raw);   // 그대로 반송
      else if (msg.body && msg.body.rt_cd && msg.body.rt_cd !== '0'){
        this.emit('status', { mode:'connecting', source:this.name, reason:'구독 응답: ' + (msg.body.msg1 || msg.body.rt_cd) });
      }
      return;
    }
    /* 체결 데이터 */
    const parts = raw.split('|');
    if (parts.length < 4 || parts[1] !== TR_ID) return;
    const count = parseInt(parts[2], 10) || 1;
    const cells = parts[3].split('^');
    for (let i = 0; i < count; i++){
      const off = i * FIELDS;
      if (cells.length < off + F.ACML_VOL + 1) break;
      const code = cells[off + F.CODE], price = Number(cells[off + F.PRICE]);
      if (!code || !isFinite(price) || price <= 0) continue;
      this.lastAt = Date.now();
      this.emit('tick', {
        code: code,
        price: price,
        volume: Number(cells[off + F.CNTG_VOL]) || 0,
        accVolume: Number(cells[off + F.ACML_VOL]) || 0,
        open: Number(cells[off + F.OPEN]) || null,
        high: Number(cells[off + F.HIGH]) || null,
        low: Number(cells[off + F.LOW]) || null,
        ts: Date.now(),
        source: 'kis'
      });
    }
  };

  KisFeed.prototype._retry = function (){
    const self = this;
    if (this.retries >= 5){
      this.emit('error', new Error('재연결 5회 실패'));
      return;
    }
    const wait = Math.min(15000, 700 * Math.pow(2, this.retries++));
    this.emit('status', { mode:'connecting', source:this.name, reason: Math.round(wait / 1000) + '초 후 재연결 (' + this.retries + '/5)' });
    setTimeout(function () {
      if (self.closing) return;
      self._open(self.endpoint()).catch(function (e) { self.emit('error', e); });
    }, wait);
  };

  KisFeed.prototype.subscribe = function (codes){
    const before = this.codes.slice();
    this.codes = codes.slice();
    if (this.ws && this.ws.readyState === 1){
      const self = this;
      before.filter(function (c) { return codes.indexOf(c) < 0 && /^\d{6}$/.test(c); }).forEach(function (code) {
        self.ws.send(JSON.stringify({
          header: { approval_key:self.cfg.approvalKey, custtype:'P', tr_type:'2', 'content-type':'utf-8' },
          body: { input: { tr_id:TR_ID, tr_key:code } }
        }));
      });
      this._subscribeAll('1');
    }
  };
  KisFeed.prototype.disconnect = function (){
    this.closing = true;
    clearInterval(this.timer); this.timer = null;
    if (this.ws){ try { this.ws.onclose = null; this.ws.close(); } catch (e) {} this.ws = null; }
  };

  QT.KisFeed = KisFeed;
})(window.QT);

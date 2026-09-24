/* =============================================================
   mock.js — 모의 실시간 시세 생성기 (Random Walk)
   API 미연동/연동 실패 시에도 화면이 동일하게 동작하도록 하는 폴백 소스.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  function Emitter(){
    this._h = {};
  }
  Emitter.prototype.on = function (ev, fn){ (this._h[ev] = this._h[ev] || []).push(fn); return this; };
  Emitter.prototype.emit = function (ev, data){ (this._h[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); };

  function MockFeed(opts){
    Emitter.call(this);
    this.opts = Object.assign({ intervalMs:1000, drift:0 }, opts || {});
    this.codes = [];
    this.timer = null;
    this.name = 'Mock Feed';
    this.mode = 'mock';
  }
  MockFeed.prototype = Object.create(Emitter.prototype);
  MockFeed.prototype.constructor = MockFeed;

  MockFeed.prototype.connect = function (){
    const self = this;
    this.emit('status', { mode:'mock', source:this.name, reason:'모의 시세 생성기로 동작 중' });
    clearInterval(this.timer);
    this.timer = setInterval(function () { self._step(); }, this.opts.intervalMs);
    return Promise.resolve(true);
  };
  MockFeed.prototype.disconnect = function (){ clearInterval(this.timer); this.timer = null; };
  MockFeed.prototype.subscribe = function (codes){ this.codes = codes.slice(); };

  MockFeed.prototype._step = function (){
    if (document.hidden) return;
    const M = QT.Market, now = Date.now();
    for (let i = 0; i < this.codes.length; i++){
      const code = this.codes[i], st = M.BY_CODE[code];
      if (!st) continue;
      const bars = M.daily(code), last = bars[bars.length - 1];
      /* 시가 방향으로 약하게 회귀하는 랜덤워크 + 전일 종가 ±8% 클램프 */
      const prevClose = bars[bars.length - 2] ? bars[bars.length - 2].c : last.o;
      const pull = (last.o - last.c) / last.o * 0.14;
      const step = (Math.random() - 0.5) * st.vol * 0.16 + pull + this.opts.drift;
      let p = last.c * (1 + step);
      p = Math.min(prevClose * 1.08, Math.max(prevClose * 0.92, p));
      this.emit('tick', {
        code: code,
        price: M.TICK_SIZE(p, st.cur),
        volume: Math.round(st.vb * 0.0009 * Math.random()),
        ts: now,
        simulated: true
      });
    }
  };

  QT.Emitter = Emitter;
  QT.MockFeed = MockFeed;
})(window.QT);

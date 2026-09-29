/* =============================================================
   fx.js — 실시간 환율 (USD → KRW)
   공개 무료 API 두 곳을 순서대로 시도하고, 실패하면 캐시 → 고정값으로 폴백합니다.
     1) frankfurter.dev  (ECB 기준, 영업일 1회 갱신)
     2) open.er-api.com  (일 1회 갱신)
   홈 대시보드(markets.js)가 CNBC 실시간 원/달러를 받으면 offer() 로 더 최신 값을 넘겨받습니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const LS = 'qt.fx.usdkrw.v1';
  const FALLBACK = 1360;
  const SOURCES = [
    { name:'frankfurter.dev', url:'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW',
      pick:function (j) { return { rate: j && j.rates && j.rates.KRW, at: j && j.date }; } },
    { name:'open.er-api.com', url:'https://open.er-api.com/v6/latest/USD',
      pick:function (j) { return { rate: j && j.rates && j.rates.KRW, at: j && j.time_last_update_utc }; } }
  ];

  const FX = {
    rate: FALLBACK,
    source: '기본값',
    quotedAt: null,
    quotedTs: 0,                                     // 시세 기준 시각(ms) — 더 오래된 값으로 덮어쓰지 않음
    fetchedAt: null,
    stale: true,
    _subs: [],

    onChange: function (fn){ this._subs.push(fn); fn(this); return this; },
    _emit: function (){ const self = this; this._subs.forEach(function (f) { try { f(self); } catch (e) { console.error(e); } }); },

    /** USD 금액을 원화로 환산 */
    toKRW: function (usd){ return usd == null ? null : usd * this.rate; },

    /** 캐시 복원 → 원격 갱신 */
    init: function (){
      try {
        const c = JSON.parse(localStorage.getItem(LS) || 'null');
        if (c && c.rate > 0){
          this.rate = c.rate; this.source = c.source; this.quotedAt = c.quotedAt; this.quotedTs = c.quotedTs || 0;
          this.fetchedAt = c.fetchedAt; this.stale = (Date.now() - c.fetchedAt) > 6 * 3600e3;
        }
      } catch (e) {}
      this._emit();
      this.refresh();
      const self = this;
      setInterval(function () { if (!document.hidden) self.refresh(); }, 10 * 60 * 1000);
      return this;
    },

    /** 더 최신 환율을 받아들인다 (홈 대시보드의 CNBC 실시간 원/달러) */
    offer: function (rate, source, at){
      if (!(rate > 0) || !isFinite(rate) || (at && at < this.quotedTs)) return;
      if (rate === this.rate && source === this.source) return;
      this.rate = rate; this.source = source;
      this.quotedTs = at || Date.now();
      this.quotedAt = new Date(this.quotedTs).toLocaleString('ko-KR', { hour12:false });
      this.fetchedAt = Date.now(); this.stale = false;
      this._save();
      this._emit();
    },
    _save: function (){
      try { localStorage.setItem(LS, JSON.stringify({ rate:this.rate, source:this.source, quotedAt:this.quotedAt, quotedTs:this.quotedTs, fetchedAt:this.fetchedAt })); } catch (e) {}
    },

    refresh: function (){
      const self = this;
      let chain = Promise.reject();
      SOURCES.forEach(function (src) {
        chain = chain.catch(function () {
          return fetch(src.url, { cache:'no-store' })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (j) {
              const got = src.pick(j);
              if (!got.rate || !isFinite(got.rate)) throw new Error('rate 없음');
              const ts = Date.parse(got.at) || 0;
              if (ts && ts < self.quotedTs) return self;          // 이미 받은 실시간 값이 더 최신
              self.rate = got.rate; self.source = src.name; self.quotedAt = got.at || null; self.quotedTs = ts;
              self.fetchedAt = Date.now(); self.stale = false;
              self._save();
              self._emit();
              return self;
            });
        });
      });
      return chain.catch(function () {
        self.stale = true;
        self._emit();                                  // 캐시/기본값 유지
        return self;
      });
    }
  };

  QT.FX = FX;
})(window.QT);

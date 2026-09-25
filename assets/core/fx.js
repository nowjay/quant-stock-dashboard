/* =============================================================
   fx.js — 실시간 환율 (USD → KRW)
   공개 무료 API 두 곳을 순서대로 시도하고, 실패하면 캐시 → 고정값으로 폴백합니다.
     1) frankfurter.dev  (ECB 기준, 영업일 1회 갱신)
     2) open.er-api.com  (일 1회 갱신)
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
          this.rate = c.rate; this.source = c.source; this.quotedAt = c.quotedAt;
          this.fetchedAt = c.fetchedAt; this.stale = (Date.now() - c.fetchedAt) > 6 * 3600e3;
        }
      } catch (e) {}
      this._emit();
      this.refresh();
      const self = this;
      setInterval(function () { if (!document.hidden) self.refresh(); }, 10 * 60 * 1000);
      return this;
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
              self.rate = got.rate; self.source = src.name; self.quotedAt = got.at || null;
              self.fetchedAt = Date.now(); self.stale = false;
              try { localStorage.setItem(LS, JSON.stringify({ rate:self.rate, source:self.source, quotedAt:self.quotedAt, fetchedAt:self.fetchedAt })); } catch (e) {}
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

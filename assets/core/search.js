/* =============================================================
   search.js — 종목 검색 인덱스
   · 한글명 / 영문명 / 종목코드(티커) / 초성 검색 지원
   · 예) 'ㅅㅅㅈㅈ' → 삼성전자, 'sk하' → SK하이닉스, '005930' → 삼성전자
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const CHO_SET = {};
  CHO.forEach(function (c) { CHO_SET[c] = 1; });
  /* 겹자음 입력(ㄳ ㄵ …)도 대표 자음으로 취급 */
  const CHO_ALIAS = { 'ㄳ':'ㄱ','ㄵ':'ㄴ','ㄶ':'ㄴ','ㄺ':'ㄹ','ㄻ':'ㄹ','ㄼ':'ㄹ','ㄽ':'ㄹ','ㄾ':'ㄹ','ㄿ':'ㄹ','ㅀ':'ㄹ','ㅄ':'ㅂ' };

  function initials(str){
    let out = '';
    for (let i = 0; i < str.length; i++){
      const c = str.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) out += CHO[Math.floor((c - 0xAC00) / 588)];
      else out += str[i];
    }
    return out;
  }
  function isChoOnly(q){
    if (!q) return false;
    for (let i = 0; i < q.length; i++){
      const ch = q[i];
      if (!CHO_SET[ch] && !CHO_ALIAS[ch]) return false;
    }
    return true;
  }
  function normalizeCho(q){
    let out = '';
    for (let i = 0; i < q.length; i++) out += CHO_ALIAS[q[i]] || q[i];
    return out;
  }
  function norm(s){ return (s || '').toLowerCase().replace(/\s+/g, ''); }

  const Search = {
    items: [],
    build: function (items){
      this.items = items.map(function (it, i) {
        const name = it.n || it.name || '';
        const en = it.e || it.en || '';
        return {
          code: it.c || it.code, name:name, en:en,
          market: it.m || it.market, type: it.t || it.type || 'stock',
          cur: it.cur || 'KRW',
          _n: norm(name), _e: norm(en), _c: norm(it.c || it.code),
          _cho: initials(name.replace(/\s+/g, '')),
          _rank: i                                        // 시총 순으로 들어온 순서 = 인기도
        };
      });
      return this;
    },
    query: function (q, limit){
      q = (q || '').trim();
      if (!q) return [];
      const lower = norm(q), cho = isChoOnly(q) ? normalizeCho(q.replace(/\s+/g, '')) : null;
      const out = [];
      const items = this.items;
      for (let i = 0; i < items.length; i++){
        const it = items[i];
        let score = 0;
        if (cho){
          const at = it._cho.indexOf(cho);
          if (at === 0) score = 700;
          else if (at > 0) score = 380;
        } else {
          if (it._c === lower) score = 1000;
          else if (it._c.indexOf(lower) === 0) score = 900;
          else if (it._n === lower) score = 860;
          else if (it._n.indexOf(lower) === 0) score = 800;
          else if (it._e && it._e.indexOf(lower) === 0) score = 760;
          else if (it._n.indexOf(lower) > 0) score = 600;
          else if (it._e && it._e.indexOf(lower) > 0) score = 520;
          else if (it._cho.indexOf(normalizeCho(q)) === 0) score = 480;
        }
        if (!score) continue;
        if (it.type === 'etf') score -= 12;                // 동점이면 주식 우선
        score -= Math.min(90, it._rank / 40);              // 시총 상위 우선
        out.push({ item:it, score:score });
      }
      out.sort(function (a, b) { return b.score - a.score; });
      return out.slice(0, limit || 12).map(function (r) { return r.item; });
    },
    /** 일치 구간을 <mark> 로 감싼 HTML (초성 검색이면 앞 n글자 강조) */
    highlight: function (name, q){
      const esc = function (s) { return s.replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); };
      q = (q || '').trim();
      if (!q) return esc(name);
      if (isChoOnly(q)){
        const cho = normalizeCho(q.replace(/\s+/g, ''));
        const at = initials(name.replace(/\s+/g, '')).indexOf(cho);
        if (at < 0) return esc(name);
        return esc(name.slice(0, at)) + '<mark>' + esc(name.slice(at, at + cho.length)) + '</mark>' + esc(name.slice(at + cho.length));
      }
      const at = norm(name).indexOf(norm(q));
      if (at < 0) return esc(name);
      return esc(name.slice(0, at)) + '<mark>' + esc(name.slice(at, at + q.length)) + '</mark>' + esc(name.slice(at + q.length));
    },
    initials: initials
  };

  QT.Search = Search;
})(window.QT);

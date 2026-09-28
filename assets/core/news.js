/* =============================================================
   news.js — 증시 · 경제 뉴스 피드 (금리/물가 · 실적 · 증시동향)

   수집 경로 (위에서부터 시도)
     1) 실시간 : 언론사 RSS → 중계 서버 → 브라우저
        · 언론사 RSS 는 CORS 헤더가 없어 브라우저가 직접 읽을 수 없습니다.
        · 기본값은 rss2json 공개 API, 설정에서 자체 프록시 주소({url} 치환)로 바꿀 수 있습니다.
     2) 스냅샷 : assets/data/news.json (tools/build_news.py 로 수집)
   외부에서 온 텍스트는 화면에서 반드시 이스케이프해서 표시합니다(app.js esc()).
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const LS = 'qt.news.config.v1';
  const REFRESH_MS = 5 * 60 * 1000;
  const TIMEOUT_MS = 9000;
  const MAX_ITEMS = 60;
  const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url={url}';

  const FEEDS = [
    { src:'연합뉴스', url:'https://www.yna.co.kr/rss/economy.xml' },
    { src:'연합뉴스', url:'https://www.yna.co.kr/rss/market.xml' },
    { src:'한국경제', url:'https://www.hankyung.com/feed/finance' },
    { src:'한국경제', url:'https://www.hankyung.com/feed/economy' },
    { src:'매일경제', url:'https://www.mk.co.kr/rss/50200011/' }
  ];

  const CATS = { rate:'금리/물가', earn:'실적', market:'증시동향', etc:'경제' };
  /* 제목 가중 2, 요약 가중 1 로 키워드 개수를 세고, 동점이면 실적 > 금리/물가 > 증시동향 */
  const KEYWORDS = [
    { cat:'earn', re:/실적|영업이익|영업손실|순이익|매출액|어닝|잠정\s?실적|컨센서스|가이던스|흑자\s?전환|적자\s?전환|서프라이즈|쇼크|EPS|분기\s?최대/g },
    { cat:'rate', re:/금리|기준금리|연준|Fed|FOMC|파월|한은|한국은행|금통위|물가|CPI|PPI|PCE|인플레|디플레|국채|국고채|채권|긴축|완화|피벗|환율|달러|원화|엔화|유가/g },
    { cat:'market', re:/코스피|코스닥|증시|나스닥|다우|S&P|뉴욕증시|주가|지수|외국인|기관|순매수|순매도|개인\s?투자자|마감|급등|급락|상승세|하락세|ETF|공매도|시가총액|시총|반도체주|랠리|매도세|매수세|상장|IPO|거래대금/g }
  ];
  function count(re, s){ re.lastIndex = 0; const m = s.match(re); return m ? m.length : 0; }
  function classify(title, desc){
    let best = 'etc', bs = 0;
    KEYWORDS.forEach(function (k) {
      const s = count(k.re, title || '') * 2 + count(k.re, desc || '');
      if (s > bs){ bs = s; best = k.cat; }
    });
    return best;
  }

  /* ---------- 설정 ---------- */
  function readConfig(){
    const file = (window.QT_CONFIG && window.QT_CONFIG.news) || {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) {}
    return { mode: saved.mode || file.mode || 'auto', proxy: saved.proxy != null ? saved.proxy : (file.proxy || '') };
  }
  function endpoint(cfg, feedUrl){
    const tpl = cfg.mode === 'proxy' && cfg.proxy ? cfg.proxy : RSS2JSON;
    const enc = encodeURIComponent(feedUrl);
    return tpl.indexOf('{url}') >= 0 ? tpl.replace('{url}', enc) : tpl + (tpl.indexOf('?') >= 0 ? '&' : '?') + 'url=' + enc;
  }

  /* ---------- 파싱 ---------- */
  function plainText(html){
    if (!html) return '';
    try {
      const doc = new DOMParser().parseFromString(String(html), 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (e) { return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  }
  function safeLink(u){ return /^https?:\/\//i.test(u || '') ? u : ''; }
  function parseTime(s){
    if (!s) return NaN;
    /* rss2json: 'YYYY-MM-DD HH:mm:ss' (UTC) */
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return Date.parse(s.replace(' ', 'T') + 'Z');
    return Date.parse(s);
  }
  function norm(raw, src){
    const title = plainText(raw.title);
    if (!title) return null;
    const desc = plainText(raw.desc).slice(0, 180);
    return { title:title, desc:desc === title ? '' : desc, link:safeLink(raw.link), src:raw.src || src,
             t:parseTime(raw.t), cat:raw.cat && CATS[raw.cat] ? raw.cat : classify(title, desc) };
  }
  function parseBody(text, feed){
    const s = text.trim();
    if (s.charAt(0) === '{' || s.charAt(0) === '['){
      const j = JSON.parse(s);
      if (j.status && j.status !== 'ok') throw new Error(j.message || 'feed error');
      const items = j.items || j.data || (Array.isArray(j) ? j : []);
      return items.map(function (it) {
        return norm({ title:it.title, desc:it.description || it.content || it.summary, link:it.link || it.url,
                      t:it.pubDate || it.published || it.date, src:it.source }, feed.src);
      });
    }
    const doc = new DOMParser().parseFromString(s, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('RSS 파싱 실패');
    const nodes = Array.prototype.slice.call(doc.querySelectorAll('item, entry'));
    return nodes.map(function (n) {
      const g = function (sel) { const x = n.querySelector(sel); return x ? x.textContent : ''; };
      const linkEl = n.querySelector('link');
      const link = linkEl ? (linkEl.getAttribute('href') || linkEl.textContent) : '';
      return norm({ title:g('title'), desc:g('description') || g('summary'), link:link, t:g('pubDate') || g('updated') || g('published') }, feed.src);
    });
  }

  function fetchText(url){
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    return fetch(url, { signal: ctl ? ctl.signal : undefined, cache:'no-store' }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }, function (e) { clearTimeout(timer); throw e; });
  }

  function dedupe(items){
    const seen = {}, out = [];
    items.filter(Boolean).forEach(function (it) {
      const k = it.title.replace(/[\s\[\]\(\)'"“”‘’·…,.]/g, '').slice(0, 40);
      if (seen[k]) return;
      seen[k] = 1; out.push(it);
    });
    return out.sort(function (a, b) { return (b.t || 0) - (a.t || 0); }).slice(0, MAX_ITEMS);
  }

  /* ---------- 상태 ---------- */
  const News = {
    CATS:CATS, FEEDS:FEEDS, classify:classify,
    items:[], snapshotAt:null,
    active:false,                                   // 뉴스 패널이 열려 있을 때만 자동 갱신
    status:{ mode:'idle', updatedAt:null, source:'', message:'' },
    _subs:[], _busy:null, _timer:null, _snap:null,

    on: function (fn){ this._subs.push(fn); return this; },
    _emit: function (){ const self = this; this._subs.forEach(function (f) { try { f(self); } catch (e) { console.error(e); } }); },
    getConfig: function (){ return readConfig(); },
    applyConfig: function (patch){
      const c = Object.assign(readConfig(), patch || {});
      try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) {}
      this.status = Object.assign({}, this.status, { updatedAt:null });
      return this.active ? this.refresh(true) : Promise.resolve(this);
    },

    _snapshot: function (){
      const self = this;
      if (!this._snap){
        this._snap = fetch('assets/data/news.json', { cache:'no-cache' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (!j || !j.items) return [];
            self.snapshotAt = j.updated || null;
            return dedupe(j.items.map(function (it) { return norm(it, it.src); }));
          })
          .catch(function () { return []; });
      }
      return this._snap;
    },

    /** 뉴스 갱신. 진행 중이면 같은 작업을 공유합니다. */
    refresh: function (force){
      const self = this;
      if (this._busy) return this._busy;
      if (!force && this.status.updatedAt && Date.now() - this.status.updatedAt < REFRESH_MS / 2) return Promise.resolve(this);
      const cfg = readConfig();
      this.status = Object.assign({}, this.status, { mode:'loading' });
      this._emit();

      const live = cfg.mode === 'off' ? Promise.resolve([]) : Promise.all(FEEDS.map(function (f) {
        return fetchText(endpoint(cfg, f.url)).then(function (txt) { return { ok:true, items:parseBody(txt, f) }; })
          .catch(function (e) { return { ok:false, feed:f, error:e }; });
      }));

      this._busy = Promise.all([live, this._snapshot()]).then(function (res) {
        const got = res[0].filter(function (r) { return r.ok; });
        const liveItems = [].concat.apply([], got.map(function (r) { return r.items; }));
        const snap = res[1];
        const via = cfg.mode === 'proxy' && cfg.proxy ? '사용자 프록시' : 'rss2json';
        if (liveItems.length){
          self.items = dedupe(liveItems.length < 12 ? liveItems.concat(snap) : liveItems);
          self.status = { mode:'live', updatedAt:Date.now(), source:via + ' · 언론사 RSS ' + got.length + '/' + FEEDS.length,
                          message: got.length < FEEDS.length ? (FEEDS.length - got.length) + '개 피드 응답 없음' : '' };
        } else if (snap.length){
          self.items = snap;
          self.status = { mode:'snapshot', updatedAt:Date.now(), source:'news.json 스냅샷',
                          message: cfg.mode === 'off' ? '실시간 수신 꺼짐' : '실시간 피드 연결 실패 — 저장된 스냅샷을 표시합니다' };
        } else {
          self.items = [];
          self.status = { mode: cfg.mode === 'off' ? 'off' : 'error', updatedAt:Date.now(), source:'',
                          message: cfg.mode === 'off' ? '실시간 뉴스 수신이 꺼져 있습니다' : '뉴스 피드에 연결하지 못했습니다' };
        }
        self._busy = null;
        self._emit();
        return self;
      });
      return this._busy;
    },

    /** 뉴스 패널이 열려 있고 탭이 보일 때 5분마다 자동 갱신 */
    start: function (){
      const self = this;
      if (this._timer) return this;
      this._timer = setInterval(function () { if (self.active && !document.hidden) self.refresh(true); }, REFRESH_MS);
      this.refresh();
      return this;
    },

    list: function (cat){ return cat ? this.items.filter(function (x) { return x.cat === cat; }) : this.items.slice(); }
  };

  QT.News = News;
})(window.QT);

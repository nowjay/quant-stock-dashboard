/* =============================================================
   indicators.js — 순수 계산 함수 모음 (입력 배열과 같은 길이, 미확정 구간은 null)
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  function sma(a, p){
    const out = new Array(a.length).fill(null); let s = 0;
    for (let i = 0; i < a.length; i++){ s += a[i]; if (i >= p) s -= a[i - p]; if (i >= p - 1) out[i] = s / p; }
    return out;
  }
  function ema(a, p){
    const out = new Array(a.length).fill(null);
    if (a.length < p) return out;
    let s = 0; for (let i = 0; i < p; i++) s += a[i];
    let prev = s / p; out[p - 1] = prev;
    const k = 2 / (p + 1);
    for (let i = p; i < a.length; i++){ prev = a[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }
  function bollinger(a, p, mult){
    const mid = sma(a, p), up = new Array(a.length).fill(null), lo = new Array(a.length).fill(null);
    for (let i = 0; i < a.length; i++){
      if (mid[i] == null) continue;
      let s = 0; for (let j = i - p + 1; j <= i; j++){ const d = a[j] - mid[i]; s += d * d; }
      const sd = Math.sqrt(s / p);
      up[i] = mid[i] + mult * sd; lo[i] = mid[i] - mult * sd;
    }
    return { mid:mid, up:up, lo:lo };
  }
  function rsi(a, p){                                   // Wilder smoothing
    const out = new Array(a.length).fill(null);
    if (a.length <= p) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++){ const d = a[i] - a[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= p; l /= p;
    out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = p + 1; i < a.length; i++){
      const d = a[i] - a[i - 1];
      g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
      l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function macd(a, f, s, sig){
    const ef = ema(a, f), es = ema(a, s);
    const line = a.map(function (_, i) { return (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null; });
    const off = line.findIndex(function (v) { return v != null; });
    const signal = new Array(a.length).fill(null);
    if (off >= 0){
      const sg = ema(line.slice(off), sig);
      for (let i = 0; i < sg.length; i++) if (sg[i] != null) signal[off + i] = sg[i];
    }
    const hist = line.map(function (v, i) { return (v != null && signal[i] != null) ? v - signal[i] : null; });
    return { line:line, signal:signal, hist:hist };
  }
  function stochastic(bars, p, k){
    const raw = new Array(bars.length).fill(null);
    for (let i = p - 1; i < bars.length; i++){
      let hi = -Infinity, lo = Infinity;
      for (let j = i - p + 1; j <= i; j++){ if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l; }
      raw[i] = hi === lo ? 50 : (bars[i].c - lo) / (hi - lo) * 100;
    }
    const off = raw.findIndex(function (v) { return v != null; });
    const sm = sma(raw.filter(function (v) { return v != null; }), k), out = new Array(bars.length).fill(null);
    for (let i = 0; i < sm.length; i++) if (sm[i] != null) out[off + i] = sm[i];
    return out;
  }
  function cci(bars, p){
    const out = new Array(bars.length).fill(null);
    const tp = bars.map(function (b) { return (b.h + b.l + b.c) / 3; }), m = sma(tp, p);
    for (let i = 0; i < bars.length; i++){
      if (m[i] == null) continue;
      let dev = 0; for (let j = i - p + 1; j <= i; j++) dev += Math.abs(tp[j] - m[i]);
      dev /= p;
      out[i] = dev === 0 ? 0 : (tp[i] - m[i]) / (0.015 * dev);
    }
    return out;
  }
  function williamsR(bars, p){
    const out = new Array(bars.length).fill(null);
    for (let i = p - 1; i < bars.length; i++){
      let hi = -Infinity, lo = Infinity;
      for (let j = i - p + 1; j <= i; j++){ if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l; }
      out[i] = hi === lo ? -50 : (hi - bars[i].c) / (hi - lo) * -100;
    }
    return out;
  }
  function atr(bars, p){
    const tr = bars.map(function (b, i) {
      return i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i-1].c), Math.abs(b.l - bars[i-1].c));
    });
    return ema(tr, p);
  }
  /* Wilder 평활 (RMA) — 첫 값은 p개 단순평균 */
  function rma(a, p, from){
    const out = new Array(a.length).fill(null);
    const st = from || 0;
    if (a.length - st < p) return out;
    let s = 0; for (let i = st; i < st + p; i++) s += a[i];
    let prev = s / p; out[st + p - 1] = prev;
    for (let i = st + p; i < a.length; i++){ prev = (prev * (p - 1) + a[i]) / p; out[i] = prev; }
    return out;
  }
  /* ADX · +DI · −DI (Wilder, 14) — 추세의 '세기'와 방향 */
  function adx(bars, p){
    const n = bars.length, tr = new Array(n).fill(0), pdm = new Array(n).fill(0), mdm = new Array(n).fill(0);
    for (let i = 1; i < n; i++){
      const up = bars[i].h - bars[i-1].h, dn = bars[i-1].l - bars[i].l;
      pdm[i] = up > dn && up > 0 ? up : 0;
      mdm[i] = dn > up && dn > 0 ? dn : 0;
      tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i-1].c), Math.abs(bars[i].l - bars[i-1].c));
    }
    const str = rma(tr, p, 1), spd = rma(pdm, p, 1), smd = rma(mdm, p, 1);
    const pdi = new Array(n).fill(null), mdi = new Array(n).fill(null), dx = new Array(n).fill(0);
    let first = -1;
    for (let i = 0; i < n; i++){
      if (str[i] == null || !str[i]) continue;
      pdi[i] = spd[i] / str[i] * 100; mdi[i] = smd[i] / str[i] * 100;
      const sum = pdi[i] + mdi[i];
      dx[i] = sum ? Math.abs(pdi[i] - mdi[i]) / sum * 100 : 0;
      if (first < 0) first = i;
    }
    return { adx: first < 0 ? new Array(n).fill(null) : rma(dx, p, first), pdi:pdi, mdi:mdi };
  }
  /* OBV — 상승일 거래량 누적 − 하락일 거래량 누적 */
  function obv(bars){
    const out = new Array(bars.length).fill(0);
    for (let i = 1; i < bars.length; i++){
      const v = bars[i].v || 0, d = bars[i].c - bars[i-1].c;
      out[i] = out[i-1] + (d > 0 ? v : d < 0 ? -v : 0);
    }
    return out;
  }
  /* MFI — 거래량을 반영한 RSI (14) */
  function mfi(bars, p){
    const n = bars.length, out = new Array(n).fill(null);
    const tp = bars.map(function (b) { return (b.h + b.l + b.c) / 3; });
    for (let i = p; i < n; i++){
      let pos = 0, neg = 0;
      for (let j = i - p + 1; j <= i; j++){
        const f = tp[j] * (bars[j].v || 0);
        if (tp[j] > tp[j-1]) pos += f; else if (tp[j] < tp[j-1]) neg += f;
      }
      out[i] = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
    }
    return out;
  }
  /* 두 시계열의 최근 교차: dir 1 = a가 b를 상향 돌파, ago = 최근 봉 기준 경과 봉수 */
  function lastCross(a, b, lookback){
    const n = Math.min(a.length, b.length), start = Math.max(1, n - lookback);
    for (let i = n - 1; i >= start; i--){
      if (a[i] == null || b[i] == null || a[i-1] == null || b[i-1] == null) continue;
      const before = a[i-1] - b[i-1], now = a[i] - b[i];
      if (before <= 0 && now > 0) return { i:i, dir:1, ago:n - 1 - i };
      if (before >= 0 && now < 0) return { i:i, dir:-1, ago:n - 1 - i };
    }
    return null;
  }
  function set(bars){
    const c = bars.map(function (b) { return b.c; });
    const bb = bollinger(c, 20, 2), md = macd(c, 12, 26, 9), dm = adx(bars, 14);
    return {
      close:c,
      sma5:sma(c,5), sma10:sma(c,10), sma20:sma(c,20), sma50:sma(c,50),
      sma60:sma(c,60), sma120:sma(c,120), sma200:sma(c,200), ema20:ema(c,20),
      bbUp:bb.up, bbMid:bb.mid, bbLow:bb.lo,
      rsi:rsi(c,14), macd:md.line, macdSignal:md.signal, macdHist:md.hist,
      stoch:stochastic(bars,14,3), cci:cci(bars,20), wr:williamsR(bars,14), atr:atr(bars,14),
      adx:dm.adx, pdi:dm.pdi, mdi:dm.mdi, obv:obv(bars), mfi:mfi(bars,14),
      vol:bars.map(function (b) { return b.v || 0; })
    };
  }

  QT.Indicators = { sma:sma, ema:ema, bollinger:bollinger, rsi:rsi, macd:macd,
    stochastic:stochastic, cci:cci, williamsR:williamsR, atr:atr, adx:adx, obv:obv, mfi:mfi, lastCross:lastCross, set:set };
})(window.QT);

/* =============================================================
   patterns.js — 최근 기술적 이벤트 감지 (차트 마커 · '최근 신호' 카드)

   · 이동평균 골든/데드크로스 (20·50, 50·200), MACD 시그널 교차
   · RSI 다이버전스 (가격 신저가인데 RSI 는 높은 저점 → 상승 / 반대 → 하락)
   · 캔들 패턴 (장악형 · 망치형 · 유성형 · 도지) — 직전 흐름을 함께 봄
   · 20일 박스권 돌파/이탈 (거래량 동반 여부), 거래량 급증
   반환: [{ i, t, dir(+1/−1/0), kind, title, desc, weight }] 최신순
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  function fin(v){ return v != null && isFinite(v); }
  function crosses(a, b, from, to){
    const out = [];
    for (let i = Math.max(1, from); i <= to; i++){
      if (!fin(a[i]) || !fin(b[i]) || !fin(a[i-1]) || !fin(b[i-1])) continue;
      const pre = a[i-1] - b[i-1], now = a[i] - b[i];
      if (pre <= 0 && now > 0) out.push({ i:i, dir:1 });
      else if (pre >= 0 && now < 0) out.push({ i:i, dir:-1 });
    }
    return out;
  }
  /* 좌우 k봉 기준 스윙 저점/고점 */
  function pivots(bars, key, k, from, to){
    const out = [];
    for (let i = Math.max(k, from); i <= to - k; i++){
      let ok = true;
      for (let j = i - k; j <= i + k && ok; j++){
        if (j === i) continue;
        if (key === 'l' ? bars[j].l < bars[i].l : bars[j].h > bars[i].h) ok = false;
      }
      if (ok) out.push(i);
    }
    return out;
  }

  function detect(bars, ind, lookback){
    const n = bars.length, L = lookback || 60, from = Math.max(2, n - L), last = n - 1, ev = [];
    function push(i, dir, kind, title, desc, weight){ ev.push({ i:i, t:bars[i].t, dir:dir, kind:kind, title:title, desc:desc, weight:weight || 1 }); }

    crosses(ind.sma20, ind.sma50, from, last).forEach(function (x) {
      push(x.i, x.dir, 'cross', x.dir > 0 ? '골든크로스 (20·50일선)' : '데드크로스 (20·50일선)',
        x.dir > 0 ? '단기 이동평균이 중기선을 위로 뚫었습니다. 상승 추세 전환 신호로 봅니다.'
                  : '단기 이동평균이 중기선 아래로 내려왔습니다. 하락 전환 경계 신호입니다.', 2);
    });
    crosses(ind.sma50, ind.sma200, Math.max(2, n - 250), last).forEach(function (x) {
      push(x.i, x.dir, 'cross', x.dir > 0 ? '장기 골든크로스 (50·200일선)' : '장기 데드크로스 (50·200일선)',
        x.dir > 0 ? '중기선이 장기선을 돌파했습니다. 수개월 단위 상승 추세의 대표 신호입니다.'
                  : '중기선이 장기선 아래로 내려왔습니다. 장기 약세 전환 신호입니다.', 3);
    });
    crosses(ind.macd, ind.macdSignal, Math.max(2, n - 30), last).forEach(function (x) {
      push(x.i, x.dir, 'macd', x.dir > 0 ? 'MACD 골든크로스' : 'MACD 데드크로스',
        x.dir > 0 ? '상승 모멘텀이 살아나고 있습니다.' : '상승 힘이 약해지고 있습니다.', 1);
    });

    /* RSI 다이버전스 — 최근 두 스윙 저점/고점 비교 */
    const lows = pivots(bars, 'l', 3, from, last), highs = pivots(bars, 'h', 3, from, last);
    for (let k = lows.length - 1; k > 0; k--){
      const a = lows[k - 1], b = lows[k];
      if (b - a < 5 || b - a > 40 || last - b > 15) continue;
      if (bars[b].l < bars[a].l && fin(ind.rsi[a]) && fin(ind.rsi[b]) && ind.rsi[b] > ind.rsi[a] + 2){
        push(b, 1, 'div', 'RSI 상승 다이버전스', '주가는 전저점보다 낮아졌지만 RSI는 오히려 높아졌습니다. 하락 힘이 약해져 반등 가능성이 커지는 신호입니다.', 2);
      }
      break;
    }
    for (let k = highs.length - 1; k > 0; k--){
      const a = highs[k - 1], b = highs[k];
      if (b - a < 5 || b - a > 40 || last - b > 15) continue;
      if (bars[b].h > bars[a].h && fin(ind.rsi[a]) && fin(ind.rsi[b]) && ind.rsi[b] < ind.rsi[a] - 2){
        push(b, -1, 'div', 'RSI 하락 다이버전스', '주가는 전고점을 넘었지만 RSI는 더 낮아졌습니다. 상승 힘이 빠지고 있어 조정 가능성에 유의하세요.', 2);
      }
      break;
    }

    /* 캔들 패턴 — 최근 5봉, 직전 5봉 흐름과 함께 판단 */
    for (let i = Math.max(6, n - 5); i <= last; i++){
      const b = bars[i], p = bars[i - 1], body = Math.abs(b.c - b.o), range = b.h - b.l;
      if (!(range > 0)) continue;
      const prior = (p.c - bars[i - 6].c) / bars[i - 6].c;
      const upper = b.h - Math.max(b.o, b.c), lower = Math.min(b.o, b.c) - b.l;
      if (b.c > b.o && p.c < p.o && b.c >= p.o && b.o <= p.c && body > Math.abs(p.c - p.o) && prior < 0)
        push(i, 1, 'candle', '상승 장악형 캔들', '하락 뒤 양봉이 전날 음봉 몸통을 완전히 감쌌습니다. 매수세가 주도권을 가져온 반전 신호입니다.', 2);
      else if (b.c < b.o && p.c > p.o && b.o >= p.c && b.c <= p.o && body > Math.abs(p.c - p.o) && prior > 0)
        push(i, -1, 'candle', '하락 장악형 캔들', '상승 뒤 음봉이 전날 양봉 몸통을 감쌌습니다. 매도세가 우세해진 반전 신호입니다.', 2);
      else if (lower >= body * 2 && upper <= body * 0.6 && body / range < 0.4 && prior < -0.02)
        push(i, 1, 'candle', '망치형 캔들', '하락 중 긴 아래꼬리가 생겼습니다. 저가 매수세가 들어와 바닥을 다질 수 있다는 신호입니다.', 1);
      else if (upper >= body * 2 && lower <= body * 0.6 && body / range < 0.4 && prior > 0.02)
        push(i, -1, 'candle', '유성형 캔들', '상승 중 긴 위꼬리가 생겼습니다. 고가에서 매도 물량이 나와 상승이 막힐 수 있습니다.', 1);
      else if (body / range < 0.1 && Math.abs(prior) > 0.03)
        push(i, 0, 'candle', '도지 캔들', '시가와 종가가 거의 같아 매수·매도 힘이 팽팽합니다. 추세가 바뀌기 직전에 자주 나타납니다.', 1);
    }

    /* 20일 박스권 돌파/이탈 · 거래량 급증 (최근 10봉) */
    function box(i){                                   // i 직전 20봉의 고저 · 평균 거래량
      let hi = -Infinity, lo = Infinity, v = 0;
      for (let j = i - 20; j < i; j++){ hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); v += bars[j].v || 0; }
      return { hi:hi, lo:lo, v:v / 20 };
    }
    for (let i = Math.max(23, n - 10); i <= last; i++){
      const bx = box(i), pb = box(i - 1), hi = bx.hi, lo = bx.lo, v = bx.v;
      const vr = v > 0 ? (bars[i].v || 0) / v : 0, withVol = vr >= 1.5;
      /* 전날은 자기 박스 안, 오늘 처음으로 박스를 벗어난 경우만 */
      if (bars[i].c > hi && bars[i - 1].c <= pb.hi)
        push(i, 1, 'break', '20일 박스권 상단 돌파' + (withVol ? ' (거래량 동반)' : ''),
          '최근 한 달 고점을 종가로 넘어섰습니다.' + (withVol ? ' 거래량이 평소의 ' + vr.toFixed(1) + '배로 늘어 신뢰도가 높습니다.' : ' 거래량이 적어 추가 확인이 필요합니다.'), withVol ? 3 : 2);
      else if (bars[i].c < lo && bars[i - 1].c >= pb.lo)
        push(i, -1, 'break', '20일 박스권 하단 이탈' + (withVol ? ' (거래량 동반)' : ''),
          '최근 한 달 저점 아래로 마감했습니다.' + (withVol ? ' 거래량까지 늘어 추가 하락에 유의하세요.' : ''), withVol ? 3 : 2);
      else if (vr >= 2.5){
        const up = bars[i].c >= bars[i - 1].c;
        push(i, up ? 1 : -1, 'volume', '거래량 급증 (' + vr.toFixed(1) + '배)',
          up ? '평소보다 거래가 크게 늘며 올랐습니다. 새로운 매수 주체가 들어왔을 수 있습니다.'
             : '평소보다 거래가 크게 늘며 내렸습니다. 매도 물량이 쏟아진 흔적입니다.', 1);
      }
    }

    return ev.sort(function (a, b) { return b.i - a.i || b.weight - a.weight; });
  }

  QT.Patterns = { detect:detect };
})(window.QT);

/* =============================================================
   candles.js — 캔들(봉) 분석: 연속 봉 · 꼬리 · 몸통 패턴
   종합 점수(scoring.js) · 스크리너 기술 점수(signal.js) · 최근 신호 카드(patterns.js)가 같은 판정을 쓴다

   봉 하나가 만든 신호 (read) — 그 봉까지의 데이터만 사용. 세기 v 는 0~1
     · 연속 봉   : 음봉(양봉)이 3개 이상 이어지고 그동안 종가도 내려감(올라감). 3개 0.6 · 4개 이상 0.8
                   20일선 위의 연속 음봉 · 20일선 아래의 연속 양봉(흐름이 바뀌는 자리)은 그대로,
                   20일선 아래의 음봉 · 위의 양봉은 절반 — 그 방향은 추세 지표가 이미 점수에 넣고 있다
     · 꼬리      : 꼬리가 봉 길이(고가 − 저가)의 절반 이상이고 반대쪽 꼬리의 2배 이상. 봉 길이가 0.7 ATR 보다 짧으면 보지 않는다
                   위꼬리 = 위에서 판 물량(−), 아래꼬리 = 아래에서 산 물량(+)
                   상승 뒤 위꼬리(유성형) · 하락 뒤 아래꼬리(망치형) 0.8, 뚜렷한 흐름이 없을 때 0.5
                   하락 뒤 위꼬리(역망치형) · 상승 뒤 아래꼬리(교수형)는 해석이 갈려 신호로 치지 않는다
     · 몸통 패턴 : 장악형(직전 흐름과 반대 방향) 0.8 · 장대봉(몸통 1.5 ATR 이상이고 봉 길이의 70% 이상) 0.5
     · 도지      : 방향이 없다 — 최근 신호 카드에만 보이고 점수에는 들어가지 않는다
   '상승 뒤 / 하락 뒤' = 직전 5봉 동안 종가가 1 ATR 이상 움직임. 종목마다 하루 변동폭이 달라 % 대신 ATR 배수로 잰다
   (ATR 은 그 봉을 뺀 전날 값 — 큰 봉이 자기 자신의 기준을 키우지 않게)

   점수 (at) — 끝난 봉 e 시점의 캔들 값 −1 ~ +1
     · 연속 봉은 e 에서의 상태, 꼬리 · 몸통 패턴은 최근 3봉을 1 · 0.6 · 0.3 비중으로 더한다
     · 세 항목의 합 (±1 로 제한) — 방향이 엇갈리면 서로 지운다

   2026-10 측정 (tools/verify_ta.js --report ⑥): 어느 신호도 그 뒤 1 · 5 · 10거래일 수익률을 통계적으로 유의하게 가르지 못했다.
   방향과 세기는 통상적인 캔들 해석을 따른 것이고, 점수에서의 비중을 작게 둔 이유다 (scoring.js SIGNAL)
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  function fin(v){ return v != null && isFinite(v); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  const RULE = { run:3, wick:0.5, minRange:0.7, long:1.5, longBody:0.7, move:1, soldier:0.3, decay:[1, 0.6, 0.3] };

  /* i 에서 끝나는 같은 색 봉의 개수 — dir +1 양봉 · −1 음봉. 시가 = 종가인 봉에서 끊긴다 */
  function run(bars, i){
    const dir = Math.sign(bars[i].c - bars[i].o);
    let n = dir ? 1 : 0;
    while (n && i - n >= 0 && Math.sign(bars[i - n].c - bars[i - n].o) === dir) n++;
    return { dir:n ? dir : 0, n:n };
  }

  /**
   * i 번째 봉이 만든 캔들 신호 (i 까지의 봉만 사용)
   * @returns [{ key:'run'|'wick'|'body'|'doji', dir(+1/−1/0), v(0~1), title, desc, tag }]
   */
  function read(bars, ind, i){
    const out = [];
    if (i < 6) return out;
    const b = bars[i], p = bars[i - 1], atr = ind.atr[i - 1], range = b.h - b.l;
    if (!(atr > 0) || !(range > 0)) return out;
    const body = Math.abs(b.c - b.o), upper = b.h - Math.max(b.o, b.c), lower = Math.min(b.o, b.c) - b.l;
    const prior = (p.c - bars[i - 6].c) / atr, rose = prior >= RULE.move, fell = prior <= -RULE.move;
    function push(key, dir, v, title, desc, tag){ out.push({ key:key, dir:dir, v:v, title:title, desc:desc, tag:tag }); }

    /* 연속 봉 */
    const r = run(bars, i);
    if (r.n >= RULE.run && i - r.n >= 0 && (b.c - bars[i - r.n].c) * r.dir > 0){
      const ma = ind.sma20[i], bear = r.dir < 0, turn = fin(ma) && (bear ? b.c >= ma : b.c < ma);
      /* 삼병: 마지막 세 봉의 종가가 차례로 낮아(높아)지고 몸통이 모두 0.3 ATR 이상 */
      const strict = (b.c - p.c) * r.dir > 0 && (p.c - bars[i - 2].c) * r.dir > 0 &&
        [i, i - 1, i - 2].every(function (j) { return Math.abs(bars[j].c - bars[j].o) >= RULE.soldier * atr; });
      const where = !fin(ma) ? '' : b.c >= ma ? '20일선 위에서 ' : '20일선 아래에서 ';
      push('run', r.dir, (r.n >= 4 ? 0.8 : 0.6) * (turn ? 1 : 0.5),
        (bear ? '음봉 ' : '양봉 ') + r.n + '연속' + (strict ? (bear ? ' (흑삼병)' : ' (적삼병)') : ''),
        where + (bear ? '음봉이 ' + r.n + '개 이어졌습니다. 날마다 시가보다 낮게 마감해 매도세가 주도하고 있습니다.'
                      : '양봉이 ' + r.n + '개 이어졌습니다. 날마다 시가보다 높게 마감해 매수세가 주도하고 있습니다.') +
          (turn ? (bear ? ' 상승 흐름이 꺾일 수 있다는 신호입니다.' : ' 하락 흐름이 바뀔 수 있다는 신호입니다.')
                : (bear ? ' 이미 하락 중인 자리라 새로운 신호로는 약하게 봅니다.' : ' 이미 상승 중인 자리라 새로운 신호로는 약하게 봅니다.')),
        bear ? '#음봉연속' : '#양봉연속');
    }

    /* 꼬리 */
    if (range >= RULE.minRange * atr){
      if (upper >= RULE.wick * range && upper >= 2 * lower && !fell)
        push('wick', -1, rose ? 0.8 : 0.5, rose ? '유성형 캔들 (긴 위꼬리)' : '긴 위꼬리',
          rose ? '상승 중 긴 위꼬리가 생겼습니다. 고가에서 매도 물량이 나와 상승이 막힐 수 있습니다.'
               : '장중에 올랐다가 밀려 긴 위꼬리가 생겼습니다. 위에서 팔려는 물량이 많았다는 뜻입니다.', '#긴위꼬리');
      else if (lower >= RULE.wick * range && lower >= 2 * upper && !rose)
        push('wick', 1, fell ? 0.8 : 0.5, fell ? '망치형 캔들 (긴 아래꼬리)' : '긴 아래꼬리',
          fell ? '하락 중 긴 아래꼬리가 생겼습니다. 저가 매수세가 들어와 바닥을 다질 수 있다는 신호입니다.'
               : '장중에 밀렸다가 되올라 긴 아래꼬리가 생겼습니다. 아래에서 사려는 물량이 많았다는 뜻입니다.', '#긴아래꼬리');
    }

    /* 몸통 패턴 */
    const pb = Math.abs(p.c - p.o);
    if (b.c > b.o && p.c < p.o && b.c >= p.o && b.o <= p.c && body > pb && prior < 0)
      push('body', 1, 0.8, '상승 장악형 캔들', '하락 뒤 양봉이 전날 음봉 몸통을 완전히 감쌌습니다. 매수세가 주도권을 가져온 반전 신호입니다.', '#상승장악형');
    else if (b.c < b.o && p.c > p.o && b.o >= p.c && b.c <= p.o && body > pb && prior > 0)
      push('body', -1, 0.8, '하락 장악형 캔들', '상승 뒤 음봉이 전날 양봉 몸통을 감쌌습니다. 매도세가 우세해진 반전 신호입니다.', '#하락장악형');
    else if (body >= RULE.long * atr && body >= RULE.longBody * range)
      push('body', b.c > b.o ? 1 : -1, 0.5, b.c > b.o ? '장대양봉' : '장대음봉',
        '몸통이 평소 하루 변동폭의 ' + (body / atr).toFixed(1) + '배인 큰 ' + (b.c > b.o ? '양봉입니다. 꼬리 없이 올라 마감해 매수세가 압도했습니다.' : '음봉입니다. 꼬리 없이 내려 마감해 매도세가 압도했습니다.'),
        b.c > b.o ? '#장대양봉' : '#장대음봉');

    if (!out.some(function (s) { return s.key === 'wick'; }) && body < 0.1 * range && Math.abs(prior) >= RULE.move)
      push('doji', 0, 0, '도지 캔들', '시가와 종가가 거의 같아 매수·매도 힘이 팽팽합니다. 추세가 바뀌기 직전에 자주 나타납니다.');
    return out;
  }

  /**
   * e 번째(끝난) 봉 시점의 캔들 값
   * @returns {v(−1~+1), comps:[{key, name, v, value}], list:[{key, dir, v(부호 · 감쇠 반영), ago, title, desc, tag}]}
   */
  function at(bars, ind, e){
    const list = [];
    let runV = 0, wick = 0, body = 0;
    for (let k = 0; k < RULE.decay.length && e - k >= 0; k++){
      read(bars, ind, e - k).forEach(function (s) {
        const v = s.dir * s.v * RULE.decay[k];
        if (s.key === 'run'){ if (k) return; runV = v; }                 // 연속 봉은 지금 이어지고 있는 것만
        else if (s.key === 'wick') wick += v;
        else if (s.key === 'body') body += v;
        else return;
        list.push({ key:s.key, dir:s.dir, v:v, ago:k, title:s.title, desc:s.desc, tag:s.tag });
      });
    }
    const r = e >= 0 ? run(bars, e) : { dir:0, n:0 };
    wick = clamp(wick, -1, 1); body = clamp(body, -1, 1);
    return {
      v:clamp(runV + wick + body, -1, 1), list:list,
      comps:[{ key:'run', name:'연속 봉', v:runV, value:r.dir * r.n }, { key:'wick', name:'캔들 꼬리', v:wick, value:wick }, { key:'body', name:'캔들 몸통', v:body, value:body }]
    };
  }

  QT.Candles = { RULE:RULE, run:run, read:read, at:at };
})(window.QT);

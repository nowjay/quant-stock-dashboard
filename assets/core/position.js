/* =============================================================
   position.js — 평단가 기준 포지션 판단 (보유 종목의 손절 · 익절 · 추가 매수)

   종합 의견(scoring.js)은 차트만 보고 낸 등급이라 '내가 얼마에 샀는지'를 모른다.
   평단가를 넣으면 그 가격을 기준으로 손절선 · 익절선을 긋고 지금 어느 구간인지 판단한다.
   등급을 바꾸지는 않는다 — 화면에는 포지션 판단과 기술 등급을 나란히 보여 준다.

   기준 폭 = 종목의 하루 변동폭 ATR(14) 의 배수 (기본 손절 2 · 익절 3, 화면에서 조정)
     손절선 = 평단가 − 2 ATR        익절선 = 평단가 + 3 ATR
     고정 %(예: −10%)는 하루 6% 움직이는 종목에는 평소 움직임만으로 닿고, 2% 움직이는 종목에는 너무 멀다
   판단
     현재가 ≤ 손절선 → 매도(손절)      현재가 ≥ 익절선 → 매도(익절)
     그 사이 → 보유. 아래 셋을 모두 만족할 때만 '추가 매수 가능'
       · 종합 의견이 매수 이상 (추세가 살아 있음)
       · 시장 급락이 아님 (scoring.js marketAt)
       · 익절선까지 남은 폭 ≥ 손절선까지 남은 폭 (더 사는 가격에서 남은 손익비 1 이상)
   ATR 은 지금 값이다(매수한 날의 값이 아니다) — 변동성이 커지면 두 선도 평단가에서 멀어진다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';

  const RULE = { stop:2, take:3, min:0.5, max:10, step:0.5 };   // 기본 배수 · 조정 범위
  const BUY = 18;                                               // 종합 의견 '매수' 하한 (scoring.js verdictOf)
  const NEAR = 0.5;                                             // 선까지 이 ATR 이내면 '근접'
  const ACTIONS = {
    cut:  { label:'매도 · 손절', tone:'cut' },
    take: { label:'매도 · 익절', tone:'take' },
    add:  { label:'추가 매수 가능', tone:'add' },
    hold: { label:'보유', tone:'hold' }
  };

  function fin(v){ return v != null && isFinite(v); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  /** 배수를 조정 범위 안의 0.5 단위로 */
  function mult(v, def){ return fin(v) && v > 0 ? clamp(Math.round(v / RULE.step) * RULE.step, RULE.min, RULE.max) : def; }

  /**
   * @param p.avg     평단가 (종목 통화)
   * @param p.price   현재가
   * @param p.atr     ATR(14) — 가격 단위
   * @param p.score   종합 의견 점수 (시장 반영 후, −100~+100)
   * @param p.market  소속 지수 상태 (Scoring.marketAt 결과). 없으면 시장은 판단에서 뺀다
   * @param p.rule    { stop, take } ATR 배수
   * @param p.qty     보유 수량 (선택 — 평가손익 계산용)
   * @returns {action:'cut'|'take'|'add'|'hold', label, tone, pnl(%), pnlAtr, amount, stop:{v, pctAvg, pct}, take:{…},
   *           pos(손절선 0 ~ 익절선 1), avgPos, conds:[{key, ok}], near:'stop'|'take'|null, rule, atr, atrPct}
   *          평단가 · 현재가 · ATR 중 하나라도 없으면 null
   */
  function judge(p){
    if (!p || !(p.avg > 0) || !(p.price > 0) || !(p.atr > 0)) return null;
    const avg = p.avg, price = p.price, atr = p.atr;
    const kS = mult(p.rule && p.rule.stop, RULE.stop), kT = mult(p.rule && p.rule.take, RULE.take);
    const stop = avg - kS * atr, take = avg + kT * atr;
    /* 추가 매수 조건 — 손절선과 익절선 사이에 있을 때만 의미가 있다 */
    const conds = [
      { key:'trend',  ok:fin(p.score) && p.score >= BUY },
      { key:'market', ok:!(p.market && p.market.risk) },
      { key:'room',   ok:take - price >= price - stop }
    ];
    const action = price <= stop ? 'cut' : price >= take ? 'take' : conds.every(function (c) { return c.ok; }) ? 'add' : 'hold';
    const inside = action === 'add' || action === 'hold';
    return {
      action:action, label:ACTIONS[action].label, tone:ACTIONS[action].tone,
      avg:avg, price:price, atr:atr, atrPct:atr / price * 100, rule:{ stop:kS, take:kT },
      pnl:(price / avg - 1) * 100, pnlAtr:(price - avg) / atr, amount:p.qty > 0 ? (price - avg) * p.qty : null, qty:p.qty > 0 ? p.qty : null,
      stop:{ v:stop, pctAvg:-kS * atr / avg * 100, pct:(stop / price - 1) * 100 },
      take:{ v:take, pctAvg:kT * atr / avg * 100, pct:(take / price - 1) * 100 },
      pos:(price - stop) / (take - stop), avgPos:kS / (kS + kT),
      conds:conds, near: !inside ? null : price - stop <= NEAR * atr ? 'stop' : take - price <= NEAR * atr ? 'take' : null
    };
  }

  QT.Position = { judge:judge, mult:mult, RULE:RULE, ACTIONS:ACTIONS };
})(window.QT);

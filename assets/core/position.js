/* 포지션별 보호선과 최초 이탈을 저장한다. 손절선은 자동으로 내리지 않는다. */
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

  function protect(item, atr, rule, now){
    if (!item || !(item.avg > 0) || !(atr > 0) || !Number.isFinite(atr)) return false;
    const stop = item.avg - mult(rule && rule.stop, RULE.stop) * atr;
    const take = item.avg + mult(rule && rule.take, RULE.take) * atr;
    if (!(stop > 0)) return false;
    if (item.protection) return false;
    item.protection = { stop:stop, take:take, atr:atr, startedAt:now || Date.now(), breach:null };
    return true;
  }

  function observe(item, tick){
    const protection = item && item.protection;
    if (!protection || protection.breach || !Number.isFinite(tick.price) || !(tick.price > 0) || !Number.isFinite(tick.ts) || tick.ts < protection.startedAt) return false;
    if (tick.price > protection.stop) return false;
    protection.breach = { price:tick.price, ts:tick.ts };
    return true;
  }

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
    if (!p || !fin(p.avg) || !fin(p.price) || !fin(p.atr) || !(p.avg > 0) || !(p.price > 0) || !(p.atr > 0)) return null;
    const avg = p.avg, price = p.price, atr = p.protection ? p.protection.atr : p.atr;
    const kS = mult(p.rule && p.rule.stop, RULE.stop), kT = mult(p.rule && p.rule.take, RULE.take);
    const stop = p.protection ? p.protection.stop : avg - kS * atr, take = p.protection ? p.protection.take : avg + kT * atr;
    if (!(stop > 0) || !(take > stop)) return null;
    const existingRisk = p.qty > 0 ? Math.max(0, avg - stop) * p.qty : Infinity;
    const perShareRisk = price - stop;
    const addQty = p.riskBudget > existingRisk && p.cash > 0 && perShareRisk > 0
      ? Math.max(0, Math.min(Math.floor((p.riskBudget - existingRisk) / perShareRisk), Math.floor(p.cash / price))) : 0;
    /* 추가 매수 조건 — 손절선과 익절선 사이에 있을 때만 의미가 있다 */
    const conds = [
      { key:'trend',  ok:fin(p.score) && p.score >= BUY },
      { key:'market', ok:!!p.market && !p.market.risk && !p.market.downtrend },
      { key:'data', ok:!!p.entry && p.entry.allowed },
      { key:'budget', ok:addQty > 0 },
      { key:'room',   ok:take - price >= price - stop }
    ];
    const action = (p.protection && p.protection.breach) || price <= stop ? 'cut' : price >= take ? 'take' : conds.every(function (c) { return c.ok; }) ? 'add' : 'hold';
    const inside = action === 'add' || action === 'hold';
    return {
      addQty:addQty, breach:p.protection && p.protection.breach, action:action, label:ACTIONS[action].label, tone:ACTIONS[action].tone,
      avg:avg, price:price, atr:atr, atrPct:atr / price * 100, rule:{ stop:kS, take:kT },
      pnl:(price / avg - 1) * 100, pnlAtr:(price - avg) / atr, amount:p.qty > 0 ? (price - avg) * p.qty : null, qty:p.qty > 0 ? p.qty : null,
      stop:{ v:stop, pctAvg:(stop / avg - 1) * 100, pct:(stop / price - 1) * 100 },
      take:{ v:take, pctAvg:(take / avg - 1) * 100, pct:(take / price - 1) * 100 },
      pos:(price - stop) / (take - stop), avgPos:(avg - stop) / (take - stop),
      conds:conds, near: !inside ? null : price - stop <= NEAR * atr ? 'stop' : take - price <= NEAR * atr ? 'take' : null
    };
  }

  QT.Position = { protect:protect, observe:observe, judge:judge, mult:mult, RULE:RULE, ACTIONS:ACTIONS };
})(window.QT);

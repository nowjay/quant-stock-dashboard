/* =============================================================
   learn/chapters.js — '주식 공부' 단원 목록과 학습 주제 저장소
   주제 한 건의 모양 (data-*.js 가 add 로 넣는다):
     id · t(제목) · en(영문 · 약어) · lv(1 입문 · 2 기초 · 3 심화) · sum(한 줄 요약) · kw(검색어)
     body[문단] · formula[[이름, 식]] · ex{t, rows[]} · tbl{head[], rows[][], cap} · fig(그림 키) · figcap
     read[읽는 법] · warn[주의할 점] · rel[관련 주제 id] · app(앱에서 보기: chart | value | macro | home)
     asof(true 면 '제도 기준 시점' 안내) · quiz{q, a[], ok, why}
   숫자 예시는 모두 tools/verify_learn.js 가 다시 계산해 본문과 맞는지 확인합니다.
   ============================================================= */
window.QT = window.QT || {};
(function (QT) {
  'use strict';
  const D = {
    asOf:'2026년 10월',
    chapters:[
      { id:'basics',   t:'주식 시장 기초',        icon:'sprout',            d:'주식 · 거래소 · 주문 · 배당 · 세금처럼 투자 전에 알아야 할 기본기' },
      { id:'bond',     t:'채권과 금리',           icon:'landmark',          d:'채권 · 국채 · 수익률 · 기준금리 — 모든 자산 가격의 기준이 되는 금리 이해하기' },
      { id:'tech',     t:'기술적 분석',           icon:'candlestick-chart', d:'캔들 · 이동평균 · 골든크로스 · 볼린저 밴드 · RSI · MACD 등 차트 읽는 법' },
      { id:'value',    t:'가치 분석',             icon:'gem',               d:'재무제표 · PER · PBR · ROE · 현금흐름 · 적정주가로 기업의 값어치 따져 보기' },
      { id:'macro',    t:'거시경제 · 시장 읽기',  icon:'globe',             d:'물가 · 고용 · 환율 · 유동성 · 투자 심리 · 수급이 주가에 미치는 영향' },
      { id:'strategy', t:'투자 전략 · 위험 관리', icon:'shield-check',      d:'복리 · 분산 · 자산배분 · 손절 · 포지션 크기 — 오래 살아남는 방법' },
      { id:'product',  t:'투자 상품',             icon:'package',           d:'ETF · 레버리지 · 선물옵션 · 공매도 · 전환사채 · 공모주 · 절세 계좌' },
      { id:'mind',     t:'투자 심리 · 실수 줄이기', icon:'brain',           d:'심리 편향 · 흔한 실수 · 투자 원칙 · 사기 예방' }
    ],
    LEVEL:{ 1:'입문', 2:'기초', 3:'심화' },
    topics:[],
    byId:{},
    add:function (ch, list) {
      list.forEach(function (x) { x.ch = ch; D.topics.push(x); D.byId[x.id] = x; });
    }
  };
  QT.LearnData = D;
})(window.QT);

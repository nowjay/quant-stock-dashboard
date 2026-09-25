/* config.local.js 로 복사해서 사용하세요 (.gitignore 처리됨, 배포본에는 포함되지 않습니다)
   ⚠️ 브라우저에 두는 키는 페이지를 여는 누구에게나 노출됩니다.
      운영 환경에서는 토큰을 서버에 두고 proxyBase / wsUrl(wss) 만 지정하세요. */
window.QT_CONFIG = {
  provider: 'mock',              // 'mock' | 'kis' | 'toss'  — 실패 시 자동으로 mock 폴백

  // 한국투자증권 KIS — 실시간 체결가 WebSocket (H0STCNT0)
  kis: {
    approvalKey: '',             // POST /oauth2/Approval 로 발급한 실시간 접속키
    proxyBase: '',               // 권장: 토큰을 보관하는 자체 프록시
    wsUrl: '',                   // 비우면 ws://ops.koreainvestment.com:21000 (HTTPS 페이지에서는 wss 프록시 필요)
    demo: false                  // true 면 모의투자 포트(31000)
  },

  // 토스증권 Open API
  toss: {
    token: '',
    proxyBase: '',
    restBase: 'https://openapi.tossinvest.com',
    wsUrl: '',                   // 비우면 REST 1초 폴링
    pollMs: 1000
  }
};

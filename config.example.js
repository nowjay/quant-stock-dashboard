/* 이 파일을 config.local.js 로 복사한 뒤 값을 채우세요. config.local.js 는 .gitignore 처리되어 있습니다.
   ⚠️ 브라우저에서 직접 불러오는 키는 페이지를 여는 누구에게나 노출됩니다.
      실제 서비스에서는 반드시 서버(프록시)에서 토큰을 보관하고 proxyBase 만 지정하세요. */
window.QT_CONFIG = {
  provider: 'mock',            // 'mock' | 'toss'  — 연동 실패 시 자동으로 mock 으로 폴백합니다
  toss: {
    token: '',                 // tsck_live_... (개발용 임시 방식)
    proxyBase: '',             // 권장: 'https://내서버/toss' 처럼 토큰을 숨긴 프록시 주소
    restBase: 'https://openapi.tossinvest.com',
    wsUrl: '',                 // 실시간 WebSocket 공개 시 주소 입력 (미입력이면 REST 폴링)
    pollMs: 2000               // REST 폴링 주기(ms)
  }
};

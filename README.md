# QUANT — 주식 분석 대시보드 (Light)

토스 스타일의 화이트 테마 주식 대시보드입니다. 관심종목 관리, TradingView Lightweight Charts 기반
캔들·거래량·RSI·MACD 차트, 규칙 기반 기술적 분석과 단기/중기 전망을 한 화면에서 제공합니다.

```bash
python3 -m http.server 8777   # 프로젝트 폴더에서 실행 후 http://localhost:8777
```

> 모듈을 `<script src>`로 나눠 두었기 때문에 `file://`로 직접 열지 말고 위처럼 로컬 서버로 열어 주세요.

## 구성

```
index.html                  화면 마크업
assets/css/app.css          라이트 테마 토큰 및 레이아웃
assets/core/market-data.js  종목 유니버스 · 히스토리 · 봉 집계 · 틱 반영
assets/core/indicators.js   SMA/EMA/볼린저/RSI/MACD/Stoch/CCI/Williams/ATR
assets/core/analysis.js     종합 점수 · 크로스 · 피봇 · 목표가/손절가 · 전망 문장
assets/feed/mock.js         모의 실시간 시세 생성기 (Random Walk)
assets/feed/toss.js         토스증권 Open API 어댑터 (WebSocket / REST 폴링)
assets/feed/index.js        MarketFeed 파사드 (provider 선택 · 자동 폴백)
assets/app.js               사이드바 · 차트 · 분석 패널 렌더링
config.example.js           설정 템플릿 (복사해서 config.local.js 로 사용)
legacy/terminal-dark.html   이전 다크 터미널 버전 (단일 파일)
```

## 디자인 토큰

| 용도 | 값 |
|---|---|
| 페이지 배경 / 카드 | `#F9FAFB` / `#FFFFFF` |
| 구분선 | `#F3F4F6` (보조 `#E5E7EB`) |
| 그림자 | `0 1px 3px rgba(0,0,0,.05)` |
| 포인트 | 토스 블루 `#3182F6` |
| 상승 / 하락 | `#F04438` / `#3B82F6` (한국 시장 표준) |
| 서체 | Gothic A1 (UI) · IBM Plex Mono (코드·수치 라벨) · Lucide Icons |

## 실시간 시세 연동

데이터 소스는 `MarketFeed` 파사드 하나로 추상화되어 있고, 연결 실패 시 자동으로 모의 시세로 폴백합니다.

```
WebSocket(wsUrl 설정 시) → REST 폴링(pollMs) → Mock Feed
```

설정 방법은 두 가지입니다.

1. **화면 우상단 톱니 → 실시간 시세 연결** — 브라우저(localStorage)에 저장됩니다.
2. **`config.local.js`** — `config.example.js`를 복사해 값을 채웁니다. 이 파일은 `.gitignore`에 등록되어 있습니다.

```js
window.QT_CONFIG = {
  provider: 'toss',
  toss: {
    proxyBase: 'https://my-server.com/toss',  // 권장: 서버가 토큰 보관
    token: '',                                 // 개발용 직접 입력 (비권장)
    restBase: 'https://openapi.tossinvest.com',
    wsUrl: '',                                 // 실시간 WS 공개 시 입력
    pollMs: 2000
  }
};
```

### ⚠️ 토큰 취급 주의

- **브라우저에서 증권사 API를 직접 호출하면 CORS로 차단됩니다.** 실제 연동에는 토큰을 보관하고 시세만
  중계하는 **프록시 서버가 반드시 필요**합니다(`proxyBase`).
- 프런트엔드에 넣은 토큰은 페이지를 여는 누구나 볼 수 있습니다. 배포본·아티팩트에는 토큰을 포함하지 않았습니다.
- 채팅·저장소 등에 노출된 키는 **재발급(rotate)** 을 권장합니다.
- 토스증권 Open API는 2026년 8월 정식 오픈했으나 **실시간 WebSocket은 일반 공개 전**이라, 현재는 REST 폴링이 기본값입니다.

### 응답 스키마 흡수

`toss.js`의 `normalize()`가 대표적인 필드명(`code|symbol|isuSrtCd`, `price|closePrice|trdPrc` 등)을 흡수합니다.
엔드포인트 경로는 파일 상단 `ENDPOINTS` 상수에서 기관 문서에 맞게 바꿔 주세요.

```js
// 시세 틱 정규화 결과
{ code: '005930', price: 78600, volume: 1200, ts: 1758... }
```

과거 봉을 실데이터로 바꾸려면 `QT.Market.loadHistory(st)`를 `TossFeed.fetchCandles(code, interval, count)`
결과(`[{t,o,h,l,c,v}]`)로 대체하면 됩니다. 주/월/5분봉은 `aggregate()`가 자동 집계합니다.

## 분석 로직 요약

- **종합 점수** — 이동평균 6종 + 오실레이터 6종(RSI·Stoch·MACD·CCI·Williams %R·모멘텀)의 매수/매도 판정을
  합산하고, 정배열·역배열(±10)과 MACD 히스토그램 방향(±5)을 가중해 -100 ~ +100으로 산출합니다.
  `+55↑ 강력 매수 / +18↑ 매수 / ±18 중립 / -18↓ 매도 / -55↓ 강력 매도`
- **크로스** — SMA 20↔50(최근 60봉), 50↔200(최근 120봉), MACD↔시그널(최근 40봉)
- **피봇 포인트** — 직전 봉 기준 클래식: `P=(H+L+C)/3`, `R1=2P−L`, `S1=2P−H`, `R2=P+(H−L)`, `S2=P−(H−L)`
- **목표가 / 손절가** — 피봇 레벨과 최근 20·60봉 고저를 후보로 두고 ATR(14) 배수 범위 안에 있는 값을 채택,
  없으면 `현재가 ± ATR×배수`로 대체합니다. 손익비도 함께 표시합니다.
- **예상 등락 범위** — 최근 60봉 일간 수익률 표준편차 σ에 √10(2주) · √45(2개월)을 적용한 값입니다.

## 데이터에 대한 안내

API 미연동 상태의 시세는 종목코드를 시드로 생성한 **시뮬레이션 데이터**이며 실제 시장가와 무관합니다
(상단 배지에 `모의 시세`로 표시). 모든 지표·전망은 과거 가격의 수학적 계산 결과이며 투자 자문이 아닙니다.

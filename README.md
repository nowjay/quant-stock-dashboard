# QUANT — 주식 분석 대시보드

**🔗 배포 주소: https://nowjay.github.io/quant-stock-dashboard/** (모바일 대응)

관심종목 · 실시간 차트 · 기술적 분석 · 증시 일정을 한 화면에서 보는 라이트 테마 대시보드입니다.

```bash
python3 -m http.server 8777    # 프로젝트 폴더에서 실행 후 http://localhost:8777
```

> 모듈이 `<script src>`로 분리돼 있어 `file://`이 아닌 로컬 서버로 열어야 합니다.

## 데이터 출처 (중요)

| 항목 | 출처 | 성격 |
|---|---|---|
| 국내 전종목 · ETF 마스터 | 네이버 금융 | **실제** (KOSPI 2,484 · KOSDAQ 1,821 · ETF 1,175) |
| 미국 종목 마스터 | Wikipedia S&P 500 / NASDAQ-100 | **실제** |
| 국내 종목 현재가·등락률 | 네이버 금융 | **실제** (수집 시점 종가) |
| 대표 종목 일봉 | 네이버 금융 / Yahoo Finance | **실제** (2년치) |
| 그 외 종목의 과거 경로 | 시뮬레이션 | 최근 종가는 실제, **경로만 생성** → 화면에 `시뮬레이션 경로` 배지 |
| 분봉(1·5분) | 일봉에서 파생 | 시뮬레이션 (실시간 API 연결 시 실제 체결로 대체) |
| USD/KRW 환율 | frankfurter.dev → open.er-api.com | **실제**, 10분마다 갱신 |
| FOMC 일정 | federalreserve.gov | **실제 확정** |
| 미국 배당락·배당금 | Yahoo Finance | **실제 이력** |
| 실적발표일·주주총회·배당락(국내) | 과거 패턴 기반 추정 | `예상` 배지 표기 |

데이터는 `tools/build_dataset.py`, `tools/build_us.py`, `tools/build_events.py`로 언제든 재수집할 수 있습니다.

```bash
python3 tools/build_dataset.py      # 국내 전종목 + 대표 일봉
python3 tools/build_us.py           # 미국 종목 보강 + 대표 일봉
python3 tools/build_events.py       # FOMC · 배당 · 컨센서스
```

## 기능

### 1. 통화 표기 · 원화 환산
국내 종목은 `286,500원`, 미국 종목은 `$335.92` 로 통화를 명시합니다.
미국 종목은 현재 환율로 환산한 `≈ 459,800원 · $1 = 1,369원`을 함께 보여줍니다(환율 출처·기준일은 툴팁).

### 2. 실시간 시세
연결 우선순위는 **WebSocket → REST 1초 폴링 → 모의 시세**입니다.

- `assets/feed/kis.js` — 한국투자증권 KIS 실시간 체결가(`H0STCNT0`) 파서, PINGPONG 응답, 지수 백오프 재연결(최대 5회)
- `assets/feed/toss.js` — 토스증권 Open API (WebSocket 또는 REST 폴링)
- `assets/feed/mock.js` — 랜덤워크 모의 시세 (연동 전/실패 시 자동 전환)
- `assets/feed/index.js` — 위 셋을 고르고 폴백하는 파사드. 15초간 체결이 없으면 워치독이 재연결

차트 우상단에 **`🟢 실시간 수신 중 · 14:03:21`** 배지로 상태와 마지막 수신 시각을 표시합니다.

> ⚠️ 브라우저에서 증권사 API를 직접 호출하면 CORS로 차단되고, HTTPS 페이지에서는 `ws://`도 차단됩니다.
> 실거래 연동에는 토큰을 보관하고 `wss://`로 중계하는 **프록시 서버가 필요**합니다.

### 3. 주요 일정 (Events & Earnings)
우측 패널 `주요 일정` 탭에서 선택 종목의 실적 발표, 분기·사업보고서 제출기한, 배당락일, 정기 주주총회,
미국 종목의 실제 배당 이력·액면분할을 타임라인으로 보여줍니다. 아래에는 FOMC 정례회의와
지수 옵션/동시 만기일 등 증시 공통 일정이 표시되며, 각 항목에 `확정 / 규칙 / 예상` 배지가 붙습니다.
국내 종목은 네이버 컨센서스(목표주가·투자의견)도 함께 표시합니다.

### 4. 검색 · 자동완성
`assets/core/search.js` 가 **한글명 · 영문명 · 종목코드 · 초성**을 모두 인덱싱합니다.

- `ㅅㅅㅈㅈ` → 삼성전자, `ㅋㅋㅇㅂㅋ` → 카카오뱅크
- `005930`, `AAPL`, `hynix` 모두 매칭
- 입력 즉시 드롭다운이 열리고 `↑↓` 이동, `Enter` 선택, `Esc` 닫기

### 기술적 분석
12개 지표(이동평균 6 + 오실레이터 6) 종합 점수 게이지, 골든/데드크로스, RSI 과매수·과매도,
MACD 시그널 교차, 피봇 기준 지지·저항 2단계, 단기(1~2주)·중기(1~3개월) 전망과 목표가·손절가·손익비를 제공합니다.

## 구성

```
index.html                     화면 마크업
assets/css/app.css             라이트 테마 토큰 · 레이아웃
assets/core/market-data.js     종목 마스터 · 시세 · 봉 집계 · 틱 반영
assets/core/indicators.js      SMA/EMA/볼린저/RSI/MACD/Stoch/CCI/Williams/ATR
assets/core/analysis.js        종합 점수 · 크로스 · 피봇 · 목표가 · 전망
assets/core/search.js          초성 포함 검색 인덱스
assets/core/events.js          일정 생성/병합 (확정·규칙·예상)
assets/core/fx.js              USD/KRW 환율
assets/feed/{kis,toss,mock,index}.js   실시간 피드 어댑터와 파사드
assets/data/*.json             수집된 종목·시세·일봉·일정 데이터
tools/build_*.py               데이터 수집 스크립트
legacy/terminal-dark.html      초기 다크 터미널 버전
```

## 설정

우상단 톱니 → **실시간 시세 연결**에서 데이터 소스(모의 / KIS / 토스), 프록시 주소, 토큰, WebSocket 주소를
설정합니다(브라우저 localStorage 저장). 로컬 개발에서는 `config.local.js`(gitignore)로도 지정할 수 있습니다.

## 면책

모든 지표·전망·목표가는 과거 가격의 수학적 계산 결과이며 투자 자문이 아닙니다. 투자 판단과 책임은 이용자 본인에게 있습니다.

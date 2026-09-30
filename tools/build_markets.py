# -*- coding: utf-8 -*-
"""
홈 대시보드 시장 데이터 수집기
  · 지수 · 선물 · 환율 · 원자재 · 국채금리 : CNBC 시세 · 차트 API (실패 시 네이버 금융)
      코스피200 선물은 CNBC 에 없어 네이버 금융에서만 받습니다.
  · 공포 & 탐욕 지수          : CNN Business (dataviz 그래프 데이터)
  · 국장 심리지수 (자체 계산)   : 코스피 · 코스닥 일봉(네이버) + 원/달러(CNBC)
  · 등락 종목 수 · 투자자 수급  : 네이버 금융
  · 기준금리                   : 한국은행 · 연준(federalreserve.gov) 변경 이력
  · 지표 예상치 / 직전치        : ForexFactory 이번 주 캘린더 · BLS 공개 API · 한국은행 ECOS(샘플 키)
  · 실적 EPS 컨센서스           : nasdaq.com 실적 캘린더 (events.json 의 발표일 기준)
브라우저는 이 스냅샷을 먼저 그리고, CNBC 시세(CORS 허용)로 30초마다 덮어씁니다.
수집에 실패한 항목은 기존 markets.json 값을 그대로 유지합니다.
실행: python3 tools/build_markets.py
결과: assets/data/markets.json
"""
import io, json, math, os, re, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'data')
KST = timezone(timedelta(hours=9))
HIST_DAYS = 260                        # 카드 스파크라인 · 추세 팝업(1년)에 쓰는 일봉 수

# 키는 assets/core/markets.js 의 ITEMS 와 같아야 합니다.
#   (키, CNBC 심볼, 배율, 네이버 대체 소스)
ITEMS = [
    ('KOSPI',  '.KS11',   1,   ('kr', 'KOSPI')),
    ('KOSDAQ', '.KQ11',   1,   ('kr', 'KOSDAQ')),
    ('KFUT',   None,      1,   ('kr', 'FUT')),
    ('IXIC',   '.IXIC',   1,   ('world', '.IXIC')),
    ('SPX',    '.SPX',    1,   ('world', '.INX')),
    ('DJI',    '.DJI',    1,   ('world', '.DJI')),
    ('NQF',    '@ND.1',   1,   ('fut', 'NQcv1')),
    ('ESF',    '@SP.1',   1,   ('fut', 'EScv1')),
    ('SOX',    '.SOX',    1,   ('world', '.SOX')),
    ('VIX',    '.VIX',    1,   ('world', '.VIX')),
    ('N225',   '.N225',   1,   ('world', '.N225')),
    ('SSEC',   '.SSEC',   1,   ('world', '.SSEC')),
    ('TWII',   '.TWII',   1,   ('world', '.TWII')),
    ('USDKRW', 'KRW=',    1,   ('mi', 'exchange', 'FX_USDKRW')),
    ('JPYKRW', 'JPYKRW=', 100, ('mi', 'exchange', 'FX_JPYKRW')),
    ('DXY',    '.DXY',    1,   ('mi', 'exchange', '.DXY')),
    ('WTI',    '@CL.1',   1,   ('mi', 'energy', 'CLcv1')),
    ('GOLD',   '@GC.1',   1,   ('mi', 'metals', 'GCcv1')),
    ('COPPER', '@HG.1',   1,   ('mi', 'metals', 'HGcv1')),
    ('US10Y',  'US10Y',   1,   ('mi', 'bond', 'US10YT=RR')),
    ('US2Y',   'US2Y',    1,   ('mi', 'bond', 'US2YT=RR')),
]


def get(url, headers=None, data=None, timeout=20, tries=3):
    """macOS 파이썬에 CA 번들이 없는 경우가 많아 다른 수집기처럼 curl 로 받습니다."""
    cmd = ['curl', '-sL', '-m', str(timeout), '-A', UA]
    for h in headers or []:
        cmd += ['-H', h]
    if data is not None:
        cmd += ['-H', 'Content-Type: application/json', '--data', data]
    for i in range(tries):
        try:
            r = subprocess.run(cmd + [url], capture_output=True, timeout=timeout + 5)
            body = r.stdout.decode('utf-8', 'replace')
            if r.returncode == 0 and body.strip() and 'Too Many Requests' not in body[:64]:
                return body
        except Exception:
            pass
        time.sleep(1.2 * (i + 1))
    print('  ! 실패', url[:90], file=sys.stderr)
    return None


def jget(url, headers=None, data=None):
    raw = get(url, headers, data)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).replace(',', '').replace('%', '').replace('$', '').strip()
    try:
        return float(s)
    except ValueError:
        return None


def r4(v):
    """유효숫자 6자리 정도로 줄여 파일 크기를 아낍니다."""
    if v is None:
        return None
    if abs(v) >= 1000:
        return round(v, 2)
    if abs(v) >= 10:
        return round(v, 3)
    return round(v, 4)


def iso(s):
    """2026-09-29T12:43:40.000+0900 → 2026-09-29T12:43:40+09:00 (사파리도 읽을 수 있는 형식)"""
    if not s:
        return None
    s = re.sub(r'\.\d+', '', str(s))
    return re.sub(r'([+-]\d{2})(\d{2})$', r'\1:\2', s)


def ymd_int(s):
    d = re.sub(r'\D', '', str(s))[:8]
    return int(d) if len(d) == 8 else None


def now_kst():
    return datetime.now(KST)


# =============================================================
#  1) 지수 · 환율 · 원자재 · 금리 — CNBC
# =============================================================
CNBC_QUOTE = ('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol'
              '?symbols=%s&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json')
CNBC_CHART = 'https://ts-api.cnbc.com/harmony/app/charts/1Y.json?symbol=%s'


def cnbc_quotes(symbols):
    d = jget(CNBC_QUOTE % quote('|'.join(symbols), safe=''))
    out = {}
    try:
        rows = d['FormattedQuoteResult']['FormattedQuote']
    except (TypeError, KeyError):
        return out
    for q in rows:
        last = num(q.get('last'))
        if q.get('code') != 0 or last is None:
            continue
        prev = num(q.get('previous_day_closing'))
        chg = num(q.get('change'))
        if chg is None and prev:
            chg = last - prev
        base = last - chg if chg is not None else prev
        out[q['symbol']] = {
            'p': last, 'd': chg, 'r': (chg / base * 100) if chg is not None and base else None,
            't': iso(q.get('last_time')), 'hi52': num(q.get('yrhiprice')), 'lo52': num(q.get('yrloprice')),
        }
    return out


def cnbc_history(symbol):
    d = jget(CNBC_CHART % quote(symbol, safe=''))
    try:
        bars = d['barData']['priceBars']
    except (TypeError, KeyError):
        return []
    out = []
    for b in bars:
        day, c = ymd_int(b.get('tradeTime')), num(b.get('close'))
        if day and c is not None:
            out.append([day, c])
    return out


# ---------- 네이버 대체 소스 ----------
def naver_item(src):
    """(시세, 일봉) — src = ('kr', 코드) · ('world', 로이터코드) · ('fut', 코드) · ('mi', 분류, 코드)"""
    kind = src[0]
    if kind == 'kr':
        base = 'https://m.stock.naver.com/api/index/%s' % src[1]
        q = jget(base + '/basic')
        pages = [jget(base + '/price?pageSize=60&page=%d' % p) for p in range(1, 6)]
        rows = [r for pg in pages if isinstance(pg, list) for r in pg]
    elif kind in ('world', 'fut'):
        base = 'https://api.stock.naver.com/%s/%s' % ('index' if kind == 'world' else 'futures', src[1])
        q = jget(base + '/basic')
        pages = [jget(base + '/price?page=%d&pageSize=60' % p) for p in range(1, 6)]
        rows = [r for pg in pages if isinstance(pg, list) for r in pg]
    else:
        cat, code = src[1], src[2]
        d = jget('https://m.stock.naver.com/front-api/marketIndex/productDetail?category=%s&reutersCode=%s' % (cat, quote(code)))
        q = d.get('result') if isinstance(d, dict) else None
        rows = []
        for p in range(1, 6):
            pg = jget('https://m.stock.naver.com/front-api/marketIndex/prices?category=%s&reutersCode=%s&page=%d&pageSize=60'
                      % (cat, quote(code), p))
            if isinstance(pg, dict) and isinstance(pg.get('result'), list):
                rows += pg['result']
    if not isinstance(q, dict) or num(q.get('closePrice')) is None:
        return None, []
    last = num(q.get('closePrice'))
    chg = num(q.get('compareToPreviousClosePrice'))
    if chg is None:
        chg = num(q.get('fluctuations'))
    if chg is not None and str(q.get('compareToPreviousClosePrice') or q.get('fluctuations') or '').strip()[:1] not in '+-':
        # 네이버 일부 응답은 부호 없이 금액만 주고 방향을 따로 표시합니다
        way = (q.get('compareToPreviousPrice') or q.get('fluctuationsType') or {}).get('name')
        if way in ('FALLING', 'LOWER_LIMIT'):
            chg = -abs(chg)
    rate = num(q.get('fluctuationsRatio'))
    quote_ = {'p': last, 'd': chg, 'r': rate, 't': iso(q.get('localTradedAt'))}
    hist = {}
    for r in rows:
        day, c = ymd_int(r.get('localTradedAt')), num(r.get('closePrice'))
        if day and c is not None:
            hist[day] = c
    return quote_, sorted([k, v] for k, v in hist.items())


def collect_items(old):
    print('[1/7] 지수 · 환율 · 원자재 · 금리 (CNBC → 네이버)')
    syms = [s for _, s, _, _ in ITEMS if s]
    live = cnbc_quotes(syms)
    items = {}
    def scaled(q, hist, k):
        """CNBC 원/엔은 1엔 기준이라 100배 — 네이버는 이미 100엔 기준(k=1)"""
        if k == 1:
            return q, hist
        q = dict(q)
        for f in ('p', 'd', 'hi52', 'lo52'):
            if q.get(f) is not None:
                q[f] *= k
        return q, [[d, c * k] for d, c in hist]

    for key, sym, scale, nav in ITEMS:
        q, hist, src = None, [], None
        if sym and sym in live:
            q, hist = scaled(live[sym], cnbc_history(sym), scale)
            src = 'cnbc'
            time.sleep(0.25)
        if (q is None or len(hist) < 30) and nav:
            nq, nh = naver_item(nav)
            if q is None and nq:
                q, src = nq, 'naver'
            if len(hist) < 30 and len(nh) >= 30:
                hist = nh
        if q is None:
            if key in old:
                items[key] = old[key]
                print('  %-7s x  (기존 값 유지)' % key)
            else:
                print('  %-7s x' % key)
            continue
        # 스냅샷 시세가 마지막 일봉보다 새 날짜면 이어 붙여 스파크라인 끝을 현재가에 맞춘다
        day = ymd_int(q.get('t'))
        if hist and day and day > hist[-1][0]:
            hist.append([day, q['p']])
        elif hist and day and day == hist[-1][0]:
            hist[-1][1] = q['p']
        hist = hist[-HIST_DAYS:]
        # CNBC 는 장 시작 전후로 대비를 0 으로 비워 두고 전일 종가만 주는 때가 있다(코스피 0.00%).
        # 시세 날짜의 봉이 일봉에 있으면 그 전 거래일 종가로 다시 계산한다.
        if not q.get('d') and day and len(hist) >= 2 and hist[-1][0] == day:
            prev = hist[-2][1]
            if prev and prev != q['p']:
                q = dict(q, d=q['p'] - prev, r=(q['p'] - prev) / prev * 100)
        items[key] = {
            'p': r4(q['p']), 'd': r4(q.get('d')), 'r': round(q['r'], 3) if q.get('r') is not None else None,
            't': q.get('t'), 'src': src, 'h': [[d, r4(c)] for d, c in hist],
        }
        if q.get('hi52') is not None:
            items[key]['hi52'], items[key]['lo52'] = r4(q['hi52']), r4(q.get('lo52'))
        print('  %-7s %-12s %+.2f%%  일봉 %d  (%s)' % (key, items[key]['p'], items[key]['r'] or 0, len(hist), src))
    return items


# =============================================================
#  2) CNN 공포 & 탐욕 지수
# =============================================================
FNG_PARTS = ['market_momentum_sp500', 'stock_price_strength', 'stock_price_breadth', 'put_call_options',
             'market_volatility_vix', 'junk_bond_demand', 'safe_haven_demand']


def cnn_fng():
    print('[2/7] CNN 공포 & 탐욕 지수')
    d = jget('https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
             ['Accept: application/json, text/plain, */*', 'Referer: https://edition.cnn.com/',
              'Origin: https://edition.cnn.com', 'Accept-Language: en-US,en;q=0.9'])
    try:
        f = d['fear_and_greed']
    except (TypeError, KeyError):
        print('  x')
        return None
    byday = {}                             # 마지막 점이 당일 현재값과 겹쳐 나오므로 날짜별로 하나만
    for p in (d.get('fear_and_greed_historical') or {}).get('data') or []:
        day = datetime.fromtimestamp(p['x'] / 1000, timezone.utc).strftime('%Y%m%d')
        byday[int(day)] = round(p['y'], 1)
    hist = sorted([k, v] for k, v in byday.items())
    parts = []
    for k in FNG_PARTS:
        c = d.get(k) or {}
        if c.get('score') is not None:
            parts.append({'k': k, 's': round(c['score'], 1), 'r': c.get('rating')})
    out = {
        's': round(f['score'], 1), 'r': f.get('rating'), 't': iso(f.get('timestamp')),
        'prev': {k: round(f[v], 1) for k, v in (('close', 'previous_close'), ('week', 'previous_1_week'),
                                                ('month', 'previous_1_month'), ('year', 'previous_1_year')) if f.get(v) is not None},
        'parts': parts, 'h': hist,
    }
    print('  %.1f (%s) · 세부 지표 %d · 이력 %d' % (out['s'], out['r'], len(parts), len(hist)))
    return out


# =============================================================
#  3) 국장 심리지수 — 코스피 · 코스닥 일봉 + 원/달러로 자체 계산
#     각 항목을 최근 1년(250거래일) 분포에서의 백분위로 0~100 환산한 뒤 평균합니다.
# =============================================================
def naver_sise(symbol, years=3):
    end = now_kst()
    start = end - timedelta(days=365 * years + 30)
    raw = get('https://api.finance.naver.com/siseJson.naver?symbol=%s&requestType=1&startTime=%s&endTime=%s&timeframe=day'
              % (symbol, start.strftime('%Y%m%d'), end.strftime('%Y%m%d')), timeout=30)
    if not raw:
        return []
    rows = re.findall(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)', raw)
    return [[int(r[0]), float(r[4])] for r in rows]


def pct_rank(window, x):
    if not window:
        return None
    lo = sum(1 for v in window if v < x)
    eq = sum(1 for v in window if v == x)
    return (lo + 0.5 * eq) / len(window) * 100


def rsi_series(c, n=14):
    out = [None] * len(c)
    if len(c) <= n:
        return out
    gain = loss = 0.0
    for i in range(1, n + 1):
        ch = c[i] - c[i - 1]
        gain += max(ch, 0)
        loss += max(-ch, 0)
    gain /= n
    loss /= n
    out[n] = 100 - 100 / (1 + gain / loss) if loss else 100.0
    for i in range(n + 1, len(c)):
        ch = c[i] - c[i - 1]
        gain = (gain * (n - 1) + max(ch, 0)) / n
        loss = (loss * (n - 1) + max(-ch, 0)) / n
        out[i] = 100 - 100 / (1 + gain / loss) if loss else 100.0
    return out


def rating(s):
    return 'extreme fear' if s < 25 else 'fear' if s < 45 else 'neutral' if s <= 55 else 'greed' if s <= 75 else 'extreme greed'


def kr_sentiment(fx_hist):
    print('[3/7] 국장 심리지수 (코스피 · 코스닥 · 원/달러)')
    kospi, kosdaq = naver_sise('KOSPI'), naver_sise('KOSDAQ')
    if len(kospi) < 420 or len(kosdaq) < 420:
        print('  x  일봉 부족 (코스피 %d · 코스닥 %d)' % (len(kospi), len(kosdaq)))
        return None
    days = [d for d, _ in kospi]
    c = [v for _, v in kospi]
    kq = dict(kosdaq)
    fx = sorted(fx_hist or [])
    # 날짜 맞춤 (해당 날짜가 없으면 직전 값)
    def aligned(src):
        out, j, last = [], 0, None
        for d in days:
            while j < len(src) and src[j][0] <= d:
                last = src[j][1]
                j += 1
            out.append(last)
        return out
    q = aligned(sorted(kq.items()))
    f = aligned(fx) if fx else [None] * len(days)
    rsi = rsi_series(c)
    n = len(c)
    mom = [None] * n
    pos = [None] * n
    vol = [None] * n
    risk = [None] * n
    safe = [None] * n
    for i in range(n):
        if i >= 124:
            ma = sum(c[i - 124:i + 1]) / 125
            mom[i] = c[i] / ma - 1
        if i >= 251:
            w = c[i - 251:i + 1]
            hi, lo = max(w), min(w)
            pos[i] = (c[i] - lo) / (hi - lo) * 100 if hi > lo else 50
        if i >= 20:
            rets = [math.log(c[k] / c[k - 1]) for k in range(i - 19, i + 1)]
            m = sum(rets) / 20
            vol[i] = math.sqrt(sum((x - m) ** 2 for x in rets) / 19) * math.sqrt(252) * 100
            if q[i] and q[i - 20]:
                risk[i] = (q[i] / q[i - 20] - c[i] / c[i - 20]) * 100
            if f[i] and f[i - 20]:
                safe[i] = (f[i] / f[i - 20] - 1) * 100

    W = 250
    def score_at(i):
        parts = {}
        def rank(series, invert=False):
            x = series[i]
            win = [v for v in series[max(0, i - W + 1):i + 1] if v is not None]
            if x is None or len(win) < 120:
                return None
            p = pct_rank(win, x)
            return 100 - p if invert else p
        parts['momentum'] = rank(mom)
        parts['strength'] = pos[i]
        parts['rsi'] = rsi[i]
        parts['volatility'] = rank(vol, invert=True)
        parts['safehaven'] = rank(safe, invert=True)
        parts['risk'] = rank(risk)
        vals = [v for v in parts.values() if v is not None]
        return (sum(vals) / len(vals) if len(vals) >= 4 else None), parts

    hist = []
    for i in range(max(0, n - HIST_DAYS), n):
        s, _ = score_at(i)
        if s is not None:
            hist.append([days[i], round(s, 1)])
    if not hist:
        print('  x  계산 불가')
        return None
    s, parts = score_at(n - 1)
    def back(k):
        return hist[-1 - k][1] if len(hist) > k else None
    vw = [v for v in vol[-250:] if v is not None]
    raw = {
        'momentum': mom[-1] * 100 if mom[-1] is not None else None,
        'strength': pos[-1], 'rsi': rsi[-1], 'volatility': vol[-1],
        'safehaven': safe[-1], 'risk': risk[-1],
    }
    out = {
        's': round(s, 1), 'r': rating(s), 'date': days[-1],
        'prev': {k: v for k, v in (('close', back(1)), ('week', back(5)), ('month', back(21)), ('year', back(250))) if v is not None},
        'parts': [{'k': k, 's': round(v, 1), 'v': round(raw[k], 2) if raw[k] is not None else None}
                  for k, v in parts.items() if v is not None],
        'vol': {'v20': round(vol[-1], 1), 'avg': round(sum(vw) / len(vw), 1), 'pct': round(pct_rank(vw, vol[-1]))} if vw else None,
        'h': hist,
    }
    print('  %.1f (%s) · 코스피 20일 변동성 %.1f%% · 이력 %d' % (out['s'], out['r'], vol[-1], len(hist)))
    return out


# =============================================================
#  4) 등락 종목 수 · 투자자별 순매수 — 네이버
# =============================================================
def kr_market_stats():
    print('[4/7] 등락 종목 · 투자자 수급 (네이버)')
    breadth, flows = {}, {}
    for idx in ('KOSPI', 'KOSDAQ'):
        d = jget('https://m.stock.naver.com/api/index/%s/integration' % idx)
        if not isinstance(d, dict):
            continue
        u = d.get('upDownStockInfo') or {}
        if u:
            breadth[idx] = {k: int(num(u.get(v)) or 0) for k, v in
                            (('up', 'riseCount'), ('upper', 'upperCount'), ('down', 'fallCount'), ('lower', 'lowerCount'), ('flat', 'steadyCount'))}
        t = d.get('dealTrendInfo') or {}
        if t.get('bizdate'):
            flows[idx] = {'date': t['bizdate'], 'indiv': num(t.get('personalValue')),
                          'foreign': num(t.get('foreignValue')), 'inst': num(t.get('institutionalValue'))}
        print('  %s 상승 %s · 하락 %s · 외국인 %s억' % (idx, breadth.get(idx, {}).get('up'), breadth.get(idx, {}).get('down'),
                                                  flows.get(idx, {}).get('foreign')))
    return breadth or None, flows or None


# =============================================================
#  5) 기준금리 변경 이력 — 한국은행 · 연준
# =============================================================
def cells(row):
    return [re.sub(r'<[^>]+>|&nbsp;|\s+', ' ', c).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)]


def bok_rate():
    html = get('https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643', timeout=30)
    if not html:
        return None
    out = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S):
        c = cells(row)
        if len(c) < 3 or not re.match(r'^\d{4}$', c[0]):
            continue
        m = re.match(r'(\d{1,2})월\s*(\d{1,2})일', c[1])
        v = num(c[2])
        if m and v is not None:
            out.append(['%s-%02d-%02d' % (c[0], int(m.group(1)), int(m.group(2))), v])
    out.sort()
    if not out:
        return None
    last = out[-1]
    prev = out[-2][1] if len(out) > 1 else None
    return {'v': last[1], 'date': last[0], 'chg': round(last[1] - prev, 2) if prev is not None else None,
            'h': [x for x in out if x[0] >= '2008']}


MONTHS = {m: i + 1 for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July',
                                           'August', 'September', 'October', 'November', 'December'])}


def fed_rate():
    html = get('https://www.federalreserve.gov/monetarypolicy/openmarket.htm', timeout=30)
    if not html:
        return None
    out = []
    parts = re.split(r'<h4>(\d{4})</h4>', html)
    for i in range(1, len(parts) - 1, 2):
        year = int(parts[i])
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', parts[i + 1].split('<h4')[0], re.S):
            c = cells(row)
            if len(c) < 4:
                continue
            m = re.match(r'([A-Z][a-z]+)\s+(\d{1,2})', c[0])
            lv = re.findall(r'[\d.]+', c[3])
            if not m or m.group(1) not in MONTHS or not lv:
                continue
            lo, hi = float(lv[0]), float(lv[-1])
            out.append(['%d-%02d-%02d' % (year, MONTHS[m.group(1)], int(m.group(2))), lo, hi])
    out.sort()
    if not out:
        return None
    last = out[-1]
    prev = out[-2] if len(out) > 1 else None
    return {'lo': last[1], 'hi': last[2], 'date': last[0], 'chg': round(last[2] - prev[2], 2) if prev else None,
            'h': [[d, hi] for d, lo, hi in out if d >= '2008']}


def policy_rates():
    print('[5/7] 기준금리 (한국은행 · 연준)')
    bok, fed = bok_rate(), fed_rate()
    print('  한국 %s · 미국 %s' % (bok and '%.2f%% (%s)' % (bok['v'], bok['date']),
                                fed and '%.2f~%.2f%% (%s)' % (fed['lo'], fed['hi'], fed['date'])))
    return {'BOK': bok, 'FED': fed}


# =============================================================
#  6) 지표 예상치 · 직전치 — ForexFactory(이번 주) · BLS · ECOS
# =============================================================
FF_MAP = [                               # ForexFactory 제목 → events.js 일정 종류
    ('CPI y/y', 'cpi'), ('Core CPI m/m', 'cpi'), ('CPI m/m', 'cpi'),
    ('PPI m/m', 'ppi'), ('Core PPI m/m', 'ppi'),
    ('Non-Farm Employment Change', 'nfp'), ('Unemployment Rate', 'nfp'), ('Average Hourly Earnings m/m', 'nfp'),
    ('Core PCE Price Index m/m', 'pce'),
    ('Advance GDP q/q', 'gdp'),
    ('ISM Manufacturing PMI', 'ism'),
    ('Federal Funds Rate', 'fomc'),
]


def ff_calendar():
    d = jget('https://nfs.faireconomy.media/ff_calendar_thisweek.json')
    if not isinstance(d, list):
        return None
    out = []
    for e in d:
        if e.get('country') != 'USD':
            continue
        kind = next((k for title, k in FF_MAP if e.get('title') == title), None)
        if not kind:
            continue
        try:
            t = int(datetime.fromisoformat(e['date']).timestamp() * 1000)
        except (KeyError, ValueError):
            continue
        out.append({'k': kind, 't': t, 'l': e['title'], 'f': e.get('forecast') or None, 'p': e.get('previous') or None})
    return out


BLS_SERIES = {'cpi': 'CUUR0000SA0', 'core': 'CUUR0000SA0L1E', 'ppi': 'WPSFD4', 'nfp': 'CES0000000001', 'ur': 'LNS14000000'}


def bls_latest():
    d = jget('https://api.bls.gov/publicAPI/v1/timeseries/data/', data=json.dumps({'seriesid': list(BLS_SERIES.values())}))
    if not isinstance(d, dict) or d.get('status') != 'REQUEST_SUCCEEDED':
        return None
    ser = {}
    for s in d['Results']['series']:
        rows = [r for r in s['data'] if re.match(r'^M(0[1-9]|1[0-2])$', r['period'])]
        ser[s['seriesID']] = {(int(r['year']), int(r['period'][1:])): float(r['value']) for r in rows if num(r['value']) is not None}

    def latest(sid):
        v = ser.get(sid) or {}
        return max(v) if v else None

    def yoy(sid):
        v, k = ser.get(sid) or {}, latest(sid)
        if not k or (k[0] - 1, k[1]) not in v:
            return None, None
        return k, round((v[k] / v[(k[0] - 1, k[1])] - 1) * 100, 1)

    def prev_month(k):
        return (k[0] - 1, 12) if k[1] == 1 else (k[0], k[1] - 1)

    out = {}
    k, cpi = yoy(BLS_SERIES['cpi'])
    if cpi is not None:
        out['cpi'] = {'ref': '%d-%02d' % k, 'v': cpi, 'core': yoy(BLS_SERIES['core'])[1]}
    k = latest(BLS_SERIES['ppi'])
    if k and prev_month(k) in ser[BLS_SERIES['ppi']]:
        v = ser[BLS_SERIES['ppi']]
        out['ppi'] = {'ref': '%d-%02d' % k, 'v': round((v[k] / v[prev_month(k)] - 1) * 100, 1)}
    k = latest(BLS_SERIES['nfp'])
    if k and prev_month(k) in ser[BLS_SERIES['nfp']]:
        v = ser[BLS_SERIES['nfp']]
        ur = ser.get(BLS_SERIES['ur'], {}).get(k)
        out['nfp'] = {'ref': '%d-%02d' % k, 'v': round(v[k] - v[prev_month(k)]), 'ur': ur}
    return out


def ecos_kcpi():
    """한국 소비자물가 전년동월비 — ECOS 샘플 키(최대 10행)로 최근 달과 1년 전 달을 따로 조회"""
    base = 'https://ecos.bok.or.kr/api/StatisticSearch/sample/json/kr/1/10/901Y009/M/%s/%s/0'
    now = now_kst()
    start = (now - timedelta(days=150)).strftime('%Y%m')
    d = jget(base % (start, now.strftime('%Y%m')))
    rows = ((d or {}).get('StatisticSearch') or {}).get('row') or []
    if not rows:
        return None
    last = max(rows, key=lambda r: r['TIME'])
    y, m = int(last['TIME'][:4]), int(last['TIME'][4:])
    ago = '%d%02d' % (y - 1, m)
    d2 = jget(base % (ago, ago))
    rows2 = ((d2 or {}).get('StatisticSearch') or {}).get('row') or []
    if not rows2:
        return None
    v1, v0 = num(last['DATA_VALUE']), num(rows2[0]['DATA_VALUE'])
    if not v1 or not v0:
        return None
    return {'ref': '%d-%02d' % (y, m), 'v': round((v1 / v0 - 1) * 100, 1)}


def macro_consensus(old):
    print('[6/7] 지표 예상치 · 직전치 (ForexFactory · BLS · ECOS)')
    cal = ff_calendar()
    print('  ForexFactory 이번 주 미국 지표 %s건' % (len(cal) if cal is not None else 'x'))
    econ = dict(old.get('econ') or {})
    fresh = econ.get('at') and (time.time() - econ['at'] / 1000) < 6 * 3600
    if not fresh:                        # BLS 공개 API 는 IP 당 하루 25회 — 6시간에 한 번만
        b = bls_latest()
        if b:
            econ.update(b)
        k = ecos_kcpi()
        if k:
            econ['kcpi'] = k
        if b or k:
            econ['at'] = int(time.time() * 1000)
        print('  BLS %s · 한국 물가 %s' % ('ok' if b else 'x', ('%.1f%% (%s)' % (k['v'], k['ref'])) if k else 'x'))
    else:
        print('  BLS · ECOS 최근 수집값 사용')
    return cal, econ or None


# =============================================================
#  7) 실적 EPS 컨센서스 — nasdaq.com
# =============================================================
def eps_consensus():
    print('[7/7] 실적 EPS 컨센서스 (nasdaq.com)')
    p = os.path.join(OUT, 'events.json')
    if not os.path.exists(p):
        return None
    with io.open(p, encoding='utf-8') as f:
        ev = json.load(f)
    today = now_kst().date()
    want = {}
    for e in ev.get('earnings') or []:
        if not e.get('date') or not re.match(r'^[A-Z]', e.get('code', '')):
            continue
        d = datetime.strptime(e['date'], '%Y-%m-%d').date()
        if -1 <= (d - today).days <= 35:
            want.setdefault(e['date'], []).append(e['code'])
    out = {}
    for day, codes in sorted(want.items()):
        d = jget('https://api.nasdaq.com/api/calendar/earnings?date=%s' % day, ['Accept: application/json'])
        rows = (((d or {}).get('data') or {}).get('rows')) or []
        for r in rows:
            if r.get('symbol') in codes:
                out[r['symbol']] = {'date': day, 'f': r.get('epsForecast') or None, 'ly': r.get('lastYearEPS') or None,
                                    'n': int(num(r.get('noOfEsts')) or 0) or None, 'q': r.get('fiscalQuarterEnding') or None}
        time.sleep(0.4)
    print('  %d개 기업' % len(out))
    return out


def main():
    p = os.path.join(OUT, 'markets.json')
    old = {}
    if os.path.exists(p):
        with io.open(p, encoding='utf-8') as f:
            try:
                old = json.load(f)
            except ValueError:
                old = {}

    items = collect_items(old.get('items') or {})
    fng = cnn_fng()
    fx = (items.get('USDKRW') or {}).get('h')
    krs = kr_sentiment(fx)
    breadth, flows = kr_market_stats()
    policy = policy_rates()
    cal, econ = macro_consensus(old)
    eps = eps_consensus()

    if len(items) < len(ITEMS) // 2 and old:
        print('수집된 시세가 너무 적습니다 — 기존 markets.json 을 유지합니다.')
        return 1
    oldp = old.get('policy') or {}
    out = {
        'updated': now_kst().strftime('%Y-%m-%dT%H:%M:%S+09:00'),
        'items': items,
        'fng': fng or old.get('fng'),
        'krs': krs or old.get('krs'),
        'breadth': breadth or old.get('breadth'),
        'flows': flows or old.get('flows'),
        'policy': {'BOK': policy['BOK'] or oldp.get('BOK'), 'FED': policy['FED'] or oldp.get('FED')},
        'calendar': cal if cal is not None else old.get('calendar'),
        'econ': econ,
        'eps': eps if eps is not None else old.get('eps'),
    }
    with io.open(p, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('완료 · markets.json %.1f KB · 시세 %d/%d' % (os.path.getsize(p) / 1024, len(items), len(ITEMS)))
    return 0


if __name__ == '__main__':
    sys.exit(main())

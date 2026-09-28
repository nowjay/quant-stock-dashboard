# -*- coding: utf-8 -*-
"""
미국 종목 수집 (nasdaq.com 공개 API)
  · 전체 스크리너   : 미국 상장 전종목 + 현재가/등락/시총/섹터
  · NASDAQ-100 구성 : list-type/nasdaq100
  · 주요 미국 ETF    : 아래 US_ETFS 목록(레버리지·지수·섹터·채권·원자재) + screener/etf 시세
  · 대표 종목 일봉   : quote/{sym}/historical
기존 assets/data/*.json 에 병합합니다.
실행: python3 tools/build_us.py          (전체 수집)
      python3 tools/build_us.py --etf-only   (네트워크 없이 ETF 종목 마스터만 병합)
"""
import json, re, io, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import build_dataset as B

OUT = B.OUT
NASDAQ_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
FEATURED = ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','NFLX','AMD',
            'PLTR','COIN','JPM','LLY','COST','ORCL','MU','INTC','UBER','CRM']
ETF_BARS = 300                     # ETF 일봉 보관 개수 (52주 고저 · 200일선 계산에 충분)

# 주요 미국 ETF — (티커, 정식 명칭, 한글 설명: 검색 별칭)
US_ETFS = [
    ('SPY',  'SPDR S&P 500 ETF Trust',                         'S&P500 지수 추종'),
    ('VOO',  'Vanguard S&P 500 ETF',                           'S&P500 지수 추종 뱅가드'),
    ('IVV',  'iShares Core S&P 500 ETF',                       'S&P500 지수 추종 아이셰어즈'),
    ('VTI',  'Vanguard Total Stock Market ETF',                '미국 전체 시장'),
    ('QQQ',  'Invesco QQQ Trust',                              '나스닥100 지수 추종'),
    ('QQQM', 'Invesco NASDAQ 100 ETF',                         '나스닥100 지수 추종 저보수'),
    ('DIA',  'SPDR Dow Jones Industrial Average ETF',          '다우존스 30'),
    ('IWM',  'iShares Russell 2000 ETF',                       '러셀2000 중소형주'),
    ('SCHD', 'Schwab U.S. Dividend Equity ETF',                '미국 배당 성장 슈드'),
    ('JEPI', 'JPMorgan Equity Premium Income ETF',             '커버드콜 월배당 S&P500'),
    ('JEPQ', 'JPMorgan Nasdaq Equity Premium Income ETF',      '커버드콜 월배당 나스닥'),
    ('VYM',  'Vanguard High Dividend Yield ETF',               '고배당'),
    ('VIG',  'Vanguard Dividend Appreciation ETF',             '배당 성장'),
    ('VGT',  'Vanguard Information Technology ETF',            '정보기술 섹터'),
    ('XLK',  'Technology Select Sector SPDR Fund',             '기술 섹터'),
    ('XLF',  'Financial Select Sector SPDR Fund',              '금융 섹터'),
    ('XLE',  'Energy Select Sector SPDR Fund',                 '에너지 섹터'),
    ('XLV',  'Health Care Select Sector SPDR Fund',            '헬스케어 섹터'),
    ('XLY',  'Consumer Discretionary Select Sector SPDR Fund', '임의소비재 섹터'),
    ('XLI',  'Industrial Select Sector SPDR Fund',             '산업재 섹터'),
    ('XLU',  'Utilities Select Sector SPDR Fund',              '유틸리티 섹터'),
    ('SMH',  'VanEck Semiconductor ETF',                       '반도체'),
    ('SOXX', 'iShares Semiconductor ETF',                      '반도체 필라델피아'),
    ('SOXL', 'Direxion Daily Semiconductor Bull 3X Shares',    '반도체 3배 레버리지 속슬'),
    ('SOXS', 'Direxion Daily Semiconductor Bear 3X Shares',    '반도체 3배 인버스'),
    ('TQQQ', 'ProShares UltraPro QQQ',                         '나스닥100 3배 레버리지'),
    ('SQQQ', 'ProShares UltraPro Short QQQ',                   '나스닥100 3배 인버스'),
    ('QLD',  'ProShares Ultra QQQ',                            '나스닥100 2배 레버리지'),
    ('UPRO', 'ProShares UltraPro S&P500',                      'S&P500 3배 레버리지'),
    ('SPXL', 'Direxion Daily S&P 500 Bull 3X Shares',          'S&P500 3배 레버리지'),
    ('SPXS', 'Direxion Daily S&P 500 Bear 3X Shares',          'S&P500 3배 인버스'),
    ('SSO',  'ProShares Ultra S&P500',                         'S&P500 2배 레버리지'),
    ('SH',   'ProShares Short S&P500',                         'S&P500 인버스'),
    ('PSQ',  'ProShares Short QQQ',                            '나스닥100 인버스'),
    ('TNA',  'Direxion Daily Small Cap Bull 3X Shares',        '러셀2000 3배 레버리지'),
    ('TZA',  'Direxion Daily Small Cap Bear 3X Shares',        '러셀2000 3배 인버스'),
    ('FNGU', 'MicroSectors FANG+ 3X Leveraged ETN',            '빅테크 FANG 3배 레버리지'),
    ('TECL', 'Direxion Daily Technology Bull 3X Shares',       '기술주 3배 레버리지'),
    ('LABU', 'Direxion Daily S&P Biotech Bull 3X Shares',      '바이오 3배 레버리지'),
    ('NVDL', 'GraniteShares 2x Long NVDA Daily ETF',           '엔비디아 2배 레버리지'),
    ('TSLL', 'Direxion Daily TSLA Bull 2X Shares',             '테슬라 2배 레버리지'),
    ('CONL', 'GraniteShares 2x Long COIN Daily ETF',           '코인베이스 2배 레버리지'),
    ('ARKK', 'ARK Innovation ETF',                             '아크 혁신 캐시우드'),
    ('XBI',  'SPDR S&P Biotech ETF',                           '바이오테크'),
    ('KRE',  'SPDR S&P Regional Banking ETF',                  '지역은행'),
    ('TLT',  'iShares 20+ Year Treasury Bond ETF',             '미국 장기채 20년 국채'),
    ('TMF',  'Direxion Daily 20+ Year Treasury Bull 3X Shares','미국 장기채 3배 레버리지'),
    ('IEF',  'iShares 7-10 Year Treasury Bond ETF',            '미국 중기채 국채'),
    ('SHY',  'iShares 1-3 Year Treasury Bond ETF',             '미국 단기채 국채'),
    ('SGOV', 'iShares 0-3 Month Treasury Bond ETF',            '초단기 국채 파킹'),
    ('BIL',  'SPDR Bloomberg 1-3 Month T-Bill ETF',            '초단기 국채 T-Bill'),
    ('BND',  'Vanguard Total Bond Market ETF',                 '미국 종합 채권'),
    ('AGG',  'iShares Core U.S. Aggregate Bond ETF',           '미국 종합 채권'),
    ('HYG',  'iShares iBoxx $ High Yield Corporate Bond ETF',  '하이일드 회사채'),
    ('LQD',  'iShares iBoxx $ Investment Grade Corporate Bond ETF', '투자등급 회사채'),
    ('GLD',  'SPDR Gold Shares',                               '금 골드'),
    ('IAU',  'iShares Gold Trust',                             '금 골드'),
    ('SLV',  'iShares Silver Trust',                           '은 실버'),
    ('USO',  'United States Oil Fund',                         '원유 WTI'),
    ('UVXY', 'ProShares Ultra VIX Short-Term Futures ETF',     'VIX 변동성 공포지수'),
    ('IBIT', 'iShares Bitcoin Trust ETF',                      '비트코인 현물'),
    ('ETHA', 'iShares Ethereum Trust ETF',                     '이더리움 현물'),
    ('EEM',  'iShares MSCI Emerging Markets ETF',              '신흥국'),
    ('EWY',  'iShares MSCI South Korea ETF',                   '한국 MSCI'),
    ('EWJ',  'iShares MSCI Japan ETF',                         '일본'),
    ('KWEB', 'KraneShares CSI China Internet ETF',             '중국 인터넷'),
    ('FXI',  'iShares China Large-Cap ETF',                    '중국 대형주'),
    ('VNQ',  'Vanguard Real Estate ETF',                       '리츠 부동산'),
    ('ITA',  'iShares U.S. Aerospace & Defense ETF',           '방산 항공우주'),
    ('URA',  'Global X Uranium ETF',                           '우라늄 원자력'),
    ('TAN',  'Invesco Solar ETF',                              '태양광'),
    ('LIT',  'Global X Lithium & Battery Tech ETF',            '리튬 2차전지'),
    ('BOTZ', 'Global X Robotics & Artificial Intelligence ETF','로봇 인공지능'),
]

def load(n):
    with io.open(os.path.join(OUT, n), encoding='utf-8') as f: return json.load(f)
def save(n, o):
    p = os.path.join(OUT, n)
    with io.open(p, 'w', encoding='utf-8') as f: json.dump(o, f, ensure_ascii=False, separators=(',', ':'))
    print('  %s  %.1f KB' % (n, os.path.getsize(p) / 1024))
def money(s):
    if s is None: return None
    s = str(s).replace('$', '').replace(',', '').replace('%', '').strip()
    if s in ('', 'N/A', '--'): return None
    try: return float(s)
    except ValueError: return None
def ts(mmddyyyy):
    try:
        return int(time.mktime(time.strptime(mmddyyyy.strip(), '%m/%d/%Y'))) * 1000 + 9 * 3600000
    except Exception:
        return None

def screener():
    raw = B.get('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true', timeout=40)
    if not raw: return []
    try:
        rows = json.loads(raw)['data']['rows']
    except Exception:
        return []
    out = []
    for r in rows:
        sym = (r.get('symbol') or '').strip()
        if not re.match(r'^[A-Z][A-Z.\-]{0,5}$', sym): continue
        out.append({
            'code': sym.replace('/', '-'), 'name': (r.get('name') or '').replace(' Common Stock', '').strip(),
            'price': money(r.get('lastsale')), 'diff': money(r.get('netchange')), 'rate': money(r.get('pctchange')),
            'volume': money(r.get('volume')) or 0, 'mcap': money(r.get('marketCap')) or 0,
            'sector': (r.get('sector') or '').strip()
        })
    out.sort(key=lambda x: -(x['mcap'] or 0))
    return out

def ndx100():
    raw = B.get('https://api.nasdaq.com/api/quote/list-type/nasdaq100')
    if not raw: return set()
    try:
        rows = json.loads(raw)['data']['data']['rows']
    except Exception:
        return set()
    return set((r.get('symbol') or '').strip() for r in rows)

def history(sym, years=2, assetclass='stocks'):
    today = time.strftime('%Y-%m-%d')
    frm = time.strftime('%Y-%m-%d', time.localtime(time.time() - years * 365 * 86400))
    raw = B.get('https://api.nasdaq.com/api/quote/%s/historical?assetclass=%s&fromdate=%s&todate=%s&limit=600' % (sym, assetclass, frm, today), timeout=25)
    if not raw: return None
    try:
        rows = json.loads(raw)['data']['tradesTable']['rows']
    except Exception:
        return None
    bars = []
    for r in rows:
        t = ts(r.get('date', ''))
        o, h, l, c = money(r.get('open')), money(r.get('high')), money(r.get('low')), money(r.get('close'))
        v = money(r.get('volume')) or 0
        if None in (t, o, h, l, c): continue
        bars.append([t, o, h, l, c, int(v)])
    bars.sort(key=lambda b: b[0])
    return bars

def merge_etfs(sym, by):
    """US_ETFS 를 종목 마스터에 병합 (네트워크 불필요)"""
    added = 0
    for code, name, alias in US_ETFS:
        item = by.get(code)
        if item is None:
            item = {'c': code, 'cur': 'USD'}
            sym['items'].append(item); by[code] = item; added += 1
        item.update({'n': name, 'e': alias, 'm': 'US ETF', 't': 'etf', 'cur': 'USD', 's': 'ETF'})
    return added

def etf_quotes():
    """nasdaq ETF 스크리너 — 현재가 · 등락"""
    raw = B.get('https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=10000&download=true', timeout=40)
    if not raw: return {}
    try:
        d = json.loads(raw)['data']
        rows = (d.get('data') or d).get('rows') or []
    except Exception:
        return {}
    out = {}
    for r in rows:
        sym = (r.get('symbol') or '').strip()
        p = money(r.get('lastSalePrice') or r.get('lastsale'))
        if sym and p:
            out[sym] = {'p': p, 'd': money(r.get('netChange') or r.get('netchange')) or 0,
                        'r': money(r.get('percentageChange') or r.get('pctchange')) or 0, 'v': 0}
    return out

def quote_from_bars(bars):
    """마지막 두 봉(정규장 종가)으로 현재가 · 전일 대비 계산"""
    last, prev = bars[-1], bars[-2]
    d = last[4] - prev[4]
    return {'p': last[4], 'd': round(d, 4), 'r': round(d / prev[4] * 100, 4) if prev[4] else 0, 'v': last[5]}

def main():
    sym, q, hist = load('symbols.json'), load('quotes.json'), load('history.json')
    by = {s['c']: s for s in sym['items']}

    if '--etf-only' in sys.argv:
        print('ETF 종목 마스터 병합: 신규 %d · 목록 %d' % (merge_etfs(sym, by), len(US_ETFS)))
        sym['count'] = len(sym['items'])
        save('symbols.json', sym)
        return

    print('[1/3] 미국 전종목 스크리너')
    rows = screener()
    ndx = ndx100()
    print('  스크리너 %d종목 · NASDAQ100 %d종목' % (len(rows), len(ndx)))
    if not rows:
        print('  ! 수집 실패 — 중단'); return

    added = 0
    for r in rows:
        code = r['code']
        market = 'NASDAQ100' if code in ndx else (by[code]['m'] if code in by and by[code]['m'] == 'S&P500' else 'US')
        if code in by:
            by[code]['m'] = 'S&P500·NDX' if (by[code]['m'] == 'S&P500' and code in ndx) else (by[code]['m'] if by[code]['m'] == 'S&P500' else market)
            if r['sector']: by[code]['s'] = r['sector']
        else:
            item = {'c': code, 'n': r['name'], 'm': market, 't': 'stock', 'cur': 'USD', 's': r['sector']}
            sym['items'].append(item); by[code] = item; added += 1
        if r['price']:
            q['items'][code] = {'p': r['price'], 'd': r['diff'] or 0, 'r': r['rate'] or 0, 'v': r['volume'] or 0}
    print('  신규 %d · 전체 %d종목' % (added, len(sym['items'])))

    print('[1b] 주요 미국 ETF')
    print('  마스터 신규 %d' % merge_etfs(sym, by))
    eq = etf_quotes()
    for code, _, _ in US_ETFS:
        if code in eq: q['items'][code] = eq[code]
    print('  시세 %d/%d' % (sum(1 for c, _, _ in US_ETFS if c in eq), len(US_ETFS)))

    print('[2/3] 대표 종목 · 주요 ETF 일봉')
    ok = 0
    targets = [(s, 'stocks', 520) for s in FEATURED] + [(c, 'etf', ETF_BARS) for c, _, _ in US_ETFS]
    for i, (s, cls, keep) in enumerate(targets):
        bars = history(s, assetclass=cls)
        if bars and len(bars) > 100:
            hist['items'][s] = bars[-keep:]; ok += 1
        print('  %d/%d %s %s' % (i + 1, len(targets), s, len(bars) if bars else 'x'))
        time.sleep(0.6)
    print('  성공 %d/%d' % (ok, len(targets)))

    # 스크리너의 등락값은 정규장 종가 기준과 어긋나는 경우가 있다(예: SOXL 스크리너 +0.05%, 실제 +3.50%).
    # 일봉이 있는 미국 종목은 현재가 · 등락을 마지막 두 봉 종가로 맞춘다.
    fixed, shown = 0, 0
    for code, bars in hist['items'].items():
        if code not in by or by[code].get('cur') != 'USD' or len(bars) < 2: continue
        new, old = quote_from_bars(bars), q['items'].get(code) or {}
        if shown < 5 and abs((old.get('r') or 0) - new['r']) > 0.1:
            print('  보정 %-5s 스크리너 %s (%+.2f%%) → 종가 %s (%+.2f%%)' % (code, old.get('p'), old.get('r') or 0, new['p'], new['r']))
            shown += 1
        q['items'][code] = new; fixed += 1
    print('  일봉 기준 시세 보정 %d종목' % fixed)

    print('[3/3] 저장 · 미국 종목을 시총순으로 정렬')
    kr = [s for s in sym['items'] if s.get('cur') != 'USD']
    us = [s for s in sym['items'] if s.get('cur') == 'USD']
    order = {r['code']: i for i, r in enumerate(rows)}
    etf_rank = {c: i for i, (c, _, _) in enumerate(US_ETFS)}
    us.sort(key=lambda s: (order.get(s['c'], 99999), etf_rank.get(s['c'], 0)))
    sym['items'] = kr + us
    stamp = time.strftime('%Y-%m-%dT%H:%M:%S%z')
    sym['updated'] = q['updated'] = hist['updated'] = stamp
    sym['count'] = len(sym['items'])
    save('symbols.json', sym); save('quotes.json', q); save('history.json', hist)
    print('완료 · 종목 %d · 시세 %d · 일봉 %d' % (len(sym['items']), len(q['items']), len(hist['items'])))

if __name__ == '__main__':
    main()

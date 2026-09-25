# -*- coding: utf-8 -*-
"""
종목 마스터 · 시세 · 일봉 데이터 수집기
  · 국내 전종목/ETF : 네이버 금융 (m.stock.naver.com, finance.naver.com)
  · 국내 일봉       : 네이버 siseJson
  · 미국 종목/시세  : Wikipedia(S&P500·NASDAQ100) + Yahoo Finance chart API
실행: python3 tools/build_dataset.py
결과: assets/data/symbols.json, quotes.json, history.json
"""
import json, re, time, sys, io, os, subprocess
from urllib.parse import quote

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'data')

def get(url, tries=3, timeout=15):
    """macOS 파이썬에 CA 번들이 없는 경우가 많아 curl 로 받아온다."""
    for i in range(tries):
        try:
            r = subprocess.run(['curl', '-sL', '-m', str(timeout), '-A', UA, url],
                               capture_output=True, timeout=timeout + 5)
            body = r.stdout.decode('utf-8', 'replace')
            if r.returncode == 0 and body.strip() and 'Too Many Requests' not in body[:64]:
                return body
            if 'Too Many Requests' in body[:64]:
                time.sleep(6 * (i + 1))                      # 야후 레이트리밋 완화
        except Exception as e:
            if i == tries - 1:
                print('  ! fail', url[:80], e, file=sys.stderr)
        time.sleep(1.0 * (i + 1))
    print('  ! fail', url[:80], file=sys.stderr)
    return None

def num(s):
    if s is None: return None
    if isinstance(s, (int, float)): return s
    s = str(s).replace(',', '').strip()
    try: return float(s)
    except ValueError: return None

# ---------------- 국내 전종목 ----------------
def kr_market(market):
    out, page, total = [], 1, None
    while True:
        raw = get('https://m.stock.naver.com/api/stocks/marketValue/%s?page=%d&pageSize=100' % (market, page))
        if not raw: break
        d = json.loads(raw)
        total = d.get('totalCount', 0)
        rows = d.get('stocks', [])
        if not rows: break
        for s in rows:
            out.append({
                'code': s['itemCode'], 'name': s['stockName'], 'market': market, 'type': 'stock',
                'close': num(s.get('closePrice')), 'diff': num(s.get('compareToPreviousClosePrice')),
                'rate': num(s.get('fluctuationsRatio')), 'volume': num(s.get('accumulatedTradingVolume')),
                'mcap': num(s.get('marketValue'))
            })
        print('  %s page %d / %d' % (market, page, (total + 99) // 100))
        if len(out) >= (total or 0) or page > 40: break
        page += 1
        time.sleep(0.15)
    return out

def kr_etf():
    raw = get('https://finance.naver.com/api/sise/etfItemList.nhn')
    if not raw: return []
    d = json.loads(raw)
    out = []
    for s in d.get('result', {}).get('etfItemList', []):
        out.append({
            'code': s['itemcode'], 'name': s['itemname'], 'market': 'ETF', 'type': 'etf',
            'close': num(s.get('nowVal')), 'diff': num(s.get('changeVal')),
            'rate': num(s.get('changeRate')), 'volume': num(s.get('quant')), 'mcap': num(s.get('marketSum'))
        })
    return out

# ---------------- 미국 종목 ----------------
def wiki_table(url, table_hint, sym_idx, name_idx, sector_idx=None):
    html = get(url)
    if not html: return []
    # 구성종목 테이블만 추출
    tables = []
    for m in re.finditer(r'<table([^>]*)>(.*?)</table>', html, re.S):
        attrs, inner = m.group(1), m.group(2)
        if 'wikitable' not in attrs: continue
        if table_hint and table_hint not in attrs: continue
        tables.append(inner)
    if not tables:                                            # hint 실패 시 전체 위키테이블
        tables = [m.group(2) for m in re.finditer(r'<table([^>]*)>(.*?)</table>', html, re.S) if 'wikitable' in m.group(1)]
    rows_out = []
    for t in tables:
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S)
        for r in rows:
            cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)
            if len(cells) <= max(sym_idx, name_idx): continue
            def clean(c):
                c = re.sub(r'<[^>]+>', '', c)
                return re.sub(r'&amp;', '&', c).strip()
            sym, name = clean(cells[sym_idx]), clean(cells[name_idx])
            if not re.match(r'^[A-Z][A-Z.\-]{0,6}$', sym): continue
            sector = clean(cells[sector_idx]) if sector_idx is not None and len(cells) > sector_idx else ''
            rows_out.append({'code': sym.replace('.', '-'), 'name': name, 'sector': sector})
        if len(rows_out) > 50: break
    seen, uniq = set(), []
    for r in rows_out:
        if r['code'] in seen: continue
        seen.add(r['code']); uniq.append(r)
    return uniq

def yahoo_quote_history(symbol, rng='2y'):
    raw = get('https://query1.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=1d' % (quote(symbol), rng))
    if not raw: return None
    try:
        r = json.loads(raw)['chart']['result'][0]
    except Exception:
        return None
    meta, ts = r['meta'], r.get('timestamp') or []
    q = r['indicators']['quote'][0]
    bars = []
    for i, t in enumerate(ts):
        o, h, l, c, v = q['open'][i], q['high'][i], q['low'][i], q['close'][i], (q['volume'][i] or 0)
        if None in (o, h, l, c): continue
        bars.append([t * 1000, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v)])
    return {
        'price': meta.get('regularMarketPrice'), 'prev': meta.get('chartPreviousClose') or meta.get('previousClose'),
        'currency': meta.get('currency', 'USD'), 'exchange': meta.get('fullExchangeName', ''), 'bars': bars
    }

# ---------------- 국내 일봉 ----------------
def naver_history(code, start='20240101'):
    end = time.strftime('%Y%m%d')
    raw = get('https://api.finance.naver.com/siseJson.naver?symbol=%s&requestType=1&startTime=%s&endTime=%s&timeframe=day' % (code, start, end))
    if not raw: return None
    txt = raw.strip().replace("'", '"')
    try:
        arr = json.loads(txt)
    except Exception:
        return None
    bars = []
    for row in arr[1:]:
        try:
            d, o, h, l, c, v = row[0], row[1], row[2], row[3], row[4], row[5]
            t = int(time.mktime(time.strptime(str(d), '%Y%m%d'))) * 1000 + 15 * 3600000 + 30 * 60000
            if not all(isinstance(x, (int, float)) for x in (o, h, l, c)): continue
            bars.append([t, o, h, l, c, int(v or 0)])
        except Exception:
            continue
    return bars

# ---------------- 실행 ----------------
def load(name):
    p = os.path.join(OUT, name)
    if not os.path.exists(p): return None
    with io.open(p, encoding='utf-8') as f: return json.load(f)

def main():
    us_only = '--us' in sys.argv
    prev_sym, prev_q, prev_h = load('symbols.json'), load('quotes.json'), load('history.json')
    if us_only and prev_sym:
        print('[1/4] 국내 데이터는 기존 파일 재사용 (%d 종목)' % prev_sym['count'])
        kospi = kosdaq = etf = []
    else:
        print('[1/4] 국내 전종목 수집')
        kospi = kr_market('KOSPI')
        kosdaq = kr_market('KOSDAQ')
        etf = kr_etf()
        print('  KOSPI %d · KOSDAQ %d · ETF %d' % (len(kospi), len(kosdaq), len(etf)))

    print('[2/4] 미국 구성종목 수집')
    sp = wiki_table('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', 'constituents', 0, 1, 2)
    ndx = wiki_table('https://en.wikipedia.org/wiki/Nasdaq-100', 'constituents', 1, 0, 2)
    us = {}
    for r in sp: us[r['code']] = {'code': r['code'], 'name': r['name'], 'market': 'S&P500', 'type': 'stock', 'sector': r.get('sector', '')}
    for r in ndx:
        if r['code'] in us: us[r['code']]['market'] = 'NASDAQ100'
        else: us[r['code']] = {'code': r['code'], 'name': r['name'], 'market': 'NASDAQ100', 'type': 'stock', 'sector': r.get('sector', '')}
    print('  S&P500 %d · NASDAQ100 %d · 합계 %d' % (len(sp), len(ndx), len(us)))

    symbols, quotes = [], {}
    if us_only and prev_sym:
        symbols = [x for x in prev_sym['items'] if x.get('cur') == 'KRW']
        quotes = dict(prev_q['items']) if prev_q else {}
    for s in kospi + kosdaq + etf:
        symbols.append({'c': s['code'], 'n': s['name'], 'm': s['market'], 't': s['type'], 'cur': 'KRW'})
        if s['close']:
            quotes[s['code']] = {'p': s['close'], 'd': s['diff'] or 0, 'r': s['rate'] or 0, 'v': s['volume'] or 0}
    for s in us.values():
        symbols.append({'c': s['code'], 'n': s['name'], 'm': s['market'], 't': s['type'], 'cur': 'USD', 's': s.get('sector', '')})

    print('[3/4] 대표 종목 일봉 수집')
    if us_only and prev_h:
        history_seed = {k: v for k, v in prev_h['items'].items() if re.match(r'^\d{6}$', k)}
    else:
        history_seed = {}
    featured_kr = [s['code'] for s in sorted([x for x in kospi if x.get('mcap')], key=lambda x: -(x['mcap'] or 0))[:40]]
    featured_kr += [s['code'] for s in sorted([x for x in kosdaq if x.get('mcap')], key=lambda x: -(x['mcap'] or 0))[:12]]
    featured_kr += [s['code'] for s in sorted([x for x in etf if x.get('mcap')], key=lambda x: -(x['mcap'] or 0))[:6]]
    featured_us = ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','NFLX','AMD','PLTR','COIN','JPM','LLY','COST']
    history, meta = dict(history_seed), {}
    if us_only:
        featured_kr = []
    for i, code in enumerate(featured_kr):
        bars = naver_history(code)
        if bars and len(bars) > 100:
            history[code] = bars[-520:]
        print('  KR %d/%d %s %s' % (i + 1, len(featured_kr), code, len(bars) if bars else 'x'))
        time.sleep(0.12)
    for i, sym in enumerate(featured_us):
        r = yahoo_quote_history(sym)
        if r and len(r['bars']) > 100:
            history[sym] = r['bars'][-520:]
            prev = r['prev'] or r['bars'][-2][4]
            quotes[sym] = {'p': r['price'] or r['bars'][-1][4], 'd': round((r['price'] or 0) - prev, 2),
                           'r': round(((r['price'] or prev) - prev) / prev * 100, 2), 'v': r['bars'][-1][5]}
            meta[sym] = {'exchange': r.get('exchange', '')}
        print('  US %d/%d %s %s' % (i + 1, len(featured_us), sym, len(r['bars']) if r else 'x'))
        time.sleep(1.6)

    print('[4/4] 저장')
    stamp = time.strftime('%Y-%m-%dT%H:%M:%S%z')
    def dump(name, obj):
        p = os.path.join(OUT, name)
        with io.open(p, 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        print('  %s  %.1f KB' % (name, os.path.getsize(p) / 1024))
    dump('symbols.json', {'updated': stamp, 'count': len(symbols), 'items': symbols})
    dump('quotes.json', {'updated': stamp, 'items': quotes})
    dump('history.json', {'updated': stamp, 'interval': '1d', 'fields': ['t','o','h','l','c','v'], 'items': history})
    print('완료 · 종목 %d · 시세 %d · 일봉 %d' % (len(symbols), len(quotes), len(history)))

if __name__ == '__main__':
    main()

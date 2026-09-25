# -*- coding: utf-8 -*-
"""
미국 종목 수집 (nasdaq.com 공개 API)
  · 전체 스크리너   : 미국 상장 전종목 + 현재가/등락/시총/섹터
  · NASDAQ-100 구성 : list-type/nasdaq100
  · 대표 종목 일봉   : quote/{sym}/historical
기존 assets/data/*.json 에 병합합니다.
"""
import json, re, io, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import build_dataset as B

OUT = B.OUT
NASDAQ_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
FEATURED = ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','NFLX','AMD',
            'PLTR','COIN','JPM','LLY','COST','ORCL','MU','INTC','UBER','CRM']

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

def history(sym, years=2):
    today = time.strftime('%Y-%m-%d')
    frm = time.strftime('%Y-%m-%d', time.localtime(time.time() - years * 365 * 86400))
    raw = B.get('https://api.nasdaq.com/api/quote/%s/historical?assetclass=stocks&fromdate=%s&todate=%s&limit=600' % (sym, frm, today), timeout=25)
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

def main():
    sym, q, hist = load('symbols.json'), load('quotes.json'), load('history.json')
    by = {s['c']: s for s in sym['items']}

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

    print('[2/3] 대표 종목 일봉')
    ok = 0
    for i, s in enumerate(FEATURED):
        bars = history(s)
        if bars and len(bars) > 100:
            hist['items'][s] = bars[-520:]; ok += 1
        print('  %d/%d %s %s' % (i + 1, len(FEATURED), s, len(bars) if bars else 'x'))
        time.sleep(0.6)
    print('  성공 %d/%d' % (ok, len(FEATURED)))

    print('[3/3] 저장 · 미국 종목을 시총순으로 정렬')
    kr = [s for s in sym['items'] if s.get('cur') != 'USD']
    us = [s for s in sym['items'] if s.get('cur') == 'USD']
    order = {r['code']: i for i, r in enumerate(rows)}
    us.sort(key=lambda s: order.get(s['c'], 99999))
    sym['items'] = kr + us
    stamp = time.strftime('%Y-%m-%dT%H:%M:%S%z')
    sym['updated'] = q['updated'] = hist['updated'] = stamp
    sym['count'] = len(sym['items'])
    save('symbols.json', sym); save('quotes.json', q); save('history.json', hist)
    print('완료 · 종목 %d · 시세 %d · 일봉 %d' % (len(sym['items']), len(q['items']), len(hist['items'])))

if __name__ == '__main__':
    main()

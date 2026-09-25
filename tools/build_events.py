# -*- coding: utf-8 -*-
"""
이벤트 · 증시 일정 수집기
  · FOMC 일정      : federalreserve.gov (실제 공시 일정)
  · 미국 배당       : Yahoo Finance chart events (실제 배당락일/배당금)
  · 국내 컨센서스   : 네이버 integration API (목표주가/투자의견)
  · 나머지(실적발표 예상, 주총, 배당락 등)는 앱에서 규칙 기반으로 생성하고 '예상'으로 표기
실행: python3 tools/build_events.py
결과: assets/data/events.json
"""
import json, re, time, io, os, sys, subprocess

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'data')

def get(url, tries=3, timeout=15):
    for i in range(tries):
        try:
            r = subprocess.run(['curl', '-sL', '-m', str(timeout), '-A', UA, url], capture_output=True, timeout=timeout + 5)
            body = r.stdout.decode('utf-8', 'replace')
            if r.returncode == 0 and body.strip() and 'Too Many Requests' not in body[:64]:
                return body
            if 'Too Many Requests' in body[:64]: time.sleep(6 * (i + 1))
        except Exception:
            pass
        time.sleep(1.0 * (i + 1))
    return None

MONTHS = {'January':1,'February':2,'March':3,'April':4,'May':5,'June':6,
          'July':7,'August':8,'September':9,'October':10,'November':11,'December':12}

def fomc():
    html = get('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')
    if not html: return []
    out = []
    for panel in re.findall(r'<div class="panel panel-default">(.*?)(?=<div class="panel panel-default">|<div id="fomc-calendar-archive)', html, re.S):
        ym = re.search(r'(\d{4}) FOMC Meetings', panel)
        if not ym: continue
        year = int(ym.group(1))
        blocks = re.findall(r'fomc-meeting__month[^>]*>\s*<strong>([^<]*)</strong>.*?fomc-meeting__date[^>]*>([^<]*)<', panel, re.S)
        for mon, day in blocks:
            mon = mon.strip().split('/')[-1].strip()
            if mon not in MONTHS: continue
            d = day.strip().replace('*', '').strip()
            last = re.findall(r'\d+', d)
            if not last: continue
            try:
                t = int(time.mktime(time.strptime('%d-%02d-%02d' % (year, MONTHS[mon], int(last[-1])), '%Y-%m-%d'))) * 1000
            except Exception:
                continue
            out.append({ 't': t, 'kind':'macro', 'title':'FOMC 정례회의 (금리 결정)',
                         'detail':'%d년 %d월 · 결과 발표는 한국시간 익일 새벽' % (year, MONTHS[mon]),
                         'status':'확정', 'source':'federalreserve.gov' })
    return sorted(out, key=lambda x: x['t'])

def money(x):
    if x is None: return None
    x = str(x).replace('$', '').replace(',', '').strip()
    try: return float(x)
    except ValueError: return None

def ts(mmddyyyy):
    try: return int(time.mktime(time.strptime(mmddyyyy.strip(), '%m/%d/%Y'))) * 1000 + 9 * 3600000
    except Exception: return None

def us_dividends(sym):
    """nasdaq.com — 실제 배당락일 · 배당금 · 지급일"""
    raw = get('https://api.nasdaq.com/api/quote/%s/dividends?assetclass=stocks' % sym)
    if not raw: return None
    try:
        d = json.loads(raw)['data']
    except Exception:
        return None
    rows = ((d.get('dividends') or {}).get('rows') or [])
    divs = []
    for r in rows[:8]:
        t = ts(r.get('exOrEffDate') or '')
        amt = money(r.get('amount'))
        if t is None or amt is None: continue
        divs.append({'t': t, 'amount': amt, 'pay': r.get('paymentDate') or '', 'type': r.get('type') or 'Cash'})
    divs.sort(key=lambda x: x['t'])
    out = {'dividends': divs}
    if d.get('yield'): out['yield'] = d['yield']
    if d.get('annualizedDividend'): out['annual'] = d['annualizedDividend']
    if d.get('exDividendDate'): out['nextEx'] = d['exDividendDate']
    if d.get('dividendPaymentDate'): out['nextPay'] = d['dividendPaymentDate']
    return out if divs or out.get('nextEx') else None

def kr_consensus(code):
    raw = get('https://m.stock.naver.com/api/stock/%s/integration' % code)
    if not raw: return None
    try:
        d = json.loads(raw)
    except Exception:
        return None
    c = d.get('consensusInfo') or {}
    out = {}
    if c.get('priceTargetMean'):
        out['targetMean'] = c['priceTargetMean']
        out['recommMean'] = c.get('recommMean')
        out['asOf'] = c.get('createDate')
    ir = d.get('irScheduleInfo')
    if ir: out['ir'] = ir
    sm = d.get('shareholdersMeetingInfo')
    if sm: out['meeting'] = sm
    return out or None

def main():
    hist_path = os.path.join(OUT, 'history.json')
    featured = []
    if os.path.exists(hist_path):
        with io.open(hist_path, encoding='utf-8') as f:
            featured = list(json.load(f)['items'].keys())
    kr = [c for c in featured if re.match(r'^\d{6}$', c)]
    us = [c for c in featured if re.match(r'^[A-Z.\-]+$', c)]
    print('대상: 국내 %d · 미국 %d' % (len(kr), len(us)))

    print('[1/3] FOMC 일정')
    macro = fomc()
    print('  %d건' % len(macro))

    print('[2/3] 미국 배당 · 액면분할')
    symbols = {}
    for i, s in enumerate(us):
        r = us_dividends(s)
        if r and r.get('dividends') is not None:
            symbols[s] = r
        print('  %d/%d %s %s' % (i + 1, len(us), s, (len(r['dividends']) if r else 'x')))
        time.sleep(0.5)

    print('[3/3] 국내 컨센서스 · IR')
    for i, c in enumerate(kr):
        r = kr_consensus(c)
        if r: symbols[c] = r
        if (i + 1) % 10 == 0: print('  %d/%d' % (i + 1, len(kr)))
        time.sleep(0.2)

    p = os.path.join(OUT, 'events.json')
    with io.open(p, 'w', encoding='utf-8') as f:
        json.dump({ 'updated': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'macro': macro, 'symbols': symbols },
                  f, ensure_ascii=False, separators=(',', ':'))
    print('완료 · events.json %.1f KB · 심볼 %d' % (os.path.getsize(p) / 1024, len(symbols)))

if __name__ == '__main__':
    main()

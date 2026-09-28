# -*- coding: utf-8 -*-
"""
글로벌 매크로 일정 · 실적 발표일 · 국내 컨센서스 수집기
  · FOMC 일정      : federalreserve.gov (공식 일정, SEP·점도표 회의 표시)
  · 미국 경제지표   : bls.gov 발표 캘린더(iCalendar) — CPI · PPI · 고용보고서 공식 발표 시각
  · 실적 발표일     : api.nasdaq.com — 빅테크·대형주 다음 실적 발표일 (회사 공지 전이면 '예상')
  · 국내 컨센서스   : 네이버 integration API (목표주가 · 투자의견)
앱(assets/core/events.js)은 여기 없는 일정(금통위 · 한국 물가 · 수출입 · 만기 등)을
발표 패턴 규칙으로 만들고 '예상/규칙'으로 표기합니다. 이 파일의 일정은 같은 달 규칙 일정을 대체합니다.
실행: python3 tools/build_events.py
결과: assets/data/events.json
"""
import io, json, os, re, subprocess, sys, time
from datetime import datetime, timezone
try:
    from zoneinfo import ZoneInfo
    ET_TZ = ZoneInfo('America/New_York')
except Exception:                                   # Python 3.8 이하
    ET_TZ = None

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'data')

# assets/core/events.js 의 EARN 목록 중 미국 상장 종목
US_EARNINGS = ['JPM', 'ASML', 'TSM', 'NFLX', 'TSLA', 'INTC', 'GOOGL', 'MSFT', 'META', 'AAPL', 'AMZN',
               'PLTR', 'AMD', 'NVDA', 'AVGO', 'ORCL', 'MU']


def get(url, tries=3, timeout=15):
    for i in range(tries):
        try:
            r = subprocess.run(['curl', '-sL', '-m', str(timeout), '-A', UA, '-H', 'Accept: */*', url],
                               capture_output=True, timeout=timeout + 5)
            body = r.stdout.decode('utf-8', 'replace')
            if r.returncode == 0 and body.strip() and 'Too Many Requests' not in body[:64]:
                return body
            if 'Too Many Requests' in body[:64]:
                time.sleep(6 * (i + 1))
        except Exception:
            pass
        time.sleep(1.0 * (i + 1))
    return None


MONTHS = {'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
          'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12}
MON3 = {m[:3]: n for m, n in MONTHS.items()}


def fomc():
    """회의 마지막 날(결정일)과 경제전망(SEP) 여부. 달력의 * 표시가 SEP 회의입니다."""
    html = get('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')
    if not html:
        return []
    out = []
    for panel in re.findall(r'<div class="panel panel-default">(.*?)(?=<div class="panel panel-default">|<div id="fomc-calendar-archive)', html, re.S):
        ym = re.search(r'(\d{4}) FOMC Meetings', panel)
        if not ym:
            continue
        year = int(ym.group(1))
        blocks = re.findall(r'fomc-meeting__month[^>]*>\s*<strong>([^<]*)</strong>.*?fomc-meeting__date[^>]*>([^<]*)<', panel, re.S)
        for mon, day in blocks:
            mon = mon.strip().split('/')[-1].strip()
            if mon not in MONTHS:
                continue
            sep = '*' in day
            days = re.findall(r'\d+', day)
            if not days:
                continue
            out.append({'kind': 'fomc', 'date': '%d-%02d-%02d' % (year, MONTHS[mon], int(days[-1])),
                        'sep': sep, 'status': '확정', 'source': 'federalreserve.gov'})
    return sorted(out, key=lambda x: x['date'])


def et_ms(y, m, d, hh, mm):
    """미국 동부시간 → UTC epoch ms (서머타임 반영)"""
    if ET_TZ is None:
        return None
    return int(datetime(y, m, d, hh, mm, tzinfo=ET_TZ).timestamp() * 1000)


BLS_KINDS = [('Consumer Price Index', 'cpi'), ('Producer Price Index', 'ppi'), ('Employment Situation', 'nfp')]


def bls():
    """BLS 전체 발표 일정(iCalendar)에서 CPI · PPI · 고용보고서만 추립니다."""
    ics = get('https://www.bls.gov/schedule/news_release/bls.ics')
    if not ics or 'BEGIN:VCALENDAR' not in ics:
        return []
    ics = re.sub(r'\r?\n[ \t]', '', ics)                   # 줄 접힘 해제
    out, now = [], time.time() * 1000
    for ev in re.findall(r'BEGIN:VEVENT(.*?)END:VEVENT', ics, re.S):
        summary = re.search(r'^SUMMARY[^:]*:(.*)$', ev, re.M)
        start = re.search(r'^DTSTART([^:]*):(\d{8})(?:T(\d{4,6}))?(Z?)', ev, re.M)
        if not summary or not start:
            continue
        kind = next((k for name, k in BLS_KINDS if summary.group(1).strip().startswith(name)), None)
        if not kind:
            continue
        ds, tm, z = start.group(2), start.group(3) or '083000', start.group(4)
        y, mo, d, hh, mi = int(ds[:4]), int(ds[4:6]), int(ds[6:8]), int(tm[:2]), int(tm[2:4])
        t = int(datetime(y, mo, d, hh, mi, tzinfo=timezone.utc).timestamp() * 1000) if z else et_ms(y, mo, d, hh, mi)
        if t is None or t < now - 40 * 86400000:
            continue
        out.append({'kind': kind, 't': t, 'status': '확정', 'source': 'bls.gov'})
    return sorted(out, key=lambda x: x['t'])


def us_earnings(sym):
    """nasdaq.com 다음 실적 발표일. 회사 공지 전(estimated)이면 '예상'."""
    raw = get('https://api.nasdaq.com/api/analyst/%s/earnings-date' % sym)
    if not raw:
        return None
    try:
        d = json.loads(raw).get('data') or {}
    except Exception:
        return None
    text = '%s %s' % (d.get('announcement') or '', d.get('reportText') or '')
    m = re.search(r'([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})', d.get('announcement') or '')
    m2 = re.search(r'(\d{2})/(\d{2})/(\d{4})', d.get('reportText') or '')
    if m and m.group(1) in MON3:
        y, mo, dd = int(m.group(3)), MON3[m.group(1)], int(m.group(2))
    elif m2:
        y, mo, dd = int(m2.group(3)), int(m2.group(1)), int(m2.group(2))
    else:
        return None
    low = text.lower()
    when = 'amc' if 'after market close' in low else 'bmo' if 'before market open' in low else None
    out = {'code': sym, 'date': '%d-%02d-%02d' % (y, mo, dd), 'status': '예상' if 'estimated' in low else '확정',
           'source': 'nasdaq.com'}
    if when:
        out['when'] = when
    return out


def kr_consensus(code):
    raw = get('https://m.stock.naver.com/api/stock/%s/integration' % code)
    if not raw:
        return None
    try:
        d = json.loads(raw)
    except Exception:
        return None
    c = d.get('consensusInfo') or {}
    if not c.get('priceTargetMean'):
        return None
    return {'targetMean': c['priceTargetMean'], 'recommMean': c.get('recommMean'), 'asOf': c.get('createDate')}


def main():
    hist_path = os.path.join(OUT, 'history.json')
    featured = []
    if os.path.exists(hist_path):
        with io.open(hist_path, encoding='utf-8') as f:
            featured = list(json.load(f)['items'].keys())
    kr = [c for c in featured if re.match(r'^\d{6}$', c)]

    print('[1/4] FOMC 일정')
    macro = fomc()
    print('  %d건' % len(macro))

    print('[2/4] BLS 발표 일정 (CPI · PPI · 고용)')
    b = bls()
    print('  %d건%s' % (len(b), '' if ET_TZ else ' (zoneinfo 없음 — Python 3.9+ 필요)'))
    macro += b

    print('[3/4] 실적 발표일')
    earnings = []
    for s in US_EARNINGS:
        r = us_earnings(s)
        if r:
            earnings.append(r)
        print('  %-6s %s' % (s, (r['date'] + ' ' + r['status']) if r else 'x'))
        time.sleep(0.4)

    print('[4/4] 국내 컨센서스')
    symbols = {}
    for i, c in enumerate(kr):
        r = kr_consensus(c)
        if r:
            symbols[c] = r
        if (i + 1) % 10 == 0:
            print('  %d/%d' % (i + 1, len(kr)))
        time.sleep(0.2)

    p = os.path.join(OUT, 'events.json')
    if not macro and not earnings and not symbols and os.path.exists(p):
        print('수집된 데이터가 없습니다 — 기존 events.json 을 유지합니다.')
        return 1
    with io.open(p, 'w', encoding='utf-8') as f:
        json.dump({'updated': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'macro': macro, 'earnings': earnings, 'symbols': symbols},
                  f, ensure_ascii=False, separators=(',', ':'))
    print('완료 · events.json %.1f KB · 매크로 %d · 실적 %d · 컨센서스 %d' % (os.path.getsize(p) / 1024, len(macro), len(earnings), len(symbols)))
    return 0


if __name__ == '__main__':
    sys.exit(main())

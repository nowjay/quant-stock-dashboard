# -*- coding: utf-8 -*-
"""
글로벌 매크로 일정 · 실적 발표일 · 국내 컨센서스 수집기
  · FOMC 일정      : federalreserve.gov (공식 일정, SEP·점도표 회의 표시)
  · 미국 경제지표   : bls.gov 발표 캘린더(iCalendar) — CPI · PPI · 고용보고서 공식 발표 시각
                     bls.gov 는 자동 요청을 403 으로 막는 일이 잦아, 받지 못하면 아래 OFFICIAL_MACRO(직접 확인한 공식 일정)로 채웁니다.
                     PCE · GDP(bea.gov) · 금통위(한국은행)는 수집 경로가 없어 OFFICIAL_MACRO 에만 있습니다.
  · 실적 발표일     : api.nasdaq.com — 빅테크·대형주 다음 실적 발표일 (회사 공지 전이면 '예상')
                     nasdaq 에 날짜가 없거나 '예상'뿐인 종목은 MANUAL_EARNINGS(회사 공지로 확인한 날짜)로 보완합니다.
  · 국내 컨센서스   : 네이버 integration API (목표주가 · 투자의견)
앱(assets/core/events.js)은 여기 없는 일정(금통위 · 한국 물가 · 수출입 · 만기 등)을
발표 패턴 규칙으로 만들고 '예상/규칙'으로 표기합니다. 이 파일의 일정은 같은 달 규칙 일정을 대체합니다.
실행: python3 tools/build_events.py
결과: assets/data/events.json
"""
import io, json, os, re, subprocess, sys, time
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo
    ET_TZ = ZoneInfo('America/New_York')
except Exception:                                   # Python 3.8 이하
    ET_TZ = None

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'data')

# assets/core/events.js 의 EARN 목록 중 미국 상장 종목
US_EARNINGS = ['JPM', 'ASML', 'TSM', 'NFLX', 'TSLA', 'INTC', 'GOOGL', 'MSFT', 'META', 'AAPL', 'AMZN',
               'PLTR', 'AMD', 'NVDA', 'AVGO', 'ORCL', 'MU', 'SNDK', 'LLY']

# ---------------------------------------------------------------------------------------------
# 직접 확인한 공식 일정 — 수집이 막히거나(bls.gov 403) 수집 경로가 없는(bea.gov · 한국은행) 일정.
# 앱의 날짜 규칙은 '발표 패턴 추정'이라 공휴일 · 기관 사정으로 어긋난다
#   (2026년 11~12월: CPI 11/11 → 실제 11/10, 12/16 → 12/10 · PPI 11/12 → 11/13, 12/17 → 12/15 · PCE 10/30 → 10/29, 11/27 → 11/25, 12/24 → 12/23).
# 기관이 다음 해 일정을 발표하면(BLS · BEA 는 가을, 한국은행은 10월 말) 여기에 추가합니다.
# (종류, 날짜, 시, 분, 시간대, 출처)  — 확인일 2026-10-01
# ---------------------------------------------------------------------------------------------
OFFICIAL_MACRO = [
    ('nfp', '2026-10-02', 8, 30, 'ET', 'bls.gov'), ('nfp', '2026-11-06', 8, 30, 'ET', 'bls.gov'), ('nfp', '2026-12-04', 8, 30, 'ET', 'bls.gov'),
    ('cpi', '2026-10-14', 8, 30, 'ET', 'bls.gov'), ('cpi', '2026-11-10', 8, 30, 'ET', 'bls.gov'), ('cpi', '2026-12-10', 8, 30, 'ET', 'bls.gov'),
    ('ppi', '2026-10-15', 8, 30, 'ET', 'bls.gov'), ('ppi', '2026-11-13', 8, 30, 'ET', 'bls.gov'), ('ppi', '2026-12-15', 8, 30, 'ET', 'bls.gov'),
    ('pce', '2026-10-29', 8, 30, 'ET', 'bea.gov'), ('pce', '2026-11-25', 8, 30, 'ET', 'bea.gov'), ('pce', '2026-12-23', 8, 30, 'ET', 'bea.gov'),
    ('gdp', '2026-10-29', 8, 30, 'ET', 'bea.gov'),
    ('bok', '2026-10-22', 10, 0, 'KST', '한국은행'), ('bok', '2026-11-26', 10, 0, 'KST', '한국은행'),
]

# 회사가 공지한 실적 발표일 — nasdaq 에 날짜가 없거나 '예상'으로만 나오는 종목.
# nasdaq 이 같은 분기를 '확정'으로 주기 시작하면 그 값을 씁니다. 지난 일정은 10일 뒤 자동으로 빠집니다.
# (종목, 현지 날짜, bmo/amc, 출처)  — 확인일 2026-10-01
MANUAL_EARNINGS = [
    ('MU',   '2026-09-30', 'amc', 'sec.gov 8-K'),                       # 2026 회계연도 4분기 (발표 보도자료)
    ('SNDK', '2026-10-29', 'amc', '회사 공지 (tipranks.com 보도)'),       # 2027 회계연도 1분기 · 컨퍼런스콜 16:30 ET
    ('NVDA', '2026-11-17', 'amc', 'wallstreethorizon.com (회사 확정)'),   # 2027 회계연도 3분기
]


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
BLS_PAGES = [('cpi', 'cpi'), ('ppi', 'ppi'), ('nfp', 'empsit')]
# BLS 는 일반 브라우저/봇 UA 요청을 403 으로 막고, 연락처가 담긴 UA 를 요구합니다.
BLS_HEADERS = [
    ['-A', 'quant-stock-dashboard/1.0 (+https://github.com/nowjay/quant-stock-dashboard; data-schedule@users.noreply.github.com)',
     '-H', 'Accept: text/calendar,text/html;q=0.9,*/*;q=0.8', '-H', 'Accept-Language: en-US,en;q=0.9'],
    ['-A', UA, '-H', 'Accept: text/html,application/xhtml+xml,*/*;q=0.8', '-H', 'Accept-Language: en-US,en;q=0.9',
     '-H', 'Referer: https://www.bls.gov/schedule/'],
]


def bls_get(url):
    """헤더 조합을 바꿔 가며 요청하고, 실패하면 상태 코드와 본문 앞부분을 출력합니다."""
    for h in BLS_HEADERS:
        try:
            r = subprocess.run(['curl', '-sL', '-m', '20', '-w', '\n%{http_code}'] + h + [url], capture_output=True, timeout=30)
        except Exception as e:
            print('    ! %s %s' % (url, e)); continue
        body, _, code = r.stdout.decode('utf-8', 'replace').rpartition('\n')
        if code == '200' and body.strip():
            return body
        print('    ! %s HTTP %s · %s' % (url.split('/')[-1], code or r.returncode, re.sub(r'\s+', ' ', body[:120])))
        time.sleep(1)
    return None


def bls_ics():
    """BLS 전체 발표 일정(iCalendar)에서 CPI · PPI · 고용보고서만 추립니다."""
    ics = bls_get('https://www.bls.gov/schedule/news_release/bls.ics')
    if not ics or 'BEGIN:VCALENDAR' not in ics:
        return []
    ics = re.sub(r'\r?\n[ \t]', '', ics)                   # 줄 접힘 해제
    out = []
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
        if t is not None:
            out.append({'kind': kind, 't': t})
    return out


def bls_pages():
    """지표별 발표 일정 표(cpi.htm · ppi.htm · empsit.htm) — 'Oct. 14, 2026 | 08:30 AM' 형식의 행"""
    out = []
    for kind, page in BLS_PAGES:
        html = bls_get('https://www.bls.gov/schedule/news_release/%s.htm' % page)
        if not html:
            continue
        n = 0
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S | re.I):
            cells = [re.sub(r'<[^>]+>|&nbsp;', ' ', c).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S | re.I)]
            text = ' | '.join(cells)
            m = re.search(r'([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4})\s*\|\s*(\d{1,2}):(\d{2})\s*([AP])\.?M', text)
            if not m or m.group(1) not in MON3:
                continue
            hh = int(m.group(4)) % 12 + (12 if m.group(6) == 'P' else 0)
            t = et_ms(int(m.group(3)), MON3[m.group(1)], int(m.group(2)), hh, int(m.group(5)))
            if t is not None:
                out.append({'kind': kind, 't': t}); n += 1
        print('    %s.htm %d건' % (page, n))
    return out


def official_macro(have):
    """OFFICIAL_MACRO 중 수집으로 채워지지 않은 (종류, 달)만. have: 이미 수집한 일정 [{kind, t}]"""
    def month(t, tz):
        return datetime.fromtimestamp(t / 1000, tz).strftime('%Y-%m')
    kst = timezone(timedelta(hours=9))
    seen = {(r['kind'], month(r['t'], kst)) for r in have if 't' in r}
    now, out = time.time() * 1000, []
    for kind, day, hh, mm, tz, src in OFFICIAL_MACRO:
        y, mo, d = (int(x) for x in day.split('-'))
        t = et_ms(y, mo, d, hh, mm) if tz == 'ET' else int(datetime(y, mo, d, hh, mm, tzinfo=kst).timestamp() * 1000)
        if t is None or t < now - 40 * 86400000 or (kind, month(t, kst)) in seen:
            continue
        out.append({'kind': kind, 't': t, 'status': '확정', 'source': src})
    return out


def manual_earnings(found):
    """nasdaq 결과(found)에 MANUAL_EARNINGS 를 합친다. nasdaq '확정'이 있으면 그 값, 없으면 직접 확인한 날짜."""
    today = datetime.now(timezone.utc).date()
    out = list(found)
    for code, day, when, src in MANUAL_EARNINGS:
        d = datetime.strptime(day, '%Y-%m-%d').date()
        if (today - d).days > 10:
            continue
        near = [e for e in out if e['code'] == code and abs((datetime.strptime(e['date'], '%Y-%m-%d').date() - d).days) < 25]
        if any(e['status'] == '확정' for e in near):
            continue
        out = [e for e in out if e not in near]
        out.append({'code': code, 'date': day, 'when': when, 'status': '확정', 'source': src})
    return out


def bls():
    """CPI · PPI · 고용보고서 공식 발표 시각. iCalendar → 지표별 일정 페이지 순서로 시도"""
    if ET_TZ is None:
        return []
    rows = bls_ics()
    if not rows:
        print('  iCalendar 실패 — 지표별 일정 페이지로 대체')
        rows = bls_pages()
    now, seen, out = time.time() * 1000, set(), []
    for r in sorted(rows, key=lambda x: x['t']):
        key = (r['kind'], r['t'])
        if r['t'] < now - 40 * 86400000 or key in seen:
            continue
        seen.add(key)
        out.append({'kind': r['kind'], 't': r['t'], 'status': '확정', 'source': 'bls.gov'})
    return out


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
    o = official_macro(b)
    print('  + 직접 확인한 공식 일정 %d건 (BLS 미수집분 · BEA · 한국은행)' % len(o))
    macro += o

    print('[3/4] 실적 발표일')
    earnings = []
    for s in US_EARNINGS:
        r = us_earnings(s)
        if r:
            earnings.append(r)
        print('  %-6s %s' % (s, (r['date'] + ' ' + r['status']) if r else 'x'))
        time.sleep(0.4)
    n = len(earnings)
    earnings = manual_earnings(earnings)
    print('  + 회사 공지로 확인한 일정 반영 (%d → %d건)' % (n, len(earnings)))

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

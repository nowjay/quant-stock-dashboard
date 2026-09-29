# -*- coding: utf-8 -*-
"""
재무 · 가치분석 데이터 수집기
  · 국내 : 네이버 금융 (연간 3개년+추정 · 최근 5분기+추정)
           WiseReport(네이버 기업정보) 기업현황 · 투자지표 5개년 · 현금흐름표
             - TTM EPS/BPS · 업종 PER(WICS) · 베타 · 발행주식수 · 컨센서스 목표주가/투자의견
             - 연말 PER/PBR/EV·EBITDA · 부채비율 · 유보율 · 이자보상배율 · 유동비율 · 영업현금흐름 · CAPEX
  · 미국 : nasdaq.com 공개 API (연간 4개년 · 최근 4분기 손익/재무상태/현금흐름 · 요약 · EPS 컨센서스 · 연말 종가)
실행: python3 tools/build_fundamentals.py              (기본 대상 전체)
      python3 tools/build_fundamentals.py 005930 NVDA  (지정 종목만 갱신해 기존 파일에 병합)
결과: assets/data/fundamentals.json
  · 금액 단위 : 국내 억원 · 미국 백만 달러
  · 주가에 따라 변하는 값(PER · PBR · 배당수익률 · 적정주가 괴리)은 브라우저에서 현재가로 다시 계산합니다.
"""
import json, re, io, os, sys, time, statistics
sys.path.insert(0, os.path.dirname(__file__))
import build_dataset as B

OUT = B.OUT
WR = 'https://navercomp.wisereport.co.kr/v2/company/'
US_EXTRA = ['GOOG', 'V', 'MA', 'WMT', 'XOM', 'UNH', 'HD', 'PG', 'JNJ', 'ABBV', 'KO', 'PEP', 'BAC',
            'ADBE', 'CSCO', 'QCOM', 'TXN', 'AMAT', 'LRCX', 'KLAC', 'ANET', 'NOW', 'IBM', 'CVX', 'MRK', 'DIS', 'MCD']
KR_TOP = {'KOSPI': 80, 'KOSDAQ': 25}          # 시가총액 상위 (symbols.json 은 시총 순)
DEFAULT_WL = ['005930', '000660', '373220', '035420', '005380', '196170', 'NVDA', 'AAPL']


def num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).replace(',', '').replace('%', '').replace('$', '').replace('배', '').replace('원', '').strip()
    if s in ('', '-', '--', 'N/A', 'NA'): return None
    neg = s.startswith('(') and s.endswith(')')
    try:
        x = float(s.strip('()'))
        return -x if neg else x
    except ValueError:
        return None

def rnd(v, dp=2):
    return None if v is None else round(v, dp)

def get_json(url, **kw):
    raw = B.get(url, **kw)
    if not raw: return None
    try: return json.loads(raw)
    except Exception: return None

def curl(url, referer=None, timeout=15):
    """Referer 가 필요한 WiseReport AJAX 용"""
    import subprocess
    args = ['curl', '-sL', '-m', str(timeout), '-A', B.UA]
    if referer: args += ['-e', referer]
    for i in range(3):
        try:
            r = subprocess.run(args + [url], capture_output=True, timeout=timeout + 5)
            body = r.stdout.decode('utf-8', 'replace')
            if r.returncode == 0 and body.strip(): return body
        except Exception:
            pass
        time.sleep(1.0 * (i + 1))
    return None


# =====================================================================
#  국내
# =====================================================================
def naver_fin(code, period):
    d = get_json('https://m.stock.naver.com/api/stock/%s/finance/%s' % (code, period))
    fi = (d or {}).get('financeInfo') or {}
    cols = fi.get('trTitleList') or []
    if not cols: return None
    keys = [c['key'] for c in cols]
    rows = {r['title']: r.get('columns') or {} for r in fi.get('rowList') or []}
    def row(title, dp=2):
        c = rows.get(title) or {}
        return [rnd(num((c.get(k) or {}).get('value')), dp) for k in keys]
    label = [c['title'].rstrip('.').replace('.', '.') for c in cols]
    return {
        'p': [l if period == 'quarter' else l[:4] for l in label],
        'e': [1 if c.get('isConsensus') == 'Y' else 0 for c in cols],
        'rev': row('매출액', 0), 'op': row('영업이익', 0), 'ni': row('당기순이익', 0), 'nic': row('지배주주순이익', 0),
        'opm': row('영업이익률'), 'npm': row('순이익률'), 'roe': row('ROE'),
        'debt': row('부채비율'), 'quick': row('당좌비율'), 'reserve': row('유보율'),
        'eps': row('EPS', 0), 'bps': row('BPS', 0), 'dps': row('주당배당금', 0),
        'per': row('PER'), 'pbr': row('PBR'),
    }

def wr_text(html):
    t = re.sub(r'<script.*?</script>', ' ', html, flags=re.S)
    t = re.sub(r'<[^>]+>', ' ', t)
    return re.sub(r'\s+', ' ', t.replace('&nbsp;', ' '))

def wr_summary(code):
    url = WR + 'c1010001.aspx?cmp_cd=' + code
    html = curl(url)
    if not html or 'cmp-table' not in html: return None, None
    t = wr_text(html)
    def after(label, pat=r'(-?[\d,]+(?:\.\d+)?)'):
        m = re.search(re.escape(label) + r'\s*' + pat, t)
        return num(m.group(1)) if m else None
    enc = re.search(r"encparam: '([^']+)'", html)
    wics = re.search(r'WICS : ([^<]+)</dt>', html)
    mkt = re.search(r'(KOSPI|KOSDAQ) : ([^<]+)</dt>', html)
    shares = re.search(r'발행주식수/유동비율\s*([\d,]+)주', t)
    cons = re.search(r'투자의견 목표주가 \(원\) EPS \(원\) PER \(배\) 추정기관수\s*([\d.]+)\s+([\d,]+|-)\s+([\-\d,]+|-)\s+([\-\d.,]+|-)\s+(\d+)', t)
    ev = re.search(r'EV/EBITDA\s+(-?[\d.,]+|-)\s+(-?[\d.,]+|-)', t)
    out = {
        'eps': after('EPS'), 'bps': after('BPS'), 'per': after('PER'), 'indPer': after('업종PER'),
        'pbr': after('PBR'), 'dy': after('현금배당수익률'),
        'beta': after('52주베타'), 'mcap': after('시가총액'),
        'shares': num(shares.group(1)) if shares else None,
        'ind': wics.group(1).strip() if wics else None,
        'mktInd': mkt.group(2).strip() if mkt else None,
        'evEbitda': num(ev.group(1)) if ev else None,
    }
    if cons:
        out['cons'] = {'opinion': num(cons.group(1)), 'target': num(cons.group(2)),
                       'eps': num(cons.group(3)), 'per': num(cons.group(4)), 'n': int(cons.group(5))}
    return out, (enc.group(1) if enc else None)

def wr_ratio(code, enc, rpt):
    ref = WR + 'c1040001.aspx?cmp_cd=' + code
    raw = curl(WR + 'cF4002.aspx?cmp_cd=%s&frq=0&rpt=%d&finGubun=MAIN&frqTyp=0&cn=&encparam=%s' % (code, rpt, enc), referer=ref)
    try: d = json.loads(raw)
    except Exception: return None
    yymm = [re.sub(r'<br.*', '', y) for y in d.get('YYMM') or []]
    rows = {}
    for r in d.get('DATA') or []:
        nm = (r.get('ACC_NM') or '').strip().lstrip('.')
        if nm and nm not in rows:
            rows[nm] = [r.get('DATA%d' % i) for i in range(1, 7)]
    return {'yymm': yymm[:6], 'rows': rows}

def wr_cashflow(code, enc):
    ref = WR + 'c1030001.aspx?cmp_cd=' + code
    raw = curl(WR + 'cF3002.aspx?cmp_cd=%s&frq=0&rpt=2&finGubun=MAIN&frqTyp=0&cn=&encparam=%s' % (code, enc), referer=ref)
    try: d = json.loads(raw)
    except Exception: return None
    rows = {}
    for r in d.get('DATA') or []:
        nm = (r.get('ACC_NM') or '').strip().lstrip('.')
        if nm and nm not in rows:
            rows[nm] = [r.get('DATA%d' % i) for i in range(1, 7)]
    return rows

def kr_item(code):
    ann = naver_fin(code, 'annual'); time.sleep(0.12)
    qtr = naver_fin(code, 'quarter'); time.sleep(0.12)
    if not ann: return None
    s, enc = wr_summary(code); time.sleep(0.15)
    item = {'cur': 'KRW', 'unit': '억원', 'annual': ann, 'quarter': qtr}
    if s:
        item.update({k: s[k] for k in ('ind', 'mktInd', 'indPer', 'beta', 'shares', 'evEbitda') if s.get(k) is not None})
        item['ttm'] = {'eps': s.get('eps'), 'bps': s.get('bps'), 'per': s.get('per'), 'pbr': s.get('pbr'), 'dy': s.get('dy')}
        if s.get('cons'): item['cons'] = s['cons']
    if enc:
        hist = {}
        r3 = wr_ratio(code, enc, 3); time.sleep(0.15)
        r5 = wr_ratio(code, enc, 5); time.sleep(0.15)
        cf = wr_cashflow(code, enc); time.sleep(0.15)
        base = r5 or r3
        if base:
            n = sum(1 for y in base['yymm'] if '(E)' not in y and re.match(r'\d{4}/\d{2}', y))
            n = min(n, 5)
            hist['p'] = [y[:4] for y in base['yymm'][:n]]
            def take(src, name, dp=2):
                if not src: return None
                v = src['rows'].get(name) if isinstance(src, dict) and 'rows' in src else src.get(name)
                return [rnd(num(x), dp) for x in v[:n]] if v else None
            fields = {
                'per': take(r5, 'PER'), 'pbr': take(r5, 'PBR'), 'evEbitda': take(r5, 'EV/EBITDA'),
                'ebitda': take(r5, 'EBITDA＜당기＞', 0), 'dy': take(r5, '현금배당수익률'), 'payout': take(r5, '현금배당성향(%)'),
                'eps': take(r5, 'EPS', 0), 'bps': take(r5, 'BPS', 0), 'dps': take(r5, 'DPS', 0),
                'debt': take(r3, '부채비율'), 'reserve': take(r3, '자본유보율', 1), 'icr': take(r3, '이자보상배율'),
                'current': take(r3, '유동비율'), 'netDebt': take(r3, '순부채비율'),
                'ocf': take(cf, '영업활동으로인한현금흐름', 0), 'capex': take(cf, '유형자산의증가', 0),
            }
            for k, v in fields.items():
                if v and any(x is not None for x in v): hist[k] = v
        if hist.get('p'): item['hist'] = hist
    return item


# =====================================================================
#  미국
# =====================================================================
def nq(url):
    d = get_json(url, timeout=25)
    return (d or {}).get('data') or None

def nq_table(t):
    if not t: return None, {}
    hd = t.get('headers') or {}
    cols = [hd.get('value%d' % i) for i in range(2, 7) if hd.get('value%d' % i)]
    rows = {}
    for r in t.get('rows') or []:
        k = r.get('value1')
        if k and k not in rows:
            rows[k] = [num(r.get('value%d' % i)) for i in range(2, 2 + len(cols))]
    return cols, rows

def mm(v):  # nasdaq 재무표는 천 달러 단위 → 백만 달러
    return None if v is None else round(v / 1000.0, 1)

def us_fin(sym, freq):
    d = nq('https://api.nasdaq.com/api/company/%s/financials?frequency=%d' % (sym, freq))
    if not d: return None
    cols, inc = nq_table(d.get('incomeStatementTable'))
    _, bal = nq_table(d.get('balanceSheetTable'))
    _, cf = nq_table(d.get('cashFlowTable'))
    if not cols or not inc: return None
    n = len(cols)
    def g(tb, k): return (tb.get(k) or [None] * n)[:n]
    rev, op, ni = g(inc, 'Total Revenue'), g(inc, 'Operating Income'), g(inc, 'Net Income')
    eq, liab = g(bal, 'Total Equity'), g(bal, 'Total Liabilities')
    out = {
        'date': cols, 'rev': [mm(x) for x in rev], 'op': [mm(x) for x in op], 'ni': [mm(x) for x in ni],
        'int': [mm(abs(x)) if x else None for x in g(inc, 'Interest Expense')],
        'eq': [mm(x) for x in eq], 'liab': [mm(x) for x in liab],
        'ca': [mm(x) for x in g(bal, 'Total Current Assets')], 'cl': [mm(x) for x in g(bal, 'Total Current Liabilities')],
        'cash': [mm((a or 0) + (b or 0)) if (a is not None or b is not None) else None
                 for a, b in zip(g(bal, 'Cash and Cash Equivalents'), g(bal, 'Short-Term Investments'))],
        'debtAmt': [mm((a or 0) + (b or 0)) if (a is not None or b is not None) else None
                    for a, b in zip(g(bal, 'Short-Term Debt / Current Portion of Long-Term Debt'), g(bal, 'Long-Term Debt'))],
        'da': [mm(x) for x in g(cf, 'Depreciation')], 'ocf': [mm(x) for x in g(cf, 'Net Cash Flow-Operating')],
        'capex': [mm(abs(x)) if x is not None else None for x in g(cf, 'Capital Expenditures')],
    }
    return out

def us_hist_close(sym, dates):
    """회계연도 말 종가 (연말 PER/PBR 계산용)"""
    if not dates: return {}
    import datetime
    ds = []
    for s in dates:
        try: ds.append(datetime.datetime.strptime(s, '%m/%d/%Y').date())
        except Exception: pass
    if not ds: return {}
    frm = (min(ds) - datetime.timedelta(days=10)).isoformat()
    to = datetime.date.today().isoformat()
    d = nq('https://api.nasdaq.com/api/quote/%s/historical?assetclass=stocks&fromdate=%s&todate=%s&limit=2000' % (sym, frm, to))
    rows = ((d or {}).get('tradesTable') or {}).get('rows') or []
    px = []
    for r in rows:
        try: px.append((datetime.datetime.strptime(r['date'], '%m/%d/%Y').date(), num(r['close'])))
        except Exception: pass
    px.sort()
    out = {}
    for s, dd in zip(dates, ds):
        prior = [c for t, c in px if t <= dd]
        if prior: out[s] = prior[-1]
    return out

def fy_label(date_str):
    m = re.match(r'(\d+)/(\d+)/(\d{4})', date_str or '')
    return m.group(3) if m else date_str

def q_label(date_str):
    m = re.match(r'(\d+)/(\d+)/(\d{4})', date_str or '')
    return '%s.%02d' % (m.group(3), int(m.group(1))) if m else date_str

def us_item(sym):
    a = us_fin(sym, 1); time.sleep(0.4)
    q = us_fin(sym, 2); time.sleep(0.4)
    if not a: return None
    summ = nq('https://api.nasdaq.com/api/quote/%s/summary?assetclass=stocks' % sym) or {}; time.sleep(0.4)
    sd = summ.get('summaryData') or {}
    val = lambda k: (sd.get(k) or {}).get('value')
    fc = nq('https://api.nasdaq.com/api/analyst/%s/earnings-forecast' % sym) or {}; time.sleep(0.4)
    yr = ((fc.get('yearlyForecast') or {}).get('rows') or [])
    closes = us_hist_close(sym, a['date']); time.sleep(0.4)

    prev = num(val('PreviousClose'))
    mcap = num(val('MarketCap'))
    shares = mcap / prev if mcap and prev else None
    # 연간은 최신 → 과거 순으로 오므로 과거 → 최신으로 뒤집는다
    rv = lambda arr: list(reversed(arr))
    A = {k: rv(v) for k, v in a.items()}
    years = [fy_label(d) for d in A['date']]
    per_sh = lambda v: (v * 1e6 / shares) if (v is not None and shares) else None
    eps = [rnd(per_sh(x), 2) for x in A['ni']]
    bps = [rnd(per_sh(x), 2) for x in A['eq']]
    hist_px = [closes.get(d) for d in A['date']]
    ann = {
        'p': years, 'e': [0] * len(years), 'rev': A['rev'], 'op': A['op'], 'ni': A['ni'],
        'opm': [rnd(o / r * 100) if o is not None and r else None for o, r in zip(A['op'], A['rev'])],
        'npm': [rnd(n / r * 100) if n is not None and r else None for n, r in zip(A['ni'], A['rev'])],
        'roe': [rnd(n / e * 100) if n is not None and e and e > 0 else None for n, e in zip(A['ni'], A['eq'])],
        'debt': [rnd(l / e * 100) if l is not None and e and e > 0 else None for l, e in zip(A['liab'], A['eq'])],
        'eps': eps, 'bps': bps,
    }
    ebitda = [rnd((o or 0) + (d or 0), 1) if o is not None else None for o, d in zip(A['op'], A['da'])]
    hist = {
        'p': years,
        'per': [rnd(p / e) if p and e and e > 0 else None for p, e in zip(hist_px, eps)],
        'pbr': [rnd(p / b) if p and b and b > 0 else None for p, b in zip(hist_px, bps)],
        'eps': eps, 'bps': bps, 'ebitda': ebitda,
        'debt': ann['debt'],
        'icr': [rnd(o / i, 1) if o is not None and i else None for o, i in zip(A['op'], A['int'])],
        'current': [rnd(c / l * 100) if c is not None and l else None for c, l in zip(A['ca'], A['cl'])],
        'ocf': A['ocf'], 'capex': A['capex'],
        'evEbitda': [rnd((p * shares / 1e6 + (dd or 0) - (cc or 0)) / e) if p and shares and e and e > 0 else None
                     for p, dd, cc, e in zip(hist_px, A['debtAmt'], A['cash'], ebitda)],
    }
    fye = re.match(r'(\d+)/', A['date'][-1] or '')
    item = {'cur': 'USD', 'unit': '백만달러', 'annual': ann, 'hist': hist,
            'ind': val('Industry') or None, 'sector': val('Sector') or None, 'shares': rnd(shares, 0),
            'fye': int(fye.group(1)) if fye else 12}           # 회계연도 종료 월 (밴드 차트 연도 정렬용)
    if q:
        Q = {k: rv(v) for k, v in q.items()}
        item['quarter'] = {
            'p': [q_label(d) for d in Q['date']], 'e': [0] * len(Q['date']),
            'rev': Q['rev'], 'op': Q['op'], 'ni': Q['ni'],
            'opm': [rnd(o / r * 100) if o is not None and r else None for o, r in zip(Q['op'], Q['rev'])],
        }
        ni4 = [x for x in Q['ni'] if x is not None]
        eq_last = next((x for x in reversed(Q['eq']) if x), None)
        ttm_eps = per_sh(sum(ni4)) if len(ni4) == 4 else None
        item['ttm'] = {'eps': rnd(ttm_eps, 2), 'bps': rnd(per_sh(eq_last), 2) if eq_last else bps[-1]}
        # 최신 분기 재무상태 (부채 · 현금) — EV 계산용
        item['bs'] = {'debt': next((x for x in reversed(Q['debtAmt']) if x is not None), None),
                      'cash': next((x for x in reversed(Q['cash']) if x is not None), None),
                      'eq': eq_last, 'liab': next((x for x in reversed(Q['liab']) if x is not None), None)}
        # TTM EBITDA (영업이익 + 연간 감가상각 근사)
        op4 = [x for x in Q['op'] if x is not None]
        if len(op4) == 4:
            item['ttm']['ebitda'] = rnd(sum(op4) + (A['da'][-1] or 0), 1)
            item['ttm']['op'] = rnd(sum(op4), 1)
        int4 = [x for x in Q['int'] if x]
        if len(int4) == 4 and sum(int4) > 0 and len(op4) == 4:
            item['ttm']['icr'] = rnd(sum(op4) / sum(int4), 1)
    dy = num(val('Yield'))
    ad = num(val('AnnualizedDividend'))
    item['div'] = {'dps': ad, 'dy': dy}
    tgt = num(val('OneYrTarget'))
    if yr:
        f0 = yr[0]
        item['fwd'] = {'eps': num(f0.get('consensusEPSForecast')), 'fy': f0.get('fiscalEnd'), 'n': f0.get('noOfEstimates')}
        if len(yr) > 1:
            item['fwd']['eps2'] = num(yr[1].get('consensusEPSForecast'))
    if tgt:
        item['cons'] = {'target': tgt, 'n': (item.get('fwd') or {}).get('n')}
    return item


# =====================================================================
#  실행
# =====================================================================
def targets():
    sym = B.load('symbols.json') or {'items': []}
    hist = B.load('history.json') or {'items': {}}
    by = {s['c']: s for s in sym['items']}
    kr, us = [], []
    pref = re.compile(r'(우|우B|우C|\d우B?)$')              # 우선주는 WiseReport 재무가 없어 제외
    def add(code):
        s = by.get(code)
        if not s or s.get('t') == 'etf': return
        if s.get('cur') != 'USD' and pref.search(s.get('n', '')): return
        if s.get('cur') == 'USD':
            if code not in us: us.append(code)
        elif code not in kr:
            kr.append(code)
    for code in DEFAULT_WL: add(code)
    for code in hist['items']: add(code)
    for mkt, n in KR_TOP.items():
        pool = [s['c'] for s in sym['items'] if s.get('m') == mkt and s.get('t') == 'stock']
        for code in pool[:n]: add(code)
    for code in US_EXTRA: add(code)
    return kr, us

def main():
    prev = B.load('fundamentals.json') or {'items': {}}
    only = [a for a in sys.argv[1:] if not a.startswith('-')]
    kr, us = targets()
    if only:
        kr = [c for c in only if re.match(r'^\d{6}$', c)]
        us = [c for c in only if not re.match(r'^\d{6}$', c)]
    items = dict(prev.get('items') or {})
    ok = fail = 0
    print('[1/2] 국내 %d종목' % len(kr))
    for i, code in enumerate(kr):
        try:
            it = kr_item(code)
        except Exception as e:
            it = None; print('  ! %s %s' % (code, e), file=sys.stderr)
        if it: items[code] = it; ok += 1
        else: fail += 1
        print('  KR %d/%d %s %s' % (i + 1, len(kr), code, 'ok' if it else 'x'))
    print('[2/2] 미국 %d종목' % len(us))
    for i, code in enumerate(us):
        try:
            it = us_item(code)
        except Exception as e:
            it = None; print('  ! %s %s' % (code, e), file=sys.stderr)
        if it: items[code] = it; ok += 1
        else: fail += 1
        print('  US %d/%d %s %s' % (i + 1, len(us), code, 'ok' if it else 'x'))
    if not ok and not only:
        print('수집 결과가 없어 기존 파일을 유지합니다.', file=sys.stderr)
        sys.exit(1)

    # 미국은 업종 PER 공식 값이 없어 수집 종목의 같은 섹터 중앙값을 쓴다 (브라우저에서 현재가로 재계산)
    stamp = time.strftime('%Y-%m-%dT%H:%M:%S%z')
    p = os.path.join(OUT, 'fundamentals.json')
    with io.open(p, 'w', encoding='utf-8') as f:
        json.dump({'updated': stamp, 'unit': {'KRW': '억원', 'USD': '백만달러'}, 'items': items},
                  f, ensure_ascii=False, separators=(',', ':'))
    print('완료 · 성공 %d · 실패 %d · %s %.1f KB' % (ok, fail, os.path.basename(p), os.path.getsize(p) / 1024))

if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
공공데이터포털 '금융위원회_주식시세정보' 일봉 수집기 (배포본의 국내 차트 · 분석 데이터)
  · 주식 : GetStockSecuritiesInfoService/getStockPriceInfo   (KOSPI · KOSDAQ 전 종목)
  · ETF  : GetSecuritiesProductInfoService/getETFPriceInfo   ('금융위원회_증권상품시세정보' 활용신청 시에만)
  · 영업일 다음 날 오후 1시 이후에 전날 시세가 올라옵니다(T+1). 당일 시세는 토스증권 실시간 연결로 채웁니다.

동작
  1) 최근 약 2년(평일 520일)을 날짜별로 한 번씩 조회해 .cache/krx/<종류>/YYYYMMDD.json 에 보관
     (이미 받은 날짜는 다시 받지 않음 — GitHub Actions 에서는 actions/cache 로 이어 받습니다)
  2) 종목별 일봉을 만들 때 기준가(종가 − 대비)와 전일 종가가 다르면 액면분할 · 증자 등으로 보고
     그 이전 가격을 같은 비율로 조정합니다(수정주가).
  3) 결과
       assets/data/krx/quotes.json   최근 거래일 전 종목 종가 · 대비 · 거래량 · 시가총액 (+ 종목명 · 시장)
       assets/data/krx/d/<코드>.json  종목별 일봉 [[t, o, h, l, c, v], …] — 종목을 열 때 브라우저가 받습니다
     assets/data/krx/ 는 커밋하지 않습니다(.gitignore). 배포 워크플로(pages.yml)가 매번 새로 만듭니다.

서비스키: 환경변수 DATA_GO_KR_KEY 또는 프로젝트 루트 .env 의 DATA_GO_KR_KEY (일반 인증키 Decoding 값)
실행: python3 tools/build_krx.py            키가 없으면 경고만 남기고 종료(0)합니다
"""
import json, os, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'data', 'krx')
CACHE = os.environ.get('KRX_CACHE') or os.path.join(ROOT, '.cache', 'krx')
KST = timezone(timedelta(hours=9))

API = {
    'stock': 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo',
    'etf':   'https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETFPriceInfo',
}
WEEKDAYS = int(os.environ.get('KRX_WEEKDAYS', '520'))   # 약 2년 — 차트 기본 보기 · 200일선 · 백테스트
FIRST_DAY = '20200102'                                   # API 제공 시작
RECENT_DAYS = 10                                         # 이 기간의 빈 날짜는 '아직 미게시'일 수 있어 다시 조회
PAGE = 3000
WORKERS = 4
FATAL = ('20', '22', '30', '31', '32', '33')             # 접근 거부 · 일일 한도 · 미등록/기한만료 키
NEW = []                                                 # 새로 받은 날짜 (캐시 저장 여부 판단)


def load_dotenv():
    path = os.path.join(ROOT, '.env')
    if not os.path.exists(path):
        return
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__('%s %s' % (code, msg))
        self.code = code


def service_key():
    load_dotenv()
    key = os.environ.get('DATA_GO_KR_KEY', '').strip()
    # 포털의 'Encoding' 키를 넣어도 동작하도록 한 번 풀었다가 다시 인코딩한다
    return quote(unquote(key), safe='') if key else ''


def call(kind, key, params, tries=4):
    """curl 로 호출 — 서비스키가 프로세스 목록에 보이지 않도록 주소는 표준입력(-K -)으로 넘긴다."""
    qs = '&'.join('%s=%s' % (k, quote(str(v), safe='')) for k, v in params.items())
    url = '%s?serviceKey=%s&resultType=json&%s' % (API[kind], key, qs)
    last = None
    for i in range(tries):
        try:
            r = subprocess.run(['curl', '-sS', '-m', '90', '-K', '-'], input=('url = "%s"\n' % url).encode(),
                               capture_output=True, timeout=100)
            body = r.stdout.decode('utf-8', 'replace').strip()
            if r.returncode != 0 or not body:
                raise ApiError('NET', r.stderr.decode('utf-8', 'replace').strip()[:120] or 'empty body')
            return parse(body)
        except ApiError as e:
            last = e
            # 키 미등록 · 미신청 서비스 · 일일 한도 초과는 다시 해도 같다
            if e.code in FATAL:
                raise
            time.sleep(2 * (i + 1))
        except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            last = ApiError('NET', str(e)[:120])
            time.sleep(2 * (i + 1))
    raise last


def parse(body):
    if body.startswith('<'):
        # 게이트웨이 오류는 XML 로 온다: <returnReasonCode>30</returnReasonCode> …
        import re
        code = re.search(r'<returnReasonCode>(\d+)</returnReasonCode>', body)
        msg = re.search(r'<returnAuthMsg>([^<]+)</returnAuthMsg>', body) or re.search(r'<errMsg>([^<]+)</errMsg>', body)
        raise ApiError(code.group(1) if code else 'XML', msg.group(1) if msg else body[:120])
    j = json.loads(body)
    if 'OpenAPI_ServiceResponse' in j:
        h = j['OpenAPI_ServiceResponse'].get('cmmMsgHeader', {})
        raise ApiError(str(h.get('returnReasonCode', '?')), h.get('returnAuthMsg') or h.get('errMsg') or '')
    res = j.get('response', {})
    head = res.get('header', {})
    if str(head.get('resultCode', '00')) != '00':
        raise ApiError(str(head.get('resultCode')), head.get('resultMsg', ''))
    body = res.get('body', {}) or {}
    items = body.get('items') or {}
    items = items.get('item', []) if isinstance(items, dict) else []
    if isinstance(items, dict):
        items = [items]
    return int(body.get('totalCount') or 0), items


def num(s):
    if s is None or s == '':
        return None
    try:
        return float(str(s).replace(',', ''))
    except ValueError:
        return None


def fetch_day(kind, key, day):
    """하루치 전 종목. 페이지 크기를 서버가 줄여 주면 그 크기로 다시 나눠 받는다."""
    size, page, rows = PAGE, 1, []
    total, items = call(kind, key, {'basDt': day, 'numOfRows': size, 'pageNo': page})
    rows.extend(items)
    if total > len(items) and 0 < len(items) < size:
        size = len(items)
    while len(rows) < total:
        page = len(rows) // size + 1
        _, items = call(kind, key, {'basDt': day, 'numOfRows': size, 'pageNo': page})
        if not items:
            break
        rows.extend(items)
    out = {}
    for it in rows:
        code = str(it.get('srtnCd') or '').strip().upper()
        if code.startswith('A') and len(code) == 7:
            code = code[1:]
        mkt = 'ETF' if kind == 'etf' else str(it.get('mrktCtg') or '').upper()
        if not code or (kind == 'stock' and mkt not in ('KOSPI', 'KOSDAQ')):
            continue                                     # 코넥스 제외
        c = num(it.get('clpr'))
        if not c or c <= 0:
            continue
        out[code] = [num(it.get('mkp')) or 0, num(it.get('hipr')) or 0, num(it.get('lopr')) or 0, c,
                     num(it.get('trqu')) or 0, num(it.get('vs')) or 0, num(it.get('fltRt')) or 0,
                     num(it.get('trPrc')) or 0, num(it.get('mrktTotAmt')) or 0,
                     str(it.get('itmsNm') or '').strip(), mkt]
    return out


# ---------------- 날짜별 캐시 ----------------
def weekdays(n, until):
    out, d = [], until
    while len(out) < n:
        if d.weekday() < 5:
            s = d.strftime('%Y%m%d')
            if s < FIRST_DAY:
                break
            out.append(s)
        d -= timedelta(days=1)
    return sorted(out)


def cache_path(kind, day):
    return os.path.join(CACHE, kind, day + '.json')


def read_cache(kind, day):
    try:
        with open(cache_path(kind, day), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_cache(kind, day, rows):
    os.makedirs(os.path.join(CACHE, kind), exist_ok=True)
    if rows or not os.path.exists(cache_path(kind, day)):
        NEW.append(day)
    tmp = cache_path(kind, day) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'d': day, 'at': datetime.now(KST).isoformat(timespec='seconds'), 'rows': rows}, f,
                  ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, cache_path(kind, day))


def sync(kind, key, days):
    """없는 날짜와 최근의 빈 날짜만 받는다. 반환: {날짜: rows} (받지 못한 날짜는 None)"""
    recent = (datetime.now(KST) - timedelta(days=RECENT_DAYS)).strftime('%Y%m%d')
    have, todo = {}, []
    for d in days:
        c = read_cache(kind, d)
        if c is not None and (c['rows'] or d < recent):
            have[d] = c['rows']
        else:
            todo.append(d)
    print('  %s: 캐시 %d일 · 조회 %d일' % (kind, len(have), len(todo)))
    if not todo:
        return have

    # 최근 날짜부터 — 중간에 한도에 걸려도 최신 데이터는 확보되도록
    todo.sort(reverse=True)
    done, stop = [0], []

    def job(d):
        if stop:
            return d, None, stop[0]
        try:
            rows = fetch_day(kind, key, d)
        except ApiError as e:
            if e.code in FATAL:
                stop.append(e)                           # 키 · 신청 · 일일 한도 문제는 나머지도 실패한다
            return d, None, e
        write_cache(kind, d, rows)
        done[0] += 1
        if done[0] % 25 == 0:
            print('    %s %d / %d' % (kind, done[0], len(todo)))
        return d, rows, None

    # 첫 날짜로 키 · 활용신청 여부를 먼저 확인
    d, rows, err = job(todo[0])
    if err is not None and err.code in FATAL:
        raise err
    have[d] = rows
    with ThreadPoolExecutor(WORKERS) as ex:
        for d, rows, err in ex.map(job, todo[1:]):
            have[d] = rows
            if err is not None and err.code not in FATAL:
                print('  ! %s %s 실패: %s' % (kind, d, err), file=sys.stderr)
    if stop:
        print('  ! %s 조회 중단: %s — 받은 날짜까지만 사용하고 다음 실행 때 이어 받습니다' % (kind, stop[0]), file=sys.stderr)
    return have


# ---------------- 종목별 일봉 ----------------
def stamp(day):
    """history.json · 토스 일봉과 같은 규칙: 국내 15:30 KST (= 06:30 UTC)"""
    return int(datetime(int(day[:4]), int(day[4:6]), int(day[6:]), 6, 30, tzinfo=timezone.utc).timestamp() * 1000)


def tidy(x):
    x = round(x, 2)
    return int(x) if x == int(x) else x


def build_bars(code, days, table, missing):
    """days: 거래일(오름차순), table: {날짜: rows}. 수정주가 비율은 최신 → 과거로 누적."""
    seq = [(d, table[d][code]) for d in days if table.get(d) and code in table[d]]
    if not seq:
        return []
    out, factor = [], 1.0
    for i in range(len(seq) - 1, -1, -1):
        d, r = seq[i]
        o, h, l, c, v = r[0], r[1], r[2], r[3], r[4]
        if not (o and h and l):                          # 거래정지 · 무거래일은 시가/고가/저가가 0
            o = h = l = c
        f = factor
        out.append([stamp(d), tidy(o * f), tidy(max(h, o, c) * f), tidy(min(l, o, c) * f), tidy(c * f),
                    int(round(v / f)) if f else int(v)])
        if i == 0:
            break
        pd, pr = seq[i - 1]
        # 두 날짜 사이에 받지 못한 날이 있으면 대비(vs)의 기준을 알 수 없어 조정하지 않는다
        if any(pd < m < d for m in missing):
            continue
        base, prev = c - r[5], pr[3]
        if prev > 0 and base > 0:
            ratio = base / prev
            if abs(ratio - 1) > 0.002 and 0.004 < ratio < 250:
                factor *= ratio
    out.reverse()
    return out


def main():
    key = service_key()
    if not key:
        print('::warning::DATA_GO_KR_KEY 가 없어 공공데이터 일봉을 건너뜁니다 (배포본은 번들 데이터로 동작)')
        return 0

    today = datetime.now(KST).date()
    days = weekdays(WEEKDAYS, today - timedelta(days=1))  # 당일 시세는 다음 날 게시
    print('공공데이터 주식시세 %s ~ %s (평일 %d일)' % (days[0], days[-1], len(days)))

    try:
        stock = sync('stock', key, days)
    except ApiError as e:
        print('::error::주식시세정보 호출 실패 — %s. 활용신청 · 서비스키(Decoding)를 확인하세요.' % e)
        return 1
    try:
        etf = sync('etf', key, days)
    except ApiError as e:
        etf = {}
        print('  (ETF 건너뜀: %s — ETF 도 공공데이터로 보려면 금융위원회_증권상품시세정보 활용신청)' % e)

    table = {}
    for d in days:
        s, e = stock.get(d), etf.get(d)
        if s is None and e is None:
            continue
        table[d] = dict(s or {}, **(e or {}))
    missing = [d for d in days if stock.get(d) is None]
    trading = [d for d in days if table.get(d)]
    if not trading:
        print('::error::받은 시세가 없습니다')
        return 1
    last = trading[-1]
    latest = table[last]
    # ETF 는 주식보다 늦게 게시되는 날이 있어, 최신일에 없으면 ETF 의 최신일을 따로 쓴다
    etf_days = [d for d in trading if any(r[10] == 'ETF' for r in table[d].values())]

    tmp = OUT + '.tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(os.path.join(tmp, 'd'))
    items, n = {}, 0
    codes = set(latest)
    if etf_days and etf_days[-1] != last:
        codes |= {c for c, r in table[etf_days[-1]].items() if r[10] == 'ETF'}
    for code in sorted(codes):
        bars = build_bars(code, trading, table, missing)
        if len(bars) < 2:
            continue
        ref = next(table[d][code] for d in reversed(trading) if code in table[d])
        with open(os.path.join(tmp, 'd', code + '.json'), 'w') as f:
            json.dump(bars, f, separators=(',', ':'))
        n += 1
        items[code] = {
            'n': ref[9], 'm': ref[10], 't': 'etf' if ref[10] == 'ETF' else 'stock',
            'p': tidy(ref[3]), 'd': tidy(ref[5]), 'r': round(ref[6], 2), 'v': int(ref[4]),
            'a': int(ref[7]), 'mc': int(ref[8]),
            'o': bars[-1][1], 'h': bars[-1][2], 'l': bars[-1][3],
            'dt': datetime.fromtimestamp(bars[-1][0] / 1000, KST).strftime('%Y-%m-%d'),
            'k': len(bars)
        }

    meta = {
        'updated': datetime.now(KST).isoformat(timespec='seconds'),
        'basDt': '%s-%s-%s' % (last[:4], last[4:6], last[6:]),
        'first': '%s-%s-%s' % (trading[0][:4], trading[0][4:6], trading[0][6:]),
        'source': '공공데이터포털 금융위원회_주식시세정보' + (' · 증권상품시세정보' if etf_days else ''),
        'etf': bool(etf_days),
        'count': n,
        'items': items
    }
    with open(os.path.join(tmp, 'quotes.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
    shutil.rmtree(OUT, ignore_errors=True)
    os.replace(tmp, OUT)

    # 창 밖으로 밀려난 날짜 캐시 정리
    keep = set(days)
    for kind in ('stock', 'etf'):
        folder = os.path.join(CACHE, kind)
        for name in os.listdir(folder) if os.path.isdir(folder) else []:
            if name.endswith('.json') and name[:8] not in keep:
                os.remove(os.path.join(folder, name))

    print('완료: 기준일 %s · %d종목 (ETF %s) · 거래일 %d일%s' % (
        meta['basDt'], n, '포함' if etf_days else '없음', len(trading),
        (' · 미수신 %d일' % len(missing)) if missing else ''))
    return 0


if __name__ == '__main__':
    try:
        code = main()
    finally:
        # 실패로 끝나도 그때까지 받은 날짜는 캐시에 남기도록 (GitHub Actions)
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
                f.write('changed=%s\n' % ('true' if NEW else 'false'))
    sys.exit(code)

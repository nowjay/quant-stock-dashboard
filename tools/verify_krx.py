#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_krx.py — 공공데이터 수집기(build_krx.py) 검증. 네트워크 없이, 임시 폴더에서 돌린다

  python3 tools/verify_krx.py        실패하면 종료 코드 1

  ① 정상 수집                     종목별 일봉 · quotes.json · 기준일(아직 게시되지 않은 어제는 건너뜀)
  ② API 를 부르지 못할 때          받아 둔 날짜로 같은 결과를 만들고 경고를 남긴 뒤 0 으로 끝나는가 (2026-10-14: 시간 초과 한 번에 일봉 없이 배포됨)
  ③ 받아 둔 날짜도 없을 때         1 로 끝나고 출력 폴더를 건드리지 않는가 (배포 워크플로가 여기서 멈춰 직전 배포를 유지)
  ④ 키 문제 · 오래 묵은 시세        받아 둔 날짜로 만들되, 기준일이 일주일 넘게 묵었으면 오류로 알리는가
  ⑤ 서비스키가 없을 때             건너뛰고 0 으로 끝나는가 (번들 데이터만으로 배포)
API 응답은 가짜다 — build_krx.call 을 바꿔치기하고, 날짜는 실행하는 날 기준으로 만든다.
"""
import contextlib, io, json, os, shutil, sys, tempfile
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_krx as K

PASSED, FAILED = [], []


def check(name, fn):
    try:
        fn()
        PASSED.append(name)
    except Exception as e:                               # noqa: BLE001 — 실패한 항목을 모아서 보여 준다
        FAILED.append(name)
        print('✗ %s\n  %s: %s' % (name, type(e).__name__, str(e).split('\n')[0]))


class Clock(datetime):
    """build_krx 안의 '지금'을 며칠 뒤로 옮긴다"""
    shift = timedelta(0)

    @classmethod
    def now(cls, tz=None):
        return datetime.now(tz) + cls.shift


def fake_api(fail=None, posted_until=1):
    """posted_until: 며칠 전 시세까지 게시됐는가 (1 = 어제 것은 아직 없음). fail = (코드, 메시지) 면 모든 호출이 실패"""
    last = (datetime.now(K.KST) - timedelta(days=posted_until + 1)).strftime('%Y%m%d')

    def call(kind, key, params, tries=4):
        if fail:
            raise K.ApiError(*fail)
        if kind == 'etf':
            raise K.ApiError('30', 'SERVICE KEY IS NOT REGISTERED ERROR.')      # 증권상품시세정보는 신청하지 않은 상태
        day = params['basDt']
        if day > last:
            return 0, []
        n = int(day[6:])                                                        # 날짜마다 값이 달라지도록
        rows = [
            {'srtnCd': 'A005930', 'itmsNm': '삼성전자', 'mrktCtg': 'KOSPI', 'mkp': 70000 + n, 'hipr': 71000 + n, 'lopr': 69000 + n,
             'clpr': 70500 + n, 'vs': 100, 'fltRt': 0.14, 'trqu': 1000 * n, 'trPrc': 7e10, 'mrktTotAmt': 4e14},
            {'srtnCd': '403870', 'itmsNm': 'HPSP', 'mrktCtg': 'KOSDAQ', 'mkp': 60000, 'hipr': 61000, 'lopr': 59000,
             'clpr': 60000 + n, 'vs': -50, 'fltRt': -0.08, 'trqu': 500 * n, 'trPrc': 3e10, 'mrktTotAmt': 4.6e12},
            {'srtnCd': '999999', 'itmsNm': '코넥스종목', 'mrktCtg': 'KONEX', 'clpr': 1000},
        ]
        return len(rows), rows[:params['numOfRows']]
    return call


def run(call, key='test-key'):
    """main() 을 돌리고 (종료 코드, 출력) 을 돌려준다"""
    K.call, K.service_key = call, (lambda: key)
    K.ENDPOINT.clear()
    del K.NEW[:]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        code = K.main()
    return code, buf.getvalue()


def quotes():
    with open(os.path.join(K.OUT, 'quotes.json'), encoding='utf-8') as f:
        return json.load(f)


def bars(code):
    with open(os.path.join(K.OUT, 'd', code + '.json'), encoding='utf-8') as f:
        return json.load(f)


def main():
    tmp = tempfile.mkdtemp(prefix='verify_krx_')
    K.OUT, K.CACHE = os.path.join(tmp, 'out'), os.path.join(tmp, 'cache')
    K.WEEKDAYS = 12
    K.datetime = Clock
    K.time.sleep = lambda s: None
    state = {}

    def normal():
        code, log = run(fake_api())
        assert code == 0, log
        q = quotes()
        # 어제 시세는 아직 게시되지 않았다 → 기준일은 그 전 거래일
        days = K.weekdays(K.WEEKDAYS, (datetime.now(K.KST) - timedelta(days=1)).date())
        posted = [d for d in days if d <= (datetime.now(K.KST) - timedelta(days=2)).strftime('%Y%m%d')]
        assert q['basDt'].replace('-', '') == posted[-1], (q['basDt'], posted[-1])
        assert q['count'] == 2 and set(q['items']) == {'005930', '403870'}, q['items'].keys()      # 코넥스 제외 · A 접두어 제거
        assert len(bars('005930')) == len(posted) and q['items']['403870']['m'] == 'KOSDAQ'
        assert K.NEW and '::warning::' not in log and '::error::' not in log, log
        state.update(basDt=q['basDt'], samsung=bars('005930'), hpsp=bars('403870'))

    def api_down():
        shutil.rmtree(K.OUT)                             # 배포 워크플로는 매번 빈 폴더에서 시작한다
        code, log = run(fake_api(fail=('NET', 'curl: (28) Connection timed out after 90001 milliseconds')))
        assert code == 0, log
        assert quotes()['basDt'] == state['basDt'] and bars('005930') == state['samsung'] and bars('403870') == state['hpsp']
        assert '::warning::주식시세정보 호출 실패' in log and '::error::' not in log, log
        assert not K.NEW                                 # 새로 받은 날짜가 없으니 캐시를 다시 저장하지 않는다

    def nothing_cached():
        cache, K.CACHE = K.CACHE, os.path.join(tmp, 'empty')
        shutil.rmtree(K.OUT)
        try:
            code, log = run(fake_api(fail=('NET', 'timeout')))
        finally:
            K.CACHE = cache
        assert code == 1 and '::error::' in log and '받아 둔 시세도 없어' in log, log
        assert not os.path.exists(K.OUT)

    def key_problem():
        os.makedirs(K.OUT, exist_ok=True)
        code, log = run(fake_api(fail=('30', 'SERVICE KEY IS NOT REGISTERED ERROR.')))
        assert code == 0 and quotes()['basDt'] == state['basDt'] and '::warning::' in log, log
        # 열흘 뒤에도 계속 실패하면 — 남아 있는 날짜로 만들되 오류로 올린다
        Clock.shift = timedelta(days=10)
        try:
            code, log = run(fake_api(fail=('30', 'SERVICE KEY IS NOT REGISTERED ERROR.')))
        finally:
            Clock.shift = timedelta(0)
        assert code == 0 and quotes()['basDt'] == state['basDt'], log
        assert '::error::주식시세정보 호출 실패' in log and '서비스키(Decoding)를 확인하세요' in log, log

    def no_key():
        shutil.rmtree(K.OUT, ignore_errors=True)
        code, log = run(fake_api(), key='')
        assert code == 0 and 'DATA_GO_KR_KEY' in log and not os.path.exists(K.OUT), log

    try:
        check('정상 수집 — 일봉 · 기준일 · 코넥스 제외', normal)
        check('API 를 부르지 못할 때 받아 둔 날짜로 만든다 (경고 · 0)', api_down)
        check('받아 둔 날짜도 없으면 실패한다 (1 · 출력 없음)', nothing_cached)
        check('키 문제도 받아 둔 날짜로 만들고, 오래 묵으면 오류로 알린다', key_problem)
        check('서비스키가 없으면 건너뛴다 (0)', no_key)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('공공데이터 수집기 검증 실패' if FAILED else '✓ 공공데이터 수집기 검증: %d개 통과' % len(PASSED))
    return 1 if FAILED else 0


if __name__ == '__main__':
    sys.exit(main())

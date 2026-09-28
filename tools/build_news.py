# -*- coding: utf-8 -*-
"""
증시 뉴스 스냅샷 수집기
  · 출처 : 연합뉴스 · 한국경제 · 매일경제 RSS (assets/core/news.js 의 FEEDS 와 동일)
  · 분류 : 금리/물가(rate) · 실적(earn) · 증시동향(market) · 경제(etc) — 앱과 같은 키워드 규칙
브라우저에서 실시간 피드(rss2json/프록시)에 연결하지 못할 때 이 스냅샷을 대신 보여 줍니다.
주기적으로 실행(cron 등)하면 GitHub Pages 같은 정적 호스팅에서도 최신 뉴스를 유지할 수 있습니다.
실행: python3 tools/build_news.py
결과: assets/data/news.json
"""
import io, json, os, re, subprocess, sys, time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'data', 'news.json')
MAX_ITEMS = 80

FEEDS = [
    ('연합뉴스', 'https://www.yna.co.kr/rss/economy.xml'),
    ('연합뉴스', 'https://www.yna.co.kr/rss/market.xml'),
    ('한국경제', 'https://www.hankyung.com/feed/finance'),
    ('한국경제', 'https://www.hankyung.com/feed/economy'),
    ('매일경제', 'https://www.mk.co.kr/rss/50200011/'),
]

KEYWORDS = [
    ('earn', r'실적|영업이익|영업손실|순이익|매출액|어닝|잠정\s?실적|컨센서스|가이던스|흑자\s?전환|적자\s?전환|서프라이즈|쇼크|EPS|분기\s?최대'),
    ('rate', r'금리|기준금리|연준|Fed|FOMC|파월|한은|한국은행|금통위|물가|CPI|PPI|PCE|인플레|디플레|국채|국고채|채권|긴축|완화|피벗|환율|달러|원화|엔화|유가'),
    ('market', r'코스피|코스닥|증시|나스닥|다우|S&P|뉴욕증시|주가|지수|외국인|기관|순매수|순매도|개인\s?투자자|마감|급등|급락|상승세|하락세|ETF|공매도|시가총액|시총|반도체주|랠리|매도세|매수세|상장|IPO|거래대금'),
]


def classify(title, desc):
    best, score = 'etc', 0
    for cat, pat in KEYWORDS:
        s = len(re.findall(pat, title or '')) * 2 + len(re.findall(pat, desc or ''))
        if s > score:
            best, score = cat, s
    return best


def get(url, timeout=15):
    try:
        r = subprocess.run(['curl', '-sL', '-m', str(timeout), '-A', UA, url], capture_output=True, timeout=timeout + 5)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
    except Exception as e:
        print('  ! fail', url, e, file=sys.stderr)
    return None


def text(s):
    s = unescape(re.sub(r'<[^>]+>', ' ', s or ''))
    return re.sub(r'\s+', ' ', s).strip()


def to_ms(s):
    if not s:
        return None
    try:
        return int(parsedate_to_datetime(s.strip()).timestamp() * 1000)
    except Exception:
        pass
    try:                                                     # ISO 8601 (Atom) — 시간대 없으면 UTC
        dt = datetime.fromisoformat(s.strip().replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def parse(raw, src):
    items = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return items
    for node in root.iter():
        tag = node.tag.split('}')[-1]
        if tag not in ('item', 'entry'):
            continue
        def child(*names):
            for c in node:
                if c.tag.split('}')[-1] in names:
                    return c
            return None
        t, d, l, p = child('title'), child('description', 'summary'), child('link'), child('pubDate', 'published', 'updated')
        title = text(t.text if t is not None else '')
        if not title:
            continue
        link = (l.get('href') or l.text or '').strip() if l is not None else ''
        desc = text(d.text if d is not None else '')[:180]
        items.append({
            't': to_ms(p.text if p is not None else ''),
            'title': title,
            'desc': '' if desc == title else desc,
            'link': link if re.match(r'^https?://', link) else '',
            'src': src,
            'cat': classify(title, desc),
        })
    return items


def main():
    allitems, ok = [], 0
    for src, url in FEEDS:
        raw = get(url)
        got = parse(raw, src) if raw else []
        print('  %-5s %3d건  %s' % (src, len(got), url))
        ok += 1 if got else 0
        allitems += got
    if not allitems:
        print('수집된 뉴스가 없습니다 — 기존 news.json 을 유지합니다.')
        return 1
    seen, out = set(), []
    for it in sorted(allitems, key=lambda x: x['t'] or 0, reverse=True):
        k = re.sub(r'[\s\[\]()\'"“”‘’·…,.]', '', it['title'])[:40]
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    out = out[:MAX_ITEMS]
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'updated': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'feeds': ok, 'items': out},
                  f, ensure_ascii=False, separators=(',', ':'))
    cats = {}
    for it in out:
        cats[it['cat']] = cats.get(it['cat'], 0) + 1
    print('완료 · news.json %d건 %s' % (len(out), cats))
    return 0


if __name__ == '__main__':
    sys.exit(main())

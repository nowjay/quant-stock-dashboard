#!/usr/bin/env python3
"""
toss_proxy.py — 토스증권 Open API 로컬 프록시

브라우저는 토스증권 API 를 직접 부를 수 없습니다.
  · REST 응답에 CORS 헤더가 없어 브라우저 fetch 가 차단되고
  · 웹소켓 handshake 에 Authorization 헤더가 필요한데 브라우저 WebSocket 은 헤더를 붙일 수 없으며
  · client_secret 을 브라우저에 두면 페이지를 여는 누구에게나 노출됩니다.
이 프록시가 client_id / client_secret 으로 토큰을 발급·보관하고, 시세 조회(GET)와 실시간 체결·호가만 중계합니다.

  브라우저 ── http://127.0.0.1:8778/api/v1/... ──▶ proxy ──▶ https://openapi.tossinvest.com
  브라우저 ── ws://127.0.0.1:8778/ws ────────────▶ proxy ──▶ wss://openapi-ws.tossinvest.com/ws/v1

실행
  python3 -m venv .venv && .venv/bin/pip install aiohttp certifi
  .venv/bin/python tools/toss_proxy.py

설정 (프로젝트 루트의 .env — gitignore 처리됨, .env.example 참고)
  TOSS_CLIENT_ID=...
  TOSS_CLIENT_SECRET=...
  TOSS_PROXY_PORT=8778                   (선택)
  TOSS_ALLOWED_ORIGINS=https://a.b.c     (선택, 콤마 구분 — 기본은 localhost 페이지만 허용)

안전장치
  · 127.0.0.1 에만 바인딩 — 이 PC 에서만 접근 가능
  · 허용 Origin(기본 localhost)만 CORS·웹소켓 허용 — 다른 사이트가 몰래 붙지 못하게
  · 주문·계좌 API 는 중계하지 않음 (시세·종목·시장 정보 GET 만)
  · 업스트림 웹소켓은 1개만 열고 여러 탭에 나눠 전달 (계정당 동시 연결 2개 제한)
"""
import asyncio
import errno
import json
import os
import random
import re
import ssl
import sys
import time
from pathlib import Path

try:
    import aiohttp
    import certifi
    from aiohttp import web
    from yarl import URL
except ImportError:
    sys.exit('aiohttp · certifi 가 필요합니다:\n'
             '  python3 -m venv .venv && .venv/bin/pip install aiohttp certifi\n'
             '  .venv/bin/python tools/toss_proxy.py')

ROOT = Path(__file__).resolve().parent.parent
# python.org 판 macOS 파이썬은 시스템 인증서를 쓰지 않아 HTTPS 검증이 실패하므로 certifi 번들을 쓴다
SSL_CTX = ssl.create_default_context(cafile=certifi.where())


def load_dotenv(path):
    """KEY=VALUE 형식의 .env 를 os.environ 에 채운다 (이미 설정된 환경변수가 우선)."""
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, val = line.split('=', 1)
        key = key.strip().removeprefix('export ').strip()
        os.environ.setdefault(key, val.strip().strip('"').strip("'"))


load_dotenv(ROOT / '.env')

CLIENT_ID = os.environ.get('TOSS_CLIENT_ID', '').strip()
CLIENT_SECRET = os.environ.get('TOSS_CLIENT_SECRET', '').strip()
REST_BASE = os.environ.get('TOSS_REST_BASE', 'https://openapi.tossinvest.com').rstrip('/')
WS_URL = os.environ.get('TOSS_WS_URL', 'wss://openapi-ws.tossinvest.com/ws/v1')
HOST = '127.0.0.1'
PORT = int(os.environ.get('TOSS_PROXY_PORT', '8778'))
EXTRA_ORIGINS = {o.strip().rstrip('/') for o in os.environ.get('TOSS_ALLOWED_ORIGINS', '').split(',') if o.strip()}
LOCAL_ORIGIN = re.compile(r'^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$')

# 중계하는 REST 경로 — 시세·종목·시장 정보 GET 만 (계좌·자산·주문·조건주문은 제외)
SYM = r'[A-Za-z0-9.\-]+'
ALLOWED_PATH = re.compile(
    r'^/api/v1/(?:'
    r'prices|orderbook|trades|price-limits|candles|exchange-rate|rankings|stocks|stocks/all'
    rf'|stocks/{SYM}/(?:warnings|investor-trading|program-trades|short-selling|credit-trades|securities-lending)'
    r'|market-calendar/(?:KR|US)'
    rf'|market-indicators/(?:prices|{SYM}/(?:candles|investor-trading))'
    r')$')

# 브라우저가 구독할 수 있는 웹소켓 채널 (personal:order 는 계좌 정보라 제외)
WS_TYPES = {'trade:kr', 'trade:us', 'orderbook:kr', 'orderbook:us'}
MAX_TOPICS = 100            # 연결당 구독 한도 (codes 합산)
PING_SEC = 60               # 서버는 클라이언트 무수신 180초면 끊는다 — 60초 간격 권장
IDLE_CLOSE_SEC = 30         # 브라우저 탭이 모두 닫히면 이 시간 뒤 업스트림도 닫는다
RETRY_TOKEN_CODES = {'expired-token', 'token-revoked', 'invalid-token'}
PASS_HEADERS = ('X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After', 'X-Request-Id')


def log(*args):
    print(time.strftime('%H:%M:%S'), *args, flush=True)


def error_json(status, code, message):
    return web.json_response({'error': {'code': code, 'message': message}}, status=status,
                             dumps=lambda o: json.dumps(o, ensure_ascii=False))


def error_code(body):
    try:
        err = json.loads(body).get('error')
        return err.get('code') if isinstance(err, dict) else err
    except (ValueError, AttributeError):
        return None


def describe(e):
    return str(e) or type(e).__name__


def origin_allowed(origin):
    return bool(LOCAL_ORIGIN.match(origin)) or origin.rstrip('/') in EXTRA_ORIGINS


# =============================================================
#  토큰
# =============================================================
class TokenError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def describe_token_error(status, body):
    """토큰 발급 오류를 원인별 안내 문구로 바꾼다 (FAQ 의 인증·접속 항목 참고)."""
    body = body if isinstance(body, dict) else {}
    err = body.get('error')
    if isinstance(err, dict):                     # 공통 에러 envelope (403 edge-blocked 등)
        code, desc = err.get('code', ''), err.get('message', '')
    else:                                         # OAuth2 표준 {error, error_description}
        code, desc = err or '', body.get('error_description', '')
    if code == 'invalid_client':
        hint = 'client_id / client_secret 이 틀렸습니다. WTS 설정 > Open API 의 복사 버튼으로 다시 붙여넣으세요.'
    elif status == 403:
        hint = '허용 IP 가 아닙니다. WTS 설정 > Open API > 허용 IP 관리에 현재 공인 IP 를 등록하세요.'
    elif code == 'invalid_request':
        hint = '요청 형식 오류입니다. .env 값에 공백·따옴표·줄바꿈이 섞이지 않았는지 확인하세요.'
    else:
        hint = '토큰을 발급하지 못했습니다.'
    return (code or f'http-{status}'), (f'{hint} ({desc})' if desc else hint)


class TokenManager:
    """client 당 유효한 토큰은 1개 — 재발급하면 이전 토큰이 즉시 무효화되므로 하나를 공유한다."""

    def __init__(self, session):
        self.session = session
        self.token = None
        self.expires_at = 0.0
        self.last_error = None
        self._failed_at = 0.0
        self._lock = asyncio.Lock()

    async def get(self, stale=None):
        """유효한 토큰을 돌려준다. stale 은 방금 거부된 토큰 — 아직 그 토큰이면 새로 발급한다."""
        async with self._lock:
            if self.token and self.token != stale and time.time() < self.expires_at - 300:
                return self.token
            if self.last_error and time.time() - self._failed_at < 5:
                raise self.last_error              # 실패 직후 연속 재시도 방지 (AUTH 초당 5회)
            return await self._issue()

    async def _issue(self):
        if not CLIENT_ID or not CLIENT_SECRET:
            raise self._fail(TokenError(500, 'missing-credentials',
                                        '.env 에 TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 을 설정하세요 (.env.example 참고).'))
        form = {'grant_type': 'client_credentials', 'client_id': CLIENT_ID, 'client_secret': CLIENT_SECRET}
        try:
            async with self.session.post(REST_BASE + '/oauth2/token', data=form,
                                         timeout=aiohttp.ClientTimeout(total=15)) as r:
                status = r.status
                body = await r.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
            raise self._fail(TokenError(502, 'token-request-failed', f'토큰 발급 요청 실패: {describe(e)}'))
        if status != 200 or not isinstance(body, dict) or not body.get('access_token'):
            raise self._fail(TokenError(status, *describe_token_error(status, body)))
        ttl = int(body.get('expires_in') or 3600)
        self.token, self.expires_at, self.last_error = body['access_token'], time.time() + ttl, None
        log(f'토큰 발급 완료 — 만료까지 {ttl // 3600}시간 {ttl % 3600 // 60}분')
        return self.token

    def _fail(self, err):
        self.last_error, self._failed_at = err, time.time()
        log(f'토큰 발급 실패 [{err.status} {err.code}] {err}')
        return err


# =============================================================
#  웹소켓 중계 — 업스트림 1개를 여러 브라우저 탭이 공유
# =============================================================
def parse_declaration(text):
    """브라우저가 보낸 구독 선언(토스 형식 JSON 배열)을 토픽 집합으로 바꾼다."""
    try:
        items = json.loads(text)
    except ValueError:
        return None, {'code': 'wrong-format', 'message': 'JSON 배열 1개를 보내세요.'}
    if not isinstance(items, list) or not all(isinstance(x, dict) for x in items):
        return None, {'code': 'wrong-format', 'message': 'JSON 배열 1개를 보내세요.'}
    topics = set()
    for item in items:
        if 'type' not in item:
            continue                                   # {"id": "..."} 요청 식별자
        typ, codes = item['type'], item.get('codes')
        if typ not in WS_TYPES:
            return None, {'code': 'invalid-type', 'message': f'프록시가 중계하지 않는 type: {typ}'}
        if not isinstance(codes, list) or not codes or not all(isinstance(c, str) and c for c in codes):
            return None, {'code': 'no-codes', 'message': f'{typ} 의 codes 가 비었습니다.'}
        topics.update(f'{typ}:{c}' for c in codes)
    return topics, None


class Hub:
    def __init__(self, proxy):
        self.proxy = proxy
        self.clients = {}                 # 브라우저 WebSocketResponse -> {'trade:kr:005930', ...}
        self.upstream = None
        self.state, self.message = 'idle', ''
        self._task = None
        self._declared = None             # 마지막으로 업스트림에 선언한 토픽 목록
        self._declare_handle = None
        self._idle_handle = None

    # ---------- 브라우저 쪽 ----------
    async def handle(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.clients[ws] = set()
        self._ensure_upstream()
        await self._send(ws, self._status_frame())
        try:
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                text = msg.data.strip()
                if text == 'PING':
                    await ws.send_str('{"type":"pong"}')
                    continue
                topics, err = parse_declaration(text)
                if err:
                    await self._send(ws, {'type': 'error', 'error': err})
                    continue
                self.clients[ws] = topics
                self._schedule_declare()
        finally:
            self.clients.pop(ws, None)
            if self.clients:
                self._schedule_declare()
            else:
                self._schedule_idle_close()
        return ws

    async def _send(self, ws, obj):
        await self._send_raw(ws, json.dumps(obj, ensure_ascii=False))

    async def _send_raw(self, ws, text):
        try:
            await ws.send_str(text)
        except (ConnectionError, RuntimeError):
            pass                                        # 닫히는 중인 탭

    def _status_frame(self):
        return {'type': 'proxy-status', 'upstream': self.state, 'message': self.message}

    def _set_state(self, state, message):
        if (state, message) == (self.state, self.message):
            return
        self.state, self.message = state, message
        if message:
            log(f'[웹소켓] {message}')
        frame = json.dumps(self._status_frame(), ensure_ascii=False)
        for ws in list(self.clients):
            asyncio.ensure_future(self._send_raw(ws, frame))

    # ---------- 구독 선언 (full-replace, 초당 5회 제한) ----------
    def _schedule_declare(self, delay=0.25):
        if self._declare_handle:
            return                                      # 이미 예약됨 — 잦은 변경을 한 번으로 묶는다
        loop = asyncio.get_running_loop()
        self._declare_handle = loop.call_later(delay, lambda: asyncio.ensure_future(self._declare()))

    async def _declare(self):
        if self._declare_handle:
            self._declare_handle.cancel()
            self._declare_handle = None
        up = self.upstream
        if not up or up.closed:
            return
        topics = sorted(set().union(*self.clients.values()))
        if len(topics) > MAX_TOPICS:
            log(f'[웹소켓] 구독 {len(topics)}건 중 {MAX_TOPICS}건만 선언합니다 (연결당 한도)')
            topics = topics[:MAX_TOPICS]
        if topics == self._declared:
            return
        groups = {}
        for t in topics:
            typ, code = t.rsplit(':', 1)
            groups.setdefault(typ, []).append(code)
        await up.send_str(json.dumps([{'type': typ, 'codes': codes} for typ, codes in groups.items()]))
        self._declared = topics
        log(f'[웹소켓] 구독 선언 {len(topics)}건')

    # ---------- 업스트림 ----------
    def _ensure_upstream(self):
        if self._idle_handle:
            self._idle_handle.cancel()
            self._idle_handle = None
        if not self._task or self._task.done():
            self._task = asyncio.create_task(self._run())

    def _schedule_idle_close(self):
        async def close():
            self._idle_handle = None
            if not self.clients and self.upstream and not self.upstream.closed:
                log('[웹소켓] 연결된 탭이 없어 업스트림을 닫습니다')
                await self.upstream.close()
        loop = asyncio.get_running_loop()
        self._idle_handle = loop.call_later(IDLE_CLOSE_SEC, lambda: asyncio.ensure_future(close()))

    async def _run(self):
        delay = 1
        while self.clients:
            self._set_state('connecting', '토스증권 웹소켓 연결 중')
            token = None
            try:
                token = await self.proxy.tokens.get()
                up = await asyncio.wait_for(
                    self.proxy.session.ws_connect(WS_URL, headers={'Authorization': f'Bearer {token}'}), 15)
                async with up:
                    self.upstream, self._declared = up, None
                    self._set_state('open', '토스증권 웹소켓 연결됨')
                    delay = 1
                    await self._declare()
                    pinger = asyncio.create_task(self._keepalive(up))
                    try:
                        async for msg in up:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                await self._on_upstream(msg.data)
                    finally:
                        pinger.cancel()
                        self.upstream = None
                if not self.clients:
                    break
                self._set_state('connecting', '업스트림 연결이 끊겨 재연결합니다')
            except aiohttp.WSServerHandshakeError as e:
                if e.status == 401 and token:
                    try:
                        await self.proxy.tokens.get(stale=token)
                    except TokenError:
                        pass
                self._set_state('error', {
                    401: '토큰이 거부되어 재발급 후 다시 연결합니다',
                    403: '허용 IP 가 아닙니다 — WTS 설정 > Open API > 허용 IP 관리에 현재 공인 IP 를 등록하세요',
                    503: '토스증권 웹소켓 서버 오류 — 잠시 후 재시도합니다',
                }.get(e.status, f'웹소켓 handshake 실패 (HTTP {e.status})'))
            except TokenError as e:
                self._set_state('error', str(e))
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
                self._set_state('error', f'웹소켓 연결 실패: {describe(e)}')
            if not self.clients:
                break
            await asyncio.sleep(delay * (1 + random.random() * 0.3))    # 지수 백오프 + jitter
            delay = min(delay * 2, 30)
        self._set_state('idle', '')

    async def _keepalive(self, up):
        while not up.closed:
            await asyncio.sleep(PING_SEC)
            await up.send_str('PING')

    async def _on_upstream(self, text):
        try:
            frame = json.loads(text)
        except ValueError:
            return
        kind = frame.get('type')
        if kind == 'message':
            topic = frame.get('topic')
            for ws, topics in list(self.clients.items()):
                if topic in topics:
                    await self._send_raw(ws, text)
        elif kind == 'subscriptions':
            subscribed = set(frame.get('subscribed') or [])
            rejected = frame.get('rejected') or []
            for r in rejected:
                log(f'[웹소켓] 구독 거부 {r.get("target")} — {r.get("code")}: {r.get("message")}')
            for ws, topics in list(self.clients.items()):
                await self._send(ws, {'type': 'subscriptions', 'subscribed': sorted(subscribed & topics),
                                      'rejected': [r for r in rejected if r.get('target') in topics]})
        elif kind == 'error':
            err = frame.get('error') or {}
            log(f'[웹소켓] 오류 {err.get("code")}: {err.get("message")}')
            if err.get('code') == 'rate-limit-exceeded':
                self._declared = None
                self._schedule_declare(1.0)            # 기존 구독은 유지됨 — 1초 뒤 재선언
            for ws in list(self.clients):
                await self._send_raw(ws, text)

    async def close(self):
        if self._task:
            self._task.cancel()
        if self.upstream and not self.upstream.closed:
            await self.upstream.close()
        for ws in list(self.clients):
            await ws.close(code=aiohttp.WSCloseCode.GOING_AWAY, message=b'proxy shutdown')


# =============================================================
#  HTTP
# =============================================================
class TossProxy:
    def __init__(self):
        self.session = None
        self.tokens = None
        self.hub = Hub(self)

    async def call_upstream(self, path_qs):
        """GET 을 토스증권으로 보낸다. 토큰 만료·무효화(401)면 한 번 재발급 후 재시도한다."""
        token = await self.tokens.get()
        for attempt in (1, 2):
            async with self.session.get(URL(REST_BASE + path_qs, encoded=True),
                                        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'},
                                        timeout=aiohttp.ClientTimeout(total=15)) as r:
                body = await r.read()
                if r.status == 401 and attempt == 1 and error_code(body) in RETRY_TOKEN_CODES:
                    token = await self.tokens.get(stale=token)
                    continue
                return r.status, body, r.headers

    async def rest(self, request):
        if request.method != 'GET' or '..' in request.path or not ALLOWED_PATH.match(request.path):
            return error_json(404, 'proxy-blocked', '이 프록시는 시세·종목·시장 정보 조회(GET)만 중계합니다.')
        try:
            status, body, headers = await self.call_upstream(request.raw_path)   # 쿼리 인코딩 그대로 전달
        except TokenError as e:
            return error_json(e.status if e.status >= 400 else 502, e.code, str(e))
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            return error_json(502, 'upstream-unreachable', f'토스증권 서버에 연결하지 못했습니다: {describe(e)}')
        if status == 403 and error_code(body) == 'edge-blocked':
            return error_json(403, 'edge-blocked',
                              '허용 IP 가 아닙니다 — WTS 설정 > Open API > 허용 IP 관리에 현재 공인 IP 를 등록하세요.')
        return web.Response(status=status, body=body, content_type='application/json',
                            headers={k: headers[k] for k in PASS_HEADERS if k in headers})

    async def health(self, request):
        """토큰 발급 + 삼성전자 현재가 1회 조회로 자격증명·허용 IP 를 함께 점검한다."""
        info = {'ok': False, 'upstreamWs': self.hub.state, 'tabs': len(self.hub.clients)}
        try:
            status, body, _ = await self.call_upstream('/api/v1/prices?symbols=005930')
            if status == 200:
                info['ok'] = True
            elif status == 403:
                info['error'] = {'code': 'edge-blocked', 'message': '허용 IP 가 아닙니다 — WTS 설정 > Open API > 허용 IP 관리에 현재 공인 IP 를 등록하세요.'}
            else:
                err = json.loads(body).get('error') if body else None
                info['error'] = err if isinstance(err, dict) else {'code': f'http-{status}', 'message': body.decode(errors='replace')[:200]}
        except TokenError as e:
            info['error'] = {'code': e.code, 'message': str(e)}
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
            info['error'] = {'code': 'upstream-unreachable', 'message': f'토스증권 서버에 연결하지 못했습니다: {describe(e)}'}
        return web.json_response(info, dumps=lambda o: json.dumps(o, ensure_ascii=False))

    @web.middleware
    async def cors(self, request, handler):
        origin = request.headers.get('Origin')
        if origin and not origin_allowed(origin):
            return error_json(403, 'origin-not-allowed',
                              f'허용되지 않은 Origin: {origin} — 필요하면 .env 의 TOSS_ALLOWED_ORIGINS 에 추가하세요.')
        resp = web.Response(status=204) if request.method == 'OPTIONS' else await handler(request)
        if origin and not resp.prepared:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Vary'] = 'Origin'
            resp.headers['Access-Control-Expose-Headers'] = ', '.join(PASS_HEADERS)
            if request.method == 'OPTIONS':
                resp.headers['Access-Control-Allow-Methods'] = 'GET'
                resp.headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type'
                resp.headers['Access-Control-Allow-Private-Network'] = 'true'
                resp.headers['Access-Control-Max-Age'] = '600'
        return resp

    async def on_startup(self, app):
        self.session = aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=SSL_CTX))
        self.tokens = TokenManager(self.session)
        asyncio.create_task(self.startup_check())

    async def startup_check(self):
        try:
            status, body, _ = await self.call_upstream('/api/v1/prices?symbols=005930')
        except (TokenError, aiohttp.ClientError, asyncio.TimeoutError):
            return                                      # 원인은 TokenManager 가 이미 출력
        if status == 200:
            price = json.loads(body)['result'][0]['lastPrice']
            log(f'연결 확인 완료 — 삼성전자(005930) 현재가 {price}원')
        elif status == 403:
            log('시세 조회 403 — 허용 IP 가 아닙니다. WTS 설정 > Open API > 허용 IP 관리에 현재 공인 IP 를 등록하세요.')
        else:
            log(f'시세 조회 실패 HTTP {status}: {body.decode(errors="replace")[:200]}')

    async def on_shutdown(self, app):
        await self.hub.close()          # 열린 웹소켓을 먼저 닫아야 Ctrl+C 가 바로 끝난다

    async def on_cleanup(self, app):
        await self.session.close()

    def build(self):
        app = web.Application(middlewares=[self.cors])
        app.router.add_get('/health', self.health)
        app.router.add_get('/ws', self.hub.handle)
        app.router.add_route('*', '/api/{tail:.*}', self.rest)
        app.on_startup.append(self.on_startup)
        app.on_shutdown.append(self.on_shutdown)
        app.on_cleanup.append(self.on_cleanup)
        return app


def main():
    base = f'http://{HOST}:{PORT}'
    print(f'토스증권 Open API 프록시 — {base}')
    print(f'  REST  {base}/api/v1/prices?symbols=005930')
    print(f'  WS    ws://{HOST}:{PORT}/ws')
    print(f'  상태  {base}/health')
    print(f'  허용 Origin: localhost' + (', ' + ', '.join(sorted(EXTRA_ORIGINS)) if EXTRA_ORIGINS else ''))
    if REST_BASE != 'https://openapi.tossinvest.com':
        print(f'  ⚠️ 업스트림 재지정: {REST_BASE} / {WS_URL}')
    print('종료: Ctrl+C', flush=True)
    try:
        web.run_app(TossProxy().build(), host=HOST, port=PORT, print=None)
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        sys.exit(f'\n{PORT} 포트를 이미 다른 프로그램이 쓰고 있습니다.\n'
                 f'  · 프록시가 이미 실행 중이면 그대로 쓰면 됩니다 — 상태: {base}/health\n'
                 f'  · 다른 포트로 실행하려면 .env 에 TOSS_PROXY_PORT=8780 처럼 지정하세요.')


if __name__ == '__main__':
    main()

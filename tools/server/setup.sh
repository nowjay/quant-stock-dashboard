#!/usr/bin/env bash
# =============================================================
#  토스증권 Open API 프록시 — 클라우드 서버 설치 (Ubuntu 22.04 / 24.04)
#
#    curl -fsSLO https://raw.githubusercontent.com/nowjay/quant-stock-dashboard/main/tools/server/setup.sh
#    sudo bash setup.sh
#
#  하는 일
#    1) python3-venv · Caddy 설치
#    2) /opt/toss-proxy 에 toss_proxy.py + 가상환경(aiohttp, certifi)
#    3) .env 작성 — client_id/secret 입력, 프록시 접속 키 자동 생성 (이미 있으면 유지)
#    4) systemd 서비스(toss-proxy) + Caddy HTTPS 리버스 프록시 (기본 도메인: <IP>.sslip.io)
#    5) 서버 안 방화벽 80·443 열기 (Oracle Cloud 우분투 이미지의 iptables 규칙 포함)
#    6) 휴대폰·PC 에서 한 번에 설정되는 연결 링크와 QR 코드 출력
#  다시 실행하면 toss_proxy.py 를 최신으로 바꾸고 재시작합니다 (.env · 도메인 유지).
#  친구용 안내: https://nowjay.github.io/quant-stock-dashboard/toss-guide.html
# =============================================================
set -euo pipefail

REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/nowjay/quant-stock-dashboard/main}"
APP_DIR=/opt/toss-proxy
SVC_USER=tossproxy
PORT=8778
DEFAULT_DASHBOARD="https://nowjay.github.io/quant-stock-dashboard/"
CADDY_FILE=/etc/caddy/Caddyfile

say(){ printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
die(){ printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "관리자 권한이 필요합니다:  sudo bash setup.sh"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "⚠️  Ubuntu 가 아닙니다 (${PRETTY_NAME:-?}) — 계속 진행하지만 실패할 수 있습니다."

# ---------- 1) 패키지 ----------
say "패키지 설치 (python3-venv, Caddy)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv curl gpg qrencode debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# ---------- 2) 프록시 ----------
say "프록시 설치 ($APP_DIR)"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP_DIR/tools"
curl -fsSL "$REPO_RAW/tools/toss_proxy.py" -o "$APP_DIR/tools/toss_proxy.py"
[ -x "$APP_DIR/.venv/bin/python" ] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip aiohttp certifi

PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)"
[ -n "$PUBLIC_IP" ] || die "서버의 공인 IP 를 확인하지 못했습니다. 인터넷 연결을 확인하세요."

# ---------- 3) .env ----------
if [ -f "$APP_DIR/.env" ]; then
  say ".env 유지 — 키를 다시 입력하려면 sudo rm $APP_DIR/.env 후 다시 실행하세요"
else
  say "토스증권 키 입력 (토스증권 WTS > 설정 > Open API)"
  read -rp  "  client_id: " CID
  read -rsp "  client_secret (입력 내용이 화면에 보이지 않습니다): " CSECRET; echo
  [ -n "$CID" ] && [ -n "$CSECRET" ] || die "client_id / client_secret 이 비어 있습니다."
  read -rp  "  대시보드 주소 [$DEFAULT_DASHBOARD]: " DASH
  DASH="${DASH:-$DEFAULT_DASHBOARD}"
  ORIGIN="$(printf '%s' "$DASH" | sed -E 's#^(https?://[^/]+).*#\1#')"
  KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  ( umask 077
    printf 'TOSS_CLIENT_ID=%s\nTOSS_CLIENT_SECRET=%s\nTOSS_PROXY_KEY=%s\nTOSS_ALLOWED_ORIGINS=%s\nTOSS_DASHBOARD_URL=%s\n' \
      "$CID" "$CSECRET" "$KEY" "$ORIGIN" "$DASH" > "$APP_DIR/.env" )
  unset CSECRET
fi
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"
KEY="$(sed -n 's/^TOSS_PROXY_KEY=//p' "$APP_DIR/.env")"
DASH="$(sed -n 's/^TOSS_DASHBOARD_URL=//p' "$APP_DIR/.env")"
DASH="${DASH:-$DEFAULT_DASHBOARD}"
[ -n "$KEY" ] || die "$APP_DIR/.env 에 TOSS_PROXY_KEY 가 없습니다. 파일을 지우고 다시 실행하세요."

# ---------- 4) 서비스 + HTTPS ----------
say "서비스 등록 (toss-proxy)"
cat > /etc/systemd/system/toss-proxy.service <<EOF
[Unit]
Description=Toss Securities Open API proxy (quant-stock-dashboard)
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/python $APP_DIR/tools/toss_proxy.py
Environment=PYTHONUNBUFFERED=1
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q toss-proxy
systemctl restart toss-proxy

say "HTTPS 설정 (Caddy)"
if grep -q "reverse_proxy 127.0.0.1:$PORT" "$CADDY_FILE" 2>/dev/null; then
  DOMAIN="$(awk '/\{/ {print $1; exit}' "$CADDY_FILE")"
  echo "  기존 도메인 유지: $DOMAIN"
else
  DEFAULT_DOMAIN="${PUBLIC_IP//./-}.sslip.io"
  echo "  무료 도메인 $DEFAULT_DOMAIN 은 가입 없이 이 서버 IP 로 연결됩니다. 자기 도메인이 있으면 입력하세요."
  read -rp "  프록시 도메인 [$DEFAULT_DOMAIN]: " DOMAIN
  DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
  [ -f "$CADDY_FILE" ] && cp "$CADDY_FILE" "$CADDY_FILE.bak.$(date +%s)"
  printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" > "$CADDY_FILE"
fi
systemctl enable -q caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ---------- 5) 서버 안 방화벽 ----------
say "방화벽 80·443 열기"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
fi
# Oracle Cloud 우분투 이미지는 iptables 에 REJECT 규칙이 있어 포트를 따로 열어야 한다
if iptables -S INPUT 2>/dev/null | grep -q -- "-j REJECT"; then
  for p in 80 443; do
    if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null; then
      n="$(iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')"
      iptables -I INPUT "$n" -p tcp -m state --state NEW --dport "$p" -j ACCEPT
    fi
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
fi

# ---------- 확인 ----------
say "확인"
sleep 2
if systemctl is-active -q toss-proxy; then
  echo "  프록시 실행 중 ✓"
  journalctl -u toss-proxy -n 3 --no-pager -o cat | sed 's/^/    /'
else
  journalctl -u toss-proxy -n 20 --no-pager -o cat
  die "프록시가 시작되지 않았습니다 (위 로그 참고)."
fi
HTTPS_OK=""
for _ in $(seq 1 20); do
  if curl -fsS --max-time 10 -o /dev/null -H "X-Proxy-Key: $KEY" "https://$DOMAIN/health" 2>/dev/null; then
    HTTPS_OK=1; break
  fi
  sleep 3
done
if [ -n "$HTTPS_OK" ]; then
  echo "  HTTPS 인증서 · 접속 확인 ✓  (https://$DOMAIN)"
else
  cat <<EOF
  ⚠️  아직 https://$DOMAIN 에 접속되지 않습니다. 확인할 것:
     · 클라우드 콘솔 방화벽에서 TCP 80, 443 이 열려 있는지 (아래 2번)
     · 인증서 발급 로그:  sudo journalctl -u caddy -n 30 --no-pager
     · sslip.io 인증서가 계속 실패하면 DuckDNS(무료) 도메인을 만들어 이 서버 IP 로 연결하고,
       sudo rm $CADDY_FILE 후 다시 실행해 그 도메인을 입력하세요.
EOF
fi

LINK="${DASH%/}/#toss=https://$DOMAIN&key=$KEY"

cat <<EOF

────────────────────────────────────────────────────────────
 남은 설정
   1) 토스증권 WTS > 설정 > Open API > 허용 IP 관리에 등록:   $PUBLIC_IP
   2) 클라우드 콘솔 방화벽에서 TCP 80 · 443 열기
        Lightsail: 인스턴스 > 네트워킹 > IPv4 방화벽에 HTTPS 추가
        Oracle   : VCN > Security List > Ingress Rules 에 80, 443 추가
   3) 기기마다 연결 — 휴대폰은 아래 QR 을 찍고, PC 는 연결 링크를 여세요.
      설정창에 주소와 키가 채워지면 '연결하기'를 누르면 됩니다.

      연결 링크  $LINK

      (직접 입력: 톱니 → 토스증권 Open API → 프록시 주소 https://$DOMAIN · 접속 키 $KEY)
      ⚠️ 링크와 키는 비밀번호입니다. 다른 사람에게 보내지 마세요.
EOF
command -v qrencode >/dev/null && qrencode -t ANSIUTF8 -m 2 "$LINK"
cat <<EOF

 확인  curl -H 'X-Proxy-Key: $KEY' https://$DOMAIN/health
 로그  sudo journalctl -u toss-proxy -f
 갱신  sudo bash setup.sh   (다시 실행하면 프록시 코드만 최신으로)
────────────────────────────────────────────────────────────
EOF

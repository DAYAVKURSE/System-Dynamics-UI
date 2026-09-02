#!/usr/bin/env bash
# Приводит чистый VPS в состояние, готовое принять приложение:
# пакеты, Node, pm2, каталоги, nginx-прокси и HTTPS-сертификат.
#
# Запускается с раннера GitHub через `ssh ... bash -s < bootstrap.sh`,
# поэтому не требует, чтобы на сервере уже что-то стояло (даже rsync).
# Идемпотентен: безопасно выполнять на каждый деплой.
#
# Ожидает переменные окружения: DEPLOY_PATH, APP_DOMAIN, APP_PORT
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:?DEPLOY_PATH не задан}"
APP_DOMAIN="${APP_DOMAIN:?APP_DOMAIN не задан}"
APP_PORT="${APP_PORT:-3000}"
# Пути nginx вынесены в переменные, чтобы скрипт можно было прогнать
# целиком в песочнице, не трогая настоящий /etc (см. deploy/rehearse.sh).
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-available/system-dynamics-ui}"
NGINX_ENABLED_DIR="${NGINX_ENABLED_DIR:-/etc/nginx/sites-enabled}"
# То же — для coturn: конфиг и файл включения службы.
TURN_CONF="${TURN_CONF:-/etc/turnserver.conf}"
TURN_DEFAULT="${TURN_DEFAULT:-/etc/default/coturn}"

# SUDO_E — отдельная переменная для команд, которым нужен sudo -E (сохранить
# окружение). Под root обе пустые: иначе одинокий "-E" стал бы именем команды.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
  SUDO_E=""
elif sudo -n true 2>/dev/null; then
  SUDO="sudo -n"
  SUDO_E="sudo -n -E"
else
  echo "ОШИБКА: нужен root или passwordless sudo для пользователя $(whoami)." >&2
  echo "Либо укажите в секрете SSH_USER пользователя root, либо разрешите этому" >&2
  echo "пользователю sudo без пароля." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "── проверяю пакеты ──"
missing=()
command -v rsync >/dev/null 2>&1 || missing+=(rsync)
command -v curl >/dev/null 2>&1 || missing+=(curl)
command -v nginx >/dev/null 2>&1 || missing+=(nginx)
command -v certbot >/dev/null 2>&1 || missing+=(certbot python3-certbot-nginx)

if [ ${#missing[@]} -gt 0 ]; then
  echo "ставлю: ${missing[*]}"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq "${missing[@]}"
else
  echo "все пакеты уже стоят"
fi

echo "── проверяю Node.js ──"
node_major=""
if command -v node >/dev/null 2>&1; then
  node_major="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
fi
if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then
  echo "ставлю Node.js 20 (было: ${node_major:-нет})"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO_E bash - >/dev/null
  $SUDO apt-get install -y -qq nodejs
else
  echo "Node.js $(node -v) подходит"
fi

command -v pm2 >/dev/null 2>&1 || { echo "ставлю pm2"; $SUDO npm install -g pm2 --silent; }

echo "── каталоги ──"
# app/ перезаписывается каждым деплоем, data/ — никогда.
$SUDO mkdir -p "$DEPLOY_PATH/app" "$DEPLOY_PATH/data/scenarios"
$SUDO chown -R "$(id -u):$(id -g)" "$DEPLOY_PATH"

echo "── nginx ──"
# Конфиг пишем только если его нет или он про другой домен: certbot
# дописывает в этот же файл секцию с 443, и перезапись стёрла бы её.
if ! [ -f "$NGINX_CONF" ] || ! grep -q "server_name $APP_DOMAIN;" "$NGINX_CONF"; then
  echo "пишу конфиг для $APP_DOMAIN"
  $SUDO tee "$NGINX_CONF" >/dev/null <<NGINX
server {
    listen 80;
    server_name $APP_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  $SUDO mkdir -p "$NGINX_ENABLED_DIR"
  $SUDO ln -sf "$NGINX_CONF" "$NGINX_ENABLED_DIR/system-dynamics-ui"
  $SUDO rm -f "$NGINX_ENABLED_DIR/default"
else
  echo "конфиг для $APP_DOMAIN уже на месте"
fi

$SUDO nginx -t
$SUDO systemctl reload nginx || $SUDO systemctl restart nginx

echo "── coturn (TURN для звонков) ──"
# Без TURN звонок между двумя строгими NAT не соединится вовсе. coturn
# ставится сюда же и работает по общему секрету: пароль для браузера —
# HMAC от срока действия, постоянных учётных данных в браузер не уезжает.
# Секрет пишет деплой в .env приложения; сюда он приходит переменной.
# TURN — улучшение звонков, а не само приложение: его сбой не должен ронять
# деплой. Поэтому установка в условии, а не под set -e. Индекс apt перед
# установкой обновляется: на живом сервере он был устаревшим, и apt получал
# 404 на зависимость, которой в зеркале уже нет.
turn_ok=0
if [ -n "${TURN_SECRET:-}" ]; then
  if command -v turnserver >/dev/null 2>&1; then
    turn_ok=1
  elif $SUDO apt-get update -qq >/dev/null 2>&1 && $SUDO apt-get install -y -qq coturn >/dev/null 2>&1; then
    turn_ok=1
  else
    echo "coturn не установился (apt) — звонки будут без TURN; приложение это не трогает"
  fi
fi
if [ "$turn_ok" = "1" ]; then
  # Публичный адрес — тот, в который резолвится домен. Если на интерфейсе
  # сервера его нет (хостер отдаёт приватный адрес и пробрасывает публичный),
  # coturn обязан знать оба: без external-ip он выдаёт клиентам приватный
  # адрес ретрансляции, до которого снаружи не добраться, — и TURN «настроен»,
  # но не работает.
  public_ip="$(getent ahostsv4 "$APP_DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  local_ips="$(hostname -I 2>/dev/null || true)"
  external_ip_line=""
  if [ -n "$public_ip" ] && ! printf '%s\n' $local_ips | grep -qx "$public_ip"; then
    local_ip="$(printf '%s\n' $local_ips | grep -v '^127\.' | head -1 || true)"
    if [ -n "$local_ip" ]; then
      external_ip_line="external-ip=${public_ip}/${local_ip}"
      echo "сервер за NAT: публичный $public_ip, на интерфейсе $local_ip — прописываю external-ip"
    fi
  fi
  $SUDO tee "$TURN_CONF" >/dev/null <<TURN
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${APP_DOMAIN}
${external_ip_line}
# Только ретрансляция для WebRTC — ничего лишнего наружу.
no-cli
no-tlsv1
no-tlsv1_1
min-port=49152
max-port=65535
TURN
  # В Debian/Ubuntu coturn выключен, пока не снят комментарий в этом файле.
  if [ -f "$TURN_DEFAULT" ]; then
    $SUDO sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' "$TURN_DEFAULT"
  fi
  $SUDO systemctl enable coturn >/dev/null 2>&1 || true
  $SUDO systemctl restart coturn || echo "coturn не перезапустился — звонки будут без TURN"
  # Файрвол: 3478 для сигналов TURN, диапазон ретрансляции — UDP.
  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    $SUDO ufw allow 3478/udp >/dev/null 2>&1 || true
    $SUDO ufw allow 3478/tcp >/dev/null 2>&1 || true
    $SUDO ufw allow 49152:65535/udp >/dev/null 2>&1 || true
    echo "ufw активен: 3478 и 49152–65535/udp открыты"
  else
    echo "ufw не активен — порты на самом сервере не закрыты"
  fi
  # «Настроен» — не то же, что «работает». Проверяем, что служба жива и порт
  # действительно слушается: иначе ошибка конфигурации осталась бы невидимой,
  # а звонки за строгим NAT молча не соединялись бы.
  # Список портов берём в переменную, а не в конвейер с grep -q: под pipefail
  # grep -q закрывает трубу после первого совпадения, ss получает SIGPIPE, и
  # проверка «не проходит» при живом coturn. Репетиция это и поймала.
  sleep 1
  listening="$({ ss -lnu 2>/dev/null; ss -lnt 2>/dev/null; } || true)"
  if ! systemctl is-active --quiet coturn 2>/dev/null; then
    echo "coturn НЕ ЗАПУЩЕН — звонки будут без TURN. Последние строки журнала:"
    $SUDO journalctl -u coturn -n 8 --no-pager 2>/dev/null | sed 's/^/  /' || true
  elif [[ "$listening" == *":3478 "* ]]; then
    echo "coturn слушает 3478 (udp/tcp) на $APP_DOMAIN"
  else
    echo "coturn запущен, но порт 3478 не слушает — звонки будут без TURN. Журнал:"
    $SUDO journalctl -u coturn -n 8 --no-pager 2>/dev/null | sed 's/^/  /' || true
  fi
elif [ -z "${TURN_SECRET:-}" ]; then
  echo "TURN_SECRET не задан — TURN пропущен"
fi

echo "── Claude Code (мост) ──"
# Воркер моста запускает Claude Code здесь же, на сервере. Ставится
# глобально; вход в аккаунт — отдельный шаг владельца (см. DEPLOYMENT.md).
if ! command -v claude >/dev/null 2>&1; then
  $SUDO npm i -g @anthropic-ai/claude-code >/dev/null 2>&1 \
    && echo "Claude Code установлен" \
    || echo "Claude Code не установился — мост будет отвечать, что не залогинен"
else
  echo "Claude Code уже установлен: $(claude --version 2>/dev/null | head -1)"
fi

echo "── HTTPS-сертификат ──"
if $SUDO certbot certificates 2>/dev/null | grep -q "$APP_DOMAIN"; then
  echo "сертификат для $APP_DOMAIN уже выпущен (продление certbot делает сам)"
elif $SUDO certbot --nginx -d "$APP_DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
  echo "сертификат выпущен"
else
  echo "ПРЕДУПРЕЖДЕНИЕ: не удалось выпустить сертификат для $APP_DOMAIN." >&2
  echo "Чаще всего причина — закрыт порт 80 снаружи (firewall хостера)." >&2
  echo "Приложение будет работать по HTTP, но Telegram требует HTTPS." >&2
fi

# Чтобы приложение поднималось после перезагрузки сервера.
$SUDO env PATH="$PATH" pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null 2>&1 || true

echo "── сервер готов ──"
